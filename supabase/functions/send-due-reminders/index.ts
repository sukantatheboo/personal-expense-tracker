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

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

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

function nextDate(
  date: string,
  interval: string,
  dayOfMonth: number | null,
  scheduleId = "",
) {
  if (interval === "daily") return addDays(date, 1);
  if (interval === "weekly") return addDays(date, 7);
  if (scheduleId.startsWith("heads-up:")) {
    // Advance the underlying bill due date (+1 day), then step back 1 day for the next heads-up
    const currentBillDate = addDays(date, 1);
    const nextBillDate =
      interval === "yearly"
        ? addMonthsClamped(currentBillDate, 12, dayOfMonth)
        : addMonthsClamped(currentBillDate, 1, dayOfMonth);
    return addDays(nextBillDate, -1);
  }
  if (interval === "yearly") return addMonthsClamped(date, 12, dayOfMonth);
  return addMonthsClamped(date, 1, dayOfMonth); // "monthly"
}

function buildPushPayload(r: {
  schedule_id: string;
  description: string;
  next_date: string;
}) {
  const id = String(r.schedule_id || "");
  if (id === "__monthly_overview__") {
    return {
      title: "Previous month's spend overview is ready",
      body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
      tag: `spend-new-month-${r.next_date.slice(0, 7)}`,
      tab: "home",
      url: "./?tab=home",
    };
  }
  if (id === "__weekly_summary__") {
    const hasCustomStats =
      r.description && r.description !== "Weekly spending summary";
    return {
      title: "Weekly spending summary",
      body: hasCustomStats
        ? `${r.description}. Open Spend to review your weekly activity and budget pace.`
        : "Your weekly spending recap is ready. Open Spend to review this week's activity and budget pace.",
      tag: `spend-weekly-${r.next_date}`,
      tab: "activity",
      url: "./?tab=activity",
    };
  }
  if (id.startsWith("__daily_")) {
    return {
      title: "Daily expense reminder",
      body: "Don’t forget to track today's expenses to keep your budget on target.",
      tag: `spend-daily-${r.next_date}`,
      tab: "home",
      url: "./?tab=home",
    };
  }
  if (id.startsWith("heads-up:")) {
    return {
      title: "Upcoming bill tomorrow",
      body: `${r.description} is due tomorrow.`,
      tag: `${id}:${r.next_date}`,
      tab: "plans",
      url: "./?tab=plans",
    };
  }
  return {
    title: "Recurring expense due",
    body: `${r.description} is due today.`,
    tag: `${id}:${r.next_date}`,
    tab: "activity",
    url: "./?tab=activity",
  };
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
  const firstPass = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  // Second pass ensures exact local wall-clock time across DST transitions
  return new Date(guess.getTime() - zoneOffsetMs(firstPass, timeZone));
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret") || "";
  if (!cronSecret || !providedSecret || !timingSafeEqualStr(providedSecret, cronSecret)) {
    return new Response("forbidden", { status: 403 });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase URL/service key or VAPID credentials." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  // Atomic claim (needs migration 20261113020000): one SQL statement picks the due
  // rows, locks them with SKIP LOCKED and writes a 5-minute lease, so two
  // overlapping cron runs can never send the same reminder twice.
  const { data: due, error } = await supabase.rpc("claim_due_push_reminders", {
    p_limit: 200,
    p_lease_seconds: 5 * 60,
  });

  if (error) return new Response(error.message, { status: 500 });
  if (!due?.length) return Response.json({ due: 0, sent: 0 });

  const dueUserIds = [...new Set(due.map((r) => r.user_id))];
  const dueDeviceIds = [...new Set(due.map((r) => r.device_id))];
  const { data: devices, error: devicesError } = await supabase
    .from("push_devices")
    .select("user_id, device_id, subscription")
    .in("user_id", dueUserIds)
    .in("device_id", dueDeviceIds);
  if (devicesError) {
    // Do NOT treat a failed lookup as "device missing" - that would delete every
    // due reminder. The leases expire on their own and the next run retries.
    console.error("device lookup failed", devicesError.message);
    return new Response(devicesError.message, { status: 500 });
  }
  const byDevice = new Map((devices ?? []).map((d) => [`${d.user_id}:${d.device_id}`, d]));
  const deadDevices = new Set<string>();

  let sent = 0;
  const CONCURRENCY = 10;

  async function processReminder(r: (typeof due)[number]) {
    const deviceKey = `${r.user_id}:${r.device_id}`;
    if (deadDevices.has(deviceKey)) {
      return;
    }
    const device = byDevice.get(deviceKey);
    if (!device) {
      deadDevices.add(deviceKey);
      // Clean up orphaned push_reminders whose device subscription no longer exists
      await supabase
        .from("push_reminders")
        .delete()
        .eq("user_id", r.user_id)
        .eq("device_id", r.device_id);
      return;
    }

    // (lease already acquired atomically by claim_due_push_reminders)

    // Calculate next FUTURE occurrence date
    let date: string = r.next_date;
    let notifyAt = new Date(r.next_notify_at);
    for (let i = 0; notifyAt.getTime() <= now.getTime() && i < 500; i += 1) {
      date = nextDate(date, r.interval, r.day_of_month, r.schedule_id);
      notifyAt = zonedTimeToUtc(date, r.reminder_time, r.timezone);
    }

    // Skip sending if reminder is stale (>12h old), but advance schedule forward
    if (now.getTime() - new Date(r.next_notify_at).getTime() > STALE_MS) {
      await supabase
        .from("push_reminders")
        .update({
          next_date: date,
          next_notify_at: notifyAt.toISOString(),
          claim_until: null,
          pending_notification: false,
        })
        .eq("user_id", r.user_id)
        .eq("device_id", r.device_id)
        .eq("schedule_id", r.schedule_id);
      return;
    }

    const payload = buildPushPayload(r);
    let pushSucceeded = false;
    try {
      await webpush.sendNotification(
        device.subscription,
        JSON.stringify(payload),
        { TTL: 6 * 60 * 60 },
      );
      sent += 1;
      pushSucceeded = true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        deadDevices.add(deviceKey);
        byDevice.delete(deviceKey);
        // Subscription expired: remove both device and its reminders so orphaned rows do not accumulate
        await supabase
          .from("push_reminders")
          .delete()
          .eq("user_id", r.user_id)
          .eq("device_id", r.device_id);
        await supabase
          .from("push_devices")
          .delete()
          .eq("user_id", r.user_id)
          .eq("device_id", r.device_id);
        return;
      } else {
        console.error("push failed", status, (err as { body?: unknown }).body ?? err);
      }
    }

    if (pushSucceeded) {
      // Advance to next occurrence ONLY AFTER successful push dispatch
      await supabase
        .from("push_reminders")
        .update({
          next_date: date,
          next_notify_at: notifyAt.toISOString(),
          claim_until: null,
          pending_notification: false,
        })
        .eq("user_id", r.user_id)
        .eq("device_id", r.device_id)
        .eq("schedule_id", r.schedule_id);
    } else {
      // Release claim lease on transient error so next cron execution can retry
      await supabase
        .from("push_reminders")
        .update({
          claim_until: null,
          pending_notification: false,
        })
        .eq("user_id", r.user_id)
        .eq("device_id", r.device_id)
        .eq("schedule_id", r.schedule_id);
    }
  }

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((r) => processReminder(r)));
  }

  return Response.json({ due: due.length, sent });
});
