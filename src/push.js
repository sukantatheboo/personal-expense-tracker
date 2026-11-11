import { localDate, nextOccurrenceDate } from "./data.js";
import { getWeeklySpendSummary } from "./notifications.js";

const cleanEnv = (value) =>
  typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);
export const vapidPublicKey = cleanEnv(import.meta.env.VITE_VAPID_PUBLIC_KEY);

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const pushBackendConfigured = Boolean(
  supabaseConfigured && vapidPublicKey,
);

export let supabase = null;
let supabaseInitPromise = null;

export async function getSupabase() {
  if (!supabaseConfigured) return null;
  if (supabase) return supabase;
  if (!supabaseInitPromise) {
    supabaseInitPromise = import("@supabase/supabase-js").then(
      ({ createClient }) => {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        return supabase;
      },
    );
  }
  return supabaseInitPromise;
}

function getDeviceId() {
  const key = "spend-push-device-id-v1";
  let id = localStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.();
    if (!id) throw new Error("This browser cannot create a secure device ID.");
    localStorage.setItem(key, id);
  }
  return id;
}

function vapidKeyBytes(value) {
  const clean = String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const decoded = atob(
    (clean + padding).replaceAll("-", "+").replaceAll("_", "/"),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = String(dateStr || "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return localDate();
  return localDate(new Date(y, m - 1, d + days));
}

function clampDayOfMonth(day) {
  const num = Number(day);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(31, Math.round(num)));
}

export async function enableBackgroundPush(userId) {
  const client = await getSupabase();
  if (!client || !vapidPublicKey) {
    throw new Error("Background push has not been configured for this app.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported by this browser.");
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) {
    throw new Error(
      "The installed Spend app needs to finish loading before push can be enabled.",
    );
  }
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(vapidPublicKey),
    }));
  const serialized = subscription.toJSON();
  if (
    !serialized.endpoint ||
    !serialized.keys?.p256dh ||
    !serialized.keys?.auth
  ) {
    throw new Error("The browser returned an invalid push subscription.");
  }

  // Ensure this subscription endpoint is detached from any older user on this browser to avoid privacy leaks
  await client
    .from("push_devices")
    .delete()
    .eq("endpoint", serialized.endpoint)
    .neq("user_id", userId);

  const { error } = await client.from("push_devices").upsert(
    {
      user_id: userId,
      device_id: getDeviceId(),
      endpoint: serialized.endpoint,
      subscription: serialized,
    },
    { onConflict: "user_id,device_id" },
  );
  if (error) throw error;
  return { registration, subscription };
}

export async function disableBackgroundPush(userId) {
  const client = await getSupabase();
  if (!client) throw new Error("Background push has not been configured.");
  const deviceId = getDeviceId();
  const { error: remindersError } = await client
    .from("push_reminders")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (remindersError) throw remindersError;
  const { error: deviceError } = await client
    .from("push_devices")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (deviceError) throw deviceError;
  const registration =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration()
      : null;
  const pushManager = registration?.pushManager;
  const subscription =
    typeof pushManager?.getSubscription === "function"
      ? await pushManager.getSubscription()
      : null;
  if (
    subscription &&
    typeof subscription.unsubscribe === "function" &&
    !(await subscription.unsubscribe())
  ) {
    throw new Error(
      "The browser could not unsubscribe from push notifications.",
    );
  }
  try {
    localStorage.removeItem("spend-push-device-id-v1");
  } catch {
    // Ignore storage errors on cleanup
  }
}

/**
 * Syncs all closed-app reminder schedules to Supabase `push_reminders`:
 * 1. Recurring expenses due on the due date (`<schedule.id>`)
 * 2. Upcoming bill heads-up 1 day before (`heads-up:<schedule.id>`)
 * 3. Daily expense tracking reminders (`__daily_0__` .. `__daily_6__`)
 * 4. Weekly spending summary on Sundays (`__weekly_summary__`)
 * 5. 1st-of-the-month spend overview (`__monthly_overview__`)
 */
export async function syncBackgroundSchedules(
  userId,
  schedules = [],
  reminderTime = "09:00",
  { expenses = [] } = {},
) {
  const client = await getSupabase();
  if (!client) throw new Error("Background push has not been configured.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
    throw new Error("Choose a valid reminder time.");
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const deviceId = getDeviceId();
  const [hours, minutes] = reminderTime.split(":").map(Number);
  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = localDate(now);
  const hasExpenseToday = expenses.some((e) => e?.date === todayStr);

  const reminders = [];

  // 1 & 2. Recurring expense due-day + 1-day-before heads-up reminders
  for (const schedule of schedules) {
    if (!schedule?.id || !schedule?.nextDate) continue;
    const interval = schedule.interval === "weekly" ? "weekly" : "monthly";
    const dayOfMonth = clampDayOfMonth(
      schedule.dayOfMonth || Number(schedule.nextDate.slice(-2)),
    );

    // Due-day reminder
    let targetDate = schedule.nextDate;
    let [year, month, day] = targetDate.split("-").map(Number);
    let notifyDate = new Date(year, month - 1, day, hours, minutes);
    let guard = 0;
    while (notifyDate.getTime() <= nowMs && guard < 240) {
      targetDate = nextOccurrenceDate(targetDate, interval, dayOfMonth);
      [year, month, day] = targetDate.split("-").map(Number);
      notifyDate = new Date(year, month - 1, day, hours, minutes);
      guard += 1;
    }

    reminders.push({
      user_id: userId,
      device_id: deviceId,
      schedule_id: schedule.id,
      description: String(schedule.description || "Recurring expense").slice(
        0,
        80,
      ),
      interval,
      day_of_month: dayOfMonth,
      next_date: targetDate,
      next_notify_at: notifyDate.toISOString(),
      timezone,
      reminder_time: reminderTime,
      active: Boolean(schedule.active),
    });

    // 1-day-before heads-up reminder
    let billOccDate = schedule.nextDate;
    let headsUpDate = addDaysToDateStr(billOccDate, -1);
    let [hy, hm, hd] = headsUpDate.split("-").map(Number);
    let headsUpNotify = new Date(hy, hm - 1, hd, hours, minutes);
    let headsUpGuard = 0;
    while (headsUpNotify.getTime() <= nowMs && headsUpGuard < 240) {
      billOccDate = nextOccurrenceDate(billOccDate, interval, dayOfMonth);
      headsUpDate = addDaysToDateStr(billOccDate, -1);
      [hy, hm, hd] = headsUpDate.split("-").map(Number);
      headsUpNotify = new Date(hy, hm - 1, hd, hours, minutes);
      headsUpGuard += 1;
    }

    reminders.push({
      user_id: userId,
      device_id: deviceId,
      schedule_id: `heads-up:${schedule.id}`,
      description: String(schedule.description || "Recurring expense").slice(
        0,
        80,
      ),
      interval,
      day_of_month: dayOfMonth,
      next_date: headsUpDate,
      next_notify_at: headsUpNotify.toISOString(),
      timezone,
      reminder_time: reminderTime,
      active: Boolean(schedule.active),
    });
  }

  // 3. Daily expense tracking reminders (7 weekday slots using 'weekly' interval)
  for (let dow = 0; dow < 7; dow += 1) {
    let daysAhead = (dow - now.getDay() + 7) % 7;
    let candidateDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + daysAhead,
      hours,
      minutes,
      0,
    );
    if (
      daysAhead === 0 &&
      (candidateDate.getTime() <= nowMs || hasExpenseToday)
    ) {
      daysAhead = 7;
      candidateDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysAhead,
        hours,
        minutes,
        0,
      );
    }
    const nextDateStr = localDate(candidateDate);
    reminders.push({
      user_id: userId,
      device_id: deviceId,
      schedule_id: `__daily_${dow}__`,
      description: "Daily expense reminder",
      interval: "weekly",
      day_of_month: clampDayOfMonth(Number(nextDateStr.slice(-2))),
      next_date: nextDateStr,
      next_notify_at: candidateDate.toISOString(),
      timezone,
      reminder_time: reminderTime,
      active: true,
    });
  }

  // 4. Weekly spending summary (Sundays at reminderTime)
  let daysUntilSunday = (7 - now.getDay()) % 7;
  let sundayNotify = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysUntilSunday,
    hours,
    minutes,
    0,
  );
  if (sundayNotify.getTime() <= nowMs) {
    daysUntilSunday += 7;
    sundayNotify = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + daysUntilSunday,
      hours,
      minutes,
      0,
    );
  }
  const sundayDateStr = localDate(sundayNotify);
  const weeklyStats = getWeeklySpendSummary(expenses, now);
  const weeklyDesc =
    weeklyStats.count > 0
      ? `Weekly spend: ৳${weeklyStats.total.toLocaleString("en-IN")} (${weeklyStats.count} items)`
      : "Weekly spending summary";

  reminders.push({
    user_id: userId,
    device_id: deviceId,
    schedule_id: "__weekly_summary__",
    description: weeklyDesc.slice(0, 80),
    interval: "weekly",
    day_of_month: clampDayOfMonth(Number(sundayDateStr.slice(-2))),
    next_date: sundayDateStr,
    next_notify_at: sundayNotify.toISOString(),
    timezone,
    reminder_time: reminderTime,
    active: true,
  });

  // 5. 1st-of-the-month spend overview
  let firstOfMonthNotify = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    hours,
    minutes,
    0,
  );
  if (firstOfMonthNotify.getTime() <= nowMs) {
    firstOfMonthNotify = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      hours,
      minutes,
      0,
    );
  }
  const firstOfMonthStr = localDate(firstOfMonthNotify);
  reminders.push({
    user_id: userId,
    device_id: deviceId,
    schedule_id: "__monthly_overview__",
    description: "Previous month's spend overview",
    interval: "monthly",
    day_of_month: 1,
    next_date: firstOfMonthStr,
    next_notify_at: firstOfMonthNotify.toISOString(),
    timezone,
    reminder_time: reminderTime,
    active: true,
  });

  if (reminders.length) {
    const { error } = await client
      .from("push_reminders")
      .upsert(reminders, { onConflict: "user_id,device_id,schedule_id" });
    if (error) throw error;
  }

  const { data: existing, error: loadError } = await client
    .from("push_reminders")
    .select("schedule_id")
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (loadError) throw loadError;

  const currentIds = new Set(reminders.map(({ schedule_id }) => schedule_id));
  const staleIds = (existing ?? [])
    .map((r) => r.schedule_id)
    .filter((id) => !currentIds.has(id));
  if (staleIds.length) {
    const { error } = await client
      .from("push_reminders")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .in("schedule_id", staleIds);
    if (error) throw error;
  }
}
