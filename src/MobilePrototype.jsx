import React, {
  Fragment,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { App as CapacitorApp } from "@capacitor/app";
import {
  computeAccountBalances,
  flushStorageWriteQueues,
  getSavingsAccountId,
  isHapticsEnabled,
  parseAmount,
  setHapticsEnabled,
  STORAGE_KEYS,
} from "./data.js";
import { triggerHaptic } from "./haptics.js";
import { CARD_PROVIDERS } from "./cardProviders.js";
import {
  CategorySymbol,
  TransactionSymbol,
  UtilitySymbol,
  getCategoryColor,
  getDynamicEntertainmentService,
  foodSvg,
  transportSvg,
  billsSvg,
  homeSvg,
  shoppingSvg,
  healthSvg,
  entertainmentSvg,
  educationSvg,
  savingsSvg,
  otherSvg,
  alertSvg,
  cashSvg,
  starSvg,
  refreshSvg,
  suggestionSvg,
} from "./categoryAssets.jsx";
import {
  setAppPin,
  verifyAppPin,
  getPinLockoutRemainingSeconds,
  hasAppPin,
  removeAppPin,
  resetForgottenPin,
  isBiometricsAvailable,
  hasBiometricsConfigured,
  enableBiometrics,
  disableBiometrics,
  authenticateWithBiometrics,
  markActive,
  markBackgrounded,
  shouldLockApp,
  lockAppManually,
} from "./security.js";
import "./MobilePrototype.css";
import { useScrollProgress } from "./useScrollProgress.js";
import {
  QuickActionsRow,
  QuickAction,
  FallbackIcons,
  StackedCardDeck,
  WalletCard,
  formatCashMoney,
} from "./AccountsCardDeck.jsx";
import {
  VisaBadge,
  MastercardBadge,
  AmexBadge,
  MiniCardPreview,
  CASH_CURRENCIES,
  getCashCurrencyMeta,
} from "./cardAssets.jsx";
import {
  AnimatedRecurringIcon,
  AnimatedBudgetIcon,
  AnimatedExpensesIcon,
  AnimatedTransactionsIcon,
  AnimatedActivityIcon,
} from "./components/AnimatedEmptyIcons.jsx";

import SpendLogin from "./components/SpendLogin.jsx";
import SegmentedControl from "./components/SegmentedControl.jsx";

const MonthEndBanner = lazy(() => import("./components/MonthEndBanner.jsx"));

// Dynamic runtime platform detection (Capacitor native shell + mobile browser / DevTools emulation)
function detectMobilePlatform() {
  if (typeof window === "undefined") return "web";
  try {
    const capPlatform = window.Capacitor?.getPlatform?.();
    if (capPlatform === "ios" || capPlatform === "android") return capPlatform;
  } catch {}
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const platformStr =
    (typeof navigator !== "undefined" &&
      (navigator.userAgentData?.platform || navigator.platform)) ||
    "";
  if (/android/i.test(ua) || /android/i.test(platformStr)) return "android";
  if (
    /iPhone|iPad|iPod/i.test(ua) ||
    /iPhone|iPad|iPod/i.test(platformStr) ||
    (/Mac/i.test(platformStr) &&
      typeof navigator !== "undefined" &&
      navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  return "web";
}

function isAndroidPlatform() {
  if (typeof document !== "undefined") {
    const attr = document.documentElement?.dataset?.platform;
    if (attr === "android") return true;
    if (attr === "ios") return false;
  }
  return detectMobilePlatform() === "android";
}

const cardMoneyFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return "৳0.00";
  const abs = cardMoneyFormatter.format(Math.abs(num));
  return num < 0 ? `-৳${abs}` : `৳${abs}`;
}

function isNativePlatform() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.Capacitor?.isNativePlatform?.())
  );
}

/* ───────────── constants ───────────── */
const CAT = {
  Food: [foodSvg, "#f97316"],
  Transport: [transportSvg, "#2563eb"],
  Bills: [billsSvg, "#eab308"],
  Home: [homeSvg, "#10b981"],
  Shopping: [shoppingSvg, "#8b5cf6"],
  Health: [healthSvg, "#dc2626"],
  Entertainment: [entertainmentSvg, "#06b6d4"],
  Education: [educationSvg, "#4f46e5"],
  Savings: [savingsSvg, "#be185d"],
  Other: [otherSvg, "#64748b"],
};
function isAdjustmentIncrease(item) {
  return (
    item?.dir === "up" ||
    item?.dir === "increase" ||
    item?.direction === "increase" ||
    item?.direction === "up"
  );
}

function getAccountDisplay(id, cards = [], deletedCards = null) {
  const match = Array.isArray(cards) ? cards.find((c) => c.id === id) : null;
  if (match) {
    const prov = CARD_PROVIDERS.find(
      (p) => p.id === (match.provider || match.id),
    );
    const resolvedName =
      String(match.name || "").trim() ||
      prov?.name ||
      (match.type === "savings" || match.category === "savings"
        ? "Savings"
        : "Card");
    return [resolvedName, match.color || "#2563a8"];
  }
  if (!id || id === "cash") return ["Cash", "#10b981"];
  const tombstone = deletedCards?.[id];
  if (tombstone?.name) {
    return [`${tombstone.name} (Archived)`, tombstone.color || "#64748b"];
  }
  return [id || "Account", "#2563a8"];
}
const TABS = [
  ["home", "Home"],
  ["activity", "Activity"],
  ["add"],
  ["accounts", "Accounts"],
  ["plans", "Plans"],
];
// Dock geometry (k = 1.25 -> 67.5px bar, 50px FAB, 20px overhang, 125px notch)
const DOCK_K = 1.25;
const DOCK_G = {
  start: 50 * DOCK_K,
  c1: 36 * DOCK_K,
  c2x: 32.7 * DOCK_K,
  c2y: 11.1 * DOCK_K,
  jx: 21.4 * DOCK_K,
  jy: 22.4 * DOCK_K,
  r: 30.25 * DOCK_K,
};
const DOCK_BAR_H = 54 * DOCK_K;
const DOCK_NOTCH_W = DOCK_G.start * 2;
const DOCK_NOTCH_CURVE_D =
  `M0 0 C${DOCK_G.start - DOCK_G.c1} 0 ${DOCK_G.start - DOCK_G.c2x} ${DOCK_G.c2y} ${DOCK_G.start - DOCK_G.jx} ${DOCK_G.jy} ` +
  `A${DOCK_G.r} ${DOCK_G.r} 0 0 0 ${DOCK_G.start + DOCK_G.jx} ${DOCK_G.jy} ` +
  `C${DOCK_G.start + DOCK_G.c2x} ${DOCK_G.c2y} ${DOCK_G.start + DOCK_G.c1} 0 ${DOCK_NOTCH_W} 0`;
const DOCK_NOTCH_D = `${DOCK_NOTCH_CURVE_D} V${DOCK_BAR_H} H0 Z`;
const SHEET_EXIT_MS = 280;
const SHEET_REDUCED_EXIT_MS = 160;

/* ───────────── icons ───────────── */
const DOCK_ICONS = {
  home: {
    inactive: (
      <path d="M4.6 9.85 11.02 4.5a1.55 1.55 0 0 1 1.96 0L19.4 9.85a1.65 1.65 0 0 1 .6 1.27v7.58a1.8 1.8 0 0 1-1.8 1.8h-3.4a.8.8 0 0 1-.8-.8v-4.2a1.5 1.5 0 0 0-1.5-1.5h-1a1.5 1.5 0 0 0-1.5 1.5v4.2a.8.8 0 0 1-.8.8H5.8A1.8 1.8 0 0 1 4 18.7v-7.58a1.65 1.65 0 0 1 .6-1.27Z" />
    ),
    active: (
      <path
        fill="currentColor"
        stroke="none"
        d="M10.78 3.63a1.9 1.9 0 0 1 2.44 0l6.6 5.5a2.1 2.1 0 0 1 .76 1.61v7.96a2.3 2.3 0 0 1-2.3 2.3h-3.18a1.1 1.1 0 0 1-1.1-1.1v-4.4a1.1 1.1 0 0 0-1.1-1.1h-1.8a1.1 1.1 0 0 0-1.1 1.1v4.4a1.1 1.1 0 0 1-1.1 1.1H5.72a2.3 2.3 0 0 1-2.3-2.3v-7.96c0-.62.28-1.21.76-1.61l6.6-5.5Z"
      />
    ),
  },
  activity: {
    inactive: (
      <>
        <rect x="4.5" y="3.5" width="15" height="17" rx="3.2" />
        <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5H13" />
      </>
    ),
    active: (
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        stroke="none"
        d="M7.6 3h8.8A3.6 3.6 0 0 1 20 6.6v10.8a3.6 3.6 0 0 1-3.6 3.6H7.6A3.6 3.6 0 0 1 4 17.4V6.6A3.6 3.6 0 0 1 7.6 3Zm.9 4.65a.85.85 0 0 0 0 1.7h7a.85.85 0 0 0 0-1.7h-7Zm0 3.5a.85.85 0 0 0 0 1.7h7a.85.85 0 0 0 0-1.7h-7Zm0 3.5a.85.85 0 0 0 0 1.7H13a.85.85 0 0 0 0-1.7H8.5Z"
      />
    ),
  },
  accounts: {
    inactive: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 9.5h18" />
        <path d="M7 14.5h3.5" />
      </>
    ),
    active: (
      <>
        <path
          fill="currentColor"
          stroke="none"
          d="M6 4.5h12A3.5 3.5 0 0 1 21.5 8v.6h-19V8A3.5 3.5 0 0 1 6 4.5Z"
        />
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          stroke="none"
          d="M2.5 10.4h19V16a3.5 3.5 0 0 1-3.5 3.5H6A3.5 3.5 0 0 1 2.5 16v-5.6Zm4.5 3.35a.85.85 0 0 0 0 1.7h4a.85.85 0 0 0 0-1.7H7Z"
        />
      </>
    ),
  },
  plans: {
    inactive: (
      <>
        <path d="M11 4.06a8 8 0 1 0 8.94 8.94H12a1 1 0 0 1-1-1V4.06Z" />
        <path d="M14 3.28A8.03 8.03 0 0 1 20.72 10H14.8a.8.8 0 0 1-.8-.8V3.28Z" />
      </>
    ),
    active: (
      <>
        <path
          fill="currentColor"
          stroke="none"
          d="M10.45 3.58a.85.85 0 0 1 .95.84v6.78c0 .22.18.4.4.4h6.78a.85.85 0 0 1 .84.95 8.5 8.5 0 1 1-8.97-8.97Z"
        />
        <path
          fill="currentColor"
          stroke="none"
          d="M13.6 2.83a.8.8 0 0 1 .93-.79 8.53 8.53 0 0 1 6.43 6.43.8.8 0 0 1-.79.93h-5.37a1.2 1.2 0 0 1-1.2-1.2V2.83Z"
        />
      </>
    ),
  },
};

const ICONS = {
  home: DOCK_ICONS.home.inactive,
  activity: DOCK_ICONS.activity.inactive,
  accounts: DOCK_ICONS.accounts.inactive,
  plans: DOCK_ICONS.plans.inactive,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="m18 6-12 12M6 6l12 12" />,
  l: <path d="m15 18-6-6 6-6" />,
  r: <path d="m9 18 6-6-6-6" />,
  s: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  backup: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5" />
      <path d="M4 19h16" />
    </>
  ),
  restore: (
    <>
      <path d="M3 4v6h6" />
      <path d="M4.8 14a8 8 0 1 0 1.4-7L3 10" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  csv: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4M9 12h6M9 16h6" />
    </>
  ),
  insights: (
    <>
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </>
  ),
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24">{ICONS[n]}</svg>;

function CategorySuggestionValue({ category, description }) {
  const [, color] = CAT[category] || CAT.Other || ["", "#64748b"];
  const dynamicColor = getCategoryColor(category, description) || color;
  return (
    <span className="category-suggestion-value" style={{ "--c": dynamicColor }}>
      <CategorySymbol category={category} description={description} />
      <span>{category}</span>
    </span>
  );
}

function greetingFirstName(profile) {
  const firstName = profile?.hasName
    ? String(profile.name || "")
        .trim()
        .split(/\s+/)[0]
    : "";
  if (!firstName) return "there";
  const characters = Array.from(firstName);
  characters[0] = characters[0].toLocaleUpperCase();
  return characters.join("");
}

/* ───────────── helpers ───────────── */
const ld = (d = new Date()) =>
  d.getFullYear() +
  "-" +
  String(d.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(d.getDate()).padStart(2, "0");
const ago = (n) => ld(new Date(Date.now() - n * 864e5));
const intAmountFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const decAmountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const amountFormatter = {
  format(val) {
    const num = Number(val) || 0;
    const hasFraction = Math.round(Math.abs(num) * 100) % 100 !== 0;
    return hasFraction
      ? decAmountFormatter.format(num)
      : intAmountFormatter.format(num);
  },
};
const M = (n) => "৳" + amountFormatter.format(Number(n) || 0);
const money = M;
const shift = (m, o) => {
  if (!m || typeof m !== "string" || !m.includes("-")) return ld().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  return ld(new Date(y, mo - 1 + o, 1)).slice(0, 7);
};
const fM = (m) => {
  if (!m || typeof m !== "string" || !m.includes("-")) return "";
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
};
const fD = (d) => {
  if (!d || typeof d !== "string") return "";
  const parts = d.split("-").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return String(d);
  const [y, m, x] = parts;
  const dateObj = new Date(y, m - 1, x);
  if (isNaN(dateObj.getTime())) return String(d);
  return dateObj.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};
const dayMonth = (d) => fD(d).split(" ").slice(1).join(" ");
const capitalizeFirstLetter = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  const characters = Array.from(text);
  characters[0] = characters[0].toLocaleUpperCase();
  return characters.join("");
};
const activityTime = (item) => {
  if (!item) return 0;
  const parse = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };
  return Math.max(parse(item.createdAt), parse(item.updatedAt));
};

const tot = (S, m) =>
  (S?.exp || [])
    .filter(
      (e) =>
        typeof e?.date === "string" && e.date.startsWith(m) && e.amt != null,
    )
    .reduce((a, e) => a + e.amt, 0);
const monthExp = (S) =>
  (S?.exp || [])
    .filter((e) => typeof e?.date === "string" && e.date.startsWith(S?.m || ""))
    .map((e, index) => ({ e, index }))
    .sort((x, y) => {
      const a = x.e;
      const b = y.e;
      return (
        String(b.date || "").localeCompare(String(a.date || "")) ||
        activityTime(b) - activityTime(a) ||
        y.index - x.index ||
        String(b.id || "").localeCompare(String(a.id || ""))
      );
    })
    .map(({ e }) => e);
function bal(S, id) {
  if (!id) return 0;
  const computed = computeAccountBalances(S?.cards, S?.start, S?.exp, S?.tx);
  if (Object.hasOwn(computed.currentBalances, id)) {
    return computed.currentBalances[id];
  }
  const cardObj = Array.isArray(S?.cards)
    ? S.cards.find((c) => c.id === id)
    : null;
  const fallback = Number(S?.start?.[id] ?? cardObj?.initialBalance) || 0;
  return Math.round(fallback * 100) / 100;
}

/* ───────────── small shared pieces ───────────── */
const Seg = ({ value, options, onPick, ariaLabel, glass = true, className = "", compact = false }) => (
  <SegmentedControl
    value={value}
    options={options}
    onChange={onPick}
    ariaLabel={ariaLabel}
    glass={glass}
    className={className}
    compact={compact}
  />
);

const MonthSwitch = ({ m, onShift }) => (
  <div className="mon">
    <button
      type="button"
      aria-label="Previous month"
      onClick={() => {
        triggerHaptic("selection");
        onShift(-1);
      }}
    >
      <Icon n="l" />
    </button>
    <b>{fM(m)}</b>
    <button
      type="button"
      aria-label="Next month"
      disabled={!m || m >= ld().slice(0, 7)}
      onClick={() => {
        triggerHaptic("selection");
        onShift(1);
      }}
    >
      <Icon n="r" />
    </button>
  </div>
);

const getMonthYearParts = (m) => {
  if (!m || typeof m !== "string" || !m.includes("-")) {
    const d = new Date();
    return {
      month: d.toLocaleDateString("en-GB", { month: "long" }),
      year: String(d.getFullYear()),
    };
  }
  const [y, mo] = m.split("-").map(Number);
  const dateObj = new Date(y, mo - 1, 1);
  return {
    month: dateObj.toLocaleDateString("en-GB", { month: "long" }),
    year: String(y),
  };
};

function suggestedCategory(description, expenses = [], excludeId = null) {
  const title = String(description || "")
    .trim()
    .toLocaleLowerCase();
  if (!title) return "";
  if (getDynamicEntertainmentService(title)) return "Entertainment";
  const exactCategory = Object.keys(CAT)
    .filter((category) => category !== "Savings")
    .find((category) => category.toLocaleLowerCase() === title);
  if (exactCategory) return exactCategory;
  const rules = [
    [
      "Food",
      /\b(food|lunch|dinner|breakfast|snack|coffee|tea|restaurant|meal|grocery|groceries|takeaway|takeout|cafe|bakery|fruit|vegetables?)\b/,
    ],
    [
      "Transport",
      /\b(transport|bus|train|uber|pathao|rickshaw|ride|fuel|petrol|cng|taxi|fare|metro|launch|parking|toll)\b/,
    ],
    [
      "Entertainment",
      /\b(entertainment|movie|cinema|concert|game|gaming|music|spotify|netflix|youtube premium|disney\+?|streaming|theatre|theater|hobby|event ticket|yt|yt\s*music|youtube|youtube\s*music|chatgpt|chat\s*gpt|claude|calude|apple\s*music|applemusic|gemini)\b/,
    ],
    [
      "Education",
      /\b(education|school|tuition|class|course|university|college|exam|lesson|textbook|stationery|coaching|learning)\b/,
    ],
    [
      "Health",
      /\b(health|doctor|medical|medicine|pharmacy|clinic|hospital|dental|dentist|checkup|treatment|lab test)\b/,
    ],
    [
      "Bills",
      /\b(bill|electricity|water|gas|internet|phone bill|mobile recharge|phone recharge|utility|subscription|wifi)\b/,
    ],
    [
      "Home",
      /\b(home|rent|furniture|household|home repair|repair|cleaning|decor|appliance|plumbing)\b/,
    ],
    [
      "Shopping",
      /\b(shop(?:ping)?|diy|market|clothes?|clothing|dress|shoes?|supermarket|online order|purchase|bought|buy|electronics|gadget)\b/,
    ],
  ];
  const keywordMatch = rules.find(([, pattern]) => pattern.test(title));
  if (keywordMatch) return keywordMatch[0];

  const words = new Set(
    title.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2),
  );
  let best = { score: 0, category: "" };
  for (const expense of expenses) {
    if (!expense || expense.id === excludeId || expense.cat === "Savings")
      continue;
    const pastWords = new Set(
      String(expense.desc || "")
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2),
    );
    const overlap = [...words].filter((word) => pastWords.has(word)).length;
    const score = overlap / Math.max(words.size, pastWords.size, 1);
    if (overlap && score > best.score) best = { score, category: expense.cat };
  }
  return best.score >= 0.5 && best.category !== "Savings" ? best.category : "";
}

// Cross-platform iOS & Android swipe-to-delete click-through guard
let swipeDeleteClickLockUntil = 0;
function lockRowClicksAfterDelete(ms = 320) {
  swipeDeleteClickLockUntil = Math.max(
    swipeDeleteClickLockUntil,
    Date.now() + ms,
  );
}
function isRowClickLocked() {
  return Date.now() < swipeDeleteClickLockUntil;
}
const ANDROID_RIGHT_EDGE_DEADZONE_PX = 32;
const ROW_SWIPE_REVEAL_OFFSET = 84;
const ROW_SWIPE_REVEAL_THRESHOLD = 42;
const ROW_SWIPE_LOCK_DISTANCE = 10;
const ROW_SWIPE_LOCK_RATIO = 1.35;
const ROW_SWIPE_SPRING_TRANSITION =
  "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)";

function getRowSwipeFullThresholds(width) {
  const rowWidth = Math.max(240, Number(width) || 320);
  return {
    left: Math.max(185, Math.round(rowWidth * 0.6)),
    right: Math.max(170, Math.round(rowWidth * 0.56)),
  };
}

function applyRowSwipeResistance(rawOffset, canLeft, canRight, width) {
  const { left: leftFull, right: rightFull } = getRowSwipeFullThresholds(width);
  if (rawOffset < 0) {
    if (!canLeft) return rawOffset * 0.16;
    const abs = -rawOffset;
    if (abs <= ROW_SWIPE_REVEAL_OFFSET) return rawOffset;
    const damped =
      ROW_SWIPE_REVEAL_OFFSET + (abs - ROW_SWIPE_REVEAL_OFFSET) * 0.78;
    if (damped <= leftFull) return -damped;
    return -(leftFull + (damped - leftFull) * 0.22);
  }
  if (rawOffset > 0) {
    if (!canRight) return rawOffset * 0.16;
    if (rawOffset <= ROW_SWIPE_REVEAL_OFFSET) return rawOffset;
    const damped =
      ROW_SWIPE_REVEAL_OFFSET + (rawOffset - ROW_SWIPE_REVEAL_OFFSET) * 0.78;
    if (damped <= rightFull) return damped;
    return rightFull + (damped - rightFull) * 0.22;
  }
  return 0;
}

function getRowSwipeSpringDuration(distancePx) {
  return Math.round(
    Math.min(310, Math.max(180, 170 + Math.abs(distancePx) * 0.6)),
  );
}

function updateRowSwipeVisuals(shell, offset, isPastThreshold) {
  if (!shell) return;
  const abs = Math.abs(offset);
  const progress = Math.min(1, abs / ROW_SWIPE_REVEAL_OFFSET);
  shell.style.setProperty("--swipe-p", progress.toFixed(3));
  let tx = 0;
  if (offset < 0) {
    if (isPastThreshold) {
      tx = -(abs - ROW_SWIPE_REVEAL_OFFSET);
    } else if (abs < ROW_SWIPE_REVEAL_OFFSET) {
      tx = (ROW_SWIPE_REVEAL_OFFSET - abs) / 2;
    }
  } else if (offset > 0) {
    if (isPastThreshold) {
      tx = abs - ROW_SWIPE_REVEAL_OFFSET;
    } else if (abs < ROW_SWIPE_REVEAL_OFFSET) {
      tx = -(ROW_SWIPE_REVEAL_OFFSET - abs) / 2;
    }
  }
  shell.style.setProperty("--swipe-tx", `${tx.toFixed(1)}px`);
}

function HeroAmountField({
  value,
  onChange,
  onBlur,
  inputRef,
  placeholder = "0",
  ariaLabel = "Amount in taka",
  enterKeyHint = "done",
  onEnter,
  hasError = false,
  errorMessage = "",
}) {
  const raw = String(value ?? "");
  const displayStr = raw.length > 0 ? raw : String(placeholder || "0");
  const charLen = Math.max(displayStr.length, 1);
  const inputWidthCh = Math.min(12.5, Math.max(1.25, charLen * 0.96 + 0.35));
  const scaleClass =
    displayStr.length >= 9
      ? "is-compact"
      : displayStr.length >= 6
        ? "is-medium"
        : "";

  return (
    <>
      <div
        className={`amt amt-hero-redesigned ${raw ? "has-value" : "is-empty"} ${scaleClass}${hasError ? " is-error" : ""}`}
        onClick={(e) => {
          if (e.target !== inputRef?.current) {
            inputRef?.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="amt-hero-inner">
          <span className="amt-hero-currency" aria-hidden="true">
            ৳
          </span>
          <input
            name="amount"
            ref={inputRef}
            className="amt-hero-input"
            type="text"
            inputMode="decimal"
            enterKeyHint={enterKeyHint || "done"}
            aria-label={ariaLabel}
            aria-invalid={hasError ? "true" : undefined}
            placeholder={placeholder}
            value={raw}
            style={{ width: `${inputWidthCh}ch` }}
            onBlur={onBlur}
            onChange={(e) => {
              let next = e.target.value
                .replace(/,/g, ".")
                .replace(/[^0-9.]/g, "");
              if (next.startsWith(".")) {
                next = "0" + next;
              }
              next = next.replace(/^0+(?=\d)/, "");
              const firstDot = next.indexOf(".");
              if (firstDot !== -1) {
                const intPart = next.slice(0, firstDot).slice(0, 9);
                const decPart = next
                  .slice(firstDot + 1)
                  .replace(/\./g, "")
                  .slice(0, 2);
                next = `${intPart}.${decPart}`;
              } else {
                next = next.slice(0, 9);
              }
              onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter?.(e);
              }
            }}
          />
          {raw.length > 0 && (
            <button
              type="button"
              className="amt-hero-clear"
              aria-label="Clear amount"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic("light");
                onChange("");
                inputRef?.current?.focus({ preventScroll: true });
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                aria-hidden="true"
              >
                <path d="m18 6-12 12M6 6l12 12" strokeWidth="2.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {errorMessage ? (
        <p className="field-error-msg" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

const ExpenseRow = memo(function ExpenseRow({
  e,
  cards = [],
  deletedCards = null,
  onOpen,
  onDelete,
  onSkip,
  onDuplicate,
  onOpenTransaction,
  onDeleteTransaction,
  suggestion = "",
  isNew = false,
}) {
  const isTx = e?.sourceType === "tx";
  const [, c] = CAT[e?.cat] || CAT.Other || ["", "#64748b"];
  const txColors = {
    income: "#10b981",
    transfer: "#2563eb",
    adjust: "#8b5cf6",
    adjustment: "#8b5cf6",
  };
  const iconColor = isTx
    ? txColors[e?.type] || "#8b5cf6"
    : getCategoryColor(e?.cat, e?.desc) || c;
  const pointerRef = useRef(null);
  const rowRef = useRef(null);
  const shellRef = useRef(null);
  const holdTimerRef = useRef();
  const swipeTimerRef = useRef();
  const collapseTimerRef = useRef();
  const closeTimerRef = useRef();
  const duplicatePressTimerRef = useRef();
  const suppressClickTimerRef = useRef();
  const suppressClickRef = useRef(false);
  const dragFrameRef = useRef(null);
  const pendingOffsetRef = useRef(0);
  const [swipe, setSwipe] = useState({ offset: 0, phase: "idle" });
  const [duplicatePress, setDuplicatePress] = useState(false);
  const swipeRef = useRef(swipe);
  const canDelete = Boolean(isTx ? onDeleteTransaction || onDelete : onDelete);
  const canDuplicate = Boolean(onDuplicate && !isTx);
  const canQuickEdit = Boolean(isTx ? onOpenTransaction || onOpen : onOpen);
  const canSwipeRight = canDuplicate || canQuickEdit;

  const updateSwipe = (next) => {
    swipeRef.current = next;
    setSwipe(next);
  };

  const clearHoldTimer = () => {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = undefined;
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
    }, 500);
  };

  const springRowClosed = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    const prevOffset = pendingOffsetRef.current || swipeRef.current.offset || 0;
    const hasOffset = Math.abs(prevOffset) > 1;
    const duration = getRowSwipeSpringDuration(prevOffset);
    pendingOffsetRef.current = 0;
    shellRef.current?.removeAttribute("data-threshold");
    shellRef.current?.classList.remove("is-dragging", "is-swipe-dragging");
    shellRef.current?.style.setProperty("--swipe-tx", "0px");
    if (rowRef.current) {
      rowRef.current.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      rowRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (hasOffset) {
      shellRef.current?.classList.add("is-closing");
      updateSwipe({ offset: 0, phase: "closing" });
      closeTimerRef.current = setTimeout(() => {
        shellRef.current?.classList.remove("is-closing");
        shellRef.current?.removeAttribute("data-swipe-dir");
        shellRef.current?.style.removeProperty("--swipe-p");
        shellRef.current?.style.removeProperty("--swipe-tx");
        updateSwipe({ offset: 0, phase: "idle" });
        if (rowRef.current) {
          rowRef.current.style.transition = "";
          rowRef.current.style.transform = "";
        }
      }, duration);
    } else {
      shellRef.current?.classList.remove("is-closing");
      shellRef.current?.removeAttribute("data-swipe-dir");
      shellRef.current?.style.removeProperty("--swipe-p");
      shellRef.current?.style.removeProperty("--swipe-tx");
      updateSwipe({ offset: 0, phase: "idle" });
      if (rowRef.current) {
        rowRef.current.style.transition = "";
        rowRef.current.style.transform = "";
      }
    }
  }, []);

  const executeRightSwipeAction = useCallback(() => {
    springRowClosed();
    if (canDuplicate) {
      const duplicated = onDuplicate(e);
      if (duplicated !== false) {
        triggerHaptic("medium");
        setDuplicatePress(true);
        clearTimeout(duplicatePressTimerRef.current);
        duplicatePressTimerRef.current = setTimeout(
          () => setDuplicatePress(false),
          520,
        );
      }
    } else if (canQuickEdit) {
      triggerHaptic("selection");
      if (isTx && onOpenTransaction) onOpenTransaction(e.id);
      else onOpen?.(e.id);
    }
  }, [
    canDuplicate,
    canQuickEdit,
    e,
    isTx,
    onDuplicate,
    onOpen,
    onOpenTransaction,
    springRowClosed,
  ]);

  // Senior Native Dev Swipe-to-Delete Pipeline
  const executeDeleteAnimation = useCallback(
    (commitAction) => {
      const commit =
        commitAction ||
        (isTx
          ? onDeleteTransaction || onDelete
          : e.rec && onSkip
            ? onSkip
            : onDelete);
      if (!commit) return;

      // Lock row click handlers across the list so iOS tap-delete never triggers
      // Edit expense on the next row shifting up underneath the active touch
      lockRowClicksAfterDelete(700);
      suppressClickRef.current = true;

      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }

      // Haptic confirmation
      triggerHaptic("delete");

      // Phase 1: Fluid slide out of viewport
      shellRef.current?.setAttribute("data-swipe-dir", "left");
      shellRef.current?.style.setProperty("--swipe-p", "1");
      updateSwipe({ offset: -350, phase: "deleting" });
      if (rowRef.current) {
        rowRef.current.style.transition =
          "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
        rowRef.current.style.transform = "translate3d(-105%, 0, 0)";
      }

      // Phase 2: Height collapses smoothly to 0 so list beneath slides up
      clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = setTimeout(() => {
        updateSwipe({ offset: -350, phase: "collapsing" });

        // Phase 3: Commit state deletion cleanly after height animation finishes
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = setTimeout(() => {
          lockRowClicksAfterDelete(320);
          commit(e.id);
        }, 260);
      }, 220);
    },
    [e.id, e.rec, isTx, onDelete, onDeleteTransaction, onSkip],
  );

  useEffect(
    () => () => {
      clearHoldTimer();
      clearTimeout(swipeTimerRef.current);
      clearTimeout(collapseTimerRef.current);
      clearTimeout(closeTimerRef.current);
      clearTimeout(duplicatePressTimerRef.current);
      clearTimeout(suppressClickTimerRef.current);
      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
      }
    },
    [],
  );

  // Automatically reset to idle when tapping anywhere outside if revealed
  useEffect(() => {
    if (swipe.phase !== "revealed") return undefined;
    const handleOutside = (event) => {
      if (
        rowRef.current &&
        !rowRef.current.contains(event.target) &&
        (!shellRef.current || !shellRef.current.contains(event.target))
      ) {
        springRowClosed();
      }
    };
    window.addEventListener("pointerdown", handleOutside, true);
    return () => window.removeEventListener("pointerdown", handleOutside, true);
  }, [swipe.phase, springRowClosed]);

  const startGesture = (event) => {
    if (!canDelete && !canSwipeRight) return;
    if (event.button != null && event.button !== 0) return;
    if (["deleting", "collapsing"].includes(swipeRef.current.phase)) return;
    const initialOffset = swipeRef.current.offset;
    // Dynamic Android 32px right-edge deadzone: prevent left-swipe row gesture from fighting Android system Back swipe
    // (On iOS, system Back only swipes from the left edge, so right-edge row swipes remain unrestricted)
    const viewportWidth =
      typeof window !== "undefined"
        ? window.innerWidth || document.documentElement.clientWidth || 360
        : 360;
    if (
      initialOffset === 0 &&
      isAndroidPlatform() &&
      typeof event.clientX === "number" &&
      event.clientX >= viewportWidth - ANDROID_RIGHT_EDGE_DEADZONE_PX
    ) {
      return;
    }
    clearHoldTimer();
    clearTimeout(swipeTimerRef.current);
    clearTimeout(collapseTimerRef.current);
    clearTimeout(closeTimerRef.current);
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }

    if (rowRef.current) {
      rowRef.current.style.transition = "none";
    }
    const width = rowRef.current?.offsetWidth || 320;

    const now = performance.now();
    pointerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lockOriginX: event.clientX,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX: 0,
      startedAt: now,
      width,
      moved: false,
      longPressTriggered: false,
      horizontal: false,
      vertical: false,
      draggingStateApplied: false,
      initialOffset,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      passedHaptic: false,
    };
    pendingOffsetRef.current = initialOffset;
    suppressClickRef.current = false;

    if (onDuplicate && !isTx) {
      holdTimerRef.current = setTimeout(() => {
        const gesture = pointerRef.current;
        if (!gesture || gesture.moved) return;
        gesture.longPressTriggered = true;
        suppressClickRef.current = true;
        clearTimeout(suppressClickTimerRef.current);
        const duplicated = onDuplicate(e);
        if (duplicated === false) return;
        triggerHaptic("medium");
        setDuplicatePress(true);
        clearTimeout(duplicatePressTimerRef.current);
        duplicatePressTimerRef.current = setTimeout(
          () => setDuplicatePress(false),
          520,
        );
      }, 560);
    }
  };

  const moveGesture = (event) => {
    const gesture = pointerRef.current;
    if (!gesture || gesture.longPressTriggered || gesture.vertical) return;
    if (gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > 6 || absDy > 6) {
      gesture.moved = true;
      clearHoldTimer();
    }

    if (!gesture.horizontal && (canDelete || canSwipeRight)) {
      if (
        gesture.initialOffset === 0 &&
        absDy > ROW_SWIPE_LOCK_DISTANCE &&
        absDy > absDx
      ) {
        gesture.vertical = true;
        return;
      }

      const isHorizontalIntent =
        (absDx > ROW_SWIPE_LOCK_DISTANCE &&
          absDx > absDy * ROW_SWIPE_LOCK_RATIO) ||
        (gesture.initialOffset !== 0 && absDx > 6);

      if (isHorizontalIntent) {
        gesture.horizontal = true;
        gesture.lockOriginX = event.clientX;
        gesture.lastX = event.clientX;
        gesture.lastTime = performance.now();
        gesture.velocityX = 0;
        suppressNextClick();
        rowRef.current?.classList.add("is-swipe-dragging");
        shellRef.current?.classList.remove("is-closing");
        shellRef.current?.classList.add("is-dragging", "is-swipe-dragging");
        try {
          event.currentTarget.setPointerCapture(gesture.pointerId);
        } catch {}
        if (!gesture.draggingStateApplied) {
          gesture.draggingStateApplied = true;
          updateSwipe({
            offset: gesture.initialOffset,
            phase: "dragging",
          });
        }
      }
    }

    if (gesture.horizontal) {
      const now = performance.now();
      const dt = Math.max(1, now - gesture.lastTime);
      const instantVelocity = (event.clientX - gesture.lastX) / dt;
      gesture.velocityX = gesture.velocityX * 0.4 + instantVelocity * 0.6;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      gesture.lastTime = now;

      const effectiveDx = event.clientX - gesture.lockOriginX;
      const targetOffset = applyRowSwipeResistance(
        gesture.initialOffset + effectiveDx,
        canDelete,
        canSwipeRight,
        gesture.width,
      );

      if (targetOffset < -1) {
        shellRef.current?.setAttribute("data-swipe-dir", "left");
      } else if (targetOffset > 1) {
        shellRef.current?.setAttribute("data-swipe-dir", "right");
      } else {
        shellRef.current?.removeAttribute("data-swipe-dir");
      }

      const { left: deleteThreshold, right: rightThreshold } =
        getRowSwipeFullThresholds(gesture.width);
      const isPastThreshold =
        (canDelete && targetOffset <= -deleteThreshold) ||
        (canSwipeRight && targetOffset >= rightThreshold);
      if (isPastThreshold && !gesture.passedHaptic) {
        gesture.passedHaptic = true;
        triggerHaptic("medium");
        shellRef.current?.setAttribute("data-threshold", "true");
      } else if (!isPastThreshold && gesture.passedHaptic) {
        gesture.passedHaptic = false;
        shellRef.current?.removeAttribute("data-threshold");
      }

      pendingOffsetRef.current = targetOffset;
      swipeRef.current.offset = targetOffset;

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          dragFrameRef.current = null;
          const offset = pendingOffsetRef.current;
          if (rowRef.current) {
            rowRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
          }
          updateRowSwipeVisuals(
            shellRef.current,
            offset,
            Boolean(pointerRef.current?.passedHaptic),
          );
        });
      }
    }
  };

  const endGesture = (event) => {
    clearHoldTimer();
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const gesture = pointerRef.current;
    pointerRef.current = null;

    if (!gesture) return;

    try {
      if (event?.currentTarget?.hasPointerCapture?.(gesture.pointerId)) {
        event.currentTarget.releasePointerCapture(gesture.pointerId);
      }
    } catch {}

    rowRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.classList.remove("is-dragging", "is-swipe-dragging");
    shellRef.current?.removeAttribute("data-threshold");

    const snapToRevealed = (dir) => {
      const target = dir === "left" ? -ROW_SWIPE_REVEAL_OFFSET : ROW_SWIPE_REVEAL_OFFSET;
      const duration = getRowSwipeSpringDuration(pendingOffsetRef.current - target);
      pendingOffsetRef.current = target;
      shellRef.current?.setAttribute("data-swipe-dir", dir);
      shellRef.current?.style.setProperty("--swipe-p", "1");
      shellRef.current?.style.setProperty("--swipe-tx", "0px");
      updateSwipe({ offset: target, phase: "revealed" });
      if (rowRef.current) {
        rowRef.current.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        rowRef.current.style.transform = `translate3d(${target}px, 0, 0)`;
      }
    };

    if (event?.type === "pointercancel") {
      if (gesture.initialOffset === -ROW_SWIPE_REVEAL_OFFSET) {
        snapToRevealed("left");
      } else if (gesture.initialOffset === ROW_SWIPE_REVEAL_OFFSET) {
        snapToRevealed("right");
      } else {
        springRowClosed();
      }
      return;
    }

    if (gesture.horizontal && (canDelete || canSwipeRight)) {
      const effectiveDx = (event?.clientX ?? gesture.lastX) - gesture.lockOriginX;
      const currentOffset = pendingOffsetRef.current;
      const isRecentMove = performance.now() - gesture.lastTime < 90;
      const velocity = isRecentMove ? gesture.velocityX : 0;
      const { left: deleteThreshold, right: rightThreshold } =
        getRowSwipeFullThresholds(gesture.width);

      suppressNextClick();

      // Full-swipe commit ONLY when intentionally dragged past the deep threshold
      // (quick flicks reveal the action button cleanly, like native iOS/Android lists)
      const shouldFullDelete = canDelete && currentOffset <= -deleteThreshold;
      const shouldFullRightAction =
        canSwipeRight && currentOffset >= rightThreshold;

      if (shouldFullDelete) {
        executeDeleteAnimation();
      } else if (shouldFullRightAction) {
        executeRightSwipeAction();
      } else if (gesture.initialOffset < 0) {
        const closingFlick = effectiveDx > 16 && velocity > 0.25;
        if (closingFlick || currentOffset > -52) {
          springRowClosed();
        } else {
          snapToRevealed("left");
        }
      } else if (gesture.initialOffset > 0) {
        const closingFlick = effectiveDx < -16 && velocity < -0.25;
        if (closingFlick || currentOffset < 52) {
          springRowClosed();
        } else {
          snapToRevealed("right");
        }
      } else if (
        canDelete &&
        (currentOffset <= -ROW_SWIPE_REVEAL_THRESHOLD ||
          (effectiveDx < -24 && velocity < -0.32))
      ) {
        snapToRevealed("left");
      } else if (
        canSwipeRight &&
        (currentOffset >= ROW_SWIPE_REVEAL_THRESHOLD ||
          (effectiveDx > 24 && velocity > 0.32))
      ) {
        snapToRevealed("right");
      } else {
        springRowClosed();
      }
    }
  };

  const hasExplicitSign = typeof e?.signedDirection === "string";
  const isPositive = hasExplicitSign
    ? e.signedDirection === "positive"
    : isTx
      ? e.type === "income" ||
        ((e.type === "adjust" || e.type === "adjustment") &&
          isAdjustmentIncrease(e))
      : e.type === "income" || e.type === "refund" || Boolean(e.refund);

  const isSavings = !hasExplicitSign && !isTx && e?.cat === "Savings";

  const isNeutral = hasExplicitSign ? e.signedDirection === "neutral" : false;
  const amountClass = isPositive
    ? "am is-positive"
    : isSavings
      ? "am is-savings"
      : isNeutral
        ? "am is-neutral"
        : "am is-negative";
  const amountPrefix = isPositive ? "+" : isSavings || isNeutral ? "" : "−";

  const title = isTx
    ? e.note ||
      e.title ||
      (e.type === "income"
        ? "Income"
        : e.type === "transfer"
          ? "Transfer"
          : "Balance adjustment")
    : e.desc || "Untitled expense";

  const gestureHint =
    canDelete && (onDuplicate || isTx)
      ? e.rec
        ? "Tap to edit, swipe left to skip this occurrence, or swipe right to duplicate."
        : isTx
          ? canQuickEdit
            ? "Tap to edit, swipe left to delete, or swipe right to edit."
            : "Tap to edit or swipe left to delete."
          : "Tap to edit, swipe left to delete, or swipe right to duplicate."
      : "Tap to edit.";

  const rowClasses = [
    "ri",
    "expense-row",
    isNew && "is-new",
    duplicatePress && "is-duplicate-press",
    swipe.phase === "dragging" && "is-swipe-dragging",
    swipe.phase === "revealed" && "is-swipe-revealed",
    ["deleting", "collapsing"].includes(swipe.phase) && "is-swipe-deleting",
  ]
    .filter(Boolean)
    .join(" ");

  const row = (
    <button
      ref={rowRef}
      className={rowClasses}
      type="button"
      aria-label={
        isTx
          ? `${title}, ${amountPrefix}${M(e?.amt || 0)}. ${gestureHint}`
          : `${e?.desc || "Untitled expense"}, ${e?.amt != null ? M(e.amt) : "No amount"}${e?.cat === "Savings" ? ", savings transfer" : ""}. ${gestureHint}`
      }
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Delete" || event.key === "Backspace") {
          if (canDelete) {
            event.preventDefault();
            executeDeleteAnimation();
          }
        } else if (event.key === "d" || event.key === "D") {
          if (onDuplicate && !isTx && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            onDuplicate(e);
          }
        }
      }}
      onClick={(event) => {
        if (isRowClickLocked()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          clearTimeout(suppressClickTimerRef.current);
          return;
        }
        if (
          swipeRef.current.phase === "revealed" ||
          swipeRef.current.phase === "deleting" ||
          swipeRef.current.phase === "collapsing" ||
          swipeRef.current.offset !== 0
        ) {
          springRowClosed();
          return;
        }
        if (isTx) {
          if (onOpenTransaction) onOpenTransaction(e.id);
          else onOpen?.(e.id);
        } else {
          onOpen?.(e.id);
        }
      }}
    >
      <i className="ic" style={{ "--c": iconColor }}>
        {isTx ? (
          <TransactionSymbol type={e.type} />
        ) : (
          <CategorySymbol category={e.cat} description={e.desc} />
        )}
      </i>
      <span className="nm">
        <b>{title}</b>
        <small>
          {e.customMeta ? (
            <>
              <span className="expense-meta-line">{e.customMeta}</span>
              {e.customSubNote && (
                <span className="accounts-tx-adj-note">{e.customSubNote}</span>
              )}
            </>
          ) : isTx ? (
            <span className="expense-meta-line">
              {e.type === "transfer"
                ? `Transfer · ${getAccountDisplay(e.from || e.acct, cards, deletedCards)[0]} → ${getAccountDisplay(e.to, cards, deletedCards)[0]}`
                : e.type === "income"
                  ? `Income · ${getAccountDisplay(e.acct, cards, deletedCards)[0]}`
                  : `${isAdjustmentIncrease(e) ? "Balance increased" : "Balance decreased"} · ${getAccountDisplay(e.acct, cards, deletedCards)[0]}`}
            </span>
          ) : (
            <>
              <span className="expense-meta-line">
                {e.cat}
                {cards.length > 0 || (e.acct && e.acct !== "cash")
                  ? " · " + getAccountDisplay(e.acct, cards, deletedCards)[0]
                  : ""}
                {e.rec ? " · Recurring" : ""}
              </span>
              {suggestion && suggestion !== e.cat ? (
                <span
                  className="category-suggestion-inline"
                  style={{
                    "--c":
                      getCategoryColor(suggestion, e?.desc) ||
                      CAT[suggestion]?.[1] ||
                      "#64748b",
                  }}
                >
                  <span className="category-suggestion-sep" aria-hidden="true">
                    {" · "}
                  </span>
                  <span className="category-suggestion-label">Suggested:</span>
                  <CategorySuggestionValue
                    category={suggestion}
                    description={e?.desc}
                  />
                </span>
              ) : null}
            </>
          )}
        </small>
      </span>
      {e.amt == null ? (
        <em className="na">Add amount</em>
      ) : (
        <b className={amountClass}>
          {amountPrefix}
          {M(e.amt)}
        </b>
      )}
    </button>
  );

  if (!canDelete && !canSwipeRight) return row;

  return (
    <div
      ref={shellRef}
      className={`expense-swipe-shell${swipe.phase === "dragging" ? " is-dragging" : ""}${swipe.phase === "revealed" ? " is-revealed" : ""}${swipe.phase === "closing" ? " is-closing" : ""}${["deleting", "collapsing"].includes(swipe.phase) ? " is-deleting" : ""}${swipe.phase === "collapsing" ? " is-collapsing" : ""}${e.rec ? " is-skip-shell" : ""}${swipe.offset > 0 ? " is-right-swipe" : ""}`}
    >
      {/* Left-to-Right Swipe Action Button (Duplicate / Edit) */}
      {canSwipeRight && (
        <button
          className={`expense-swipe-delete is-left ${canDuplicate ? "is-duplicate" : "is-edit"}`}
          type="button"
          tabIndex={swipe.phase === "revealed" && swipe.offset > 0 ? 0 : -1}
          inert={
            !(swipe.phase === "revealed" && swipe.offset > 0) ? true : undefined
          }
          aria-label={canDuplicate ? `Duplicate ${title}` : `Edit ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            event.currentTarget.blur();
            executeRightSwipeAction();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {canDuplicate ? (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </>
            ) : (
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            )}
          </svg>
          <span>{canDuplicate ? "Repeat" : "Edit"}</span>
        </button>
      )}

      {/* Right-to-Left Swipe Delete Action Button */}
      {canDelete && (
        <button
          className={`expense-swipe-delete is-right${e.rec ? " is-skip" : ""}`}
          type="button"
          tabIndex={swipe.phase === "revealed" && swipe.offset < 0 ? 0 : -1}
          inert={
            !(swipe.phase === "revealed" && swipe.offset < 0) ? true : undefined
          }
          aria-label={
            e.rec ? `Skip ${title} for this occurrence` : `Delete ${title}`
          }
          onPointerDown={(event) => {
            event.stopPropagation();
            lockRowClicksAfterDelete(450);
          }}
          onTouchStart={(event) => {
            event.stopPropagation();
            lockRowClicksAfterDelete(450);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            lockRowClicksAfterDelete(700);
            event.currentTarget.blur();
            executeDeleteAnimation();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {e.rec ? (
              <path d="M4 5h16v15H4zM8 3v4m8-4v4M4 10h16m-8 3v4m-2-2h4" />
            ) : (
              <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v6m4-6v6" />
            )}
          </svg>
          <span>{e.rec ? "Skip" : "Delete"}</span>
        </button>
      )}

      {row}
    </div>
  );
});

function Sheet({
  onClose,
  children,
  actions,
  actionsClassName = "",
  contentRef,
}) {
  const dragRef = useRef(null);
  const sheetRef = useRef(null);
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const setScrollNode = useCallback(
    (node) => {
      scrollRef.current = node;
      if (typeof contentRef === "function") {
        contentRef(node);
      } else if (contentRef && typeof contentRef === "object") {
        contentRef.current = node;
      }
    },
    [contentRef],
  );
  const rAFRef = useRef(null);
  const pendingDyRef = useRef(0);
  const [detent, setDetent] = useState("default"); // "default" | "expanded"
  const detentRef = useRef("default");

  const updateDetent = useCallback((nextDetent) => {
    detentRef.current = nextDetent;
    setDetent(nextDetent);
  }, []);

  const setRootDragProgress = useCallback((progressValue) => {
    const root = sheetRef.current?.closest(".mobile-prototype");
    if (!root) return;
    if (progressValue == null) {
      root.style.removeProperty("--sheet-drag-progress");
    } else {
      root.style.setProperty(
        "--sheet-drag-progress",
        String(Math.max(0, Math.min(1, progressValue)).toFixed(3)),
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
      const root = document.querySelector(".mobile-prototype");
      root?.style.removeProperty("--sheet-drag-progress");
    };
  }, []);

  useLayoutEffect(() => {
    const sheetNode = sheetRef.current;
    if (!sheetNode) return;

    // Check if there is an explicit autofocus target or a primary amount input field
    const autoFocusTarget = sheetNode.querySelector(
      "[data-sheet-autofocus], .amt input, input[autofocus]",
    );

    sheetNode.focus({ preventScroll: true });

    if (autoFocusTarget && typeof autoFocusTarget.focus === "function") {
      const focusTarget = () => {
        if (!sheetNode.contains(autoFocusTarget)) return;
        if (dragRef.current?.active) return;
        if (
          document.activeElement &&
          sheetNode.contains(document.activeElement) &&
          document.activeElement !== sheetNode
        ) {
          return;
        }
        try {
          autoFocusTarget.focus({ preventScroll: true });
          if (
            typeof autoFocusTarget.select === "function" &&
            autoFocusTarget.value
          ) {
            autoFocusTarget.select();
          }
        } catch {
          // ignore
        }
      };

      // Dynamically delay auto-focus (300ms on Android IME, 280ms on iOS/Web) until the sheet
      // entrance transition finishes so keyboard resize never janks or clips the sticky Save footer
      const focusDelayMs = isAndroidPlatform() ? 300 : 280;
      const timer = setTimeout(focusTarget, focusDelayMs);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const sheetNode = sheetRef.current;
      if (!sheetNode) return;
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (dialogs[dialogs.length - 1] !== sheetNode) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sheetNode.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (node) => !node.closest('[aria-hidden="true"], [inert], [hidden]'),
      );
      if (!focusable.length) {
        event.preventDefault();
        sheetNode.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusIsInside = sheetNode.contains(activeElement);
      if (
        event.shiftKey &&
        (!focusIsInside ||
          activeElement === sheetNode ||
          activeElement === first)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (!focusIsInside ||
          activeElement === sheetNode ||
          activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const suppressClickRef = useRef(false);

  const startDrag = useCallback((clientY) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const sheetNode = sheetRef.current;
    const overlayNode = overlayRef.current;
    if (!sheetNode) return;

    if (rAFRef.current) {
      cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;
    }

    const sheetHeight = sheetNode.offsetHeight || 440;
    dragRef.current = {
      startY: clientY,
      currentOffset: 0,
      recentPoints: [{ y: clientY, t: performance.now() }],
      sheetHeight,
      active: true,
    };

    sheetNode.setAttribute("data-dragging", "true");
    sheetNode.style.animation = "none";
    sheetNode.style.transition = "none";
    if (overlayNode) overlayNode.style.transition = "none";
  }, []);

  const moveDrag = useCallback(
    (clientY) => {
      const drag = dragRef.current;
      if (!drag || !drag.active) return;

      const now = performance.now();
      drag.recentPoints.push({ y: clientY, t: now });
      if (drag.recentPoints.length > 5) {
        drag.recentPoints.shift();
      }

      let offset = clientY - drag.startY;
      if (offset < 0) {
        offset =
          detentRef.current === "expanded" ? offset * 0.16 : offset * 0.35;
      }
      drag.currentOffset = offset;
      pendingDyRef.current = offset;

      if (!rAFRef.current) {
        rAFRef.current = requestAnimationFrame(() => {
          rAFRef.current = null;
          if (!dragRef.current?.active) return;
          const currentOffset = pendingDyRef.current;
          if (sheetRef.current) {
            sheetRef.current.style.transform = `translate3d(0, ${currentOffset}px, 0)`;
          }
          const dragDismissRatio = Math.max(
            0,
            Math.min(1, currentOffset / (drag.sheetHeight * 0.85)),
          );
          setRootDragProgress(dragDismissRatio);
          if (overlayRef.current) {
            const progress = 1 - dragDismissRatio;
            overlayRef.current.style.opacity = progress.toFixed(3);
          }
        });
      }
    },
    [setRootDragProgress],
  );

  const endDrag = useCallback(() => {
    if (rAFRef.current) {
      cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.active) return;

    let velocity = 0;
    if (drag.recentPoints.length >= 2) {
      const oldest = drag.recentPoints[0];
      const newest = drag.recentPoints[drag.recentPoints.length - 1];
      const dt = Math.max(1, newest.t - oldest.t);
      velocity = (newest.y - oldest.y) / dt;
    }

    const distance = drag.currentOffset;
    const sheetHeight = drag.sheetHeight;

    // Upward pull snaps to 92% expanded detent
    if (
      detentRef.current === "default" &&
      (distance <= -28 || velocity < -0.35)
    ) {
      triggerHaptic("selection");
      updateDetent("expanded");
      setRootDragProgress(0);
      const sheetNode = sheetRef.current;
      if (sheetNode) {
        sheetNode.removeAttribute("data-dragging");
        sheetNode.style.transition =
          "transform 280ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetNode.style.transform = "translate3d(0, 0, 0)";
        window.setTimeout(() => {
          setRootDragProgress(null);
          if (sheetNode && !dragRef.current?.active) {
            sheetNode.style.transition = "";
            sheetNode.style.transform = "";
          }
        }, 290);
      }
      return;
    }

    // Downward pull from expanded detent snaps back to default detent unless flicked hard
    if (
      detentRef.current === "expanded" &&
      distance >= 36 &&
      distance < sheetHeight * 0.42 &&
      velocity <= 0.65
    ) {
      triggerHaptic("selection");
      updateDetent("default");
      setRootDragProgress(0);
      const sheetNode = sheetRef.current;
      const overlayNode = overlayRef.current;
      if (sheetNode) {
        sheetNode.removeAttribute("data-dragging");
        sheetNode.style.transition =
          "transform 280ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetNode.style.transform = "translate3d(0, 0, 0)";
      }
      if (overlayNode) {
        overlayNode.style.transition =
          "opacity 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        overlayNode.style.opacity = "1";
      }
      window.setTimeout(() => {
        setRootDragProgress(null);
        if (sheetNode && !dragRef.current?.active) {
          sheetNode.style.transition = "";
          sheetNode.style.transform = "";
        }
        if (overlayNode && !dragRef.current?.active) {
          overlayNode.style.transition = "";
          overlayNode.style.opacity = "";
        }
      }, 290);
      return;
    }

    const shouldClose =
      distance >= 70 ||
      distance >= sheetHeight * 0.18 ||
      (distance >= 25 && velocity > 0.35);

    const sheetNode = sheetRef.current;
    const overlayNode = overlayRef.current;

    if (shouldClose) {
      triggerHaptic("selection");
      setRootDragProgress(1);

      if (sheetNode) {
        sheetNode.removeAttribute("data-dragging");
        sheetNode.style.transition =
          "transform 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetNode.style.transform = "translate3d(0, 100%, 0)";
      }
      if (overlayNode) {
        overlayNode.style.transition =
          "opacity 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        overlayNode.style.opacity = "0";
      }

      window.setTimeout(() => {
        setRootDragProgress(null);
        onClose({ kind: "drag", distance, velocity });
      }, 240);
    } else {
      setRootDragProgress(0);
      if (sheetNode) {
        sheetNode.removeAttribute("data-dragging");
        sheetNode.style.transition =
          "transform 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetNode.style.transform = "translate3d(0, 0, 0)";
      }
      if (overlayNode) {
        overlayNode.style.transition =
          "opacity 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        overlayNode.style.opacity = "1";
      }

      window.setTimeout(() => {
        setRootDragProgress(null);
        if (sheetNode && !dragRef.current?.active) {
          sheetNode.style.transition = "";
          sheetNode.style.transform = "";
        }
        if (overlayNode && !dragRef.current?.active) {
          overlayNode.style.transition = "";
          overlayNode.style.opacity = "";
        }
      }, 270);
    }
  }, [onClose, setRootDragProgress, updateDetent]);

  const onTopPointerDown = useCallback(
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("button, input, textarea, select")) return;

      const pointerId = event.pointerId;
      startDrag(event.clientY);

      const onPointerMove = (e) => {
        if (e.pointerId !== pointerId) return;
        moveDrag(e.clientY);
      };

      const onPointerUp = (e) => {
        if (e.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        endDrag();
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerUp, { passive: true });
    },
    [startDrag, moveDrag, endDrag],
  );

  useEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return undefined;

    let touchStartY = 0;
    let touchStartX = 0;
    let initialScrollTop = 0;
    let isPulling = false;
    let ignoreTouch = false;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1 || dragRef.current?.active) {
        ignoreTouch = true;
        return;
      }
      if (e.target instanceof Element && e.target.closest(".seg-ctrl")) {
        ignoreTouch = true;
        return;
      }
      ignoreTouch = false;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      initialScrollTop = scrollNode.scrollTop;
      isPulling = false;
    };

    const onTouchMove = (e) => {
      if (ignoreTouch || e.touches.length !== 1) return;
      if (!isPulling && dragRef.current?.active) return;
      const clientY = e.touches[0].clientY;
      const clientX = e.touches[0].clientX;
      const dy = clientY - touchStartY;
      const dx = clientX - touchStartX;

      if (isPulling) {
        if (e.cancelable) e.preventDefault();
        moveDrag(clientY);
        return;
      }

      if (
        initialScrollTop <= 0 &&
        scrollNode.scrollTop <= 0 &&
        dy > 8 &&
        dy > Math.abs(dx) * 1.1
      ) {
        isPulling = true;
        suppressClickRef.current = true;
        if (e.cancelable) e.preventDefault();
        startDrag(clientY);
      }
    };

    const onTouchEnd = () => {
      ignoreTouch = false;
      if (isPulling) {
        isPulling = false;
        endDrag();
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 250);
      }
    };

    scrollNode.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollNode.addEventListener("touchmove", onTouchMove, { passive: false });
    scrollNode.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollNode.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      scrollNode.removeEventListener("touchstart", onTouchStart);
      scrollNode.removeEventListener("touchmove", onTouchMove);
      scrollNode.removeEventListener("touchend", onTouchEnd);
      scrollNode.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [startDrag, moveDrag, endDrag]);

  return (
    <div
      ref={overlayRef}
      className="ov"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`sh${detent === "expanded" ? " is-expanded-detent" : ""}`}
        data-detent={detent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div
          className="sheet-drag-zone"
          onPointerDown={onTopPointerDown}
          onDoubleClick={() => {
            triggerHaptic("selection");
            updateDetent(detent === "expanded" ? "default" : "expanded");
          }}
        >
          <div className="grab" aria-hidden="true" />
          <button
            type="button"
            className="sheet-close-btn"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic("light");
              onClose();
            }}
          >
            <Icon n="x" />
          </button>
        </div>
        <div
          ref={setScrollNode}
          className="sheet-content"
          onPointerDown={(e) => {
            if (
              e.target.closest(
                "#sheet-title, .add-card-header-bar, .card-options-sheet-header, .security-sheet-header",
              )
            ) {
              if (!e.target.closest("button, input, textarea, select")) {
                onTopPointerDown(e);
              }
            }
          }}
        >
          {children}
        </div>
        {actions && (
          <div
            className={`sheet-actions${actionsClassName ? ` ${actionsClassName}` : ""}`}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── amount masking & reveal components ───────────── */
const AUTO_HIDE_MS = 6000;

// Persist privacy mask boolean outside scroll-dependent component state
let persistedBalanceShown = false;
let autoHideTimer = null;
const balanceShownSubscribers = new Set();

function clearAutoHideTimer() {
  if (autoHideTimer !== null) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

function setPersistedBalanceShown(nextValue) {
  const resolved =
    typeof nextValue === "function"
      ? Boolean(nextValue(persistedBalanceShown))
      : Boolean(nextValue);
  clearAutoHideTimer();
  if (resolved) {
    autoHideTimer = setTimeout(() => {
      autoHideTimer = null;
      setPersistedBalanceShown(false);
    }, AUTO_HIDE_MS);
  }
  if (persistedBalanceShown === resolved) return;
  persistedBalanceShown = resolved;
  balanceShownSubscribers.forEach((listener) => {
    try {
      listener(persistedBalanceShown);
    } catch {}
  });
}

function useReveal() {
  const [shown, setShown] = useState(() => persistedBalanceShown);

  useEffect(() => {
    const sync = (val) => setShown(val);
    balanceShownSubscribers.add(sync);
    const onVis = () => {
      if (document.hidden) {
        setPersistedBalanceShown(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      balanceShownSubscribers.delete(sync);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const toggle = useCallback(() => {
    setPersistedBalanceShown((prev) => !prev);
    triggerHaptic("selection");
  }, []);

  return { shown, toggle };
}

function Amount({ value, mask = 3, shown }) {
  const text = String(value);
  const chars = [...text];
  const digits = chars.filter((c) => /\d/.test(c)).length;
  const extras = Math.max(0, mask - digits);

  const cols = [
    ...chars.map((c) => ({ c, kind: /\d/.test(c) ? "digit" : "sep" })),
    ...Array.from({ length: extras }, () => ({ c: "", kind: "x" })),
  ];
  const visibleCols = !shown && cols.length > 8 ? cols.slice(0, 8) : cols;

  return (
    <span className="mx-amt">
      {visibleCols.map(({ c, kind }, i) => (
        <span
          key={i}
          className={`mx-ch mx-${kind}`}
          style={{ "--i": i }}
          aria-hidden="true"
        >
          <span className="mx-b">{kind === "sep" ? "" : "•"}</span>
          <span className="mx-d">{c}</span>
        </span>
      ))}
      <span className="mx-sr">{shown ? text : "hidden"}</span>
    </span>
  );
}

function EyeToggle({ shown, onToggle }) {
  return (
    <button
      type="button"
      className="mx-eye"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? "Hide amounts" : "Show amounts"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle className="mx-pupil" cx="12" cy="12" r="3" />
        <path className="mx-slash" d="M4 4l16 16" />
      </svg>
    </button>
  );
}

/* ───────────── screens ───────────── */
const DONUT_CX = 140;
const DONUT_CY = 140;
const DONUT_RO = 104;
const DONUT_RI = 74;
const DONUT_RM = DONUT_RI + (DONUT_RO - DONUT_RI) * 0.4;
const DONUT_POP = 14;
const DONUT_PAD = 0.014;
const DONUT_TAU = Math.PI * 2;

const donutPt = (a, r) =>
  `${(DONUT_CX + r * Math.sin(a)).toFixed(2)} ${(DONUT_CY - r * Math.cos(a)).toFixed(2)}`;

const donutArc = (a0, a1, r0, r1) => {
  const span = Math.max(0.001, Math.min(DONUT_TAU - 0.001, a1 - a0));
  const endAngle = a0 + span;
  const L = span > Math.PI ? 1 : 0;
  return `M${donutPt(a0, r1)}A${r1} ${r1} 0 ${L} 1 ${donutPt(endAngle, r1)}L${donutPt(endAngle, r0)}A${r0} ${r0} 0 ${L} 0 ${donutPt(a0, r0)}Z`;
};

const WhereItWentCard = memo(
  function WhereItWentCard({ cs, total, saved }) {
    const svgRef = useRef(null);
    const segsGroupRef = useRef(null);
    const centerRef = useRef(null);
    const outerRefs = useRef([]);
    const innerRefs = useRef([]);
    const labelRefs = useRef([]);
    const rowRefs = useRef([]);
    const stateRef = useRef([]);
    const selRef = useRef(-1);
    const runRef = useRef(false);
    const rafRef = useRef(null);
    const dragStateRef = useRef({ startHit: -1, scrubbed: false });

    const csSignature = cs.map(([name, val]) => `${name}:${val}`).join("|");

    const D = useMemo(() => {
      let acc = 0;
      return cs.map(([n, v]) => {
        const a0 = total > 0 ? (acc / total) * DONUT_TAU : 0;
        acc += v;
        const a1 = total > 0 ? (acc / total) * DONUT_TAU : 0;
        const p = total > 0 ? Math.round((v / total) * 100) : 0;
        const c = CAT[n]?.[1] || "#64748b";
        return { n, v, a0, a1, p, c };
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [csSignature, total]);

    const draw = useCallback(() => {
      const items = stateRef.current;
      const count = items.length;
      for (let i = 0; i < count; i++) {
        const d = items[i];
        const rawSpan = d.a1 - d.a0;
        const pad =
          count === 1
            ? 0.002
            : Math.min(DONUT_PAD, Math.max(0.002, rawSpan * 0.22));
        const a0 = d.a0 + pad;
        const a1 = d.a1 - pad;
        const ro = DONUT_RO + DONUT_POP * d.x;
        const ri = DONUT_RI - 2 * d.x;

        const oEl = outerRefs.current[i];
        if (oEl) oEl.setAttribute("d", donutArc(a0, a1, DONUT_RM, ro));

        const nEl = innerRefs.current[i];
        if (nEl) nEl.setAttribute("d", donutArc(a0, a1, ri, DONUT_RM));

        const lEl = labelRefs.current[i];
        if (lEl) {
          const m = (d.a0 + d.a1) / 2;
          const r = (DONUT_RM + ro) / 2;
          const [px, py] = donutPt(m, r).split(" ");
          lEl.setAttribute("x", px);
          lEl.setAttribute("y", py);
          const canFitLabel = rawSpan >= 0.2 || count === 1;
          lEl.setAttribute(
            "opacity",
            canFitLabel ? String(Math.max(0, Math.min(1, d.x * 1.4))) : "0",
          );
        }
      }
    }, []);

    const step = useCallback(() => {
      let go = false;
      const items = stateRef.current;
      for (let i = 0; i < items.length; i++) {
        const d = items[i];
        d.vel = (d.vel + (d.t - d.x) * 0.2) * 0.72;
        d.x += d.vel;
        if (Math.abs(d.vel) > 0.001 || Math.abs(d.t - d.x) > 0.001) {
          go = true;
        } else {
          d.x = d.t;
          d.vel = 0;
        }
      }
      draw();
      if (go) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        runRef.current = false;
        rafRef.current = null;
      }
    }, [draw]);

    const kick = useCallback(() => {
      if (!runRef.current) {
        runRef.current = true;
        rafRef.current = requestAnimationFrame(step);
      }
    }, [step]);

    const select = useCallback(
      (i) => {
        if (i === selRef.current) return;
        selRef.current = i;
        stateRef.current.forEach((d, k) => {
          d.t = k === i ? 1 : 0;
        });
        rowRefs.current.forEach((r, k) => {
          if (!r) return;
          const active = k === i;
          r.setAttribute("aria-pressed", String(active));
          r.classList.toggle("is-highlighted", active);
        });
        centerRef.current?.classList.toggle("is-interactive", i >= 0);
        if (i >= 0) triggerHaptic("selection");
        kick();
      },
      [kick],
    );

    useLayoutEffect(() => {
      const prev = stateRef.current;
      stateRef.current = D.map((d, k) => {
        const old = prev.find((p) => p.n === d.n);
        const t = k === selRef.current ? 1 : 0;
        return {
          ...d,
          x: old ? old.x : 0,
          vel: old ? old.vel : 0,
          t,
        };
      });
      draw();
    }, [D, draw]);

    useEffect(() => {
      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        runRef.current = false;
      };
    }, []);

    // Safari / WebKit often skips firing `onAnimationEnd` on SVG elements inside `<defs><mask>`,
    // and `prefers-reduced-motion: reduce` disables the sweep animation entirely (`animation: none`),
    // which would otherwise leave the mask attribute attached forever.
    useEffect(() => {
      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reducedMotion) {
        segsGroupRef.current?.removeAttribute("mask");
        return undefined;
      }
      const timer = window.setTimeout(() => {
        segsGroupRef.current?.removeAttribute("mask");
      }, 1150);
      return () => window.clearTimeout(timer);
    }, [csSignature]);

    const hit = useCallback((e) => {
      const svg = svgRef.current;
      const items = stateRef.current;
      if (!svg || !items.length) return -1;
      const b = svg.getBoundingClientRect();
      if (!b.width) return -1;
      const k = 280 / b.width;
      const x = (e.clientX - b.left) * k - DONUT_CX;
      const y = (e.clientY - b.top) * k - DONUT_CY;
      const dist = Math.hypot(x, y);
      if (dist < DONUT_RI - 10 || dist > DONUT_RO + DONUT_POP + 6) return -1;
      let a = Math.atan2(x, -y);
      if (a < 0) a += DONUT_TAU;
      return items.findIndex(
        (q, idx) => a >= q.a0 && (a < q.a1 || idx === items.length - 1),
      );
    }, []);

    return (
      <div className="card where-it-went-card">
        <div className="category-card-heading">
          <div>
            <h2>Where it went</h2>
            {saved > 0 && <small>Includes saved money</small>}
          </div>
          <span>
            {cs.length} {cs.length === 1 ? "category" : "categories"}
          </span>
        </div>
        <div className="where-it-went-body">
          <div
            className="where-donut-wrap"
            role="group"
            aria-label="Spending by category chart"
          >
            <svg
              ref={svgRef}
              viewBox="0 0 280 280"
              className="where-donut-svg"
              role="img"
              aria-label="Donut chart of spending by category. Use the list to select a category."
              onPointerDown={(e) => {
                if (e.button != null && e.button !== 0) return;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {}
                const h = hit(e);
                dragStateRef.current = { startHit: h, scrubbed: false };
                select(h === selRef.current ? -1 : h);
              }}
              onPointerMove={(e) => {
                if (e.buttons) {
                  const i = hit(e);
                  if (i >= 0 && i !== dragStateRef.current.startHit) {
                    dragStateRef.current.scrubbed = true;
                  }
                  if (i >= 0 && dragStateRef.current.scrubbed) {
                    select(i);
                  }
                }
              }}
            >
              <defs>
                <mask
                  id="where-donut-sweep-mask"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="280"
                  height="280"
                >
                  <circle
                    className="where-donut-sweep"
                    cx="140"
                    cy="140"
                    r="89"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="72"
                    strokeDasharray="559.2"
                    strokeDashoffset="559.2"
                    transform="rotate(-90 140 140)"
                    onAnimationEnd={() => {
                      segsGroupRef.current?.removeAttribute("mask");
                    }}
                  />
                </mask>
              </defs>
              <g ref={segsGroupRef} mask="url(#where-donut-sweep-mask)">
                {D.map((d, i) => (
                  <g className="where-donut-seg" key={d.n}>
                    <path
                      ref={(el) => {
                        outerRefs.current[i] = el;
                      }}
                      className="where-donut-seg-outer"
                      style={{ fill: d.c }}
                    />
                    <path
                      ref={(el) => {
                        innerRefs.current[i] = el;
                      }}
                      className="where-donut-seg-inner"
                      style={{
                        fill: `color-mix(in srgb, ${d.c} 62%, #fff)`,
                      }}
                    />
                    <text
                      ref={(el) => {
                        labelRefs.current[i] = el;
                      }}
                      className="where-donut-arc-label"
                      opacity="0"
                    >
                      {d.p}%
                    </text>
                  </g>
                ))}
              </g>
            </svg>
            <div
              ref={centerRef}
              className="where-donut-center"
              onClick={() => select(-1)}
            >
              <span className="where-donut-label">Total</span>
              <b
                className={`where-donut-total${
                  M(total).length > 11
                    ? " is-extra-compact"
                    : M(total).length > 8
                      ? " is-compact"
                      : ""
                }`}
              >
                {M(total)}
              </b>
            </div>
          </div>

          <div className="where-legend-list">
            {D.map((d, i) => (
              <button
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="leg"
                key={d.n}
                type="button"
                aria-pressed="false"
                style={{ "--c": d.c }}
                aria-label={`${d.n}, ${d.p}% of spending, ${M(d.v)}`}
                onClick={() => select(i === selRef.current ? -1 : i)}
              >
                <span className="dot" style={{ "--c": d.c }} />
                <span className="leg-info">
                  <span className="leg-name">{d.n}</span>
                  <em className="leg-pct">{d.p}%</em>
                </span>
                <b className="leg-amt">{M(d.v)}</b>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.total === next.total &&
    prev.saved === next.saved &&
    prev.cs.length === next.cs.length &&
    prev.cs.every(
      (item, idx) =>
        item[0] === next.cs[idx]?.[0] && item[1] === next.cs[idx]?.[1],
    ),
);

function Home({
  S,
  profile,
  onShift,
  onTab,
  onCategory,
  onBudget,
  onOpen,
  onDelete,
  onSkip,
  onDuplicate,
  highlightedExpenseId,
}) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [highlightedCategory, setHighlightedCategory] = useState("");
  const { shown, toggle } = useReveal();
  const todayStr = ld();
  const currentMonthKey = todayStr.slice(0, 7);
  const currentDay = Number(todayStr.split("-")[2]) || 1;
  const isNewMonthWindow = currentDay <= 7;
  const monthKey = S?.m || currentMonthKey;
  const isCurrentMonth = monthKey === currentMonthKey;
  const isPastMonth = Boolean(monthKey && monthKey < currentMonthKey);
  const previousMonthKey = shift(currentMonthKey, -1);
  const shouldShowBanner = isPastMonth || (isCurrentMonth && isNewMonthWindow);
  const bannerMonth = isPastMonth ? monthKey : previousMonthKey;
  const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;
  const total = round2(tot(S, monthKey));
  const saved = round2(
    monthExp(S)
      .filter((expense) => expense.cat === "Savings" && expense.amt != null)
      .reduce((sum, expense) => sum + expense.amt, 0),
  );
  const t = round2(total - saved);
  const previousMonth = shift(monthKey, -1);
  const previousSaved = round2(
    monthExp({ ...S, m: previousMonth })
      .filter((expense) => expense.cat === "Savings" && expense.amt != null)
      .reduce((sum, expense) => sum + expense.amt, 0),
  );
  const p = round2(tot(S, previousMonth) - previousSaved);
  const b = S?.bud?.[monthKey] || 0;
  const d = round2(t - p);
  const overBudget = b > 0 && t > b;
  let homeVelocity = null;
  if (b > 0 && isCurrentMonth) {
    const [y, mNum] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, mNum, 0).getDate();
    const currentDay = Math.min(
      daysInMonth,
      Number(todayStr.split("-")[2]) || 1,
    );
    const daysPassed = Math.max(1, currentDay);
    const daysRemaining = Math.max(1, daysInMonth - currentDay + 1);
    const expectedSpent = (b / daysInMonth) * daysPassed;
    const paceDiff = t - expectedSpent;
    const remainingBudget = round2(b - t);
    const rawDailyRemaining =
      remainingBudget > 0 ? remainingBudget / daysRemaining : 0;
    const dailyRemainingBudget =
      remainingBudget > 0
        ? rawDailyRemaining < 1
          ? Math.max(0.01, round2(rawDailyRemaining))
          : Math.round(rawDailyRemaining)
        : 0;
    const roundedPaceDiff = Math.round(paceDiff);
    homeVelocity = {
      daysRemaining,
      paceDiff,
      dailyRemainingBudget,
      isOverPace: t > b || roundedPaceDiff > 0,
    };
  }
  const list = monthExp(S);
  const by = {};
  list.forEach((e) => {
    if (e.amt == null || e.cat === "Other" || !CAT[e.cat]) return;
    by[e.cat] = round2((by[e.cat] || 0) + e.amt);
  });
  const namedCategoryTotal = round2(
    Object.values(by).reduce((sum, value) => sum + value, 0),
  );
  const otherTotal = Math.max(0, round2(total - namedCategoryTotal));
  if (otherTotal > 0) by.Other = otherTotal;
  const cs = Object.entries(by).sort((x, y) => y[1] - x[1]);
  const topCategory = cs.find(([category]) => category !== "Savings");
  const activeRecurring = (S?.rec || []).filter(
    (r) => r?.on && typeof r?.next === "string",
  );
  const upcomingRecurring = activeRecurring.filter((r) => r.next >= todayStr);
  const nx = (
    upcomingRecurring.length > 0 ? upcomingRecurring : activeRecurring
  ).sort((x, y) =>
    String(x?.next || "").localeCompare(String(y?.next || "")),
  )[0];
  const h = currentTime.getHours();
  useEffect(() => setHighlightedCategory(""), [S.m]);
  useEffect(() => {
    if (highlightedCategory && by[highlightedCategory] == null) {
      setHighlightedCategory("");
    }
  }, [by, highlightedCategory]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const timeGreeting =
    h >= 5 && h < 12
      ? "Good morning"
      : h >= 12 && h < 17
        ? "Good afternoon"
        : h >= 17 && h < 21
          ? "Good evening"
          : "Good night";
  const greetingName = greetingFirstName(profile);

  return (
    <>
      {shouldShowBanner && (
        <Suspense fallback={null}>
          <MonthEndBanner
            month={bannerMonth}
            isPreview={isCurrentMonth}
            transactions={S?.exp || []}
            amountOf={(t) => (t.cat === "Savings" ? 0 : t.amt)}
            categoryOf={(t) => t.cat}
            currency="৳"
          />
        </Suspense>
      )}
      <div className="hd">
        <div>
          <small>
            {timeGreeting}, {greetingName}
          </small>
          <h1>{fM(S.m)}</h1>
        </div>
        <div className="mn">
          <button
            aria-label="Previous month"
            onClick={() => {
              triggerHaptic("selection");
              onShift(-1);
            }}
          >
            <Icon n="l" />
          </button>
          <button
            aria-label="Next month"
            disabled={!S?.m || S.m >= ld().slice(0, 7)}
            onClick={() => {
              triggerHaptic("selection");
              onShift(1);
            }}
          >
            <Icon n="r" />
          </button>
        </div>
      </div>

      <section
        className={`hero spend-card${overBudget ? " is-over-budget" : ""}${shown ? " is-shown" : ""}`}
        aria-label="Spending this month"
      >
        <div className="row spend-card-top-row">
          <span className="spend-card-label">Spent this month</span>
          {p ? (
            <span className="chip spend-card-vs-pill">
              <span className="mx-tri">{d > 0 ? "↑" : d < 0 ? "↓" : "•"}</span>
              <span className="spend-card-vs-amt">
                ৳
                <Amount
                  value={amountFormatter.format(Math.abs(d))}
                  mask={3}
                  shown={shown}
                />
              </span>
              <span className="spend-card-vs-text">vs last month</span>
            </span>
          ) : null}
        </div>

        <div className="mx-hero">
          <div
            className={`big mx-hero-amt${
              amountFormatter.format(Number(t) || 0).length > 12
                ? " is-ultra-compact-hero"
                : amountFormatter.format(Number(t) || 0).length > 9
                  ? " is-compact-hero"
                  : ""
            }`}
            onClick={toggle}
          >
            <span className="mx-cur">৳</span>
            <Amount
              value={amountFormatter.format(Number(t) || 0)}
              mask={4}
              shown={shown}
            />
          </div>
          <EyeToggle shown={shown} onToggle={toggle} />
        </div>

        {saved > 0 && (
          <div className="hero-saved">
            <span>Saved</span>
            <b>
              ৳
              <Amount
                value={amountFormatter.format(saved)}
                mask={3}
                shown={shown}
              />
            </b>
          </div>
        )}

        {b ? (
          <>
            <div
              className="spend-tick-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={b}
              aria-valuenow={Math.min(b, Math.round(t))}
            >
              {Array.from({ length: 38 }, (_, idx) => {
                const ratio = b > 0 ? Math.min(1, Math.max(0, t / b)) : 0;
                const activeCount =
                  t > 0 ? Math.max(1, Math.round(ratio * 38)) : 0;
                const isActive = idx < activeCount;
                return (
                  <i
                    key={idx}
                    className={`spend-tick${isActive ? " is-active" : ""}${overBudget && isActive ? " is-over" : ""}`}
                  />
                );
              })}
            </div>
            <div className="row spend-budget-row">
              <span
                className={`spend-budget-left${overBudget ? " is-over" : ""}`}
                role="status"
              >
                {overBudget ? (
                  <>
                    <b>
                      ৳
                      <Amount
                        value={amountFormatter.format(round2(t - b))}
                        mask={3}
                        shown={shown}
                      />
                    </b>{" "}
                    over budget
                  </>
                ) : (
                  <>
                    <b>
                      ৳
                      <Amount
                        value={amountFormatter.format(round2(b - t))}
                        mask={3}
                        shown={shown}
                      />
                    </b>{" "}
                    left
                  </>
                )}
              </span>
              <span className="spend-budget-total">
                of ৳
                <Amount
                  value={amountFormatter.format(b)}
                  mask={3}
                  shown={shown}
                />
              </span>
            </div>
            {homeVelocity && (
              <div className="hero-velocity-row">
                <div
                  className={`hero-velocity-badge ${homeVelocity.isOverPace ? "is-over" : "is-good"}`}
                >
                  <span className="hero-velocity-dot" aria-hidden="true" />
                  <span className="hero-velocity-metric">
                    <span className="hero-velocity-curr">৳</span>
                    <Amount
                      value={amountFormatter.format(
                        homeVelocity.isOverPace
                          ? Math.max(
                              1,
                              Math.round(
                                Math.max(homeVelocity.paceDiff, t - b),
                              ),
                            )
                          : homeVelocity.dailyRemainingBudget,
                      )}
                      mask={3}
                      shown={shown}
                    />
                    {!homeVelocity.isOverPace && (
                      <span className="hero-velocity-unit">/day</span>
                    )}
                  </span>
                  <span className="hero-velocity-label">
                    {homeVelocity.isOverPace ? "over pace" : "safe pace"}
                  </span>
                </div>
                <span className="hero-velocity-sub">
                  {homeVelocity.daysRemaining}{" "}
                  {homeVelocity.daysRemaining === 1 ? "day" : "days"} left
                </span>
              </div>
            )}
          </>
        ) : (
          <button className="ghost" onClick={onBudget}>
            Set a monthly budget
          </button>
        )}
        <span className="mx-sr" aria-live="polite">
          {shown ? "Amounts shown" : "Amounts hidden"}
        </span>
      </section>

      <div className="mini">
        <div className="card">
          <div className="mini-card-top">
            <span
              className="mini-icon-badge is-category"
              style={{
                "--c": topCategory
                  ? getCategoryColor(topCategory[0]) ||
                    CAT[topCategory[0]]?.[1] ||
                    "#8b5cf6"
                  : "#64748b",
              }}
            >
              <CategorySymbol
                category={topCategory ? topCategory[0] : "Other"}
              />
            </span>
          </div>
          <small>Top category</small>
          <b className="top-category-value">
            <span>{topCategory ? topCategory[0] : "—"}</span>
          </b>
          <span className="mini-caption">
            {topCategory
              ? `${M(topCategory[1])} this month`
              : "No spending yet"}
          </span>
        </div>
        <div className="card">
          <div className="mini-card-top">
            <span className="mini-icon-badge is-repeat">
              <UtilitySymbol name="repeat" />
            </span>
            {nx &&
              (() => {
                if (typeof nx.next !== "string") return null;
                const [ty, tm, td] = todayStr.split("-").map(Number);
                const [ny, nm, nd] = nx.next.split("-").map(Number);
                if ([ty, tm, td, ny, nm, nd].some(isNaN)) return null;
                const diffDays = Math.round(
                  (Date.UTC(ny, nm - 1, nd) - Date.UTC(ty, tm - 1, td)) /
                    86400000,
                );
                const label =
                  diffDays === 0
                    ? "Today"
                    : diffDays === 1
                      ? "in 1 day"
                      : diffDays > 1
                        ? `in ${diffDays} days`
                        : diffDays === -1
                          ? "1 day ago"
                          : `${Math.abs(diffDays)}d ago`;
                return <span className="mini-days-pill">{label}</span>;
              })()}
          </div>
          <small>Next recurring</small>
          <b className="mini-next-value">{nx ? nx.desc : "Nothing due"}</b>
          <span className="mini-caption">
            {nx ? `Due ${dayMonth(nx.next)}` : "You’re all caught up"}
          </span>
        </div>
      </div>

      {cs.length > 0 && total > 0 && (
        <WhereItWentCard key={monthKey} cs={cs} total={total} saved={saved} />
      )}

      <div className="sec">
        <h2>Recent</h2>
        <button
          type="button"
          className="see-all-btn"
          onClick={() => onTab("activity")}
        >
          See all
        </button>
      </div>
      <div
        className="card expense-day-card"
        style={{ margin: 0, padding: "3px 14px" }}
      >
        {list.length ? (
          list
            .slice(0, 5)
            .map((e) => (
              <ExpenseRow
                key={e.id}
                e={e}
                cards={S?.cards || []}
                deletedCards={S?.deletedCards}
                onOpen={onOpen}
                onDelete={onDelete}
                onSkip={onSkip}
                onDuplicate={onDuplicate}
                suggestion={suggestedCategory(e.desc, S.exp, e.id)}
                isNew={highlightedExpenseId === e.id}
              />
            ))
        ) : (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <AnimatedExpensesIcon />
            </div>
            <b>No expenses this month</b>
            <small>Tap + below to add your first expense</small>
          </div>
        )}
      </div>
    </>
  );
}

function Activity({
  S,
  onShift,
  onScrollToTop,
  q,
  setQ,
  cf,
  setCf,
  onOpen,
  onDelete,
  onSkip,
  onDuplicate,
  onOpenTransaction,
  onDeleteTransaction,
  searchRef,
  highlightedExpenseId,
  highlightedTransactionId,
}) {
  const [feedType, setFeedType] = useState("all"); // "all" | "expenses" | "income" | "transfers"
  const [quickFilter, setQuickFilter] = useState(""); // "" | "needs-amount" | "recurring" | "cash" | "high-value"
  const [showFilterTray, setShowFilterTray] = useState(false);

  // Automatically switch to expenses if user selected a category filter, and clear stale quick filters
  useEffect(() => {
    if (cf) {
      if (feedType !== "all" && feedType !== "expenses") {
        setFeedType("expenses");
      }
      setQuickFilter("");
    } else if (feedType === "income" || feedType === "transfers") {
      if (quickFilter === "needs-amount" || quickFilter === "recurring") {
        setQuickFilter("");
      }
    }
  }, [cf, feedType, quickFilter]);

  const query = String(q || "")
    .trim()
    .toLowerCase();

  const isItemCash = useCallback((item) => {
    if (!item) return false;
    if (item.sourceType === "expense")
      return !item.acct || item.acct === "cash";
    if (item.type === "transfer") {
      const fromAcct = item.from ?? item.acct ?? item.fromAccount;
      const toAcct = item.to ?? item.toAccount;
      return (
        !fromAcct ||
        fromAcct === "cash" ||
        toAcct === "cash" ||
        item.acct === "cash"
      );
    }
    return !item.acct || item.acct === "cash";
  }, []);

  const currentMonth =
    typeof S?.m === "string" && S.m.length >= 7 ? S.m : ld().slice(0, 7);

  // 1. Month Expenses
  const monthExpenses = useMemo(() => {
    return (S?.exp || [])
      .filter(
        (e) => typeof e?.date === "string" && e.date.startsWith(currentMonth),
      )
      .map((e, index) => ({
        ...e,
        sourceType: "expense",
        index,
      }));
  }, [S?.exp, currentMonth]);

  // 2. Month Transactions (Income, Transfers, Adjustments)
  const monthTransactions = useMemo(() => {
    return (S?.tx || [])
      .filter(
        (t) => typeof t?.date === "string" && t.date.startsWith(currentMonth),
      )
      .map((t, index) => ({
        ...t,
        sourceType: "tx",
        desc:
          t.note ||
          (t.type === "income"
            ? "Income"
            : t.type === "transfer"
              ? "Transfer"
              : "Balance adjustment"),
        title:
          t.note ||
          (t.type === "income"
            ? "Income"
            : t.type === "transfer"
              ? "Transfer"
              : "Balance adjustment"),
        amt: t.amt,
        amount: t.amt,
        index,
      }));
  }, [S?.tx, currentMonth]);

  // 3. Combined & Sorted Unified Feed (with stable combined indexing)
  const allMonthItems = useMemo(() => {
    const combined = [...monthExpenses, ...monthTransactions];
    return combined
      .map((item, combinedIndex) => ({ item, combinedIndex }))
      .sort((x, y) => {
        return (
          String(y.item.date || "").localeCompare(String(x.item.date || "")) ||
          activityTime(y.item) - activityTime(x.item) ||
          y.combinedIndex - x.combinedIndex ||
          String(y.item.id || "").localeCompare(String(x.item.id || ""))
        );
      })
      .map(({ item }) => item);
  }, [monthExpenses, monthTransactions]);

  // Counts for Segmented Tabs
  const countExpenses = monthExpenses.length;
  const countIncome = monthTransactions.filter(
    (t) => t.type === "income",
  ).length;
  const countTransfers = monthTransactions.filter(
    (t) =>
      t.type === "transfer" || t.type === "adjust" || t.type === "adjustment",
  ).length;
  const countAll = monthExpenses.length + monthTransactions.length;

  // Items in active feed scope for accurate badge counts
  const targetScopeItems = useMemo(() => {
    if (feedType === "expenses") return monthExpenses;
    if (feedType === "income")
      return monthTransactions.filter((t) => t.type === "income");
    if (feedType === "transfers")
      return monthTransactions.filter(
        (t) =>
          t.type === "transfer" ||
          t.type === "adjust" ||
          t.type === "adjustment",
      );
    return allMonthItems;
  }, [allMonthItems, feedType, monthExpenses, monthTransactions]);

  // Counts for Quick Filter Badges
  const needsAmountCount = monthExpenses.filter((e) => e.amt == null).length;
  const recurringCount = monthExpenses.filter((e) => Boolean(e.rec)).length;
  const cashCount = targetScopeItems.filter((item) => isItemCash(item)).length;
  const highValueCount = targetScopeItems.filter(
    (item) => Number(item.amt || 0) >= 1000,
  ).length;

  const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

  const matchesActivityCriteria = useCallback(
    (item) => {
      if (!item) return false;
      const srcType =
        item.sourceType ||
        (item.type === "income" ||
        item.type === "transfer" ||
        item.type === "adjust" ||
        item.type === "adjustment"
          ? "tx"
          : "expense");
      const normalizedItem =
        item.sourceType === srcType ? item : { ...item, sourceType: srcType };

      // 1. Feed Type Filter
      if (feedType === "expenses" && srcType !== "expense") return false;
      if (
        feedType === "income" &&
        (srcType !== "tx" || normalizedItem.type !== "income")
      )
        return false;
      if (
        feedType === "transfers" &&
        (srcType !== "tx" ||
          (normalizedItem.type !== "transfer" &&
            normalizedItem.type !== "adjust" &&
            normalizedItem.type !== "adjustment"))
      )
        return false;

      // 2. Category Filter (applicable to expenses)
      if (cf && (srcType !== "expense" || normalizedItem.cat !== cf))
        return false;

      // 3. Quick Filter Pills
      if (
        quickFilter === "needs-amount" &&
        (srcType !== "expense" || normalizedItem.amt != null)
      )
        return false;
      if (
        quickFilter === "recurring" &&
        (srcType !== "expense" || !normalizedItem.rec)
      )
        return false;
      if (quickFilter === "cash" && !isItemCash(normalizedItem)) return false;
      if (
        quickFilter === "high-value" &&
        Number(normalizedItem.amt || 0) < 1000
      )
        return false;

      // 4. Search Query
      if (!query) return true;
      const fallbackTxTitle =
        srcType === "tx"
          ? normalizedItem.type === "income"
            ? "Income"
            : normalizedItem.type === "transfer"
              ? "Transfer"
              : "Balance adjustment"
          : "";
      const desc = String(
        normalizedItem.desc ||
          normalizedItem.title ||
          normalizedItem.note ||
          normalizedItem.description ||
          fallbackTxTitle ||
          "",
      ).toLowerCase();
      const cat = String(normalizedItem.cat || "").toLowerCase();
      const amtStr =
        normalizedItem.amt != null ? String(normalizedItem.amt) : "";
      const formattedAmt =
        normalizedItem.amt != null ? M(normalizedItem.amt).toLowerCase() : "";
      const cleanMoneyQuery = query.replace(/[৳,\s]/g, "");
      const [accountName] = getAccountDisplay(
        normalizedItem.acct || normalizedItem.from,
        S?.cards,
        S?.deletedCards,
      );
      const acctStr = String(accountName || "").toLowerCase();
      const [toAccountName] = normalizedItem.to
        ? getAccountDisplay(normalizedItem.to, S?.cards, S?.deletedCards)
        : [""];
      const toAcctStr = String(toAccountName || "").toLowerCase();
      const isCash = isItemCash(normalizedItem);
      const matchesCash =
        isCash &&
        (query === "cash" ||
          query === "cas" ||
          query.includes("cash") ||
          ("cash".startsWith(query) && query.length >= 2));
      const dateStr = String(normalizedItem.date || "");
      const formattedDate = fD(dateStr).toLowerCase();
      const isToday = dateStr === ld();
      const isYesterday = dateStr === ago(1);
      const matchesRelativeDay =
        (isToday && "today".includes(query)) ||
        (isYesterday && "yesterday".includes(query));

      let matchesType = false;
      if (srcType === "tx") {
        if (normalizedItem.type === "income") {
          matchesType = query.length >= 2 && "income".includes(query);
        } else if (normalizedItem.type === "transfer") {
          matchesType = query.length >= 2 && "transfer".includes(query);
        } else if (
          normalizedItem.type === "adjust" ||
          normalizedItem.type === "adjustment"
        ) {
          matchesType =
            "adjustment".includes(query) ||
            "adjust".includes(query) ||
            "balance".includes(query) ||
            (isAdjustmentIncrease(normalizedItem)
              ? "increase".includes(query)
              : "decrease".includes(query));
        }
      } else if (srcType === "expense") {
        matchesType =
          query === "expense" ||
          (Boolean(normalizedItem.rec) &&
            ("recurring".includes(query) || "repeat".includes(query)));
      }

      return (
        desc.includes(query) ||
        cat.includes(query) ||
        amtStr.includes(query) ||
        formattedAmt.includes(query) ||
        (cleanMoneyQuery && amtStr.includes(cleanMoneyQuery)) ||
        acctStr.includes(query) ||
        toAcctStr.includes(query) ||
        matchesCash ||
        matchesType ||
        matchesRelativeDay ||
        dateStr.includes(query) ||
        formattedDate.includes(query)
      );
    },
    [feedType, cf, quickFilter, query, isItemCash, S?.cards, S?.deletedCards],
  );

  // Filtered List
  const filteredItems = useMemo(() => {
    return allMonthItems.filter(matchesActivityCriteria);
  }, [allMonthItems, matchesActivityCriteria]);

  // Day grouping
  const g = {};
  filteredItems.forEach((item) => {
    const key = item.date || item.d || "";
    (g[key] = g[key] || []).push(item);
  });
  const sortedDates = Object.keys(g).sort((a, b) => b.localeCompare(a));

  const activityListRef = useRef(null);
  const lastHapticDayRef = useRef(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  useEffect(() => {
    const listEl = activityListRef.current;
    if (!listEl) return;
    const scroller =
      listEl.closest(".activity-scroll-feed") ||
      listEl.closest(".prototype-tab-panel") ||
      listEl.closest("#app");
    if (!scroller) return;

    const onScroll = () => {
      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });

    let lastTickTime = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!isScrollingRef.current) return;
        const now = Date.now();
        if (now - lastTickTime < 130) return;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            const dayKey = entry.target.getAttribute("data-day-header");
            if (dayKey && dayKey !== lastHapticDayRef.current) {
              lastHapticDayRef.current = dayKey;
              lastTickTime = now;
              triggerHaptic("selection");
              break;
            }
          }
        }
      },
      {
        root: scroller,
        rootMargin: "0px 0px -75% 0px",
        threshold: 0,
      },
    );

    const headers = listEl.querySelectorAll("[data-day-header]");
    headers.forEach((h) => observer.observe(h));

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      observer.disconnect();
    };
  }, [sortedDates]);

  // Totals for filter summary
  const totalExpenses = round2(
    filteredItems
      .filter(
        (item) =>
          (item.sourceType === "expense" || item.type === "expense") &&
          (cf === "Savings" || item.cat !== "Savings"),
      )
      .reduce((sum, item) => sum + (item.amt || 0), 0),
  );
  const totalIncome = round2(
    filteredItems
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + (item.amt || 0), 0),
  );
  const totalTransfers = round2(
    filteredItems
      .filter(
        (item) =>
          item.type === "transfer" ||
          item.type === "adjust" ||
          item.type === "adjustment" ||
          (cf !== "Savings" && item.cat === "Savings"),
      )
      .reduce((sum, item) => sum + (item.amt || 0), 0),
  );

  const hasSearchOrChipFilter =
    Boolean(quickFilter) || Boolean(cf) || Boolean(query);
  const hasFilter = feedType !== "all" || hasSearchOrChipFilter;

  const clearAllFilters = () => {
    triggerHaptic("light");
    setFeedType("all");
    setQuickFilter("");
    setCf("");
    setQ("");
    setShowFilterTray(false);
  };

  const matchesInOtherMonths =
    query && !filteredItems.length
      ? [
          ...(S?.exp || []).map((e) => ({ ...e, sourceType: "expense" })),
          ...(S?.tx || []).map((t) => ({ ...t, sourceType: "tx" })),
        ].some((item) => {
          const itemDate = item.date || "";
          if (
            typeof itemDate === "string" &&
            itemDate.startsWith(currentMonth)
          ) {
            return false;
          }
          return matchesActivityCriteria(item);
        })
      : false;

  return (
    <div className="activity-screen-shell">
      {/* 2ND SCREENSHOT: Locked Top Header (Title + Search + Filter Tabs) */}
      <header className="activity-sticky-header">
        {/* Row 1: Title + Month Switcher */}
        <div
          className="activity-header-top"
          onClick={(e) => {
            if (
              !e.target.closest("button, a, input, select, [role='button']")
            ) {
              onScrollToTop?.();
            }
          }}
        >
          <h1 className="activity-title">Activity</h1>
          <div className="activity-month-pill">
            <MonthSwitch m={S?.m} onShift={onShift} />
          </div>
        </div>

        {/* Row 2: Search Input + Filter Button */}
        <div className="activity-search-row">
          <label className="srch">
            <Icon n="s" />
            <input
              name="activitySearch"
              ref={searchRef}
              className="activity-search-input"
              type="search"
              aria-label="Search transactions"
              placeholder="Search transactions"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQ("");
                  e.currentTarget.blur();
                }
              }}
            />
            {q && (
              <button
                type="button"
                className="srch-clear-btn"
                aria-label="Clear search"
                onClick={(e) => {
                  e.preventDefault();
                  setQ("");
                  searchRef?.current?.focus();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </label>

          <button
            type="button"
            className={`activity-filter-btn${showFilterTray || cf || quickFilter ? " is-active" : ""}`}
            onClick={() => {
              triggerHaptic("selection");
              setShowFilterTray((prev) => !prev);
            }}
            aria-label="Filter transactions"
            aria-expanded={
              showFilterTray || Boolean(cf) || Boolean(quickFilter)
            }
            title="Filter options"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="13" y2="6" />
              <line x1="19" y1="6" x2="21" y2="6" />
              <circle cx="16" cy="6" r="2.5" />
              <line x1="3" y1="12" x2="5" y2="12" />
              <line x1="11" y1="12" x2="21" y2="12" />
              <circle cx="8" cy="12" r="2.5" />
              <line x1="3" y1="18" x2="13" y2="18" />
              <line x1="19" y1="18" x2="21" y2="18" />
              <circle cx="16" cy="18" r="2.5" />
            </svg>
            {(cf || quickFilter) && (
              <span className="activity-filter-indicator" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Row 3: All / Expenses / Income / Transfers Tabs */}
        <div
          className="activity-tabs-bar activity-filter-tabs"
          role="tablist"
          aria-label="Activity filter"
        >
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "all"}
            className={`activity-tab-btn ${feedType === "all" ? "is-active" : ""}`}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("all");
            }}
          >
            <span className="activity-tab-label">All</span>
            <span className="activity-tab-count">{countAll}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "expenses"}
            className={`activity-tab-btn ${feedType === "expenses" ? "is-active" : ""}`}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("expenses");
            }}
          >
            <span className="activity-tab-label">Expenses</span>
            <span className="activity-tab-count">{countExpenses}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "income"}
            className={`activity-tab-btn ${feedType === "income" ? "is-active" : ""}`}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("income");
              setCf("");
              if (
                quickFilter === "needs-amount" ||
                quickFilter === "recurring"
              ) {
                setQuickFilter("");
              }
            }}
          >
            <span className="activity-tab-label">Income</span>
            <span className="activity-tab-count">{countIncome}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "transfers"}
            className={`activity-tab-btn ${feedType === "transfers" ? "is-active" : ""}`}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("transfers");
              setCf("");
              if (
                quickFilter === "needs-amount" ||
                quickFilter === "recurring"
              ) {
                setQuickFilter("");
              }
            }}
          >
            <span className="activity-tab-label">Transfers</span>
            <span className="activity-tab-count">{countTransfers}</span>
          </button>
        </div>

        {/* Quick Filter Pills Bar */}
        {(showFilterTray || cf || quickFilter) && (
          <div
            className="chips"
            role="toolbar"
            aria-label="Activity filter chips"
          >
            <button
              type="button"
              className={!cf && !quickFilter ? "on" : ""}
              aria-pressed={!cf && !quickFilter}
              onClick={() => {
                triggerHaptic("selection");
                setQuickFilter("");
                setCf("");
              }}
            >
              All
            </button>

            {(feedType === "all" || feedType === "expenses") && (
              <>
                <button
                  type="button"
                  className={quickFilter === "needs-amount" ? "on" : ""}
                  aria-pressed={quickFilter === "needs-amount"}
                  onClick={() => {
                    triggerHaptic("selection");
                    setQuickFilter(
                      quickFilter === "needs-amount" ? "" : "needs-amount",
                    );
                    setCf("");
                  }}
                >
                  <UtilitySymbol name="alert" />
                  <span>Needs amt</span>
                  {needsAmountCount > 0 && (
                    <span className="chip-badge">{needsAmountCount}</span>
                  )}
                </button>

                <button
                  type="button"
                  className={quickFilter === "recurring" ? "on" : ""}
                  aria-pressed={quickFilter === "recurring"}
                  onClick={() => {
                    triggerHaptic("selection");
                    setQuickFilter(
                      quickFilter === "recurring" ? "" : "recurring",
                    );
                    setCf("");
                  }}
                >
                  <UtilitySymbol name="refresh" />
                  <span>Repeat</span>
                  {recurringCount > 0 && (
                    <span className="chip-badge">{recurringCount}</span>
                  )}
                </button>
              </>
            )}

            <button
              type="button"
              className={quickFilter === "cash" ? "on" : ""}
              aria-pressed={quickFilter === "cash"}
              onClick={() => {
                triggerHaptic("selection");
                setQuickFilter(quickFilter === "cash" ? "" : "cash");
                setCf("");
              }}
            >
              <UtilitySymbol name="cash" />
              <span>Cash</span>
              {cashCount > 0 && <span className="chip-badge">{cashCount}</span>}
            </button>

            <button
              type="button"
              className={quickFilter === "high-value" ? "on" : ""}
              aria-pressed={quickFilter === "high-value"}
              onClick={() => {
                triggerHaptic("selection");
                setQuickFilter(
                  quickFilter === "high-value" ? "" : "high-value",
                );
                setCf("");
              }}
            >
              <UtilitySymbol name="star" />
              <span>≥ ৳1k</span>
              {highValueCount > 0 && (
                <span className="chip-badge">{highValueCount}</span>
              )}
            </button>

            {(feedType === "all" || feedType === "expenses") && (
              <>
                <span className="chips-divider" aria-hidden="true" />
                {Object.keys(CAT).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cf === c ? "on" : ""}
                    aria-pressed={cf === c}
                    onClick={() => {
                      triggerHaptic("selection");
                      setCf(cf === c ? "" : c);
                      setQuickFilter("");
                    }}
                  >
                    <CategorySymbol category={c} />
                    <span>{c}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Filter Summary Banner */}
        {hasFilter && (
          <div className="activity-filter-summary" role="status">
            {feedType !== "all" && (
              <b>{feedType.charAt(0).toUpperCase() + feedType.slice(1)}</b>
            )}
            {feedType !== "all" && (quickFilter || cf || query) && (
              <span>·</span>
            )}
            {quickFilter === "needs-amount" && <b>Needs amt</b>}
            {quickFilter === "recurring" && <b>Repeat</b>}
            {quickFilter === "cash" && <b>Cash</b>}
            {quickFilter === "high-value" && <b>≥ ৳1k</b>}
            {quickFilter && (cf || query) && <span>·</span>}
            {cf && <b>{cf}</b>}
            {cf && query && <span>·</span>}
            {query && <span>&ldquo;{query}&rdquo;</span>}
            <span>·</span>
            {feedType === "income" ? (
              <strong className="is-positive">+{M(totalIncome)}</strong>
            ) : feedType === "transfers" ? (
              <strong>{M(totalTransfers)}</strong>
            ) : totalIncome > 0 && totalExpenses > 0 ? (
              <>
                <strong>{M(totalExpenses)}</strong>
                <span>·</span>
                <strong className="is-positive">+{M(totalIncome)}</strong>
              </>
            ) : totalIncome > 0 && totalExpenses === 0 ? (
              <strong className="is-positive">+{M(totalIncome)}</strong>
            ) : totalExpenses > 0 ? (
              <strong>{M(totalExpenses)}</strong>
            ) : totalTransfers > 0 ? (
              <strong>{M(totalTransfers)}</strong>
            ) : (
              <strong>{M(0)}</strong>
            )}
            <span>·</span>
            <span>
              {filteredItems.length}{" "}
              {filteredItems.length === 1 ? "item" : "items"}
            </span>
            <button
              type="button"
              className="activity-filter-clear-link"
              onClick={clearAllFilters}
              aria-label="Clear all filters"
            >
              Clear
            </button>
          </div>
        )}
      </header>

      {/* 3RD SCREENSHOT: Only This Transaction List Scrolls */}
      <div className="activity-scroll-feed" ref={activityListRef}>
        {!filteredItems.length ? (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <AnimatedActivityIcon />
            </div>
            <b>
              {hasSearchOrChipFilter
                ? `No matching ${feedType === "income" ? "income" : feedType === "transfers" ? "transfers" : feedType === "expenses" ? "expenses" : "activity"}`
                : countAll === 0 && feedType === "all"
                  ? `No activity in ${fM(currentMonth)}`
                  : `No ${feedType === "all" ? "activity" : feedType} recorded this month`}
            </b>
            <small>
              {hasSearchOrChipFilter
                ? matchesInOtherMonths
                  ? `No matches in ${fM(currentMonth)}. Matching items found in other months — switch months above to view them.`
                  : "Try searching another keyword or clearing your filter."
                : `${feedType === "income" ? "Income" : feedType === "transfers" ? "Transfers and adjustments" : feedType === "expenses" ? "Expenses" : "Activity"} for this month will show up here by date.`}
            </small>
            {hasSearchOrChipFilter && (
              <button
                type="button"
                className="emp-action-pill"
                onClick={clearAllFilters}
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          sortedDates.map((d) => {
            const dayExpenses = g[d] || [];
            const dayExpenseSum = round2(
              dayExpenses
                .filter(
                  (e) =>
                    (e.sourceType === "expense" || e.type === "expense") &&
                    e.cat !== "Savings",
                )
                .reduce((acc, e) => acc + (e.amt || 0), 0),
            );
            const dayIncomeSum = round2(
              dayExpenses
                .filter((e) => e.type === "income")
                .reduce((acc, e) => acc + (e.amt || 0), 0),
            );
            const dayTransfersSum = round2(
              dayExpenses
                .filter(
                  (e) =>
                    e.type === "transfer" ||
                    e.type === "adjust" ||
                    e.type === "adjustment" ||
                    e.cat === "Savings",
                )
                .reduce((acc, e) => acc + (e.amt || 0), 0),
            );
            const hasAmount = dayExpenses.some((e) => e.amt != null);
            const dayLabel = !d
              ? "Undated"
              : d === ld()
                ? "Today"
                : d === ago(1)
                  ? "Yesterday"
                  : fD(d);

            return (
              <section key={d || "undated"} className="activity-day-group">
                {/* Sticky day bar ("Yesterday -৳610") pins right under the header while scrolling */}
                <div
                  className="day activity-day-header"
                  data-day-header={d || "undated"}
                >
                  <span className="activity-day-label">{dayLabel}</span>
                  {dayExpenses.length >= 2 && hasAmount && (
                    <span className="activity-day-total">
                      {feedType === "income" ? (
                        <span className="is-positive">+{M(dayIncomeSum)}</span>
                      ) : feedType === "transfers" ? (
                        <span>{M(dayTransfersSum)}</span>
                      ) : dayIncomeSum > 0 && dayExpenseSum > 0 ? (
                        <>
                          <span>-{M(dayExpenseSum)} </span>
                          <span className="is-positive">
                            (+{M(dayIncomeSum)})
                          </span>
                        </>
                      ) : dayIncomeSum > 0 && dayExpenseSum === 0 ? (
                        <span className="is-positive">+{M(dayIncomeSum)}</span>
                      ) : dayExpenseSum > 0 ? (
                        <span>-{M(dayExpenseSum)}</span>
                      ) : dayTransfersSum > 0 ? (
                        <span>{M(dayTransfersSum)}</span>
                      ) : null}
                    </span>
                  )}
                </div>
                {/* Flat transaction rows directly on canvas (white card styling removed via CSS) */}
                <div className="card expense-day-card activity-group-card">
                  {dayExpenses.map((e) => (
                    <ExpenseRow
                      key={`${e.sourceType || "exp"}-${e.id}`}
                      e={e}
                      cards={S.cards}
                      deletedCards={S?.deletedCards}
                      onOpen={onOpen}
                      onDelete={onDelete}
                      onSkip={onSkip}
                      onDuplicate={onDuplicate}
                      onOpenTransaction={onOpenTransaction}
                      onDeleteTransaction={onDeleteTransaction}
                      suggestion={
                        e.sourceType !== "tx"
                          ? suggestedCategory(e.desc, S.exp, e.id)
                          : ""
                      }
                      isNew={
                        highlightedExpenseId === e.id ||
                        highlightedTransactionId === e.id
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function Accounts({
  S,
  onTx,
  onAddCardClick,
  onOpenCardOptions,
  highlightedExpenseId,
  highlightedTransactionId,
  onTab,
  onOpenExpense,
  onOpenTransaction,
  onDeleteExpense,
  onDeleteTransaction,
  onDuplicateExpense,
  onLockedCardNotice,
  onAddExpense,
  initialSelectedAccount,
  onActiveAccountChange,
}) {
  const rawCards = Array.isArray(S.cards) ? S.cards : [];
  const explicitCashCard = rawCards.find(
    (c) =>
      c.id === "cash" ||
      c.provider === "cash" ||
      c.category === "cash" ||
      c.type === "cash",
  );
  const cashAccountId = explicitCashCard?.id || "cash";
  const hasCashActivity =
    Boolean(explicitCashCard) ||
    Number(S?.start?.cash) > 0 ||
    (S?.exp || []).some(
      (e) => !e.acct || e.acct === "cash" || e.acct === cashAccountId,
    ) ||
    (S?.tx || []).some(
      (t) =>
        t.acct === "cash" ||
        t.to === "cash" ||
        t.acct === cashAccountId ||
        t.to === cashAccountId,
    );
  const cards = useMemo(
    () =>
      !explicitCashCard && (rawCards.length > 0 || hasCashActivity)
        ? [
            ...rawCards,
            {
              id: "cash",
              name: "Cash",
              provider: "cash",
              category: "cash",
              type: "cash",
              network: "none",
              holderName: "Cash wallet",
              subtitle: "Cash in hand · BDT",
              last4: "CASH",
              number: "CASH-BDT",
              expiry: "",
              color: "#23403C",
              gradient: "#23403C",
              initialBalance: Number(S?.start?.cash) || 0,
            },
          ]
        : rawCards,
    [rawCards, explicitCashCard, hasCashActivity, S?.start?.cash],
  );
  const savingsAccountId = getSavingsAccountId(cards);
  const balances = Object.fromEntries(cards.map((c) => [c.id, bal(S, c.id)]));
  const [selectedAccount, setSelectedAccount] = useState(() => {
    if (
      initialSelectedAccount &&
      cards.some((c) => c.id === initialSelectedAccount)
    ) {
      return initialSelectedAccount;
    }
    return cards[0]?.id || "";
  });
  const [showAllTx, setShowAllTx] = useState(false);
  const [deckDragY, setDeckDragY] = useState(0);
  const prevCardCountRef = useRef(rawCards.length);

  useEffect(() => {
    onActiveAccountChange?.(selectedAccount);
  }, [selectedAccount, onActiveAccountChange]);

  useEffect(() => {
    if (
      initialSelectedAccount &&
      cards.some((c) => c.id === initialSelectedAccount)
    ) {
      setSelectedAccount(initialSelectedAccount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedAccount]);

  useEffect(() => {
    if (cards.length === 0) {
      if (selectedAccount !== "") setSelectedAccount("");
      prevCardCountRef.current = 0;
      return;
    }
    if (rawCards.length > prevCardCountRef.current) {
      const newestCard = rawCards[rawCards.length - 1];
      if (newestCard?.id) {
        setSelectedAccount(newestCard.id);
        prevCardCountRef.current = rawCards.length;
        return;
      }
    }
    prevCardCountRef.current = rawCards.length;
    if (!selectedAccount || !cards.some((c) => c.id === selectedAccount)) {
      setSelectedAccount(cards[0].id);
    }
  }, [cards, rawCards, selectedAccount]);

  useEffect(() => {
    setShowAllTx(false);
  }, [selectedAccount]);

  const activeCard =
    cards.find((c) => c.id === selectedAccount) || cards[0] || null;

  const chooseAccount = (accountId) => {
    if (!accountId) return;
    triggerHaptic("selection");
    setSelectedAccount(accountId);
  };

  const getAccountName = (id) => {
    if (!id || id === "cash" || id === cashAccountId) return "Cash";
    const card = cards.find((c) => c.id === id);
    if (card?.name) return card.name;
    const tombstone = S?.deletedCards?.[id];
    if (tombstone?.name) return `${tombstone.name} (Archived)`;
    return id || "Account";
  };

  const normalizeAcct = (id) => {
    if (!id || id === "cash") return cashAccountId;
    return id;
  };

  const isCreditAcct = (id) => {
    const c = cards.find((card) => card.id === id);
    if (!c) return false;
    if (
      c.category === "savings" ||
      c.type === "savings" ||
      c.category === "mfs" ||
      c.type === "mfs" ||
      c.category === "cash" ||
      c.type === "cash"
    ) {
      return false;
    }
    return String(c.type || "").toLowerCase() === "credit";
  };

  const events = [
    ...S.exp
      .filter((expense) => expense.amt != null)
      .map((expense) => {
        const resolvedAcct = normalizeAcct(expense.acct);
        const isSavingsTransfer =
          expense.cat === "Savings" &&
          Boolean(savingsAccountId) &&
          resolvedAcct !== savingsAccountId;
        return {
          id: expense.id,
          sourceType: "expense",
          createdAt: expense.createdAt,
          updatedAt: expense.updatedAt,
          d: expense.date,
          title:
            capitalizeFirstLetter(expense.desc) ||
            (isSavingsTransfer ? "Transfer to Savings" : expense.cat),
          type: isSavingsTransfer ? "transfer" : "expense",
          cat: expense.cat,
          amount: expense.amt,
          account: resolvedAcct,
          from: isSavingsTransfer ? resolvedAcct : "",
          to: isSavingsTransfer ? savingsAccountId : "",
        };
      }),
    ...S.tx.map((transaction) => {
      const resolvedAcct = transaction.acct
        ? normalizeAcct(transaction.acct)
        : "";
      const resolvedTo = transaction.to ? normalizeAcct(transaction.to) : "";
      return {
        id: transaction.id,
        sourceType: "tx",
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        d: transaction.date,
        title:
          capitalizeFirstLetter(transaction.note) ||
          {
            income: "Income",
            transfer: "Transfer",
            adjust: "Adjustment",
            adjustment: "Adjustment",
          }[transaction.type] ||
          "Transaction",
        type: transaction.type,
        cat:
          transaction.type === "income"
            ? "Savings"
            : transaction.type === "transfer"
              ? "Transport"
              : "Bills",
        amount: transaction.amt,
        account: resolvedAcct,
        from: resolvedAcct,
        to: resolvedTo,
        dir: transaction.dir,
        direction: transaction.dir,
      };
    }),
  ];

  const itemCreationTime = (item) => {
    if (!item) return 0;
    const val = item.createdAt;
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const ascendingEvents = [...events].sort(
    (left, right) =>
      left.d.localeCompare(right.d) ||
      itemCreationTime(left) - itemCreationTime(right) ||
      left.id.localeCompare(right.id),
  );
  const runningBalances = {
    cash: Number(S?.start?.cash) || 0,
    ...S.start,
    ...Object.fromEntries(
      cards.map((c) => [
        c.id,
        Number(S?.start?.[c.id] ?? c.initialBalance) || 0,
      ]),
    ),
  };
  const adjustmentBalances = new Map();
  for (const event of ascendingEvents) {
    const changes = {};
    if (event.type === "expense") {
      changes[event.account] = isCreditAcct(event.account)
        ? event.amount
        : -event.amount;
    } else if (event.type === "income") {
      changes[event.account] = isCreditAcct(event.account)
        ? -event.amount
        : event.amount;
    } else if (event.type === "adjust" || event.type === "adjustment") {
      const isUp =
        event.direction === "up" ||
        event.direction === "increase" ||
        event.dir === "up" ||
        event.dir === "increase";
      changes[event.account] = isUp ? event.amount : -event.amount;
    } else if (event.type === "transfer") {
      if (event.from) {
        changes[event.from] =
          (changes[event.from] || 0) +
          (isCreditAcct(event.from) ? event.amount : -event.amount);
      }
      if (event.to) {
        changes[event.to] =
          (changes[event.to] || 0) +
          (isCreditAcct(event.to) ? -event.amount : event.amount);
      }
    }

    if (event.type === "adjust" || event.type === "adjustment") {
      const before =
        Math.round((runningBalances[event.account] || 0) * 100) / 100;
      adjustmentBalances.set(event.id, {
        before,
        after: Math.round((before + (changes[event.account] || 0)) * 100) / 100,
      });
    }
    for (const [accountId, change] of Object.entries(changes))
      runningBalances[accountId] =
        Math.round(((runningBalances[accountId] || 0) + change) * 100) / 100;
  }

  const filteredEvents = events
    .filter((event) => {
      if (!selectedAccount) return true;
      if (event.type === "transfer")
        return event.from === selectedAccount || event.to === selectedAccount;
      return event.account === selectedAccount;
    })
    .sort(
      (left, right) =>
        right.d.localeCompare(left.d) ||
        itemCreationTime(right) - itemCreationTime(left) ||
        right.id.localeCompare(left.id),
    );
  const visibleEvents = showAllTx ? filteredEvents : filteredEvents.slice(0, 8);

  const displayDate = (date) =>
    date === ld() ? "Today" : date === ago(1) ? "Yesterday" : fD(date);
  const displayAmount = (event) => {
    if (event.type === "expense") return { value: -event.amount, signed: true };
    if (event.type === "income") return { value: event.amount, signed: true };
    if (event.type === "adjust" || event.type === "adjustment") {
      const isUp =
        event.direction === "up" ||
        event.direction === "increase" ||
        event.dir === "up" ||
        event.dir === "increase";
      return {
        value: isUp ? event.amount : -event.amount,
        signed: true,
      };
    }
    if (selectedAccount) {
      const value =
        event.from === selectedAccount ? -event.amount : event.amount;
      return { value, signed: true };
    }
    return { value: event.amount, signed: false };
  };

  const activeCardIndex = cards.findIndex(
    (c) => c.id === (selectedAccount || activeCard?.id),
  );
  const resolvedActiveIndex = activeCardIndex >= 0 ? activeCardIndex : 0;

  const handleQuickAction = (actionType) => {
    if (actionType === "income") {
      triggerHaptic("light");
      if (!cards.length) {
        onAddCardClick?.();
        return;
      }
      onTx("income", selectedAccount);
    } else if (actionType === "transfer") {
      triggerHaptic("light");
      if (!cards.length) {
        onAddCardClick?.();
        return;
      }
      if (activeCard?.frozen) {
        onLockedCardNotice?.(activeCard.name);
        return;
      }
      onTx("transfer", selectedAccount);
    } else if (actionType === "adjust") {
      triggerHaptic("light");
      if (!cards.length) {
        onAddCardClick?.();
        return;
      }
      onTx("adjust", selectedAccount);
    } else if (actionType === "card-options") {
      triggerHaptic("selection");
      if (!cards.length) {
        onAddCardClick?.();
        return;
      }
      onOpenCardOptions?.(selectedAccount || activeCard?.id || cards[0]?.id);
    }
  };

  return (
    <>
      {/* 3D Stacked Cards Wallet Deck */}
      <StackedCardDeck
        cards={cards}
        balances={balances}
        selectedId={selectedAccount}
        onSelectCard={chooseAccount}
        onAddCardClick={onAddCardClick}
        onOpenCardDetails={(card) => card && onOpenCardOptions?.(card.id)}
        onDragOffsetChange={setDeckDragY}
        showDots={false}
      />

      {/* Reactive Layout Reflow: Quick Actions & Transactions translate in tandem with card gesture */}
      <div
        className={`accounts-reactive-body${deckDragY !== 0 ? " is-dragging" : ""}`}
        style={
          deckDragY !== 0
            ? {
                transform: `translate3d(0, ${deckDragY < 0 ? deckDragY * 0.35 : deckDragY * 0.15}px, 0)`,
              }
            : undefined
        }
      >
        <QuickActionsRow
          activeDotIndex={resolvedActiveIndex}
          dotCount={cards.length > 0 ? cards.length : 4}
          highlightSend={false} // Set to true for a solid brand "Send" button
          onAddMoney={() => handleQuickAction("income")}
          onSend={() => handleQuickAction("transfer")}
          onAdjust={() => handleQuickAction("adjust")}
          onCardOptions={() => handleQuickAction("card-options")}
        />

        {/* Transactions Section matching Video Header & List */}
        <div className="accounts-transactions-header">
          <h2>Transactions</h2>
          {filteredEvents.length > 8 && (
            <button
              type="button"
              className="accounts-see-all-link see-all-btn"
              onClick={() => {
                triggerHaptic("selection");
                setShowAllTx((prev) => !prev);
              }}
            >
              {showAllTx ? "Show less" : `See all (${filteredEvents.length})`}
            </button>
          )}
        </div>

        <div className="accounts-transactions-card">
          {visibleEvents.length ? (
            visibleEvents.map((event) => {
              const amount = displayAmount(event);
              const isPositive = amount.value > 0;
              const adjustment = adjustmentBalances.get(event.id);
              const category = event.cat || "Food";
              const subtitleMeta =
                event.type === "transfer"
                  ? `${getAccountName(event.from)} → ${getAccountName(event.to)}`
                  : getAccountName(event.account);

              const rowItem = {
                id: event.id,
                sourceType: event.sourceType,
                type: event.type,
                cat: category,
                desc: event.title,
                note: event.title,
                title: event.title,
                amt: Math.abs(amount.value),
                date: event.d,
                acct: event.account,
                from: event.from,
                to: event.to,
                dir: event.dir,
                direction: event.direction,
                refund: isPositive && event.sourceType === "expense",
                signedDirection: amount.signed
                  ? isPositive
                    ? "positive"
                    : "negative"
                  : "neutral",
                customMeta: `${displayDate(event.d)} · ${subtitleMeta}`,
                customSubNote: adjustment
                  ? `Balance: ${M(adjustment.before)} → ${M(adjustment.after)}`
                  : "",
              };

              return (
                <ExpenseRow
                  key={`${event.sourceType}-${event.id}`}
                  e={rowItem}
                  cards={cards}
                  deletedCards={S?.deletedCards}
                  onOpen={onOpenExpense}
                  onOpenTransaction={onOpenTransaction}
                  onDelete={onDeleteExpense}
                  onDeleteTransaction={onDeleteTransaction}
                  onDuplicate={
                    event.sourceType === "expense"
                      ? () => {
                          const orig = S.exp.find((x) => x.id === event.id);
                          return orig ? onDuplicateExpense?.(orig) : false;
                        }
                      : undefined
                  }
                  isNew={
                    highlightedExpenseId === event.id ||
                    highlightedTransactionId === event.id
                  }
                />
              );
            })
          ) : (
            <div
              className="accounts-tx-empty"
              style={{ "--card-accent": activeCard?.color || "#2563eb" }}
            >
              <div className="accounts-tx-empty-icon-wrap">
                <div className="accounts-tx-empty-glow" />
                <div className="accounts-tx-empty-badge">
                  <AnimatedTransactionsIcon />
                </div>
              </div>

              <div className="accounts-tx-empty-text">
                <h4 className="accounts-tx-empty-title">No transactions yet</h4>
                <p className="accounts-tx-empty-desc">
                  Activity for{" "}
                  <strong className="accounts-tx-empty-card-name">
                    {activeCard?.name || "this card"}
                  </strong>{" "}
                  will show up here.
                </p>
              </div>

              {activeCard?.frozen && (
                <div className="accounts-tx-empty-frozen">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>Card is locked</span>
                  <button
                    type="button"
                    className="accounts-tx-empty-unlock-btn"
                    onClick={() => {
                      triggerHaptic("selection");
                      onOpenCardOptions?.(
                        selectedAccount || activeCard?.id || cards[0]?.id,
                      );
                    }}
                  >
                    Manage
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const RECURRING_FREQUENCIES = {
  weekly: { factor: 52 / 12, suffix: "/wk" },
  biweekly: { factor: 26 / 12, suffix: "/2wk" },
  monthly: { factor: 1, suffix: "/mo" },
  yearly: { factor: 1 / 12, suffix: "/yr" },
};

export function normalizeToMonthly(amount, frequency = "monthly") {
  const parsedAmount = Number(amount);
  const value = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const key = String(frequency || "monthly").toLowerCase();
  return value * (RECURRING_FREQUENCIES[key]?.factor ?? 1);
}

export function getFreqSuffix(frequency = "monthly") {
  const key = String(frequency || "monthly").toLowerCase();
  return RECURRING_FREQUENCIES[key]?.suffix ?? "/mo";
}

export { QuickActionsRow, QuickAction, FallbackIcons };

function parseRecurringDate(value) {
  if (!value) return null;
  const raw = String(value);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (parts) {
    const [, year, month, day] = parts;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      return null;
    }
    return date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDaysUntilDue(nextDate, now = new Date()) {
  const due = parseRecurringDate(nextDate);
  if (!due) return null;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((dueStart - todayStart) / 86400000);
}

function formatDueShortDate(nextDate) {
  const date = parseRecurringDate(nextDate);
  if (!date) return nextDate ? String(nextDate) : "Unscheduled";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatRelativeDueLabel(days) {
  if (days == null) return "";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function isRecurringPaused(item) {
  return (
    item.on === false ||
    item.on === 0 ||
    item.active === false ||
    Boolean(item.paused)
  );
}

function sortRecurringSection(items) {
  return [...items].sort((a, b) => {
    const aPaused = isRecurringPaused(a);
    const bPaused = isRecurringPaused(b);
    if (aPaused !== bPaused) return aPaused ? 1 : -1;

    const aDate =
      parseRecurringDate(a.next)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDate =
      parseRecurringDate(b.next)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aDate !== bDate) return aDate - bDate;

    const aCreated =
      typeof a.createdAt === "number"
        ? a.createdAt
        : Date.parse(a.createdAt || "") || 0;
    const bCreated =
      typeof b.createdAt === "number"
        ? b.createdAt
        : Date.parse(b.createdAt || "") || 0;
    return bCreated - aCreated;
  });
}

const RECURRING_SWIPE_WIDTH = 84;

const RecurringRow = memo(function RecurringRow({ item, fmt, accountLabel, onSelect, onTogglePause }) {
  const pointerRef = useRef(null);
  const rowRef = useRef(null);
  const shellRef = useRef(null);
  const closeTimerRef = useRef();
  const suppressClickTimerRef = useRef();
  const suppressClickRef = useRef(false);
  const dragFrameRef = useRef(null);
  const pendingOffsetRef = useRef(0);
  const [swipe, setSwipe] = useState({ offset: 0, phase: "idle" });
  const swipeRef = useRef(swipe);

  const updateSwipe = (next) => {
    swipeRef.current = next;
    setSwipe(next);
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
    }, 500);
  };

  const springRowClosed = useCallback(() => {
    clearTimeout(closeTimerRef.current);
    const prevOffset = pendingOffsetRef.current || swipeRef.current.offset || 0;
    const hasOffset = Math.abs(prevOffset) > 1;
    const duration = getRowSwipeSpringDuration(prevOffset);
    pendingOffsetRef.current = 0;
    shellRef.current?.removeAttribute("data-threshold");
    shellRef.current?.classList.remove("is-dragging", "is-swipe-dragging");
    shellRef.current?.style.setProperty("--swipe-tx", "0px");
    if (rowRef.current) {
      rowRef.current.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      rowRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (hasOffset) {
      shellRef.current?.classList.add("is-closing");
      updateSwipe({ offset: 0, phase: "closing" });
      closeTimerRef.current = setTimeout(() => {
        shellRef.current?.classList.remove("is-closing");
        shellRef.current?.removeAttribute("data-swipe-dir");
        shellRef.current?.style.removeProperty("--swipe-p");
        shellRef.current?.style.removeProperty("--swipe-tx");
        updateSwipe({ offset: 0, phase: "idle" });
        if (rowRef.current) {
          rowRef.current.style.transition = "";
          rowRef.current.style.transform = "";
        }
      }, duration);
    } else {
      shellRef.current?.classList.remove("is-closing");
      shellRef.current?.removeAttribute("data-swipe-dir");
      shellRef.current?.style.removeProperty("--swipe-p");
      shellRef.current?.style.removeProperty("--swipe-tx");
      updateSwipe({ offset: 0, phase: "idle" });
      if (rowRef.current) {
        rowRef.current.style.transition = "";
        rowRef.current.style.transform = "";
      }
    }
  }, []);

  const executeRightSwipeAction = useCallback(() => {
    springRowClosed();
    triggerHaptic("selection");
    onSelect(item);
  }, [item, onSelect, springRowClosed]);

  // Automatically reset to idle when tapping anywhere outside if revealed
  useEffect(() => {
    if (swipe.phase !== "revealed") return undefined;
    const handleOutside = (event) => {
      if (
        rowRef.current &&
        !rowRef.current.contains(event.target) &&
        (!shellRef.current || !shellRef.current.contains(event.target))
      ) {
        springRowClosed();
      }
    };
    window.addEventListener("pointerdown", handleOutside, true);
    return () => window.removeEventListener("pointerdown", handleOutside, true);
  }, [swipe.phase, springRowClosed]);

  useEffect(
    () => () => {
      clearTimeout(closeTimerRef.current);
      clearTimeout(suppressClickTimerRef.current);
      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
      }
    },
    [],
  );

  const paused = isRecurringPaused(item);
  const daysUntil = getDaysUntilDue(item.next);
  const isOverdue = !paused && daysUntil !== null && daysUntil < 0;
  const showUrgentPill = !paused && daysUntil !== null && daysUntil <= 7;
  const title = item.desc || item.cat || "Recurring";
  const freqSuffix = getFreqSuffix(item.iv || "monthly");
  const iconColor =
    getCategoryColor(item.cat, item.desc) || CAT[item.cat]?.[1] || "#64748b";

  const startGesture = (event) => {
    if (event.button != null && event.button !== 0) return;
    const initialOffset = swipeRef.current.offset;
    // Dynamic Android 32px right-edge deadzone: prevent left-swipe row gesture from fighting Android system Back swipe
    const viewportWidth =
      typeof window !== "undefined"
        ? window.innerWidth || document.documentElement.clientWidth || 360
        : 360;
    if (
      initialOffset === 0 &&
      isAndroidPlatform() &&
      typeof event.clientX === "number" &&
      event.clientX >= viewportWidth - ANDROID_RIGHT_EDGE_DEADZONE_PX
    ) {
      return;
    }
    clearTimeout(closeTimerRef.current);
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }

    if (rowRef.current) {
      rowRef.current.style.transition = "none";
    }
    const width = rowRef.current?.offsetWidth || 320;

    const now = performance.now();
    pointerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lockOriginX: event.clientX,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX: 0,
      startedAt: now,
      width,
      moved: false,
      horizontal: false,
      vertical: false,
      draggingStateApplied: false,
      initialOffset,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      passedHaptic: false,
    };
    pendingOffsetRef.current = initialOffset;
    suppressClickRef.current = false;
  };

  const moveGesture = (event) => {
    const gesture = pointerRef.current;
    if (!gesture || gesture.vertical) return;
    if (gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > 6 || absDy > 6) {
      gesture.moved = true;
    }

    if (!gesture.horizontal) {
      if (
        gesture.initialOffset === 0 &&
        absDy > ROW_SWIPE_LOCK_DISTANCE &&
        absDy > absDx
      ) {
        gesture.vertical = true;
        return;
      }

      const isHorizontalIntent =
        (absDx > ROW_SWIPE_LOCK_DISTANCE &&
          absDx > absDy * ROW_SWIPE_LOCK_RATIO) ||
        (gesture.initialOffset !== 0 && absDx > 6);

      if (isHorizontalIntent) {
        gesture.horizontal = true;
        gesture.lockOriginX = event.clientX;
        gesture.lastX = event.clientX;
        gesture.lastTime = performance.now();
        gesture.velocityX = 0;
        suppressNextClick();
        rowRef.current?.classList.add("is-swipe-dragging");
        shellRef.current?.classList.remove("is-closing");
        shellRef.current?.classList.add("is-dragging", "is-swipe-dragging");
        try {
          event.currentTarget.setPointerCapture(gesture.pointerId);
        } catch {}
        if (!gesture.draggingStateApplied) {
          gesture.draggingStateApplied = true;
          updateSwipe({
            offset: gesture.initialOffset,
            phase: "dragging",
          });
        }
      }
    }

    if (gesture.horizontal) {
      const now = performance.now();
      const dt = Math.max(1, now - gesture.lastTime);
      const instantVelocity = (event.clientX - gesture.lastX) / dt;
      gesture.velocityX = gesture.velocityX * 0.4 + instantVelocity * 0.6;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      gesture.lastTime = now;

      const effectiveDx = event.clientX - gesture.lockOriginX;
      const targetOffset = applyRowSwipeResistance(
        gesture.initialOffset + effectiveDx,
        true,
        true,
        gesture.width,
      );

      if (targetOffset < -1) {
        shellRef.current?.setAttribute("data-swipe-dir", "left");
      } else if (targetOffset > 1) {
        shellRef.current?.setAttribute("data-swipe-dir", "right");
      } else {
        shellRef.current?.removeAttribute("data-swipe-dir");
      }

      const { left: leftThreshold, right: rightThreshold } =
        getRowSwipeFullThresholds(gesture.width);
      const isPastThreshold =
        targetOffset <= -leftThreshold || targetOffset >= rightThreshold;
      if (isPastThreshold && !gesture.passedHaptic) {
        gesture.passedHaptic = true;
        triggerHaptic("medium");
        shellRef.current?.setAttribute("data-threshold", "true");
      } else if (!isPastThreshold && gesture.passedHaptic) {
        gesture.passedHaptic = false;
        shellRef.current?.removeAttribute("data-threshold");
      }

      pendingOffsetRef.current = targetOffset;
      swipeRef.current.offset = targetOffset;

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          dragFrameRef.current = null;
          const offset = pendingOffsetRef.current;
          if (rowRef.current) {
            rowRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
          }
          updateRowSwipeVisuals(
            shellRef.current,
            offset,
            Boolean(pointerRef.current?.passedHaptic),
          );
        });
      }
    }
  };

  const endGesture = (event) => {
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const gesture = pointerRef.current;
    pointerRef.current = null;

    if (!gesture) return;

    try {
      if (event?.currentTarget?.hasPointerCapture?.(gesture.pointerId)) {
        event.currentTarget.releasePointerCapture(gesture.pointerId);
      }
    } catch {}

    rowRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.classList.remove("is-dragging", "is-swipe-dragging");
    shellRef.current?.removeAttribute("data-threshold");

    const snapToRevealed = (dir) => {
      const target = dir === "left" ? -ROW_SWIPE_REVEAL_OFFSET : ROW_SWIPE_REVEAL_OFFSET;
      const duration = getRowSwipeSpringDuration(pendingOffsetRef.current - target);
      pendingOffsetRef.current = target;
      shellRef.current?.setAttribute("data-swipe-dir", dir);
      shellRef.current?.style.setProperty("--swipe-p", "1");
      shellRef.current?.style.setProperty("--swipe-tx", "0px");
      updateSwipe({ offset: target, phase: "revealed" });
      if (rowRef.current) {
        rowRef.current.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        rowRef.current.style.transform = `translate3d(${target}px, 0, 0)`;
      }
    };

    if (event?.type === "pointercancel") {
      if (gesture.initialOffset === -ROW_SWIPE_REVEAL_OFFSET) {
        snapToRevealed("left");
      } else if (gesture.initialOffset === ROW_SWIPE_REVEAL_OFFSET) {
        snapToRevealed("right");
      } else {
        springRowClosed();
      }
      return;
    }

    if (gesture.horizontal) {
      const effectiveDx = (event?.clientX ?? gesture.lastX) - gesture.lockOriginX;
      const currentOffset = pendingOffsetRef.current;
      const isRecentMove = performance.now() - gesture.lastTime < 90;
      const velocity = isRecentMove ? gesture.velocityX : 0;
      const { left: leftThreshold, right: rightThreshold } =
        getRowSwipeFullThresholds(gesture.width);

      suppressNextClick();

      // Full-swipe commit ONLY when intentionally dragged past the deep threshold
      const shouldFullLeftAction = currentOffset <= -leftThreshold;
      const shouldFullRightAction = currentOffset >= rightThreshold;

      if (shouldFullLeftAction) {
        springRowClosed();
        triggerHaptic("selection");
        onTogglePause(item);
      } else if (shouldFullRightAction) {
        executeRightSwipeAction();
      } else if (gesture.initialOffset < 0) {
        const closingFlick = effectiveDx > 16 && velocity > 0.25;
        if (closingFlick || currentOffset > -52) {
          springRowClosed();
        } else {
          snapToRevealed("left");
        }
      } else if (gesture.initialOffset > 0) {
        const closingFlick = effectiveDx < -16 && velocity < -0.25;
        if (closingFlick || currentOffset < 52) {
          springRowClosed();
        } else {
          snapToRevealed("right");
        }
      } else if (
        currentOffset <= -ROW_SWIPE_REVEAL_THRESHOLD ||
        (effectiveDx < -24 && velocity < -0.32)
      ) {
        snapToRevealed("left");
      } else if (
        currentOffset >= ROW_SWIPE_REVEAL_THRESHOLD ||
        (effectiveDx > 24 && velocity > 0.32)
      ) {
        snapToRevealed("right");
      } else {
        springRowClosed();
      }
    }
  };

  const handleRowClick = (event) => {
    if (isRowClickLocked()) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      clearTimeout(suppressClickTimerRef.current);
      return;
    }
    if (
      swipeRef.current.phase === "revealed" ||
      swipeRef.current.offset !== 0
    ) {
      springRowClosed();
      return;
    }
    onSelect(item);
  };

  const rowClasses = [
    "rec-row",
    "expense-row",
    paused && "is-paused",
    swipe.phase === "dragging" && "is-swipe-dragging",
    swipe.phase === "revealed" && "is-swipe-revealed",
  ]
    .filter(Boolean)
    .join(" ");

  const shellClasses = [
    "rec-row-swipe-wrap",
    "expense-swipe-shell",
    swipe.phase === "dragging" && "is-dragging",
    swipe.phase === "dragging" && "is-swipe-dragging",
    swipe.phase === "revealed" && "is-revealed",
    swipe.phase === "revealed" && "is-swipe-revealed",
    swipe.phase === "closing" && "is-closing",
    swipe.offset > 0 && "is-right-swipe",
    paused && "is-paused-item",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={shellRef} className={shellClasses}>
      {/* Left Action Button (Swipe Right to Edit) */}
      <button
        className="expense-swipe-delete is-left is-edit"
        type="button"
        tabIndex={swipe.phase === "revealed" && swipe.offset > 0 ? 0 : -1}
        inert={
          !(swipe.phase === "revealed" && swipe.offset > 0) ? true : undefined
        }
        aria-label={`Edit ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
          executeRightSwipeAction();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span>Edit</span>
      </button>

      {/* Right Action Button (Swipe Left to Pause/Resume) */}
      <button
        className={`expense-swipe-delete is-right ${paused ? "is-resume" : "is-pause"}`}
        type="button"
        tabIndex={swipe.phase === "revealed" && swipe.offset < 0 ? 0 : -1}
        inert={
          !(swipe.phase === "revealed" && swipe.offset < 0) ? true : undefined
        }
        aria-label={`${paused ? "Resume" : "Pause"} ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
          springRowClosed();
          onTogglePause(item);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {paused ? (
            <polygon points="7 4 19 12 7 20 7 4" />
          ) : (
            <>
              <rect x="6" y="5" width="4" height="14" rx="1.5" />
              <rect x="14" y="5" width="4" height="14" rx="1.5" />
            </>
          )}
        </svg>
        <span>{paused ? "Resume" : "Pause"}</span>
      </button>

      {/* The sliding row itself */}
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        className={rowClasses}
        onPointerDown={startGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onContextMenu={(event) => event.preventDefault()}
        onClick={handleRowClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (swipeRef.current.phase === "revealed") {
              springRowClosed();
            } else {
              onSelect(item);
            }
          } else if (event.key === "Escape") {
            if (swipeRef.current.phase === "revealed") {
              event.preventDefault();
              springRowClosed();
            }
          }
        }}
        aria-label={`${title}, ${fmt(item.amt)} ${freqSuffix}, next ${formatDueShortDate(item.next)}. ${paused ? "Paused" : "Active"}. Tap to edit, swipe left to ${paused ? "resume" : "pause"}, swipe right to edit.`}
      >
        <div className="rec-row-leading">
          <i
            className="ic rec-badge"
            style={{ "--c": iconColor }}
            aria-hidden="true"
          >
            <CategorySymbol category={item.cat} description={item.desc} />
          </i>
          <div className="rec-row-main">
            <div className="rec-row-title-line">
              <span className="rec-row-title">{title}</span>
              {paused && <span className="rec-paused-tag">Paused</span>}
            </div>
            <span className="rec-row-sub">
              {item.iv && item.iv !== "monthly" && (
                <span className="rec-cadence-tag">
                  {item.iv === "yearly"
                    ? "Yearly"
                    : item.iv === "weekly"
                      ? "Weekly"
                      : item.iv === "biweekly"
                        ? "Bi-weekly"
                        : item.iv}{" "}
                  ·{" "}
                </span>
              )}
              Next {formatDueShortDate(item.next)} · {accountLabel}
            </span>
          </div>
        </div>
        <div className="rec-row-right">
          <div className="rec-row-amt-line">
            <strong className="rec-row-amt">
              {fmt(Math.round(Number(item.amt) || 0))}
            </strong>
            <span className="rec-row-unit">{freqSuffix}</span>
          </div>
          {showUrgentPill && (
            <span className={`rec-due-pill${isOverdue ? " is-overdue" : ""}`}>
              {formatRelativeDueLabel(daysUntil)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

const plansScrollStore = {
  budget: 0,
  rec: 0,
};

const PLANS_COLLAPSE_RANGE_PX = 48;
const PLANS_COLLAPSE_DELTA_PX = 12;

function computePlansCollapse(scrollTop) {
  return Math.min(
    1,
    Math.max(0, (Number(scrollTop) || 0) / PLANS_COLLAPSE_RANGE_PX),
  );
}

function RecurringPlansView({
  schedules = [],
  cards = [],
  deletedCards = {},
  onAdd,
  onOpen,
  onToggle,
}) {
  const billsAll = useMemo(
    () =>
      sortRecurringSection(schedules.filter((item) => item.cat !== "Savings")),
    [schedules],
  );
  const savingsAll = useMemo(
    () =>
      sortRecurringSection(schedules.filter((item) => item.cat === "Savings")),
    [schedules],
  );
  const activeBills = useMemo(
    () => billsAll.filter((item) => !isRecurringPaused(item)),
    [billsAll],
  );
  const activeSavings = useMemo(
    () => savingsAll.filter((item) => !isRecurringPaused(item)),
    [savingsAll],
  );
  const billsMonthly = Math.round(
    activeBills.reduce(
      (sum, item) => sum + normalizeToMonthly(item.amt, item.iv),
      0,
    ),
  );
  const savingsMonthly = Math.round(
    activeSavings.reduce(
      (sum, item) => sum + normalizeToMonthly(item.amt, item.iv),
      0,
    ),
  );
  const totalMonthly = billsMonthly + savingsMonthly;
  const billsShare = totalMonthly > 0 ? (billsMonthly / totalMonthly) * 100 : 0;
  const savingsShare =
    totalMonthly > 0 ? (savingsMonthly / totalMonthly) * 100 : 0;
  const activeItems = [...activeBills, ...activeSavings];
  const nextItem = sortRecurringSection(activeItems)[0];
  const nextDays = nextItem ? getDaysUntilDue(nextItem.next) : null;
  const nextLabel = nextItem
    ? nextDays !== null && nextDays <= 14
      ? formatRelativeDueLabel(nextDays)
      : `on ${formatDueShortDate(nextItem.next)}`
    : "";
  const sections = [
    {
      id: "bills",
      title: "Bills & Others",
      items: billsAll,
      monthly: billsMonthly,
    },
    {
      id: "savings",
      title: "Savings",
      items: savingsAll,
      monthly: savingsMonthly,
    },
  ].filter((section) => section.items.length > 0);

  if (schedules.length === 0) {
    return (
      <div className="plans-recurring-scroll">
        <div className="rec-screen-bar">
          <span className="rec-screen-subtitle">
            Automated bills &amp; savings
          </span>
        </div>
        <section className="card rec-empty-card">
          <div className="emp-illustrated-icon" aria-hidden="true">
            <AnimatedRecurringIcon />
          </div>
          <h2 className="rec-empty-title">No recurring plans yet</h2>
          <p className="rec-empty-sub">
            Track rent, subscriptions, and recurring savings transfers in one
            place.
          </p>
          <button type="button" className="rec-empty-cta" onClick={onAdd}>
            + Add recurring
          </button>
        </section>
        <div className="plans-scroll-spacer" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="plans-recurring-scroll">
      <div className="rec-screen-bar">
        <span className="rec-screen-subtitle">Scheduled commitments</span>
      </div>

      <section className="rec-hero-card">
        <div className="rec-hero-top">
          <div className="rec-hero-label-group">
            <span className="rec-hero-label">Monthly commitment</span>
            <span className="rec-active-count-chip">
              {activeItems.length} active
            </span>
          </div>
        </div>
        <div className="rec-hero-total-row">
          <strong className="rec-hero-total">
            {`৳${new Intl.NumberFormat("en-IN").format(totalMonthly)}`}
          </strong>
          <span className="rec-hero-total-unit">/mo</span>
        </div>
        <div className="rec-seg-block">
          <div className="rec-seg-track" aria-hidden="true">
            {billsShare > 0 && (
              <div
                className="rec-seg-fill is-bills"
                style={{ width: `${billsShare}%` }}
              />
            )}
            {savingsShare > 0 && (
              <div
                className="rec-seg-fill is-savings"
                style={{ width: `${savingsShare}%` }}
              />
            )}
          </div>
          <div className="rec-seg-legend">
            <div className="rec-seg-legend-item">
              <span className="rec-legend-dot is-bills" />
              <span className="rec-legend-name">Bills</span>
              <strong className="rec-legend-val">
                {`৳${new Intl.NumberFormat("en-IN").format(billsMonthly)}`}
              </strong>
            </div>
            <div className="rec-seg-legend-item">
              <span className="rec-legend-dot is-savings" />
              <span className="rec-legend-name">Savings</span>
              <strong className="rec-legend-val">
                {`৳${new Intl.NumberFormat("en-IN").format(savingsMonthly)}`}
              </strong>
            </div>
          </div>
        </div>
        <div className="rec-hero-footer">
          {nextItem ? (
            <span className="pace-pill is-lime rec-next-pill">
              Next: {nextItem.desc || nextItem.cat || "Payment"} · {nextLabel}
            </span>
          ) : (
            <span className="rec-all-paused-pill">
              All recurring items paused
            </span>
          )}
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.id} className="card rec-section-card">
          <header className="rec-section-header">
            <div className="rec-section-title-group">
              <span
                className={`rec-section-dot is-${section.id}`}
                aria-hidden="true"
              />
              <h2 className="section-title rec-section-title">
                {section.title}
              </h2>
              <span className="rec-section-count">{section.items.length}</span>
            </div>
            <div className="rec-section-sum">
              <strong>
                {`৳${new Intl.NumberFormat("en-IN").format(section.monthly)}`}
              </strong>
              <span>/mo</span>
            </div>
          </header>
          <div className="rec-rows-list">
            {section.items.map((item) => (
              <RecurringRow
                key={item.id}
                item={item}
                fmt={M}
                accountLabel={
                  getAccountDisplay(item.acct, cards, deletedCards)[0]
                }
                onSelect={(selected) => {
                  triggerHaptic("selection");
                  onOpen(selected.id);
                }}
                onTogglePause={(selected) => {
                  triggerHaptic("selection");
                  onToggle(selected.id);
                }}
              />
            ))}
          </div>
        </section>
      ))}
      <div className="plans-scroll-spacer" aria-hidden="true" />
    </div>
  );
}

function Plans({
  S,
  plan,
  setPlan,
  isActive = true,
  onShift,
  onBudget,
  onBudgetInsights,
  onAddRec,
  onOpenRec,
  onToggleRec,
}) {
  const fmt = (value) => M(value);
  const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;
  const savingsThisMonth = round2(
    monthExp(S)
      .filter((expense) => expense.cat === "Savings" && expense.amt != null)
      .reduce((sum, expense) => sum + expense.amt, 0),
  );
  const b = round2(S.bud[S.m] || 0);
  const t = Math.max(0, round2(round2(tot(S, S.m)) - savingsThisMonth));
  const todayStr = ld();
  const isCurrentMonth = S.m === todayStr.slice(0, 7);
  let velocity = null;
  if (b > 0) {
    const [y, mNum] = S.m.split("-").map(Number);
    const daysInMonth = new Date(y, mNum, 0).getDate();
    const currentDay = isCurrentMonth
      ? Math.min(daysInMonth, Number(todayStr.split("-")[2]) || 1)
      : daysInMonth;
    const daysPassed = Math.max(1, currentDay);
    const expectedSpent = (b / daysInMonth) * daysPassed;
    const paceDiff = round2(t - expectedSpent);
    const roundedPaceDiff = Math.round(paceDiff);
    const currentDailyBurn = Math.round(t / daysPassed);
    const dailyTarget = Math.round(b / daysInMonth);
    const budgetUsedPct = Math.min(100, Math.max(0, (t / b) * 100));
    const timeElapsedPct = Math.min(
      100,
      Math.max(0, (daysPassed / daysInMonth) * 100),
    );
    velocity = {
      daysInMonth,
      currentDay,
      daysPassed,
      expectedSpent,
      paceDiff,
      roundedPaceDiff,
      currentDailyBurn,
      dailyTarget,
      actualDailyBurn: currentDailyBurn,
      targetDailyPace: dailyTarget,
      budgetUsedPct,
      timeElapsedPct,
      isOverPace: t > b || paceDiff > dailyTarget,
      isNearPace:
        t <= b &&
        (budgetUsedPct >= 85 || (paceDiff > 0 && paceDiff <= dailyTarget)),
      isUnderPace: t <= b && roundedPaceDiff < 0,
    };
  }

  const { month: monthLabel, year: yearLabel } = getMonthYearParts(S.m);
  const isCurrentOrFutureMonth = S.m >= todayStr.slice(0, 7);
  const overBudget = b > 0 && t > b;
  const pctUsed = b > 0 ? (t / b) * 100 : 0;
  const spentPct = b > 0 ? Math.min(100, pctUsed) : 0;
  const expectedByToday = velocity ? Math.round(velocity.expectedSpent) : 0;
  const expectedPct = b > 0 ? Math.min(100, (expectedByToday / b) * 100) : 0;
  const paceDiffAbs = velocity ? Math.round(Math.abs(velocity.paceDiff)) : 0;
  const ringStrokeColor = overBudget
    ? "#e11d48"
    : pctUsed >= 85
      ? "#f97316"
      : "#d9f56b";
  const paceStatusTone = velocity?.isOverPace
    ? "crimson"
    : velocity?.isNearPace
      ? "orange"
      : "lime";

  const shellRef = useRef(null);
  const headerRef = useRef(null);
  const segRowRef = useRef(null);
  const stageRef = useRef(null);
  const budgetScrollerRef = useRef(null);
  const recScrollerRef = useRef(null);
  const ringCardRef = useRef(null);
  const budgetTabBtnRef = useRef(null);
  const recTabBtnRef = useRef(null);
  const rafIdRef = useRef(0);
  const swipeRafRef = useRef(0);
  const collapseTweenRafRef = useRef(0);
  const collapseValRef = useRef(0);
  const suppressStageClickUntilRef = useRef(0);
  const swipeDragRef = useRef({
    active: false,
    pointerId: null,
    pointerType: "",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    axis: null,
    baseProgress: 0,
    progress: 0,
    stageWidth: 375,
  });

  // Threshold-only React states (no per-frame setState)
  const [hasScrolled, setHasScrolled] = useState(
    () => (plansScrollStore[plan] || 0) > 2,
  );
  const hasScrolledRef = useRef(hasScrolled);
  const [ringVisible, setRingVisible] = useState(true);
  const ringVisibleRef = useRef(true);
  const [collapsedHeaderPx, setCollapsedHeaderPx] = useState(106);

  const getActivePlanScroller = useCallback(
    (targetPlan = plan) =>
      targetPlan === "rec" ? recScrollerRef.current : budgetScrollerRef.current,
    [plan],
  );

  const cancelCollapseTween = useCallback(() => {
    if (collapseTweenRafRef.current) {
      window.cancelAnimationFrame(collapseTweenRafRef.current);
      collapseTweenRafRef.current = 0;
    }
  }, []);

  const applyScrollMetrics = useCallback(
    (scrollTop) => {
      cancelCollapseTween();
      const progress = computePlansCollapse(scrollTop);
      collapseValRef.current = progress;
      if (shellRef.current) {
        shellRef.current.style.setProperty("--collapse", progress.toFixed(4));
      }
      const nextScrolled = scrollTop > 2;
      if (hasScrolledRef.current !== nextScrolled) {
        hasScrolledRef.current = nextScrolled;
        setHasScrolled(nextScrolled);
      }
    },
    [cancelCollapseTween],
  );

  const tweenCollapseTo = useCallback(
    (targetCollapse) => {
      cancelCollapseTween();
      const startCollapse = collapseValRef.current;
      if (
        Math.abs(targetCollapse - startCollapse) < 0.005 ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      ) {
        collapseValRef.current = targetCollapse;
        shellRef.current?.style.setProperty(
          "--collapse",
          targetCollapse.toFixed(4),
        );
        return;
      }
      const startTime = performance.now();
      const duration = 260;
      const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = startCollapse + (targetCollapse - startCollapse) * eased;
        collapseValRef.current = val;
        shellRef.current?.style.setProperty("--collapse", val.toFixed(4));
        if (t < 1) {
          collapseTweenRafRef.current = window.requestAnimationFrame(step);
        } else {
          collapseTweenRafRef.current = 0;
        }
      };
      collapseTweenRafRef.current = window.requestAnimationFrame(step);
    },
    [cancelCollapseTween],
  );

  const syncRingVisibilityManual = useCallback(
    (activePlan = plan) => {
      if (activePlan !== "budget" || b <= 0) {
        if (!ringVisibleRef.current) {
          ringVisibleRef.current = true;
          setRingVisible(true);
        }
        return;
      }
      const scroller = budgetScrollerRef.current;
      const ringEl = ringCardRef.current;
      if (!scroller || !ringEl) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const ringRect = ringEl.getBoundingClientRect();
      if (scrollerRect.height === 0 && ringRect.height === 0) return;
      const headerBottom = scrollerRect.top;
      const isVisible = ringRect.bottom > headerBottom;
      if (ringVisibleRef.current !== isVisible) {
        ringVisibleRef.current = isVisible;
        setRingVisible(isVisible);
      }
    },
    [plan, b],
  );

  // Keep --header-expanded-h and --header-collapsed-h synced with actual header geometry
  // Observe segRowRef (and window resize) rather than headerRef so ResizeObserver never fires during scroll collapse
  useEffect(() => {
    if (!isActive) return undefined;
    const headerEl = headerRef.current;
    const segRowEl = segRowRef.current;
    const shellEl = shellRef.current;
    if (!headerEl || !shellEl) return undefined;

    const updateHeaderHeights = () => {
      const currentH = headerEl.offsetHeight;
      if (!currentH) return;
      const rootFontPx =
        parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        ) || 16;
      const deltaPx = Math.round((PLANS_COLLAPSE_DELTA_PX / 16) * rootFontPx);
      const currentCollapse = collapseValRef.current || 0;
      const expandedH = Math.round(currentH + currentCollapse * deltaPx);
      const collapsedH = Math.max(72, expandedH - deltaPx);
      shellEl.style.setProperty("--header-expanded-h", `${expandedH}px`);
      shellEl.style.setProperty("--header-collapsed-h", `${collapsedH}px`);
      setCollapsedHeaderPx((prev) =>
        Math.abs(prev - collapsedH) > 1 ? collapsedH : prev,
      );
    };

    updateHeaderHeights();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateHeaderHeights)
        : null;
    if (ro && segRowEl) ro.observe(segRowEl);
    window.addEventListener("resize", updateHeaderHeights);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateHeaderHeights);
    };
  }, [isActive]);

  // Restore active tab's scrollTop before paint & derive header state strictly from ACTIVE tab
  // Re-runs both when switching Budget <-> Recurring and when returning from Home/Activity/Accounts (isActive)
  useLayoutEffect(() => {
    if (shellRef.current && !swipeDragRef.current.active) {
      shellRef.current.style.setProperty(
        "--plans-swipe",
        plan === "rec" ? "1" : "0",
      );
    }
    if (!isActive) return;
    const scroller = getActivePlanScroller(plan);
    if (!scroller) return;
    const savedTop = plansScrollStore[plan] ?? 0;
    if (Math.abs(scroller.scrollTop - savedTop) > 1) {
      void scroller.offsetHeight;
      scroller.scrollTop = savedTop;
    }
    if (!collapseTweenRafRef.current) {
      applyScrollMetrics(scroller.scrollTop);
    } else {
      const nextScrolled = scroller.scrollTop > 2;
      if (hasScrolledRef.current !== nextScrolled) {
        hasScrolledRef.current = nextScrolled;
        setHasScrolled(nextScrolled);
      }
    }
    syncRingVisibilityManual(plan);
  }, [
    plan,
    isActive,
    S.m,
    b,
    getActivePlanScroller,
    applyScrollMetrics,
    syncRingVisibilityManual,
  ]);

  // Passive scroll listener wrapped in requestAnimationFrame on the active tab container
  useEffect(() => {
    if (!isActive) return undefined;
    const scroller = getActivePlanScroller(plan);
    if (!scroller) return undefined;

    let ticking = false;
    const update = () => {
      ticking = false;
      // Guard against browser scroll-to-0 resets when outer tab panel becomes display: none
      if (!scroller.offsetParent && scroller.scrollTop === 0) return;
      const top = scroller.scrollTop;
      plansScrollStore[plan] = top;
      applyScrollMetrics(top);
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        rafIdRef.current = window.requestAnimationFrame(update);
      }
    };

    applyScrollMetrics(scroller.scrollTop);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafIdRef.current) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [plan, isActive, getActivePlanScroller, applyScrollMetrics]);

  // IntersectionObserver on the ring card with active Budget scroll container as root
  useEffect(() => {
    if (!isActive || plan !== "budget" || b <= 0) {
      if (!ringVisibleRef.current) {
        ringVisibleRef.current = true;
        setRingVisible(true);
      }
      return undefined;
    }
    const scroller = budgetScrollerRef.current;
    const ringEl = ringCardRef.current;
    if (!scroller || !ringEl || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const rootTop =
          entry.rootBounds?.top ?? scroller.getBoundingClientRect().top;
        const nextVisible =
          entry.isIntersecting || entry.boundingClientRect.top >= rootTop;
        if (ringVisibleRef.current !== nextVisible) {
          ringVisibleRef.current = nextVisible;
          setRingVisible(nextVisible);
        }
      },
      {
        root: scroller,
        rootMargin: "0px 0px 0px 0px",
        threshold: 0,
      },
    );

    observer.observe(ringEl);
    return () => observer.disconnect();
  }, [isActive, plan, b, S.m]);

  const scrollActiveTabToTop = useCallback(() => {
    const scroller = getActivePlanScroller(plan);
    if (!scroller) return;
    plansScrollStore[plan] = 0;
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    scroller.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    if (prefersReducedMotion || scroller.scrollTop === 0) {
      applyScrollMetrics(0);
      syncRingVisibilityManual(plan);
    }
  }, [
    plan,
    getActivePlanScroller,
    applyScrollMetrics,
    syncRingVisibilityManual,
  ]);

  const selectPlanTab = useCallback(
    (nextPlan, focusTarget = false) => {
      if (nextPlan !== plan) {
        triggerHaptic("selection");
        setPlan(nextPlan);
      }
      if (focusTarget) {
        const btn =
          nextPlan === "budget"
            ? budgetTabBtnRef.current
            : recTabBtnRef.current;
        btn?.focus();
      }
    },
    [plan, setPlan],
  );

  const handleSegKeyDown = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = plan === "budget" ? "rec" : "budget";
      selectPlanTab(next, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectPlanTab("budget", true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectPlanTab("rec", true);
    }
  };

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return undefined;
    const onTouchMove = (e) => {
      if (swipeDragRef.current.active && swipeDragRef.current.axis === "x") {
        if (e.cancelable) e.preventDefault();
      }
    };
    stageEl.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      stageEl.removeEventListener("touchmove", onTouchMove);
      if (swipeRafRef.current) {
        window.cancelAnimationFrame(swipeRafRef.current);
        swipeRafRef.current = 0;
      }
      cancelCollapseTween();
    };
  }, [cancelCollapseTween]);

  const applyLiveSwipe = useCallback(
    (progress) => {
      cancelCollapseTween();
      const shellEl = shellRef.current;
      if (!shellEl) return;
      shellEl.style.setProperty("--plans-swipe", progress.toFixed(4));
      const clamped = Math.min(1, Math.max(0, progress));
      shellEl.setAttribute(
        "data-swipe-target",
        clamped >= 0.5 ? "rec" : "budget",
      );
      const budgetCollapse = computePlansCollapse(plansScrollStore.budget || 0);
      const recCollapse = computePlansCollapse(plansScrollStore.rec || 0);
      const blendedCollapse =
        budgetCollapse + (recCollapse - budgetCollapse) * clamped;
      collapseValRef.current = blendedCollapse;
      shellEl.style.setProperty("--collapse", blendedCollapse.toFixed(4));
    },
    [cancelCollapseTween],
  );

  const handleStagePointerDown = useCallback(
    (e) => {
      if (!isActive) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Preserve OS edge-back gestures on touch devices
      if (
        e.pointerType === "touch" &&
        (e.clientX <= 18 || e.clientX >= window.innerWidth - 18)
      ) {
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          ".expense-swipe-shell, input, textarea, select, [data-no-plan-swipe]",
        )
      ) {
        return;
      }
      const stageEl = stageRef.current;
      const width = stageEl?.offsetWidth || window.innerWidth || 375;
      const base = plan === "rec" ? 1 : 0;
      swipeDragRef.current = {
        active: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        lockOriginX: e.clientX,
        lastX: e.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        axis: null,
        baseProgress: base,
        progress: base,
        stageWidth: width,
      };
    },
    [isActive, plan],
  );

  const handleStagePointerMove = useCallback(
    (e) => {
      const drag = swipeDragRef.current;
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.axis === null) {
        if (Math.hypot(dx, dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          drag.axis = "x";
          // Anchor origin at lock point so the track begins moving from 0px with zero initial jump
          drag.lockOriginX = e.clientX;
          drag.lastX = e.clientX;
          drag.lastTime = performance.now();
          drag.velocityX = 0;
          window.getSelection?.()?.removeAllRanges?.();
          shellRef.current?.classList.add("is-swiping");
          shellRef.current?.setAttribute("data-swipe-target", plan);
          try {
            stageRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // Ignore if pointer capture is unavailable
          }
          return;
        } else {
          drag.axis = "y";
          drag.active = false;
          return;
        }
      }

      if (drag.axis !== "x") return;

      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime);
      const instantVel = (e.clientX - drag.lastX) / dt;
      drag.velocityX = drag.velocityX * 0.35 + instantVel * 0.65;
      drag.lastX = e.clientX;
      drag.lastTime = now;

      // Natural spatial scroll: drag right-to-left (effectiveDx < 0) pulls Recurring in (0 -> 1)
      const effectiveDx = e.clientX - drag.lockOriginX;
      const raw = drag.baseProgress - effectiveDx / drag.stageWidth;
      let progress = raw;
      if (raw < 0) {
        progress = Math.max(-0.12, raw * 0.2);
      } else if (raw > 1) {
        progress = Math.min(1.12, 1 + (raw - 1) * 0.2);
      }
      drag.progress = progress;

      if (!swipeRafRef.current) {
        swipeRafRef.current = window.requestAnimationFrame(() => {
          swipeRafRef.current = 0;
          if (swipeDragRef.current.active && swipeDragRef.current.axis === "x") {
            applyLiveSwipe(swipeDragRef.current.progress);
          }
        });
      }
    },
    [applyLiveSwipe, plan],
  );

  const handleStagePointerEnd = useCallback(
    (e) => {
      const drag = swipeDragRef.current;
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      const wasHorizontal = drag.axis === "x";
      const finalProgress = drag.progress;
      const isRecentMove = performance.now() - drag.lastTime < 90;
      const finalVelocityX = isRecentMove ? drag.velocityX : 0;
      const totalDx = drag.lastX - drag.lockOriginX;

      drag.active = false;
      drag.axis = null;
      drag.pointerId = null;

      if (swipeRafRef.current) {
        window.cancelAnimationFrame(swipeRafRef.current);
        swipeRafRef.current = 0;
      }

      if (!wasHorizontal) return;

      try {
        if (stageRef.current?.hasPointerCapture?.(e.pointerId)) {
          stageRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore pointer release errors
      }

      suppressStageClickUntilRef.current = performance.now() + 120;

      const isFastFlickLeft = finalVelocityX < -0.35 && totalDx < -20;
      const isFastFlickRight = finalVelocityX > 0.35 && totalDx > 20;
      let targetPlan = plan;
      if (plan === "budget") {
        if (finalProgress >= 0.3 || isFastFlickLeft) {
          targetPlan = "rec";
        }
      } else if (finalProgress <= 0.7 || isFastFlickRight) {
        targetPlan = "budget";
      }

      const targetVal = targetPlan === "rec" ? 1 : 0;
      const remaining = Math.abs(targetVal - finalProgress);
      const speedBoost = Math.min(1, Math.abs(finalVelocityX) / 1.4);
      const settleMs = Math.round(
        Math.max(170, Math.min(290, 175 + remaining * 115 - speedBoost * 55)),
      );

      const shellEl = shellRef.current;
      if (shellEl) {
        // Flush transition re-enable before updating --plans-swipe so Safari/Chrome never skips the settle animation
        shellEl.style.setProperty("--plans-settle-ms", `${settleMs}ms`);
        shellEl.classList.remove("is-swiping");
        shellEl.removeAttribute("data-swipe-target");
        void shellEl.offsetWidth;
        shellEl.style.setProperty("--plans-swipe", String(targetVal));
      }

      const targetScrollTop = plansScrollStore[targetPlan] || 0;
      tweenCollapseTo(computePlansCollapse(targetScrollTop));

      if (targetPlan !== plan) {
        selectPlanTab(targetPlan);
      }
    },
    [plan, selectPlanTab, tweenCollapseTo],
  );

  const handleStageClickCapture = useCallback((e) => {
    if (performance.now() < suppressStageClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const ringSummaryChipText =
    b > 0
      ? `${overBudget ? `${fmt(t - b)} over` : `${fmt(b - t)} left`} · ${pctUsed > 999 ? ">999%" : `${Math.round(pctUsed)}%`}`
      : "";
  const showRingChip = plan === "budget" && b > 0 && !ringVisible;

  return (
    <div
      ref={shellRef}
      className="plans-screen-shell"
      data-active-plan={plan}
    >
      <header
        ref={headerRef}
        className={`plans-shared-header${hasScrolled ? " is-scrolled" : ""}`}
      >
        <div
          className="plans-header-top-row"
          onClick={(e) => {
            if (e.target.closest("button, a, [role='tab']")) return;
            scrollActiveTabToTop();
          }}
        >
          <h1 className="plans-header-title">Plans</h1>

          <div
            className={`plans-header-chip-slot${showRingChip ? " is-visible" : ""}`}
            aria-hidden={!showRingChip}
          >
            {ringSummaryChipText && (
              <span
                className={`plans-header-ring-chip${overBudget ? " is-over" : pctUsed >= 85 ? " is-warn" : ""}`}
                title={ringSummaryChipText}
              >
                {ringSummaryChipText}
              </span>
            )}
          </div>

          <div
            className="plans-header-action-slot"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-plan-action="budget"
              className={`prototype-header-action plans-header-action-item${plan === "budget" ? " is-active" : ""}`}
              aria-label="Budget insights"
              title="Budget insights"
              tabIndex={plan === "budget" ? 0 : -1}
              aria-hidden={plan !== "budget"}
              onClick={() => {
                triggerHaptic("light");
                (onBudgetInsights || onBudget)?.();
              }}
            >
              <Icon n="insights" />
            </button>
            <button
              type="button"
              data-plan-action="rec"
              className={`rec-new-pill-btn plans-header-new-btn plans-header-action-item${plan === "rec" ? " is-active" : ""}`}
              aria-label="Add new recurring plan"
              tabIndex={plan === "rec" ? 0 : -1}
              aria-hidden={plan !== "rec"}
              onClick={() => {
                triggerHaptic("light");
                onAddRec?.();
              }}
            >
              + New
            </button>
          </div>
        </div>

        <div ref={segRowRef} className="plans-header-seg-row">
          <SegmentedControl
            className="plans-seg"
            role="tablist"
            ariaLabel="Plans views"
            value={plan}
            dataActive={plan}
            glass={true}
            onChange={(next) => selectPlanTab(next)}
            options={[
              {
                value: "budget",
                label: "Budget",
                id: "plans-tab-budget",
                ariaControls: "plans-panel-budget",
                ref: budgetTabBtnRef,
              },
              {
                value: "rec",
                label: "Recurring",
                id: "plans-tab-rec",
                ariaControls: "plans-panel-rec",
                ref: recTabBtnRef,
              },
            ]}
          />
        </div>
      </header>

      <div
        ref={stageRef}
        className="plans-panels-stage"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerEnd}
        onPointerCancel={handleStagePointerEnd}
        onClickCapture={handleStageClickCapture}
      >
        <div className="plans-panels-track">
        <div
          ref={budgetScrollerRef}
          id="plans-panel-budget"
          role="tabpanel"
          aria-labelledby="plans-tab-budget"
          aria-hidden={plan !== "budget"}
          inert={plan !== "budget" ? true : undefined}
          className={`plans-tab-scroller${plan === "budget" ? " is-active" : " is-inactive"}`}
        >
          <div className="plans-budget-scroll">
            <div className="plans-month-header">
              <h2 className="plans-month-title">
                {monthLabel} {yearLabel}
              </h2>
              <div className="plans-month-nav">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    triggerHaptic("selection");
                    onShift(-1);
                  }}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    if (isCurrentOrFutureMonth) return;
                    triggerHaptic("selection");
                    onShift(1);
                  }}
                  disabled={isCurrentOrFutureMonth}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            </div>

            <div key={S.m} className="plans-budget-month-stage">
              <section ref={ringCardRef} className="card plans-hero-card">
                <div className="plans-hero-top">
                  <span className="plans-hero-label">Monthly budget</span>
                  <div className="plans-hero-actions">
                    <button
                      type="button"
                      className="hero-chip-btn"
                      onClick={onBudget}
                    >
                      {b ? "Edit budget" : "Set budget"}
                    </button>
                  </div>
                </div>

                {b > 0 ? (
                  <>
                    <div className="plans-ring-wrap">
                      <svg
                        className="plans-ring-svg"
                        viewBox="0 0 180 180"
                        aria-hidden="true"
                      >
                        <circle
                          className="plans-ring-track"
                          cx="90"
                          cy="90"
                          r="84"
                          fill="none"
                          strokeWidth="12"
                        />
                        <circle
                          className="plans-ring-arc"
                          cx="90"
                          cy="90"
                          r="84"
                          fill="none"
                          stroke={ringStrokeColor}
                          strokeWidth="12"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 84}
                          strokeDashoffset={
                            2 * Math.PI * 84 * (1 - Math.min(1, spentPct / 100))
                          }
                        />
                      </svg>
                      <div className="plans-ring-center">
                        <div className="plans-ring-val-row">
                          <strong
                            className={`plans-ring-amount${
                              (overBudget ? fmt(t - b) : fmt(b - t)).length > 11
                                ? " is-ultra-compact"
                                : (overBudget ? fmt(t - b) : fmt(b - t))
                                      .length > 8
                                  ? " is-extra-compact"
                                  : (overBudget ? fmt(t - b) : fmt(b - t))
                                        .length > 6
                                    ? " is-compact"
                                    : ""
                            }`}
                          >
                            {overBudget ? fmt(t - b) : fmt(b - t)}
                          </strong>
                          <span className="plans-ring-unit">
                            {overBudget ? "over" : "left"}
                          </span>
                        </div>
                        <span className="plans-ring-sub">
                          {pctUsed > 999 ? ">999%" : `${Math.round(pctUsed)}%`}{" "}
                          used
                        </span>
                      </div>
                    </div>

                    <div className="plans-saved-style-rows">
                      <div className="plans-saved-row">
                        <span className="plans-saved-label">Spent</span>
                        <span className="plans-saved-val">{fmt(t)}</span>
                      </div>
                      <div className="plans-saved-row">
                        <span className="plans-saved-label">Limit</span>
                        <span className="plans-saved-val">{fmt(b)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="plans-no-budget">
                    <div className="emp-illustrated-icon" aria-hidden="true">
                      <AnimatedBudgetIcon />
                    </div>
                    <div className="plans-no-budget-copy">
                      <strong>No budget set for {monthLabel}</strong>
                      <span>
                        Set a monthly spending limit to track your pace.
                      </span>
                    </div>
                    {t > 0 && (
                      <div className="plans-no-budget-spent">
                        <span>Spent so far</span>
                        <b>{fmt(t)}</b>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {b > 0 && velocity && (
                <section className="card plans-pace-card">
                  <div className="plans-pace-header">
                    <div>
                      <h2 className="section-title">Budget pace</h2>
                      <p className="plans-pace-subtitle">
                        Actual vs. expected spend
                      </p>
                    </div>
                    <span className={`pace-pill is-${paceStatusTone}`}>
                      {velocity.isOverPace
                        ? "Over pace"
                        : velocity.isUnderPace
                          ? "✓ Under pace"
                          : "On pace"}
                    </span>
                  </div>

                  <div className="plans-pace-variance">
                    <strong className="plans-pace-hero-num">
                      {fmt(paceDiffAbs)}
                    </strong>
                    <span className="plans-pace-hero-label">
                      {velocity.paceDiff > 0
                        ? "ahead of expected spend"
                        : velocity.paceDiff < 0
                          ? "under expected spend by today"
                          : "right on expected pace"}
                    </span>
                  </div>

                  <div className="plans-pace-bar-block">
                    <div className="plans-pace-track">
                      <div
                        className={`plans-pace-fill is-${paceStatusTone}`}
                        style={{ width: `${spentPct}%` }}
                      />
                      <div
                        className="plans-pace-marker"
                        style={{ left: `${expectedPct}%` }}
                        title={`Expected by today: ${fmt(expectedByToday)}`}
                      />
                    </div>
                    <div className="plans-pace-captions">
                      <span>Spent {fmt(t)}</span>
                      <span>Expected by today · {fmt(expectedByToday)}</span>
                    </div>
                  </div>

                  <div className="plans-burn-grid">
                    <div className="plans-burn-tile">
                      <span className="plans-burn-label">
                        Actual daily burn
                      </span>
                      <strong className="plans-burn-val">
                        {fmt(Math.round(velocity.actualDailyBurn))}
                        <small>/day</small>
                      </strong>
                    </div>
                    <div className="plans-burn-tile">
                      <span className="plans-burn-label">
                        Target daily pace
                      </span>
                      <strong className="plans-burn-val">
                        {fmt(Math.round(velocity.targetDailyPace))}
                        <small>/day</small>
                      </strong>
                    </div>
                  </div>
                </section>
              )}
            </div>
            <div className="plans-scroll-spacer" aria-hidden="true" />
          </div>
        </div>

        <div
          ref={recScrollerRef}
          id="plans-panel-rec"
          role="tabpanel"
          aria-labelledby="plans-tab-rec"
          aria-hidden={plan !== "rec"}
          inert={plan !== "rec" ? true : undefined}
          className={`plans-tab-scroller${plan === "rec" ? " is-active" : " is-inactive"}`}
        >
          <RecurringPlansView
            schedules={S.rec || []}
            cards={S.cards || []}
            deletedCards={S.deletedCards || {}}
            onAdd={onAddRec}
            onOpen={onOpenRec}
            onToggle={onToggleRec}
          />
        </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── sheets ───────────── */
function AddSheet({
  iv,
  categoryOrder,
  expenses,
  cards = [],
  defaultAccount,
  preferredAccount,
  initialCategory = "",
  onAccountChange,
  onSave,
  onSaveTx,
  onClose,
  onLockedCardNotice,
}) {
  const nonSavingsCards = cards.filter(
    (c) =>
      c.id !== "cash" &&
      c.type !== "cash" &&
      c.category !== "cash" &&
      c.provider !== "cash" &&
      c.type !== "savings" &&
      c.category !== "savings" &&
      c.provider !== "savings",
  );
  const spendableCards = nonSavingsCards.filter((c) => !c.frozen);
  const primaryCard =
    spendableCards.find((c) => c.isPrimary) || spendableCards[0];
  const hasSavingsAccount = Boolean(getSavingsAccountId(cards));

  const hasCashInCards = cards.some(
    (c) =>
      c.id === "cash" ||
      c.provider === "cash" ||
      c.category === "cash" ||
      c.type === "cash",
  );
  const txAccountOptions = [
    ...cards.map((c) => [c.id, c.name]),
    ...(!hasCashInCards ? [["cash", "Cash"]] : []),
  ];
  const unfrozenTxFromOptions = [
    ...cards.filter((c) => !c.frozen).map((c) => [c.id, c.name]),
    ...(!hasCashInCards ? [["cash", "Cash"]] : []),
  ];

  const resolvedInitialAcct = useMemo(() => {
    // 1. Explicit defaultAccount passed to sheet (including empty string or "cash" for Cash)
    if (defaultAccount !== undefined && defaultAccount !== null) {
      if (defaultAccount === "" || defaultAccount === "cash") {
        return "";
      }
      if (spendableCards.some((c) => c.id === defaultAccount)) {
        return defaultAccount;
      }
    }
    // 2. User's remembered preferred / last-used account
    if (preferredAccount !== undefined && preferredAccount !== null) {
      if (preferredAccount === "" || preferredAccount === "cash") {
        return "";
      }
      if (spendableCards.some((c) => c.id === preferredAccount)) {
        return preferredAccount;
      }
    }
    // 3. Fallback to primary card if available, else Cash
    return primaryCard?.id || "";
  }, [defaultAccount, preferredAccount, spendableCards, primaryCard]);

  const resolvedTxFrom = (() => {
    const candidate = resolvedInitialAcct || "cash";
    if (txAccountOptions.some(([id]) => id === candidate)) return candidate;
    return unfrozenTxFromOptions[0]?.[0] || txAccountOptions[0]?.[0] || "";
  })();
  const resolvedTxTransferFrom = unfrozenTxFromOptions.some(
    ([id]) => id === resolvedTxFrom,
  )
    ? resolvedTxFrom
    : unfrozenTxFromOptions[0]?.[0] || resolvedTxFrom;
  const resolvedTxTo =
    txAccountOptions.find(([id]) => id !== resolvedTxTransferFrom)?.[0] ||
    txAccountOptions[1]?.[0] ||
    "";

  const [mode, setMode] = useState("expense"); // "expense" | "income" | "transfer"
  const [f, setF] = useState({
    amt: "",
    desc: "",
    cat: initialCategory || "",
    date: ld(),
    acct:
      initialCategory === "Savings" && hasSavingsAccount
        ? primaryCard?.id || spendableCards[0]?.id || ""
        : resolvedInitialAcct,
    iv: iv || "none",
  });
  const [tx, setTx] = useState({
    acct: resolvedTxFrom,
    fromAccount: resolvedTxTransferFrom,
    toAccount: resolvedTxTo,
    note: "",
  });
  const [amtError, setAmtError] = useState("");
  const [amtTouched, setAmtTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const prevNonSavingsAcctRef = useRef(resolvedInitialAcct);
  const amtInputRef = useRef(null);
  const descInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setTxField = (k, v) => setTx((x) => ({ ...x, [k]: v }));
  const custom = f.date !== ld() && f.date !== ago(1);
  const categorySuggestion = suggestedCategory(f.desc, expenses);

  const isTxMode = mode === "income" || mode === "transfer";
  const isTransfer = mode === "transfer";
  const hasUnfrozenTxCard = unfrozenTxFromOptions.length > 0;
  const fromCardIsFrozen = cards.find((c) => c.id === tx.fromAccount)?.frozen;
  const toCardIsFrozen = cards.find((c) => c.id === tx.toAccount)?.frozen;
  const canSwapTx =
    txAccountOptions.length >= 2 &&
    Boolean(tx.fromAccount) &&
    Boolean(tx.toAccount) &&
    tx.fromAccount !== tx.toAccount &&
    (!hasUnfrozenTxCard || !toCardIsFrozen);
  const txAmtNum = parseAmount(f.amt);
  const hasValidTxAmt = Number.isFinite(txAmtNum) && txAmtNum > 0;
  const canSaveTx =
    hasValidTxAmt &&
    txAccountOptions.length > 0 &&
    (!isTransfer ||
      (txAccountOptions.length >= 2 &&
        tx.fromAccount !== tx.toAccount &&
        !fromCardIsFrozen));
  const isTransferDisabledForCardCount =
    isTransfer && txAccountOptions.length < 2;

  const handleSave = () => {
    setSubmitAttempted(true);
    const resolvedCat = f.cat || categorySuggestion || "Other";
    const rawAmtStr = String(f.amt ?? "").trim();
    const parsedAmt = parseAmount(f.amt);

    if (
      rawAmtStr !== "" &&
      (parsedAmt === null || !Number.isFinite(parsedAmt) || parsedAmt <= 0)
    ) {
      setAmtError("Enter an amount greater than ৳0, or leave blank.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (
      (resolvedCat === "Savings" || f.iv !== "none") &&
      (parsedAmt === null || !Number.isFinite(parsedAmt) || parsedAmt <= 0)
    ) {
      setAmtError(
        resolvedCat === "Savings"
          ? "Recurring savings need an amount."
          : "Recurring expenses need an amount.",
      );
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }

    setAmtError("");
    onSave({ ...f, cat: resolvedCat });
  };

  const handleSaveTx = () => {
    if (!hasValidTxAmt) {
      setAmtError("Enter an amount greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (txAccountOptions.length === 0) {
      setAmtError("Add a card or wallet in Accounts first.");
      triggerHaptic("warning");
      return;
    }
    if (isTransfer && txAccountOptions.length < 2) {
      setAmtError("Add at least two cards or wallets to transfer.");
      triggerHaptic("warning");
      return;
    }
    if (isTransfer && fromCardIsFrozen) {
      setAmtError("Source card is locked. Choose an unlocked account.");
      triggerHaptic("warning");
      return;
    }
    if (isTransfer && tx.fromAccount === tx.toAccount) {
      setAmtError("Select two different accounts for a transfer.");
      triggerHaptic("warning");
      return;
    }
    if (!canSaveTx) {
      setAmtError("Enter a valid amount greater than ৳0.");
      triggerHaptic("warning");
      return;
    }
    setAmtError("");
    triggerHaptic("selection");
    onSaveTx?.({
      type: mode,
      amt: f.amt,
      acct: tx.acct,
      dir: "up",
      note: tx.note,
      date: f.date,
      fromAccount: tx.fromAccount,
      toAccount: tx.toAccount,
    });
  };

  const handleSwapTransferAccounts = () => {
    if (!canSwapTx) {
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    setTx((current) => ({
      ...current,
      fromAccount: current.toAccount,
      toAccount: current.fromAccount,
    }));
  };

  const handleModePick = (nextMode) => {
    setAmtError("");
    if (nextMode === "transfer" && !hasUnfrozenTxCard) {
      const lockedCard =
        cards.find((c) => c.id === (f.acct || defaultAccount)) || cards[0];
      triggerHaptic("warning");
      onLockedCardNotice?.(lockedCard?.name);
      return;
    }
    if (nextMode === "transfer") {
      setTx((current) => {
        const candidateFrom = current.fromAccount || current.acct;
        const isCandidateFrozen = Boolean(
          cards.find((c) => c.id === candidateFrom)?.frozen,
        );
        const nextFrom =
          !isCandidateFrozen && candidateFrom
            ? candidateFrom
            : unfrozenTxFromOptions[0]?.[0] || candidateFrom;
        const nextTo =
          current.toAccount && current.toAccount !== nextFrom
            ? current.toAccount
            : txAccountOptions.find(([id]) => id !== nextFrom)?.[0] || "";
        return {
          ...current,
          fromAccount: nextFrom,
          toAccount: nextTo,
        };
      });
    }
    setMode(nextMode);
  };

  return (
    <Sheet
      onClose={onClose}
      actions={
        isTxMode ? (
          <button
            type="button"
            className="btn"
            disabled={isTransferDisabledForCardCount}
            aria-disabled={!canSaveTx || isTransferDisabledForCardCount}
            style={
              isTransferDisabledForCardCount || !canSaveTx
                ? {
                    opacity: 0.45,
                    pointerEvents: isTransferDisabledForCardCount
                      ? "none"
                      : undefined,
                  }
                : undefined
            }
            onClick={handleSaveTx}
          >
            {isTransfer ? "Save transfer" : "Add income"}
          </button>
        ) : (
          <button
            type="button"
            aria-pressed={false}
            className="btn"
            onClick={() => {
              triggerHaptic("selection");
              handleSave();
            }}
          >
            {f.cat === "Savings" && hasSavingsAccount
              ? f.iv === "none"
                ? "Save to Savings"
                : "Schedule savings transfer"
              : f.iv === "none"
                ? "Add expense"
                : "Schedule expense"}
          </button>
        )
      }
    >
      <h3 id="sheet-title">
        {mode === "income"
          ? "New income"
          : mode === "transfer"
            ? "New transfer"
            : f.cat === "Savings" && hasSavingsAccount
              ? "Savings transfer"
              : "New expense"}
      </h3>
      {(!iv || iv === "none") && onSaveTx && (
        <Seg
          className="sheet-mode-seg"
          value={mode}
          onPick={handleModePick}
          options={[
            ["expense", "Expense"],
            [
              "income",
              <span className="seg-item-with-icon" key="income">
                <TransactionSymbol type="income" />
                <span>Income</span>
              </span>,
            ],
            [
              "transfer",
              <span className="seg-item-with-icon" key="transfer">
                <TransactionSymbol type="transfer" />
                <span>Transfer</span>
              </span>,
            ],
          ]}
        />
      )}
      <HeroAmountField
        value={f.amt}
        onChange={(val) => {
          setAmtTouched(true);
          set("amt", val);
          if (amtError) setAmtError("");
        }}
        onBlur={() => setAmtTouched(true)}
        inputRef={amtInputRef}
        placeholder="0"
        enterKeyHint="done"
        ariaLabel={
          mode === "income"
            ? "Income amount in taka"
            : mode === "transfer"
              ? "Transfer amount in taka"
              : f.cat === "Savings"
                ? "Savings transfer amount"
                : "Expense amount"
        }
        hasError={
          Boolean(amtError) ||
          (!isTxMode &&
            (amtTouched || submitAttempted) &&
            f.iv !== "none" &&
            !parseAmount(f.amt))
        }
        errorMessage={
          amtError ||
          (!isTxMode &&
          (amtTouched || submitAttempted) &&
          f.iv !== "none" &&
          !parseAmount(f.amt)
            ? f.cat === "Savings"
              ? "Recurring savings need an amount."
              : "Recurring expenses need an amount."
            : "")
        }
        onEnter={() =>
          isTxMode
            ? noteInputRef.current?.focus()
            : descInputRef.current?.focus()
        }
      />
      {isTxMode ? (
        <>
          {isTransfer && txAccountOptions.length < 2 && (
            <p className="hint">
              Add at least two cards or wallets to transfer between accounts.
            </p>
          )}

          {isTransfer && txAccountOptions.length >= 2 && (
            <>
              <span className="lbl">From</span>
              <TxAccountCardGrid
                value={tx.fromAccount}
                options={txAccountOptions}
                cards={cards}
                lockFrozen={hasUnfrozenTxCard}
                ariaLabel="Transfer from account"
                onPick={(value) => {
                  setTx((current) => ({
                    ...current,
                    fromAccount: value,
                    toAccount:
                      current.toAccount === value
                        ? current.fromAccount && current.fromAccount !== value
                          ? current.fromAccount
                          : txAccountOptions.find(([id]) => id !== value)?.[0] ||
                            ""
                        : current.toAccount,
                  }));
                }}
              />

              <div className="tx-transfer-to-header">
                <span className="lbl">To</span>
                <button
                  type="button"
                  className="tx-transfer-swap-btn"
                  disabled={!canSwapTx}
                  onClick={handleSwapTransferAccounts}
                  aria-label="Swap From and To accounts"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 4v16m0 0-4-4m4 4 4-4" />
                    <path d="M17 20V4m0 0-4 4m4-4 4 4" />
                  </svg>
                  <span>Swap</span>
                </button>
              </div>

              <TxAccountCardGrid
                value={tx.toAccount}
                options={txAccountOptions}
                cards={cards}
                disabledAccountId={tx.fromAccount}
                disabledReason="Sending from here"
                ariaLabel="Transfer to account"
                onPick={(value) => setTxField("toAccount", value)}
              />
            </>
          )}

          {!isTransfer && (
            <>
              <span className="lbl">Account</span>
              <TxAccountCardGrid
                value={tx.acct}
                options={txAccountOptions}
                cards={cards}
                ariaLabel="Select account"
                onPick={(v) => setTxField("acct", v)}
              />
            </>
          )}

          <span className="lbl">Date</span>
          <div className="seg">
            <button
              type="button"
              aria-pressed={f.date === ld()}
              className={f.date === ld() ? "on" : ""}
              onClick={() => {
                triggerHaptic("selection");
                set("date", ld());
              }}
            >
              Today
            </button>
            <button
              type="button"
              aria-pressed={f.date === ago(1)}
              className={f.date === ago(1) ? "on" : ""}
              onClick={() => {
                triggerHaptic("selection");
                set("date", ago(1));
              }}
            >
              Yesterday
            </button>
            <input
              name="transactionDate"
              type="date"
              className={custom ? "on" : ""}
              aria-label="Transaction date"
              value={f.date}
              onChange={(e) => {
                if (e.target.value) set("date", e.target.value);
              }}
            />
          </div>

          <span className="lbl">Note (optional)</span>
          <input
            name="transactionNote"
            ref={noteInputRef}
            className="in"
            maxLength={80}
            aria-label="Transaction note"
            autoCapitalize="sentences"
            enterKeyHint="done"
            placeholder={
              mode === "income" ? "e.g. Salary, cash in" : "Optional note"
            }
            value={tx.note}
            onChange={(e) => setTxField("note", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
                if (canSaveTx) handleSaveTx();
              }
            }}
          />
        </>
      ) : (
        <>
      {(f.iv === "none" ||
        ((amtTouched || submitAttempted) &&
          !amtError &&
          !parseAmount(f.amt))) && (
        <p className="hint">
          {f.cat === "Savings" && f.iv === "none"
            ? "Enter an amount to record a savings transfer."
            : f.iv === "none"
              ? "Leave the amount blank to fill it in later."
              : f.cat === "Savings"
                ? "Recurring savings need an amount."
                : "Recurring expenses need an amount."}
        </p>
      )}

      <span className="lbl">What was it for?</span>
      <input
        name="expenseDescription"
        ref={descInputRef}
        className="in"
        maxLength={80}
        aria-label="Expense description"
        enterKeyHint="done"
        placeholder={
          f.cat === "Savings" && hasSavingsAccount
            ? "e.g. Monthly savings"
            : "e.g. Lunch"
        }
        value={f.desc}
        onChange={(event) => {
          const description = event.target.value;
          set("desc", description);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            handleSave();
          }
        }}
      />

      <div className="category-header-row">
        <span className="lbl">Category</span>
        {categorySuggestion && categorySuggestion !== f.cat && (
          <button
            type="button"
            className="category-suggestion-action is-inline-hint"
            style={{
              "--c":
                getCategoryColor(categorySuggestion, f.desc) ||
                CAT[categorySuggestion]?.[1] ||
                "#64748b",
            }}
            aria-label={`Use suggestion: ${categorySuggestion}`}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => {
                let nextAcct = current.acct;
                if (categorySuggestion === "Savings" && hasSavingsAccount) {
                  if (
                    !current.acct ||
                    (spendableCards.length > 0 &&
                      !spendableCards.some((sc) => sc.id === current.acct))
                  ) {
                    nextAcct = primaryCard?.id || spendableCards[0]?.id || "";
                  }
                } else if (
                  current.cat === "Savings" &&
                  categorySuggestion !== "Savings"
                ) {
                  nextAcct = prevNonSavingsAcctRef.current;
                }
                return {
                  ...current,
                  cat: categorySuggestion,
                  acct: nextAcct,
                };
              });
            }}
          >
            <UtilitySymbol name="suggestion" />
            <span className="category-suggestion-label">Suggested</span>
            <CategorySuggestionValue
              category={categorySuggestion}
              description={f.desc}
            />
          </button>
        )}
      </div>
      <div className="cg">
        {categoryOrder.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={f.cat === c}
            className={f.cat === c ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => {
                let nextAcct = current.acct;
                if (c === "Savings" && hasSavingsAccount) {
                  if (
                    !current.acct ||
                    (spendableCards.length > 0 &&
                      !spendableCards.some((sc) => sc.id === current.acct))
                  ) {
                    nextAcct = primaryCard?.id || spendableCards[0]?.id || "";
                  }
                } else if (current.cat === "Savings" && c !== "Savings") {
                  nextAcct = prevNonSavingsAcctRef.current;
                }
                return {
                  ...current,
                  cat: c,
                  acct: nextAcct,
                };
              });
            }}
          >
            <CategorySymbol
              category={c}
              description={c === "Entertainment" ? f.desc : ""}
            />
            <span>{c}</span>
          </button>
        ))}
      </div>
      {f.cat === "Savings" && hasSavingsAccount && (
        <p className="hint savings-transfer-note">
          Moves money from the selected account into Savings. It is not counted
          as spending or against your budget.
        </p>
      )}

      <span className="lbl">Date</span>
      <div className="seg">
        <button
          type="button"
          aria-pressed={f.date === ld()}
          className={f.date === ld() ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ld());
          }}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={f.date === ago(1)}
          className={f.date === ago(1) ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ago(1));
          }}
        >
          Yesterday
        </button>
        <input
          name="expenseDate"
          type="date"
          className={custom ? "on" : ""}
          aria-label="Expense date"
          value={f.date}
          onChange={(e) => {
            if (e.target.value) set("date", e.target.value);
          }}
        />
      </div>

      <span className="lbl">
        {f.cat === "Savings" && hasSavingsAccount
          ? "Transfer from"
          : "Paid from"}
      </span>
      <TxAccountCardGrid
        value={f.acct}
        lockFrozen={true}
        ariaLabel={
          f.cat === "Savings" && hasSavingsAccount
            ? "Transfer from account"
            : "Paid from account"
        }
        onPick={(v) => {
          set("acct", v);
          if (f.cat !== "Savings") {
            prevNonSavingsAcctRef.current = v;
            onAccountChange?.(v);
          }
        }}
        cards={cards}
        options={
          f.cat === "Savings" && hasSavingsAccount && spendableCards.length > 0
            ? nonSavingsCards.map((c) => [c.id, c.name])
            : [["", "Cash"], ...nonSavingsCards.map((c) => [c.id, c.name])]
        }
      />

      <span className="lbl">Repeat</span>
      <Seg
        value={f.iv}
        onPick={(v) => set("iv", v)}
        options={[
          ["none", "Once"],
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
        ]}
      />
        </>
      )}
    </Sheet>
  );
}

function getCardMaskedSubtitle(card) {
  if (!card) return "•••• 0000";
  if (
    card.id === "cash" ||
    card.type === "cash" ||
    card.category === "cash" ||
    card.provider === "cash"
  ) {
    const code = getCashCurrencyMeta(card.currency).code;
    return `Cash wallet · ${code}`;
  }
  const prov = CARD_PROVIDERS.find((p) => p.id === (card.provider || card.id));
  const raw =
    card.last4 ||
    card.number ||
    prov?.numberPlaceholder ||
    prov?.numberPrefix ||
    "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 4) {
    return { dots: "••••", tail: digits.slice(-4) };
  }
  if (
    card.type === "savings" ||
    card.category === "savings" ||
    card.provider === "savings"
  ) {
    return { dots: "••••", tail: digits || "4710" };
  }
  return { dots: "••••", tail: (digits || "4821").padStart(4, "0") };
}

function TxAccountCardGrid({
  value,
  options = [],
  cards = [],
  onPick,
  disabledAccountId = "",
  disabledReason = "Sending from here",
  lockFrozen = false,
  ariaLabel = "Select account",
}) {
  const normalizedValue = value === "" ? "cash" : (value ?? "");

  return (
    <div className="tx-account-grid" role="radiogroup" aria-label={ariaLabel}>
      {options.map(([id, label]) => {
        const normId = id === "" ? "cash" : id;
        const card =
          cards.find((c) => c.id === normId) ||
          (normId === "cash"
            ? { id: "cash", name: label || "Cash", type: "cash" }
            : { id: normId, name: label || "Account" });
        const prov = CARD_PROVIDERS.find(
          (p) => p.id === (card?.provider || card?.id),
        );
        const displayName =
          String(card?.name || label || "").trim() ||
          prov?.name ||
          (normId === "cash"
            ? "Cash"
            : card?.type === "savings" ||
                card?.category === "savings" ||
                card?.provider === "savings"
              ? "Savings"
              : card?.network === "visa"
                ? "Visa Card"
                : card?.network === "mastercard"
                  ? "Mastercard"
                  : card?.network === "amex"
                    ? "Amex Card"
                    : "Card");
        const isSendingFromHere =
          Boolean(disabledAccountId) && normId === disabledAccountId;
        const isFrozenBlocked =
          Boolean(lockFrozen) && Boolean(card?.frozen) && !isSendingFromHere;
        const isDisabled = isSendingFromHere || isFrozenBlocked;
        const isSelected = !isDisabled && normalizedValue === normId;
        const isPrimary = Boolean(card?.isPrimary);
        const maskedSub = getCardMaskedSubtitle(card);

        return (
          <button
            key={normId}
            type="button"
            disabled={isDisabled}
            aria-disabled={isDisabled}
            role="radio"
            aria-checked={isSelected}
            className={`tx-account-card${isSelected ? " is-selected" : ""}${isSendingFromHere ? " is-sending-source" : ""}${isFrozenBlocked ? " is-frozen-disabled" : ""}`}
            onClick={() => {
              if (isDisabled) return;
              triggerHaptic("selection");
              onPick(id);
            }}
          >
            <div className="tx-account-card-top">
              <MiniCardPreview card={card} className="tx-account-mini-card" />
              <div className="tx-account-card-badges">
                {isPrimary && (
                  <span
                    className="tx-account-star"
                    title="Primary card"
                    aria-label="Primary card"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                      aria-hidden="true"
                    >
                      <path d="M12 2.4l2.93 5.94 6.56.95-4.75 4.63 1.12 6.53L12 17.37l-5.86 3.08 1.12-6.53-4.75-4.63 6.56-.95L12 2.4z" />
                    </svg>
                  </span>
                )}
                {card?.frozen && !isSendingFromHere && (
                  <span
                    className="tx-account-lock-badge"
                    title="Card is locked"
                    aria-label="Locked"
                  >
                    🔒
                  </span>
                )}
                {isSelected && (
                  <span className="tx-account-check" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
            </div>

            <div className="tx-account-card-body">
              <b className="tx-account-card-name">{displayName}</b>
              <span className="tx-account-card-sub">
                {isSendingFromHere ? (
                  disabledReason
                ) : isFrozenBlocked ? (
                  "Card is locked"
                ) : typeof maskedSub === "string" ? (
                  maskedSub
                ) : (
                  <>
                    <span className="tx-account-dots" aria-hidden="true">
                      {maskedSub.dots}
                    </span>{" "}
                    <span className="tx-account-last4">{maskedSub.tail}</span>
                  </>
                )}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TxSheet({
  type,
  defaultAccount,
  cards = [],
  onSave,
  onClose,
  onLockedCardNotice,
}) {
  const hasCashInCards = cards.some(
    (c) =>
      c.id === "cash" ||
      c.provider === "cash" ||
      c.category === "cash" ||
      c.type === "cash",
  );
  const accountOptions = [
    ...cards.map((c) => [c.id, c.name]),
    ...(!hasCashInCards ? [["cash", "Cash"]] : []),
  ];
  const unfrozenFromOptions = [
    ...cards.filter((c) => !c.frozen).map((c) => [c.id, c.name]),
    ...(!hasCashInCards ? [["cash", "Cash"]] : []),
  ];
  const defaultFrom =
    defaultAccount && accountOptions.some(([id]) => id === defaultAccount)
      ? defaultAccount
      : unfrozenFromOptions[0]?.[0] || accountOptions[0]?.[0] || "";
  const defaultTransferFrom =
    defaultAccount && unfrozenFromOptions.some(([id]) => id === defaultAccount)
      ? defaultAccount
      : unfrozenFromOptions[0]?.[0] || defaultFrom;
  const defaultTo =
    accountOptions.find(([id]) => id !== defaultTransferFrom)?.[0] ||
    accountOptions[1]?.[0] ||
    "";

  const [g, setG] = useState({
    type,
    amt: "",
    acct: defaultFrom,
    dir: "up",
    note: "",
    date: ld(),
    fromAccount: defaultTransferFrom,
    toAccount: defaultTo,
  });
  const [amtError, setAmtError] = useState("");
  const amtInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const reasonSelectRef = useRef(null);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const tr = g.type === "transfer";
  const customDate = g.date !== ld() && g.date !== ago(1);
  const hasUnfrozenCard = unfrozenFromOptions.length > 0;
  const fromCardIsFrozen = cards.find((c) => c.id === g.fromAccount)?.frozen;
  const toCardIsFrozen = cards.find((c) => c.id === g.toAccount)?.frozen;
  const canSwap =
    accountOptions.length >= 2 &&
    Boolean(g.fromAccount) &&
    Boolean(g.toAccount) &&
    g.fromAccount !== g.toAccount &&
    (!hasUnfrozenCard || !toCardIsFrozen);
  const amtNum = parseAmount(g.amt);
  const hasValidAmt = Number.isFinite(amtNum) && amtNum > 0;
  const canSave =
    hasValidAmt &&
    accountOptions.length > 0 &&
    (!tr ||
      (accountOptions.length >= 2 &&
        g.fromAccount !== g.toAccount &&
        !fromCardIsFrozen));

  const handleSaveTx = () => {
    if (!hasValidAmt) {
      setAmtError("Enter an amount greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (accountOptions.length === 0) {
      setAmtError("Add a card or wallet in Accounts first.");
      triggerHaptic("warning");
      return;
    }
    if (tr && accountOptions.length < 2) {
      setAmtError("Add at least two cards or wallets to transfer.");
      triggerHaptic("warning");
      return;
    }
    if (tr && fromCardIsFrozen) {
      setAmtError("Source card is locked. Choose an unlocked account.");
      triggerHaptic("warning");
      return;
    }
    if (tr && g.fromAccount === g.toAccount) {
      setAmtError("Select two different accounts for a transfer.");
      triggerHaptic("warning");
      return;
    }
    if (!canSave) {
      setAmtError("Enter a valid amount greater than ৳0.");
      triggerHaptic("warning");
      return;
    }
    setAmtError("");
    triggerHaptic("selection");
    onSave(g);
  };

  const handleSwapTransferAccounts = () => {
    if (!canSwap) {
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    setG((current) => ({
      ...current,
      fromAccount: current.toAccount,
      toAccount: current.fromAccount,
    }));
  };

  const isTransferDisabledForCardCount = tr && accountOptions.length < 2;

  return (
    <Sheet
      onClose={onClose}
      actions={
        <button
          type="button"
          className="btn"
          disabled={isTransferDisabledForCardCount}
          aria-disabled={!canSave || isTransferDisabledForCardCount}
          style={
            isTransferDisabledForCardCount || !canSave
              ? {
                  opacity: 0.45,
                  pointerEvents: isTransferDisabledForCardCount
                    ? "none"
                    : undefined,
                }
              : undefined
          }
          onClick={handleSaveTx}
        >
          Save
        </button>
      }
    >
      <h3 id="sheet-title">Account activity</h3>
      <Seg
        className="sheet-mode-seg"
        value={g.type}
        onPick={(v) => {
          setAmtError("");
          if (v === "transfer" && !hasUnfrozenCard) {
            const lockedCard =
              cards.find((c) => c.id === defaultAccount) || cards[0];
            triggerHaptic("warning");
            onLockedCardNotice?.(lockedCard?.name);
            return;
          }
          setG((current) => {
            if (v !== "transfer") {
              return { ...current, type: v, note: "" };
            }
            const candidateFrom = current.fromAccount || current.acct;
            const isCandidateFrozen = Boolean(
              cards.find((c) => c.id === candidateFrom)?.frozen,
            );
            const resolvedFrom =
              !isCandidateFrozen && candidateFrom
                ? candidateFrom
                : unfrozenFromOptions[0]?.[0] || candidateFrom;
            const resolvedTo =
              current.toAccount && current.toAccount !== resolvedFrom
                ? current.toAccount
                : cards.find((c) => c.id !== resolvedFrom)?.id || "";
            return {
              ...current,
              type: v,
              note: "",
              fromAccount: resolvedFrom,
              toAccount: resolvedTo,
            };
          });
          setTimeout(() => {
            amtInputRef.current?.focus({ preventScroll: true });
          }, 0);
        }}
        options={[
          [
            "income",
            <span className="seg-item-with-icon" key="income">
              <TransactionSymbol type="income" />
              <span>Income</span>
            </span>,
          ],
          [
            "transfer",
            <span className="seg-item-with-icon" key="transfer">
              <TransactionSymbol type="transfer" />
              <span>Transfer</span>
            </span>,
          ],
          [
            "adjust",
            <span className="seg-item-with-icon" key="adjust">
              <TransactionSymbol type="adjust" />
              <span>Adjust</span>
            </span>,
          ],
        ]}
      />
      <HeroAmountField
        value={g.amt}
        onChange={(val) => {
          set("amt", val);
          if (amtError) setAmtError("");
        }}
        inputRef={amtInputRef}
        placeholder="0"
        enterKeyHint="done"
        ariaLabel={`${g.type === "adjust" ? "Adjustment" : g.type === "transfer" ? "Transfer" : "Income"} amount in taka`}
        hasError={Boolean(amtError)}
        errorMessage={amtError}
        onEnter={() => {
          if (g.type === "adjust") {
            reasonSelectRef.current?.focus();
          } else {
            noteInputRef.current?.focus();
          }
        }}
      />

      {tr && accountOptions.length < 2 && (
        <p className="hint">
          Add at least two cards or wallets to transfer between accounts.
        </p>
      )}

      {tr && accountOptions.length >= 2 && (
        <>
          <span className="lbl">From</span>
          <TxAccountCardGrid
            value={g.fromAccount}
            options={accountOptions}
            cards={cards}
            lockFrozen={hasUnfrozenCard}
            ariaLabel="Transfer from account"
            onPick={(value) => {
              setG((current) => ({
                ...current,
                fromAccount: value,
                toAccount:
                  current.toAccount === value
                    ? current.fromAccount && current.fromAccount !== value
                      ? current.fromAccount
                      : accountOptions.find(([id]) => id !== value)?.[0] || ""
                    : current.toAccount,
              }));
            }}
          />

          <div className="tx-transfer-to-header">
            <span className="lbl">To</span>
            <button
              type="button"
              className="tx-transfer-swap-btn"
              disabled={!canSwap}
              onClick={handleSwapTransferAccounts}
              aria-label="Swap From and To accounts"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 4v16m0 0-4-4m4 4 4-4" />
                <path d="M17 20V4m0 0-4 4m4-4 4 4" />
              </svg>
              <span>Swap</span>
            </button>
          </div>

          <TxAccountCardGrid
            value={g.toAccount}
            options={accountOptions}
            cards={cards}
            disabledAccountId={g.fromAccount}
            disabledReason="Sending from here"
            ariaLabel="Transfer to account"
            onPick={(value) => set("toAccount", value)}
          />
        </>
      )}

      {!tr && (
        <>
          <span className="lbl">Account</span>
          <TxAccountCardGrid
            value={g.acct}
            options={accountOptions}
            cards={cards}
            ariaLabel="Select account"
            onPick={(v) => set("acct", v)}
          />
        </>
      )}

      {g.type === "adjust" && (
        <>
          <span className="lbl">Direction</span>
          <Seg
            value={g.dir}
            onPick={(v) => set("dir", v)}
            options={[
              ["up", "Increase"],
              ["down", "Decrease"],
            ]}
          />
        </>
      )}

      <span className="lbl">Date</span>
      <div className="seg">
        <button
          type="button"
          aria-pressed={g.date === ld()}
          className={g.date === ld() ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ld());
          }}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={g.date === ago(1)}
          className={g.date === ago(1) ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ago(1));
          }}
        >
          Yesterday
        </button>
        <input
          name="txDate"
          type="date"
          className={customDate ? "on" : ""}
          aria-label="Transaction date"
          value={g.date}
          onChange={(e) => {
            if (e.target.value) set("date", e.target.value);
          }}
        />
      </div>

      {g.type === "adjust" ? (
        <>
          <span className="lbl">Reason (optional)</span>
          <select
            name="adjustmentReason"
            ref={reasonSelectRef}
            className="in"
            aria-label="Adjustment reason (optional)"
            value={g.note}
            onChange={(event) => set("note", event.target.value)}
          >
            <option value="">No reason</option>
            <option value="Fee">Fee</option>
            <option value="Cash withdrawn">Cash withdrawn</option>
            <option value="Correction">Correction</option>
          </select>
        </>
      ) : (
        <>
          <span className="lbl">Note (optional)</span>
          <input
            name="txNote"
            ref={noteInputRef}
            className="in"
            maxLength={80}
            aria-label="Transaction note"
            autoCapitalize="sentences"
            enterKeyHint="done"
            placeholder={
              g.type === "income" ? "e.g. Salary, cash in" : "Optional note"
            }
            value={g.note}
            onChange={(e) => set("note", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
                if (canSave) onSave(g);
              }
            }}
          />
        </>
      )}
    </Sheet>
  );
}

function AccountTxDetailSheet({
  tx,
  cards = [],
  deletedCards = null,
  onSave,
  onDelete,
  onClose,
}) {
  const hasCashInCards = cards.some(
    (c) =>
      c.id === "cash" ||
      c.provider === "cash" ||
      c.category === "cash" ||
      c.type === "cash",
  );
  const cardOptions = [
    ...cards.map((c) => [c.id, c.name]),
    ...(!hasCashInCards ? [["cash", "Cash"]] : []),
  ];
  const ensureAccountOption = (...ids) => {
    const list = [...cardOptions];
    for (const rawId of ids) {
      if (!rawId) continue;
      if (!list.some(([optId]) => optId === rawId)) {
        list.push([rawId, getAccountDisplay(rawId, cards, deletedCards)[0]]);
      }
    }
    return list;
  };
  const fallbackFrom = tx.acct || cardOptions[0]?.[0] || "";
  const [g, setG] = useState({
    type: tx.type === "adjustment" ? "adjust" : tx.type || "income",
    amt: tx.amt ?? "",
    acct: fallbackFrom,
    dir: tx.dir || (tx.direction === "decrease" ? "down" : "up"),
    note: tx.note || "",
    date: tx.date || ld(),
    fromAccount: fallbackFrom,
    toAccount: tx.to
      ? tx.to
      : cards.find((c) => c.id !== fallbackFrom)?.id || "",
  });
  const [amtError, setAmtError] = useState("");
  const amtInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const reasonSelectRef = useRef(null);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const tr = g.type === "transfer";
  const customDate = g.date !== ld() && g.date !== ago(1);
  const allTransferOptions = ensureAccountOption(g.fromAccount, g.toAccount);
  const normFrom = !g.fromAccount
    ? allTransferOptions[0]?.[0] || ""
    : g.fromAccount;
  const allToOptions = allTransferOptions.filter(([id]) => id !== normFrom);
  const singleAccountOptions = ensureAccountOption(g.acct);
  const normTo = !g.toAccount ? allToOptions[0]?.[0] || "" : g.toAccount;
  const amtNum = parseAmount(g.amt);
  const hasValidAmt = Number.isFinite(amtNum) && amtNum > 0;
  const fromCardIsFrozen = Boolean(
    cards.find((c) => c.id === normFrom)?.frozen,
  );
  const toCardIsFrozen = Boolean(cards.find((c) => c.id === normTo)?.frozen);
  const canSwap =
    allTransferOptions.length >= 2 &&
    Boolean(normFrom) &&
    Boolean(normTo) &&
    normFrom !== normTo &&
    !toCardIsFrozen;
  const canSave =
    hasValidAmt &&
    (tr
      ? allTransferOptions.length >= 1 &&
        allToOptions.length >= 1 &&
        Boolean(normFrom) &&
        Boolean(normTo) &&
        normFrom !== normTo &&
        !fromCardIsFrozen
      : singleAccountOptions.length > 0 && Boolean(g.acct));

  const handleSaveAccountTx = () => {
    if (!hasValidAmt) {
      setAmtError("Enter an amount greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (tr && fromCardIsFrozen) {
      setAmtError("Source card is locked. Choose an unlocked account.");
      triggerHaptic("warning");
      return;
    }
    if (tr && (!normFrom || !normTo || normFrom === normTo)) {
      setAmtError("Select two different accounts for a transfer.");
      triggerHaptic("warning");
      return;
    }
    if (!canSave) {
      setAmtError("Select a valid account and amount greater than ৳0.");
      triggerHaptic("warning");
      return;
    }
    setAmtError("");
    triggerHaptic("selection");
    onSave(tx.id, {
      ...g,
      fromAccount: tr ? normFrom : g.fromAccount,
      toAccount: tr ? normTo : g.toAccount,
    });
  };

  const handleSwapTransferAccounts = () => {
    if (!canSwap) {
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    setG((current) => ({
      ...current,
      fromAccount: normTo,
      acct: normTo,
      toAccount: normFrom,
    }));
  };

  const isTransferDisabledForCardCount =
    tr && (allTransferOptions.length < 2 || allToOptions.length < 1);

  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={isTransferDisabledForCardCount}
            aria-disabled={!canSave || isTransferDisabledForCardCount}
            style={
              isTransferDisabledForCardCount || !canSave
                ? {
                    opacity: 0.45,
                    pointerEvents: isTransferDisabledForCardCount
                      ? "none"
                      : undefined,
                  }
                : undefined
            }
            onClick={handleSaveAccountTx}
          >
            Save changes
          </button>
          <button
            type="button"
            className="btn del"
            onClick={() => onDelete(tx.id)}
          >
            Delete
          </button>
        </>
      }
    >
      <h3 id="sheet-title">Edit account activity</h3>
      <Seg
        className="sheet-mode-seg"
        value={g.type}
        onPick={(v) => {
          setAmtError("");
          setG((current) => {
            const nextFrom =
              v === "transfer"
                ? current.fromAccount || current.acct
                : current.fromAccount;
            const fromCard = cards.find((c) => c.id === nextFrom);
            const resolvedFrom = fromCard?.frozen
              ? cards.find((c) => !c.frozen)?.id || nextFrom
              : nextFrom;
            return {
              ...current,
              type: v,
              acct: v === "transfer" ? resolvedFrom : current.acct,
              fromAccount:
                v === "transfer" ? resolvedFrom : current.fromAccount,
            };
          });
          setTimeout(() => {
            amtInputRef.current?.focus({ preventScroll: true });
          }, 0);
        }}
        options={[
          [
            "income",
            <span className="seg-item-with-icon" key="income">
              <TransactionSymbol type="income" />
              <span>Income</span>
            </span>,
          ],
          [
            "transfer",
            <span className="seg-item-with-icon" key="transfer">
              <TransactionSymbol type="transfer" />
              <span>Transfer</span>
            </span>,
          ],
          [
            "adjust",
            <span className="seg-item-with-icon" key="adjust">
              <TransactionSymbol type="adjust" />
              <span>Adjust</span>
            </span>,
          ],
        ]}
      />
      <HeroAmountField
        value={g.amt}
        onChange={(val) => {
          set("amt", val);
          if (amtError) setAmtError("");
        }}
        inputRef={amtInputRef}
        placeholder="0"
        enterKeyHint="done"
        ariaLabel="Transaction amount in taka"
        hasError={Boolean(amtError)}
        errorMessage={amtError}
        onEnter={() => {
          if (g.type === "adjust") {
            reasonSelectRef.current?.focus();
          } else {
            noteInputRef.current?.focus();
          }
        }}
      />

      {tr ? (
        <>
          <span className="lbl">From</span>
          <TxAccountCardGrid
            value={normFrom}
            options={allTransferOptions}
            cards={cards}
            lockFrozen={true}
            ariaLabel="Transfer from account"
            onPick={(value) => {
              if (cards.find((c) => c.id === value)?.frozen) return;
              setG((current) => ({
                ...current,
                fromAccount: value,
                acct: value,
                toAccount:
                  current.toAccount === value
                    ? current.fromAccount && current.fromAccount !== value
                      ? current.fromAccount
                      : allTransferOptions.find(([id]) => id !== value)?.[0] ||
                        ""
                    : current.toAccount,
              }));
            }}
          />

          <div className="tx-transfer-to-header">
            <span className="lbl">To</span>
            <button
              type="button"
              className="tx-transfer-swap-btn"
              disabled={!canSwap}
              onClick={handleSwapTransferAccounts}
              aria-label="Swap From and To accounts"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 4v16m0 0-4-4m4 4 4-4" />
                <path d="M17 20V4m0 0-4 4m4-4 4 4" />
              </svg>
              <span>Swap</span>
            </button>
          </div>

          <TxAccountCardGrid
            value={normTo}
            options={allTransferOptions}
            cards={cards}
            disabledAccountId={normFrom}
            disabledReason="Sending from here"
            ariaLabel="Transfer to account"
            onPick={(value) => set("toAccount", value)}
          />
        </>
      ) : (
        <>
          <span className="lbl">Account</span>
          <TxAccountCardGrid
            value={g.acct}
            options={singleAccountOptions}
            cards={cards}
            ariaLabel="Select account"
            onPick={(v) => {
              setG((current) => ({
                ...current,
                acct: v,
                fromAccount: v,
              }));
            }}
          />
        </>
      )}

      {g.type === "adjust" && (
        <>
          <span className="lbl">Direction</span>
          <Seg
            value={g.dir}
            onPick={(v) => set("dir", v)}
            options={[
              ["up", "Increase"],
              ["down", "Decrease"],
            ]}
          />
        </>
      )}

      <span className="lbl">Date</span>
      <div className="seg">
        <button
          type="button"
          aria-pressed={g.date === ld()}
          className={g.date === ld() ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ld());
          }}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={g.date === ago(1)}
          className={g.date === ago(1) ? "on" : ""}
          onClick={() => {
            triggerHaptic("selection");
            set("date", ago(1));
          }}
        >
          Yesterday
        </button>
        <input
          name="editTxDate"
          type="date"
          className={customDate ? "on" : ""}
          aria-label="Transaction date"
          value={g.date}
          onChange={(e) => {
            if (e.target.value) set("date", e.target.value);
          }}
        />
      </div>

      {g.type === "adjust" ? (
        <>
          <span className="lbl">Reason (optional)</span>
          <select
            name="editAdjustmentReason"
            ref={reasonSelectRef}
            className="in"
            aria-label="Adjustment reason (optional)"
            value={g.note}
            onChange={(event) => set("note", event.target.value)}
          >
            <option value="">No reason</option>
            <option value="Fee">Fee</option>
            <option value="Cash withdrawn">Cash withdrawn</option>
            <option value="Correction">Correction</option>
            {g.note &&
              !["", "Fee", "Cash withdrawn", "Correction"].includes(g.note) && (
                <option value={g.note}>{g.note}</option>
              )}
          </select>
        </>
      ) : (
        <>
          <span className="lbl">Note (optional)</span>
          <input
            name="editTxNote"
            ref={noteInputRef}
            className="in"
            maxLength={80}
            aria-label="Transaction note"
            autoCapitalize="sentences"
            enterKeyHint="done"
            placeholder={
              g.type === "income" ? "e.g. Salary, cash in" : "Optional note"
            }
            value={g.note}
            onChange={(e) => set("note", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
                if (canSave) onSave(tx.id, g);
              }
            }}
          />
        </>
      )}
    </Sheet>
  );
}

function DetailSheet({
  e,
  expenses = [],
  suggestion,
  cards = [],
  deletedCards = null,
  onSave,
  onDelete,
  onClose,
}) {
  const [f, setF] = useState({
    desc: e.desc,
    amt: e.amt ?? "",
    cat: e.cat,
    date: e.date,
    acct: e.acct || "",
  });
  const [amtError, setAmtError] = useState("");
  const [descError, setDescError] = useState("");
  const amtInputRef = useRef(null);
  const descInputRef = useRef(null);
  const set = (key, value) => setF((current) => ({ ...current, [key]: value }));
  const customDate = f.date !== ld() && f.date !== ago(1);
  const activeSuggestion =
    suggestedCategory(f.desc, expenses, e.id) || suggestion || "";
  const rawAmtStr = String(f.amt ?? "").trim();
  const amtNum = parseAmount(f.amt);
  const hasExplicitInvalidAmt =
    rawAmtStr !== "" &&
    (amtNum === null || !Number.isFinite(amtNum) || amtNum <= 0);
  const isSavings = f.cat === "Savings";
  const savingsId = getSavingsAccountId(cards);
  const hasSavingsAccount = Boolean(savingsId);
  const savingsCard = savingsId ? cards.find((c) => c.id === savingsId) : null;
  const selectedCard = cards.find((c) => c.id === (f.acct || "cash")) || null;
  const nonSavingsCards = cards.filter(
    (c) =>
      c.id !== "cash" &&
      c.type !== "cash" &&
      c.category !== "cash" &&
      c.provider !== "cash" &&
      c.type !== "savings" &&
      c.category !== "savings" &&
      c.provider !== "savings",
  );
  const spendableCards = nonSavingsCards.filter((c) => !c.frozen);
  const primaryCard =
    spendableCards.find((c) => c.isPrimary) || spendableCards[0];
  const canSave =
    Boolean(f.desc?.trim()) &&
    Boolean(f.date) &&
    !hasExplicitInvalidAmt &&
    (amtNum === null || (Number.isFinite(amtNum) && amtNum > 0)) &&
    !selectedCard?.frozen &&
    !(isSavings && savingsCard?.frozen) &&
    (!isSavings ||
      (amtNum !== null &&
        amtNum > 0 &&
        (!hasSavingsAccount || (Boolean(f.acct) && f.acct !== "cash"))));

  const handleSaveDetail = () => {
    if (hasExplicitInvalidAmt) {
      setAmtError("Enter an amount greater than ৳0, or clear the field.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (
      isSavings &&
      (amtNum === null || !Number.isFinite(amtNum) || amtNum <= 0)
    ) {
      setAmtError("Enter an amount greater than ৳0 for savings transfers.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!f.desc?.trim()) {
      setDescError("Enter a description for this expense.");
      triggerHaptic("warning");
      descInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (selectedCard?.frozen || (isSavings && savingsCard?.frozen)) {
      setAmtError("Selected card is locked. Choose an unlocked account.");
      triggerHaptic("warning");
      return;
    }
    if (isSavings && hasSavingsAccount && (!f.acct || f.acct === "cash")) {
      setAmtError("Select a card or wallet to transfer savings from.");
      triggerHaptic("warning");
      return;
    }
    if (!canSave) {
      triggerHaptic("warning");
      return;
    }
    setAmtError("");
    setDescError("");
    triggerHaptic("selection");
    onSave(e.id, f);
  };

  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button
            type="button"
            className="btn"
            aria-disabled={!canSave}
            onClick={handleSaveDetail}
          >
            Save changes
          </button>
          <button
            type="button"
            className="btn del"
            onClick={() => onDelete(e.id)}
          >
            Delete expense
          </button>
        </>
      }
    >
      <h3 id="sheet-title">Edit expense</h3>
      <HeroAmountField
        value={f.amt}
        onChange={(val) => {
          set("amt", val);
          if (amtError) setAmtError("");
        }}
        inputRef={amtInputRef}
        placeholder="0"
        enterKeyHint="done"
        ariaLabel="Expense amount in taka"
        hasError={Boolean(amtError)}
        errorMessage={amtError}
        onEnter={() => descInputRef.current?.focus()}
      />
      <span className="lbl">What was it for?</span>
      <input
        name="editExpenseDescription"
        ref={descInputRef}
        className={`in${descError ? " is-error" : ""}`}
        maxLength={80}
        aria-label="Expense description"
        enterKeyHint="done"
        value={f.desc}
        onChange={(event) => {
          set("desc", event.target.value);
          if (descError) setDescError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            handleSaveDetail();
          }
        }}
      />
      {descError ? (
        <p className="field-error-msg" role="alert">
          {descError}
        </p>
      ) : null}
      <div className="category-header-row">
        <span className="lbl">Category</span>
        {activeSuggestion && activeSuggestion !== f.cat && (
          <button
            className="category-suggestion-action is-inline-hint"
            type="button"
            style={{
              "--c":
                getCategoryColor(activeSuggestion, f.desc) ||
                CAT[activeSuggestion]?.[1] ||
                "#64748b",
            }}
            aria-label={`Use suggestion: ${activeSuggestion}`}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => ({
                ...current,
                cat: activeSuggestion,
                ...(activeSuggestion === "Savings" &&
                hasSavingsAccount &&
                !current.acct
                  ? { acct: primaryCard?.id || spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <UtilitySymbol name="suggestion" />
            <span className="category-suggestion-label">Suggested</span>
            <CategorySuggestionValue
              category={activeSuggestion}
              description={f.desc}
            />
          </button>
        )}
      </div>
      <div className="cg">
        {Object.keys(CAT).map((category) => (
          <button
            type="button"
            key={category}
            aria-pressed={f.cat === category}
            className={f.cat === category ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => ({
                ...current,
                cat: category,
                ...(category === "Savings" && hasSavingsAccount && !current.acct
                  ? { acct: primaryCard?.id || spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <CategorySymbol
              category={category}
              description={category === "Entertainment" ? f.desc : ""}
            />
            <span>{category}</span>
          </button>
        ))}
      </div>
      <span className="lbl">Date</span>
      {e.rec ? (
        <>
          <p className="hint recurring-date-note">
            This recurring expense stays on its scheduled date.
          </p>
          <input
            name="editExpenseDateDisabled"
            className="in"
            type="date"
            aria-label="Expense date"
            value={f.date}
            disabled={true}
            onChange={(event) => set("date", event.target.value)}
          />
        </>
      ) : (
        <div className="seg">
          <button
            type="button"
            aria-pressed={f.date === ld()}
            className={f.date === ld() ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              set("date", ld());
            }}
          >
            Today
          </button>
          <button
            type="button"
            aria-pressed={f.date === ago(1)}
            className={f.date === ago(1) ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              set("date", ago(1));
            }}
          >
            Yesterday
          </button>
          <input
            name="editExpenseDate"
            type="date"
            className={customDate ? "on" : ""}
            aria-label="Expense date"
            value={f.date}
            onChange={(event) => {
              if (event.target.value) set("date", event.target.value);
            }}
          />
        </div>
      )}
      <span className="lbl">
        {isSavings && hasSavingsAccount ? "Transfer from" : "Paid from"}
      </span>
      <TxAccountCardGrid
        value={f.acct}
        lockFrozen={true}
        ariaLabel={
          isSavings && hasSavingsAccount
            ? "Transfer from account"
            : "Paid from account"
        }
        onPick={(value) => set("acct", value)}
        cards={cards}
        options={
          isSavings &&
          hasSavingsAccount &&
          nonSavingsCards.length > 0 &&
          f.acct !== ""
            ? [
                ...nonSavingsCards.map((c) => [c.id, c.name]),
                ...(f.acct &&
                f.acct !== "cash" &&
                !nonSavingsCards.some((c) => c.id === f.acct)
                  ? [
                      [
                        f.acct,
                        getAccountDisplay(f.acct, cards, deletedCards)[0],
                      ],
                    ]
                  : []),
              ]
            : [
                ["", "Cash"],
                ...nonSavingsCards.map((c) => [c.id, c.name]),
                ...(f.acct &&
                f.acct !== "cash" &&
                !nonSavingsCards.some((c) => c.id === f.acct)
                  ? [
                      [
                        f.acct,
                        getAccountDisplay(f.acct, cards, deletedCards)[0],
                      ],
                    ]
                  : []),
              ]
        }
      />
    </Sheet>
  );
}

function RecurringDetailSheet({
  r,
  expenses = [],
  cards = [],
  deletedCards = null,
  onSave,
  onDelete,
  onClose,
}) {
  const [f, setF] = useState({
    desc: r.desc || "",
    amt: r.amt ?? "",
    cat: r.cat || "Bills",
    next: r.next || ld(),
    acct: r.acct || "",
    iv: r.iv || "monthly",
    on: Boolean(r.on),
  });
  const [amtError, setAmtError] = useState("");
  const [descError, setDescError] = useState("");
  const amtInputRef = useRef(null);
  const descInputRef = useRef(null);
  const set = (key, value) => setF((current) => ({ ...current, [key]: value }));
  const activeSuggestion = suggestedCategory(f.desc, expenses) || "";
  const amtNum = parseAmount(f.amt);
  const isSavings = f.cat === "Savings";
  const savingsId = getSavingsAccountId(cards);
  const hasSavingsAccount = Boolean(savingsId);
  const savingsCard = savingsId ? cards.find((c) => c.id === savingsId) : null;
  const selectedCard = cards.find((c) => c.id === (f.acct || "cash")) || null;
  const nonSavingsCards = cards.filter(
    (c) =>
      c.id !== "cash" &&
      c.type !== "cash" &&
      c.category !== "cash" &&
      c.provider !== "cash" &&
      c.type !== "savings" &&
      c.category !== "savings" &&
      c.provider !== "savings",
  );
  const spendableCards = nonSavingsCards.filter((c) => !c.frozen);
  const primaryCard =
    spendableCards.find((c) => c.isPrimary) || spendableCards[0];
  const canSave =
    Boolean(f.desc?.trim()) &&
    Boolean(f.next) &&
    Number.isFinite(amtNum) &&
    amtNum > 0 &&
    !selectedCard?.frozen &&
    !(isSavings && savingsCard?.frozen) &&
    (!isSavings ||
      !hasSavingsAccount ||
      (Boolean(f.acct) && f.acct !== "cash"));

  const handleSaveRecurring = () => {
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      setAmtError("Enter an amount greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!f.desc?.trim()) {
      setDescError("Enter a name or description.");
      triggerHaptic("warning");
      descInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!canSave) {
      triggerHaptic("warning");
      return;
    }
    setAmtError("");
    setDescError("");
    triggerHaptic("selection");
    onSave(r.id, f);
  };

  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button
            type="button"
            className="btn"
            aria-disabled={!canSave}
            onClick={handleSaveRecurring}
          >
            Save changes
          </button>
          <button
            type="button"
            className="btn del"
            onClick={() => onDelete(r.id)}
          >
            Delete
          </button>
        </>
      }
    >
      <h3 id="sheet-title">
        {isSavings ? "Edit recurring savings" : "Edit recurring expense"}
      </h3>
      <HeroAmountField
        value={f.amt}
        onChange={(val) => {
          set("amt", val);
          if (amtError) setAmtError("");
        }}
        inputRef={amtInputRef}
        placeholder="0"
        enterKeyHint="done"
        ariaLabel="Recurring amount in taka"
        hasError={Boolean(amtError)}
        errorMessage={amtError}
        onEnter={() => descInputRef.current?.focus()}
      />
      <span className="lbl">What was it for?</span>
      <input
        name="recurringDescription"
        ref={descInputRef}
        className={`in${descError ? " is-error" : ""}`}
        maxLength={80}
        aria-label="Recurring description"
        enterKeyHint="done"
        value={f.desc}
        onChange={(event) => {
          set("desc", event.target.value);
          if (descError) setDescError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            handleSaveRecurring();
          }
        }}
      />
      {descError ? (
        <p className="field-error-msg" role="alert">
          {descError}
        </p>
      ) : null}
      <div className="category-header-row">
        <span className="lbl">Category</span>
        {activeSuggestion && activeSuggestion !== f.cat && (
          <button
            className="category-suggestion-action is-inline-hint"
            type="button"
            style={{
              "--c":
                getCategoryColor(activeSuggestion, f.desc) ||
                CAT[activeSuggestion]?.[1] ||
                "#64748b",
            }}
            aria-label={`Use suggestion: ${activeSuggestion}`}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => ({
                ...current,
                cat: activeSuggestion,
                ...(activeSuggestion === "Savings" &&
                hasSavingsAccount &&
                !current.acct
                  ? { acct: primaryCard?.id || spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <UtilitySymbol name="suggestion" />
            <span className="category-suggestion-label">Suggested</span>
            <CategorySuggestionValue
              category={activeSuggestion}
              description={f.desc}
            />
          </button>
        )}
      </div>
      <div className="cg">
        {Object.keys(CAT).map((category) => (
          <button
            type="button"
            key={category}
            aria-pressed={f.cat === category}
            className={f.cat === category ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              setF((current) => ({
                ...current,
                cat: category,
                ...(category === "Savings" && hasSavingsAccount && !current.acct
                  ? { acct: primaryCard?.id || spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <CategorySymbol
              category={category}
              description={category === "Entertainment" ? f.desc : ""}
            />
            <span>{category}</span>
          </button>
        ))}
      </div>
      <span className="lbl">Next scheduled date</span>
      <input
        name="recurringNextDate"
        className="in"
        type="date"
        aria-label="Next scheduled date"
        value={f.next}
        onChange={(event) => {
          if (event.target.value) set("next", event.target.value);
        }}
      />
      <span className="lbl">
        {isSavings && hasSavingsAccount ? "Transfer from" : "Paid from"}
      </span>
      <TxAccountCardGrid
        value={f.acct}
        lockFrozen={true}
        ariaLabel={
          isSavings && hasSavingsAccount
            ? "Transfer from account"
            : "Paid from account"
        }
        onPick={(value) => set("acct", value)}
        cards={cards}
        options={
          isSavings &&
          hasSavingsAccount &&
          nonSavingsCards.length > 0 &&
          f.acct !== ""
            ? [
                ...nonSavingsCards.map((c) => [c.id, c.name]),
                ...(f.acct &&
                f.acct !== "cash" &&
                !nonSavingsCards.some((c) => c.id === f.acct)
                  ? [
                      [
                        f.acct,
                        getAccountDisplay(f.acct, cards, deletedCards)[0],
                      ],
                    ]
                  : []),
              ]
            : [
                ["", "Cash"],
                ...nonSavingsCards.map((c) => [c.id, c.name]),
                ...(f.acct &&
                f.acct !== "cash" &&
                !nonSavingsCards.some((c) => c.id === f.acct)
                  ? [
                      [
                        f.acct,
                        getAccountDisplay(f.acct, cards, deletedCards)[0],
                      ],
                    ]
                  : []),
              ]
        }
      />
      <span className="lbl">Repeat</span>
      <Seg
        value={f.iv}
        onPick={(v) => set("iv", v)}
        options={[
          ["weekly", "Weekly"],
          ["monthly", "Monthly"],
        ]}
      />
      <span className="lbl">Status</span>
      <Seg
        value={f.on ? "on" : "off"}
        onPick={(v) => set("on", v === "on")}
        options={[
          ["on", "Active"],
          ["off", "Paused"],
        ]}
      />
    </Sheet>
  );
}

function BudgetSheet({ S, onSave, onClear, onClose }) {
  const currentBudget = S?.bud?.[S.m] || "";
  const [v, setV] = useState(currentBudget);
  const [amtError, setAmtError] = useState("");
  const amtInputRef = useRef(null);

  const handleSaveBudget = () => {
    const rawStr = String(v ?? "").trim();
    if (!rawStr) {
      if (currentBudget) {
        onClear?.();
        return;
      }
      setAmtError("Enter a monthly budget greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    const num = parseAmount(v);
    if (num === null || !Number.isFinite(num) || num <= 0) {
      setAmtError("Enter a monthly budget greater than ৳0.");
      triggerHaptic("warning");
      amtInputRef.current?.focus({ preventScroll: true });
      return;
    }
    setAmtError("");
    onSave(num);
  };

  return (
    <Sheet
      onClose={onClose}
      actionsClassName={currentBudget ? "is-paired" : ""}
      actions={
        <>
          <button type="button" className="btn" onClick={handleSaveBudget}>
            Save budget
          </button>
          {currentBudget ? (
            <button type="button" className="btn del" onClick={onClear}>
              Clear budget
            </button>
          ) : null}
        </>
      }
    >
      <h3 id="sheet-title">Monthly budget</h3>
      <p className="hint" style={{ textAlign: "left" }}>
        {fM(S?.m || "")}
      </p>
      <HeroAmountField
        value={v}
        onChange={(val) => {
          setV(val);
          if (amtError) setAmtError("");
        }}
        inputRef={amtInputRef}
        placeholder="20000"
        enterKeyHint="done"
        ariaLabel="Monthly budget amount in taka"
        hasError={Boolean(amtError)}
        errorMessage={amtError}
        onEnter={handleSaveBudget}
      />
    </Sheet>
  );
}

function BudgetInsightsSheet({ S, onEditBudget, onClose }) {
  const todayStr = ld();
  const monthKey = S?.m || todayStr.slice(0, 7);
  const isCurrentMonth = monthKey === todayStr.slice(0, 7);
  const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

  const monthItems = (S?.exp || []).filter(
    (e) => typeof e?.date === "string" && e.date.startsWith(monthKey) && e.amt != null,
  );
  const nonSavingsItems = monthItems.filter((e) => e.cat !== "Savings");
  const totalSpent = round2(
    nonSavingsItems.reduce((sum, e) => sum + (Number(e.amt) || 0), 0),
  );
  const savedThisMonth = round2(
    monthItems
      .filter((e) => e.cat === "Savings")
      .reduce((sum, e) => sum + (Number(e.amt) || 0), 0),
  );
  const budgetLimit = round2(S?.bud?.[monthKey] || 0);

  const prevMonthKey = shift(monthKey, -1);
  const prevSpent = round2(
    (S?.exp || [])
      .filter(
        (e) =>
          typeof e?.date === "string" &&
          e.date.startsWith(prevMonthKey) &&
          e.amt != null &&
          e.cat !== "Savings",
      )
      .reduce((sum, e) => sum + (Number(e.amt) || 0), 0),
  );
  const prevDiff = round2(totalSpent - prevSpent);
  const prevDiffPct = prevSpent > 0 ? Math.round((prevDiff / prevSpent) * 100) : null;

  const [yearNum, monthNum] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate() || 30;
  const currentDay = isCurrentMonth
    ? Math.min(daysInMonth, Number(todayStr.split("-")[2]) || 1)
    : daysInMonth;
  const daysPassed = Math.max(1, currentDay);
  const daysRemaining = Math.max(1, daysInMonth - currentDay + 1);

  const dailyBurn = totalSpent / daysPassed;
  const projectedTotal = isCurrentMonth
    ? Math.round(dailyBurn * daysInMonth)
    : Math.round(totalSpent);
  const projectedDelta = budgetLimit > 0 ? round2(projectedTotal - budgetLimit) : 0;
  const safeDailyAllowance =
    budgetLimit > 0 && isCurrentMonth && budgetLimit > totalSpent
      ? Math.round((budgetLimit - totalSpent) / daysRemaining)
      : 0;

  const byCat = {};
  for (const item of nonSavingsItems) {
    const cat = CAT[item.cat] ? item.cat : "Other";
    byCat[cat] = round2((byCat[cat] || 0) + (Number(item.amt) || 0));
  }
  const topCategories = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const activeBills = (S?.rec || []).filter(
    (r) => !isRecurringPaused(r) && r.cat !== "Savings",
  );
  const recurringBillsMonthly = Math.round(
    activeBills.reduce((sum, r) => sum + normalizeToMonthly(r.amt, r.iv), 0),
  );

  return (
    <Sheet
      onClose={onClose}
      actions={
        <button
          type="button"
          className="btn"
          onClick={() => {
            triggerHaptic("selection");
            onEditBudget?.();
          }}
        >
          {budgetLimit > 0 ? "Edit budget" : "Set budget"}
        </button>
      }
    >
      <h3 id="sheet-title">Budget insights</h3>
      <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>
        {fM(monthKey)}
      </p>

      <div className="budget-insights-grid">
        <div className="budget-insights-tile">
          <span className="budget-insights-label">
            {isCurrentMonth ? "Projected month-end" : "Total spent"}
          </span>
          <strong className="budget-insights-value">
            {M(projectedTotal)}
          </strong>
          <span
            className={`budget-insights-note${
              budgetLimit > 0
                ? projectedDelta > 0
                  ? " is-bad"
                  : " is-good"
                : ""
            }`}
          >
            {budgetLimit > 0
              ? projectedDelta > 0
                ? `${M(projectedDelta)} over limit`
                : projectedDelta < 0
                  ? `${M(Math.abs(projectedDelta))} under limit`
                  : "On limit"
              : "No limit set"}
          </span>
        </div>

        <div className="budget-insights-tile">
          <span className="budget-insights-label">
            {isCurrentMonth && budgetLimit > 0
              ? "Safe daily pace"
              : "Daily average"}
          </span>
          <strong className="budget-insights-value">
            {isCurrentMonth && budgetLimit > 0
              ? budgetLimit > totalSpent
                ? `${M(safeDailyAllowance)}/day`
                : "৳0/day"
              : `${M(Math.round(dailyBurn))}/day`}
          </strong>
          <span className="budget-insights-note">
            {isCurrentMonth && budgetLimit > 0
              ? budgetLimit > totalSpent
                ? `For ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left`
                : "Budget limit reached"
              : `Across ${daysPassed} ${daysPassed === 1 ? "day" : "days"}`}
          </span>
        </div>

        <div className="budget-insights-tile">
          <span className="budget-insights-label">vs. Last month</span>
          <strong className="budget-insights-value">
            {prevSpent > 0
              ? `${prevDiff > 0 ? "+" : prevDiff < 0 ? "−" : ""}${M(Math.abs(prevDiff))}`
              : "—"}
          </strong>
          <span
            className={`budget-insights-note${
              prevSpent > 0
                ? prevDiff > 0
                  ? " is-bad"
                  : prevDiff < 0
                    ? " is-good"
                    : ""
                : ""
            }`}
          >
            {prevSpent > 0
              ? prevDiffPct === 0
                ? "Same as last month"
                : `${prevDiffPct > 0 ? "+" : ""}${prevDiffPct}% vs ${fM(prevMonthKey).split(" ")[0]}`
              : "No prior month data"}
          </span>
        </div>

        <div className="budget-insights-tile">
          <span className="budget-insights-label">Recurring bills</span>
          <strong className="budget-insights-value">
            {M(recurringBillsMonthly)}/mo
          </strong>
          <span className="budget-insights-note">
            {activeBills.length} active {activeBills.length === 1 ? "bill" : "bills"}
            {savedThisMonth > 0 ? ` · ${M(savedThisMonth)} saved` : ""}
          </span>
        </div>
      </div>

      <div className="budget-insights-categories">
        <div className="budget-insights-cat-header">
          <span>Spending by category</span>
          <small>
            {topCategories.length}{" "}
            {topCategories.length === 1 ? "category" : "categories"}
          </small>
        </div>
        {topCategories.length > 0 ? (
          <div className="budget-insights-cat-list">
            {topCategories.slice(0, 6).map(([catName, catAmt]) => {
              const pct = totalSpent > 0 ? Math.round((catAmt / totalSpent) * 100) : 0;
              const catColor = CAT[catName]?.[1] || "#64748b";
              return (
                <div key={catName} className="budget-insights-cat-row">
                  <div className="budget-insights-cat-top">
                    <span className="budget-insights-cat-name">
                      <i
                        className="budget-insights-cat-icon"
                        style={{ "--c": catColor }}
                      >
                        <CategorySymbol category={catName} />
                      </i>
                      <span>{catName}</span>
                    </span>
                    <span className="budget-insights-cat-meta">
                      <small>{pct}%</small>
                      <b>{M(catAmt)}</b>
                    </span>
                  </div>
                  <div className="budget-insights-cat-track" aria-hidden="true">
                    <div
                      className="budget-insights-cat-fill"
                      style={{
                        width: `${Math.min(100, Math.max(4, pct))}%`,
                        background: catColor,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="budget-insights-empty">
            No spending recorded for {fM(monthKey)} yet.
          </p>
        )}
      </div>
    </Sheet>
  );
}

function SettingsSheet({
  S,
  profile,
  hapticsEnabled = true,
  onToggleHaptics,
  onTheme,
  onAdvanced,
  onProfileSettings,
  onSecurity,
  onClose,
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__spendCheckForUpdates?.();
    }
  }, []);
  const themeMode =
    S?.themeMode ||
    (S?.theme === "auto" || S?.theme === "light" || S?.theme === "dark"
      ? S.theme
      : "auto");
  const pinActive = hasAppPin();
  const isConnected = Boolean(profile?.connected);

  const handlePickTheme = (mode) => {
    if (mode === themeMode) return;
    triggerHaptic("selection");
    onTheme?.(mode);
  };

  return (
    <Sheet onClose={onClose}>
      <div className="mfs-settings-sheet">
        <h3 id="sheet-title" className="mfs-settings-sheet-title">
          Settings
        </h3>

        {/* Identity & Sync Card */}
        <button
          className="ri settings-profile-row mfs-settings-profile-card"
          type="button"
          aria-label="Open profile and sync settings"
          onClick={() => {
            triggerHaptic("selection");
            onProfileSettings?.();
          }}
        >
          <i
            className={`ic mfs-profile-avatar${profile?.avatar ? " has-photo" : ""}`}
            style={{ "--c": "var(--g)" }}
          >
            {profile?.avatar ? (
              <img
                src={profile.avatar}
                alt=""
                className="mfs-avatar-img"
                draggable="false"
              />
            ) : (
              profile?.initial || "S"
            )}
          </i>
          <span className="nm">
            <b>{profile?.name || "Local profile"}</b>
            <small>{profile?.email || "Data stays on this device"}</small>
          </span>
          <span
            className={`mfs-profile-status-pill${isConnected ? " is-synced" : ""}`}
          >
            <span className="mfs-profile-status-dot" aria-hidden="true" />
            {isConnected ? "Synced" : "Local"}
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>

        {/* Section 1: Appearance & Haptics */}
        <div className="mfs-settings-section">
          <span className="mfs-settings-section-label">PREFERENCES</span>
          <div className="mfs-settings-group">
            <div className="mfs-settings-row is-appearance">
              <div className="mfs-appearance-top">
                <i className="ic mfs-row-icon" style={{ "--c": "#6366f1" }}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                  </svg>
                </i>
                <span className="nm">
                  <b>Appearance</b>
                  <small>
                    {themeMode === "auto"
                      ? "Matches device theme"
                      : themeMode === "dark"
                        ? "Dark theme active"
                        : "Light theme active"}
                  </small>
                </span>
              </div>
              <SegmentedControl
                className="mfs-theme-seg-frosted"
                role="radiogroup"
                ariaLabel="Appearance theme"
                value={themeMode}
                glass={true}
                compact={true}
                onChange={(mode) => handlePickTheme(mode)}
                options={[
                  [
                    "auto",
                    <span className="seg-item-with-icon" key="auto">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 3v18" />
                        <path
                          d="M12 7a5 5 0 0 1 0 10"
                          fill="currentColor"
                          stroke="none"
                        />
                      </svg>
                      <span>Auto</span>
                    </span>,
                  ],
                  [
                    "light",
                    <span className="seg-item-with-icon" key="light">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="4.5" />
                        <path d="M12 2.5v2.2M12 19.3v2.2M5.28 5.28l1.56 1.56M17.16 17.16l1.56 1.56M2.5 12h2.2M19.3 12h2.2M5.28 18.72l1.56-1.56M17.16 6.84l1.56-1.56" />
                      </svg>
                      <span>Light</span>
                    </span>,
                  ],
                  [
                    "dark",
                    <span className="seg-item-with-icon" key="dark">
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                      <span>Dark</span>
                    </span>,
                  ],
                ]}
              />
            </div>

            <button
              className="ri mfs-settings-row"
              type="button"
              aria-pressed={hapticsEnabled}
              onClick={() => onToggleHaptics?.()}
            >
              <i className="ic mfs-row-icon" style={{ "--c": "#0ea5e9" }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="7" y="4" width="10" height="16" rx="2.5" />
                  <path d="M3.5 8.5c-1.2 2.1-1.2 4.9 0 7" />
                  <path d="M20.5 8.5c1.2 2.1 1.2 4.9 0 7" />
                </svg>
              </i>
              <span className="nm">
                <b>Haptic feedback</b>
                <small>Touch vibrations on iOS &amp; Android</small>
              </span>
              <span
                className={"sw " + (hapticsEnabled ? "on" : "")}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {/* Section 2: App & Security */}
        <div className="mfs-settings-section">
          <span className="mfs-settings-section-label">APP &amp; SECURITY</span>
          <div className="mfs-settings-group">
            <button
              className="ri mfs-settings-row"
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                onAdvanced?.();
              }}
            >
              <i className="ic mfs-row-icon" style={{ "--c": "#f59e0b" }}>
                <Icon n="bell" />
              </i>
              <span className="nm">
                <b>App settings</b>
                <small>Reminders, backups &amp; updates</small>
              </span>
              <span className="settings-chevron" aria-hidden="true">
                <Icon n="r" />
              </span>
            </button>

            <button
              className="ri mfs-settings-row"
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                onSecurity?.();
              }}
            >
              <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <rect x="9" y="11" width="6" height="5" rx="1" />
                  <path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11" />
                </svg>
              </i>
              <span className="nm">
                <b>Security &amp; App Lock</b>
                <small>
                  {pinActive
                    ? "Passcode active"
                    : "Set PIN passcode & biometrics"}
                </small>
              </span>
              <span className={`mfs-row-badge${pinActive ? " is-active" : ""}`}>
                {pinActive ? "Active" : "Off"}
              </span>
              <span className="settings-chevron" aria-hidden="true">
                <Icon n="r" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

const CARD_THEMES = [
  {
    id: "emerald",
    name: "Emerald Vault",
    color: "#157358",
    gradient:
      "linear-gradient(135deg, #227e60 0%, #10684c 40%, #074c38 75%, #032b20 100%)",
  },
  {
    id: "obsidian",
    name: "Obsidian Slate",
    color: "#1e293b",
    gradient: "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
  },
  {
    id: "purple",
    name: "Royal Purple",
    color: "#6358DC",
    gradient: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #4338ca 100%)",
  },
  {
    id: "berry",
    name: "Velvet Berry",
    color: "#831843",
    gradient:
      "linear-gradient(135deg, #831843 0%, #701a75 40%, #4a044e 70%, #2e0238 100%)",
  },
  {
    id: "navy",
    name: "Sapphire Navy",
    color: "#004c8f",
    gradient: "linear-gradient(135deg, #004c8f 0%, #002d56 70%, #001933 100%)",
  },
  {
    id: "amber",
    name: "Sunset Amber",
    color: "#b45309",
    gradient: "linear-gradient(135deg, #d97706 0%, #b45309 50%, #78350f 100%)",
  },
  {
    id: "teal",
    name: "Teal Digital",
    color: "#0f766e",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0f766e 60%, #134e4a 100%)",
  },
  {
    id: "crimson",
    name: "Crimson Red",
    color: "#b91c1c",
    gradient: "linear-gradient(135deg, #dc2626 0%, #b91c1c 60%, #7f1d1d 100%)",
  },
];

const CARD_FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "visa", label: "Visa" },
  { id: "mastercard", label: "Mastercard" },
  { id: "mfs", label: "MFS Wallets" },
  { id: "savings", label: "Vault" },
  { id: "custom", label: "Custom" },
];

function AddCardSheet({
  onClose,
  onAddCard,
  cards = [],
  onOpenExistingCard,
  onToast,
  userProfileName = "Cardholder",
}) {
  const [step, setStep] = useState("catalog"); // 'catalog' | 'customize' | 'success'
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState(CARD_PROVIDERS[0]);
  const sheetScrollRef = useRef(null);
  const catalogScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    const scrollNode = sheetScrollRef.current;
    if (!scrollNode) return;
    if (step === "catalog") {
      scrollNode.scrollTop = catalogScrollTopRef.current;
    } else {
      scrollNode.scrollTop = 0;
    }
  }, [step]);

  // Form State with Live Synchronization - Clean & Unfilled Initially (Use placeholders instead of pre-typed text)
  const [formData, setFormData] = useState({
    name: "",
    holderName: "",
    last4: "",
    number: "",
    type: "credit",
    network: "visa",
    currency: "BDT",
    expiry: "",
    initialBalance: "",
    color: "",
    gradient: "",
  });

  const filteredProviders = useMemo(() => {
    let list = CARD_PROVIDERS;

    if (activeFilter === "mfs") {
      list = list.filter(
        (p) => p.category === "mfs" || p.defaultNetwork === "mfs" || p.isPhone,
      );
    } else if (activeFilter === "visa") {
      list = list.filter(
        (p) => p.defaultNetwork === "visa" || p.id === "custom",
      );
    } else if (activeFilter === "mastercard") {
      list = list.filter(
        (p) => p.defaultNetwork === "mastercard" || p.id === "custom",
      );
    } else if (activeFilter === "custom") {
      list = list.filter((p) => p.id === "custom");
    } else if (activeFilter === "savings" || activeFilter === "vault") {
      list = list.filter((p) => p.category === "savings");
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.defaultNetwork && p.defaultNetwork.toLowerCase().includes(q)) ||
        (p.currency && p.currency.toLowerCase().includes(q)),
    );
  }, [searchQuery, activeFilter]);

  const handlePickProvider = (prov) => {
    if (prov.category === "savings") {
      const existingVaultId = getSavingsAccountId(cards);
      if (existingVaultId) {
        triggerHaptic("warning");
        onToast?.("You already have a Savings Vault in your wallet.");
        onOpenExistingCard?.(existingVaultId);
        return;
      }
    }
    if (prov.category === "cash") {
      const existingCash = cards.find(
        (c) =>
          (c.id === "cash" ||
            c.provider === "cash" ||
            c.category === "cash" ||
            c.type === "cash") &&
          Boolean(c.createdAt || c.updatedAt || c.isPrimary),
      );
      if (existingCash) {
        triggerHaptic("warning");
        onToast?.("You already have a Cash wallet in your deck.");
        onOpenExistingCard?.(existingCash.id);
        return;
      }
    }
    setSelectedProvider(prov);
    setFormData({
      name: "",
      holderName: "",
      type: prov.defaultType || "credit",
      network: prov.defaultNetwork || "visa",
      currency: prov.currency || "BDT",
      last4: "",
      number: "",
      expiry: "",
      initialBalance: "",
      color: prov.color || "#1e293b",
      gradient: prov.gradient || "",
    });
    catalogScrollTopRef.current = sheetScrollRef.current?.scrollTop ?? 0;
    setStep("customize");
  };

  const handleFormChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleCardNumberChange = (raw) => {
    if (!selectedProvider.isPhone) {
      const digits = raw.replace(/\D/g, "").slice(0, 4);
      setFormData((prev) => ({ ...prev, last4: digits, number: digits }));
    } else {
      const digits = raw.replace(/\D/g, "").slice(0, 11);
      setFormData((prev) => ({
        ...prev,
        last4: digits.slice(-4),
        number: digits,
      }));
    }
  };

  const handleExpiryChange = (raw) => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) {
      setFormData((prev) => ({ ...prev, expiry: digits }));
    } else {
      setFormData((prev) => ({
        ...prev,
        expiry: `${digits.slice(0, 2)}/${digits.slice(2, 4)}`,
      }));
    }
  };

  const isCustom = selectedProvider.id === "custom";

  const handleSubmitCard = (e) => {
    e?.preventDefault();
    const isMfs = selectedProvider.category === "mfs";
    const isSavings = selectedProvider.category === "savings";
    const isCash = selectedProvider.category === "cash";

    if (!isMfs && !isSavings && !isCash && formData.expiry.trim()) {
      const expMatch = formData.expiry
        .trim()
        .match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
      if (!expMatch) {
        triggerHaptic("warning");
        onToast?.("Enter a valid expiry date (MM/YY).");
        return;
      }
    }

    const enteredLast4 = (
      formData.last4 ||
      (formData.number ? formData.number.replace(/\D/g, "").slice(-4) : "")
    ).trim();
    const last4 = isSavings
      ? enteredLast4 || "4710"
      : isCash
        ? enteredLast4 || "CASH"
        : enteredLast4;
    const enteredPhoneDigits = formData.number.replace(/\D/g, "").slice(0, 11);
    const cashMeta = isCash ? getCashCurrencyMeta(formData.currency) : null;
    const number = selectedProvider.isPhone
      ? enteredPhoneDigits
      : isSavings
        ? `SAV-${last4}`
        : isCash
          ? `CASH-${cashMeta.code}`
          : last4
            ? `•••• •••• •••• ${last4}`
            : "";
    const holderName =
      formData.holderName.trim() ||
      (isCash ? "Cash wallet" : userProfileName || "Cardholder");
    const network = isMfs
      ? "mfs"
      : isSavings || isCash
        ? "none"
        : formData.network || selectedProvider.defaultNetwork || "visa";
    const type = isMfs
      ? "mfs"
      : isSavings
        ? "savings"
        : isCash
          ? "cash"
          : formData.type || selectedProvider.defaultType || "credit";
    const name = formData.name.trim() || selectedProvider.name;

    const newCard = {
      id: isCash
        ? "cash"
        : `card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      provider: selectedProvider.id,
      category: selectedProvider.category,
      type,
      network,
      currency: isCash ? cashMeta.code : selectedProvider.currency || "BDT",
      holderName,
      subtitle: isMfs
        ? "Personal"
        : isSavings
          ? "Personal Savings"
          : isCash
            ? `Cash in hand · ${cashMeta.code}`
            : isCustom
              ? formData.name.trim()
                ? `${name} ${network === "visa" ? "Visa" : network === "mastercard" ? "Mastercard" : "Amex"}`
                : "Signature Edition"
              : selectedProvider.subtitle,
      last4,
      number,
      expiry: isMfs || isSavings || isCash ? "" : formData.expiry.trim(),
      color: isCash ? cashMeta.bg : formData.color || selectedProvider.color,
      gradient: isCash
        ? cashMeta.bg
        : formData.gradient || selectedProvider.gradient,
      initialBalance: parseAmount(formData.initialBalance) || 0,
    };

    onAddCard(newCard);
    setStep("success");
    triggerHaptic("success");
  };

  const previewIsSavings = selectedProvider.category === "savings";
  const previewIsCash = selectedProvider.category === "cash";
  const previewCashMeta = previewIsCash
    ? getCashCurrencyMeta(formData.currency)
    : null;
  const previewCard = {
    id: "preview",
    name:
      formData.name.trim() ||
      (isCustom ? "Custom Card" : selectedProvider.name),
    provider: selectedProvider.id,
    category: selectedProvider.category,
    type: formData.type || selectedProvider.defaultType || "credit",
    network: formData.network || selectedProvider.defaultNetwork || "visa",
    currency: previewIsCash
      ? previewCashMeta.code
      : selectedProvider.currency || "BDT",
    holderName:
      formData.holderName.trim() ||
      (previewIsCash
        ? "Cash wallet"
        : userProfileName
          ? userProfileName.toUpperCase()
          : isCustom
            ? "CARDHOLDER"
            : selectedProvider.id === "virtual_visa" ||
                selectedProvider.id === "virtual_mc" ||
                selectedProvider.id === "gold_mc"
              ? selectedProvider.name
              : selectedProvider.name.toUpperCase()),
    subtitle: previewIsCash
      ? `Cash in hand · ${previewCashMeta.code}`
      : isCustom
        ? formData.name.trim()
          ? `${formData.name.trim()} ${formData.network === "visa" ? "Visa" : formData.network === "mastercard" ? "Mastercard" : "Amex"}`
          : "Signature Edition"
        : selectedProvider.subtitle,
    last4: formData.last4 || (formData.number ? formData.number.slice(-4) : ""),
    number: previewIsSavings
      ? formData.last4
        ? `SAV-${formData.last4}`
        : ""
      : selectedProvider.isPhone
        ? formData.number
        : formData.last4
          ? `•••• •••• •••• ${formData.last4}`
          : formData.number,
    expiry: formData.expiry,
    color: formData.color || selectedProvider.color,
    gradient: formData.gradient || selectedProvider.gradient,
  };

  return (
    <Sheet onClose={onClose} contentRef={sheetScrollRef}>
      {/* ──── Step 1: Catalog ("Add New Card") ──── */}
      {step === "catalog" && (
        <div className="add-new-card-catalog">
          <div className="add-card-header-bar is-centered">
            <h3 id="sheet-title" className="add-card-title">
              Add New Card
            </h3>
          </div>

          {/* Search Bar */}
          <div className="add-card-search-wrap">
            <svg
              viewBox="0 0 24 24"
              className="add-card-search-icon"
              aria-hidden="true"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
                stroke="currentColor"
                strokeWidth="2.2"
                fill="none"
              />
              <path
                d="m20 20-3.5-3.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            <input
              name="cardProviderSearch"
              type="text"
              className="add-card-search-input"
              aria-label="Search by bank, card, or wallet"
              placeholder="Search by bank, card, or wallet..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="add-card-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Category / Network Filter Chips */}
          <div className="add-card-filter-track">
            {CARD_FILTER_TABS.map((f) => {
              const isActive = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`add-card-filter-chip ${isActive ? "is-active" : ""}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    setActiveFilter(f.id);
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Card Templates List */}
          <div className="add-card-template-list">
            {filteredProviders.length ? (
              filteredProviders.map((prov) => {
                return (
                  <button
                    key={prov.id}
                    type="button"
                    className="add-card-template-row"
                    onClick={() => handlePickProvider(prov)}
                  >
                    <MiniCardPreview provider={prov} />

                    <div className="add-card-template-meta">
                      <b className="add-card-template-name">{prov.name}</b>
                      <span className="add-card-template-sub">
                        {prov.subtitle}
                      </span>
                    </div>

                    <div className="add-card-template-trailing">
                      <span className="add-card-currency-pill">
                        {prov.currency || "BDT"}
                      </span>
                      <span
                        className="add-card-template-chevron"
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="emp">No matching card template found.</div>
            )}
          </div>
        </div>
      )}

      {/* ──── Step 2: Form & Live Mirror Preview ("Add Card") ──── */}
      {step === "customize" && (
        <div className="add-card-customize-flow">
          <div className="add-card-header-bar">
            <button
              type="button"
              className="add-card-back-btn"
              onClick={() => setStep("catalog")}
              aria-label="Back to card selection"
            >
              ‹
            </button>
            <h3 id="sheet-title" className="add-card-title">
              Add Card
            </h3>
            <span className="add-card-header-spacer" aria-hidden="true" />
          </div>

          {/* Real-time Dynamic Card Preview */}
          <div className="add-card-live-preview-wrap">
            <WalletCard
              card={previewCard}
              balance={parseAmount(formData.initialBalance) || 0}
              isActive={true}
              interactive={false}
              showBalance={true}
              showFullDetails={true}
            />
          </div>

          {/* Form Fields ("Card Details") */}
          <div className="add-card-form-body">
            <h4 className="add-card-section-label">Card Details</h4>

            {!selectedProvider.isPhone &&
              selectedProvider.category !== "savings" &&
              selectedProvider.category !== "cash" &&
              selectedProvider.id !== "gold_mc" && (
                <div className="add-card-field">
                  <label className="add-card-input-lbl">Card Network</label>
                  <div className="add-card-network-selector">
                    <button
                      type="button"
                      className={`add-card-network-btn ${formData.network === "visa" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        handleFormChange("network", "visa");
                      }}
                    >
                      <VisaBadge width={44} height={17} variant="adaptive" />
                      <span>Visa</span>
                    </button>

                    <button
                      type="button"
                      className={`add-card-network-btn ${formData.network === "mastercard" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        handleFormChange("network", "mastercard");
                      }}
                    >
                      <MastercardBadge width={30} height={20} />
                      <span>Mastercard</span>
                    </button>

                    <button
                      type="button"
                      className={`add-card-network-btn ${formData.network === "amex" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        handleFormChange("network", "amex");
                      }}
                    >
                      <AmexBadge width={34} height={17} />
                      <span>Amex</span>
                    </button>
                  </div>
                </div>
              )}

            {!selectedProvider.isPhone &&
              selectedProvider.category !== "savings" &&
              selectedProvider.category !== "cash" && (
                <div className="add-card-field">
                  <label className="add-card-input-lbl">Card Type</label>
                  <div className="add-card-type-toggle">
                    <button
                      type="button"
                      className={`add-card-type-pill ${formData.type === "credit" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        handleFormChange("type", "credit");
                      }}
                    >
                      Credit Card
                    </button>
                    <button
                      type="button"
                      className={`add-card-type-pill ${formData.type === "debit" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        handleFormChange("type", "debit");
                      }}
                    >
                      Debit Card
                    </button>
                  </div>
                </div>
              )}

            {selectedProvider.category === "cash" && (
              <div className="add-card-field">
                <label className="add-card-input-lbl">Currency</label>
                <div className="cash-currency-grid">
                  {CASH_CURRENCIES.map((curr) => {
                    const isSelected =
                      String(formData.currency || "BDT").toUpperCase() ===
                      curr.code;
                    return (
                      <button
                        key={curr.code}
                        type="button"
                        className={`cash-currency-pill ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({
                            ...prev,
                            currency: curr.code,
                            color: curr.bg,
                            gradient: curr.bg,
                            number: `CASH-${curr.code}`,
                            subtitle: `Cash in hand · ${curr.code}`,
                          }));
                        }}
                      >
                        <span
                          className="cash-currency-swatch"
                          style={{
                            background: curr.bg,
                            color: curr.accent,
                          }}
                        >
                          {curr.symbol}
                        </span>
                        <span className="cash-currency-code">{curr.code}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedProvider.id === "custom" && (
              <div className="add-card-field">
                <label className="add-card-input-lbl">Bank / Card Name</label>
                <input
                  name="cardName"
                  className="add-card-native-input"
                  type="text"
                  maxLength={30}
                  placeholder="e.g. Chase Sapphire, Revolut, HSBC"
                  value={formData.name}
                  onChange={(e) => handleFormChange("name", e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                />
              </div>
            )}

            {selectedProvider.id === "custom" && (
              <div className="add-card-field">
                <label className="add-card-input-lbl">
                  Card Theme &amp; Color
                </label>
                <div className="card-options-theme-grid">
                  {CARD_THEMES.map((theme) => {
                    const isSelected =
                      (formData.gradient || selectedProvider.gradient) ===
                      theme.gradient;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        className={`card-options-theme-swatch ${isSelected ? "is-selected" : ""}`}
                        style={{ background: theme.gradient }}
                        title={theme.name}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({
                            ...prev,
                            color: theme.color,
                            gradient: theme.gradient,
                          }));
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="add-card-field">
              <label className="add-card-input-lbl">
                {selectedProvider.category === "cash"
                  ? "Wallet Label"
                  : "Card Holder Name"}
              </label>
              <input
                name="cardHolderName"
                className="add-card-native-input"
                type="text"
                maxLength={30}
                placeholder={
                  selectedProvider.category === "cash"
                    ? "Cash wallet"
                    : userProfileName || "John Smith"
                }
                value={formData.holderName}
                onChange={(e) => handleFormChange("holderName", e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
              />
            </div>

            {selectedProvider.category !== "cash" && (
              <div className="add-card-field">
                <label className="add-card-input-lbl">
                  {selectedProvider.isPhone ? "Mobile Number" : "Last 4 Digits"}
                </label>
                <input
                  name="cardNumber"
                  className="add-card-native-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={selectedProvider.isPhone ? 11 : 4}
                  placeholder={
                    selectedProvider.isPhone
                      ? (
                          selectedProvider.numberPlaceholder || "01712345678"
                        ).replace(/\s+/g, "")
                      : "e.g. 9018"
                  }
                  value={
                    selectedProvider.isPhone
                      ? formData.number
                      : formData.last4 || formData.number
                  }
                  onChange={(e) => handleCardNumberChange(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                />
              </div>
            )}

            {!selectedProvider.isPhone &&
              selectedProvider.category !== "savings" &&
              selectedProvider.category !== "cash" && (
                <div className="add-card-field">
                  <label className="add-card-input-lbl">Expiry (MM/YY)</label>
                  <input
                    name="cardExpiry"
                    className="add-card-native-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="11/25"
                    maxLength={5}
                    value={formData.expiry}
                    onChange={(e) => handleExpiryChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>
              )}

            <div className="add-card-field">
              <label className="add-card-input-lbl">Starting Balance</label>
              <div className="add-card-balance-input-wrap">
                <span className="add-card-curr-prefix">
                  {selectedProvider.category === "cash"
                    ? getCashCurrencyMeta(formData.currency).symbol
                    : "৳"}
                </span>
                <input
                  name="cardStartingBalance"
                  type="text"
                  className="add-card-native-input add-card-balance-input"
                  inputMode="decimal"
                  enterKeyHint="done"
                  aria-label="Starting balance"
                  placeholder="0.00"
                  value={formData.initialBalance}
                  onChange={(e) => {
                    let next = e.target.value
                      .replace(/,/g, ".")
                      .replace(/[^0-9.]/g, "");
                    if (next.startsWith(".")) {
                      next = "0" + next;
                    }
                    next = next.replace(/^0+(?=\d)/, "");
                    const firstDot = next.indexOf(".");
                    if (firstDot !== -1) {
                      const intPart = next.slice(0, firstDot).slice(0, 9);
                      const decPart = next
                        .slice(firstDot + 1)
                        .replace(/\./g, "")
                        .slice(0, 2);
                      next = `${intPart}.${decPart}`;
                    } else {
                      next = next.slice(0, 9);
                    }
                    handleFormChange("initialBalance", next);
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                />
              </div>
            </div>

            <button
              className="add-card-submit-cta"
              type="button"
              onClick={handleSubmitCard}
            >
              Add Card
            </button>

            <p className="add-card-safe-disclaimer">
              🔒 <b>Privacy Notice:</b> Spend is a client-side personal expense
              tracker. Data is stored on your device. Never enter real CVV, PIN,
              or full card credentials.
            </p>
          </div>
        </div>
      )}

      {/* ──── Step 3: Success Confirmation Modal matching video ──── */}
      {step === "success" && (
        <div className="add-card-success-sheet">
          <div className="add-card-success-card">
            {/* Animated circular blue checkmark matching video */}
            <div className="add-card-success-icon-wrap">
              <svg viewBox="0 0 80 80" className="add-card-success-svg">
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  className="add-card-success-ring"
                />
                <path
                  d="M26 40 L35 50 L55 28"
                  className="add-card-success-check"
                />
              </svg>
            </div>

            <h3 className="add-card-success-title">
              Your card has been added successfully
            </h3>
            <p className="add-card-success-desc">
              We will notify you about your activities via email
            </p>

            <button
              type="button"
              className="add-card-home-cta"
              onClick={onClose}
            >
              View Cards
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ConfirmationModal({
  isOpen,
  title = "Are you sure?",
  message = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  isDestructive = true,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="confirm-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        className="confirm-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="confirm-modal-icon-badge">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>

        <h3 id="confirm-modal-title" className="confirm-modal-title">
          {title}
        </h3>
        <p className="confirm-modal-message">{message}</p>

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn is-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn ${isDestructive ? "is-destructive" : "is-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
function ResetPinModal({ isOpen, onConfirm, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="reset-pin-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        className="reset-pin-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-pin-modal-title"
      >
        <div className="reset-pin-icon-badge">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <circle cx="12" cy="10" r="2.5" />
            <path d="M12 12.5V16" />
          </svg>
        </div>

        <h3 id="reset-pin-modal-title" className="reset-pin-modal-title">
          Reset App PIN?
        </h3>
        <p className="reset-pin-modal-message">
          This will remove your passcode and clear local data. Synced cloud data
          remains safe.
        </p>

        <div className="reset-pin-modal-actions">
          <button
            type="button"
            className="reset-pin-btn is-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="reset-pin-btn is-destructive"
            onClick={onConfirm}
          >
            Reset PIN
          </button>
        </div>
      </div>
    </div>
  );
}

function CardOptionsSheet({
  initialCardId,
  cards = [],
  balances = {},
  startBalances = {},
  onClose,
  onUpdateCard,
  onDeleteCard,
  onAddCardClick,
  onAdjustBalance,
  onSyncCashBalance,
  onSetPrimaryCard,
  onMoveCardToFront,
  onSelectCard,
  onToast,
}) {
  const [selectedId, setSelectedId] = useState(
    () => initialCardId || cards[0]?.id || "",
  );

  useEffect(() => {
    if (cards.length === 0) return;
    if (!selectedId || !cards.some((c) => c.id === selectedId)) {
      setSelectedId(cards[0].id);
    }
  }, [cards, selectedId]);

  useEffect(() => {
    if (initialCardId && cards.some((c) => c.id === initialCardId)) {
      setSelectedId(initialCardId);
    }
  }, [initialCardId, cards]);

  const selectedCard =
    cards.find((c) => c.id === selectedId) || cards[0] || null;

  const isMfs =
    selectedCard?.category === "mfs" ||
    selectedCard?.type === "mfs" ||
    selectedCard?.network === "mfs" ||
    selectedCard?.provider === "bkash" ||
    selectedCard?.provider === "nagad" ||
    selectedCard?.provider === "rocket" ||
    Boolean(selectedCard?.isPhone);

  const isSavings =
    selectedCard?.category === "savings" ||
    selectedCard?.type === "savings" ||
    selectedCard?.provider === "savings" ||
    String(selectedCard?.number || "").startsWith("SAV-") ||
    String(selectedCard?.number || "").startsWith("VAULT-") ||
    String(selectedCard?.number || "").startsWith("DPS-");

  const isCash =
    selectedCard?.id === "cash" ||
    selectedCard?.category === "cash" ||
    selectedCard?.type === "cash" ||
    selectedCard?.provider === "cash";

  const isCard = !isMfs && !isSavings && !isCash;
  const isGoldMc =
    selectedCard?.provider === "gold_mc" ||
    /^gold\s+master\s*card$/i.test(String(selectedCard?.name || "").trim());
  const initialCardBal =
    (selectedCard?.id != null ? startBalances[selectedCard.id] : undefined) ??
    selectedCard?.initialBalance;

  const getEditableCardNumber = (card, mfsFlag) => {
    const rawNum = String(card?.number || "");
    if (!mfsFlag) return rawNum;
    if (rawNum.includes("•")) {
      const l4 = card?.last4 || rawNum.replace(/\D/g, "").slice(-4) || "";
      return l4;
    }
    return rawNum.replace(/\D/g, "").slice(0, 11);
  };

  const [formData, setFormData] = useState({
    name: selectedCard?.name || "",
    holderName: selectedCard?.holderName || "Cardholder",
    subtitle: selectedCard?.subtitle || "",
    currency: String(selectedCard?.currency || "BDT").toUpperCase(),
    last4:
      selectedCard?.last4 ||
      (selectedCard?.number
        ? selectedCard.number.replace(/\D/g, "").slice(-4)
        : ""),
    number: getEditableCardNumber(selectedCard, isMfs),
    expiry: selectedCard?.expiry || "",
    network: selectedCard?.network || "visa",
    type: selectedCard?.type || "credit",
    color: selectedCard?.color || "#1e293b",
    gradient:
      selectedCard?.gradient ||
      "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
    initialBalance:
      initialCardBal !== undefined && initialCardBal !== null
        ? String(initialCardBal)
        : "",
  });

  const [showSecrets, setShowSecrets] = useState(false);
  const [isFrozen, setIsFrozen] = useState(() => Boolean(selectedCard?.frozen));
  const [copied, setCopied] = useState(false);
  const [cashSyncInput, setCashSyncInput] = useState("");
  const copyTimerRef = useRef(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    if (selectedCard) {
      const cardBal =
        (selectedCard.id != null
          ? startBalances[selectedCard.id]
          : undefined) ?? selectedCard.initialBalance;
      const mfsCard =
        selectedCard.category === "mfs" ||
        selectedCard.type === "mfs" ||
        selectedCard.network === "mfs" ||
        selectedCard.provider === "bkash" ||
        selectedCard.provider === "nagad" ||
        selectedCard.provider === "rocket" ||
        Boolean(selectedCard.isPhone);
      const goldMcCard =
        selectedCard.provider === "gold_mc" ||
        /^gold\s+master\s*card$/i.test(String(selectedCard.name || "").trim());
      setFormData({
        name: selectedCard.name || "",
        holderName: selectedCard.holderName || "Cardholder",
        subtitle: selectedCard.subtitle || "",
        currency: String(selectedCard.currency || "BDT").toUpperCase(),
        last4:
          selectedCard.last4 ||
          (selectedCard.number
            ? selectedCard.number.replace(/\D/g, "").slice(-4)
            : ""),
        number: getEditableCardNumber(selectedCard, mfsCard),
        expiry: selectedCard.expiry || "",
        network: goldMcCard ? "mastercard" : selectedCard.network || "visa",
        type: selectedCard.type || "credit",
        color: selectedCard.color || "#1e293b",
        gradient:
          selectedCard.gradient ||
          "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
        initialBalance:
          cardBal !== undefined && cardBal !== null ? String(cardBal) : "",
      });
      setIsFrozen(Boolean(selectedCard.frozen));
      setCashSyncInput("");
      setConfirmDeleteOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard?.id, selectedCard?.updatedAt, initialCardBal]);

  const previewCard = useMemo(() => {
    if (!selectedCard) return null;
    return {
      ...selectedCard,
      name: formData.name || selectedCard.name,
      holderName: formData.holderName || selectedCard.holderName,
      subtitle: formData.subtitle || selectedCard.subtitle,
      currency: isCash
        ? String(formData.currency || "BDT").toUpperCase()
        : selectedCard.currency,
      network: isGoldMc
        ? "mastercard"
        : formData.network || selectedCard.network,
      type: formData.type || selectedCard.type,
      gradient: formData.gradient,
      color: formData.color,
      last4:
        formData.last4 || (formData.number ? formData.number.slice(-4) : ""),
      number:
        isMfs || isSavings || isCash
          ? formData.number || selectedCard.number
          : formData.last4
            ? `•••• •••• •••• ${formData.last4}`
            : formData.number,
      expiry: formData.expiry,
      frozen: isFrozen,
    };
  }, [selectedCard, formData, isFrozen, isMfs, isSavings, isCash]);

  const handleCardNumberChange = (raw) => {
    if (isMfs) {
      const digits = raw.replace(/\D/g, "").slice(0, 11);
      setFormData((prev) => ({
        ...prev,
        number: digits,
        last4: digits.slice(-4),
      }));
    } else {
      const digits = raw.replace(/\D/g, "").slice(0, 4);
      setFormData((prev) => ({
        ...prev,
        last4: digits,
        number: `•••• •••• •••• ${digits}`,
      }));
    }
  };

  const handleExpiryChange = (raw) => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) {
      setFormData((prev) => ({ ...prev, expiry: digits }));
    } else {
      setFormData((prev) => ({
        ...prev,
        expiry: `${digits.slice(0, 2)}/${digits.slice(2, 4)}`,
      }));
    }
  };

  const handleCopyNumber = () => {
    triggerHaptic("success");
    const raw = String(
      formData.last4 ||
        formData.number ||
        selectedCard?.last4 ||
        selectedCard?.number ||
        "",
    ).trim();
    const toCopy = raw.includes("•") ? raw : raw.replace(/\s+/g, "");
    const fallbackCopy = (text) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText =
          "position:fixed;opacity:0;pointer-events:none;left:-9999px;top:0;font-size:16px;";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // ignore
      }
    };
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(toCopy).catch(() => fallbackCopy(toCopy));
    } else {
      fallbackCopy(toCopy);
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
    onToast?.("Copied to your clipboard");
  };

  const handleToggleFreeze = () => {
    if (!selectedCard) return;
    triggerHaptic("warning");
    const nextFrozen = !isFrozen;
    setIsFrozen(nextFrozen);
    onUpdateCard?.(
      {
        ...selectedCard,
        frozen: nextFrozen,
        id: selectedCard.id,
      },
      nextFrozen ? "Card locked" : "Card unlocked",
    );
  };

  const handleSave = () => {
    if (!selectedCard) return;
    if (isCard && formData.expiry.trim()) {
      const expMatch = formData.expiry
        .trim()
        .match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
      if (!expMatch) {
        triggerHaptic("warning");
        onToast?.("Enter a valid expiry date (MM/YY).");
        return;
      }
    }
    triggerHaptic("success");
    const trimmed = String(formData.initialBalance ?? "").trim();
    const rawBal = trimmed !== "" ? parseAmount(trimmed) : 0;
    const parsedInitial =
      Number.isFinite(rawBal) && rawBal >= 0 ? rawBal : undefined;
    const { initialBalance: _initBal, ...safeFormData } = formData;
    const cleanedName = safeFormData.name.trim() || selectedCard.name || "Card";
    const cleanedHolder =
      safeFormData.holderName.trim() || selectedCard.holderName || "Cardholder";
    const mfsDigits = isMfs
      ? String(safeFormData.number || "").replace(/\D/g, "")
      : "";
    const resolvedNumber = isMfs
      ? mfsDigits.length >= 10
        ? mfsDigits.slice(0, 11)
        : mfsDigits.length > 0
          ? `01••• •••${mfsDigits.slice(-4)}`
          : selectedCard.number
      : safeFormData.number;
    const resolvedLast4 = isMfs
      ? mfsDigits.slice(-4) || selectedCard.last4 || ""
      : safeFormData.last4;
    onUpdateCard?.({
      ...selectedCard,
      ...safeFormData,
      name: cleanedName,
      holderName: cleanedHolder,
      number: resolvedNumber,
      last4: resolvedLast4,
      ...(parsedInitial !== undefined ? { initialBalance: parsedInitial } : {}),
      frozen: isFrozen,
      id: selectedCard.id,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!selectedCard) return;
    triggerHaptic("warning");
    const deletingId = selectedCard.id;
    onDeleteCard?.(deletingId);
    onClose();
  };

  return (
    <Sheet onClose={onClose}>
      <div className="card-options-sheet-container">
        {/* Top Header */}
        <div className="card-options-sheet-header">
          <div className="card-options-header-text">
            <h3 id="sheet-title">Card Options</h3>
            <span className="card-options-subhead">
              Manage and customize your cards
            </span>
          </div>
        </div>

        {/* Card Selector Pills Track */}
        <div className="card-options-switcher-wrap">
          <div className="card-options-switcher-track">
            {cards.map((c) => {
              const isCurrent = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`card-options-pill ${isCurrent ? "is-selected" : ""}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    setSelectedId(c.id);
                    onSelectCard?.(c.id);
                  }}
                >
                  <span
                    className="card-options-pill-dot"
                    style={{ background: c.color || "#2563eb" }}
                  />
                  <span className="card-options-pill-name">
                    {c.name}
                    {c.isPrimary ? " ★" : ""}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className="card-options-pill is-add-pill"
              onClick={() => {
                triggerHaptic("light");
                onAddCardClick?.();
              }}
            >
              + Add Card
            </button>
          </div>
        </div>

        {/* Hero Card & Quick Actions Bar - Perfectly Aligned & Compact */}
        <div className="card-options-card-hero">
          {previewCard && (
            <div className="card-options-live-card-wrap">
              <WalletCard
                card={previewCard}
                balance={balances[previewCard.id] || 0}
                isActive={true}
                interactive={false}
                showBalance={true}
                showFullDetails={showSecrets}
              />
            </div>
          )}

          {/* Quick Action Badges Bar */}
          <div className="card-options-quick-bar">
            <div className="card-options-quick-row">
              {!isCash && (
                <>
                  <button
                    type="button"
                    className={`card-options-bar-btn ${showSecrets ? "is-active" : ""}`}
                    onClick={() => {
                      triggerHaptic("selection");
                      setShowSecrets((prev) => !prev);
                    }}
                    aria-label={
                      showSecrets ? "Hide card details" : "Show card details"
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {showSecrets ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                    <span>{showSecrets ? "Hide" : "Details"}</span>
                  </button>

                  <button
                    type="button"
                    className={`card-options-bar-btn ${copied ? "is-copied" : ""}`}
                    onClick={handleCopyNumber}
                    aria-label={
                      copied
                        ? "Copied card number"
                        : "Copy card number to clipboard"
                    }
                  >
                    {copied ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="card-options-icon-check"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="13"
                          height="13"
                          rx="2"
                          ry="2"
                        />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                className={`card-options-bar-btn ${isFrozen ? "is-frozen" : ""}`}
                onClick={handleToggleFreeze}
                aria-label={isFrozen ? "Unlock card" : "Lock card"}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>{isFrozen ? "Locked" : "Lock"}</span>
              </button>
            </div>

            {(!isSavings ||
              (cards.length > 1 && cards[0]?.id !== selectedCard?.id)) && (
              <div className="card-options-quick-row is-wallet-row">
                {!isSavings && (
                  <button
                    type="button"
                    className={`card-options-bar-btn ${selectedCard?.isPrimary ? "is-primary-card" : ""}`}
                    onClick={() => {
                      if (selectedCard?.id) {
                        triggerHaptic("success");
                        onSetPrimaryCard?.(selectedCard.id);
                      }
                    }}
                    aria-label={
                      selectedCard?.isPrimary
                        ? "Primary card (Tap to undo)"
                        : "Set as primary card"
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill={selectedCard?.isPrimary ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>
                      {selectedCard?.isPrimary
                        ? "Primary Card ★"
                        : "Set as Primary"}
                    </span>
                  </button>
                )}

                {cards.length > 1 && cards[0]?.id !== selectedCard?.id && (
                  <button
                    type="button"
                    className="card-options-bar-btn"
                    onClick={() => {
                      if (selectedCard?.id) {
                        triggerHaptic("selection");
                        onSelectCard?.(selectedCard.id);
                        onMoveCardToFront?.(selectedCard.id);
                      }
                    }}
                    aria-label="Move card to front of deck"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                    <span>Move to Top</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Card Details & Editing Section */}
        <div className="card-options-edit-section">
          <h4 className="card-options-section-title">
            {isCash ? "Edit Cash Wallet" : "Edit Card Details"}
          </h4>

          <div className="card-options-form-grid">
            {isCash && (
              <>
                <div className="card-options-field">
                  <label>Wallet Name</label>
                  <input
                    name="cashHolderName"
                    type="text"
                    value={formData.holderName}
                    placeholder="Cash wallet"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        holderName: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="card-options-field">
                  <label>Currency</label>
                  <div className="cash-currency-grid">
                    {CASH_CURRENCIES.map((curr) => {
                      const isSelected =
                        String(formData.currency || "BDT").toUpperCase() ===
                        curr.code;
                      return (
                        <button
                          key={curr.code}
                          type="button"
                          className={`cash-currency-pill ${isSelected ? "is-selected" : ""}`}
                          onClick={() => {
                            triggerHaptic("selection");
                            setFormData((prev) => ({
                              ...prev,
                              currency: curr.code,
                              color: curr.bg,
                              gradient: curr.bg,
                              number: `CASH-${curr.code}`,
                              subtitle: `Cash in hand · ${curr.code}`,
                            }));
                          }}
                        >
                          <span
                            className="cash-currency-swatch"
                            style={{
                              background: curr.bg,
                              color: curr.accent,
                            }}
                          >
                            {curr.symbol}
                          </span>
                          <span className="cash-currency-code">
                            {curr.code}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {/* If regular card (Visa, Mastercard, Amex, Bank, Custom) */}
            {isCard && (
              <>
                {!isGoldMc && (
                  <div className="card-options-field">
                    <label>Card Network</label>
                    <div className="add-card-network-selector">
                      <button
                        type="button"
                        className={`add-card-network-btn ${formData.network === "visa" ? "is-selected" : ""}`}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({ ...prev, network: "visa" }));
                        }}
                      >
                        <VisaBadge width={44} height={17} variant="adaptive" />
                        <span>Visa</span>
                      </button>

                      <button
                        type="button"
                        className={`add-card-network-btn ${formData.network === "mastercard" ? "is-selected" : ""}`}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({
                            ...prev,
                            network: "mastercard",
                          }));
                        }}
                      >
                        <MastercardBadge width={30} height={20} />
                        <span>Mastercard</span>
                      </button>

                      <button
                        type="button"
                        className={`add-card-network-btn ${formData.network === "amex" ? "is-selected" : ""}`}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({ ...prev, network: "amex" }));
                        }}
                      >
                        <AmexBadge width={34} height={17} />
                        <span>Amex</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="card-options-field">
                  <label>Card Type</label>
                  <div className="add-card-type-toggle">
                    <button
                      type="button"
                      className={`add-card-type-pill ${formData.type === "credit" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        setFormData((prev) => ({ ...prev, type: "credit" }));
                      }}
                    >
                      Credit Card
                    </button>
                    <button
                      type="button"
                      className={`add-card-type-pill ${formData.type === "debit" ? "is-selected" : ""}`}
                      onClick={() => {
                        triggerHaptic("selection");
                        setFormData((prev) => ({ ...prev, type: "debit" }));
                      }}
                    >
                      Debit Card
                    </button>
                  </div>
                </div>

                <div className="card-options-field">
                  <label>Card Display Name</label>
                  <input
                    name="editCardName"
                    type="text"
                    value={formData.name}
                    placeholder="e.g. Amazon Platinum"
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Cardholder Name</label>
                  <input
                    name="editCardHolderName"
                    type="text"
                    value={formData.holderName}
                    placeholder="e.g. John Smith"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        holderName: e.target.value,
                      }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>
                    {isMfs ? "Phone / Account Number" : "Last 4 Digits"}
                  </label>
                  <input
                    name="editCardNumber"
                    type="text"
                    inputMode={isMfs ? "tel" : "numeric"}
                    placeholder={isMfs ? "01712 •••678" : "9018"}
                    maxLength={isMfs ? 16 : 4}
                    value={isMfs ? formData.number || "" : formData.last4 || ""}
                    onChange={(e) => handleCardNumberChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Expiry (MM/YY)</label>
                  <input
                    name="editCardExpiry"
                    type="text"
                    inputMode="numeric"
                    placeholder="12/28"
                    maxLength={5}
                    value={formData.expiry}
                    onChange={(e) => handleExpiryChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Card Tag / Subtitle</label>
                  <input
                    name="editCardSubtitle"
                    type="text"
                    value={formData.subtitle}
                    placeholder="e.g. Platinum Credit, Premium Visa"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        subtitle: e.target.value,
                      }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>
              </>
            )}

            {/* If MFS account (bKash, Nagad, Rocket, Phone) */}
            {isMfs && (
              <>
                <div className="card-options-field">
                  <label>Account / Wallet Name</label>
                  <input
                    name="editMfsName"
                    type="text"
                    value={formData.name}
                    placeholder="e.g. bKash, Nagad"
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Account Holder Name</label>
                  <input
                    name="editMfsHolderName"
                    type="text"
                    value={formData.holderName}
                    placeholder="e.g. John Smith"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        holderName: e.target.value,
                      }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Mobile Number</label>
                  <input
                    name="editMfsNumber"
                    type="text"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="01712345678"
                    value={formData.number}
                    onChange={(e) => handleCardNumberChange(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="card-options-field">
                  <label>Account Tag / Subtitle</label>
                  <input
                    name="editMfsSubtitle"
                    type="text"
                    value={formData.subtitle}
                    placeholder="e.g. Personal Wallet"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        subtitle: e.target.value,
                      }))
                    }
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                  />
                </div>
              </>
            )}

            {/* If Savings Vault */}
            {isSavings && (
              <>
                <div className="card-options-field">
                  <label>Vault Display Name</label>
                  <input
                    name="editSavingsName"
                    type="text"
                    value={formData.name}
                    placeholder="e.g. Savings Vault"
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>

                <div className="card-options-field">
                  <label>Account Holder Name</label>
                  <input
                    name="editSavingsHolderName"
                    type="text"
                    value={formData.holderName}
                    placeholder="e.g. Personal Savings"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        holderName: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="card-options-field">
                  <label>Vault Account Number / ID</label>
                  <input
                    name="editSavingsNumber"
                    type="text"
                    value={formData.number}
                    placeholder="SAV-4710"
                    onChange={(e) => {
                      const val = e.target.value;
                      const rawNum = val.replace(/\D/g, "");
                      setFormData((prev) => ({
                        ...prev,
                        number: val,
                        last4: rawNum ? rawNum.slice(-4) : "",
                      }));
                    }}
                  />
                </div>

                <div className="card-options-field">
                  <label>Tag / Subtitle</label>
                  <input
                    name="editSavingsSubtitle"
                    type="text"
                    value={formData.subtitle}
                    placeholder="e.g. Personal Savings"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        subtitle: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            )}

            {/* Theme & Color Swatches (driven by currency for Cash) */}
            {!isCash && (
              <div className="card-options-field">
                <label>Card Theme &amp; Color</label>
                <div className="card-options-theme-grid">
                  {CARD_THEMES.map((theme) => {
                    const isSelected = formData.gradient === theme.gradient;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        className={`card-options-theme-swatch ${isSelected ? "is-selected" : ""}`}
                        style={{ background: theme.gradient }}
                        title={theme.name}
                        onClick={() => {
                          triggerHaptic("selection");
                          setFormData((prev) => ({
                            ...prev,
                            color: theme.color,
                            gradient: theme.gradient,
                          }));
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Starting Balance Field */}
            <div className="card-options-field">
              <label>Opening Balance (Starting Balance)</label>
              <div className="add-card-balance-input-wrap">
                <span className="add-card-curr-prefix">
                  {isCash ? getCashCurrencyMeta(formData.currency).symbol : "৳"}
                </span>
                <input
                  name="editOpeningBalance"
                  type="text"
                  className="add-card-native-input add-card-balance-input"
                  inputMode="decimal"
                  enterKeyHint="done"
                  aria-label="Opening balance"
                  placeholder="0.00"
                  value={formData.initialBalance}
                  onChange={(e) => {
                    let next = e.target.value
                      .replace(/,/g, ".")
                      .replace(/[^0-9.]/g, "");
                    if (next.startsWith(".")) {
                      next = "0" + next;
                    }
                    next = next.replace(/^0+(?=\d)/, "");
                    const firstDot = next.indexOf(".");
                    if (firstDot !== -1) {
                      next =
                        next.slice(0, firstDot + 1) +
                        next
                          .slice(firstDot + 1)
                          .replace(/\./g, "")
                          .slice(0, 2);
                    }
                    setFormData((prev) => ({
                      ...prev,
                      initialBalance: next,
                    }));
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Set Cash on Hand Reconciliation Box */}
        {isCash && (
          <div
            className={`cash-sync-box ${(balances[selectedCard?.id] || 0) < 0 ? "is-overdrawn" : ""}`}
          >
            <div className="card-options-balance-info">
              <span className="card-options-balance-lbl">
                {(balances[selectedCard?.id] || 0) < 0
                  ? "Unreconciled Cash · Set Exact Cash on Hand"
                  : "Set Exact Cash on Hand"}
              </span>
            </div>
            <div className="cash-sync-input-row">
              <input
                name="exactCashBalance"
                type="text"
                inputMode="decimal"
                aria-label="Exact cash on hand"
                placeholder={`Enter actual ${getCashCurrencyMeta(formData.currency).code} cash (e.g. 0)`}
                value={cashSyncInput}
                onChange={(e) => {
                  const next = e.target.value
                    .replace(/,/g, ".")
                    .replace(/[^0-9.]/g, "");
                  setCashSyncInput(next);
                }}
              />
              <button
                type="button"
                className="card-options-adj-btn"
                onClick={() => {
                  const targetAmt = parseAmount(cashSyncInput);
                  if (!Number.isFinite(targetAmt) || targetAmt < 0) {
                    triggerHaptic("warning");
                    onToast?.("Enter a valid non-negative cash amount.");
                    return;
                  }
                  const currentBal = Number(balances[selectedCard?.id] || 0);
                  const diff = Math.round((targetAmt - currentBal) * 100) / 100;
                  if (Math.abs(diff) < 0.01) {
                    onToast?.("Cash balance already matches.");
                    return;
                  }
                  triggerHaptic("success");
                  onSyncCashBalance?.(selectedCard.id, diff);
                  setCashSyncInput("");
                }}
              >
                Sync Cash
              </button>
            </div>
          </div>
        )}

        {/* Quick Balance Adjustment Shortcut */}
        <div className="card-options-balance-row">
          <div className="card-options-balance-info">
            <span className="card-options-balance-lbl">Available Balance</span>
            <b className="card-options-balance-num">
              {isCash
                ? formatCashMoney(
                    balances[selectedCard?.id] || 0,
                    formData.currency,
                  )
                : formatMoney(balances[selectedCard?.id] || 0)}
            </b>
          </div>
          <button
            type="button"
            className="card-options-adj-btn"
            onClick={() => {
              onAdjustBalance?.(selectedCard?.id);
            }}
          >
            Adjust Balance
          </button>
        </div>

        {/* Footer Actions: Save Changes & Remove Card */}
        <div className="card-options-sheet-actions">
          <button
            type="button"
            className="card-options-save-cta"
            onClick={handleSave}
          >
            Save Changes
          </button>

          <button
            type="button"
            className="card-options-delete-cta"
            onClick={() => {
              triggerHaptic("warning");
              setConfirmDeleteOpen(true);
            }}
          >
            Remove This Card
          </button>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmDeleteOpen}
        title="Remove Card?"
        message={`Are you sure you want to remove "${selectedCard?.name || "this card"}"? This card will be removed from your wallet.`}
        confirmLabel="Yes, Remove"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          handleDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </Sheet>
  );
}

function compressAvatarImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Choose a valid image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image."));
      img.onload = () => {
        try {
          const size = 192;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas unavailable."));
            return;
          }
          const minSide = Math.min(img.width, img.height);
          const sx = Math.max(0, (img.width - minSide) / 2);
          const sy = Math.max(0, (img.height - minSide) / 2);
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          let dataUrl = canvas.toDataURL("image/webp", 0.84);
          if (!dataUrl.startsWith("data:image/webp")) {
            dataUrl = canvas.toDataURL("image/jpeg", 0.84);
          }
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function ProfileSettingsPage({
  S,
  profile,
  cloudSyncEnabled,
  cloudSyncReady,
  normalizedAccountSync,
  cloudRealtimeStatus,
  cloudSyncActivity,
  accountStatus,
  profileStatus,
  authBusy,
  onEditProfile,
  onAvatarChange,
  onManageCards,
  onSignIn,
  onSignOut,
  onResumeSync,
}) {
  const fileInputRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const isOffline =
    cloudSyncActivity === "offline" || cloudRealtimeStatus === "offline";
  const hasSyncError = cloudSyncActivity === "error";
  const needsSyncSetup = cloudSyncReady && !normalizedAccountSync;
  const isSyncing =
    profile?.connected &&
    cloudSyncEnabled &&
    !isOffline &&
    !hasSyncError &&
    (cloudSyncActivity === "syncing" || !cloudSyncReady);
  const isLive =
    profile?.connected &&
    cloudSyncEnabled &&
    cloudSyncReady &&
    normalizedAccountSync &&
    cloudRealtimeStatus === "live" &&
    !isOffline &&
    !hasSyncError &&
    cloudSyncActivity !== "syncing";

  const syncLabel = (() => {
    if (!profile?.connected) return "Local only";
    if (!cloudSyncEnabled) return "Sync paused";
    if (isOffline) return "Offline";
    if (hasSyncError) return "Sync issue";
    if (needsSyncSetup) return "Setup required";
    if (isSyncing) return "Syncing…";
    if (isLive) return "Live sync";
    if (cloudRealtimeStatus === "reconnecting") return "Reconnecting…";
    return "Cloud sync on";
  })();

  const cards = Array.isArray(S?.cards) ? S.cards : [];
  const primaryCard = cards.find((c) => c.isPrimary) || cards[0] || null;

  const handlePickPhotoClick = () => {
    triggerHaptic("selection");
    setPhotoError("");
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const dataUrl = await compressAvatarImage(file);
      await onAvatarChange?.(dataUrl);
      triggerHaptic("success");
    } catch (err) {
      triggerHaptic("warning");
      setPhotoError(err?.message || "Could not process this photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    triggerHaptic("delete");
    setPhotoError("");
    await onAvatarChange?.("");
  };

  return (
    <div className="mfs-profile-page">
      <input
        name="profilePhotoFile"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Upload profile photo"
        hidden
        onChange={handleFileChange}
      />

      {/* Hero Identity Card */}
      <section className="card mfs-profile-hero-card">
        <div className="mfs-profile-hero-top">
          <div className="mfs-profile-hero-avatar-wrap">
            <button
              type="button"
              className={`mfs-profile-hero-avatar${profile?.avatar ? " has-photo" : ""}`}
              onClick={handlePickPhotoClick}
              disabled={photoBusy}
              aria-label="Change profile picture"
            >
              {profile?.avatar ? (
                <img
                  src={profile.avatar}
                  alt=""
                  className="mfs-avatar-img"
                  draggable="false"
                />
              ) : (
                <span>{profile?.initial || "S"}</span>
              )}
            </button>
            <button
              type="button"
              className="mfs-profile-camera-badge"
              onClick={handlePickPhotoClick}
              disabled={photoBusy}
              aria-label="Upload profile photo"
              title="Upload profile photo"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
          </div>

          <div className="mfs-profile-hero-meta">
            <div className="mfs-profile-hero-name-row">
              <h2 className="mfs-profile-hero-name">
                {profile?.name || "Local profile"}
              </h2>
              <span
                className={`mfs-profile-status-pill${profile?.connected ? " is-synced" : ""}`}
              >
                <span className="mfs-profile-status-dot" aria-hidden="true" />
                {profile?.connected ? "Synced" : "Local"}
              </span>
            </div>
            <p className="mfs-profile-hero-sub">
              {photoBusy
                ? "Optimizing profile photo…"
                : profile?.email ||
                  "Tap avatar to add a photo · Sign in to sync across devices"}
            </p>
            {profile?.avatar && (
              <div className="mfs-profile-hero-photo-actions">
                <button
                  type="button"
                  className="mfs-profile-remove-photo-btn"
                  disabled={photoBusy}
                  onClick={handleRemovePhoto}
                >
                  Remove photo
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Personal Details Section */}
      <section className="card app-settings-card mfs-card-list">
        <h2>Personal details</h2>
        <div className="mfs-card-rows">
          <button
            className="ri settings-action mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              onEditProfile?.();
            }}
          >
            <i className="ic mfs-row-icon" style={{ "--c": "#6366f1" }}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </i>
            <span className="nm">
              <b>Display name</b>
              <small>
                {profile?.hasName
                  ? profile.name
                  : "Set your name for greetings & cards"}
              </small>
            </span>
            <span className="mfs-status-pill">Edit</span>
          </button>

          <button
            className="ri settings-action mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              onManageCards?.();
            }}
          >
            <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="5" width="20" height="14" rx="3" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </i>
            <span className="nm">
              <b>Primary payment</b>
              <small>
                {primaryCard
                  ? `${primaryCard.name}${primaryCard.last4 ? ` •••• ${primaryCard.last4}` : ""}`
                  : "Cash wallet (default)"}
              </small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>
        </div>
        {(photoError || profileStatus) && (
          <p
            className="settings-status mfs-card-footnote"
            role="status"
            aria-live="polite"
          >
            {photoError || profileStatus}
          </p>
        )}
      </section>

      {/* Cloud & Account Sync Section */}
      <section className="card app-settings-card mfs-card-list">
        <h2>Cloud &amp; account sync</h2>
        <div className="mfs-card-rows">
          <div className="ri mfs-list-row">
            <i
              className="ic mfs-row-icon"
              style={{ "--c": profile?.connected ? "#10b981" : "#64748b" }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
            </i>
            <span className="nm">
              <b>Cloud backup &amp; sync</b>
              <small>
                {profile?.connected
                  ? S?.outboxPending
                    ? "Offline outbox queued · Auto-flushes on reconnect"
                    : "Expenses, cards, budgets & profile photo"
                  : "Sign in to back up & sync across devices"}
              </small>
            </span>
            <div
              className={`profile-sync-status mfs-sync-badge${isLive ? " is-live" : ""}${
                isSyncing ? " is-syncing" : ""
              }${hasSyncError ? " has-error" : ""}${isOffline ? " is-offline" : ""}${
                needsSyncSetup ? " is-setup-needed" : ""
              }`}
              data-sync-state={
                isLive ? "live" : isSyncing ? "syncing" : cloudRealtimeStatus
              }
              role="status"
              aria-live="polite"
            >
              <span className="profile-sync-indicator" aria-hidden="true" />
              <span className="profile-sync-copy">{syncLabel}</span>
            </div>
          </div>

          <div className="ri mfs-list-row">
            <i
              className="ic mfs-row-icon"
              style={{
                "--c":
                  S?.reconciliation?.isBalanced !== false
                    ? "#10b981"
                    : "#f59e0b",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </i>
            <span className="nm">
              <b>Ledger reconciliation</b>
              <small>
                {S?.reconciliation?.isBalanced !== false
                  ? `Opening + Credits − Debits = ${money(S?.reconciliation?.totalCurrentBalance || 0)}`
                  : `${S?.reconciliation?.discrepancyCount || 1} account discrepancy detected`}
              </small>
            </span>
            <span
              className={`settings-inline-action mfs-status-pill${S?.reconciliation?.isBalanced !== false ? " is-active" : ""}`}
            >
              {S?.reconciliation?.isBalanced !== false && (
                <span className="mfs-status-pill-dot" aria-hidden="true" />
              )}
              {S?.reconciliation?.isBalanced !== false ? "Verified" : "Check"}
            </span>
          </div>
        </div>

        {accountStatus && (
          <p
            className="settings-status mfs-card-footnote"
            role="status"
            aria-live="polite"
          >
            {accountStatus}
          </p>
        )}

        <div className="mfs-profile-sync-actions">
          {profile?.connected && (!cloudSyncEnabled || hasSyncError) && (
            <button
              className="btn settings-account-action"
              type="button"
              disabled={authBusy}
              onClick={onResumeSync}
            >
              {hasSyncError ? "Retry sync" : "Resume sync"}
            </button>
          )}
          <button
            className={`btn settings-account-action${profile?.connected ? " is-signout-btn" : ""}`}
            type="button"
            disabled={authBusy}
            onClick={profile?.connected ? onSignOut : onSignIn}
          >
            {profile?.connected
              ? authBusy
                ? "Signing out…"
                : "Sign out of account"
              : "Sign in to sync"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AppSettingsPage({
  S,
  profile,
  pushBackendConfigured,
  notificationPermission,
  notificationStatus,
  backgroundPushEnabled,
  onReminder,
  onToggleNotifications,
  onTestNotification,
  onBackupDownload,
  onEncryptedBackupDownload,
  onExpensesCsv,
  onBackupRestore,
  backupStatus,
  backupCheckpoints = [],
  checkpointsLoading = false,
  checkpointBusyId = "",
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onRefreshCheckpoints,
  sqlHealth = null,
  sqlHealthChecking = false,
  onVerifySqlAndSync,
  updateAvailable = false,
  updateInfo = null,
  checkingForUpdate = false,
  updateCheckStatus = "",
  onCheckForUpdates,
  onOpenUpdateModal,
  onToast,
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__spendCheckForUpdates?.();
    }
  }, []);
  const [canInstallAndroidApp, setCanInstallAndroidApp] = useState(
    () => isAndroidPlatform() && Boolean(window.__spendCanInstallWebApk?.()),
  );
  const [installingAndroidApp, setInstallingAndroidApp] = useState(false);
  useEffect(() => {
    if (!isAndroidPlatform() || typeof window === "undefined") return undefined;
    const syncInstallState = () => {
      setCanInstallAndroidApp(Boolean(window.__spendCanInstallWebApk?.()));
    };
    syncInstallState();
    window.addEventListener("spend:install-available", syncInstallState);
    window.addEventListener("spend:app-installed", syncInstallState);
    return () => {
      window.removeEventListener("spend:install-available", syncInstallState);
      window.removeEventListener("spend:app-installed", syncInstallState);
    };
  }, []);
  const [reconcileExpanded, setReconcileExpanded] = useState(false);
  const [checkpointsExpanded, setCheckpointsExpanded] = useState(false);
  const [statusTarget, setStatusTarget] = useState("data");
  const reconciliation = S?.reconciliation || {
    isBalanced: true,
    accountCount: 0,
    discrepancyCount: 0,
    totalOpening: 0,
    totalCredits: 0,
    totalDebits: 0,
    totalExpectedBalance: 0,
    totalCurrentBalance: 0,
    accounts: {},
  };
  const reconcileAccounts = Object.values(reconciliation.accounts || {});
  const currentVersion =
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2.0.0";
  const notificationUnavailable = notificationPermission === "unsupported";
  const notificationBlocked = notificationPermission === "denied";
  const isNative = isNativePlatform();
  const needsSignInForPush = Boolean(
    !isNative && pushBackendConfigured && !profile?.connected,
  );
  const isNotificationsActive = isNative
    ? notificationPermission === "granted"
    : pushBackendConfigured
      ? Boolean(profile?.connected && backgroundPushEnabled)
      : notificationPermission === "granted";

  const notificationLabel = notificationUnavailable
    ? "Unavailable on this device"
    : notificationBlocked
      ? "Blocked in device settings"
      : needsSignInForPush
        ? "Sign in required for closed-app web alerts"
        : isNotificationsActive
          ? "Active for daily, bill & summary alerts"
          : "Tap to enable closed-app reminder alerts";

  const notificationActionBadge = notificationUnavailable
    ? "Unavailable"
    : notificationBlocked
      ? "Blocked"
      : needsSignInForPush
        ? "Sign in"
        : isNotificationsActive
          ? "Active"
          : "Enable";

  return (
    <div className="mfs-app-settings-page">
      <section className="card app-settings-card mfs-card-list">
        <h2>Reminders</h2>
        <div className="mfs-card-rows">
          <div className="ri mfs-list-row settings-time-row">
            <i className="ic mfs-row-icon" style={{ "--c": "#f59e0b" }}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7.5 12 12 15 13.8" />
              </svg>
            </i>
            <span className="nm">
              <b>Daily reminder</b>
              <small>Daily, bill &amp; summary alerts</small>
            </span>
            <div className="mfs-time-pill-wrap">
              <input
                name="dailyReminderTime"
                className="in settings-time-input mfs-time-pill"
                type="time"
                aria-label="Daily reminder time"
                value={S.rt}
                onChange={(event) => onReminder(event.target.value)}
              />
            </div>
          </div>

          <button
            className="ri settings-action mfs-list-row"
            type="button"
            disabled={notificationBlocked || notificationUnavailable}
            onClick={() => {
              triggerHaptic("selection");
              onToggleNotifications?.();
            }}
          >
            <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
              <Icon n="bell" />
            </i>
            <span className="nm">
              <b>Built-in notifications</b>
              <small>{notificationLabel}</small>
            </span>
            <span
              className={`settings-inline-action mfs-status-pill${isNotificationsActive ? " is-active" : ""}`}
            >
              {isNotificationsActive && (
                <span className="mfs-status-pill-dot" aria-hidden="true" />
              )}
              {notificationActionBadge}
            </span>
          </button>

          {onTestNotification && (
            <button
              className="ri settings-action mfs-list-row"
              type="button"
              onClick={() => {
                triggerHaptic("light");
                onTestNotification();
              }}
            >
              <i className="ic mfs-row-icon" style={{ "--c": "#3b82f6" }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 2 11 13" />
                  <path d="m22 2-7 20-4-9-9-4 20-7z" />
                </svg>
              </i>
              <span className="nm">
                <b>Send test notification</b>
                <small>Preview banner &amp; alert tone</small>
              </span>
              <span className="settings-chevron" aria-hidden="true">
                <Icon n="r" />
              </span>
            </button>
          )}
        </div>
        <p
          className="settings-note mfs-card-footnote"
          role="status"
          aria-live="polite"
        >
          {notificationStatus ||
            (!isNative && pushBackendConfigured && !profile?.connected
              ? "Sign in to enable closed-app background reminders."
              : "Sends closed-app reminders for daily tracking, upcoming & due bills, weekly summaries, and monthly overviews.")}
        </p>
      </section>

      <section className="card app-settings-card app-settings-data-card mfs-card-list">
        <h2>Data &amp; backups</h2>
        <div className="mfs-card-rows">
          <button
            className="ri settings-action app-settings-minimal-item mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("light");
              setStatusTarget("data");
              onBackupDownload?.();
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#5b73d9" }}
            >
              <Icon n="backup" />
            </i>
            <span className="nm">
              <b>Export JSON backup</b>
              <small>Unencrypted full data file</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>

          <button
            className="ri settings-action app-settings-minimal-item mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("light");
              setStatusTarget("data");
              onEncryptedBackupDownload?.();
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#10b981" }}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </i>
            <span className="nm">
              <b>Export encrypted backup</b>
              <small>Password-protected AES-256 file</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>

          <button
            className="ri settings-action app-settings-minimal-item mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("light");
              setStatusTarget("data");
              onExpensesCsv?.();
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#2f9a6b" }}
            >
              <Icon n="csv" />
            </i>
            <span className="nm">
              <b>Export expenses CSV</b>
              <small>Spreadsheet for Excel or Sheets</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>

          <button
            className="ri settings-action app-settings-minimal-item mfs-list-row"
            type="button"
            onClick={() => {
              triggerHaptic("light");
              setStatusTarget("data");
              onBackupRestore?.();
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#8a6fd1" }}
            >
              <Icon n="restore" />
            </i>
            <span className="nm">
              <b>Restore from backup</b>
              <small>Import a saved .json or encrypted file</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>

          <button
            className={`ri settings-action app-settings-minimal-item mfs-list-row${reconcileExpanded ? " is-expanded" : ""}`}
            type="button"
            aria-expanded={reconcileExpanded}
            onClick={() => {
              triggerHaptic("selection");
              const next = !reconcileExpanded;
              setReconcileExpanded(next);
              if (next && profile?.connected) {
                onVerifySqlAndSync?.();
              }
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{
                "--c": reconciliation.isBalanced ? "#10b981" : "#f59e0b",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </i>
            <span className="nm">
              <b>Ledger reconciliation check</b>
              <small>
                {reconciliation.isBalanced
                  ? `Opening + Credits − Debits = ${money(reconciliation.totalCurrentBalance || 0)}`
                  : `${reconciliation.discrepancyCount} account discrepancy detected`}
              </small>
            </span>
            <span
              className={`settings-inline-action mfs-status-pill${reconciliation.isBalanced ? " is-active" : ""}`}
            >
              {reconciliation.isBalanced && (
                <span className="mfs-status-pill-dot" aria-hidden="true" />
              )}
              {reconciliation.isBalanced ? "Balanced" : "Mismatch"}
            </span>
          </button>
        </div>

        {reconcileExpanded && (
          <div
            className="mfs-reconcile-panel"
            role="region"
            aria-label="Ledger reconciliation details"
          >
            <div className="mfs-reconcile-formula">
              <div>
                <span>Opening</span>
                <b>{money(reconciliation.totalOpening || 0)}</b>
              </div>
              <span className="mfs-reconcile-op">+</span>
              <div>
                <span>Credits</span>
                <b className="is-credit">
                  {money(reconciliation.totalCredits || 0)}
                </b>
              </div>
              <span className="mfs-reconcile-op">−</span>
              <div>
                <span>Debits</span>
                <b className="is-debit">
                  {money(reconciliation.totalDebits || 0)}
                </b>
              </div>
              <span className="mfs-reconcile-op">=</span>
              <div>
                <span>Current</span>
                <b>{money(reconciliation.totalCurrentBalance || 0)}</b>
              </div>
            </div>
            {reconcileAccounts.length > 0 && (
              <div className="mfs-reconcile-accounts">
                {reconcileAccounts.map((acc) => (
                  <div key={acc.id} className="mfs-reconcile-acct-row">
                    <div className="mfs-reconcile-acct-meta">
                      <b>{acc.name}</b>
                      <small>
                        {money(acc.opening)} + {money(acc.credits)} −{" "}
                        {money(acc.debits)}
                      </small>
                    </div>
                    <div className="mfs-reconcile-acct-bal">
                      <b>{money(acc.currentBalance)}</b>
                      <span
                        className={`mfs-reconcile-badge${acc.isBalanced ? " is-ok" : " is-warn"}`}
                      >
                        {acc.isBalanced
                          ? "✓ OK"
                          : `Δ ${money(acc.discrepancy)}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {profile?.connected && (
              <div
                className="mfs-reconcile-accounts"
                style={{
                  marginTop: "8px",
                  borderTop: "1px solid var(--line, rgba(128,128,128,0.14))",
                  paddingTop: "10px",
                }}
              >
                <div className="mfs-reconcile-acct-row">
                  <div className="mfs-reconcile-acct-meta">
                    <b>Supabase SQL &amp; Cloud Sync</b>
                    <small>
                      {sqlHealthChecking
                        ? "Syncing & verifying Supabase SQL schema…"
                        : sqlHealth?.allPassed
                          ? `SQL v${sqlHealth.schemaVersion || "2026.11.17"} active · Cloud current ${money(sqlHealth?.cloudReconciliation?.totalCurrentBalance ?? reconciliation.totalCurrentBalance ?? 0)}`
                          : sqlHealth?.installed
                            ? "Partial SQL schema detected — run 20261117 migration in Supabase"
                            : "Tap Verify to check Supabase SQL installation & sync"}
                    </small>
                  </div>
                  <div className="mfs-reconcile-acct-bal">
                    <button
                      type="button"
                      className={`mfs-reconcile-badge ${sqlHealth?.allPassed && Math.abs((sqlHealth?.cloudReconciliation?.totalCurrentBalance ?? reconciliation.totalCurrentBalance ?? 0) - (reconciliation.totalCurrentBalance || 0)) < 0.01 ? "is-ok" : "is-warn"}`}
                      style={{
                        border: "none",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                      disabled={sqlHealthChecking}
                      onClick={() => {
                        triggerHaptic("light");
                        onVerifySqlAndSync?.();
                      }}
                    >
                      {sqlHealthChecking
                        ? "Checking…"
                        : sqlHealth?.allPassed &&
                            Math.abs(
                              (sqlHealth?.cloudReconciliation
                                ?.totalCurrentBalance ??
                                reconciliation.totalCurrentBalance ??
                                0) - (reconciliation.totalCurrentBalance || 0),
                            ) < 0.01
                          ? "✓ SQL & Cloud OK"
                          : "Sync & Verify"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {backupStatus && statusTarget !== "checkpoint" && (
          <p
            className="settings-status mfs-card-footnote"
            role="status"
            aria-live="polite"
          >
            {backupStatus}
          </p>
        )}
      </section>

      <section className="card app-settings-card mfs-card-list">
        <h2>Cloud backup checkpoints</h2>
        <div className="mfs-card-rows">
          <button
            className="ri settings-action app-settings-minimal-item mfs-list-row"
            type="button"
            disabled={checkpointBusyId === "creating"}
            onClick={() => {
              triggerHaptic("light");
              setStatusTarget("checkpoint");
              setCheckpointsExpanded(true);
              onCreateCheckpoint?.();
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#10b981" }}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </i>
            <span className="nm">
              <b>
                {checkpointBusyId === "creating"
                  ? "Saving checkpoint…"
                  : "Save checkpoint now"}
              </b>
              <small>
                {profile?.connected
                  ? "Automatic daily & pre-restore cloud snapshots"
                  : "Automatic daily & pre-restore device snapshots"}
              </small>
            </span>
            <span className="settings-inline-action mfs-status-pill is-active">
              <span className="mfs-status-pill-dot" aria-hidden="true" />
              Snapshot
            </span>
          </button>

          <button
            className={`ri settings-action app-settings-minimal-item mfs-list-row${checkpointsExpanded ? " is-expanded" : ""}`}
            type="button"
            aria-expanded={checkpointsExpanded}
            onClick={() => {
              triggerHaptic("selection");
              const next = !checkpointsExpanded;
              setCheckpointsExpanded(next);
              if (next) {
                onRefreshCheckpoints?.();
              }
            }}
          >
            <i
              className="ic is-minimal mfs-row-icon"
              style={{ "--c": "#6366f1" }}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                <polyline points="12 7 12 12 15 15" />
              </svg>
            </i>
            <span className="nm">
              <b>Recovery checkpoints ({backupCheckpoints.length})</b>
              <small>
                {checkpointsLoading
                  ? "Loading saved snapshots…"
                  : backupCheckpoints.length > 0
                    ? "Roll back balances & activity in one tap"
                    : "No snapshots yet · Tap above to save one"}
              </small>
            </span>
            <span
              className={`settings-chevron${checkpointsExpanded ? " is-expanded" : ""}`}
              aria-hidden="true"
            >
              <Icon n="r" />
            </span>
          </button>
        </div>

        {checkpointsExpanded && (
          <div
            className="mfs-checkpoints-list"
            role="region"
            aria-label="Saved backup checkpoints"
          >
            {backupCheckpoints.length === 0 ? (
              <p className="mfs-checkpoints-empty">
                {checkpointsLoading
                  ? "Fetching checkpoints…"
                  : "No checkpoints recorded yet. Spend automatically saves a daily snapshot and a safety snapshot before every restore."}
              </p>
            ) : (
              backupCheckpoints.slice(0, 12).map((cp) => {
                const cpType = cp.checkpointType || "daily";
                const typeBadge =
                  cpType === "pre_restore" || cpType === "pre_overwrite"
                    ? "Pre-Restore"
                    : cpType === "manual"
                      ? "Manual"
                      : "Daily";
                const dateLabel = cp.createdAt
                  ? new Date(cp.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : cp.checkpointDate || "Snapshot";
                const summary = cp.ledgerSummary || {};
                const totalBal =
                  summary.totalCurrentBalance !== undefined
                    ? summary.totalCurrentBalance
                    : null;
                const isRestoring = checkpointBusyId === String(cp.id);
                return (
                  <div key={cp.id} className="mfs-checkpoint-item">
                    <div className="mfs-checkpoint-meta">
                      <div className="mfs-checkpoint-title-row">
                        <b>{dateLabel}</b>
                        <span className={`mfs-checkpoint-badge is-${cpType}`}>
                          {typeBadge}
                        </span>
                      </div>
                      <small>
                        {cp.cardCount ?? summary.cardCount ?? 0} cards ·{" "}
                        {cp.expenseCount ?? summary.expenseCount ?? 0} expenses
                        {totalBal !== null ? ` · ${money(totalBal)}` : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="mfs-checkpoint-restore-btn"
                      disabled={Boolean(checkpointBusyId)}
                      onClick={() => {
                        triggerHaptic("selection");
                        setStatusTarget("checkpoint");
                        onRestoreCheckpoint?.(cp);
                      }}
                    >
                      {isRestoring ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {backupStatus && statusTarget === "checkpoint" && (
          <p
            className="settings-status mfs-card-footnote"
            role="status"
            aria-live="polite"
          >
            {backupStatus}
          </p>
        )}
      </section>

      <section className="card app-settings-card mfs-card-list">
        <h2>App updates</h2>
        <div className="mfs-card-rows">
          {isAndroidPlatform() && canInstallAndroidApp && (
            <button
              className="ri settings-action mfs-list-row"
              type="button"
              disabled={installingAndroidApp}
              onClick={async () => {
                triggerHaptic("selection");
                setInstallingAndroidApp(true);
                try {
                  const res = await window.__spendPromptInstall?.();
                  if (res?.outcome === "accepted") {
                    setCanInstallAndroidApp(false);
                    onToast?.("Installing Spend on your Android home screen…");
                  }
                } finally {
                  setInstallingAndroidApp(false);
                }
              }}
            >
              <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </i>
              <span className="nm">
                <b>Install Android app</b>
                <small>Add native WebAPK to your home screen</small>
              </span>
              <span className="settings-inline-action mfs-status-pill is-active">
                {installingAndroidApp ? "Installing…" : "Install"}
              </span>
            </button>
          )}
          <button
            className="ri settings-action mfs-list-row"
            type="button"
            disabled={checkingForUpdate}
            onClick={async () => {
              triggerHaptic("selection");
              if (updateAvailable) {
                onOpenUpdateModal?.();
                return;
              }
              if (onCheckForUpdates) {
                const found = await onCheckForUpdates();
                if (!found) {
                  onToast?.(
                    navigator.onLine
                      ? `You’re on the latest version (v${currentVersion})`
                      : "Offline — connect to the internet to check for updates",
                  );
                }
              }
            }}
          >
            <i
              className="ic mfs-row-icon"
              style={{ "--c": updateAvailable ? "#10b981" : "#3b82f6" }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16V8" />
                <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </i>
            <span className="nm">
              <b>
                {updateAvailable
                  ? "Update available"
                  : checkingForUpdate
                    ? "Checking for updates…"
                    : "Check for updates"}
              </b>
              <small>
                {updateAvailable
                  ? updateInfo?.version
                    ? `Spend v${updateInfo.version} is ready to install`
                    : "A new version is ready to install"
                  : checkingForUpdate
                    ? "Checking for new releases…"
                    : `Installed version v${currentVersion}`}
              </small>
            </span>
            <span
              className={`settings-inline-action mfs-status-pill${updateAvailable ? " is-active" : ""}`}
            >
              {updateAvailable && (
                <span className="mfs-status-pill-dot" aria-hidden="true" />
              )}
              {updateAvailable
                ? "Update"
                : checkingForUpdate
                  ? "Checking…"
                  : updateCheckStatus.startsWith("You’re up to date")
                    ? "Up to date"
                    : "Check"}
            </span>
          </button>
        </div>
        <p
          className="settings-note mfs-card-footnote"
          role="status"
          aria-live="polite"
        >
          {updateCheckStatus ||
            (updateAvailable
              ? "Tap above to open the update prompt and install the latest version."
              : `Spend v${currentVersion} · Manually check anytime if you skipped an update prompt or missed earlier releases.`)}
        </p>
      </section>
    </div>
  );
}

function PasscodeInputField({
  value,
  onChange,
  onComplete,
  hasError,
  autoFocus = true,
  ariaLabel = "Passcode",
}) {
  const inputRef = useRef(null);

  return (
    <div
      className={`sec-pin-capsule${hasError ? " is-error" : ""}${value.length === 4 ? " is-filled" : ""}`}
      onClick={() => inputRef.current?.focus({ preventScroll: true })}
    >
      <input
        name="appPin"
        ref={inputRef}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoFocus={autoFocus}
        data-sheet-autofocus
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(next);
          if (next.length === 4) {
            onComplete?.(next);
          }
        }}
        className="sec-pin-hidden-input"
        autoComplete="off"
      />
      <div className="sec-pin-dots" aria-hidden="true">
        {[0, 1, 2, 3].map((idx) => {
          const isFilled = idx < value.length;
          return (
            <span
              key={idx}
              className={`sec-pin-dot${isFilled ? " is-filled" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function SecuritySheet({ onClose, onBack, onLockNow }) {
  const [pinSet, setPinSet] = useState(() => hasAppPin());
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsConfigured, setBiometricsConfigured] = useState(() =>
    hasBiometricsConfigured(),
  );
  const [step, setStep] = useState("overview"); // "overview" | "setup_pin" | "confirm_pin"
  const [pinDraft, setPinDraft] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const handleBack = () => {
    triggerHaptic("light");
    if (step === "confirm_pin") {
      setStep("setup_pin");
      setPinConfirm("");
      setPinError("");
    } else if (step === "setup_pin") {
      setStep("overview");
      setPinDraft("");
      setPinError("");
    } else if (onBack) {
      onBack();
    } else {
      onClose();
    }
  };

  useEffect(() => {
    isBiometricsAvailable().then((avail) => setBiometricsAvailable(avail));
  }, []);

  useLayoutEffect(() => {
    if (step === "setup_pin" || step === "confirm_pin") {
      const pinEl = document.querySelector(
        ".sec-pin-hidden-input, [data-sheet-autofocus]",
      );
      pinEl?.focus({ preventScroll: true });
    }
  }, [step]);

  const handleStartSetPin = () => {
    setPinDraft("");
    setPinConfirm("");
    setPinError("");
    setStep("setup_pin");
  };

  const commitPin = useCallback(async (pin) => {
    await flushStorageWriteQueues();
    await setAppPin(pin);
    setPinSet(true);
    triggerHaptic("success");
    setStatusMsg("PIN passcode enabled successfully.");
    setStep("overview");
  }, []);

  const handleDraftPinSubmit = (e) => {
    e?.preventDefault();
    if (pinDraft.length !== 4) {
      setPinError("PIN must be exactly 4 digits");
      triggerHaptic("warning");
      return;
    }
    setPinError("");
    setStep("confirm_pin");
  };

  const handleConfirmPinSubmit = async (e) => {
    e?.preventDefault();
    if (pinConfirm !== pinDraft) {
      setPinError("PINs do not match. Please try again.");
      triggerHaptic("warning");
      setPinConfirm("");
      return;
    }
    await commitPin(pinDraft);
  };

  const handleRemovePin = async () => {
    await flushStorageWriteQueues();
    await removeAppPin();
    await disableBiometrics();
    setPinSet(false);
    setBiometricsConfigured(false);
    triggerHaptic("delete");
    setStatusMsg("PIN passcode removed.");
  };

  const handleToggleBiometrics = async () => {
    if (biometricsConfigured) {
      disableBiometrics();
      setBiometricsConfigured(false);
      triggerHaptic("light");
    } else {
      const ok = await enableBiometrics();
      if (ok) {
        setBiometricsConfigured(true);
        triggerHaptic("success");
        setStatusMsg("Biometric authentication enabled.");
      } else {
        triggerHaptic("warning");
        setPinError("Could not enable biometric unlock on this device.");
      }
    }
  };

  return (
    <Sheet onClose={onClose}>
      <div className="security-sheet-header">
        <button
          type="button"
          className="security-sheet-back-btn"
          aria-label={step === "overview" ? "Back to settings" : "Back"}
          onClick={handleBack}
        >
          <Icon n="l" />
        </button>
        <h3 id="sheet-title">Security &amp; App Lock</h3>
      </div>

      {step === "overview" && (
        <div className="security-sheet-content">
          <div className="mfs-settings-section">
            <span className="mfs-settings-section-label">APP ACCESS</span>
            <div className="mfs-settings-group">
              {!pinSet ? (
                <button
                  className="ri mfs-settings-row"
                  type="button"
                  onClick={handleStartSetPin}
                >
                  <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </i>
                  <span className="nm">
                    <b>4-Digit Passcode</b>
                    <small>Not set</small>
                  </span>
                  <span className="mfs-row-badge">Set up</span>
                  <span className="settings-chevron" aria-hidden="true">
                    <Icon n="r" />
                  </span>
                </button>
              ) : (
                <div
                  className="ri mfs-settings-row"
                  style={{ justifyContent: "space-between" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      minWidth: 0,
                    }}
                  >
                    <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </i>
                    <span className="nm">
                      <b>4-Digit Passcode</b>
                      <small>Active</small>
                    </span>
                  </div>
                  <div className="security-row-actions">
                    <button
                      type="button"
                      className="security-sub-btn"
                      onClick={handleStartSetPin}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="security-sub-btn is-danger"
                      onClick={handleRemovePin}
                    >
                      Turn Off
                    </button>
                  </div>
                </div>
              )}

              {pinSet && (
                <button
                  className="ri mfs-settings-row"
                  type="button"
                  aria-pressed={biometricsConfigured}
                  disabled={!biometricsAvailable && !isNativePlatform()}
                  onClick={handleToggleBiometrics}
                >
                  <i className="ic mfs-row-icon" style={{ "--c": "#6366f1" }}>
                    {isAndroidPlatform() ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
                        <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
                        <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
                        <path d="M2 12a10 10 0 0 1 18-6" />
                        <path d="M21.8 16c.2-2 .131-5.354 0-6" />
                        <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
                        <path d="M8.65 22c.21-.66.45-1.32.57-2" />
                        <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                        <path d="M9 9h.01M15 9h.01M10 13a2 2 0 0 0 4 0m-2 0v2" />
                      </svg>
                    )}
                  </i>
                  <span className="nm">
                    <b>Biometric Unlock</b>
                    <small>
                      {biometricsConfigured
                        ? isAndroidPlatform()
                          ? "Fingerprint / Biometrics"
                          : "Face ID / Touch ID"
                        : biometricsAvailable
                          ? isAndroidPlatform()
                            ? "Use Fingerprint or Biometrics"
                            : "Off"
                          : "Unavailable on this device"}
                    </small>
                  </span>
                  <span
                    className={"sw " + (biometricsConfigured ? "on" : "")}
                    aria-hidden="true"
                  />
                </button>
              )}


            </div>
          </div>

          <div className="mfs-settings-section" style={{ marginTop: 14 }}>
            <span className="mfs-settings-section-label">DATA PRIVACY</span>
            <div className="mfs-settings-group">
              <div className="ri mfs-settings-row">
                <i className="ic mfs-row-icon" style={{ "--c": "#10b981" }}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </i>
                <span className="nm">
                  <b>Cloud Encryption</b>
                  <small>End-to-end encrypted on this device</small>
                </span>
                <span className="security-badge-e2e">
                  <span className="security-badge-dot" />
                  Protected
                </span>
              </div>
            </div>
          </div>

          {statusMsg && (
            <p
              className="settings-status"
              role="status"
              aria-live="polite"
              style={{ marginTop: 14 }}
            >
              {statusMsg}
            </p>
          )}

          {pinSet && (
            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                className="security-lock-now-btn"
                onClick={() => {
                  lockAppManually();
                  onLockNow?.();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Lock App Now</span>
              </button>
            </div>
          )}
        </div>
      )}

      {step === "setup_pin" && (
        <form onSubmit={handleDraftPinSubmit} className="security-flow-wrap">
          <div className="security-flow-icon-wrap">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h4 className="security-flow-title">Create a 4-digit passcode</h4>
          <p className="security-flow-sub">
            Enter 4 digits to lock Spend on this device
          </p>

          <PasscodeInputField
            value={pinDraft}
            onChange={(next) => {
              setPinDraft(next);
              setPinError("");
            }}
            onComplete={(fullPin) => {
              triggerHaptic("selection");
              setTimeout(() => {
                setStep("confirm_pin");
              }, 160);
            }}
            hasError={Boolean(pinError)}
            ariaLabel="Create 4-digit passcode"
          />

          {pinError && (
            <p className="security-pin-error-msg" role="alert">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{pinError}</span>
            </p>
          )}

          <div className="security-flow-actions">
            <button
              type="button"
              className="security-flow-btn is-secondary"
              onClick={() => {
                triggerHaptic("light");
                setStep("overview");
                setPinDraft("");
                setPinError("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="security-flow-btn is-primary"
              disabled={pinDraft.length !== 4}
            >
              Continue
            </button>
          </div>
        </form>
      )}

      {step === "confirm_pin" && (
        <form onSubmit={handleConfirmPinSubmit} className="security-flow-wrap">
          <div className="security-flow-icon-wrap">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <h4 className="security-flow-title">Confirm your passcode</h4>
          <p className="security-flow-sub">Re-enter the 4 digits to verify</p>

          <PasscodeInputField
            value={pinConfirm}
            onChange={(next) => {
              setPinConfirm(next);
              setPinError("");
            }}
            onComplete={(fullPin) => {
              if (fullPin !== pinDraft) {
                triggerHaptic("warning");
                setPinError("PINs do not match. Please try again.");
                setTimeout(() => {
                  setPinConfirm("");
                }, 400);
                return;
              }
              setTimeout(() => {
                commitPin(pinDraft);
              }, 160);
            }}
            hasError={Boolean(pinError)}
            ariaLabel="Confirm 4-digit passcode"
          />

          {pinError && (
            <p className="security-pin-error-msg" role="alert">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{pinError}</span>
            </p>
          )}

          <div className="security-flow-actions">
            <button
              type="button"
              className="security-flow-btn is-secondary"
              onClick={() => {
                triggerHaptic("light");
                setStep("setup_pin");
                setPinConfirm("");
                setPinError("");
              }}
            >
              Back
            </button>
            <button
              type="submit"
              className="security-flow-btn is-primary"
              disabled={pinConfirm.length !== 4}
            >
              Confirm
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}



const CollapsibleTopBar = React.memo(function CollapsibleTopBar({
  activeTab,
  monthLabel,
  onScrollToTop,
  rightActions,
  settingsRoute,
  onBack,
  settingsTitle,
}) {
  if ((activeTab === "activity" || activeTab === "plans") && !settingsRoute) {
    return null;
  }

  // Compact title shows the active month on Home, and screen name on other tabs
  const compactTitle = settingsRoute
    ? settingsTitle
    : activeTab === "home"
      ? monthLabel
      : activeTab === "activity"
        ? "Activity"
        : activeTab === "accounts"
          ? "Accounts"
          : "Plans";

  const handleHeaderClick = (e) => {
    // Ignore clicks originating inside interactive right-side controls
    if (e.target.closest("button, a, input, select, [role='button']")) {
      return;
    }
    onScrollToTop?.();
  };

  return (
    <header
      className={`prototype-header${settingsRoute ? " is-settings-route" : ""}`}
      onClick={handleHeaderClick}
      aria-label="Top navigation bar, tap to scroll to top"
    >
      <div className="prototype-header-compact-wrap">
        {settingsRoute && (
          <button
            className="prototype-header-back"
            type="button"
            aria-label="Back to settings"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic("selection");
              onBack?.();
            }}
            style={{ marginRight: 8 }}
          >
            <Icon n="l" />
          </button>
        )}
        <span
          className="prototype-header-compact-title"
          onClick={onScrollToTop}
        >
          {compactTitle}
        </span>
      </div>
      {!settingsRoute && (
        <div
          className="prototype-header-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {rightActions}
        </div>
      )}
    </header>
  );
});

const ScreenLargeTitle = React.memo(function ScreenLargeTitle({
  title,
  subtitle,
  className = "",
}) {
  return (
    <div
      className={`prototype-large-title-row${className ? ` ${className}` : ""}`}
    >
      <h1 className="prototype-large-title">{title}</h1>
      {subtitle ? <p className="prototype-large-subtitle">{subtitle}</p> : null}
    </div>
  );
});

/* These screens stay presentational. App supplies shared expense data,
   persistence, account actions, and sync state. */
export default function MobilePrototype({
  S,
  onUnlock,
  onResetPin,
  onShift,
  onExpenseSave,
  onExpenseUpdate,
  onExpenseDelete,
  onBudgetSave,
  onBudgetClear,
  onTransactionSave,
  onTransactionUpdate,
  onTransactionDelete,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onSetPrimaryCard,
  onMoveCardToFront,
  onToggleRec,
  onUpdateRec,
  onRemoveRec,
  onTheme,
  onReminder,
  onSignIn,
  onSignOut,
  onEditProfile,
  onAvatarChange,
  profile,
  profileStatus,
  cloudSyncEnabled,
  cloudSyncReady,
  normalizedAccountSync,
  cloudRealtimeStatus,
  cloudSyncActivity,
  pushBackendConfigured,
  notificationPermission,
  notificationStatus,
  backgroundPushEnabled,
  onToggleNotifications,
  onTestNotification,
  backupStatus,
  onBackupDownload,
  onEncryptedBackupDownload,
  onExpensesCsv,
  onBackupRestore,
  backupCheckpoints = [],
  checkpointsLoading = false,
  checkpointBusyId = "",
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onRefreshCheckpoints,
  sqlHealth = null,
  sqlHealthChecking = false,
  onVerifySqlAndSync,
  accountStatus,
  authBusy,
  onResumeSync,
  updateAvailable = false,
  updateInfo = null,
  checkingForUpdate = false,
  updateCheckStatus = "",
  onCheckForUpdates,
  onOpenUpdateModal,
}) {
  const [tab, setTab] = useState("home");
  const rawCards = Array.isArray(S.cards) ? S.cards : [];
  const explicitCashCard = rawCards.find(
    (c) =>
      c.id === "cash" ||
      c.provider === "cash" ||
      c.category === "cash" ||
      c.type === "cash",
  );
  const hasCashActivity =
    Boolean(explicitCashCard) ||
    Number(S?.start?.cash) > 0 ||
    (S?.exp || []).some((e) => !e.acct || e.acct === "cash") ||
    (S?.tx || []).some((t) => t.acct === "cash" || t.to === "cash");
  const cards = useMemo(
    () =>
      !explicitCashCard && (rawCards.length > 0 || hasCashActivity)
        ? [
            ...rawCards,
            {
              id: "cash",
              name: "Cash",
              provider: "cash",
              category: "cash",
              type: "cash",
              network: "none",
              currency: "BDT",
              holderName: "Cash wallet",
              subtitle: "Cash in hand · BDT",
              last4: "CASH",
              number: "CASH-BDT",
              expiry: "",
              color: "#23403C",
              gradient: "#23403C",
              initialBalance: Number(S?.start?.cash) || 0,
            },
          ]
        : rawCards,
    [rawCards, explicitCashCard, hasCashActivity, S?.start?.cash],
  );
  const [preferredAccount, setPreferredAccount] = useState(() => {
    try {
      const stored = localStorage.getItem(
        STORAGE_KEYS.preferredAccount || "spend-preferred-account-v1",
      );
      return stored !== null ? stored : null;
    } catch {
      return null;
    }
  });
  const [activeAccountId, setActiveAccountId] = useState("");
  const activeAccountRef = useRef("");
  const syncActiveAccount = useCallback((acct) => {
    const nextAcct = acct ?? "";
    activeAccountRef.current = nextAcct;
    setActiveAccountId(nextAcct);
  }, []);

  const handlePreferredAccountChange = useCallback((acct) => {
    const nextAccount = acct ?? "";
    setPreferredAccount(nextAccount);
    try {
      localStorage.setItem(
        STORAGE_KEYS.preferredAccount || "spend-preferred-account-v1",
        nextAccount,
      );
    } catch {}
  }, []);

  const [plan, setPlan] = useState("budget");
  const [q, setQ] = useState("");
  const [cf, setCf] = useState("");
  const [sheet, setSheet] = useState(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [sheetExitDuration, setSheetExitDuration] = useState(SHEET_EXIT_MS);
  const [sheetExitFromTransform, setSheetExitFromTransform] = useState(
    "translate3d(0, 0, 0)",
  );
  const [sheetExitFromOpacity, setSheetExitFromOpacity] = useState("1");
  const [highlightedExpenseId, setHighlightedExpenseId] = useState(null);
  const [highlightedTransactionId, setHighlightedTransactionId] =
    useState(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [hapticsEnabled, setHapticsState] = useState(isHapticsEnabled);
  const [toastMsg, setToastMsg] = useState(null);
  const [isAppLocked, setIsAppLocked] = useState(() => shouldLockApp());
  const [resetPinConfirmOpen, setResetPinConfirmOpen] = useState(false);
  const [isPrivacyShielded, setIsPrivacyShielded] = useState(false);
  const [ptrState, setPtrState] = useState({ pullY: 0, phase: "idle" });
  const ptrGestureRef = useRef({
    active: false,
    startY: 0,
    startX: 0,
    passedThreshold: false,
  });

  const handleToggleHaptics = useCallback(() => {
    setHapticsState((current) => {
      const next = setHapticsEnabled(!current);
      if (next) {
        triggerHaptic("selection");
      }
      return next;
    });
  }, []);

  const handleVerifyPin = useCallback(async (enteredPin) => {
    const lockoutSec = getPinLockoutRemainingSeconds();
    if (lockoutSec > 0) {
      triggerHaptic("warning");
      return {
        ok: false,
        lockoutSeconds: lockoutSec,
        message: `Too many attempts. Try again in ${lockoutSec}s.`,
      };
    }
    const ok = await verifyAppPin(enteredPin);
    if (ok) {
      triggerHaptic("success");
      return true;
    }
    triggerHaptic("warning");
    const remaining = getPinLockoutRemainingSeconds();
    if (remaining > 0) {
      return {
        ok: false,
        lockoutSeconds: remaining,
        message: `Too many attempts. Try again in ${remaining}s.`,
      };
    }
    return false;
  }, []);

  const handleBiometricAuth = useCallback(async () => {
    const lockoutSec = getPinLockoutRemainingSeconds();
    if (lockoutSec > 0) {
      triggerHaptic("warning");
      return {
        ok: false,
        lockoutSeconds: lockoutSec,
        message: `Too many attempts. Try again in ${lockoutSec}s.`,
      };
    }
    const biometricLabel = isAndroidPlatform()
      ? "Fingerprint / Biometrics"
      : detectMobilePlatform() === "ios"
        ? "Face ID / Touch ID"
        : "Biometrics";
    triggerHaptic("light");
    if (!hasBiometricsConfigured()) {
      triggerHaptic("warning");
      return {
        ok: false,
        message: `Enable ${biometricLabel} in Settings first.`,
      };
    }
    try {
      const res = await authenticateWithBiometrics();
      if (res === true || res?.ok === true) {
        triggerHaptic("success");
        return true;
      }
      if (res?.reason === "key_missing" || res?.reason === "origin_mismatch") {
        triggerHaptic("warning");
        return {
          ok: false,
          message: `Enter PIN once to sync ${biometricLabel}.`,
        };
      }
      if (res?.reason === "not_allowed") {
        triggerHaptic("warning");
        return {
          ok: false,
          message: `${biometricLabel} was cancelled or unavailable. Enter your PIN.`,
        };
      }
    } catch {
      // Handled gracefully via fallback message below
    }
    triggerHaptic("warning");
    return {
      ok: false,
      message: `${biometricLabel} failed. Use your PIN.`,
    };
  }, []);

  const handleUnlock = useCallback(async () => {
    markActive();
    if (typeof onUnlock === "function") {
      await onUnlock();
    }
    setIsAppLocked(false);
  }, [onUnlock]);

  const handleForgotPin = useCallback(() => {
    setResetPinConfirmOpen(true);
  }, []);

  const handleConfirmResetPin = useCallback(async () => {
    setResetPinConfirmOpen(false);
    triggerHaptic("delete");
    await flushStorageWriteQueues();
    await resetForgottenPin();
    await disableBiometrics();
    markActive();
    onResetPin?.();
    setIsAppLocked(false);
  }, [onResetPin]);

  useEffect(() => {
    const isAndroid = isAndroidPlatform();
    const setAndroidPrivacyBlur = (active) => {
      if (!isAndroid || typeof document === "undefined") return;
      if (active && hasAppPin()) {
        document.documentElement.dataset.androidPrivacyBlur = "1";
      } else {
        delete document.documentElement.dataset.androidPrivacyBlur;
      }
    };

    const lockOnBackground = () => {
      setAndroidPrivacyBlur(true);
      setIsPrivacyShielded(true);
      markBackgrounded();
      if (hasAppPin()) {
        setIsAppLocked(true);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setAndroidPrivacyBlur(false);
        setIsPrivacyShielded(false);
        if (shouldLockApp()) {
          setIsAppLocked(true);
        }
      } else if (document.visibilityState === "hidden") {
        lockOnBackground();
      }
    };

    const handlePageHide = () => {
      lockOnBackground();
    };

    const handleAndroidBlur = () => {
      // Android Chrome captures Recents snapshots on blur before visibilitychange settles
      setAndroidPrivacyBlur(true);
    };

    const handleAndroidFocus = () => {
      if (document.visibilityState === "visible") {
        setAndroidPrivacyBlur(false);
      }
    };

    // Native Capacitor app lifecycle support (Android & iOS)
    let capacitorListenerHandle = null;
    const appPlugin = CapacitorApp || window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      try {
        capacitorListenerHandle = appPlugin.addListener(
          "appStateChange",
          ({ isActive }) => {
            if (isActive) {
              setAndroidPrivacyBlur(false);
              setIsPrivacyShielded(false);
              if (shouldLockApp()) {
                setIsAppLocked(true);
              }
            } else {
              lockOnBackground();
            }
          },
        );
      } catch {
        // ignore
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    if (isAndroid) {
      window.addEventListener("blur", handleAndroidBlur);
      window.addEventListener("focus", handleAndroidFocus);
      window.addEventListener("pageshow", handleAndroidFocus);
    }

    return () => {
      setAndroidPrivacyBlur(false);
      capacitorListenerHandle?.then?.((h) => h?.remove?.())?.catch?.(() => {});
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      if (isAndroid) {
        window.removeEventListener("blur", handleAndroidBlur);
        window.removeEventListener("focus", handleAndroidFocus);
        window.removeEventListener("pageshow", handleAndroidFocus);
      }
    };
  }, []);
  const dockRef = useRef(null);
  const hideDockOnScrollForActiveTab =
    tab === "activity" && !appSettingsOpen && !profileSettingsOpen;
  const {
    screenRootRef,
    registerTabScroller,
    scrollToTop,
    tabScrollTopRef,
    getActiveScroller,
  } = useScrollProgress({
    activeTab: profileSettingsOpen
      ? "profile-settings"
      : appSettingsOpen
        ? "app-settings"
        : tab,
    hideDockOnScroll: hideDockOnScrollForActiveTab,
    dockRef,
    plansScrollStore,
  });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [slideDirection, setSlideDirection] = useState("forward");
  const [animateScreen, setAnimateScreen] = useState(false);
  const timer = useRef();
  const sheetCloseTimer = useRef();
  const highlightTimer = useRef();
  const mobileRootRef = useRef(null);
  const sheetTriggerCandidateRef = useRef(null);
  const sheetReturnFocusRef = useRef(null);
  const activitySearchRef = useRef(null);
  const baseViewportHeightRef = useRef(0);

  // P0 #4: Cleanly reset fixed bottom dock GPU compositing & visibility after sheet/keyboard dismissal
  const resetDockCompositing = useCallback(() => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const root = mobileRootRef.current;
      if (
        root &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        root.removeAttribute("data-sheet-open");
        root.removeAttribute("data-sheet-closing");
        root.style.removeProperty("--sheet-drag-progress");
      }
      const dock =
        dockRef.current || document.querySelector(".mobile-prototype .dock");
      if (!dock) return;
      dock.style.transform = "";
      dock.style.visibility = "";
      dock.style.opacity = "";
      const tabsEl = dock.querySelector(".dock__tabs");
      const fabEl = dock.querySelector(".dock__fab");
      if (tabsEl) {
        tabsEl.style.transform = "";
        tabsEl.style.visibility = "";
        tabsEl.style.opacity = "";
      }
      if (fabEl) {
        fabEl.style.transform = "";
        fabEl.style.visibility = "";
        fabEl.style.opacity = "";
      }
    });
  }, []);

  const categoryOrder = useMemo(() => {
    const categoryCounts = new Map();
    for (const expense of S.exp) {
      categoryCounts.set(
        expense.cat,
        (categoryCounts.get(expense.cat) || 0) + 1,
      );
    }
    return Object.keys(CAT).sort(
      (left, right) =>
        (categoryCounts.get(right) || 0) - (categoryCounts.get(left) || 0),
    );
  }, [S.exp]);

  const [systemDark, setSystemDark] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => setSystemDark(Boolean(e.matches));
    setSystemDark(Boolean(mq.matches));
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(handleChange);
      return () => mq.removeListener(handleChange);
    }
    return undefined;
  }, []);

  const resolvedTheme = useMemo(() => {
    const raw = S?.theme;
    if (raw === "dark" || raw === "light") return raw;
    const mode = S?.themeMode || raw || "auto";
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
    return systemDark ? "dark" : "light";
  }, [S?.theme, S?.themeMode, systemDark]);

  const [platform, setPlatform] = useState(() => detectMobilePlatform());

  useLayoutEffect(() => {
    const rootEl = document.documentElement;
    rootEl.dataset.theme = resolvedTheme;
    rootEl.setAttribute("data-theme", resolvedTheme);
    rootEl.style.colorScheme = resolvedTheme;
    const themeColor = resolvedTheme === "dark" ? "#08080c" : "#f4f3ee";
    rootEl.style.backgroundColor = themeColor;
    document.body.style.backgroundColor = themeColor;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", themeColor));
    try {
      const modeToSave = S?.themeMode || S?.theme || resolvedTheme;
      localStorage.setItem("spend-theme-v1", modeToSave);
    } catch {}
  }, [resolvedTheme, S?.theme, S?.themeMode]);

  // Dynamically sync iOS / Android platform attribute & ensure viewport meta allows accessibility zoom
  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    // Clean up any legacy inline style tag now that rules live in MobilePrototype.css
    document.getElementById("spend-cross-platform-native-fixes")?.remove();

    const syncPlatform = () => {
      const detected = detectMobilePlatform();
      setPlatform(detected);
      document.documentElement.dataset.platform = detected;
      document.documentElement.setAttribute("data-platform", detected);
    };
    syncPlatform();

    window.addEventListener("resize", syncPlatform, { passive: true });
    window.addEventListener("orientationchange", syncPlatform, {
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", syncPlatform);
      window.removeEventListener("orientationchange", syncPlatform);
    };
  }, []);

  useEffect(() => {
    const applyLaunchUrl = (rawUrl) => {
      if (typeof window === "undefined" || !rawUrl) return;
      let parsed;
      try {
        parsed = new URL(rawUrl, window.location.href);
      } catch {
        return;
      }
      const params = parsed.searchParams;
      const targetTab = params.get("tab");
      const action = params.get("action");
      let urlChanged = false;

      if (
        targetTab &&
        ["home", "activity", "accounts", "plans"].includes(targetTab)
      ) {
        setAppSettingsOpen(false);
        setProfileSettingsOpen(false);
        setTab(targetTab);
        urlChanged = true;
      }

      if (action === "add-expense" || action === "add") {
        setAppSettingsOpen(false);
        setProfileSettingsOpen(false);
        openSheet({ type: "add", iv: "none" });
        urlChanged = true;
      } else if (action === "add-tx" || action === "tx") {
        setAppSettingsOpen(false);
        setProfileSettingsOpen(false);
        setTab("accounts");
        openSheet({ type: "tx", t: "transfer" });
        urlChanged = true;
      }

      if (urlChanged) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
      }
    };

    if (typeof window !== "undefined") {
      applyLaunchUrl(window.location.href);
      if (
        isAndroidPlatform() &&
        "launchQueue" in window &&
        typeof window.launchQueue?.setConsumer === "function"
      ) {
        window.launchQueue.setConsumer((launchParams) => {
          if (launchParams?.targetURL) {
            applyLaunchUrl(launchParams.targetURL);
          }
        });
      }
    }

    const navigateToTab = (targetTab) => {
      if (
        targetTab &&
        ["home", "activity", "accounts", "plans"].includes(targetTab)
      ) {
        setSheet(null);
        setSheetClosing(false);
        setAppSettingsOpen(false);
        setProfileSettingsOpen(false);
        setTab(targetTab);
        triggerHaptic("selection");
      }
    };
    const handleMessage = (event) => {
      if (event.data?.type === "NAVIGATE_TAB") {
        navigateToTab(event.data.tab);
      }
    };
    const handleCustomNavigate = (event) => {
      navigateToTab(event.detail?.tab);
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);
    window.addEventListener("spend:navigate-tab", handleCustomNavigate);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
      window.removeEventListener("spend:navigate-tab", handleCustomNavigate);
    };
  }, []);

  const resetScreenScroll = scrollToTop;

  const toast = (msg, undo) => {
    clearTimeout(timer.current);
    setToastMsg({ msg, undo });
    timer.current = setTimeout(() => setToastMsg(null), 4200);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(sheetCloseTimer.current);
      clearTimeout(highlightTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!sheet) return undefined;
    const body = document.body;
    const documentElement = document.documentElement;
    const previousScrollY = window.scrollY;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousDocumentOverflow = documentElement.style.overflow;
    body.style.position = "fixed";
    body.style.top = `-${previousScrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      documentElement.style.overflow = previousDocumentOverflow;
      window.scrollTo(0, previousScrollY);
    };
  }, [sheet]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = mobileRootRef.current;
    let frame = 0;
    baseViewportHeightRef.current = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      viewport?.height || 0,
    );

    const syncViewport = () => {
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const visibleTop = Math.max(0, viewport?.offsetTop ?? 0);
      const documentHeight = Math.max(
        baseViewportHeightRef.current,
        window.innerHeight,
        document.documentElement.clientHeight,
      );
      const activeElement = document.activeElement;
      const textEntryFocused = Boolean(
        activeElement?.matches?.(
          'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]',
        ),
      );
      const keyboardHeight = documentHeight - (visibleHeight + visibleTop);
      const isKeyboardOpen = textEntryFocused && keyboardHeight > 120;

      if (root) {
        root.style.setProperty(
          "--mobile-visible-height",
          isKeyboardOpen ? `${visibleHeight}px` : "100dvh",
        );
        root.style.setProperty(
          "--mobile-visible-top",
          isKeyboardOpen ? `${visibleTop}px` : "0px",
        );
      }
      setKeyboardOpen(isKeyboardOpen);
      if (!textEntryFocused || keyboardHeight <= 120) {
        baseViewportHeightRef.current = Math.max(
          window.innerHeight,
          document.documentElement.clientHeight,
          visibleHeight + visibleTop,
        );
      }
    };
    const scheduleViewportSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncViewport);
    };
    let blurTimer1 = 0;
    let blurTimer2 = 0;
    const handleFocusOut = () => {
      scheduleViewportSync();
      // Dynamically run delayed keyboard dismissal resync only on iOS, where
      // Safari's visualViewport offsetTop and innerHeight settle asynchronously.
      if (detectMobilePlatform() !== "ios") return;
      window.clearTimeout(blurTimer1);
      window.clearTimeout(blurTimer2);
      blurTimer1 = window.setTimeout(() => {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        scheduleViewportSync();
      }, 120);
      blurTimer2 = window.setTimeout(scheduleViewportSync, 320);
    };

    syncViewport();
    viewport?.addEventListener("resize", scheduleViewportSync);
    viewport?.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("resize", scheduleViewportSync);
    document.addEventListener("focusin", scheduleViewportSync);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(blurTimer1);
      window.clearTimeout(blurTimer2);
      viewport?.removeEventListener("resize", scheduleViewportSync);
      viewport?.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      document.removeEventListener("focusin", scheduleViewportSync);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);
  const close = (exit = null, afterClose = null) => {
    if (!sheet || sheetClosing) return;
    clearTimeout(sheetCloseTimer.current);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setKeyboardOpen(false);

    if (exit?.kind === "drag") {
      const returnFocus = sheetReturnFocusRef.current;
      sheetReturnFocusRef.current = null;
      setSheet(null);
      setSheetClosing(false);
      setSheetExitDuration(SHEET_EXIT_MS);
      setSheetExitFromTransform("translate3d(0, 0, 0)");
      setSheetExitFromOpacity("1");
      sheetCloseTimer.current = null;
      resetDockCompositing();
      afterClose?.();
      if (returnFocus) {
        window.requestAnimationFrame(() => {
          if (
            returnFocus.isConnected &&
            !document.querySelector('[role="dialog"][aria-modal="true"]')
          ) {
            returnFocus.focus({ preventScroll: true });
          }
        });
      }
      return;
    }

    setSheetClosing(true);
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const exitDuration = prefersReducedMotion
      ? SHEET_REDUCED_EXIT_MS
      : SHEET_EXIT_MS;
    setSheetExitDuration(exitDuration);

    sheetCloseTimer.current = window.setTimeout(() => {
      const returnFocus = sheetReturnFocusRef.current;
      sheetReturnFocusRef.current = null;
      setSheet(null);
      setSheetClosing(false);
      setSheetExitDuration(SHEET_EXIT_MS);
      setSheetExitFromTransform("translate3d(0, 0, 0)");
      setSheetExitFromOpacity("1");
      sheetCloseTimer.current = null;
      resetDockCompositing();
      afterClose?.();
      if (returnFocus) {
        window.requestAnimationFrame(() => {
          if (
            returnFocus.isConnected &&
            !document.querySelector('[role="dialog"][aria-modal="true"]')
          ) {
            returnFocus.focus({ preventScroll: true });
          }
        });
      }
    }, exitDuration);
  };

  useEffect(() => {
    if (!sheet && !sheetClosing) {
      resetDockCompositing();
    }
  }, [sheet, sheetClosing, keyboardOpen, resetDockCompositing]);
  const captureSheetTrigger = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button, [role="button"]');
    sheetTriggerCandidateRef.current =
      button && !button.closest(".sh") ? button : null;
  };
  const openSheet = (nextSheet) => {
    clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = null;
    const candidate = sheetTriggerCandidateRef.current;
    const activeElement = document.activeElement;
    sheetReturnFocusRef.current = candidate?.isConnected
      ? candidate
      : activeElement instanceof HTMLElement &&
          activeElement !== document.body &&
          !activeElement.closest(".sh")
        ? activeElement
        : sheetReturnFocusRef.current?.isConnected
          ? sheetReturnFocusRef.current
          : null;
    sheetTriggerCandidateRef.current = null;
    setSheetClosing(false);
    setSheetExitDuration(SHEET_EXIT_MS);
    setSheetExitFromTransform("translate3d(0, 0, 0)");
    setSheetExitFromOpacity("1");
    setSheet(nextSheet);
  };
  const nav = useCallback(
    (t) => {
      if (t === tab && !appSettingsOpen && !profileSettingsOpen) {
        scrollToTop();
        return;
      }
      if (
        document.activeElement instanceof HTMLElement &&
        getActiveScroller()?.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
      if (t !== tab || appSettingsOpen || profileSettingsOpen) {
        triggerHaptic("selection");
      }
      const currentIndex = TABS.findIndex(([key]) => key === tab);
      const nextIndex = TABS.findIndex(([key]) => key === t);
      setSlideDirection(nextIndex >= currentIndex ? "forward" : "backward");
      setAnimateScreen(true);
      setAppSettingsOpen(false);
      setProfileSettingsOpen(false);
      setTab(t);
    },
    [tab, appSettingsOpen, profileSettingsOpen, scrollToTop, getActiveScroller],
  );
  const openExpense = (id) => openSheet({ type: "det", id });
  const openTransaction = (id) => openSheet({ type: "txDet", id });
  const openRecurring = (id) => openSheet({ type: "recDet", id });
  const openBudget = () => openSheet({ type: "bud" });
  const detail =
    sheet?.type === "det" ? S.exp.find((x) => x.id === sheet.id) : null;
  const txDetail =
    sheet?.type === "txDet" ? S.tx.find((x) => x.id === sheet.id) : null;
  const recDetail =
    sheet?.type === "recDet" ? S.rec.find((x) => x.id === sheet.id) : null;

  const lastSubmitAtRef = useRef(0);

  const saveExpense = (f) => {
    const nowMs = Date.now();
    if (nowMs - lastSubmitAtRef.current < 400) return;
    const resolvedCat = f.cat || "Other";
    const isSavingsTransfer =
      resolvedCat === "Savings" && Boolean(getSavingsAccountId(cards));
    const isSavings = resolvedCat === "Savings";
    const isRecurring = f.iv !== "none";
    const parsedAmt = parseAmount(f.amt);

    if (String(f.amt ?? "").trim() !== "") {
      if (parsedAmt === null || !Number.isFinite(parsedAmt) || parsedAmt <= 0) {
        return toast("Enter an amount greater than 0.");
      }
    }

    if (isSavings || isRecurring) {
      if (parsedAmt === null || !Number.isFinite(parsedAmt) || parsedAmt <= 0) {
        if (String(f.amt ?? "").trim() !== "") {
          return toast("Enter an amount greater than 0.");
        }
        return toast(
          isSavings
            ? "Enter an amount for this savings transfer."
            : "Recurring expenses need an amount.",
        );
      }
    }

    const nonSavingsCards = cards.filter(
      (c) =>
        c.id !== getSavingsAccountId(cards) &&
        c.type !== "savings" &&
        c.provider !== "savings",
    );
    const spendableCards = nonSavingsCards.filter((c) => !c.frozen);

    if (isSavingsTransfer && spendableCards.length > 0 && !f.acct)
      return toast("Select an account to transfer from.");

    if (f.acct) {
      const targetCard = cards.find((c) => c.id === f.acct);
      if (targetCard?.frozen) {
        triggerHaptic("warning");
        return toast(
          `${targetCard.name || "This card"} is locked. Unlock it in Card Options first.`,
        );
      }
    }

    const saved = onExpenseSave({
      description:
        f.desc.trim() || (isSavingsTransfer ? "Savings transfer" : resolvedCat),
      amount: f.amt,
      category: resolvedCat,
      date: f.date,
      account: f.acct,
      interval: f.iv,
    });
    if (!saved) {
      if (!f.amt && (isRecurring || isSavings))
        return toast(
          isSavings
            ? "Enter an amount for this savings transfer."
            : "Recurring expenses need an amount.",
        );
      return toast("Check the expense details and try again.");
    }
    lastSubmitAtRef.current = nowMs;
    if (typeof saved === "object" && saved.expenseId) {
      clearTimeout(highlightTimer.current);
      setHighlightedTransactionId(null);
      setHighlightedExpenseId(saved.expenseId);
      highlightTimer.current = setTimeout(() => {
        setHighlightedExpenseId(null);
        setHighlightedTransactionId(null);
      }, 1500);
    }
    if (!isSavingsTransfer) {
      if (cards.length > 0) {
        const nextAccount = f.acct ?? "";
        setPreferredAccount(nextAccount);
        try {
          localStorage.setItem(
            STORAGE_KEYS.preferredAccount || "spend-preferred-account-v1",
            nextAccount,
          );
        } catch {}
      }
    }
    close();
    triggerHaptic("success");
    toast(
      isSavingsTransfer
        ? isRecurring
          ? "Recurring savings scheduled"
          : "Savings transfer added"
        : isRecurring
          ? "Recurring expense scheduled"
          : "Expense added",
    );
  };
  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState(null);

  const requestDeleteExpense = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    if (!expense) return;
    setConfirmDeleteExpense(expense);
  };

  const confirmExecuteDeleteExpense = () => {
    if (!confirmDeleteExpense) return;
    const expense = confirmDeleteExpense;
    setConfirmDeleteExpense(null);
    const undo = onExpenseDelete(expense);
    close();
    triggerHaptic("delete");
    toast("Expense removed", undo);
  };

  const deleteExpenseDirectly = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    if (!expense) return;
    const undo = onExpenseDelete(expense);
    close();
    triggerHaptic("delete");
    toast("Expense removed", undo);
  };

  const deleteExpense = (id) => {
    requestDeleteExpense(id);
  };

  const skipRecurringExpense = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    if (!expense?.rec) return deleteExpenseDirectly(id);
    const undo = onExpenseDelete(expense);
    close();
    triggerHaptic("warning");
    toast("Skipped this recurring occurrence", undo);
  };
  const duplicateExpense = (expense) => {
    const targetCard = expense?.acct
      ? cards.find((c) => c.id === expense.acct)
      : null;
    if (targetCard?.frozen) {
      triggerHaptic("warning");
      toast(
        `${targetCard.name || "This card"} is locked. Unlock it in Card Options first.`,
      );
      return false;
    }
    if (expense?.cat === "Savings") {
      const savingsId = getSavingsAccountId(cards);
      const savingsCard = savingsId
        ? cards.find((c) => c.id === savingsId)
        : null;
      if (savingsCard?.frozen) {
        triggerHaptic("warning");
        toast(
          `${savingsCard.name || "This card"} is locked. Unlock it in Card Options first.`,
        );
        return false;
      }
    }
    const targetDate = expense?.date || ld();
    const saved = onExpenseSave({
      description: expense?.desc || "Expense",
      amount: expense?.amt,
      category: expense?.cat || "Other",
      date: targetDate,
      account: expense?.acct,
      interval: "none",
    });
    if (!saved) {
      toast("Could not duplicate this expense.");
      return false;
    }
    if (typeof saved === "object" && saved.expenseId) {
      clearTimeout(highlightTimer.current);
      setHighlightedExpenseId(saved.expenseId);
      highlightTimer.current = setTimeout(
        () => setHighlightedExpenseId(null),
        1500,
      );
    }
    triggerHaptic("success");
    toast("Expense duplicated");
    return true;
  };
  const updateExpense = (id, form) => {
    const amount = parseAmount(form.amt);
    const isSavings = form.cat === "Savings";
    if (
      !form.desc.trim() ||
      !form.date ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (isSavings && (amount === null || amount <= 0))
    ) {
      if (isSavings && (amount === null || amount <= 0)) {
        return toast("Savings transfer requires an amount.");
      }
      return toast("Check the description, amount, and date.");
    }
    const savingsId = getSavingsAccountId(cards);
    const savingsCard = savingsId
      ? cards.find((c) => c.id === savingsId)
      : null;
    if (isSavings && savingsCard?.frozen) {
      triggerHaptic("warning");
      return toast(
        `${savingsCard.name || "Savings account"} is locked. Unlock it in Card Options first.`,
      );
    }
    if (
      isSavings &&
      (!form.acct || form.acct === "cash") &&
      Boolean(savingsId)
    ) {
      return toast("Select an account to transfer from.");
    }
    if (form.acct) {
      const targetCard = cards.find((c) => c.id === form.acct);
      if (targetCard?.frozen) {
        triggerHaptic("warning");
        return toast(
          `${targetCard.name || "This card"} is locked. Unlock it in Card Options first.`,
        );
      }
    }
    if (
      !onExpenseUpdate(id, {
        description: form.desc.trim(),
        amount,
        category: form.cat,
        date: form.date,
        account: form.acct,
      })
    )
      return toast("Could not update this expense.");
    close();
    clearTimeout(highlightTimer.current);
    setHighlightedTransactionId(null);
    setHighlightedExpenseId(id);
    highlightTimer.current = setTimeout(() => {
      setHighlightedExpenseId(null);
      setHighlightedTransactionId(null);
    }, 1500);
    triggerHaptic("success");
    toast("Expense updated");
  };
  const saveBudget = (value) => {
    if (!Number.isFinite(value) || value <= 0)
      return toast("Enter a monthly budget.");
    onBudgetSave(value);
    close();
    triggerHaptic("success");
    toast("Budget saved");
  };
  const clearBudget = () => {
    const undo = onBudgetClear();
    close();
    triggerHaptic("delete");
    toast("Budget cleared", undo);
  };
  const saveTransaction = (value) => {
    const nowMs = Date.now();
    if (nowMs - lastSubmitAtRef.current < 400) return;
    const saved = onTransactionSave(value);
    if (!saved) return toast("Enter a valid amount.");
    lastSubmitAtRef.current = nowMs;
    if (typeof saved === "object" && saved.transactionId) {
      clearTimeout(highlightTimer.current);
      setHighlightedExpenseId(null);
      setHighlightedTransactionId(saved.transactionId);
      highlightTimer.current = setTimeout(() => {
        setHighlightedExpenseId(null);
        setHighlightedTransactionId(null);
      }, 1500);
    }
    close();
    triggerHaptic("success");
    toast("Saved");
  };
  const updateTransaction = (id, value) => {
    const updated = onTransactionUpdate?.(id, value);
    if (!updated) return toast("Enter a valid amount.");
    close();
    clearTimeout(highlightTimer.current);
    setHighlightedExpenseId(null);
    setHighlightedTransactionId(id);
    highlightTimer.current = setTimeout(() => {
      setHighlightedExpenseId(null);
      setHighlightedTransactionId(null);
    }, 1500);
    triggerHaptic("success");
    toast("Transaction updated");
  };
  const deleteTransaction = (id) => {
    const tx = S.tx.find((item) => item.id === id);
    if (!tx) return;
    const undo = onTransactionDelete?.(tx);
    close();
    triggerHaptic("delete");
    toast("Transaction removed", undo);
  };
  const updateRecurring = (id, form) => {
    const amount = parseAmount(form.amt);
    const isSavings = form.cat === "Savings";
    if (
      !form.desc?.trim() ||
      !form.next ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return toast(
        isSavings
          ? "Recurring savings need an amount and description."
          : "Recurring expenses need an amount and description.",
      );
    }
    const savingsId = getSavingsAccountId(cards);
    if (
      isSavings &&
      (!form.acct || form.acct === "cash") &&
      Boolean(savingsId)
    ) {
      return toast("Select an account to transfer from.");
    }
    if (form.acct && form.acct !== "cash") {
      const targetCard = cards.find((c) => c.id === form.acct);
      if (targetCard?.frozen) {
        triggerHaptic("warning");
        return toast(
          `${targetCard.name || "This card"} is locked. Unlock it in Card Options first.`,
        );
      }
    }
    if (isSavings && savingsId) {
      const savingsCard = cards.find((c) => c.id === savingsId);
      if (savingsCard?.frozen) {
        triggerHaptic("warning");
        return toast(
          `${savingsCard.name || "This card"} is locked. Unlock it in Card Options first.`,
        );
      }
    }
    const updated = onUpdateRec?.(id, {
      description: form.desc.trim(),
      amount,
      category: form.cat,
      interval: form.iv,
      nextDate: form.next,
      account: form.acct,
      active: Boolean(form.on),
    });
    if (!updated) {
      return toast("Could not update this recurring expense.");
    }
    close();
    triggerHaptic("success");
    toast(
      isSavings ? "Recurring savings updated" : "Recurring expense updated",
    );
  };
  const removeRecurring = (id) => {
    const undo = onRemoveRec(id);
    close();
    triggerHaptic("delete");
    toast("Recurring expense removed", undo);
  };
  const advanced = () => {
    close(null, () => {
      tabScrollTopRef.current["app-settings"] = 0;
      setSlideDirection("forward");
      setProfileSettingsOpen(false);
      setAppSettingsOpen(true);
      setAnimateScreen(true);
    });
  };
  const openProfileSettings = () => {
    close(null, () => {
      tabScrollTopRef.current["profile-settings"] = 0;
      setSlideDirection("forward");
      setAppSettingsOpen(false);
      setProfileSettingsOpen(true);
      setAnimateScreen(true);
    });
  };
  const backToSettings = () => {
    setSlideDirection("backward");
    setProfileSettingsOpen(false);
    setAppSettingsOpen(false);
    openSheet({ type: "set" });
    setAnimateScreen(true);
  };
  const signIn = () => onSignIn?.();

  const settingsRoute = appSettingsOpen || profileSettingsOpen;

  // P0 #1: Android Hardware Back & Chrome/PWA Edge-Swipe Back Navigation
  // Priority: Confirm modals -> Active sheets -> Settings sub-routes -> Non-Home tabs -> Exit at root
  const backNavStateRef = useRef(null);
  const historyGuardArmedRef = useRef(false);
  backNavStateRef.current = {
    isAppLocked,
    sheet,
    sheetClosing,
    confirmDeleteExpense,
    resetPinConfirmOpen,
    profileSettingsOpen,
    appSettingsOpen,
    tab,
    close,
    nav,
  };

  const isNonRootLayer =
    !isAppLocked &&
    (Boolean(sheet) ||
      Boolean(confirmDeleteExpense) ||
      Boolean(resetPinConfirmOpen) ||
      Boolean(profileSettingsOpen) ||
      Boolean(appSettingsOpen) ||
      tab !== "home");

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !isAndroidPlatform() ||
      !window.history?.pushState
    ) {
      return;
    }
    if (isNonRootLayer && !historyGuardArmedRef.current) {
      try {
        window.history.pushState(
          { __spendBackGuard: true },
          "",
          window.location.href,
        );
        historyGuardArmedRef.current = true;
      } catch {}
    }
  }, [isNonRootLayer, isAppLocked, sheet?.type, profileSettingsOpen, appSettingsOpen, tab]);

  useEffect(() => {
    if (typeof window === "undefined" || !isAndroidPlatform()) return undefined;

    const handleBackStep = () => {
      const st = backNavStateRef.current;
      if (!st || st.isAppLocked) return false;
      if (st.resetPinConfirmOpen) {
        setResetPinConfirmOpen(false);
        return "resetPinConfirm";
      }
      if (document.querySelector(".sl.sl--open")) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        return "dropdown";
      }
      if (st.confirmDeleteExpense) {
        setConfirmDeleteExpense(null);
        return "confirmDelete";
      }
      const innerSheetBackBtn = document.querySelector(
        ".security-sheet-back-btn, .add-card-back-btn",
      );
      if (
        innerSheetBackBtn instanceof HTMLElement &&
        !innerSheetBackBtn.hasAttribute("disabled")
      ) {
        innerSheetBackBtn.click();
        return "innerSheet";
      }
      if (st.sheet && !st.sheetClosing) {
        st.close();
        return "sheet";
      }
      if (st.profileSettingsOpen || st.appSettingsOpen) {
        setSlideDirection("backward");
        setProfileSettingsOpen(false);
        setAppSettingsOpen(false);
        setAnimateScreen(true);
        return "settings";
      }
      if (st.tab !== "home") {
        st.nav("home");
        return "tab";
      }
      return false;
    };

    const onPopState = () => {
      historyGuardArmedRef.current = false;
      const st = backNavStateRef.current;
      const handled = handleBackStep();
      if (handled && st && !st.isAppLocked) {
        // Re-arm synchronously if another non-root layer remains so rapid double-back swipes cannot race past the guard
        const remainsDeep =
          (handled !== "resetPinConfirm" && Boolean(st.resetPinConfirmOpen)) ||
          (handled !== "confirmDelete" && Boolean(st.confirmDeleteExpense)) ||
          (handled !== "sheet" && Boolean(st.sheet)) ||
          (handled !== "settings" &&
            (Boolean(st.profileSettingsOpen) || Boolean(st.appSettingsOpen))) ||
          (handled !== "tab" && st.tab !== "home");
        if (remainsDeep && !historyGuardArmedRef.current) {
          try {
            window.history.pushState(
              { __spendBackGuard: true },
              "",
              window.location.href,
            );
            historyGuardArmedRef.current = true;
          } catch {}
        }
      }
    };

    window.addEventListener("popstate", onPopState);

    let capBackListener = null;
    const appPlugin = CapacitorApp || window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      try {
        capBackListener = appPlugin.addListener(
          "backButton",
          ({ canGoBack } = {}) => {
            const handled = handleBackStep();
            if (handled) return;
            if (canGoBack && window.history.length > 1) {
              window.history.back();
              return;
            }
            if (typeof appPlugin.minimizeApp === "function") {
              appPlugin.minimizeApp().catch(() => {
                appPlugin.exitApp?.();
              });
            } else {
              appPlugin.exitApp?.();
            }
          },
        );
      } catch {}
    }

    return () => {
      window.removeEventListener("popstate", onPopState);
      Promise.resolve(capBackListener)
        .then((h) => h?.remove?.())
        .catch(() => {});
    };
  }, []);
  const activeMonthLabel = fM(S.m);
  const screenKey = profileSettingsOpen
    ? "profile-settings"
    : appSettingsOpen
      ? "app-settings"
      : tab;

  const headerRightActions = !settingsRoute ? (
    <>
      {tab === "home" ? (
        <button
          className={`prototype-header-avatar${profile?.avatar ? " has-photo" : ""}`}
          type="button"
          aria-label="Profile and settings"
          onClick={() => openSheet({ type: "set" })}
        >
          {profile?.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="mfs-avatar-img"
              draggable="false"
            />
          ) : (
            profile?.initial || "A"
          )}
        </button>
      ) : tab === "activity" ? (
        <MonthSwitch m={S.m} onShift={onShift} />
      ) : tab === "accounts" ? (
        <button
          className="prototype-header-action"
          type="button"
          aria-label="Add new card"
          title="Add Card"
          onClick={() => {
            triggerHaptic("light");
            openSheet({ type: "addCard" });
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="5" width="20" height="14" rx="3" />
            <line x1="2" y1="10" x2="22" y2="10" />
            <circle cx="7" cy="15" r="1.5" fill="currentColor" />
          </svg>
        </button>
      ) : plan === "budget" ? (
        <button
          className="prototype-header-action"
          type="button"
          aria-label="Set monthly budget"
          title="Set monthly budget"
          onClick={openBudget}
        >
          <Icon n="plans" />
        </button>
      ) : null}
    </>
  ) : null;

  if (isAppLocked) {
    return (
      <div
        ref={(node) => {
          mobileRootRef.current = node;
          screenRootRef.current = node;
        }}
        className="mobile-prototype is-locked-screen"
        data-theme={resolvedTheme}
        data-platform={platform}
      >
        <Suspense fallback={null}>
          <SpendLogin
            verifyPin={handleVerifyPin}
            getLockoutSeconds={getPinLockoutRemainingSeconds}
            biometric={
              hasBiometricsConfigured()
                ? {
                    type: platform === "ios" ? "face" : "fingerprint",
                    label:
                      platform === "android"
                        ? "Fingerprint / Biometrics"
                        : platform === "ios"
                          ? "Face ID / Touch ID"
                          : "Biometrics",
                  }
                : null
            }
            onBiometric={handleBiometricAuth}
            onUnlock={handleUnlock}
            onForgot={handleForgotPin}
          />
        </Suspense>
        <ResetPinModal
          isOpen={resetPinConfirmOpen}
          onConfirm={handleConfirmResetPin}
          onCancel={() => setResetPinConfirmOpen(false)}
        />
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        screenRootRef.current = node;
        mobileRootRef.current = node;
      }}
      className={`mobile-prototype ${resolvedTheme === "dark" ? "dark" : ""}`}
      onClickCapture={captureSheetTrigger}
      data-theme={resolvedTheme}
      data-platform={platform}
      data-sheet-open={sheet ? "true" : undefined}
      data-sheet-closing={sheetClosing ? "true" : undefined}
      style={{
        "--sheet-exit-duration": `${sheetExitDuration}ms`,
        "--sheet-fade-duration": `${Math.round(sheetExitDuration * 0.88)}ms`,
        "--sheet-exit-from-transform": sheetExitFromTransform,
        "--sheet-exit-from-opacity": sheetExitFromOpacity,
      }}
    >
      <CollapsibleTopBar
        activeTab={tab}
        monthLabel={activeMonthLabel}
        onScrollToTop={scrollToTop}
        rightActions={headerRightActions}
        settingsRoute={settingsRoute}
        onBack={backToSettings}
        settingsTitle={profileSettingsOpen ? "Profile" : "App settings"}
      />

      <div
        id="app"
        className="prototype-tabs-stage"
        key={settingsRoute ? screenKey : "main-tabs"}
        onTouchStart={(e) => {
          if (
            settingsRoute ||
            sheet ||
            ptrState.phase === "refreshing" ||
            e.touches.length !== 1
          )
            return;
          const scroller = getActiveScroller();
          if (!scroller || scroller.scrollTop > 2) return;
          if (
            e.target.closest?.(
              ".cards-deck-stage, .stack, .chips, .account-picker-container",
            )
          )
            return;
          ptrGestureRef.current = {
            active: true,
            pulling: false,
            startY: e.touches[0].clientY,
            startX: e.touches[0].clientX,
            passedThreshold: false,
          };
        }}
        onTouchMove={(e) => {
          const g = ptrGestureRef.current;
          if (!g.active || sheet || e.touches.length !== 1) return;
          const scroller = getActiveScroller();
          if (!scroller || scroller.scrollTop > 2) {
            g.active = false;
            if (ptrState.pullY > 0) setPtrState({ pullY: 0, phase: "idle" });
            return;
          }
          const dy = e.touches[0].clientY - g.startY;
          const dx = e.touches[0].clientX - g.startX;
          if (!g.pulling) {
            if (dy > 10 && dy > Math.abs(dx) * 1.25) {
              g.pulling = true;
            } else if (Math.abs(dx) > 10 || dy < -4) {
              g.active = false;
              return;
            } else {
              return;
            }
          }
          const damped = Math.min(
            96,
            Math.round(Math.pow(Math.max(0, dy - 10), 0.78) * 2.1),
          );
          const ready = damped >= 56;
          if (ready && !g.passedThreshold) {
            g.passedThreshold = true;
            triggerHaptic("selection");
          } else if (!ready && g.passedThreshold) {
            g.passedThreshold = false;
          }
          setPtrState({ pullY: damped, phase: ready ? "ready" : "pulling" });
        }}
        onTouchEnd={() => {
          const g = ptrGestureRef.current;
          if (!g.active) return;
          g.active = false;
          if (ptrState.phase === "ready") {
            triggerHaptic("medium");
            setPtrState({ pullY: 48, phase: "refreshing" });
            if (typeof window !== "undefined") {
              window.__spendCheckForUpdates?.({ force: true, manual: true });
            }
            if (profile?.connected && onResumeSync) {
              try {
                onResumeSync();
              } catch {}
            }
            window.setTimeout(() => {
              triggerHaptic("success");
              setPtrState({ pullY: 0, phase: "idle" });
            }, 680);
          } else if (ptrState.pullY > 0) {
            setPtrState({ pullY: 0, phase: "idle" });
          }
        }}
        onTouchCancel={() => {
          ptrGestureRef.current.active = false;
          if (ptrState.pullY > 0) setPtrState({ pullY: 0, phase: "idle" });
        }}
      >
        {(ptrState.pullY > 0 || ptrState.phase === "refreshing") && (
          <div
            className={`ptr-container is-${ptrState.phase}`}
            style={{ height: `${ptrState.pullY}px` }}
            aria-live="polite"
          >
            <div
              className="ptr-pill"
              style={{
                transform: `scale(${Math.min(1, 0.65 + ptrState.pullY / 110).toFixed(2)})`,
                opacity: Math.min(1, ptrState.pullY / 36).toFixed(2),
              }}
            >
              <svg
                className="ptr-spinner"
                viewBox="0 0 24 24"
                style={
                  ptrState.phase !== "refreshing"
                    ? {
                        transform: `rotate(${Math.round(ptrState.pullY * 3.8)}deg)`,
                      }
                    : undefined
                }
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              <span>
                {ptrState.phase === "refreshing"
                  ? profile?.connected
                    ? "Syncing…"
                    : "Refreshing…"
                  : ptrState.phase === "ready"
                    ? "Release to refresh"
                    : "Pull to refresh"}
              </span>
            </div>
          </div>
        )}

        {profileSettingsOpen ? (
          <div
            ref={registerTabScroller("profile-settings")}
            data-tab="profile-settings"
            className={`prototype-tab-panel is-settings-panel is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}`}
          >
            <ScreenLargeTitle
              title="Profile"
              className="is-settings-large-title"
            />
            <ProfileSettingsPage
              S={S}
              profile={profile}
              cloudSyncEnabled={cloudSyncEnabled}
              cloudSyncReady={cloudSyncReady}
              normalizedAccountSync={normalizedAccountSync}
              cloudRealtimeStatus={cloudRealtimeStatus}
              cloudSyncActivity={cloudSyncActivity}
              accountStatus={accountStatus}
              profileStatus={profileStatus}
              authBusy={authBusy}
              onEditProfile={onEditProfile}
              onAvatarChange={onAvatarChange}
              onManageCards={() => nav("accounts")}
              onSignIn={signIn}
              onSignOut={onSignOut}
              onResumeSync={onResumeSync}
            />
          </div>
        ) : appSettingsOpen ? (
          <div
            ref={registerTabScroller("app-settings")}
            data-tab="app-settings"
            className={`prototype-tab-panel is-settings-panel is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}`}
          >
            <ScreenLargeTitle
              title="App settings"
              className="is-settings-large-title"
            />
            <AppSettingsPage
              S={S}
              profile={profile}
              pushBackendConfigured={pushBackendConfigured}
              notificationPermission={notificationPermission}
              notificationStatus={notificationStatus}
              backgroundPushEnabled={backgroundPushEnabled}
              onReminder={onReminder}
              onToggleNotifications={onToggleNotifications}
              onTestNotification={onTestNotification}
              onBackupDownload={onBackupDownload}
              onEncryptedBackupDownload={onEncryptedBackupDownload}
              onExpensesCsv={onExpensesCsv}
              onBackupRestore={onBackupRestore}
              backupStatus={backupStatus}
              backupCheckpoints={backupCheckpoints}
              checkpointsLoading={checkpointsLoading}
              checkpointBusyId={checkpointBusyId}
              onCreateCheckpoint={onCreateCheckpoint}
              onRestoreCheckpoint={onRestoreCheckpoint}
              onRefreshCheckpoints={onRefreshCheckpoints}
              sqlHealth={sqlHealth}
              sqlHealthChecking={sqlHealthChecking}
              onVerifySqlAndSync={onVerifySqlAndSync}
              updateAvailable={updateAvailable}
              updateInfo={updateInfo}
              checkingForUpdate={checkingForUpdate}
              updateCheckStatus={updateCheckStatus}
              onCheckForUpdates={onCheckForUpdates}
              onOpenUpdateModal={onOpenUpdateModal}
              onToast={toast}
            />
          </div>
        ) : (
          <>
            <div
              ref={registerTabScroller("home")}
              data-tab="home"
              className={`prototype-tab-panel ${tab === "home" ? `is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}` : "is-inactive"}`}
              inert={tab !== "home" ? true : undefined}
              hidden={tab !== "home"}
            >
              <ScreenLargeTitle title="Spend" />
              <Home
                S={S}
                profile={profile}
                onShift={onShift}
                onTab={(nextTab) => {
                  if (nextTab === "activity") {
                    setCf("");
                    setQ("");
                  }
                  nav(nextTab);
                }}
                onCategory={(category) => {
                  setCf(category);
                  setQ("");
                  nav("activity");
                }}
                onBudget={openBudget}
                onOpen={openExpense}
                onDelete={deleteExpenseDirectly}
                onSkip={skipRecurringExpense}
                onDuplicate={duplicateExpense}
                highlightedExpenseId={highlightedExpenseId}
              />
            </div>

            <div
              ref={registerTabScroller("activity")}
              data-tab="activity"
              className={`prototype-tab-panel is-activity ${tab === "activity" ? `is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}` : "is-inactive"}`}
              inert={tab !== "activity" ? true : undefined}
              hidden={tab !== "activity"}
            >
              <Activity
                S={S}
                onShift={onShift}
                onScrollToTop={scrollToTop}
                q={q}
                setQ={setQ}
                cf={cf}
                setCf={setCf}
                onOpen={openExpense}
                onDelete={deleteExpenseDirectly}
                onSkip={skipRecurringExpense}
                onDuplicate={duplicateExpense}
                onOpenTransaction={openTransaction}
                onDeleteTransaction={deleteTransaction}
                searchRef={activitySearchRef}
                highlightedExpenseId={highlightedExpenseId}
                highlightedTransactionId={highlightedTransactionId}
              />
            </div>

            <div
              ref={registerTabScroller("accounts")}
              data-tab="accounts"
              className={`prototype-tab-panel ${tab === "accounts" ? `is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}` : "is-inactive"}`}
              inert={tab !== "accounts" ? true : undefined}
              hidden={tab !== "accounts"}
            >
              <ScreenLargeTitle title="Accounts" />
              <Accounts
                S={S}
                onTx={(t, acct) => openSheet({ type: "tx", t, acct })}
                onAddCardClick={() => openSheet({ type: "addCard" })}
                onOpenCardOptions={(cardId) =>
                  openSheet({ type: "cardOptions", cardId })
                }
                highlightedExpenseId={highlightedExpenseId}
                highlightedTransactionId={highlightedTransactionId}
                onTab={nav}
                onOpenExpense={openExpense}
                onOpenTransaction={openTransaction}
                onDeleteExpense={deleteExpenseDirectly}
                onDeleteTransaction={deleteTransaction}
                onDuplicateExpense={duplicateExpense}
                onLockedCardNotice={(cardName) =>
                  toast(
                    `${cardName || "This card"} is locked. Unlock it in Card Options first.`,
                  )
                }
                onAddExpense={(acct) => openSheet({ type: "add", acct })}
                initialSelectedAccount={
                  activeAccountId || activeAccountRef.current
                }
                onActiveAccountChange={syncActiveAccount}
              />
            </div>

            <div
              ref={registerTabScroller("plans")}
              data-tab="plans"
              className={`prototype-tab-panel is-plans ${tab === "plans" ? `is-active${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}` : "is-inactive"}`}
              inert={tab !== "plans" ? true : undefined}
              hidden={tab !== "plans"}
            >
              <Plans
                S={S}
                plan={plan}
                setPlan={setPlan}
                isActive={tab === "plans" && !settingsRoute}
                onShift={onShift}
                onBudget={openBudget}
                onBudgetInsights={() => openSheet({ type: "budInsights" })}
                onAddRec={() => openSheet({ type: "add", iv: "monthly" })}
                onOpenRec={openRecurring}
                onToggleRec={onToggleRec}
              />
            </div>
          </>
        )}
      </div>

      <nav
        ref={dockRef}
        className="dock"
        aria-label="Main"
        data-keyboard-open={keyboardOpen ? "true" : undefined}
        data-hidden={keyboardOpen || settingsRoute ? "true" : undefined}
        aria-hidden={keyboardOpen || settingsRoute ? "true" : undefined}
        inert={keyboardOpen || settingsRoute ? true : undefined}
      >
        {/* Single masked frosted-glass surface with center + notch */}
        <div className="dock__surface" aria-hidden="true" />
        {/* 0.5px top hairline following the bar and notch contour */}
        <div className="dock__border" aria-hidden="true">
          <div className="dock__border-side" />
          <svg
            className="dock__border-notch"
            width={DOCK_NOTCH_W}
            height={DOCK_BAR_H}
            viewBox={`0 0 ${DOCK_NOTCH_W} ${DOCK_BAR_H}`}
            aria-hidden="true"
          >
            <path d={DOCK_NOTCH_CURVE_D} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="dock__border-side" />
        </div>

        {/* Tabs */}
        <div className="dock__tabs">
          <div className="dock__tab-group">
            {TABS.slice(0, 2).map(([t, l]) => {
              const isActive =
                !appSettingsOpen && !profileSettingsOpen && tab === t;
              const dockIcon = DOCK_ICONS[t];
              return (
                <button
                  key={t}
                  className={`tab${isActive ? " is-active" : ""}`}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => nav(t)}
                >
                  <span className="tab__icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {dockIcon
                        ? isActive
                          ? dockIcon.active
                          : dockIcon.inactive
                        : ICONS[t]}
                    </svg>
                  </span>
                  <span className="tab__label">{l}</span>
                </button>
              );
            })}
          </div>
          <div aria-hidden="true" />
          <div className="dock__tab-group">
            {TABS.slice(3).map(([t, l]) => {
              const isActive =
                !appSettingsOpen && !profileSettingsOpen && tab === t;
              const dockIcon = DOCK_ICONS[t];
              return (
                <button
                  key={t}
                  className={`tab${isActive ? " is-active" : ""}`}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => nav(t)}
                >
                  <span className="tab__icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {dockIcon
                        ? isActive
                          ? dockIcon.active
                          : dockIcon.inactive
                        : ICONS[t]}
                    </svg>
                  </span>
                  <span className="tab__label">{l}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center action */}
        <button
          className="dock__fab"
          type="button"
          aria-label={
            tab === "plans" && plan === "rec" ? "Add recurring" : "Add"
          }
          onClick={() => {
            triggerHaptic("light");
            if (tab === "plans" && plan === "rec") {
              openSheet({ type: "add", iv: "monthly" });
              return;
            }
            const activeAcct =
              tab === "accounts" && activeAccountRef.current !== undefined
                ? activeAccountRef.current
                : undefined;
            const savingsId = getSavingsAccountId(cards);
            const activeCard = cards.find((c) => c.id === activeAcct);
            const isSavingsVault =
              activeAcct &&
              (activeAcct === savingsId ||
                activeCard?.type === "savings" ||
                activeCard?.category === "savings" ||
                activeCard?.provider === "savings");
            openSheet({
              type: "add",
              ...(isSavingsVault
                ? { cat: "Savings" }
                : activeAcct !== undefined
                  ? { acct: activeAcct }
                  : {}),
            });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {ICONS.plus}
          </svg>
        </button>
      </nav>

      {sheet?.type === "cardOptions" && (
        <CardOptionsSheet
          initialCardId={sheet.cardId}
          cards={cards}
          balances={Object.fromEntries(cards.map((c) => [c.id, bal(S, c.id)]))}
          startBalances={S?.start || {}}
          onClose={close}
          onUpdateCard={(updated, customToast) => {
            onUpdateCard?.(updated);
            toast(customToast || "Card updated");
          }}
          onDeleteCard={(cardId) => {
            const remainingNonSavings = cards.filter(
              (c) =>
                c.id !== cardId &&
                c.id !== getSavingsAccountId(cards) &&
                c.type !== "savings" &&
                c.category !== "savings" &&
                c.provider !== "savings",
            );
            if (preferredAccount === cardId) {
              const fallbackCard =
                remainingNonSavings.find((c) => c.isPrimary && !c.frozen) ||
                remainingNonSavings.find((c) => !c.frozen) ||
                remainingNonSavings[0];
              handlePreferredAccountChange(fallbackCard?.id || "");
            }
            const undo = onDeleteCard?.(cardId);
            toast("Card removed", undo);
          }}
          onAddCardClick={() => openSheet({ type: "addCard" })}
          onAdjustBalance={(cardId) =>
            openSheet({ type: "tx", t: "adjust", acct: cardId })
          }
          onSyncCashBalance={(cardId, diff) => {
            if (!cardId || !Number.isFinite(diff) || Math.abs(diff) < 0.01)
              return;
            const res = onTransactionSave?.({
              type: "adjust",
              acct: cardId,
              dir: diff > 0 ? "up" : "down",
              amt: Math.abs(diff),
              note: "Correction",
              date: ld(),
            });
            if (res !== false) {
              toast("Cash balance synced");
            }
          }}
          onSetPrimaryCard={(cardId) => {
            const res = onSetPrimaryCard?.(cardId);
            const isPrimary =
              res && typeof res === "object" ? res.isPrimary : true;
            if (isPrimary && cardId) {
              handlePreferredAccountChange(cardId);
            } else if (!isPrimary && preferredAccount === cardId) {
              const fallbackCard = cards.find(
                (c) =>
                  c.id !== cardId &&
                  !c.frozen &&
                  c.id !== getSavingsAccountId(cards) &&
                  c.type !== "savings" &&
                  c.category !== "savings" &&
                  c.provider !== "savings",
              );
              handlePreferredAccountChange(fallbackCard?.id || "");
            }
            if (res && typeof res === "object") {
              const msg = res.isPrimary
                ? "Set as primary card ★"
                : "Removed primary card";
              toast(msg, res.undo);
            } else {
              toast("Primary card updated ★");
            }
          }}
          onMoveCardToFront={(cardId) => {
            if (cardId) syncActiveAccount(cardId);
            onMoveCardToFront?.(cardId);
            toast("Card moved to top");
          }}
          onSelectCard={syncActiveAccount}
          onToast={toast}
        />
      )}
      {sheet?.type === "addCard" && (
        <AddCardSheet
          onClose={close}
          cards={cards}
          onOpenExistingCard={(cardId) =>
            openSheet({ type: "cardOptions", cardId })
          }
          onToast={toast}
          onAddCard={(newCard) => {
            const added = onAddCard?.(newCard);
            const cardId = added?.id || newCard?.id;
            const nonSavings = cards.filter(
              (c) =>
                c.id !== getSavingsAccountId(cards) &&
                c.type !== "savings" &&
                c.category !== "savings" &&
                c.provider !== "savings",
            );
            const isFirstNonSavings = nonSavings.length === 0;
            const isSavings =
              newCard?.category === "savings" ||
              newCard?.type === "savings" ||
              newCard?.provider === "savings";
            if (
              !isSavings &&
              (newCard?.isPrimary || isFirstNonSavings) &&
              cardId
            ) {
              handlePreferredAccountChange(cardId);
            }
          }}
          userProfileName={profile?.hasName ? profile.name : ""}
        />
      )}
      {sheet?.type === "add" && (
        <AddSheet
          iv={sheet.iv}
          categoryOrder={categoryOrder}
          expenses={S.exp}
          cards={cards}
          defaultAccount={sheet.acct}
          preferredAccount={preferredAccount}
          initialCategory={sheet.cat || ""}
          onAccountChange={handlePreferredAccountChange}
          onSave={saveExpense}
          onSaveTx={saveTransaction}
          onClose={close}
          onLockedCardNotice={(cardName) =>
            toast(
              `${cardName || "This card"} is locked. Unlock it in Card Options first.`,
            )
          }
        />
      )}
      {sheet?.type === "tx" && (
        <TxSheet
          type={sheet.t}
          defaultAccount={sheet.acct}
          cards={cards}
          onSave={saveTransaction}
          onClose={close}
          onLockedCardNotice={(cardName) =>
            toast(
              `${cardName || "This card"} is locked. Unlock it in Card Options first.`,
            )
          }
        />
      )}
      {txDetail && (
        <AccountTxDetailSheet
          key={txDetail.id}
          tx={txDetail}
          cards={cards}
          deletedCards={S?.deletedCards}
          onSave={updateTransaction}
          onDelete={deleteTransaction}
          onClose={close}
        />
      )}
      {detail && (
        <DetailSheet
          key={detail.id}
          e={detail}
          expenses={S.exp}
          suggestion={suggestedCategory(detail.desc, S.exp, detail.id)}
          cards={cards}
          deletedCards={S?.deletedCards}
          onSave={updateExpense}
          onDelete={deleteExpense}
          onClose={close}
        />
      )}
      {recDetail && (
        <RecurringDetailSheet
          key={recDetail.id}
          r={recDetail}
          expenses={S.exp}
          cards={cards}
          deletedCards={S?.deletedCards}
          onSave={updateRecurring}
          onDelete={removeRecurring}
          onClose={close}
        />
      )}
      {sheet?.type === "bud" && (
        <BudgetSheet
          S={S}
          onSave={saveBudget}
          onClear={clearBudget}
          onClose={close}
        />
      )}
      {sheet?.type === "budInsights" && (
        <BudgetInsightsSheet
          S={S}
          onEditBudget={openBudget}
          onClose={close}
        />
      )}
      {sheet?.type === "set" && (
        <SettingsSheet
          S={S}
          profile={profile}
          hapticsEnabled={hapticsEnabled}
          onToggleHaptics={handleToggleHaptics}
          onClose={close}
          onTheme={onTheme}
          onAdvanced={advanced}
          onProfileSettings={openProfileSettings}
          onSecurity={() => openSheet({ type: "sec" })}
        />
      )}
      {sheet?.type === "sec" && (
        <SecuritySheet
          onClose={close}
          onBack={() => {
            triggerHaptic("selection");
            openSheet({ type: "set" });
          }}
          onLockNow={() => {
            close();
            lockAppManually();
            setIsAppLocked(true);
          }}
        />
      )}

      <ConfirmationModal
        isOpen={Boolean(confirmDeleteExpense)}
        title="Delete Expense?"
        message={
          confirmDeleteExpense
            ? `Are you sure you want to delete "${confirmDeleteExpense.desc || "this expense"}"${confirmDeleteExpense.amt != null ? ` (${M(confirmDeleteExpense.amt)})` : ""}?`
            : ""
        }
        confirmLabel="Yes, Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={confirmExecuteDeleteExpense}
        onCancel={() => setConfirmDeleteExpense(null)}
      />

      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg.msg}
          {toastMsg.undo && (
            <button
              type="button"
              aria-label={`Undo ${toastMsg.msg.toLocaleLowerCase()}`}
              onClick={() => {
                toastMsg.undo();
                setToastMsg(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {isPrivacyShielded && (
        <div className="app-privacy-shield" aria-hidden="true">
          <div className="app-privacy-shield-badge">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <rect x="9" y="11" width="6" height="5" rx="1" />
              <path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11" />
            </svg>
          </div>
          <b>Spend Protected</b>
        </div>
      )}
    </div>
  );
}
