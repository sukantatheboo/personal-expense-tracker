import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Haptics, NotificationType } from "@capacitor/haptics";

const LAST_NOTIFIED_MONTH_KEY = "spend-notified-month-v2";
const WELCOME_NOTIFIED_PREFIX = "spend-welcome-notified-v2-";

let channelsConfigured = false;

/**
 * Web Audio API synthesizer fallback.
 */
function synthesizeAudioTone(tone = "reminder") {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    if (tone === "welcome") {
      // Warm, celebratory 3-note ascending arpeggio: C5 (523.25) -> E5 (659.25) -> G5 (783.99)
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
      // Clean, pleasant 2-note reminder chime: A4 (440) -> E5 (659.25)
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
  // 1. Native haptic feedback
  if (Capacitor.isNativePlatform()) {
    try {
      if (tone === "welcome") {
        void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      } else {
        void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
      }
    } catch {}
  }

  // 2. Audio tone playback (try audio element then fallback to synthesizer)
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
  if (!Capacitor.isNativePlatform() || channelsConfigured) return;
  try {
    await LocalNotifications.createChannel({
      id: "spend_reminders",
      name: "Spend Reminders",
      description: "Daily expense reminders and recurring bill alerts",
      importance: 4,
      sound: "reminder.wav",
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: "spend_welcome",
      name: "Spend Welcome",
      description: "Welcome notification when signing in with unique celebratory tone",
      importance: 4,
      sound: "welcome.wav",
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: "spend_monthly",
      name: "Monthly Expense Tracking",
      description: "Reminders to start expense tracking when a new month begins",
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
  if (Capacitor.isNativePlatform()) {
    try {
      const { display } = await LocalNotifications.checkPermissions();
      return display; // 'granted' | 'denied' | 'prompt'
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
  if (Capacitor.isNativePlatform()) {
    try {
      await setupNativeNotificationChannels();
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

function hashNotificationId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483647;
}

/**
 * Send a native built-in notification for iOS and Android (with web fallback).
 * Replaces all HUD / in-app DOM banners with true OS-level system notifications.
 */
export async function sendNativeBuiltinNotification({
  title,
  body,
  tag,
  tab = "activity",
  tone = "reminder", // "reminder" | "welcome"
  id,
  scheduleAt,
}) {
  const notifId =
    typeof id === "number"
      ? id
      : hashNotificationId(tag || `${title}-${Date.now()}`);

  // Play audio tone and haptic
  playNotificationAudioTone(tone);

  // 1. Native platform (iOS and Android via Capacitor LocalNotifications)
  if (Capacitor.isNativePlatform()) {
    try {
      await setupNativeNotificationChannels();
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
    } catch (err) {
      console.warn("Native notification dispatch failed:", err);
    }
  }

  // 2. Web / PWA fallback
  if (typeof window !== "undefined" && "Notification" in window) {
    if (window.Notification.permission !== "granted") {
      return false;
    }

    const options = {
      body,
      icon: new URL("./icons/icon-192.png", window.location.origin).href,
      badge: new URL("./icons/icon-180.png", window.location.origin).href,
      tag: tag || `spend-${notifId}`,
      renotify: true,
      vibrate: tone === "welcome" ? [120, 60, 120, 60, 240] : [200, 100, 200],
      data: {
        url: window.location.origin + window.location.pathname,
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
 * When a new month comes, send a reminder notification and schedule OS background delivery:
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

  const shouldNotify =
    !lastNotifiedMonth
      ? now.getDate() <= 7 // Active during the 7-day month-end banner window
      : lastNotifiedMonth < thisMonth; // True month rollover

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

  // Schedule next month's day 1 morning reminder on native iOS/Android (fires even when the app is closed)
  if (Capacitor.isNativePlatform()) {
    try {
      const nextMonthDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1,
        9,
        0,
        0,
      );
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 20002,
            title: "Previous month's spend overview is ready",
            body: "A new month has begun! Open Spend to review your previous month's spend overview and recap.",
            channelId: "spend_monthly",
            sound: "reminder.wav",
            foreground: true,
            schedule: { at: nextMonthDate },
            extra: {
              tab: "home",
              tag: "spend-scheduled-new-month",
              tone: "reminder",
            },
          },
        ],
      });
    } catch {}
  }
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
    tone: "welcome", // DIFFERENT TONE!
  });
}

/**
 * Setup notification action listeners (e.g., tapping on a native notification opens the app to the relevant tab).
 */
export function setupNotificationListeners(onNavigate) {
  let removeNative = null;
  let removeSw = null;

  if (Capacitor.isNativePlatform()) {
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (action) => {
        const targetTab = action.notification.extra?.tab;
        if (targetTab && typeof onNavigate === "function") {
          onNavigate(targetTab);
        }
      },
    )
      .then((handle) => {
        removeNative = () => handle.remove();
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
