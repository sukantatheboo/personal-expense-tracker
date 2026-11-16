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

export const PUSH_DISABLED_BY_USER_KEY = "spend-push-disabled-by-user-v1";

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

async function getActiveServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(existing || null), 4000)),
    ]);
  } catch {
    return existing || null;
  }
}

export async function enableBackgroundPush(userId) {
  const client = await getSupabase();
  if (!client || !vapidPublicKey) {
    throw new Error("Background push has not been configured for this app.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported by this browser.");
  }

  const registration = await getActiveServiceWorkerRegistration();
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

  // Ensure this subscription endpoint is detached from any older user on this browser via SECURITY DEFINER RPC
  const deviceId = getDeviceId();
  const rpcRes = await client.rpc("register_spend_push_device", {
    p_device_id: deviceId,
    p_endpoint: serialized.endpoint,
    p_subscription: serialized,
  });
  if (rpcRes.error) {
    const isRpcMissing =
      rpcRes.error.code === "42883" || rpcRes.error.code === "PGRST202";
    if (!isRpcMissing) throw rpcRes.error;
    await client
      .from("push_devices")
      .delete()
      .eq("endpoint", serialized.endpoint)
      .neq("user_id", userId);

    const { error } = await client.from("push_devices").upsert(
      {
        user_id: userId,
        device_id: deviceId,
        endpoint: serialized.endpoint,
        subscription: serialized,
      },
      { onConflict: "user_id,device_id" },
    );
    if (error) throw error;
  }
  try {
    localStorage.removeItem(PUSH_DISABLED_BY_USER_KEY);
  } catch {}
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
    localStorage.setItem(PUSH_DISABLED_BY_USER_KEY, "true");
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

  // Ensure push_devices row is always present and synced for this (user_id, device_id)
  // so send-due-reminders never deletes push_reminders as orphaned
  let deviceSynced = false;
  if ("serviceWorker" in navigator && "PushManager" in window) {
    try {
      const registration = await getActiveServiceWorkerRegistration();
      if (registration?.pushManager) {
        let subscription = await registration.pushManager.getSubscription();
        if (
          !subscription &&
          vapidPublicKey &&
          typeof window !== "undefined" &&
          window.Notification?.permission === "granted"
        ) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes(vapidPublicKey),
          });
        }
        const serialized = subscription?.toJSON?.();
        if (
          serialized?.endpoint &&
          serialized?.keys?.p256dh &&
          serialized?.keys?.auth
        ) {
          const rpcRes = await client.rpc("register_spend_push_device", {
            p_device_id: deviceId,
            p_endpoint: serialized.endpoint,
            p_subscription: serialized,
          });
          if (!rpcRes.error) {
            deviceSynced = true;
          } else {
            await client
              .from("push_devices")
              .delete()
              .eq("endpoint", serialized.endpoint)
              .neq("user_id", userId);
            const { error: upsertDevError } = await client
              .from("push_devices")
              .upsert(
                {
                  user_id: userId,
                  device_id: deviceId,
                  endpoint: serialized.endpoint,
                  subscription: serialized,
                },
                { onConflict: "user_id,device_id" },
              );
            if (!upsertDevError) {
              deviceSynced = true;
            }
          }
        }
      }
    } catch {
      // Check existing push_devices row below if subscription check fails
    }
  }

  if (!deviceSynced) {
    const { data: existingDevice, error: devCheckErr } = await client
      .from("push_devices")
      .select("device_id")
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .maybeSingle();
    if (devCheckErr || !existingDevice) {
      return;
    }
    deviceSynced = true;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = localDate(now);
  const todayNotifyAt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
  );
  const isTodayReminderInFuture = todayNotifyAt.getTime() > nowMs;

  let dailyAlreadyFiredForThisTime = false;
  try {
    dailyAlreadyFiredForThisTime =
      localStorage.getItem("spend-last-daily-reminder-date-v1") ===
      `${todayStr}:${reminderTime}`;
  } catch {}

  const reminders = [];

  // 1 & 2. Recurring expense due-day + 1-day-before heads-up reminders
  for (const schedule of schedules) {
    if (!schedule?.id || !schedule?.nextDate) continue;
    const interval = schedule.interval === "weekly" ? "weekly" : "monthly";
    const dayOfMonth = clampDayOfMonth(
      schedule.dayOfMonth || Number(schedule.nextDate.slice(-2)),
    );

    // If an expense for this recurring schedule was generated today AND today's reminderTime is still in the future,
    // allow today's reminder to fire at reminderTime rather than skipping to next month/week.
    const generatedToday = expenses.some(
      (e) =>
        (e?.recurringId === schedule.id || e?.recId === schedule.id) &&
        e?.date === todayStr,
    );

    let targetDate =
      generatedToday && isTodayReminderInFuture ? todayStr : schedule.nextDate;
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
      (candidateDate.getTime() <= nowMs || dailyAlreadyFiredForThisTime)
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

  // Fetch existing rows first so we can delete any row whose next_date or reminder_time changed
  // (bypassing any BEFORE UPDATE trigger restrictions and clearing stale claims)
  const { data: existing, error: loadError } = await client
    .from("push_reminders")
    .select(
      "schedule_id, next_date, next_notify_at, reminder_time, pending_notification",
    )
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (loadError) throw loadError;

  const currentIds = new Set(reminders.map(({ schedule_id }) => schedule_id));

  const idsToReset = [];
  for (const row of existing ?? []) {
    if (!currentIds.has(row.schedule_id)) {
      idsToReset.push(row.schedule_id);
      continue;
    }
    const nextRow = reminders.find((r) => r.schedule_id === row.schedule_id);
    if (
      nextRow &&
      (nextRow.next_date !== row.next_date ||
        nextRow.reminder_time !== row.reminder_time ||
        row.pending_notification)
    ) {
      idsToReset.push(row.schedule_id);
    }
  }

  if (idsToReset.length > 0) {
    const { error: delError } = await client
      .from("push_reminders")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .in("schedule_id", idsToReset);
    if (delError) throw delError;
  }

  if (reminders.length) {
    const { error } = await client
      .from("push_reminders")
      .upsert(reminders, { onConflict: "user_id,device_id,schedule_id" });
    if (error) throw error;
  }
}
