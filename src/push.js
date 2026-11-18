import {
  addDaysToDateString,
  clampDayOfMonth,
  cleanEnv,
  localDate,
  nextOccurrenceDate,
} from "./data.js";
import { setLiveSupabaseSessionToken } from "./cloud-sync.js";
import { getWeeklySpendSummary } from "./notifications.js";

const supabaseUrl = cleanEnv(import.meta.env?.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnv(import.meta.env?.VITE_SUPABASE_ANON_KEY);
export const vapidPublicKey = cleanEnv(import.meta.env?.VITE_VAPID_PUBLIC_KEY);

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const pushBackendConfigured = Boolean(
  supabaseConfigured && vapidPublicKey,
);

export const PUSH_DISABLED_BY_USER_KEY = "spend-push-disabled-by-user-v1";
export const PUSH_DEVICE_ID_KEY = "spend-push-device-id-v1";
export const DAILY_SCHEDULE_PREFIX = "__daily_";
export const WEEKLY_SUMMARY_SCHEDULE_ID = "__weekly_summary__";
export const MONTHLY_OVERVIEW_SCHEDULE_ID = "__monthly_overview__";
export const HEADS_UP_SCHEDULE_PREFIX = "heads-up:";

export let supabase = null;
let supabaseInitPromise = null;
let registerPushRpcUnavailable = false;

const FALLBACK_RPC_CODES = new Set([
  "42883", // undefined_function
  "PGRST202", // function not found in PostgREST schema cache
  "42703", // undefined_column
  "42804", // datatype_mismatch
]);

async function upsertPushDeviceWithFallback(
  client,
  { userId, deviceId, endpoint, subscription },
) {
  if (!registerPushRpcUnavailable) {
    const rpcRes = await client.rpc("register_spend_push_device", {
      p_device_id: deviceId,
      p_endpoint: endpoint,
      p_subscription: subscription,
    });
    if (!rpcRes.error) {
      return;
    }
    if (FALLBACK_RPC_CODES.has(rpcRes.error.code)) {
      registerPushRpcUnavailable = true;
    } else {
      throw rpcRes.error;
    }
  }

  await client
    .from("push_devices")
    .delete()
    .eq("endpoint", endpoint)
    .neq("user_id", userId);

  const { error } = await client.from("push_devices").upsert(
    {
      user_id: userId,
      device_id: deviceId,
      endpoint,
      subscription,
    },
    { onConflict: "user_id,device_id" },
  );
  if (error) throw error;
}

export async function getSupabase() {
  if (!supabaseConfigured) return null;
  if (supabase) return supabase;
  if (!supabaseInitPromise) {
    supabaseInitPromise = import("@supabase/supabase-js").then(
      ({ createClient }) => {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        supabase.auth
          .getSession()
          .then(({ data }) => {
            const session = data?.session;
            setLiveSupabaseSessionToken(
              session?.access_token || "",
              session?.expires_at || 0,
            );
          })
          .catch(() => {});
        supabase.auth.onAuthStateChange((_event, session) => {
          setLiveSupabaseSessionToken(
            session?.access_token || "",
            session?.expires_at || 0,
          );
        });
        return supabase;
      },
    );
  }
  return supabaseInitPromise;
}

function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(PUSH_DEVICE_ID_KEY);
  } catch {
    id = null;
  }
  if (!id) {
    id = globalThis.crypto?.randomUUID?.();
    if (!id) throw new Error("This browser cannot create a secure device ID.");
    try {
      localStorage.setItem(PUSH_DEVICE_ID_KEY, id);
    } catch {
      // Return volatile UUID if storage is restricted
    }
  }
  return id;
}

function vapidKeyBytes(value) {
  const clean = cleanEnv(value);
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const decoded = atob(
    (clean + padding).replaceAll("-", "+").replaceAll("_", "/"),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function getActiveServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) =>
        setTimeout(() => resolve(existing || null), 4000),
      ),
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

  const deviceId = getDeviceId();
  await upsertPushDeviceWithFallback(client, {
    userId,
    deviceId,
    endpoint: serialized.endpoint,
    subscription: serialized,
  });
  try {
    localStorage.removeItem(PUSH_DISABLED_BY_USER_KEY);
  } catch {
    // ignore storage errors
  }
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
    localStorage.removeItem(PUSH_DEVICE_ID_KEY);
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
          await upsertPushDeviceWithFallback(client, {
            userId,
            deviceId,
            endpoint: serialized.endpoint,
            subscription: serialized,
          });
          deviceSynced = true;
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
  } catch {
    dailyAlreadyFiredForThisTime = false;
  }

  const reminders = [];

  // 1 & 2. Recurring expense due-day + 1-day-before heads-up reminders
  for (const schedule of schedules) {
    if (!schedule?.id || !schedule?.nextDate) continue;
    const interval = schedule.interval === "weekly" ? "weekly" : "monthly";
    const anchorDayOfMonth = clampDayOfMonth(
      schedule.dayOfMonth || Number(schedule.nextDate.slice(-2)),
    );

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
      targetDate = nextOccurrenceDate(targetDate, interval, anchorDayOfMonth);
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
      day_of_month: anchorDayOfMonth,
      next_date: targetDate,
      next_notify_at: notifyDate.toISOString(),
      timezone,
      reminder_time: reminderTime,
      active: Boolean(schedule.active),
    });

    // 1-day-before heads-up reminder (always anchored to billOccDate - 1 day so dayOfMonth=31 never oscillates)
    let billOccDate = schedule.nextDate;
    let headsUpDate = addDaysToDateString(billOccDate, -1);
    let [hy, hm, hd] = headsUpDate.split("-").map(Number);
    let headsUpNotify = new Date(hy, hm - 1, hd, hours, minutes);
    let headsUpGuard = 0;
    while (headsUpNotify.getTime() <= nowMs && headsUpGuard < 240) {
      billOccDate = nextOccurrenceDate(billOccDate, interval, anchorDayOfMonth);
      headsUpDate = addDaysToDateString(billOccDate, -1);
      [hy, hm, hd] = headsUpDate.split("-").map(Number);
      headsUpNotify = new Date(hy, hm - 1, hd, hours, minutes);
      headsUpGuard += 1;
    }

    reminders.push({
      user_id: userId,
      device_id: deviceId,
      schedule_id: `${HEADS_UP_SCHEDULE_PREFIX}${schedule.id}`,
      description: String(schedule.description || "Recurring expense").slice(
        0,
        80,
      ),
      interval,
      day_of_month: anchorDayOfMonth,
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
      schedule_id: `${DAILY_SCHEDULE_PREFIX}${dow}__`,
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
    schedule_id: WEEKLY_SUMMARY_SCHEDULE_ID,
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
    schedule_id: MONTHLY_OVERVIEW_SCHEDULE_ID,
    description: "Previous month's spend overview",
    interval: "monthly",
    day_of_month: 1,
    next_date: firstOfMonthStr,
    next_notify_at: firstOfMonthNotify.toISOString(),
    timezone,
    reminder_time: reminderTime,
    active: true,
  });

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

export async function sendCrossDeviceActivityPush(payload) {
  if (!supabaseConfigured || !payload?.title || !payload?.body) return false;
  try {
    const client = await getSupabase();
    if (!client) return false;
    const { data } = await client.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (!accessToken) return false;
    let excludeDeviceId = "";
    try {
      excludeDeviceId = getDeviceId();
    } catch {
      excludeDeviceId = "";
    }
    const { error } = await client.functions.invoke("send-activity-push", {
      body: {
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        tab: payload.tab || "activity",
        tone: payload.tone || "reminder",
        excludeDeviceId,
      },
    });
    return !error;
  } catch {
    return false;
  }
}
