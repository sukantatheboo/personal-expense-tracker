import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const allowedOrigin = (Deno.env.get("ALLOWED_ORIGIN") || "*").trim() || "*";

const supabase = createClient(
  supabaseUrl || "",
  supabaseServiceRoleKey || "",
);

if (vapidPublicKey && vapidPrivateKey) {
  if (!vapidSubject) {
    console.warn("VAPID_SUBJECT is not configured; falling back to placeholder mailto.");
  }
  webpush.setVapidDetails(
    vapidSubject || "mailto:admin@example.com",
    vapidPublicKey,
    vapidPrivateKey,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCorsHeaders(req: Request) {
  const reqOrigin = req.headers.get("origin") || "";
  const allowOrigin =
    allowedOrigin === "*"
      ? "*"
      : allowedOrigin
            .split(",")
            .map((s) => s.trim())
            .includes(reqOrigin)
        ? reqOrigin
        : allowedOrigin.split(",")[0].trim();
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function isValidSubscription(sub: unknown): sub is webpush.PushSubscription {
  if (!sub || typeof sub !== "object") return false;
  const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof s.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    typeof s.keys?.p256dh === "string" &&
    s.keys.p256dh.length > 0 &&
    typeof s.keys?.auth === "string" &&
    s.keys.auth.length > 0
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method Not Allowed" }, 405);
  }

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return jsonResponse(
      req,
      { error: "Missing Supabase or VAPID configuration." },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse(req, { error: "Missing authorization token." }, 401);
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user?.id) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body." }, 400);
  }

  const title = String(body.title || "").trim().slice(0, 120);
  const msgBody = String(body.body || "").trim().slice(0, 240);
  if (!title || !msgBody) {
    return jsonResponse(req, { error: "title and body are required." }, 400);
  }

  const allowedTabs = new Set(["home", "activity", "accounts", "plans"]);
  const tab = allowedTabs.has(String(body.tab || ""))
    ? String(body.tab)
    : "activity";
  const tag = String(body.tag || `spend-activity-${Date.now()}`).slice(0, 120);
  const rawExcludeDeviceId = String(body.excludeDeviceId || "").trim();
  const excludeDeviceId = UUID_RE.test(rawExcludeDeviceId)
    ? rawExcludeDeviceId
    : "";
  const tone = body.tone === "welcome" ? "welcome" : "reminder";

  let query = supabase
    .from("push_devices")
    .select("device_id, subscription")
    .eq("user_id", user.id);

  if (excludeDeviceId) {
    query = query.neq("device_id", excludeDeviceId);
  }

  const { data: devices, error: devicesError } = await query;
  if (devicesError) {
    console.error("activity push device lookup failed", devicesError.message);
    return jsonResponse(req, { error: devicesError.message }, 500);
  }

  if (!devices?.length) {
    return jsonResponse(req, { sent: 0, devices: 0 });
  }

  const payload = JSON.stringify({
    title,
    body: msgBody,
    tag,
    tab,
    url: `./?tab=${encodeURIComponent(tab)}`,
    tone,
    renotify: false,
  });

  let sent = 0;
  await Promise.allSettled(
    devices.map(async (device) => {
      if (!isValidSubscription(device.subscription)) {
        return;
      }
      try {
        await webpush.sendNotification(device.subscription, payload, {
          TTL: 60 * 60,
        });
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase
            .from("push_reminders")
            .delete()
            .eq("user_id", user.id)
            .eq("device_id", device.device_id);
          await supabase
            .from("push_devices")
            .delete()
            .eq("user_id", user.id)
            .eq("device_id", device.device_id);
        } else {
          console.error(
            "activity push failed",
            status,
            (err as { body?: unknown }).body ?? err,
          );
        }
      }
    }),
  );

  return jsonResponse(req, { sent, devices: devices.length });
});
