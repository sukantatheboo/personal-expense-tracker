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

/**
 * Web Audio API synthesizer fallback.
 */
function synthesizeAudioTone(tone = "reminder") {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

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
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(
          gainVal,
          ctx.currentTime + start + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + start + dur,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
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
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(
          gainVal,
          ctx.currentTime + start + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + start + dur,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      });
    }
  } catch {
    // Audio context unavailable or suppressed
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

  const soundFile =
    tone === "welcome" ? "./sounds/welcome.wav" : "./sounds/reminder.wav";
  try {
    const audio = new Audio(soundFile);
    audio.volume = 0.75;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        synthesizeAudioTone(tone);
      });
    }
  } catch {
    synthesizeAudioTone(tone);
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
  if (typeof window !== "undefined" && "Notification" in window) {
    try {
      const result = await window.Notification.requestPermission();
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

    const options = {
      body,
      icon: new URL("./icons/icon-192.png", window.location.origin).href,
      badge: new URL("./icons/icon-192.png", window.location.origin).href,
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
 * so they fire reliably when the app is completely closed:
 * 1. 1st-of-the-month spend overview
 * 2. Weekly spending summary (upcoming Sundays)
 * 3. Daily expense tracking reminders (next 14 days, skipping today if already logged)
 * 4. Upcoming recurring bill heads-up (1 day before due date)
 * 5. Recurring expense due-day reminders (on due date)
 */
export async function syncNativeScheduledNotifications({
  recurringSchedules = [],
  expenses = [],
  reminderTime = "09:00",
} = {}) {
  if (!isNativePlatform()) return false;
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

    const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)
      ? reminderTime
      : "09:00";
    const [hours, minutes] = safeTime.split(":").map(Number);
    const now = new Date();
    const nowMs = now.getTime();
    const todayStr = localDate(now);
    const hasExpenseToday = expenses.some((e) => e?.date === todayStr);

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
      if (candidate.getTime() > nowMs + 5000) {
        notifications.push({
          id: 20002 + mOffset,
          title: "Previous month's spend overview is ready",
          body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
          channelId: "spend_monthly",
          sound: "reminder.wav",
          foreground: true,
          schedule: { at: candidate },
          extra: {
            tab: "home",
            tag: `spend-scheduled-new-month-${localDate(candidate).slice(0, 7)}`,
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
      if (sundayDate.getTime() <= nowMs + 5000) continue;
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
        schedule: { at: sundayDate },
        extra: {
          tab: "activity",
          tag: `spend-weekly-summary-${localDate(sundayDate)}`,
          tone: "reminder",
        },
      });
    }

    // 3. Daily expense tracking reminders (next 14 days at reminderTime)
    for (let dOffset = 0; dOffset < 14; dOffset += 1) {
      if (dOffset === 0 && hasExpenseToday) continue;
      const targetDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dOffset,
        hours,
        minutes,
        0,
      );
      if (targetDay.getTime() <= nowMs + 5000) continue;
      const dateStr = localDate(targetDay);
      notifications.push({
        id: 30001 + dOffset,
        title: "Daily expense reminder",
        body: "Don’t forget to track today's expenses to keep your budget on target.",
        channelId: "spend_reminders",
        sound: "reminder.wav",
        foreground: true,
        schedule: { at: targetDay },
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
      let occDate = schedule.nextDate;
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

        if (headsUpAt.getTime() > nowMs + 5000) {
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
            schedule: { at: headsUpAt },
            extra: {
              tab: "plans",
              tag: `spend-heads-up-${schedule.id}-${occDate}`,
              tone: "reminder",
            },
          });
        }

        if (dueAt.getTime() > nowMs + 5000) {
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
            schedule: { at: dueAt },
            extra: {
              tab: "activity",
              tag: `spend-recurring-${schedule.id}-${occDate}`,
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
    tag: `spend-heads-up-${tomorrowStr}`,
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
  try {
    if (localStorage.getItem(LAST_WEEKLY_SUMMARY_KEY) === todayStr) return;
  } catch {}

  const summary = getWeeklySpendSummary(expenses, now);
  if (summary.count === 0) return;

  try {
    localStorage.setItem(LAST_WEEKLY_SUMMARY_KEY, todayStr);
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
