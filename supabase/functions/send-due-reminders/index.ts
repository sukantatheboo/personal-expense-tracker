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

const STALE_MS = 12 * 60 * 60 * 1000; // don't send reminders that are over 12h late

// ---- date helpers: keep in sync with nextOccurrenceDate in src/data.js ----
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsClamped(date: string, months: number, dayOfMonth: number | null) {
  const [y, m] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dayOfMonth || Number(date.slice(-2)), lastDay));
  return first.toISOString().slice(0, 10);
}

function nextDate(date: string, interval: string, dayOfMonth: number | null) {
  if (interval === "weekly") return addDays(date, 7);
  if (interval === "yearly") return addMonthsClamped(date, 12, dayOfMonth);
  return addMonthsClamped(date, 1, dayOfMonth); // "monthly"
}

// wall-clock time in an IANA time zone -> UTC instant
function zoneOffsetMs(at: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at.getTime();
  } catch {
    return 0;
  }
}

function zonedTimeToUtc(date: string, time: string, timeZone: string) {
  const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "09:00";
  const guess = new Date(`${date}T${safeTime}:00Z`);
  return new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase URL/service key or VAPID credentials." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  const { data: due, error } = await supabase
    .from("push_reminders")
    .select("user_id, device_id, schedule_id, description, interval, day_of_month, next_date, next_notify_at, timezone, reminder_time")
    .eq("active", true)
    .lte("next_notify_at", now.toISOString())
    .limit(200);

  if (error) return new Response(error.message, { status: 500 });
  if (!due?.length) return Response.json({ due: 0, sent: 0 });

  const { data: devices } = await supabase
    .from("push_devices")
    .select("user_id, device_id, subscription")
    .in("device_id", [...new Set(due.map((r) => r.device_id))]);
  const byDevice = new Map((devices ?? []).map((d) => [`${d.user_id}:${d.device_id}`, d]));

  let sent = 0;
  for (const r of due) {
    // move the row to its next FUTURE occurrence
    let date: string = r.next_date;
    let notifyAt = new Date(r.next_notify_at);
    for (let i = 0; notifyAt.getTime() <= now.getTime() && i < 500; i += 1) {
      date = nextDate(date, r.interval, r.day_of_month);
      notifyAt = zonedTimeToUtc(date, r.reminder_time, r.timezone);
    }

    // claim first, so two overlapping runs can never send the same reminder twice
    const { data: claimed } = await supabase
      .from("push_reminders")
      .update({ next_date: date, next_notify_at: notifyAt.toISOString() })
      .eq("user_id", r.user_id)
      .eq("device_id", r.device_id)
      .eq("schedule_id", r.schedule_id)
      .eq("next_notify_at", r.next_notify_at)
      .select("schedule_id");
    if (!claimed?.length) continue;

    if (now.getTime() - new Date(r.next_notify_at).getTime() > STALE_MS) continue; // too old to be useful

    const device = byDevice.get(`${r.user_id}:${r.device_id}`);
    if (!device) continue;
    try {
      await webpush.sendNotification(
        device.subscription,
        JSON.stringify({
          title: "Recurring expense due",
          body: `${r.description} is due today.`,
          tag: `${r.schedule_id}:${r.next_date}`,
          tab: "activity",
          url: "./?tab=activity",
        }),
        { TTL: 6 * 60 * 60 },
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_devices").delete()
          .eq("user_id", r.user_id).eq("device_id", r.device_id); // subscription expired
      } else {
        console.error("push failed", status, (err as { body?: unknown }).body ?? err);
      }
    }
  }
  return Response.json({ due: due.length, sent });
});
