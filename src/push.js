import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const pushBackendConfigured = Boolean(
  supabaseConfigured && vapidPublicKey,
);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

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
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(
    (value + padding).replaceAll("-", "+").replaceAll("_", "/"),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function enableBackgroundPush(userId) {
  if (!supabase || !vapidPublicKey) {
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

  const { error } = await supabase.from("push_devices").upsert(
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
  if (!supabase) throw new Error("Background push has not been configured.");
  const deviceId = getDeviceId();
  const { error: remindersError } = await supabase
    .from("push_reminders")
    .delete()
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (remindersError) throw remindersError;
  const { error: deviceError } = await supabase
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
}

export async function syncBackgroundSchedules(userId, schedules, reminderTime) {
  if (!supabase) throw new Error("Background push has not been configured.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
    throw new Error("Choose a valid reminder time.");
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const deviceId = getDeviceId();
  const [hours, minutes] = reminderTime.split(":").map(Number);
  const reminders = schedules.map((schedule) => {
    const [year, month, day] = schedule.nextDate.split("-").map(Number);
    return {
      user_id: userId,
      device_id: deviceId,
      schedule_id: schedule.id,
      description: schedule.description,
      interval: schedule.interval,
      day_of_month: schedule.dayOfMonth,
      next_date: schedule.nextDate,
      next_notify_at: new Date(
        year,
        month - 1,
        day,
        hours,
        minutes,
      ).toISOString(),
      timezone,
      reminder_time: reminderTime,
      active: schedule.active,
    };
  });

  if (reminders.length) {
    const { error } = await supabase
      .from("push_reminders")
      .upsert(reminders, { onConflict: "user_id,device_id,schedule_id" });
    if (error) throw error;
  }

  const { data: existing, error: loadError } = await supabase
    .from("push_reminders")
    .select("schedule_id")
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  if (loadError) throw loadError;

  const currentIds = new Set(reminders.map(({ schedule_id }) => schedule_id));
  for (const reminder of existing ?? []) {
    if (currentIds.has(reminder.schedule_id)) continue;
    const { error } = await supabase
      .from("push_reminders")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .eq("schedule_id", reminder.schedule_id);
    if (error) throw error;
  }
}
