import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cronSecret = Deno.env.get("CRON_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dateInTimeZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function nextOccurrence(
  dateValue: string,
  interval: string,
  dayOfMonth: number,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (interval === "weekly") {
    const date = new Date(Date.UTC(year, month - 1, day + 7));
    return date.toISOString().slice(0, 10);
  }
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const nextDay = Math.min(dayOfMonth || day, lastDay);
  return [
    nextMonth.getUTCFullYear(),
    String(nextMonth.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDay).padStart(2, "0"),
  ].join("-");
}

function localTime(dateValue: string, timeValue: string, timezone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .map(({ type, value }) => [type, value]),
    );
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    candidate += target - represented;
  }
  return new Date(candidate).toISOString();
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return response(405, { error: "Method not allowed." });
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return response(401, { error: "Unauthorized." });
  }
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey ||
    !vapidSubject
  ) {
    console.error("Push reminder secrets are not configured.");
    return response(500, { error: "Push reminders are not configured." });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const { data: dueReminders, error: queryError } = await supabase
    .from("push_reminders")
    .select("*")
    .eq("active", true)
    .lte("next_notify_at", now.toISOString())
    .order("next_notify_at", { ascending: true })
    .limit(100);

  if (queryError) {
    console.error("Could not load due reminders:", queryError.message);
    return response(500, { error: "Could not load due reminders." });
  }

  let sent = 0;
  for (const reminder of dueReminders ?? []) {
    let nextDate = reminder.next_date;
    let today;
    try {
      today = dateInTimeZone(now, reminder.timezone);
    } catch (error) {
      console.error("Skipping reminder with invalid timezone:", error);
      continue;
    }
    let attempts = 0;
    while (nextDate <= today && attempts < 240) {
      nextDate = nextOccurrence(
        nextDate,
        reminder.interval,
        reminder.day_of_month,
      );
      attempts += 1;
    }
    if (nextDate <= today) {
      nextDate = nextOccurrence(
        today,
        reminder.interval,
        reminder.day_of_month,
      );
    }

    const nextNotifyAt = localTime(
      nextDate,
      reminder.reminder_time,
      reminder.timezone,
    );
    const lockUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("push_reminders")
      .update({
        next_notify_at: lockUntil,
        claim_until: lockUntil,
        pending_notification: true,
      })
      .eq("user_id", reminder.user_id)
      .eq("device_id", reminder.device_id)
      .eq("schedule_id", reminder.schedule_id)
      .eq("next_notify_at", reminder.next_notify_at)
      .lte("next_notify_at", now.toISOString())
      .select("schedule_id");

    if (claimError) {
      console.error("Could not advance reminder:", claimError.message);
      continue;
    }
    if (!claimed?.length) continue;

    const { data: devices, error: deviceError } = await supabase
      .from("push_devices")
      .select("endpoint, subscription")
      .eq("user_id", reminder.user_id)
      .eq("device_id", reminder.device_id);

    if (deviceError) {
      console.error("Could not load push devices:", deviceError.message);
      continue;
    }
    if (!devices?.length) {
      const { error: deleteError } = await supabase
        .from("push_reminders")
        .delete()
        .eq("user_id", reminder.user_id)
        .eq("device_id", reminder.device_id)
        .eq("schedule_id", reminder.schedule_id);
      if (deleteError) {
        console.error(
          "Could not remove reminder without a push device:",
          deleteError.message,
        );
      }
      continue;
    }

    const payload = JSON.stringify({
      title: "Recurring expense due",
      body: `${String(reminder.description).slice(0, 80)} is due today.`,
    });
    let deliveryFailed = false;
    let expired = false;
    for (const device of devices ?? []) {
      let endpoint;
      try {
        endpoint = new URL(device.endpoint);
      } catch {
        console.error("Ignoring an invalid push endpoint.");
        expired = true;
        break;
      }
      if (
        ![
          "fcm.googleapis.com",
          "web.push.apple.com",
          "updates.push.services.mozilla.com",
          "push.services.mozilla.com",
        ].includes(endpoint.hostname) ||
        endpoint.protocol !== "https:" ||
        device.subscription?.endpoint !== device.endpoint
      ) {
        console.error("Ignoring an invalid push endpoint.");
        expired = true;
        break;
      }
      try {
        await webpush.sendNotification(device.subscription, payload);
        sent += 1;
      } catch (error) {
        const statusCode =
          error instanceof Error && "statusCode" in error
            ? error.statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          expired = true;
        } else {
          deliveryFailed = true;
          console.error(
            "Could not send push notification:",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (expired) {
      const { error: deviceDeleteError } = await supabase
        .from("push_devices")
        .delete()
        .eq("user_id", reminder.user_id)
        .eq("device_id", reminder.device_id);
      if (deviceDeleteError) {
        console.error(
          "Could not remove expired push device:",
          deviceDeleteError.message,
        );
      }
      const { error: reminderDeleteError } = await supabase
        .from("push_reminders")
        .delete()
        .eq("user_id", reminder.user_id)
        .eq("device_id", reminder.device_id);
      if (reminderDeleteError) {
        console.error(
          "Could not remove reminders for expired device:",
          reminderDeleteError.message,
        );
      }
      continue;
    }

    const retryUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const update = deliveryFailed
      ? { next_notify_at: retryUntil, claim_until: retryUntil }
      : {
          next_date: nextDate,
          next_notify_at: nextNotifyAt,
          claim_until: null,
          pending_notification: false,
        };
    const { error: finishError } = await supabase
      .from("push_reminders")
      .update(update)
      .eq("user_id", reminder.user_id)
      .eq("device_id", reminder.device_id)
      .eq("schedule_id", reminder.schedule_id)
      .eq("next_notify_at", lockUntil)
      .eq("claim_until", lockUntil);
    if (finishError) {
      console.error("Could not finish reminder delivery:", finishError.message);
    }
  }

  return response(200, { processed: dueReminders?.length ?? 0, sent });
});
