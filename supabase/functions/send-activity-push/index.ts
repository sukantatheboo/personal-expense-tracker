import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

const supabase = createClient(
  supabaseUrl || "",
  supabaseServiceRoleKey || "",
);

if (vapidSubject && vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return jsonResponse(
      { error: "Missing Supabase or VAPID configuration." },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ error: "Missing authorization token." }, 401);
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const title = String(body.title || "").trim().slice(0, 120);
  const msgBody = String(body.body || "").trim().slice(0, 240);
  if (!title || !msgBody) {
    return jsonResponse({ error: "title and body are required." }, 400);
  }

  const allowedTabs = new Set(["home", "activity", "accounts", "plans"]);
  const tab = allowedTabs.has(String(body.tab || ""))
    ? String(body.tab)
    : "activity";
  const tag = String(body.tag || `spend-activity-${Date.now()}`).slice(0, 120);
  const excludeDeviceId = String(body.excludeDeviceId || "").trim();
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
    return jsonResponse({ error: devicesError.message }, 500);
  }

  if (!devices?.length) {
    return jsonResponse({ sent: 0, devices: 0 });
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

  return jsonResponse({ sent, devices: devices.length });
});
