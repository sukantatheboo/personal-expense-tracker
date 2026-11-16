import { formatDate, localDate, nextOccurrenceDate } from "./data.js";

const LAST_NOTIFIED_MONTH_KEY = "spend-notified-month-v2";
const WELCOME_NOTIFIED_PREFIX = "spend-welcome-notified-v2-";
const HEADS_UP_NOTIFIED_KEY = "spend-notified-heads-up-v1";
const LAST_WEEKLY_SUMMARY_KEY = "spend-last-weekly-summary-v1";

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

function addDaysToDateString(dateStr, days) {
  const [y, m, d] = String(dateStr || "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return localDate();
  return localDate(new Date(y, m - 1, d + days));
}

function formatTaka(amount) {
  const num = Number(amount) || 0;
  return `৳${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function getWeeklySpendSummary(expenses = [], now = new Date()) {
  const todayStr = localDate(now);
  const weekStartStr = addDaysToDateString(todayStr, -6);
  let total = 0;
  let count = 0;
  for (const exp of expenses) {
    if (!exp || exp.category === "Savings" || exp.cat === "Savings") continue;
    const d = exp.date || "";
    const amt = Number(exp.amount ?? exp.amt);
    if (d >= weekStartStr && d <= todayStr && Number.isFinite(amt) && amt > 0) {
      total += amt;
      count += 1;
    }
  }
  return {
    total: Math.round(total * 100) / 100,
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
  const base = import.meta.env.BASE_URL || "./";
  const fileName = tone === "welcome" ? "sounds/welcome.wav" : "sounds/reminder.wav";
  if (typeof window !== "undefined") {
    const originBase = base.startsWith("/") ? window.location.origin : window.location.href;
    return new URL(`${base}${fileName}`, originBase).href;
  }
  return `./${fileName}`;
}

function setupAudioUnlock() {
  if (typeof window === "undefined" || audioUnlocked) return;
  const unlock = () => {
    audioUnlocked = true;
    const ctx = getSharedAudioContext();
    if (ctx) {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        ctx.resume().catch(() => {});
      }
      // iOS Safari WebKit requires playing a silent buffer inside a direct user
      // gesture to fully unlock the AudioContext output channel.
      try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // ignore
      }
    }
    if (pendingBlockedTone && Date.now() - pendingBlockedToneAt < 15000) {
      const toneToPlay = pendingBlockedTone;
      pendingBlockedTone = null;
      pendingBlockedToneAt = 0;
      playNotificationAudioTone(toneToPlay);
    }
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("touchstart", unlock, true);
    window.removeEventListener("touchend", unlock, true);
    window.removeEventListener("click", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchstart", unlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchend", unlock, { capture: true, passive: true });
  window.addEventListener("click", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

if (typeof window !== "undefined") {
  setupAudioUnlock();
}

/**
 * Web Audio API synthesizer fallback.
 */
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

/**
 * Play foreground notification tone and trigger haptics.
 */
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

/**
 * Configure Android notification channels with distinct sounds, vibrations, and importance levels.
 */
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
    channelsConfigured = true;
  } catch {
    // Non-Android platforms ignore createChannel
  }
}

/**
 * Check notification permissions across iOS, Android, and Web platforms.
 */
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

/**
 * Request notification permissions across iOS, Android, and Web platforms.
 */
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

function hashNotificationId(str, min = 100000, max = 1999999999) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const span = max - min;
  return min + (Math.abs(hash) % span);
}

/**
 * Send an immediate native built-in notification for iOS and Android (with web fallback).
 */
export async function sendNativeBuiltinNotification({
  title,
  body,
  tag,
  tab = "activity",
  tone = "reminder",
  id,
  scheduleAt,
}) {
  const notifId =
    typeof id === "number"
      ? id
      : hashNotificationId(tag || `${title}-${Date.now()}`);

  if (!scheduleAt) {
    playNotificationAudioTone(tone);
  }

  if (isNativePlatform()) {
    try {
      await setupNativeNotificationChannels();
      const LocalNotifications = await getLocalNotifications();
      if (LocalNotifications) {
        const channelId =
          tone === "welcome"
            ? "spend_welcome"
            : tag && tag.includes("month")
              ? "spend_monthly"
              : "spend_reminders";

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

    const base = import.meta.env.BASE_URL || "./";
    const originBase = base.startsWith("/") ? window.location.origin : window.location.href;
    const iconHref = new URL(`${base}icons/icon-192.png`, originBase).href;
    const options = {
      body,
      icon: iconHref,
      badge: iconHref,
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
      } catch {}
    }

    try {
      new window.Notification(title, options);
      return true;
    } catch {}
  }

  return false;
}

/**
 * Synchronize all OS-level background scheduled notifications on iOS and Android
 * AND sync upcoming 24h timers to the Service Worker on Web/PWA:
 * 1. 1st-of-the-month spend overview
 * 2. Weekly spending summary (upcoming Sundays)
 * 3. Daily expense tracking reminders (next 14 days)
 * 4. Upcoming recurring bill heads-up (1 day before due date)
 * 5. Recurring expense due-day reminders (on due date)
 */
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
  } catch {}

  const notifications = [];

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
      notifications.push({
        id: 20002 + mOffset,
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

    notifications.push({
      id: 21001 + w,
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
    notifications.push({
      id: 30001 + dOffset,
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
        notifications.push({
          id: hashNotificationId(
            `heads-up:${schedule.id}:${occDate}`,
            40000,
            499999999,
          ),
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
        notifications.push({
          id: hashNotificationId(
            `due:${schedule.id}:${occDate}`,
            500000000,
            899999999,
          ),
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

  // Sync near-term (next 24h) notifications to Service Worker for Web/PWA background execution
  if (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    window.Notification.permission === "granted"
  ) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        const sw = reg?.active || navigator.serviceWorker.controller;
        if (!sw) return;
        const upcoming24h = notifications
          .filter((n) => {
            const atMs = n.schedule?.at?.getTime?.() || 0;
            return atMs > nowMs && atMs - nowMs <= 24 * 60 * 60 * 1000;
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
          items: upcoming24h,
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

    // Cancel previously queued background reminders (IDs >= 20002) before rescheduling fresh ones
    try {
      const pending = await LocalNotifications.getPending();
      const toCancel = (pending?.notifications || []).filter((n) => {
        const numId = Number(n.id);
        return Number.isFinite(numId) && numId >= 20002 && numId < 900000000;
      });
      if (toCancel.length > 0) {
        await LocalNotifications.cancel({
          notifications: toCancel.map((n) => ({ id: Number(n.id) })),
        });
      }
    } catch {}

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
    return true;
  } catch (err) {
    console.warn("Could not sync native scheduled notifications:", err);
    return false;
  }
}

/**
 * When a new month comes, send a reminder notification:
 * "Previous month's spend overview is ready"
 */
export async function checkAndNotifyNewMonth(currentMonthStr) {
  const now = new Date();
  const thisMonth =
    currentMonthStr ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let lastNotifiedMonth = "";
  try {
    lastNotifiedMonth = localStorage.getItem(LAST_NOTIFIED_MONTH_KEY) || "";
  } catch {}

  const shouldNotify = !lastNotifiedMonth
    ? now.getDate() <= 7
    : lastNotifiedMonth < thisMonth;

  if (shouldNotify) {
    try {
      localStorage.setItem(LAST_NOTIFIED_MONTH_KEY, thisMonth);
    } catch {}

    await sendNativeBuiltinNotification({
      id: 20001,
      title: "Previous month's spend overview is ready",
      body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
      tag: `spend-new-month-${thisMonth}`,
      tab: "home",
      tone: "reminder",
    });
  } else if (!lastNotifiedMonth) {
    try {
      localStorage.setItem(LAST_NOTIFIED_MONTH_KEY, thisMonth);
    } catch {}
  }
}

/**
 * Check and notify for recurring bills due tomorrow (1-day-before heads-up).
 */
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
  } catch {}

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
  } catch {}

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
    tag: `heads-up:${dueTomorrow[0].id}:${ localDate(now) }`,
    tab: "plans",
    tone: "reminder",
  });
}

/**
 * Check and notify for weekly spending summary on Sundays at/after reminderTime.
 */
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
  } catch {}

  const summary = getWeeklySpendSummary(expenses, now);
  if (summary.count === 0) return;

  try {
    localStorage.setItem(LAST_WEEKLY_SUMMARY_KEY, stamp);
  } catch {}

  await sendNativeBuiltinNotification({
    title: "Weekly spending summary",
    body: `You've tracked ${formatTaka(summary.total)} across ${summary.count} ${summary.count === 1 ? "expense" : "expenses"} over the last 7 days.`,
    tag: `spend-weekly-${todayStr}`,
    tab: "activity",
    tone: "reminder",
  });
}

/**
 * When a new user signed in, send a native built-in notification with a distinct welcome tone:
 * "Welcome to Spend! Start tracking"
 */
export async function notifyNewUserSignedIn(user) {
  if (!user || !user.id) return;
  const key = `${WELCOME_NOTIFIED_PREFIX}${user.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "true");
  } catch {}

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
    id: 10001,
    title: "Welcome to Spend! Start tracking",
    body: `Welcome to Spend${greeting}! Start your expense tracking with Spend and take control of your financial journey.`,
    tag: `spend-welcome-${user.id}`,
    tab: "home",
    tone: "welcome",
  });
}

/**
 * Setup notification action listeners.
 */
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
