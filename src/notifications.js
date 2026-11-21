import {
  addDaysToDateString,
  formatDate,
  fromPoisha,
  isCashCard,
  isMfsCard,
  isSavingsCard,
  localDate,
  nextOccurrenceDate,
  toPoisha,
} from "./data.js";

const LAST_NOTIFIED_MONTH_KEY = "spend-notified-month-v2";
const WELCOME_NOTIFIED_PREFIX = "spend-welcome-notified-v2-";
const HEADS_UP_NOTIFIED_KEY = "spend-notified-heads-up-v1";
const LAST_WEEKLY_SUMMARY_KEY = "spend-last-weekly-summary-v1";
const ACTIVITY_NOTIFIED_KEY = "spend-notified-activity-v1";
const activityNotifiedMemory = new Set();

// Distinct ID ranges so scheduled background notifications ([20002, 899999999])
// never collide with or cancel immediate/foreground notifications ([900000000, 1999999999]).
export const SCHEDULED_NOTIF_ID_MIN = 20002;
export const SCHEDULED_NOTIF_ID_MAX = 899999999;
export const IMMEDIATE_NOTIF_ID_MIN = 900000000;
export const IMMEDIATE_NOTIF_ID_MAX = 1999999999;

let channelsConfigured = false;

function isNativePlatform() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.Capacitor?.isNativePlatform?.())
  );
}

async function getLocalNotifications() {
  if (!isNativePlatform()) return null;
  const mod = await import("@capacitor/local-notifications");
  return mod.LocalNotifications;
}

async function getNativeHaptics() {
  if (!isNativePlatform()) return null;
  return import("@capacitor/haptics");
}

function formatTaka(amount) {
  const num = Number(amount) || 0;
  return `৳${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function getWeeklySpendSummary(expenses = [], now = new Date()) {
  const todayStr = localDate(now);
  const weekStartStr = addDaysToDateString(todayStr, -6);
  let totalPoisha = 0;
  let count = 0;
  for (const exp of expenses) {
    if (!exp || exp.category === "Savings" || exp.cat === "Savings") continue;
    const d = exp.date || "";
    const amt = Number(exp.amount ?? exp.amt);
    if (d >= weekStartStr && d <= todayStr && Number.isFinite(amt) && amt > 0) {
      totalPoisha += toPoisha(amt);
      count += 1;
    }
  }
  return {
    total: fromPoisha(totalPoisha),
    count,
    weekStartStr,
    todayStr,
  };
}

let sharedAudioCtx = null;
let audioUnlocked = false;
let pendingBlockedTone = null;
let pendingBlockedToneAt = 0;

function getSharedAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContextClass();
  }
  return sharedAudioCtx;
}

function resolveSoundUrl(tone) {
  const base = import.meta.env?.BASE_URL || "./";
  const fileName =
    tone === "welcome" ? "sounds/welcome.wav" : "sounds/reminder.wav";
  if (typeof window !== "undefined") {
    const originBase = base.startsWith("/")
      ? window.location.origin
      : window.location.href;
    return new URL(`${base}${fileName}`, originBase).href;
  }
  return `./${fileName}`;
}

function isIosWebKitAudio() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform =
    navigator.userAgentData?.platform || navigator.platform || "";
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    /iPhone|iPad|iPod/i.test(platform) ||
    (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)
  );
}

function setupAudioUnlock() {
  if (typeof window === "undefined" || audioUnlocked) return;
  const unlock = () => {
    if (
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.isActive &&
      !navigator.userActivation.hasBeenActive
    ) {
      return;
    }
    audioUnlocked = true;
    const ctx = getSharedAudioContext();
    if (ctx) {
      const playSilentBuffer = () => {
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
        } catch {
          // ignore
        }
      };

      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        ctx
          .resume()
          .then(() => {
            if (isIosWebKitAudio() && ctx.state === "running") {
              playSilentBuffer();
            }
          })
          .catch(() => {});
      } else if (isIosWebKitAudio() && ctx.state === "running") {
        playSilentBuffer();
      }
    }
    if (pendingBlockedTone && Date.now() - pendingBlockedToneAt < 15000) {
      const toneToPlay = pendingBlockedTone;
      pendingBlockedTone = null;
      pendingBlockedToneAt = 0;
      playNotificationAudioTone(toneToPlay);
    }
    window.removeEventListener("touchend", unlock, true);
    window.removeEventListener("click", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("touchend", unlock, { capture: true, passive: true });
  window.addEventListener("click", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

if (typeof window !== "undefined") {
  setupAudioUnlock();
}

async function synthesizeAudioTone(tone = "reminder") {
  if (!audioUnlocked) return false;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }
    if (ctx.state !== "running") return false;

    const now = ctx.currentTime;
    if (tone === "welcome") {
      const notes = [
        { freq: 523.25, start: 0, dur: 0.14, gainVal: 0.35 },
        { freq: 659.25, start: 0.13, dur: 0.14, gainVal: 0.38 },
        { freq: 783.99, start: 0.26, dur: 0.46, gainVal: 0.42 },
      ];
      notes.forEach(({ freq, start, dur, gainVal }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.001, now + start);
        gain.gain.exponentialRampToValueAtTime(gainVal, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur);
      });
    } else {
      const notes = [
        { freq: 440.0, start: 0, dur: 0.16, gainVal: 0.3 },
        { freq: 659.25, start: 0.14, dur: 0.44, gainVal: 0.36 },
      ];
      notes.forEach(({ freq, start, dur, gainVal }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.001, now + start);
        gain.gain.exponentialRampToValueAtTime(gainVal, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur);
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function playNotificationAudioTone(tone = "reminder") {
  if (isNativePlatform()) {
    void getNativeHaptics()
      .then((mod) => {
        if (!mod) return;
        const { Haptics, NotificationType } = mod;
        if (tone === "welcome") {
          return Haptics.notification({ type: NotificationType.Success });
        }
        return Haptics.notification({ type: NotificationType.Warning });
      })
      .catch(() => {});
  }

  if (!audioUnlocked) {
    pendingBlockedTone = tone;
    pendingBlockedToneAt = Date.now();
    return;
  }

  const soundUrl = resolveSoundUrl(tone);
  try {
    const audio = new Audio(soundUrl);
    audio.volume = 0.75;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(async () => {
        const played = await synthesizeAudioTone(tone);
        if (!played && !audioUnlocked) {
          pendingBlockedTone = tone;
          pendingBlockedToneAt = Date.now();
        }
      });
    }
  } catch {
    void synthesizeAudioTone(tone).then((played) => {
      if (!played && !audioUnlocked) {
        pendingBlockedTone = tone;
        pendingBlockedToneAt = Date.now();
      }
    });
  }
}

export async function setupNativeNotificationChannels() {
  if (!isNativePlatform() || channelsConfigured) return;
  try {
    const LocalNotifications = await getLocalNotifications();
    if (!LocalNotifications) return;
    await LocalNotifications.createChannel({
      id: "spend_reminders",
      name: "Spend Reminders",
      description:
        "Daily expense reminders, upcoming bill alerts, and weekly recaps",
      importance: 4,
      sound: "reminder.wav",
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: "spend_welcome",
      name: "Spend Welcome",
      description:
        "Welcome notification when signing in with unique celebratory tone",
      importance: 4,
      sound: "welcome.wav",
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: "spend_monthly",
      name: "Monthly Expense Tracking",
      description:
        "Reminders to review your monthly overview when a new month begins",
      importance: 4,
      sound: "reminder.wav",
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: "spend_activity",
      name: "Activity Alerts",
      description:
        "Instant alerts when transactions, expenses, or cards are added",
      importance: 4,
      sound: "reminder.wav",
      vibration: true,
      visibility: 1,
    });
    channelsConfigured = true;
  } catch {
    // Non-Android platforms ignore createChannel
  }
}

export async function checkNotificationPermission() {
  if (isNativePlatform()) {
    try {
      const LocalNotifications = await getLocalNotifications();
      if (!LocalNotifications) return "denied";
      const { display } = await LocalNotifications.checkPermissions();
      return display;
    } catch {
      return "denied";
    }
  }
  if (typeof window !== "undefined" && "Notification" in window) {
    return window.Notification.permission;
  }
  return "unsupported";
}

export async function requestNotificationPermission() {
  if (isNativePlatform()) {
    try {
      await setupNativeNotificationChannels();
      const LocalNotifications = await getLocalNotifications();
      if (!LocalNotifications) return false;
      const { display } = await LocalNotifications.requestPermissions();
      return display === "granted";
    } catch {
      return false;
    }
  }
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    typeof window.Notification?.requestPermission === "function"
  ) {
    try {
      const result = await new Promise((resolve, reject) => {
        const maybePromise = window.Notification.requestPermission(resolve);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve, reject);
        }
      });
      return result === "granted";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Generates a collision-resistant 32-bit integer notification ID within [min, max]
 * using FNV-1a + MurmurHash3 finalizer avalanche mixing.
 * Defaults to [900000000, 1999999999] so immediate notifications never overlap
 * the scheduled background cancellation range [20002, 899999999].
 */
export function hashNotificationId(
  str,
  min = IMMEDIATE_NOTIF_ID_MIN,
  max = IMMEDIATE_NOTIF_ID_MAX,
) {
  const input = String(str || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // MurmurHash3 32-bit avalanche finalizer
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  const unsigned = h >>> 0;
  const span = Math.max(1, max - min);
  return min + (unsigned % span);
}

export async function sendNativeBuiltinNotification({
  title,
  body,
  tag,
  tab = "activity",
  tone = "reminder",
  channelId: explicitChannelId,
  id,
  scheduleAt,
}) {
  const notifId =
    typeof id === "number"
      ? id
      : hashNotificationId(
          tag || `${title}-${Date.now()}`,
          IMMEDIATE_NOTIF_ID_MIN,
          IMMEDIATE_NOTIF_ID_MAX,
        );

  if (!scheduleAt) {
    playNotificationAudioTone(tone);
  }

  if (isNativePlatform()) {
    try {
      await setupNativeNotificationChannels();
      const LocalNotifications = await getLocalNotifications();
      if (LocalNotifications) {
        const channelId =
          explicitChannelId ||
          (tone === "welcome"
            ? "spend_welcome"
            : tag && tag.startsWith("spend-activity-")
              ? "spend_activity"
              : tag && tag.includes("month")
                ? "spend_monthly"
                : "spend_reminders");

        const sound = tone === "welcome" ? "welcome.wav" : "reminder.wav";

        await LocalNotifications.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              channelId,
              sound,
              foreground: true,
              schedule: scheduleAt ? { at: scheduleAt } : undefined,
              extra: { tab, tag, tone },
            },
          ],
        });
        return true;
      }
    } catch (err) {
      console.warn("Native notification dispatch failed:", err);
    }
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    if (window.Notification.permission !== "granted") {
      return false;
    }

    const base = import.meta.env?.BASE_URL || "./";
    const originBase = base.startsWith("/")
      ? window.location.origin
      : window.location.href;
    const iconHref = new URL(`${base}icons/icon-192.png`, originBase).href;
    const badgeHref = new URL(`${base}icons/badge-96.png`, originBase).href;
    const options = {
      body,
      icon: iconHref,
      badge: badgeHref,
      tag: tag || `spend-${notifId}`,
      renotify: true,
      vibrate: tone === "welcome" ? [120, 60, 120, 60, 240] : [200, 100, 200],
      data: {
        url: `${window.location.origin}${window.location.pathname}?tab=${encodeURIComponent(tab)}`,
        tab,
        tone,
      },
    };

    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, options);
          return true;
        }
      } catch {
        // Fall through to window.Notification
      }
    }

    try {
      new window.Notification(title, options);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function syncNativeScheduledNotifications({
  recurringSchedules = [],
  expenses = [],
  reminderTime = "09:00",
} = {}) {
  const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)
    ? reminderTime
    : "09:00";
  const [hours, minutes] = safeTime.split(":").map(Number);
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
      `${todayStr}:${safeTime}`;
  } catch {
    dailyAlreadyFiredForThisTime = false;
  }

  const notifications = [];
  const usedIds = new Set();
  const allocateUniqueScheduledId = (candidateId, minRange, maxRange) => {
    let resolved = candidateId;
    let probe = 1;
    while (usedIds.has(resolved)) {
      resolved =
        minRange + ((resolved - minRange + probe) % (maxRange - minRange));
      probe += 1;
    }
    usedIds.add(resolved);
    return resolved;
  };

  // 1. 1st-of-the-month spend overview (next 2 months)
  for (let mOffset = 0; mOffset <= 2; mOffset += 1) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth() + mOffset,
      1,
      hours,
      minutes,
      0,
    );
    if (candidate.getTime() > nowMs + 2000) {
      const id = allocateUniqueScheduledId(20002 + mOffset, 20002, 20999);
      notifications.push({
        id,
        title: "Previous month's spend overview is ready",
        body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
        channelId: "spend_monthly",
        sound: "reminder.wav",
        foreground: true,
        schedule: { at: candidate, allowWhileIdle: true },
        extra: {
          tab: "home",
          tag: `spend-new-month-${localDate(candidate).slice(0, 7)}`,
          tone: "reminder",
        },
      });
    }
  }

  // 2. Weekly spending summary (next 4 Sundays at reminderTime)
  const weeklyStats = getWeeklySpendSummary(expenses, now);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  for (let w = 0; w < 4; w += 1) {
    const sundayOffset = daysUntilSunday + w * 7;
    const sundayDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + sundayOffset,
      hours,
      minutes,
      0,
    );
    if (sundayDate.getTime() <= nowMs + 2000) continue;
    const isThisWeekSunday = w === 0 && sundayOffset <= 7;
    const body =
      isThisWeekSunday && weeklyStats.count > 0
        ? `You've tracked ${formatTaka(weeklyStats.total)} across ${weeklyStats.count} ${weeklyStats.count === 1 ? "expense" : "expenses"} this week. Open Spend to review your weekly pace.`
        : "Your weekly spending recap is ready. Open Spend to review this week's activity and budget pace.";

    const id = allocateUniqueScheduledId(21001 + w, 21001, 21999);
    notifications.push({
      id,
      title: "Weekly spending summary",
      body,
      channelId: "spend_reminders",
      sound: "reminder.wav",
      foreground: true,
      schedule: { at: sundayDate, allowWhileIdle: true },
      extra: {
        tab: "activity",
        tag: `spend-weekly-${localDate(sundayDate)}`,
        tone: "reminder",
      },
    });
  }

  // 3. Daily expense tracking reminders (next 14 days at reminderTime)
  for (let dOffset = 0; dOffset < 14; dOffset += 1) {
    if (dOffset === 0 && dailyAlreadyFiredForThisTime) continue;
    const targetDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dOffset,
      hours,
      minutes,
      0,
    );
    if (targetDay.getTime() <= nowMs + 2000) continue;
    const dateStr = localDate(targetDay);
    const id = allocateUniqueScheduledId(30001 + dOffset, 30001, 30999);
    notifications.push({
      id,
      title: "Daily expense reminder",
      body: "Don’t forget to track today's expenses to keep your budget on target.",
      channelId: "spend_reminders",
      sound: "reminder.wav",
      foreground: true,
      schedule: { at: targetDay, allowWhileIdle: true },
      extra: {
        tab: "home",
        tag: `spend-daily-${dateStr}`,
        tone: "reminder",
      },
    });
  }

  // 4 & 5. Recurring expenses due-day + 1-day-before heads-up reminders
  for (const schedule of recurringSchedules) {
    if (!schedule || !schedule.active || !schedule.nextDate) continue;
    const generatedToday = expenses.some(
      (e) =>
        (e?.recurringId === schedule.id || e?.recId === schedule.id) &&
        e?.date === todayStr,
    );
    let occDate =
      generatedToday && isTodayReminderInFuture ? todayStr : schedule.nextDate;
    let guard = 0;
    let scheduledOccurrences = 0;
    const amtText =
      Number.isFinite(Number(schedule.amount)) && Number(schedule.amount) > 0
        ? ` (${formatTaka(schedule.amount)})`
        : "";

    while (scheduledOccurrences < 2 && guard < 240) {
      const [y, m, d] = occDate.split("-").map(Number);
      const dueAt = new Date(y, m - 1, d, hours, minutes, 0);
      const headsUpDateStr = addDaysToDateString(occDate, -1);
      const [hy, hm, hd] = headsUpDateStr.split("-").map(Number);
      const headsUpAt = new Date(hy, hm - 1, hd, hours, minutes, 0);

      if (headsUpAt.getTime() > nowMs + 2000) {
        const rawHeadsUpId = hashNotificationId(
          `heads-up:${schedule.id}:${occDate}`,
          40000,
          499999999,
        );
        const headsUpId = allocateUniqueScheduledId(
          rawHeadsUpId,
          40000,
          499999999,
        );
        notifications.push({
          id: headsUpId,
          title: "Upcoming bill tomorrow",
          body: `${schedule.description}${amtText} is due tomorrow (${formatDate(occDate)}).`,
          channelId: "spend_reminders",
          sound: "reminder.wav",
          foreground: true,
          schedule: { at: headsUpAt, allowWhileIdle: true },
          extra: {
            tab: "plans",
            tag: `heads-up:${schedule.id}:${headsUpDateStr}`,
            tone: "reminder",
          },
        });
      }

      if (dueAt.getTime() > nowMs + 2000) {
        const rawDueId = hashNotificationId(
          `due:${schedule.id}:${occDate}`,
          500000000,
          SCHEDULED_NOTIF_ID_MAX,
        );
        const dueId = allocateUniqueScheduledId(
          rawDueId,
          500000000,
          SCHEDULED_NOTIF_ID_MAX,
        );
        notifications.push({
          id: dueId,
          title: "Recurring expense due",
          body: `${schedule.description}${amtText} is due today.`,
          channelId: "spend_reminders",
          sound: "reminder.wav",
          foreground: true,
          schedule: { at: dueAt, allowWhileIdle: true },
          extra: {
            tab: "activity",
            tag: `${schedule.id}:${occDate}`,
            tone: "reminder",
          },
        });
        scheduledOccurrences += 1;
      }

      occDate = nextOccurrenceDate(
        occDate,
        schedule.interval,
        schedule.dayOfMonth,
      );
      guard += 1;
    }
  }

  if (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    window.Notification.permission === "granted"
  ) {
    // Android Chrome kills idle Service Workers after ~30–60s, so 24h in-memory
    // setTimeout timers never survive screen lock (closed-app WebAPK delivery is
    // handled by Supabase Web Push in src/push.js). Cap SW timers to imminent
    // foreground reminders on Android browsers while leaving iOS/desktop intact.
    const isAndroidWeb =
      !isNativePlatform() &&
      (document.documentElement?.dataset?.platform === "android" ||
        /Android/i.test(navigator.userAgent || ""));
    const maxSwTimerWindowMs = isAndroidWeb ? 60 * 1000 : 24 * 60 * 60 * 1000;

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        const sw = reg?.active || navigator.serviceWorker.controller;
        if (!sw) return;
        const upcoming = notifications
          .filter((n) => {
            const atMs = n.schedule?.at?.getTime?.() || 0;
            return atMs > nowMs && atMs - nowMs <= maxSwTimerWindowMs;
          })
          .map((n) => ({
            title: n.title,
            body: n.body,
            tag: n.extra?.tag || `spend-${n.id}`,
            tab: n.extra?.tab || "home",
            url: `./?tab=${encodeURIComponent(n.extra?.tab || "home")}`,
            fireAt: n.schedule.at.getTime(),
          }));
        sw.postMessage({
          type: "SYNC_SCHEDULED_NOTIFICATIONS",
          items: upcoming,
        });
      })
      .catch(() => {});
  }

  if (!isNativePlatform()) return true;

  try {
    const LocalNotifications = await getLocalNotifications();
    if (!LocalNotifications) return false;
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return false;

    await setupNativeNotificationChannels();

    // Only cancel scheduled background notifications ([20002, 899999999]),
    // leaving immediate notifications (>= 900000000) untouched.
    try {
      const pending = await LocalNotifications.getPending();
      const toCancel = (pending?.notifications || []).filter((n) => {
        const numId = Number(n.id);
        return (
          Number.isFinite(numId) &&
          numId >= SCHEDULED_NOTIF_ID_MIN &&
          numId <= SCHEDULED_NOTIF_ID_MAX
        );
      });
      if (toCancel.length > 0) {
        await LocalNotifications.cancel({
          notifications: toCancel.map((n) => ({ id: Number(n.id) })),
        });
      }
    } catch {
      // ignore cancellation query failure
    }

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
    return true;
  } catch (err) {
    console.warn("Could not sync native scheduled notifications:", err);
    return false;
  }
}

export async function checkAndNotifyNewMonth(currentMonthStr) {
  const now = new Date();
  const thisMonth =
    currentMonthStr ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let lastNotifiedMonth = "";
  try {
    lastNotifiedMonth = localStorage.getItem(LAST_NOTIFIED_MONTH_KEY) || "";
  } catch {
    lastNotifiedMonth = "";
  }

  const shouldNotify = !lastNotifiedMonth
    ? now.getDate() <= 7
    : lastNotifiedMonth < thisMonth;

  if (shouldNotify) {
    try {
      localStorage.setItem(LAST_NOTIFIED_MONTH_KEY, thisMonth);
    } catch {
      // ignore
    }

    await sendNativeBuiltinNotification({
      id: 900020001,
      title: "Previous month's spend overview is ready",
      body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
      tag: `spend-new-month-${thisMonth}`,
      tab: "home",
      tone: "reminder",
    });
  } else if (!lastNotifiedMonth) {
    try {
      localStorage.setItem(LAST_NOTIFIED_MONTH_KEY, thisMonth);
    } catch {
      // ignore
    }
  }
}

export async function checkAndNotifyUpcomingBills(
  recurringSchedules = [],
  reminderTime = "09:00",
) {
  const now = new Date();
  const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (currentTimeStr < reminderTime) return;

  const tomorrowStr = addDaysToDateString(localDate(now), 1);
  let notifiedSet = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(HEADS_UP_NOTIFIED_KEY) || "[]");
    if (Array.isArray(raw)) notifiedSet = new Set(raw);
  } catch {
    notifiedSet = new Set();
  }

  const dueTomorrow = (recurringSchedules || []).filter(
    (s) =>
      s &&
      s.active &&
      s.nextDate === tomorrowStr &&
      !notifiedSet.has(`${s.id}:${tomorrowStr}`),
  );
  if (!dueTomorrow.length) return;

  for (const s of dueTomorrow) {
    notifiedSet.add(`${s.id}:${tomorrowStr}`);
  }
  try {
    localStorage.setItem(
      HEADS_UP_NOTIFIED_KEY,
      JSON.stringify([...notifiedSet].slice(-100)),
    );
  } catch {
    // ignore
  }

  const title =
    dueTomorrow.length === 1
      ? "Upcoming bill tomorrow"
      : `${dueTomorrow.length} upcoming bills tomorrow`;
  const body =
    dueTomorrow.length === 1
      ? `${dueTomorrow[0].description} (${formatTaka(dueTomorrow[0].amount)}) is due tomorrow.`
      : `Due tomorrow: ${dueTomorrow.map((s) => `${s.description} (${formatTaka(s.amount)})`).join(", ")}.`;

  await sendNativeBuiltinNotification({
    title,
    body,
    tag: `heads-up:${dueTomorrow[0].id}:${localDate(now)}`,
    tab: "plans",
    tone: "reminder",
  });
}

export async function checkAndNotifyWeeklySummary(
  expenses = [],
  reminderTime = "09:00",
) {
  const now = new Date();
  if (now.getDay() !== 0) return; // Sundays only
  const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (currentTimeStr < reminderTime) return;

  const todayStr = localDate(now);
  const stamp = `${todayStr}:${reminderTime}`;
  try {
    if (localStorage.getItem(LAST_WEEKLY_SUMMARY_KEY) === stamp) return;
  } catch {
    // ignore
  }

  const summary = getWeeklySpendSummary(expenses, now);
  if (summary.count === 0) return;

  try {
    localStorage.setItem(LAST_WEEKLY_SUMMARY_KEY, stamp);
  } catch {
    // ignore
  }

  await sendNativeBuiltinNotification({
    title: "Weekly spending summary",
    body: `You've tracked ${formatTaka(summary.total)} across ${summary.count} ${summary.count === 1 ? "expense" : "expenses"} over the last 7 days.`,
    tag: `spend-weekly-${todayStr}`,
    tab: "activity",
    tone: "reminder",
  });
}

export async function notifyNewUserSignedIn(user) {
  if (!user || !user.id) return;
  const key = `${WELCOME_NOTIFIED_PREFIX}${user.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "true");
  } catch {
    // ignore
  }

  const metadata = user.user_metadata || {};
  const rawName =
    metadata.full_name ||
    metadata.name ||
    metadata.first_name ||
    (user.email ? user.email.split("@")[0] : "");
  const displayName = rawName
    ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
    : "";
  const greeting = displayName ? `, ${displayName}` : "";

  await sendNativeBuiltinNotification({
    id: 900010001,
    title: "Welcome to Spend! Start tracking",
    body: `Welcome to Spend${greeting}! Start your expense tracking with Spend and take control of your financial journey.`,
    tag: `spend-welcome-${user.id}`,
    tab: "home",
    tone: "welcome",
  });
}

function hasActivityBeenNotified(tag) {
  if (!tag) return false;
  if (activityNotifiedMemory.has(tag)) return true;
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVITY_NOTIFIED_KEY) || "[]");
    if (Array.isArray(raw) && raw.includes(tag)) {
      activityNotifiedMemory.add(tag);
      return true;
    }
  } catch {
    // ignore storage errors
  }
  return false;
}

function markActivityNotified(tag) {
  if (!tag) return;
  activityNotifiedMemory.add(tag);
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVITY_NOTIFIED_KEY) || "[]");
    const list = Array.isArray(raw) ? raw.filter((item) => item !== tag) : [];
    list.push(tag);
    localStorage.setItem(
      ACTIVITY_NOTIFIED_KEY,
      JSON.stringify(list.slice(-200)),
    );
  } catch {
    // ignore storage errors
  }
}

function resolveAccountLabel(accountId, cards = []) {
  if (!accountId || accountId === "cash") return "Cash";
  const match = Array.isArray(cards)
    ? cards.find((c) => c?.id === accountId)
    : null;
  if (match?.name && String(match.name).trim()) {
    return String(match.name).trim();
  }
  return String(accountId);
}

export function buildTransactionNotification(transaction, cards = []) {
  if (!transaction) return null;
  const type =
    transaction.type === "adjust" ? "adjustment" : transaction.type || "";
  const amt = formatTaka(transaction.amount);
  const note = String(transaction.description || transaction.note || "").trim();
  const dateStr = transaction.date ? formatDate(transaction.date) : "";
  const tag = `spend-activity-tx-${transaction.id || Date.now()}`;

  if (type === "transfer") {
    const fromName = resolveAccountLabel(
      transaction.fromAccount || transaction.acct,
      cards,
    );
    const toName = resolveAccountLabel(
      transaction.toAccount || transaction.to,
      cards,
    );
    const parts = [note, `${fromName} → ${toName}`, dateStr].filter(Boolean);
    return {
      title: `Transfer · ${amt}`,
      body: parts.join(" · "),
      tag,
      tab: "activity",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  if (type === "income") {
    const acctName = resolveAccountLabel(
      transaction.account || transaction.acct,
      cards,
    );
    const parts = [note, `Added to ${acctName}`, dateStr].filter(Boolean);
    return {
      title: `Income · +${amt}`,
      body: parts.join(" · "),
      tag,
      tab: "activity",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  if (type === "adjustment") {
    const acctName = resolveAccountLabel(
      transaction.account || transaction.acct,
      cards,
    );
    const isUp =
      transaction.direction === "increase" ||
      transaction.direction === "up" ||
      transaction.dir === "up" ||
      transaction.dir === "increase";
    const sign = isUp ? "+" : "-";
    const parts = [note, `${acctName} (${sign}${amt})`, dateStr].filter(
      Boolean,
    );
    return {
      title: `Balance Adjusted · ${amt}`,
      body: parts.join(" · "),
      tag,
      tab: "activity",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  return null;
}

export function buildExpenseNotification(expense, cards = []) {
  if (!expense) return null;
  const name = String(expense.description || expense.desc || "Expense").trim();
  const category = String(expense.category || expense.cat || "Other").trim();
  const rawAmt = expense.amount ?? expense.amt;
  const hasAmt =
    rawAmt !== null && rawAmt !== undefined && Number.isFinite(Number(rawAmt));
  const paidFrom = resolveAccountLabel(expense.account || expense.acct, cards);
  const title = hasAmt ? `Expense · ${formatTaka(rawAmt)}` : "Expense added";
  const body = `${name} · ${category} · Paid from ${paidFrom}`;
  return {
    title,
    body,
    tag: `spend-activity-exp-${expense.id || Date.now()}`,
    tab: "activity",
    tone: "reminder",
    channelId: "spend_activity",
  };
}

export function buildCardAddedNotification(card) {
  if (!card) return null;
  const name = String(card.name || "New card").trim();
  const tag = `spend-activity-card-${card.id || Date.now()}`;

  if (isSavingsCard(card)) {
    return {
      title: "Account Added",
      body: `Your ${name} account has been added to Accounts.`,
      tag,
      tab: "accounts",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  if (isCashCard(card)) {
    return {
      title: "Wallet Added",
      body: `Your ${name} wallet has been added to Accounts.`,
      tag,
      tab: "accounts",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  if (isMfsCard(card)) {
    return {
      title: "Wallet Added",
      body: `Your ${name} wallet has been added to Accounts.`,
      tag,
      tab: "accounts",
      tone: "reminder",
      channelId: "spend_activity",
    };
  }

  const rawType = String(card.type || "")
    .trim()
    .toLowerCase();
  const typeLabel =
    rawType === "credit"
      ? "Credit"
      : rawType === "debit"
        ? "Debit"
        : rawType === "prepaid"
          ? "Prepaid"
          : rawType === "virtual"
            ? "Virtual"
            : "";
  const lowerName = name.toLowerCase();
  const hasTypeInName =
    typeLabel && lowerName.includes(typeLabel.toLowerCase());
  const hasCardInName = /\bcard\b/i.test(name);
  const labelParts = [name];
  if (typeLabel && !hasTypeInName) labelParts.push(typeLabel);
  if (!hasCardInName) labelParts.push("card");

  return {
    title: "Card Added",
    body: `Your ${labelParts.join(" ")} has been added to Accounts.`,
    tag,
    tab: "accounts",
    tone: "reminder",
    channelId: "spend_activity",
  };
}

export async function notifyTransactionCreated(transaction, cards = []) {
  const payload = buildTransactionNotification(transaction, cards);
  if (!payload || hasActivityBeenNotified(payload.tag)) return null;
  markActivityNotified(payload.tag);
  await sendNativeBuiltinNotification(payload);
  return payload;
}

export async function notifyExpenseCreated(expense, cards = []) {
  const payload = buildExpenseNotification(expense, cards);
  if (!payload || hasActivityBeenNotified(payload.tag)) return null;
  markActivityNotified(payload.tag);
  await sendNativeBuiltinNotification(payload);
  return payload;
}

export async function notifyCardAdded(card) {
  const payload = buildCardAddedNotification(card);
  if (!payload || hasActivityBeenNotified(payload.tag)) return null;
  markActivityNotified(payload.tag);
  await sendNativeBuiltinNotification(payload);
  return payload;
}

export function setupNotificationListeners(onNavigate) {
  let removeNative = null;
  let removeSw = null;

  if (isNativePlatform()) {
    getLocalNotifications()
      .then((LocalNotifications) => {
        if (!LocalNotifications) return null;
        return LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (action) => {
            const targetTab = action.notification.extra?.tab;
            if (targetTab && typeof onNavigate === "function") {
              onNavigate(targetTab);
            }
          },
        );
      })
      .then((handle) => {
        if (handle) {
          removeNative = () => handle.remove();
        }
      })
      .catch(() => {});
  }

  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    const handler = (event) => {
      if (
        event.data?.type === "NAVIGATE_TAB" &&
        typeof onNavigate === "function"
      ) {
        onNavigate(event.data.tab);
      } else if (event.data?.type === "PLAY_NOTIFICATION_SOUND") {
        playNotificationAudioTone(event.data.tone || "reminder");
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    removeSw = () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }

  return () => {
    if (removeNative) removeNative();
    if (removeSw) removeSw();
  };
}
