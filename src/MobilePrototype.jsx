import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { FaPenToSquare } from "react-icons/fa6";
import {
  ACCOUNT_OPTIONS,
  DEFAULT_CARDS,
  getSavingsAccountId,
  parseAmount,
  STORAGE_KEYS,
} from "./data.js";
import {
  StackedCardDeck,
  WalletCard,
  renderProviderLogo,
  formatCardNumber,
  formatExpiry,
  formatMoney,
} from "./AccountsCardDeck.jsx";
import {
  CARD_PROVIDERS,
  VisaBadge,
  MastercardBadge,
  AmexBadge,
  MiniCardPreview,
} from "./cardAssets.jsx";
import {
  CategorySymbol,
  TransactionSymbol,
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
} from "./categoryAssets.jsx";
import {
  setAppPin,
  verifyAppPin,
  getPinLockoutRemainingSeconds,
  hasAppPin,
  removeAppPin,
  isBiometricsAvailable,
  hasBiometricsConfigured,
  enableBiometrics,
  disableBiometrics,
  authenticateWithBiometrics,
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  markActive,
  markBackgrounded,
  isSessionUnlocked,
  shouldLockApp,
  lockAppManually,
} from "./security.js";
import MonthEndBanner from "./components/MonthEndBanner.jsx";
import SpendLogin from "./components/SpendLogin.jsx";
import "./MobilePrototype.css";

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
function getAccountDisplay(id, cards = []) {
  const match = cards.find((c) => c.id === id);
  if (match) return [match.name, match.color || "#2563a8"];
  if (!id || id === "cash") return ["Cash", "#10b981"];
  return [id || "Account", "#2563a8"];
}
const TABS = [
  ["home", "Home"],
  ["activity", "Activity"],
  ["add"],
  ["accounts", "Accounts"],
  ["plans", "Plans"],
];
const SHEET_EXIT_MS = 280;
const SHEET_REDUCED_EXIT_MS = 160;

const BK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 128 122'%3E%3Cg fill='none'%3E%3Cpath fill='%23D12053' d='M96.58 62.45l-53.03-8.31 7.03 31.6z'/%3E%3Cpath fill='%23E2136E' d='M96.58 62.45L56.62 6.93 43.56 54.15z'/%3E%3Cpath fill='%23D12053' d='M42.32 53.51L.45 0l54.83 6.55z'/%3E%3Cpath fill='%239E1638' d='M23.25 31.15L0 9.24h6.12z'/%3E%3Cpath fill='%23D12053' d='M107.89 35.46l-9.84 26.69L82.1 40.09z'/%3E%3Cpath fill='%23E2136E' d='M56.77 84.14l38.61-15.51L97 63.7z'/%3E%3Cpath fill='%239E1638' d='M25.89 113.41l16.54-58.02 8.39 37.75z'/%3E%3Cpath fill='%23E2136E' d='M109.43 35.67l-4.06 11.02 14.64-.24z'/%3E%3C/g%3E%3C/svg%3E";

/* ───────────── icons ───────────── */
const ICONS = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  activity: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  accounts: (
    <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 14h.01" />
  ),
  plans: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
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
  inc: <path d="M12 5v14m-7-7 7 7 7-7" />,
  tr: <path d="M7 7h13l-4-4M17 17H4l4 4" />,
  adj: (
    <>
      <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="8" cy="16" r="2" />
    </>
  ),
  bank: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" />,
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
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24">{ICONS[n]}</svg>;

function triggerSafariWebHaptic() {
  if (typeof document === "undefined") return;
  try {
    let trigger = document.getElementById("safari-haptic-trigger");
    if (!trigger) {
      trigger = document.createElement("input");
      trigger.id = "safari-haptic-trigger";
      trigger.type = "checkbox";
      trigger.setAttribute("switch", "");
      trigger.setAttribute("aria-hidden", "true");
      trigger.tabIndex = -1;
      trigger.style.cssText =
        "position:fixed;opacity:0;pointer-events:none;left:-9999px;width:0;height:0;";
      document.body.appendChild(trigger);
    }
    trigger.click();
  } catch {
    // ignore
  }
}

function triggerHaptic(type = "light") {
  if (Capacitor.isNativePlatform()) {
    try {
      if (type === "medium" || (typeof type === "number" && type > 10)) {
        void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      } else if (type === "heavy") {
        void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      } else if (type === "success") {
        void Haptics.notification({ type: NotificationType.Success }).catch(
          () => {},
        );
      } else if (type === "warning" || type === "delete") {
        void Haptics.notification({ type: NotificationType.Warning }).catch(
          () => {},
        );
      } else if (type === "selection") {
        void Haptics.selectionChanged().catch(() => {});
      } else {
        void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  // Web / PWA fallback tuned for Android vibration motors
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
    try {
      const patterns = {
        selection: 15,
        light: 22,
        medium: 40,
        heavy: 60,
        success: [25, 45, 30],
        warning: [35, 40, 20],
        delete: [35, 40, 20],
      };
      const pattern =
        typeof type === "number" ? Math.max(15, type) : patterns[type] || 22;
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  // iOS Safari Web / WebKit Taptic Engine tick fallback (iOS 17.4+)
  triggerSafariWebHaptic();
  return true;
}

function CategorySuggestionValue({ category }) {
  return (
    <span className="category-suggestion-value">
      <CategorySymbol category={category} />
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
const amountFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});
const M = (n) => "৳" + amountFormatter.format(Number(n) || 0);
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
    .filter((e) => typeof e?.date === "string" && e.date.startsWith(m) && e.amt != null)
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
  let b = Number(S?.start?.[id]) || 0;
  const savingsId = getSavingsAccountId(S?.cards);
  for (const e of S.exp) {
    if (e.amt == null || e.date > ld()) continue;
    if (e.cat === "Savings" && savingsId) {
      if (id === savingsId && e.acct && e.acct !== savingsId) b += e.amt;
      else if (e.acct === id && id !== savingsId) b -= e.amt;
    } else if (e.acct === id) b -= e.amt;
  }
  for (const t of S.tx) {
    if (t.date > ld()) continue;
    if (t.type === "income" && t.acct === id) b += t.amt;
    if ((t.type === "adjust" || t.type === "adjustment") && t.acct === id) {
      const isUp =
        t.dir === "up" ||
        t.dir === "increase" ||
        t.direction === "increase" ||
        t.direction === "up";
      b += isUp ? t.amt : -t.amt;
    }
    if (t.type === "transfer") {
      if (t.acct === id) b -= t.amt;
      if (t.to === id) b += t.amt;
    }
  }
  return Math.round(b * 100) / 100;
}

/* ───────────── small shared pieces ───────────── */
const Seg = ({ value, options, onPick }) => (
  <div className="seg">
    {options.map(([x, l]) => (
      <button
        key={x}
        className={value === x ? "on" : ""}
        onClick={() => onPick(x)}
      >
        {l}
      </button>
    ))}
  </div>
);

function AccountPicker({ value, options, onPick, cards = [] }) {
  const containerRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      const container = containerRef.current;
      const el = selectedRef.current;
      const targetLeft =
        el.offsetLeft -
        container.offsetLeft -
        (container.clientWidth - el.clientWidth) / 2;
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
    }
  }, [value]);

  const isFewOptions = options.length <= 2;

  return (
    <div
      className={`account-picker-container ${isFewOptions ? "is-few-options" : ""}`}
      ref={containerRef}
      role="radiogroup"
      aria-label="Select account"
    >
      <div className="account-picker-track">
        {options.map(([id, label]) => {
          const isCash = id === "" || id === "cash";
          const normalizedValue = value ?? "";
          const isSelected =
            normalizedValue === id ||
            (isCash && (normalizedValue === "" || normalizedValue === "cash"));
          const card = cards.find((c) => c.id === id);
          const isPrimary = card?.isPrimary;
          const isFrozen = card?.frozen;

          const dotBackground = isCash
            ? "#10b981"
            : card?.gradient || card?.color || "#2563eb";

          return (
            <button
              key={id}
              type="button"
              ref={isSelected ? selectedRef : null}
              className={`account-picker-chip ${isSelected ? "is-selected" : ""} ${isCash ? "is-cash" : ""}`}
              onClick={() => {
                triggerHaptic("selection");
                onPick(id);
              }}
              role="radio"
              aria-checked={isSelected}
            >
              <span
                className="account-picker-dot"
                style={{ background: dotBackground }}
                aria-hidden="true"
              />
              <span className="account-picker-name">{label}</span>
              {isPrimary && (
                <span className="account-picker-badge" title="Primary account">
                  ★
                </span>
              )}
              {isFrozen && (
                <span className="account-picker-lock" title="Frozen account">
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

function suggestedCategory(description, expenses = [], excludeId = null) {
  const title = String(description || "")
    .trim()
    .toLocaleLowerCase();
  if (!title) return "";
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
      /\b(entertainment|movie|cinema|concert|game|gaming|music|spotify|netflix|youtube premium|disney\+?|streaming|theatre|theater|hobby|event ticket)\b/,
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
    if (!expense || expense.id === excludeId || expense.cat === "Savings") continue;
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

function ExpenseRow({
  e,
  cards = [],
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
  const iconColor = isTx ? txColors[e?.type] || "#8b5cf6" : c;
  const pointerRef = useRef(null);
  const rowRef = useRef(null);
  const shellRef = useRef(null);
  const holdTimerRef = useRef();
  const swipeTimerRef = useRef();
  const collapseTimerRef = useRef();
  const duplicatePressTimerRef = useRef();
  const suppressClickTimerRef = useRef();
  const suppressClickRef = useRef(false);
  const dragFrameRef = useRef(null);
  const pendingOffsetRef = useRef(0);
  const [swipe, setSwipe] = useState({ offset: 0, phase: "idle" });
  const [duplicatePress, setDuplicatePress] = useState(false);
  const swipeRef = useRef(swipe);
  const canDelete = Boolean(isTx ? onDeleteTransaction || onDelete : onDelete);

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

      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }

      // Haptic confirmation
      triggerHaptic("delete");

      // Phase 1: Fluid slide out of viewport
      updateSwipe({ offset: -350, phase: "deleting" });
      if (rowRef.current) {
        rowRef.current.style.transition =
          "transform 220ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        rowRef.current.style.transform = "translate3d(-105%, 0, 0)";
      }

      // Phase 2: Height collapses smoothly to 0 so list beneath slides up
      clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = setTimeout(() => {
        updateSwipe({ offset: -350, phase: "collapsing" });

        // Phase 3: Commit state deletion cleanly after height animation finishes
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = setTimeout(() => {
          commit(e.id);
        }, 220);
      }, 190);
    },
    [e.id, e.rec, isTx, onDelete, onDeleteTransaction, onSkip],
  );

  useEffect(
    () => () => {
      clearHoldTimer();
      clearTimeout(swipeTimerRef.current);
      clearTimeout(collapseTimerRef.current);
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
        updateSwipe({ offset: 0, phase: "idle" });
        if (rowRef.current) {
          rowRef.current.style.transition =
            "transform 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
          rowRef.current.style.transform = "translate3d(0, 0, 0)";
        }
      }
    };
    window.addEventListener("pointerdown", handleOutside, true);
    return () => window.removeEventListener("pointerdown", handleOutside, true);
  }, [swipe.phase]);

  const startGesture = (event) => {
    if (!canDelete && !onDuplicate) return;
    if (event.button != null && event.button !== 0) return;
    if (["deleting", "collapsing"].includes(swipeRef.current.phase)) return;
    clearHoldTimer();
    clearTimeout(swipeTimerRef.current);
    clearTimeout(collapseTimerRef.current);
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }

    if (rowRef.current) {
      rowRef.current.style.transition = "none";
    }

    const initialOffset = swipeRef.current.offset;
    const width = rowRef.current?.offsetWidth || 320;

    pointerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: performance.now(),
      width,
      moved: false,
      longPressTriggered: false,
      horizontal: false,
      draggingStateApplied: false,
      initialOffset,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      passedHaptic: false,
    };
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
    if (!gesture || gesture.longPressTriggered) return;
    if (gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > 6 || absDy > 6) {
      gesture.moved = true;
      clearHoldTimer();
    }

    if (!gesture.horizontal && canDelete) {
      // Intent check: swiping horizontally
      const isHorizontalIntent =
        (absDx > 6 && absDx > absDy * 1.1) ||
        (gesture.initialOffset !== 0 && absDx > 5);

      if (isHorizontalIntent) {
        gesture.horizontal = true;
        suppressNextClick();
        rowRef.current?.classList.add("is-swipe-dragging");
        shellRef.current?.classList.add("is-swipe-dragging");
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
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;

      let targetOffset = gesture.initialOffset + dx;

      // Real iOS/Android swipe mechanics:
      // Swiping right-to-left (dx < 0) reveals the red delete box
      if (targetOffset < 0) {
        // Soft rubber-band resistance beyond -140px
        if (targetOffset < -140) {
          targetOffset = -140 + (targetOffset - -140) * 0.25;
        }
      } else {
        // Soft rubber-band resistance when pulling right
        targetOffset = targetOffset * 0.25;
      }

      // Check deletion threshold for haptic cue
      const deleteThreshold = Math.max(92, gesture.width * 0.32);
      const isPastThreshold = targetOffset <= -deleteThreshold;
      if (isPastThreshold && !gesture.passedHaptic) {
        gesture.passedHaptic = true;
        triggerHaptic("selection");
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
    shellRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.removeAttribute("data-threshold");

    if (event?.type === "pointercancel") {
      const resetOffset = gesture.initialOffset === -80 ? -80 : 0;
      updateSwipe({
        offset: resetOffset,
        phase: resetOffset === 0 ? "idle" : "revealed",
      });
      if (rowRef.current) {
        rowRef.current.style.transition =
          "transform 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        rowRef.current.style.transform = `translate3d(${resetOffset}px, 0, 0)`;
      }
      return;
    }

    if (gesture.horizontal && canDelete) {
      const dx = (event?.clientX ?? gesture.lastX) - gesture.startX;
      const currentOffset = pendingOffsetRef.current;
      const elapsed = Math.max(1, performance.now() - gesture.startedAt);
      const velocity = dx / elapsed;
      const deleteThreshold = Math.max(95, gesture.width * 0.32);
      const revealThreshold = 40;

      suppressNextClick();

      // Case 1: Full swipe left to delete directly
      const shouldFullDelete =
        currentOffset <= -deleteThreshold || (dx < -36 && velocity < -0.42);

      if (shouldFullDelete) {
        executeDeleteAnimation();
      } else if (currentOffset <= -revealThreshold) {
        // Case 2: Partial swipe left reveals Delete action button
        updateSwipe({ offset: -80, phase: "revealed" });
        if (rowRef.current) {
          rowRef.current.style.transition =
            "transform 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
          rowRef.current.style.transform = "translate3d(-80px, 0, 0)";
        }
      } else {
        // Case 3: Released below threshold -> smoothly springs back closed
        updateSwipe({ offset: 0, phase: "idle" });
        if (rowRef.current) {
          rowRef.current.style.transition =
            "transform 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
          rowRef.current.style.transform = "translate3d(0, 0, 0)";
        }
      }
    }
  };

  const isPositive = isTx
    ? e.type === "income" ||
      ((e.type === "adjust" || e.type === "adjustment") &&
        (e.dir === "up" || e.direction === "increase"))
    : e.type === "income" || e.type === "refund" || Boolean(e.refund);

  const isNeutral = isTx ? e.type === "transfer" : e.cat === "Savings";
  const amountClass = isPositive
    ? "am is-positive"
    : isNeutral
      ? "am is-neutral"
      : "am";
  const amountPrefix = isPositive ? "+" : isNeutral ? "" : "−";

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
        ? "Tap to edit, swipe left to skip this occurrence, or press and hold to duplicate."
        : isTx
          ? "Tap to edit or swipe left to delete."
          : "Tap to edit, swipe left to delete, or press and hold to duplicate."
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
      style={
        canDelete && swipe.offset !== 0
          ? { transform: `translate3d(${swipe.offset}px, 0, 0)` }
          : undefined
      }
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
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          clearTimeout(suppressClickTimerRef.current);
          return;
        }
        if (swipeRef.current.phase === "revealed") {
          updateSwipe({ offset: 0, phase: "idle" });
          if (rowRef.current) {
            rowRef.current.style.transition =
              "transform 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
            rowRef.current.style.transform = "translate3d(0, 0, 0)";
          }
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
          <CategorySymbol category={e.cat} />
        )}
      </i>
      <span className="nm">
        <b>{title}</b>
        <small>
          {isTx ? (
            e.type === "transfer" ? (
              `Transfer · ${getAccountDisplay(e.from || e.acct, cards)[0]} → ${getAccountDisplay(e.to, cards)[0]}`
            ) : e.type === "income" ? (
              `Income · ${getAccountDisplay(e.acct, cards)[0]}`
            ) : (
              `${e.dir === "up" || e.direction === "increase" ? "Balance increased" : "Balance decreased"} · ${getAccountDisplay(e.acct, cards)[0]}`
            )
          ) : (
            <>
              {e.cat}
              {cards.length > 0
                ? " · " + getAccountDisplay(e.acct, cards)[0]
                : e.acct && e.acct !== "cash"
                  ? " · " + getAccountDisplay(e.acct, cards)[0]
                  : ""}
              {e.rec ? " · Recurring" : ""}
              {suggestion && suggestion !== e.cat ? (
                <span className="category-suggestion-inline">
                  <span> · Suggested:</span>
                  <CategorySuggestionValue category={suggestion} />
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

  if (!canDelete) return row;

  return (
    <div
      ref={shellRef}
      className={`expense-swipe-shell${swipe.phase === "dragging" ? " is-dragging" : ""}${swipe.phase === "revealed" ? " is-revealed" : ""}${["deleting", "collapsing"].includes(swipe.phase) ? " is-deleting" : ""}${swipe.phase === "collapsing" ? " is-collapsing" : ""}${e.rec ? " is-skip-shell" : ""}`}
    >
      {/* Real-App Right-to-Left Swipe Delete Action Button */}
      <button
        className={`expense-swipe-delete is-right${e.rec ? " is-skip" : ""}`}
        type="button"
        tabIndex={swipe.phase === "revealed" ? 0 : -1}
        aria-hidden={swipe.phase !== "revealed"}
        aria-label={
          e.rec ? `Skip ${title} for this occurrence` : `Delete ${title}`
        }
        onClick={(event) => {
          event.stopPropagation();
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

      {row}
    </div>
  );
}

function Sheet({ onClose, children, actions, actionsClassName = "" }) {
  const dragRef = useRef(null);
  const sheetRef = useRef(null);
  const overlayRef = useRef(null);
  const scrollRef = useRef(null);
  const rAFRef = useRef(null);
  const pendingDyRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const sheetNode = sheetRef.current;
    if (!sheetNode) return;

    // Check if there is an explicit autofocus target or a primary amount input field
    const autoFocusTarget = sheetNode.querySelector(
      '[data-sheet-autofocus], .amt input, input[autofocus]'
    );

    sheetNode.focus({ preventScroll: true });

    if (autoFocusTarget && typeof autoFocusTarget.focus === "function") {
      const focusTarget = () => {
        if (!sheetNode.contains(autoFocusTarget)) return;
        try {
          autoFocusTarget.focus({ preventScroll: true });
          if (typeof autoFocusTarget.select === "function" && autoFocusTarget.value) {
            autoFocusTarget.select();
          }
        } catch {
          // ignore
        }
      };

      // Defer slightly so the sheet slide-up animation begins smoothly without sudden viewport jumping
      const timer = setTimeout(focusTarget, 60);
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
      ).filter((node) => !node.closest('[aria-hidden="true"]'));
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

  const moveDrag = useCallback((clientY) => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;

    const now = performance.now();
    drag.recentPoints.push({ y: clientY, t: now });
    if (drag.recentPoints.length > 5) {
      drag.recentPoints.shift();
    }

    let offset = clientY - drag.startY;
    if (offset < 0) {
      offset = offset * 0.18;
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
        if (overlayRef.current) {
          const progress = Math.max(
            0,
            Math.min(1, 1 - currentOffset / (drag.sheetHeight * 0.85)),
          );
          overlayRef.current.style.opacity = progress.toFixed(3);
        }
        
      });
    }
  }, []);

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

    const shouldClose =
      distance >= 70 ||
      distance >= sheetHeight * 0.18 ||
      (distance >= 25 && velocity > 0.35);

    const sheetNode = sheetRef.current;
    const overlayNode = overlayRef.current;

    if (shouldClose) {
      triggerHaptic("selection");
      
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
        onClose({ kind: "drag", distance, velocity });
      }, 240);
    } else {
      
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
  }, [onClose]);

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

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      initialScrollTop = scrollNode.scrollTop;
      isPulling = false;
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
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
        className="sh"
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
          aria-hidden="true"
          onPointerDown={onTopPointerDown}
        >
          <div className="grab" />
        </div>
        <div
          ref={scrollRef}
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
const AUTO_HIDE_MS = 5000;

function useReveal(autoHideMs = AUTO_HIDE_MS) {
  const [shown, setShown] = useState(false);
  const timer = useRef(null);

  const set = useCallback(
    (next) => {
      setShown(next);
      clearTimeout(timer.current);
      if (next && autoHideMs) {
        timer.current = setTimeout(() => setShown(false), autoHideMs);
      }
      triggerHaptic("selection");
    },
    [autoHideMs],
  );

  useEffect(() => {
    const onVis = () => document.hidden && setShown(false);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(timer.current);
    };
  }, []);

  const toggle = useCallback(() => set(!shown), [set, shown]);
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

  return (
    <span className="mx-amt">
      {cols.map(({ c, kind }, i) => (
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
function Home({
  S,
  profile,
  onShift,
  onTab,
  onCategory,
  onBudget,
  onOpen,
  highlightedExpenseId,
}) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [highlightedCategory, setHighlightedCategory] = useState("");
  const { shown, toggle } = useReveal(5000);
  const todayStr = ld();
  const currentMonthKey = todayStr.slice(0, 7);
  const currentDay = Number(todayStr.split("-")[2]) || 1;
  const isNewMonthWindow = currentDay <= 7;
  const monthKey = S?.m || currentMonthKey;
  const isCurrentMonth = monthKey === currentMonthKey;
  const isPastMonth = Boolean(monthKey && monthKey < currentMonthKey);
  const previousMonthKey = shift(currentMonthKey, -1);
  const shouldShowBanner =
    isPastMonth || (isCurrentMonth && isNewMonthWindow);
  const bannerMonth = isPastMonth ? monthKey : previousMonthKey;
  const total = tot(S, monthKey);
  const saved = monthExp(S)
    .filter((expense) => expense.cat === "Savings" && expense.amt != null)
    .reduce((sum, expense) => sum + expense.amt, 0);
  const t = total - saved;
  const previousMonth = shift(monthKey, -1);
  const previousSaved = monthExp({ ...S, m: previousMonth })
    .filter((expense) => expense.cat === "Savings" && expense.amt != null)
    .reduce((sum, expense) => sum + expense.amt, 0);
  const p = tot(S, previousMonth) - previousSaved;
  const b = S?.bud?.[monthKey] || 0;
  const d = t - p;
  const overBudget = b > 0 && t > b;
  const overflowShare = overBudget ? ((t - b) / t) * 100 : 0;
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
    const dailyRemainingBudget = Math.max(
      0,
      Math.round((b - t) / daysRemaining),
    );
    homeVelocity = {
      daysRemaining,
      paceDiff,
      dailyRemainingBudget,
      isOverPace: t > b || paceDiff > 50,
    };
  }
  const list = monthExp(S);
  const by = {};
  list.forEach((e) => {
    if (e.amt == null || e.cat === "Other" || !CAT[e.cat]) return;
    by[e.cat] = (by[e.cat] || 0) + e.amt;
  });
  const namedCategoryTotal = Object.values(by).reduce(
    (sum, value) => sum + value,
    0,
  );
  const otherTotal = Math.max(
    0,
    Number((total - namedCategoryTotal).toFixed(2)),
  );
  if (otherTotal > 0) by.Other = otherTotal;
  const cs = Object.entries(by).sort((x, y) => y[1] - x[1]);
  const topCategory = cs.find(([category]) => category !== "Savings");
  const activeRecurring = (S?.rec || []).filter(
    (r) => r?.on && typeof r?.next === "string",
  );
  const upcomingRecurring = activeRecurring.filter(
    (r) => r.next >= todayStr,
  );
  const nx = (
    upcomingRecurring.length > 0 ? upcomingRecurring : activeRecurring
  ).sort((x, y) => String(x?.next || "").localeCompare(String(y?.next || "")))[0];
  const h = currentTime.getHours();
  useEffect(() => setHighlightedCategory(""), [S.m]);
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
        <MonthEndBanner
          month={bannerMonth}
          isPreview={isCurrentMonth}
          transactions={S?.exp || []}
          amountOf={(t) => (t.cat === "Savings" ? 0 : t.amt)}
          categoryOf={(t) => t.cat}
          currency="৳"
        />
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
        <div className="row">
          <span>Spent this month</span>
          {p ? (
            <span className="chip">
              <span className="mx-tri">{d > 0 ? "▲" : d < 0 ? "▼" : "•"}</span>
              ৳
              <Amount
                value={amountFormatter.format(Math.abs(d))}
                mask={3}
                shown={shown}
              />{" "}
              vs last
            </span>
          ) : null}
        </div>

        <div className="mx-hero">
          <div className="big mx-hero-amt" onClick={toggle}>
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
            <div className="bar">
              <i
                style={{
                  width: Math.min(100, (t / b) * 100) + "%",
                  "--overflow-share": `${overflowShare}%`,
                }}
              />
            </div>
            <div className="row">
              <span
                className={`budget-pill${overBudget ? " is-over" : ""}`}
                role="status"
              >
                {overBudget ? (
                  <>
                    ৳
                    <Amount
                      value={amountFormatter.format(t - b)}
                      mask={3}
                      shown={shown}
                    />{" "}
                    over budget
                  </>
                ) : (
                  <>
                    ৳
                    <Amount
                      value={amountFormatter.format(b - t)}
                      mask={3}
                      shown={shown}
                    />{" "}
                    left
                  </>
                )}
              </span>
              <span>
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
                <span
                  className={`hero-velocity-badge ${homeVelocity.isOverPace ? "is-over" : "is-good"}`}
                >
                  {homeVelocity.isOverPace ? (
                    <>
                      ⚡ ৳
                      <Amount
                        value={amountFormatter.format(Math.round(homeVelocity.paceDiff))}
                        mask={3}
                        shown={shown}
                      />{" "}
                      over pace
                    </>
                  ) : (
                    <>
                      ✓ ৳
                      <Amount
                        value={amountFormatter.format(homeVelocity.dailyRemainingBudget)}
                        mask={3}
                        shown={shown}
                      />
                      /day safe pace
                    </>
                  )}
                </span>
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
          <small>Top category</small>
          <b className="top-category-value">
            {topCategory ? (
              <>
                <CategorySymbol category={topCategory[0]} />
                <span>{topCategory[0]}</span>
              </>
            ) : (
              "—"
            )}
          </b>
          <span className="mini-caption">
            {topCategory
              ? `${M(topCategory[1])} this month`
              : "No spending yet"}
          </span>
        </div>
        <div className="card">
          <small>Next recurring</small>
          <b className="mini-next-value">{nx ? nx.desc : "Nothing due"}</b>
          <span className="mini-caption">
            {nx ? `Due ${dayMonth(nx.next)}` : "You’re all caught up"}
          </span>
        </div>
      </div>

      {cs.length > 0 && total > 0 && (
        <div className="card">
          <div className="category-card-heading">
            <div>
              <h2>Where it went</h2>
              {saved > 0 && <small>Includes saved money</small>}
            </div>
            <span>{M(total)}</span>
          </div>
          <div className="stack" role="group" aria-label="Spending by category">
            {cs.map(([c, v]) => (
              <button
                key={c}
                type="button"
                className={`stack-segment${highlightedCategory === c ? " is-highlighted" : ""}`}
                aria-label={`${c}: ${M(v)}`}
                aria-pressed={highlightedCategory === c}
                onClick={() =>
                  setHighlightedCategory((current) => (current === c ? "" : c))
                }
                style={{
                  width: total > 0 ? (v / total) * 100 + "%" : "0%",
                  background: CAT[c]?.[1] || "#64748b",
                }}
              />
            ))}
          </div>
          {cs.map(([c, v]) => (
            <button
              className={`leg${highlightedCategory === c ? " is-highlighted" : ""}`}
              key={c}
              type="button"
              aria-label={`View ${c} activity, ${M(v)}`}
              onClick={() => onCategory(c)}
            >
              <span className="dot" style={{ "--c": CAT[c]?.[1] || "#64748b" }} />
              <span>{c}</span>
              <b>{M(v)}</b>
              <em>{total > 0 ? Math.round((v / total) * 100) : 0}%</em>
            </button>
          ))}
        </div>
      )}

      <div className="sec">
        <h2>Recent</h2>
        <button onClick={() => onTab("activity")}>See all</button>
      </div>
      <div className="card" style={{ margin: 0, padding: "6px 14px" }}>
        {list.length ? (
          list
            .slice(0, 5)
            .map((e) => (
              <ExpenseRow
                key={e.id}
                e={e}
                cards={S?.cards || []}
                onOpen={onOpen}
                isNew={highlightedExpenseId === e.id}
              />
            ))
        ) : (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                className="emp-svg"
                aria-hidden="true"
              >
                <rect
                  x="11"
                  y="8"
                  width="26"
                  height="32"
                  rx="6"
                  className="emp-doc"
                />
                <line
                  x1="17"
                  y1="16"
                  x2="31"
                  y2="16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.85"
                />
                <line
                  x1="17"
                  y1="22"
                  x2="27"
                  y2="22"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.55"
                />
                <line
                  x1="17"
                  y1="28"
                  x2="23"
                  y2="28"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.35"
                />
                <circle cx="34" cy="34" r="8" className="emp-chip" />
                <path
                  d="M34 31V37M31 34H37"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
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

  const query = String(q || "").trim().toLowerCase();

  const isItemCash = useCallback((item) => {
    if (!item) return false;
    if (item.sourceType === "expense") return !item.acct || item.acct === "cash";
    if (item.type === "transfer") {
      return (
        item.from === "cash" ||
        item.to === "cash" ||
        item.acct === "cash" ||
        item.fromAccount === "cash" ||
        item.toAccount === "cash"
      );
    }
    return !item.acct || item.acct === "cash";
  }, []);

  const currentMonth =
    typeof S?.m === "string" && S.m.length >= 7 ? S.m : ld().slice(0, 7);

  // 1. Month Expenses
  const monthExpenses = useMemo(() => {
    return (S?.exp || [])
      .filter((e) => typeof e?.date === "string" && e.date.startsWith(currentMonth))
      .map((e, index) => ({
        ...e,
        sourceType: "expense",
        index,
      }));
  }, [S?.exp, currentMonth]);

  // 2. Month Transactions (Income, Transfers, Adjustments)
  const monthTransactions = useMemo(() => {
    return (S?.tx || [])
      .filter((t) => typeof t?.date === "string" && t.date.startsWith(currentMonth))
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
  const countIncome = monthTransactions.filter((t) => t.type === "income").length;
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

  // Filtered List
  const filteredItems = useMemo(() => {
    return allMonthItems.filter((item) => {
      // 1. Feed Type Filter
      if (feedType === "expenses" && item.sourceType !== "expense") return false;
      if (
        feedType === "income" &&
        (item.sourceType !== "tx" || item.type !== "income")
      )
        return false;
      if (
        feedType === "transfers" &&
        (item.sourceType !== "tx" ||
          (item.type !== "transfer" &&
            item.type !== "adjust" &&
            item.type !== "adjustment"))
      )
        return false;

      // 2. Category Filter (applicable to expenses)
      if (cf && (item.sourceType !== "expense" || item.cat !== cf)) return false;

      // 3. Quick Filter Pills
      if (
        quickFilter === "needs-amount" &&
        (item.sourceType !== "expense" || item.amt != null)
      )
        return false;
      if (
        quickFilter === "recurring" &&
        (item.sourceType !== "expense" || !item.rec)
      )
        return false;
      if (quickFilter === "cash" && !isItemCash(item)) return false;
      if (quickFilter === "high-value" && Number(item.amt || 0) < 1000)
        return false;

      // 4. Search Query
      if (!query) return true;
      const desc = String(
        item.desc || item.title || item.note || "",
      ).toLowerCase();
      const cat = String(item.cat || "").toLowerCase();
      const amtStr = item.amt != null ? String(item.amt) : "";
      const formattedAmt = item.amt != null ? M(item.amt).toLowerCase() : "";
      const cleanMoneyQuery = query.replace(/[৳,\s]/g, "");
      const [accountName] = getAccountDisplay(item.acct || item.from, S?.cards);
      const acctStr = String(accountName || "").toLowerCase();
      const [toAccountName] = item.to
        ? getAccountDisplay(item.to, S?.cards)
        : [""];
      const toAcctStr = String(toAccountName || "").toLowerCase();
      const isCash = isItemCash(item);
      const matchesCash =
        isCash &&
        (query === "cash" ||
          query === "cas" ||
          query.includes("cash") ||
          ("cash".startsWith(query) && query.length >= 2));
      const dateStr = String(item.date || "");
      const formattedDate = fD(dateStr).toLowerCase();
      const isToday = dateStr === ld();
      const isYesterday = dateStr === ago(1);
      const matchesRelativeDay =
        (isToday && "today".includes(query)) ||
        (isYesterday && "yesterday".includes(query));

      let matchesType = false;
      if (item.sourceType === "tx") {
        if (item.type === "income") {
          matchesType = query.length >= 2 && "income".includes(query);
        } else if (item.type === "transfer") {
          matchesType = query.length >= 2 && "transfer".includes(query);
        } else if (item.type === "adjust" || item.type === "adjustment") {
          matchesType =
            "adjustment".includes(query) ||
            "adjust".includes(query) ||
            "balance".includes(query) ||
            (item.dir === "up"
              ? "increase".includes(query)
              : "decrease".includes(query));
        }
      } else if (item.sourceType === "expense") {
        matchesType =
          query === "expense" ||
          (Boolean(item.rec) &&
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
    });
  }, [allMonthItems, feedType, cf, quickFilter, query, isItemCash, S?.cards]);

  // Day grouping
  const g = {};
  filteredItems.forEach((item) => {
    const key = item.date || item.d || "";
    (g[key] = g[key] || []).push(item);
  });
  const sortedDates = Object.keys(g).sort((a, b) => b.localeCompare(a));

  // Totals for filter summary
  const totalExpenses = filteredItems
    .filter((item) => item.sourceType === "expense" || item.type === "expense")
    .reduce((sum, item) => sum + (item.amt || 0), 0);
  const totalIncome = filteredItems
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + (item.amt || 0), 0);
  const totalTransfers = filteredItems
    .filter(
      (item) =>
        item.type === "transfer" ||
        item.type === "adjust" ||
        item.type === "adjustment",
    )
    .reduce((sum, item) => sum + (item.amt || 0), 0);

  const hasFilter =
    feedType !== "all" || Boolean(quickFilter) || Boolean(cf) || Boolean(query);

  const clearAllFilters = () => {
    triggerHaptic("light");
    setFeedType("all");
    setQuickFilter("");
    setCf("");
    setQ("");
  };

  const matchesInOtherMonths =
    query && !filteredItems.length
      ? [...(S?.exp || []), ...(S?.tx || [])].some((item) => {
          const itemDate = item.date || "";
          if (
            typeof itemDate === "string" &&
            itemDate.startsWith(currentMonth)
          ) {
            return false;
          }
          const desc = String(
            item.desc || item.title || item.note || item.description || "",
          ).toLowerCase();
          const cat = String(item.cat || "").toLowerCase();
          const amtStr = item.amt != null ? String(item.amt) : "";
          const cleanMoneyQuery = query.replace(/[৳,\s]/g, "");
          const [acct] = getAccountDisplay(item.acct || item.from, S?.cards);
          const [toAcct] = item.to ? getAccountDisplay(item.to, S?.cards) : [""];
          return (
            desc.includes(query) ||
            cat.includes(query) ||
            amtStr.includes(query) ||
            (cleanMoneyQuery && amtStr.includes(cleanMoneyQuery)) ||
            String(acct || "").toLowerCase().includes(query) ||
            String(toAcct || "").toLowerCase().includes(query)
          );
        })
      : false;

  return (
    <>
      <div className="activity-controls">
        <label className="srch">
          <Icon n="s" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search activity"
            placeholder="Search activity, categories, or accounts"
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

        {/* 1. Unified Feed Type Segmented Control */}
        <div className="seg activity-type-seg" role="tablist" aria-label="Activity type">
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "all"}
            className={feedType === "all" ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("all");
            }}
          >
            <span>All</span>
            {countAll > 0 && <span className="chip-badge">{countAll}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "expenses"}
            className={feedType === "expenses" ? "on" : ""}
            onClick={() => {
              triggerHaptic("selection");
              setFeedType("expenses");
            }}
          >
            <span>Expenses</span>
            {countExpenses > 0 && <span className="chip-badge">{countExpenses}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "income"}
            className={feedType === "income" ? "on" : ""}
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
            <span>Income</span>
            {countIncome > 0 && <span className="chip-badge">{countIncome}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={feedType === "transfers"}
            className={feedType === "transfers" ? "on" : ""}
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
            <span>Transfers</span>
            {countTransfers > 0 && <span className="chip-badge">{countTransfers}</span>}
          </button>
        </div>
      </div>

      {/* 2. Quick Filter Pills Bar */}
      <div className="chips" data-dock-scroll-lock role="toolbar" aria-label="Activity filter chips">
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
                setQuickFilter(quickFilter === "needs-amount" ? "" : "needs-amount");
                setCf("");
              }}
            >
              <span className="category-symbol" aria-hidden="true">
                <img
                  src={alertSvg}
                  alt=""
                  className="category-symbol-img"
                  draggable="false"
                />
              </span>
              <span>Needs amt</span>
              {needsAmountCount > 0 && <span className="chip-badge">{needsAmountCount}</span>}
            </button>

            <button
              type="button"
              className={quickFilter === "recurring" ? "on" : ""}
              aria-pressed={quickFilter === "recurring"}
              onClick={() => {
                triggerHaptic("selection");
                setQuickFilter(quickFilter === "recurring" ? "" : "recurring");
                setCf("");
              }}
            >
              <span className="category-symbol" aria-hidden="true">
                <img
                  src={refreshSvg}
                  alt=""
                  className="category-symbol-img"
                  draggable="false"
                />
              </span>
              <span>Repeat</span>
              {recurringCount > 0 && <span className="chip-badge">{recurringCount}</span>}
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
          <span className="category-symbol" aria-hidden="true">
            <img
              src={cashSvg}
              alt=""
              className="category-symbol-img"
              draggable="false"
            />
          </span>
          <span>Cash</span>
          {cashCount > 0 && <span className="chip-badge">{cashCount}</span>}
        </button>

        <button
          type="button"
          className={quickFilter === "high-value" ? "on" : ""}
          aria-pressed={quickFilter === "high-value"}
          onClick={() => {
            triggerHaptic("selection");
            setQuickFilter(quickFilter === "high-value" ? "" : "high-value");
            setCf("");
          }}
        >
          <span className="category-symbol" aria-hidden="true">
            <img
              src={starSvg}
              alt=""
              className="category-symbol-img"
              draggable="false"
            />
          </span>
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

      {/* 3. Filter Summary Banner */}
      {hasFilter && (
        <div className="activity-filter-summary" role="status">
          {feedType !== "all" && (
            <b>{feedType.charAt(0).toUpperCase() + feedType.slice(1)}</b>
          )}
          {feedType !== "all" && (quickFilter || cf || query) && <span>·</span>}
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
            {filteredItems.length} {filteredItems.length === 1 ? "item" : "items"}
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

      {/* 4. Activity List */}
      <div>
        {!filteredItems.length ? (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                className="emp-svg"
                aria-hidden="true"
              >
                <circle
                  cx="21"
                  cy="21"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2.2"
                />
                <line
                  x1="28.5"
                  y1="28.5"
                  x2="38"
                  y2="38"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle
                  cx="21"
                  cy="21"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="2.5 2.5"
                  opacity="0.5"
                />
              </svg>
            </div>
            <b>
              {hasFilter
                ? `No matching ${feedType === "income" ? "income" : feedType === "transfers" ? "transfers" : feedType === "expenses" ? "expenses" : "activity"}`
                : countAll === 0
                  ? `No activity in ${fM(currentMonth)}`
                  : `No ${feedType} in ${fM(currentMonth)}`}
            </b>
            <small>
              {hasFilter
                ? matchesInOtherMonths
                  ? `No matches in ${fM(currentMonth)}. Matching items found in other months — switch months above to view them.`
                  : "Try searching another keyword or clearing your filter."
                : `${feedType === "income" ? "Income" : feedType === "transfers" ? "Transfers and adjustments" : feedType === "expenses" ? "Expenses" : "Activity"} for this month will show up here by date.`}
            </small>
            {hasFilter && (
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
            const dayExpenseSum = dayExpenses
              .filter((e) => e.sourceType === "expense" || e.type === "expense")
              .reduce((acc, e) => acc + (e.amt || 0), 0);
            const dayIncomeSum = dayExpenses
              .filter((e) => e.type === "income")
              .reduce((acc, e) => acc + (e.amt || 0), 0);
            const dayTransfersSum = dayExpenses
              .filter(
                (e) =>
                  e.type === "transfer" ||
                  e.type === "adjust" ||
                  e.type === "adjustment",
              )
              .reduce((acc, e) => acc + (e.amt || 0), 0);
            const hasAmount = dayExpenses.some((e) => e.amt != null);
            const dayLabel = !d
              ? "Undated"
              : d === ld()
                ? "Today"
                : d === ago(1)
                  ? "Yesterday"
                  : fD(d);

            return (
              <Fragment key={d || "undated"}>
                <div className="day">
                  <span>{dayLabel}</span>
                  {dayExpenses.length >= 2 && hasAmount && (
                    <span>
                      {feedType === "income" ? (
                        <span className="is-positive">+{M(dayIncomeSum)}</span>
                      ) : feedType === "transfers" ? (
                        <span>{M(dayTransfersSum)}</span>
                      ) : dayIncomeSum > 0 && dayExpenseSum > 0 ? (
                        <>
                          <span>-{M(dayExpenseSum)} </span>
                          <span className="is-positive">(+{M(dayIncomeSum)})</span>
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
                <div className="card expense-day-card">
                  {dayExpenses.map((e) => (
                    <ExpenseRow
                      key={`${e.sourceType || "exp"}-${e.id}`}
                      e={e}
                      cards={S.cards}
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
              </Fragment>
            );
          })
        )}
      </div>
    </>
  );
}

function AnimatedAmount({ value }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [pulse, setPulse] = useState({ key: 0, direction: "" });
  const displayedRef = useRef(value);

  useEffect(() => {
    const from = displayedRef.current;
    const target = Number(value) || 0;
    if (Math.abs(target - from) < 0.005) return;

    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      displayedRef.current = target;
      setDisplayValue(target);
      return;
    }

    setPulse((current) => ({
      key: current.key + 1,
      direction: target > from ? "up" : "down",
    }));
    const startedAt = performance.now();
    let frameId;
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / 300);
      const eased = 1 - (1 - progress) ** 3;
      const next = progress === 1 ? target : from + (target - from) * eased;
      displayedRef.current = next;
      setDisplayValue(next);
      if (progress < 1) frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return (
    <span className="animated-money" aria-live="off">
      <span
        key={pulse.key}
        className={`animated-money-value${
          pulse.direction ? ` change-${pulse.direction}` : ""
        }`}
      >
        {M(displayValue)}
      </span>
    </span>
  );
}

function Accounts({
  S,
  onTx,
  onAddCardClick,
  onOpenCardOptions,
  onDeleteCard,
  highlightedExpenseId,
  highlightedTransactionId,
  profile,
  onTab,
  onOpenExpense,
  onOpenTransaction,
  onLockedCardNotice,
  onAddExpense,
  onActiveAccountChange,
}) {
  const cards = Array.isArray(S.cards) ? S.cards : [];
  const savingsAccountId = getSavingsAccountId(cards);
  const balances = Object.fromEntries(cards.map((c) => [c.id, bal(S, c.id)]));
  const [selectedAccount, setSelectedAccount] = useState(
    () => cards[0]?.id || "",
  );
  const [showAllTx, setShowAllTx] = useState(false);
  const [deckDragY, setDeckDragY] = useState(0);
  const prevCardCountRef = useRef(cards.length);

  useEffect(() => {
    onActiveAccountChange?.(selectedAccount);
  }, [selectedAccount, onActiveAccountChange]);

  useEffect(() => {
    if (cards.length === 0) {
      if (selectedAccount !== "") setSelectedAccount("");
      prevCardCountRef.current = 0;
      return;
    }
    if (cards.length > prevCardCountRef.current) {
      const newestCard = cards[cards.length - 1];
      if (newestCard?.id) {
        setSelectedAccount(newestCard.id);
        prevCardCountRef.current = cards.length;
        return;
      }
    }
    prevCardCountRef.current = cards.length;
    if (!selectedAccount || !cards.some((c) => c.id === selectedAccount)) {
      setSelectedAccount(cards[0].id);
    }
  }, [cards, selectedAccount]);

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
    const card = cards.find((c) => c.id === id);
    if (card?.name) return card.name;
    const tombstone = S?.deletedCards?.[id];
    if (tombstone?.name) return `${tombstone.name} (Archived)`;
    return id || "Account";
  };

  const events = [
    ...S.exp
      .filter(
        (expense) =>
          expense.acct && expense.amt != null && expense.date <= ld(),
      )
      .map((expense) => {
        const isSavingsTransfer =
          expense.cat === "Savings" && Boolean(savingsAccountId);
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
          account: expense.acct,
          from: isSavingsTransfer ? expense.acct : "",
          to: isSavingsTransfer ? savingsAccountId : "",
        };
      }),
    ...S.tx
      .filter((transaction) => transaction.date <= ld())
      .map((transaction) => ({
        id: transaction.id,
        sourceType: "tx",
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        d: transaction.date,
        title:
          capitalizeFirstLetter(transaction.note) ||
          { income: "Income", transfer: "Transfer", adjust: "Adjustment", adjustment: "Adjustment" }[
            transaction.type
          ] || "Transaction",
        type: transaction.type,
        cat:
          transaction.type === "income"
            ? "Savings"
            : transaction.type === "transfer"
              ? "Transport"
              : "Bills",
        amount: transaction.amt,
        account: transaction.acct,
        from: transaction.acct,
        to: transaction.to,
        dir: transaction.dir,
        direction: transaction.dir,
      })),
  ];

  const ascendingEvents = [...events].sort(
    (left, right) =>
      left.d.localeCompare(right.d) ||
      activityTime(left) - activityTime(right) ||
      left.id.localeCompare(right.id),
  );
  const runningBalances = { ...S.start };
  const adjustmentBalances = new Map();
  for (const event of ascendingEvents) {
    const changes = {};
    if (event.type === "expense") changes[event.account] = -event.amount;
    else if (event.type === "income") changes[event.account] = event.amount;
    else if (event.type === "adjust" || event.type === "adjustment") {
      const isUp =
        event.direction === "up" ||
        event.direction === "increase" ||
        event.dir === "up" ||
        event.dir === "increase";
      changes[event.account] = isUp ? event.amount : -event.amount;
    } else if (event.type === "transfer") {
      changes[event.from] = (changes[event.from] || 0) - event.amount;
      changes[event.to] = (changes[event.to] || 0) + event.amount;
    }

    if (event.type === "adjust" || event.type === "adjustment") {
      const before = runningBalances[event.account] || 0;
      adjustmentBalances.set(event.id, {
        before,
        after: before + changes[event.account],
      });
    }
    for (const [accountId, change] of Object.entries(changes))
      runningBalances[accountId] = (runningBalances[accountId] || 0) + change;
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
        activityTime(right) - activityTime(left) ||
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

  return (
    <>
      {/* 3D Stacked Cards Wallet Deck */}
      <StackedCardDeck
        cards={cards}
        balances={balances}
        selectedId={selectedAccount}
        onSelectCard={chooseAccount}
        onAddCardClick={onAddCardClick}
        onOpenCardDetails={(card) =>
          card && onOpenCardOptions?.(card.id)
        }
        onDragOffsetChange={setDeckDragY}
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
        {/* 2×2 Quick Action Buttons Grid (Income, Transfer, Adjust, Card Options - Preserving Whole App Functionality) */}
        <div className="accounts-actions-grid">
        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("light");
            if (!cards.length) {
              onAddCardClick?.();
              return;
            }
            onTx("income", selectedAccount);
          }}
          aria-label="Add income to this account"
        >
          <div className="action-icon-badge is-income">
            <TransactionSymbol type="income" />
          </div>
          <span className="action-label">Income</span>
        </button>

        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
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
          }}
          aria-label="Transfer between accounts"
        >
          <div className="action-icon-badge is-transfer">
            <TransactionSymbol type="transfer" />
          </div>
          <span className="action-label">Transfer</span>
        </button>

        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("light");
            if (!cards.length) {
              onAddCardClick?.();
              return;
            }
            onTx("adjust", selectedAccount);
          }}
          aria-label="Adjust balance"
        >
          <div className="action-icon-badge is-adjust">
            <TransactionSymbol type="adjust" />
          </div>
          <span className="action-label">Adjust</span>
        </button>

        <button
          type="button"
          className="accounts-action-card is-card-options-card"
          onClick={() => {
            triggerHaptic("selection");
            if (!cards.length) {
              onAddCardClick?.();
              return;
            }
            onOpenCardOptions?.(selectedAccount || activeCard?.id || cards[0]?.id);
          }}
          aria-label="Manage cards and view card options"
        >
          <div className="action-icon-badge is-card-options">
            <TransactionSymbol type="card-options" />
          </div>
          <span className="action-label">Card Options</span>
        </button>
      </div>

      {/* Transactions Section matching Video Header & List */}
      <div className="accounts-transactions-header">
        <h2>Transactions</h2>
        {filteredEvents.length > 0 && (
          <button
            type="button"
            className="accounts-see-all-link"
            onClick={() => {
              triggerHaptic("selection");
              if (filteredEvents.length > 8) {
                setShowAllTx((prev) => !prev);
              } else {
                onTab?.("activity");
              }
            }}
          >
            {filteredEvents.length > 8
              ? showAllTx
                ? "Show less"
                : `See all (${filteredEvents.length})`
              : "See all"}
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

            return (
              <button
                type="button"
                className={`accounts-tx-row${highlightedExpenseId === event.id || highlightedTransactionId === event.id ? " is-new" : ""}`}
                key={event.id}
                onClick={() => {
                  triggerHaptic("selection");
                  if (event.sourceType === "expense" && onOpenExpense) {
                    onOpenExpense(event.id);
                  } else if (event.sourceType === "tx" && onOpenTransaction) {
                    onOpenTransaction(event.id);
                  }
                }}
              >
                <div
                  className={`accounts-tx-icon-circle ${event.sourceType === "tx" || event.type !== "expense" ? `is-${event.type.toLowerCase()}` : `is-${category.toLowerCase()}`}`}
                >
                  {event.sourceType === "tx" || event.type !== "expense" ? (
                    <TransactionSymbol type={event.type} />
                  ) : (
                    <CategorySymbol category={category} />
                  )}
                </div>

                <div className="accounts-tx-info">
                  <b className="accounts-tx-title">{event.title}</b>
                  <small className="accounts-tx-date">
                    {displayDate(event.d)}
                    {subtitleMeta ? ` · ${subtitleMeta}` : ""}
                  </small>
                  {adjustment && (
                    <small className="accounts-tx-adj-note">
                      {M(adjustment.before)} → {M(adjustment.after)}
                    </small>
                  )}
                </div>

                <b
                  className={`accounts-tx-amount${isPositive ? " is-positive" : ""}`}
                >
                  {amount.signed ? (isPositive ? "+" : "−") : ""}
                  {M(Math.abs(amount.value))}
                </b>
              </button>
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
                <svg
                  viewBox="0 0 52 52"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="accounts-tx-empty-svg"
                  aria-hidden="true"
                >
                  <rect
                    x="11"
                    y="9"
                    width="30"
                    height="34"
                    rx="7"
                    className="accounts-tx-empty-doc"
                  />
                  <line
                    x1="18"
                    y1="18"
                    x2="34"
                    y2="18"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    opacity="0.85"
                  />
                  <line
                    x1="18"
                    y1="24"
                    x2="30"
                    y2="24"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    opacity="0.55"
                  />
                  <line
                    x1="18"
                    y1="30"
                    x2="25"
                    y2="30"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    opacity="0.35"
                  />
                  <circle
                    cx="36"
                    cy="36"
                    r="9"
                    className="accounts-tx-empty-bubble"
                  />
                  <path
                    d="M36 32.5V39.5M32.5 36H39.5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
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

            {activeCard?.frozen ? (
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
                    onOpenCardOptions?.(selectedAccount || activeCard?.id || cards[0]?.id);
                  }}
                >
                  Manage
                </button>
              </div>
            ) : (
              <div className="accounts-tx-empty-actions">
                <button
                  type="button"
                  className="accounts-tx-empty-btn is-primary"
                  onClick={() => {
                    triggerHaptic("light");
                    if (onAddExpense) {
                      onAddExpense(selectedAccount);
                    } else {
                      onTab?.("add");
                    }
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Add Expense</span>
                </button>

                <button
                  type="button"
                  className="accounts-tx-empty-btn is-secondary"
                  onClick={() => {
                    triggerHaptic("light");
                    onTx?.("income", selectedAccount);
                  }}
                >
                  <span>Income</span>
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

function Plans({
  S,
  plan,
  setPlan,
  onShift,
  onBudget,
  onAddRec,
  onToggleRec,
  onRemoveRec,
}) {
  const savingsThisMonth = monthExp(S)
    .filter((expense) => expense.cat === "Savings" && expense.amt != null)
    .reduce((sum, expense) => sum + expense.amt, 0);
  const b = S.bud[S.m] || 0,
    t = Math.max(0, tot(S, S.m) - savingsThisMonth),
    pc = b ? t / b : 0,
    C = 2 * Math.PI * 62;
  const act = S.rec.filter((r) => r.on);
  const est = act
    .filter((schedule) => schedule.cat !== "Savings")
    .reduce((a, r) => a + r.amt * (r.iv === "weekly" ? 4 : 1), 0);

  const todayStr = ld();
  const isCurrentMonth = S.m === todayStr.slice(0, 7);
  let velocity = null;
  if (b > 0 && isCurrentMonth) {
    const [y, mNum] = S.m.split("-").map(Number);
    const daysInMonth = new Date(y, mNum, 0).getDate();
    const currentDay = Math.min(
      daysInMonth,
      Number(todayStr.split("-")[2]) || 1,
    );
    const daysPassed = Math.max(1, currentDay);
    const daysRemaining = Math.max(1, daysInMonth - currentDay + 1);
    const expectedSpent = (b / daysInMonth) * daysPassed;
    const paceDiff = t - expectedSpent;
    const dailyRemainingBudget = Math.max(
      0,
      Math.round((b - t) / daysRemaining),
    );
    const currentDailyBurn = Math.round(t / daysPassed);
    velocity = {
      daysInMonth,
      currentDay,
      daysRemaining,
      daysPassed,
      expectedSpent,
      paceDiff,
      dailyRemainingBudget,
      currentDailyBurn,
      isOverPace: t > b || paceDiff > 50,
      isUnderPace: t <= b && paceDiff < -50,
    };
  }

  const budget = (
    <>
      <MonthSwitch m={S.m} onShift={onShift} />
      <div className="card" style={{ marginTop: 0, textAlign: "center" }}>
        {b ? (
          <>
            <div className="ring">
              <svg
                viewBox="0 0 150 150"
                style={{ width: 190, height: 190, transform: "rotate(-90deg)" }}
              >
                <defs>
                  <linearGradient
                    id="budgetRingGrad"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={
                        pc > 1 ? "#f43f5e" : pc > 0.75 ? "#f59e0b" : "#10b981"
                      }
                    />
                    <stop
                      offset="100%"
                      stopColor={
                        pc > 1 ? "#e11d48" : pc > 0.75 ? "#ea580c" : "#06b6d4"
                      }
                    />
                  </linearGradient>
                </defs>
                <circle
                  cx="75"
                  cy="75"
                  r="62"
                  stroke="var(--line)"
                  strokeWidth="13"
                />
                <circle
                  cx="75"
                  cy="75"
                  r="62"
                  stroke="url(#budgetRingGrad)"
                  strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - Math.min(pc, 1))}
                  style={{
                    transition:
                      "stroke-dashoffset 600ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                  }}
                />
              </svg>
              <b>
                {Math.round(pc * 100)}%<small>used</small>
              </b>
            </div>
            <div className="two" style={{ marginTop: 8 }}>
              <div>
                <small className="lbl">Spent</small>
                <div style={{ fontSize: 19, fontWeight: 800 }}>{M(t)}</div>
              </div>
              <div>
                <small className="lbl">Limit</small>
                <div style={{ fontSize: 19, fontWeight: 800 }}>{M(b)}</div>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 14 }}>
              {t <= b
                ? M(b - t) + " left — you’re within your limit."
                : M(t - b) + " over — spending is above your limit."}
            </p>
            {velocity && (
              <div className="budget-velocity-card">
                <div className="budget-velocity-header">
                  <span
                    className={`velocity-tag ${velocity.isOverPace ? "is-over" : "is-good"}`}
                  >
                    {velocity.isOverPace ? (
                      <>
                        ⚡ {M(Math.round(velocity.paceDiff))} ahead of pace
                      </>
                    ) : velocity.isUnderPace ? (
                      <>
                        ✓ {M(Math.round(Math.abs(velocity.paceDiff)))} under pace
                      </>
                    ) : (
                      <>🎯 Exactly on pace</>
                    )}
                  </span>
                  <span className="budget-velocity-days">
                    {velocity.daysRemaining}{" "}
                    {velocity.daysRemaining === 1 ? "day" : "days"} left
                  </span>
                </div>
                <div className="budget-velocity-stats">
                  <div className="velocity-stat">
                    <span className="lbl">Safe Daily Spend</span>
                    <b>{M(velocity.dailyRemainingBudget)}/day</b>
                  </div>
                  <div className="velocity-stat">
                    <span className="lbl">Actual Daily Burn</span>
                    <b>{M(velocity.currentDailyBurn)}/day</b>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                className="emp-svg"
                aria-hidden="true"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="16"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  opacity="0.35"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  opacity="0.65"
                />
                <circle cx="24" cy="24" r="4" fill="currentColor" />
              </svg>
            </div>
            <b>No budget set for {fM(S.m)}</b>
            <small>
              Set a monthly spending limit to manage your budget and stay on
              track.
            </small>
          </div>
        )}
        <button className="btn" onClick={onBudget}>
          {b ? "Edit budget" : "Set monthly budget"}
        </button>
      </div>
    </>
  );

  const recurring = (
    <>
      <div className="two">
        <div className="card" style={{ margin: 0 }}>
          <small className="lbl">Active</small>
          <div className="big" style={{ fontSize: 30, margin: "2px 0 0" }}>
            {act.length}
          </div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <small className="lbl">Monthly est.</small>
          <div className="big" style={{ fontSize: 26, margin: "6px 0 0" }}>
            {M(est)}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: "6px 14px" }}>
        {S.rec.length ? (
          S.rec.map((r) => (
            <div className="ri" key={r.id} style={{ opacity: r.on ? 1 : 0.55 }}>
              <i className="ic" style={{ "--c": CAT[r.cat][1] }}>
                <CategorySymbol category={r.cat} />
              </i>
              <span className="nm">
                <b>{r.desc}</b>
                <small>
                  {r.on
                    ? (r.iv === "weekly" ? "Weekly" : "Monthly") +
                      " · next " +
                      dayMonth(r.next)
                    : "Paused"}{" "}
                  · {M(r.amt)}
                </small>
              </span>
              <button
                className={"sw " + (r.on ? "on" : "")}
                type="button"
                aria-label={`${r.on ? "Pause" : "Resume"} ${r.desc}`}
                aria-pressed={r.on}
                onClick={() => onToggleRec(r.id)}
              />
              <button
                className="remove-rec"
                aria-label="Remove"
                onClick={() => onRemoveRec(r.id)}
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <div className="emp-illustrated">
            <div className="emp-illustrated-icon">
              <svg
                viewBox="0 0 48 48"
                fill="none"
                className="emp-svg"
                aria-hidden="true"
              >
                <rect
                  x="9"
                  y="11"
                  width="30"
                  height="28"
                  rx="6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                />
                <line
                  x1="9"
                  y1="20"
                  x2="39"
                  y2="20"
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity="0.4"
                />
                <line
                  x1="16"
                  y1="8"
                  x2="16"
                  y2="13"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <line
                  x1="32"
                  y1="8"
                  x2="32"
                  y2="13"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <path
                  d="M21 28H27M24 25V31"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <b>No recurring expenses</b>
            <small>
              Schedule subscriptions, utilities, or rent payments to track
              automatically.
            </small>
          </div>
        )}
      </div>
      <button className="btn" onClick={onAddRec}>
        Add recurring expense
      </button>
    </>
  );

  return (
    <>
      <div
        className="seg"
        style={{ marginBottom: 14, background: "var(--card)" }}
      >
        <button
          className={plan === "budget" ? "on" : ""}
          onClick={() => setPlan("budget")}
        >
          Budget
        </button>
        <button
          className={plan === "rec" ? "on" : ""}
          onClick={() => setPlan("rec")}
        >
          Recurring
        </button>
      </div>
      {plan === "budget" ? budget : recurring}
    </>
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
  onAccountChange,
  onSave,
  onClose,
}) {
  const spendableCards = cards.filter((c) => c.type !== "savings" && !c.frozen);
  const primaryCard = spendableCards.find((c) => c.isPrimary) || spendableCards[0];
  const hasSavingsAccount = Boolean(getSavingsAccountId(cards));

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

  const [f, setF] = useState({
    amt: "",
    desc: "",
    cat: categoryOrder.find((category) => category !== "Savings") || "Food",
    date: ld(),
    acct: resolvedInitialAcct,
    iv: iv || "none",
  });
  const [categoryTouched, setCategoryTouched] = useState(false);
  const amtInputRef = useRef(null);
  const descInputRef = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const custom = f.date !== ld() && f.date !== ago(1);
  const categorySuggestion = categoryTouched
    ? ""
    : suggestedCategory(f.desc, expenses);

  return (
    <Sheet
      onClose={onClose}
      actions={
        <button className="btn" onClick={() => onSave(f)}>
          {f.cat === "Savings" && hasSavingsAccount
            ? f.iv === "none"
              ? "Save to Savings"
              : "Schedule savings transfer"
            : f.iv === "none"
              ? "Add expense"
              : "Schedule expense"}
        </button>
      }
    >
      <h3 id="sheet-title">
        {f.cat === "Savings" && hasSavingsAccount
          ? "Savings transfer"
          : "New expense"}
      </h3>
      <div className="amt">
        <span>৳</span>
        <input
          ref={amtInputRef}
          inputMode="decimal"
          enterKeyHint="next"
          aria-label={
            f.cat === "Savings" ? "Savings transfer amount" : "Expense amount"
          }
          placeholder="0"
          value={f.amt}
          onChange={(e) => set("amt", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              descInputRef.current?.focus();
            }
          }}
        />
      </div>
      <p className="hint">
        {f.cat === "Savings" && f.iv === "none"
          ? "Enter an amount to record a savings transfer."
          : f.iv === "none"
            ? "Leave the amount blank to fill it in later."
            : f.cat === "Savings"
              ? "Recurring savings need an amount."
              : "Recurring expenses need an amount."}
      </p>

      <span className="lbl">Category</span>
      <div className="cg">
        {categoryOrder.map((c) => (
          <button
            key={c}
            className={f.cat === c ? "on" : ""}
            onClick={() => {
              setCategoryTouched(true);
              setF((current) => ({
                ...current,
                cat: c,
                ...(c === "Savings" && hasSavingsAccount && !current.acct
                  ? { acct: spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <CategorySymbol category={c} />
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

      <span className="lbl">What was it for?</span>
      <input
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
          if (!categoryTouched) {
            const suggestion = suggestedCategory(description, expenses);
            if (suggestion) {
              set("cat", suggestion);
            } else if (!description.trim()) {
              set("cat", categoryOrder.find((category) => category !== "Savings") || "Food");
            }
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            onSave(f);
          }
        }}
      />
      {categorySuggestion && categorySuggestion !== f.cat && (
        <p
          className="category-suggestion-hint"
          role="status"
          aria-live="polite"
        >
          <span>Suggested category:</span>
          <b>
            <CategorySuggestionValue category={categorySuggestion} />
          </b>
        </p>
      )}

      <span className="lbl">Date</span>
      <div className="seg">
        <button
          className={f.date === ld() ? "on" : ""}
          onClick={() => set("date", ld())}
        >
          Today
        </button>
        <button
          className={f.date === ago(1) ? "on" : ""}
          onClick={() => set("date", ago(1))}
        >
          Yesterday
        </button>
        <input
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
        {f.cat === "Savings" && hasSavingsAccount ? "Transfer from" : "Paid from"}
      </span>
      <AccountPicker
        value={f.acct}
        onPick={(v) => {
          set("acct", v);
          if (f.cat !== "Savings") {
            onAccountChange?.(v);
          }
        }}
        cards={cards}
        options={
          f.cat === "Savings" && hasSavingsAccount && spendableCards.length > 0
            ? spendableCards.map((c) => [c.id, c.name])
            : [["", "Cash"], ...spendableCards.map((c) => [c.id, c.name])]
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
    </Sheet>
  );
}

function TxSheet({ type, defaultAccount, cards = [], onSave, onClose }) {
  const accountOptions = cards.map((c) => [c.id, c.name]);
  const unfrozenFromOptions = cards
    .filter((c) => !c.frozen)
    .map((c) => [c.id, c.name]);
  const defaultFrom =
    defaultAccount && cards.some((c) => c.id === defaultAccount)
      ? defaultAccount
      : cards[0]?.id || "";
  const defaultTransferFrom =
    defaultAccount && unfrozenFromOptions.some(([id]) => id === defaultAccount)
      ? defaultAccount
      : unfrozenFromOptions[0]?.[0] || defaultFrom;
  const defaultTo =
    cards.find((c) => c.id !== defaultTransferFrom)?.id || cards[1]?.id || "";

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
  const amtInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const reasonSelectRef = useRef(null);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const tr = g.type === "transfer";
  const customDate = g.date !== ld() && g.date !== ago(1);
  const transferFromOptions =
    unfrozenFromOptions.length > 0 ? unfrozenFromOptions : accountOptions;
  const fromCardIsFrozen = cards.find((c) => c.id === g.fromAccount)?.frozen;
  const amtNum = parseAmount(g.amt);
  const hasValidAmt = Number.isFinite(amtNum) && amtNum > 0;
  const canSave =
    hasValidAmt &&
    accountOptions.length > 0 &&
    (!tr ||
      (accountOptions.length >= 2 &&
        g.fromAccount !== g.toAccount &&
        !fromCardIsFrozen));

  return (
    <Sheet
      onClose={onClose}
      actions={
        <button
          className="btn"
          disabled={!canSave}
          onClick={() => canSave && onSave(g)}
        >
          Save
        </button>
      }
    >
      <h3 id="sheet-title">Account activity</h3>
      <Seg
        value={g.type}
        onPick={(v) => {
          setG((current) => ({ ...current, type: v, note: "" }));
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
      <div className="amt">
        <span>৳</span>
        <input
          ref={amtInputRef}
          inputMode="decimal"
          enterKeyHint="next"
          aria-label={`${g.type === "adjust" ? "Adjustment" : g.type === "transfer" ? "Transfer" : "Income"} amount in taka`}
          placeholder="0"
          value={g.amt}
          onChange={(e) => set("amt", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (g.type === "adjust") {
                reasonSelectRef.current?.focus();
              } else {
                noteInputRef.current?.focus();
              }
            }
          }}
        />
      </div>

      {tr && accountOptions.length < 2 && (
        <p className="hint">
          Add at least two cards or wallets to transfer between accounts.
        </p>
      )}

      {tr && accountOptions.length >= 2 && (
        <>
          <span className="lbl">From</span>
          <AccountPicker
            value={g.fromAccount}
            onPick={(value) => {
              setG((current) => ({
                ...current,
                fromAccount: value,
                toAccount:
                  current.toAccount === value
                    ? accountOptions.find(([id]) => id !== value)?.[0]
                    : current.toAccount,
              }));
            }}
            cards={cards}
            options={transferFromOptions}
          />
          <span className="lbl">To</span>
          <AccountPicker
            value={g.toAccount}
            onPick={(value) => set("toAccount", value)}
            cards={cards}
            options={accountOptions.filter(([id]) => id !== g.fromAccount)}
          />
        </>
      )}

      {!tr && (
        <>
          <span className="lbl">Account</span>
          <AccountPicker
            value={g.acct}
            onPick={(v) => set("acct", v)}
            cards={cards}
            options={accountOptions}
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
          className={g.date === ld() ? "on" : ""}
          onClick={() => set("date", ld())}
        >
          Today
        </button>
        <button
          className={g.date === ago(1) ? "on" : ""}
          onClick={() => set("date", ago(1))}
        >
          Yesterday
        </button>
        <input
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

function AccountTxDetailSheet({ tx, cards = [], onSave, onDelete, onClose }) {
  const baseAccountOptions = [
    ["cash", "Cash"],
    ...cards.map((c) => [c.id, c.name]),
  ];
  const ensureAccountOption = (id) => {
    if (!id) return baseAccountOptions;
    const normalizedId = id === "" ? "cash" : id;
    if (baseAccountOptions.some(([optId]) => optId === normalizedId)) {
      return baseAccountOptions;
    }
    return [
      ...baseAccountOptions,
      [normalizedId, getAccountDisplay(normalizedId, cards)[0]],
    ];
  };
  const [g, setG] = useState({
    type: tx.type === "adjustment" ? "adjust" : tx.type || "income",
    amt: tx.amt ?? "",
    acct: tx.acct || cards[0]?.id || "cash",
    dir: tx.dir || (tx.direction === "decrease" ? "down" : "up"),
    note: tx.note || "",
    date: tx.date || ld(),
    fromAccount: tx.acct || cards[0]?.id || "cash",
    toAccount:
      tx.to || cards.find((c) => c.id !== tx.acct)?.id || (cards[0]?.id ? "cash" : ""),
  });
  const amtInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const reasonSelectRef = useRef(null);
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const tr = g.type === "transfer";
  const allFromOptions = ensureAccountOption(g.fromAccount);
  const normFrom = g.fromAccount === "" ? "cash" : g.fromAccount;
  const allToOptions = ensureAccountOption(g.toAccount).filter(
    ([id]) => id !== normFrom,
  );
  const singleAccountOptions = ensureAccountOption(g.acct);
  const normTo = g.toAccount === "" ? "cash" : g.toAccount;
  const amtNum = parseAmount(g.amt);
  const hasValidAmt = Number.isFinite(amtNum) && amtNum > 0;
  const canSave =
    hasValidAmt &&
    (tr
      ? allFromOptions.length >= 1 &&
        allToOptions.length >= 1 &&
        normFrom !== normTo
      : singleAccountOptions.length > 0);

  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button
            className="btn"
            disabled={!canSave}
            onClick={() => canSave && onSave(tx.id, g)}
          >
            Save changes
          </button>
          <button className="btn del" onClick={() => onDelete(tx.id)}>
            Delete
          </button>
        </>
      }
    >
      <h3 id="sheet-title">Edit account activity</h3>
      <Seg
        value={g.type}
        onPick={(v) => {
          setG((current) => ({
            ...current,
            type: v,
            acct:
              v === "transfer"
                ? current.fromAccount || current.acct
                : current.acct,
            fromAccount:
              v === "transfer"
                ? current.acct || current.fromAccount
                : current.fromAccount,
          }));
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
      <div className="amt">
        <span>৳</span>
        <input
          ref={amtInputRef}
          inputMode="decimal"
          enterKeyHint="next"
          aria-label="Transaction amount in taka"
          placeholder="0"
          value={g.amt}
          onChange={(e) => set("amt", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (g.type === "adjust") {
                reasonSelectRef.current?.focus();
              } else {
                noteInputRef.current?.focus();
              }
            }
          }}
        />
      </div>

      {tr ? (
        <>
          <span className="lbl">From</span>
          <AccountPicker
            value={g.fromAccount}
            onPick={(value) => {
              setG((current) => ({
                ...current,
                fromAccount: value,
                acct: value,
                toAccount:
                  current.toAccount === value
                    ? allFromOptions.find(([id]) => id !== value)?.[0] || ""
                    : current.toAccount,
              }));
            }}
            cards={cards}
            options={allFromOptions}
          />
          <span className="lbl">To</span>
          <AccountPicker
            value={g.toAccount}
            onPick={(value) => set("toAccount", value)}
            cards={cards}
            options={allToOptions}
          />
        </>
      ) : (
        <>
          <span className="lbl">Account</span>
          <AccountPicker
            value={g.acct}
            onPick={(v) => {
              setG((current) => ({
                ...current,
                acct: v,
                fromAccount: v,
              }));
            }}
            cards={cards}
            options={singleAccountOptions}
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
      <input
        className="in"
        type="date"
        aria-label="Transaction date"
        value={g.date}
        onChange={(e) => {
          if (e.target.value) set("date", e.target.value);
        }}
      />

      {g.type === "adjust" ? (
        <>
          <span className="lbl">Reason (optional)</span>
          <select
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

function DetailSheet({ e, suggestion, cards = [], onSave, onDelete, onClose }) {
  const [f, setF] = useState({
    desc: e.desc,
    amt: e.amt ?? "",
    cat: e.cat,
    date: e.date,
    acct: e.acct || "",
  });
  const amtInputRef = useRef(null);
  const descInputRef = useRef(null);
  const set = (key, value) => setF((current) => ({ ...current, [key]: value }));
  const amtNum = parseAmount(f.amt);
  const isSavings = f.cat === "Savings";
  const hasSavingsAccount = Boolean(getSavingsAccountId(cards));
  const spendableCards = cards.filter((c) => c.type !== "savings" && !c.frozen);
  const canSave =
    Boolean(f.desc?.trim()) &&
    Boolean(f.date) &&
    (amtNum === null || (Number.isFinite(amtNum) && amtNum > 0)) &&
    (!isSavings ||
      (amtNum !== null &&
        amtNum > 0 &&
        (!hasSavingsAccount || Boolean(f.acct))));
  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={!canSave}
            onClick={() => canSave && onSave(e.id, f)}
          >
            Save changes
          </button>
          <button type="button" className="btn del" onClick={() => onDelete(e.id)}>
            Delete expense
          </button>
        </>
      }
    >
      <h3 id="sheet-title">Edit expense</h3>
      <div className="amt">
        <span>৳</span>
        <input
          ref={amtInputRef}
          inputMode="decimal"
          enterKeyHint="next"
          aria-label="Expense amount in taka"
          placeholder="0"
          value={f.amt}
          onChange={(event) => set("amt", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              descInputRef.current?.focus();
            }
          }}
        />
      </div>
      <span className="lbl">What was it for?</span>
      <input
        ref={descInputRef}
        className="in"
        maxLength={80}
        aria-label="Expense description"
        enterKeyHint="done"
        value={f.desc}
        onChange={(event) => set("desc", event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            if (canSave) onSave(e.id, f);
          }
        }}
      />
      <span className="lbl">Category</span>
      {suggestion && suggestion !== e.cat && (
        <button
          className="category-suggestion-action"
          type="button"
          onClick={() => set("cat", suggestion)}
        >
          Use suggestion: <CategorySuggestionValue category={suggestion} />
        </button>
      )}
      <div className="cg">
        {Object.keys(CAT).map((category) => (
          <button
            type="button"
            key={category}
            className={f.cat === category ? "on" : ""}
            onClick={() => {
              setF((current) => ({
                ...current,
                cat: category,
                ...(category === "Savings" && hasSavingsAccount && !current.acct
                  ? { acct: spendableCards[0]?.id || "" }
                  : {}),
              }));
            }}
          >
            <CategorySymbol category={category} />
            <span>{category}</span>
          </button>
        ))}
      </div>
      <span className="lbl">Date</span>
      {e.rec && (
        <p className="hint recurring-date-note">
          This recurring expense stays on its scheduled date.
        </p>
      )}
      <input
        className="in"
        type="date"
        aria-label="Expense date"
        value={f.date}
        disabled={e.rec}
        onChange={(event) => set("date", event.target.value)}
      />
      <span className="lbl">
        {isSavings && hasSavingsAccount ? "Transfer from" : "Paid from"}
      </span>
      <AccountPicker
        value={f.acct}
        onPick={(value) => set("acct", value)}
        cards={cards}
        options={
          isSavings && hasSavingsAccount && spendableCards.length > 0
            ? spendableCards.map((c) => [c.id, c.name])
            : [
                ["", "Cash"],
                ...cards
                  .filter((c) => c.type !== "savings")
                  .map((c) => [c.id, c.name]),
                ...(f.acct &&
                f.acct !== "cash" &&
                !cards.some((c) => c.id === f.acct)
                  ? [[f.acct, getAccountDisplay(f.acct, cards)[0]]]
                  : []),
              ]
        }
      />
    </Sheet>
  );
}

function BudgetSheet({ S, onSave, onClear, onClose }) {
  const currentBudget = S?.bud?.[S.m] || "";
  const [v, setV] = useState(currentBudget);
  const amtInputRef = useRef(null);
  return (
    <Sheet
      onClose={onClose}
      actionsClassName={currentBudget ? "is-paired" : ""}
      actions={
        <>
          <button
            className="btn"
            onClick={() => {
              const num = parseAmount(v);
              onSave(num);
            }}
          >
            Save budget
          </button>
          {currentBudget ? (
            <button className="btn del" onClick={onClear}>
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
      <div className="amt">
        <span>৳</span>
        <input
          ref={amtInputRef}
          inputMode="decimal"
          enterKeyHint="done"
          aria-label="Monthly budget amount in taka"
          placeholder="20000"
          value={v}
          onChange={(x) => setV(x.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const num = parseAmount(v);
              onSave(num);
            }
          }}
        />
      </div>
    </Sheet>
  );
}

function SettingsSheet({
  S,
  profile,
  onTheme,
  onAdvanced,
  onProfileSettings,
  onSecurity,
  onClose,
}) {
  const dark = S.theme === "dark";
  return (
    <Sheet onClose={onClose}>
      <h3 id="sheet-title">Settings</h3>
      <button
        className="ri settings-profile-row"
        type="button"
        aria-label="Open profile and sync settings"
        onClick={onProfileSettings}
      >
        <i className="ic" style={{ "--c": "var(--g)" }}>
          {profile?.initial || "S"}
        </i>
        <span className="nm">
          <b>{profile?.name || "Local profile"}</b>
          <small>{profile?.email || "Data stays on this device"}</small>
        </span>
        <span className="settings-chevron" aria-hidden="true">
          <Icon n="r" />
        </span>
      </button>
      <button
        className="ri"
        type="button"
        aria-pressed={dark}
        onClick={onTheme}
      >
        <span className="nm">
          <b>Dark mode</b>
          <small>{dark ? "On" : "Off"}</small>
        </span>
        <span className={"sw " + (dark ? "on" : "")} aria-hidden="true" />
      </button>
      <button className="ri" type="button" onClick={onAdvanced}>
        <span className="nm">
          <b>App settings</b>
          <small>Reminders &amp; backups</small>
        </span>
        <span className="settings-chevron" aria-hidden="true">
          <Icon n="r" />
        </span>
      </button>
      <button className="ri" type="button" onClick={onSecurity}>
        <span className="nm">
          <b>Security &amp; App Lock</b>
          <small>
            {hasAppPin() ? "Passcode active" : "Set PIN passcode & biometrics"}
          </small>
        </span>
        <span className="settings-chevron" aria-hidden="true">
          <Icon n="r" />
        </span>
      </button>
    </Sheet>
  );
}

const CARD_THEMES = [
  {
    id: "emerald",
    name: "Emerald Vault",
    color: "#047857",
    gradient:
      "linear-gradient(135deg, #065f46 0%, #047857 35%, #064e3b 70%, #022c22 100%)",
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

function getCardLabel(prov) {
  if (prov.id === "custom") return { label: "Custom", type: "custom" };
  if (prov.category === "mfs" || prov.isPhone)
    return { label: "MFS", type: "mfs" };
  if (prov.category === "savings") return { label: "Vault", type: "savings" };
  if (prov.defaultNetwork === "visa") return { label: "Visa", type: "visa" };
  if (prov.defaultNetwork === "mastercard")
    return { label: "Mastercard", type: "mastercard" };
  if (prov.defaultNetwork === "amex") return { label: "Amex", type: "amex" };
  return { label: "Bank", type: "bank" };
}

function AddCardSheet({ onClose, onAddCard, userProfileName = "Cardholder" }) {
  const [step, setStep] = useState("catalog"); // 'catalog' | 'customize' | 'success'
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState(CARD_PROVIDERS[0]);
  const [createdCard, setCreatedCard] = useState(null);

  // Form State with Live Synchronization - Clean & Unfilled Initially (Use placeholders instead of pre-typed text)
  const [formData, setFormData] = useState({
    name: "",
    holderName: "",
    last4: "",
    number: "",
    type: "credit",
    network: "visa",
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
    setSelectedProvider(prov);
    setFormData({
      name: "",
      holderName: "",
      type: prov.defaultType || "credit",
      network: prov.defaultNetwork || "visa",
      last4: "",
      number: "",
      expiry: "",
      initialBalance: "",
      color: prov.color || "#1e293b",
      gradient: prov.gradient || "",
    });
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
      const digits = raw.replace(/[^\d+]/g, "").slice(0, 14);
      setFormData((prev) => ({ ...prev, last4: digits.slice(-4), number: digits }));
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

    const defaultNum = selectedProvider.numberPlaceholder.replace(/\s+/g, "");
    const defaultLast4 = selectedProvider.isPhone ? defaultNum : defaultNum.slice(-4);
    const last4 = (formData.last4 || formData.number || "").trim() || defaultLast4;
    const number = selectedProvider.isPhone
      ? (formData.number.trim() || defaultNum)
      : `•••• •••• •••• ${last4}`;
    const holderName =
      formData.holderName.trim() || userProfileName || "Cardholder";
    const network = isMfs
      ? "mfs"
      : isSavings
        ? "none"
        : formData.network || selectedProvider.defaultNetwork || "visa";
    const type = isMfs
      ? "mfs"
      : isSavings
        ? "savings"
        : formData.type || selectedProvider.defaultType || "credit";
    const name = formData.name.trim() || selectedProvider.name;

    const newCard = {
      id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      provider: selectedProvider.id,
      category: selectedProvider.category,
      type,
      network,
      holderName,
      subtitle: isMfs
        ? "Personal Wallet"
        : isSavings
          ? "High-Yield Vault"
          : isCustom
            ? `${name} ${network === "visa" ? "Visa" : network === "mastercard" ? "Mastercard" : "Card"}`
            : selectedProvider.subtitle,
      last4,
      number,
      expiry: isMfs || isSavings ? "" : formData.expiry.trim() || "12/28",
      color: formData.color || selectedProvider.color,
      gradient: formData.gradient || selectedProvider.gradient,
      initialBalance: parseAmount(formData.initialBalance) || 0,
    };

    onAddCard(newCard);
    setCreatedCard(newCard);
    setStep("success");
    triggerHaptic("success");
  };

  const previewCard = {
    id: "preview",
    name:
      formData.name.trim() ||
      (isCustom ? "Custom Card" : selectedProvider.name),
    provider: selectedProvider.id,
    type: formData.type || selectedProvider.defaultType || "credit",
    network: formData.network || selectedProvider.defaultNetwork || "visa",
    holderName:
      formData.holderName.trim() ||
      (userProfileName
        ? userProfileName.toUpperCase()
        : isCustom
          ? "CARDHOLDER"
          : selectedProvider.name.toUpperCase()),
    subtitle: isCustom
      ? formData.name.trim()
        ? `${formData.name.trim()} ${formData.network === "visa" ? "Visa" : formData.network === "mastercard" ? "Mastercard" : "Amex"}`
        : formData.network === "visa"
          ? formData.type === "credit"
            ? "Custom Visa Credit"
            : "Custom Visa Debit"
          : formData.network === "mastercard"
            ? formData.type === "credit"
              ? "Custom Mastercard Credit"
              : "Custom Mastercard Debit"
            : "Custom Amex"
      : selectedProvider.subtitle,
    last4: formData.last4 || (formData.number ? formData.number.slice(-4) : ""),
    number: formData.last4 ? `•••• •••• •••• ${formData.last4}` : formData.number,
    expiry: formData.expiry,
    color: formData.color || selectedProvider.color,
    gradient: formData.gradient || selectedProvider.gradient,
  };

  return (
    <Sheet onClose={onClose}>
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
              type="text"
              className="add-card-search-input"
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
                        {prov.currency || "USD"}
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
              showBalance={false}
              showFullDetails={true}
            />
          </div>

          {/* Form Fields ("Card Details") */}
          <div className="add-card-form-body">
            <h4 className="add-card-section-label">Card Details</h4>

            {!selectedProvider.isPhone &&
              selectedProvider.category !== "savings" && (
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
              selectedProvider.category !== "savings" && (
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

            {selectedProvider.id === "custom" && (
              <div className="add-card-field">
                <label className="add-card-input-lbl">Bank / Card Name</label>
                <input
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
              <label className="add-card-input-lbl">Card Holder Name</label>
              <input
                className="add-card-native-input"
                type="text"
                maxLength={30}
                placeholder={userProfileName || "John Smith"}
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

            <div className="add-card-field">
              <label className="add-card-input-lbl">
                {selectedProvider.isPhone ? "Mobile Number" : "Last 4 Digits"}
              </label>
              <input
                className="add-card-native-input"
                type="text"
                inputMode="numeric"
                maxLength={selectedProvider.isPhone ? 14 : 4}
                placeholder={
                  selectedProvider.isPhone
                    ? selectedProvider.numberPlaceholder || "01712 345678"
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

            {!selectedProvider.isPhone &&
              selectedProvider.category !== "savings" && (
                <div className="add-card-field">
                  <label className="add-card-input-lbl">Expiry (MM/YY)</label>
                  <input
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
                <span className="add-card-curr-prefix">৳</span>
                <input
                  className="add-card-native-input add-card-balance-input"
                  inputMode="decimal"
                  enterKeyHint="done"
                  placeholder="0.00"
                  value={formData.initialBalance}
                  onChange={(e) =>
                    handleFormChange("initialBalance", e.target.value)
                  }
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
              🔒 <b>Privacy Notice:</b> Spend is a client-side personal expense tracker. Data is stored on your device. Never enter real CVV, PIN, or full card credentials.
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
  onSetPrimaryCard,
  onMoveCardToFront,
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
    selectedCard?.provider === "savings";

  const isCard = !isMfs && !isSavings;
  const initialCardBal =
    (selectedCard?.id != null ? startBalances[selectedCard.id] : undefined) ??
    selectedCard?.initialBalance;

  const [formData, setFormData] = useState({
    name: selectedCard?.name || "",
    holderName: selectedCard?.holderName || "Cardholder",
    subtitle: selectedCard?.subtitle || "",
    last4:
      selectedCard?.last4 ||
      (selectedCard?.number
        ? selectedCard.number.replace(/\D/g, "").slice(-4)
        : ""),
    number: selectedCard?.number || "",
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (selectedCard) {
      const cardBal =
        (selectedCard.id != null ? startBalances[selectedCard.id] : undefined) ??
        selectedCard.initialBalance;
      setFormData({
        name: selectedCard.name || "",
        holderName: selectedCard.holderName || "Cardholder",
        subtitle: selectedCard.subtitle || "",
        last4:
          selectedCard.last4 ||
          (selectedCard.number
            ? selectedCard.number.replace(/\D/g, "").slice(-4)
            : ""),
        number: selectedCard.number || "",
        expiry: selectedCard.expiry || "",
        network: selectedCard.network || "visa",
        type: selectedCard.type || "credit",
        color: selectedCard.color || "#1e293b",
        gradient:
          selectedCard.gradient ||
          "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
        initialBalance:
          cardBal !== undefined && cardBal !== null ? String(cardBal) : "",
      });
      setIsFrozen(Boolean(selectedCard.frozen));
      setConfirmDeleteOpen(false);
    }
  }, [selectedCard?.id, startBalances]);

  const previewCard = useMemo(() => {
    if (!selectedCard) return null;
    return {
      ...selectedCard,
      name: formData.name || selectedCard.name,
      holderName: formData.holderName || selectedCard.holderName,
      subtitle: formData.subtitle || selectedCard.subtitle,
      network: formData.network || selectedCard.network,
      type: formData.type || selectedCard.type,
      gradient: formData.gradient,
      color: formData.color,
      last4: formData.last4 || (formData.number ? formData.number.slice(-4) : ""),
      number:
        isMfs || isSavings
          ? formData.number || selectedCard.number
          : formData.last4
            ? `•••• •••• •••• ${formData.last4}`
            : formData.number,
      expiry: formData.expiry,
      frozen: isFrozen,
    };
  }, [selectedCard, formData, isFrozen, isMfs, isSavings]);

  const handleCardNumberChange = (raw) => {
    if (isMfs) {
      const digits = raw.replace(/[^\d+]/g, "").slice(0, 14);
      setFormData((prev) => ({ ...prev, number: digits, last4: digits.slice(-4) }));
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
    const raw = String(formData.last4 || formData.number || selectedCard?.last4 || selectedCard?.number || "").trim();
    const toCopy = raw.includes("•") ? raw : raw.replace(/\s+/g, "");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(toCopy).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleFreeze = () => {
    if (!selectedCard) return;
    triggerHaptic("warning");
    const nextFrozen = !isFrozen;
    setIsFrozen(nextFrozen);
    const { initialBalance: _initBal, ...safeFormData } = formData;
    onUpdateCard?.({
      ...selectedCard,
      ...safeFormData,
      frozen: nextFrozen,
      id: selectedCard.id,
    });
  };

  const handleSave = () => {
    if (!selectedCard) return;
    triggerHaptic("success");
    const trimmed = String(formData.initialBalance || "").trim();
    const rawBal = trimmed !== "" ? parseAmount(trimmed) : NaN;
    const parsedInitial =
      Number.isFinite(rawBal) && rawBal >= 0 ? rawBal : undefined;
    const { initialBalance: _initBal, ...safeFormData } = formData;
    onUpdateCard?.({
      ...selectedCard,
      ...safeFormData,
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
                onClose();
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
                aria-label="Copy card number to clipboard"
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
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{copied ? "Copied! ✓" : "Copy"}</span>
              </button>

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

            <div className="card-options-quick-row is-wallet-row">
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
                <span>{selectedCard?.isPrimary ? "Primary Card ★" : "Set as Primary"}</span>
              </button>

              {cards.length > 1 && cards[0]?.id !== selectedCard?.id && (
                <button
                  type="button"
                  className="card-options-bar-btn"
                  onClick={() => {
                    if (selectedCard?.id) {
                      triggerHaptic("selection");
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
          </div>
        </div>

        {/* Card Details & Editing Section */}
        <div className="card-options-edit-section">
          <h4 className="card-options-section-title">Edit Card Details</h4>

          <div className="card-options-form-grid">
            {/* If regular card (Visa, Mastercard, Amex, Bank, Custom) */}
            {isCard && (
              <>
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
                  <label>{isMfs ? "Phone / Account Number" : "Last 4 Digits"}</label>
                  <input
                    type="text"
                    inputMode={isMfs ? "tel" : "numeric"}
                    placeholder={isMfs ? "01712 •••678" : "9018"}
                    maxLength={isMfs ? 16 : 4}
                    value={isMfs ? (formData.number || "") : (formData.last4 || "")}
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
                    type="text"
                    inputMode="numeric"
                    placeholder="01712 345678"
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
                    type="text"
                    value={formData.number}
                    placeholder="SAV-8829-01"
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        number: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="card-options-field">
                  <label>Tag / Subtitle</label>
                  <input
                    type="text"
                    value={formData.subtitle}
                    placeholder="e.g. High-Yield Vault"
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

            {/* Theme & Color Swatches */}
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

            {/* Starting Balance Field */}
            <div className="card-options-field">
              <label>Starting Balance</label>
              <div className="add-card-balance-input-wrap">
                <span className="add-card-curr-prefix">৳</span>
                <input
                  className="add-card-native-input add-card-balance-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={formData.initialBalance}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      initialBalance: e.target.value,
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
            </div>
          </div>
        </div>

        {/* Quick Balance Adjustment Shortcut */}
        <div className="card-options-balance-row">
          <div className="card-options-balance-info">
            <span className="card-options-balance-lbl">Available Balance</span>
            <b className="card-options-balance-num">
              {formatMoney(balances[selectedCard?.id] || 0)}
            </b>
          </div>
          <button
            type="button"
            className="card-options-adj-btn"
            onClick={() => {
              onClose();
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

function ProfileSettingsPage({
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
  onSignIn,
  onSignOut,
  onResumeSync,
}) {
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
    if (isLive) return "Synced";
    if (cloudRealtimeStatus === "reconnecting") return "Reconnecting…";
    return "Cloud sync on";
  })();

  return (
    <>
      <p className="settings-page-intro">
        {profile?.connected
          ? "Manage your name, account, and cloud sync."
          : "Sign in to add a profile name and sync across devices."}
      </p>

      <section className="card app-settings-card">
        <h2>Your profile</h2>
        {profile?.connected ? (
          <div className="ri settings-profile-row">
            <i className="ic" style={{ "--c": "var(--g)" }}>
              {profile.initial || "S"}
            </i>
            <span className="nm">
              <b>{profile.name || "Account"}</b>
              <small>{profile.email || "Signed-in account"}</small>
            </span>
            <button
              className="settings-profile-edit"
              type="button"
              aria-label="Edit profile name"
              onClick={onEditProfile}
            >
              <FaPenToSquare aria-hidden="true" focusable="false" />
            </button>
          </div>
        ) : (
          <button
            className="ri settings-profile-row settings-profile-guest"
            type="button"
            aria-label="Sign in to edit your profile"
            onClick={onSignIn}
          >
            <i className="ic" style={{ "--c": "var(--g)" }}>
              {profile?.initial || "S"}
            </i>
            <span className="nm">
              <b>{profile?.name || "Local profile"}</b>
              <small>Sign in to edit your profile</small>
            </span>
            <span className="settings-profile-signin-label" aria-hidden="true">
              Sign in
              <Icon n="r" />
            </span>
          </button>
        )}
        {profileStatus && (
          <p className="settings-status" role="status" aria-live="polite">
            {profileStatus}
          </p>
        )}
      </section>

      <section className="card app-settings-card">
        <h2>Sync</h2>
        <div
          className={`profile-sync-status${isLive ? " is-live" : ""}${
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
        {accountStatus && (
          <p className="settings-status" role="status" aria-live="polite">
            {accountStatus}
          </p>
        )}
        {profile?.connected && (!cloudSyncEnabled || hasSyncError) && (
          <button
            className="btn settings-account-action"
            type="button"
            disabled={authBusy}
            onClick={onResumeSync}
            style={{ marginBottom: "10px" }}
          >
            {hasSyncError ? "Retry sync" : "Resume sync"}
          </button>
        )}
        <button
          className="btn settings-account-action"
          type="button"
          disabled={authBusy}
          onClick={profile?.connected ? onSignOut : onSignIn}
        >
          {profile?.connected
            ? authBusy
              ? "Signing out…"
              : "Sign out"
            : "Sign in to sync"}
        </button>
      </section>
    </>
  );
}

function AppSettingsPage({
  S,
  profile,
  pushBackendConfigured,
  notificationPermission,
  notificationStatus,
  backgroundPushEnabled,
  onSignIn,
  onReminder,
  onToggleNotifications,
  onTestNotification,
  onBackupDownload,
  onEncryptedBackupDownload,
  onExpensesCsv,
  onBackupRestore,
  backupStatus,
}) {
  const notificationUnavailable = notificationPermission === "unsupported";
  const notificationBlocked = notificationPermission === "denied";
  const notificationLabel = pushBackendConfigured
    ? profile?.connected
      ? backgroundPushEnabled
        ? "On"
        : "Off"
      : "Sign in required"
    : notificationUnavailable
      ? "Unavailable"
      : notificationBlocked
        ? "Blocked in browser settings"
        : notificationPermission === "granted"
          ? "Allowed"
          : "Off";
  return (
    <>
      <p className="settings-page-intro">Manage accounts and reminders.</p>

      <section className="card app-settings-card">
        <h2>Reminders</h2>
        <div className="ri settings-time-row">
          <i className="ic" style={{ "--c": "#d6a31f" }}>
            <Icon n="bell" />
          </i>
          <span className="nm">
            <b>Daily reminder</b>
            <small>Time for recurring payments</small>
          </span>
          <input
            className="in settings-time-input"
            type="time"
            aria-label="Daily reminder time"
            value={S.rt}
            onChange={(event) => onReminder(event.target.value)}
          />
        </div>
        <button
          className="ri settings-action"
          type="button"
          disabled={notificationBlocked || notificationUnavailable}
          onClick={onToggleNotifications}
        >
          <i className="ic" style={{ "--c": "#2f9a6b" }}>
            <Icon n="bell" />
          </i>
          <span className="nm">
            <b>Built-in notifications</b>
            <small>{notificationLabel}</small>
          </span>
          <span className="settings-inline-action">
            {notificationPermission === "granted" ? "Active" : "Enable"}
          </span>
        </button>
        {onTestNotification && (
          <button
            className="ri settings-action"
            type="button"
            onClick={onTestNotification}
          >
            <i className="ic" style={{ "--c": "#3b82c4" }}>
              <Icon n="bell" />
            </i>
            <span className="nm">
              <b>Send test notification</b>
              <small>Tests built-in notification banner &amp; tone</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>
        )}
        <p className="settings-note" role="status" aria-live="polite">
          {notificationStatus ||
            (pushBackendConfigured && !profile?.connected
              ? "Sign in to enable background reminders."
              : "Notifications remind you when a scheduled expense is due.")}
        </p>
      </section>

      <section className="card app-settings-card app-settings-data-card">
        <h2>Data &amp; backups</h2>
        <button
          className="ri settings-action app-settings-minimal-item"
          type="button"
          onClick={() => {
            triggerHaptic("light");
            onBackupDownload?.();
          }}
        >
          <i className="ic is-minimal" style={{ "--c": "#5b73d9" }}>
            <Icon n="backup" />
          </i>
          <span className="nm">
            <b>Export JSON backup</b>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <button
          className="ri settings-action app-settings-minimal-item"
          type="button"
          onClick={() => {
            triggerHaptic("light");
            onEncryptedBackupDownload?.();
          }}
        >
          <i className="ic is-minimal" style={{ "--c": "#10b981" }}>
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
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <button
          className="ri settings-action app-settings-minimal-item"
          type="button"
          onClick={() => {
            triggerHaptic("light");
            onExpensesCsv?.();
          }}
        >
          <i className="ic is-minimal" style={{ "--c": "#2f9a6b" }}>
            <Icon n="csv" />
          </i>
          <span className="nm">
            <b>Export expenses CSV</b>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <button
          className="ri settings-action app-settings-minimal-item"
          type="button"
          onClick={() => {
            triggerHaptic("light");
            onBackupRestore?.();
          }}
        >
          <i className="ic is-minimal" style={{ "--c": "#8a6fd1" }}>
            <Icon n="restore" />
          </i>
          <span className="nm">
            <b>Restore from backup</b>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        {backupStatus && (
          <p className="settings-status" role="status" aria-live="polite">
            {backupStatus}
          </p>
        )}
      </section>
    </>
  );
}

function SecuritySheet({ onClose, onBack, onLockNow }) {
  const [pinSet, setPinSet] = useState(() => hasAppPin());
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsConfigured, setBiometricsConfigured] = useState(() =>
    hasBiometricsConfigured(),
  );
  const [timeoutMinutes, setTimeoutMinutes] = useState(() =>
    getLockTimeoutMinutes(),
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
    } else if (step === "setup_pin") {
      setStep("overview");
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
        '[data-sheet-autofocus], .amt input[type="password"]'
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
    await setAppPin(pinDraft);
    setPinSet(true);
    triggerHaptic("success");
    setStatusMsg("PIN passcode enabled successfully.");
    setStep("overview");
  };

  const handleRemovePin = async () => {
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

  const handleTimeoutChange = (mins) => {
    setLockTimeoutMinutes(mins);
    setTimeoutMinutes(mins);
    markActive();
    triggerHaptic("selection");
  };

  return (
    <Sheet onClose={onClose}>
      <div className="security-sheet-header">
        <button
          type="button"
          className="prototype-header-back security-sheet-back-btn"
          aria-label={step === "overview" ? "Back to settings" : "Back"}
          onClick={handleBack}
        >
          <Icon n="l" />
        </button>
        <h3 id="sheet-title">Security &amp; App Lock</h3>
      </div>

      {step === "overview" && (
        <div className="security-sheet-content">
          {!pinSet ? (
            <button
              className="ri settings-action"
              type="button"
              onClick={handleStartSetPin}
            >
              <i className="ic" style={{ "--c": "#10b981" }}>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </i>
              <span className="nm">
                <b>4-Digit Passcode</b>
                <small>Not set</small>
              </span>
              <span className="settings-chevron" aria-hidden="true">
                <Icon n="r" />
              </span>
            </button>
          ) : (
            <div className="ri" style={{ justifyContent: "space-between" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minWidth: 0,
                }}
              >
                <i className="ic" style={{ "--c": "#10b981" }}>
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
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
              className="ri settings-action"
              type="button"
              aria-pressed={biometricsConfigured}
              disabled={!biometricsAvailable && !Capacitor.isNativePlatform()}
              onClick={handleToggleBiometrics}
            >
              <i className="ic" style={{ "--c": "#6366f1" }}>
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M9 9h.01M15 9h.01M10 13a2 2 0 0 0 4 0m-2 0v2" />
                </svg>
              </i>
              <span className="nm">
                <b>Biometric Unlock</b>
                <small>
                  {biometricsConfigured
                    ? "Face ID / Touch ID"
                    : biometricsAvailable
                      ? "Off"
                      : "Unavailable on this device"}
                </small>
              </span>
              <span
                className={"sw " + (biometricsConfigured ? "on" : "")}
                aria-hidden="true"
              />
            </button>
          )}

          {pinSet && (
            <div className="security-autolock-wrap">
              <div
                className="ri"
                style={{ borderBottom: 0, paddingBottom: 6 }}
              >
                <i className="ic" style={{ "--c": "#0ea5e9" }}>
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </i>
                <span className="nm">
                  <b>Auto-Lock</b>
                  <small>Require passcode</small>
                </span>
              </div>
              <div style={{ padding: "0 4px 10px" }}>
                <Seg
                  value={timeoutMinutes}
                  onPick={handleTimeoutChange}
                  options={[
                    [0, "Immediately"],
                    [1, "1 min"],
                    [5, "5 min"],
                  ]}
                />
              </div>
            </div>
          )}

          <div className="ri">
            <i className="ic" style={{ "--c": "#10b981" }}>
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </i>
            <span className="nm">
              <b>Cloud Encryption</b>
              <small>End-to-end encrypted</small>
            </span>
            <span className="security-badge-e2e">
              <span className="security-badge-dot" />
              Protected
            </span>
          </div>

          {statusMsg && (
            <p
              className="settings-status"
              role="status"
              aria-live="polite"
              style={{ marginTop: 12 }}
            >
              {statusMsg}
            </p>
          )}

          {pinSet && (
            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn"
                style={{
                  width: "100%",
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
                onClick={() => {
                  lockAppManually();
                  onLockNow?.();
                }}
              >
                Lock App Now
              </button>
            </div>
          )}
        </div>
      )}

      {step === "setup_pin" && (
        <form onSubmit={handleDraftPinSubmit}>
          <p className="hint" style={{ textAlign: "center", margin: "6px 0 0" }}>
            Create a 4-digit passcode
          </p>
          <div className="amt" style={{ margin: "20px 0 16px" }}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              data-sheet-autofocus
              placeholder="••••"
              value={pinDraft}
              onChange={(e) =>
                setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              style={{ textAlign: "center", letterSpacing: "0.4em" }}
            />
          </div>
          {pinError && (
            <p
              className="security-pin-error-msg"
              style={{ textAlign: "center" }}
            >
              {pinError}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn del"
              onClick={() => setStep("overview")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={pinDraft.length !== 4}
            >
              Continue
            </button>
          </div>
        </form>
      )}

      {step === "confirm_pin" && (
        <form onSubmit={handleConfirmPinSubmit}>
          <p className="hint" style={{ textAlign: "center", margin: "6px 0 0" }}>
            Confirm your 4-digit passcode
          </p>
          <div className="amt" style={{ margin: "20px 0 16px" }}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              data-sheet-autofocus
              placeholder="••••"
              value={pinConfirm}
              onChange={(e) =>
                setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              style={{ textAlign: "center", letterSpacing: "0.4em" }}
            />
          </div>
          {pinError && (
            <p
              className="security-pin-error-msg"
              style={{ textAlign: "center" }}
            >
              {pinError}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn del"
              onClick={() => {
                setStep("setup_pin");
                setPinConfirm("");
              }}
            >
              Back
            </button>
            <button
              type="submit"
              className="btn"
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

/* These screens stay presentational. App supplies shared expense data,
   persistence, account actions, and sync state. */
export default function MobilePrototype({
  S,
  onUnlock,
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
  onRemoveRec,
  onTheme,
  onReminder,
  onSignIn,
  onSignOut,
  onEditProfile,
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
  lastBackupAt,
  onBackupDownload,
  onEncryptedBackupDownload,
  onExpensesCsv,
  onBackupRestore,
  accountStatus,
  authBusy,
  onResumeSync,
}) {
  const [tab, setTab] = useState("home");
  const cards = Array.isArray(S.cards) ? S.cards : [];
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
  const activeAccountRef = useRef("");

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
  const [toastMsg, setToastMsg] = useState(null);
  const [isAppLocked, setIsAppLocked] = useState(() => shouldLockApp());
  const [resetPinConfirmOpen, setResetPinConfirmOpen] = useState(false);

  const handleVerifyPin = useCallback(async (enteredPin) => {
    const lockoutSec = getPinLockoutRemainingSeconds();
    if (lockoutSec > 0) {
      triggerHaptic("warning");
      return {
        ok: false,
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
        message: `Too many attempts. Try again in ${lockoutSec}s.`,
      };
    }
    triggerHaptic("light");
    if (!hasBiometricsConfigured()) {
      triggerHaptic("warning");
      return {
        ok: false,
        message: "Enable Touch ID in Settings first.",
      };
    }
    try {
      const res = await authenticateWithBiometrics();
      if (res === true || res?.ok === true) {
        triggerHaptic("success");
        return true;
      }
      if (res?.reason === "key_missing") {
        triggerHaptic("warning");
        return {
          ok: false,
          message: "Enter PIN once to sync Touch ID.",
        };
      }
    } catch (err) {
      console.warn("Biometric authentication error:", err);
    }
    triggerHaptic("warning");
    return {
      ok: false,
      message: "Touch ID failed. Use your PIN.",
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
    await removeAppPin();
    await disableBiometrics();
    markActive();
    if (typeof onUnlock === "function") {
      await onUnlock();
    }
    setIsAppLocked(false);
  }, [onUnlock]);

  useEffect(() => {
    let lastActivityCall = 0;
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityCall > 1000) {
        lastActivityCall = now;
        markActive();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (shouldLockApp()) {
          setIsAppLocked(true);
        }
      } else if (document.visibilityState === "hidden") {
        markBackgrounded();
      }
    };

    const handlePageHide = () => {
      markBackgrounded();
    };

    const idleCheckInterval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        isSessionUnlocked() &&
        shouldLockApp()
      ) {
        setIsAppLocked(true);
      }
    }, 5000);

    // Native Capacitor app lifecycle support
    let capacitorListenerHandle = null;
    if (window.Capacitor?.Plugins?.App?.addListener) {
      try {
        capacitorListenerHandle = window.Capacitor.Plugins.App.addListener(
          "appStateChange",
          ({ isActive }) => {
            if (isActive) {
              if (shouldLockApp()) {
                setIsAppLocked(true);
              }
            } else {
              markBackgrounded();
            }
          },
        );
      } catch {
        // ignore
      }
    }

    window.addEventListener("pointerdown", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("wheel", handleActivity, { passive: true });
    window.addEventListener("scroll", handleActivity, {
      passive: true,
      capture: true,
    });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      clearInterval(idleCheckInterval);
      capacitorListenerHandle?.then?.((h) => h?.remove?.())?.catch?.(() => {});
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("wheel", handleActivity);
      window.removeEventListener("scroll", handleActivity, { capture: true });
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);
  const [isScrolled, setIsScrolled] = useState(false);
  const [dockMinimized, setDockMinimized] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [slideDirection, setSlideDirection] = useState("forward");
  const [animateScreen, setAnimateScreen] = useState(false);
  const timer = useRef();
  const sheetCloseTimer = useRef();
  const highlightTimer = useRef();
  const mobileRootRef = useRef(null);
  const screenScrollRef = useRef(null);
  const sheetTriggerCandidateRef = useRef(null);
  const sheetReturnFocusRef = useRef(null);
  const activitySearchRef = useRef(null);
  const dockNavRef = useRef(null);
  const dockIndicatorRef = useRef(null);
  const dockTabRefs = useRef({});
  const dockMinimizedRef = useRef(false);
  const lastTopRef = useRef(null);
  const dirAccRef = useRef(0);
  const dockDirectionResetTimerRef = useRef();
  const nestedScrollResumeTimerRef = useRef();
  const dockPointerActiveRef = useRef(false);
  const nestedScrollPointerRef = useRef(false);
  const baseViewportHeightRef = useRef(0);
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

  useLayoutEffect(() => {
    const activeTheme = S.theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = activeTheme;
    const themeColor = activeTheme === "dark" ? "#0e1411" : "#f4f3ee";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", themeColor));
  }, [S.theme]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
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
    }

    const handleMessage = (event) => {
      if (event.data?.type === "NAVIGATE_TAB") {
        const targetTab = event.data.tab;
        if (
          targetTab &&
          ["home", "activity", "accounts", "plans"].includes(targetTab)
        ) {
          setAppSettingsOpen(false);
          setProfileSettingsOpen(false);
          setTab(targetTab);
          triggerHaptic("selection");
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
    };
  }, []);

  const resetDockDirectionTimer = () => {
    clearTimeout(dockDirectionResetTimerRef.current);
    dockDirectionResetTimerRef.current = undefined;
  };

  const resetScreenScroll = () => {
    resetDockDirectionTimer();
    if (screenScrollRef.current) screenScrollRef.current.scrollTop = 0;
    setIsScrolled(false);
    dockMinimizedRef.current = false;
    setDockMinimized(false);
    lastTopRef.current = 0;
    dirAccRef.current = 0;
  };
  const onScreenScroll = (event) => {
    // Ignore scroll events from nested scrollers (for example, the category chips).
    if (event.target !== event.currentTarget) return;
    const scroller = event.currentTarget;
    const maxScrollTop = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );
    const rawScrollTop = scroller.scrollTop;
    // Keep the last dock state during iOS elastic overscroll at either edge.
    if (rawScrollTop < 0 || rawScrollTop > maxScrollTop) return;
    const top = Math.min(maxScrollTop, Math.max(0, rawScrollTop));
    if (!dockPointerActiveRef.current) setIsScrolled(top > 60);

    // A finger on the dock or a nested scroller must not change the dock beneath it.
    if (dockPointerActiveRef.current || nestedScrollPointerRef.current) {
      lastTopRef.current = top;
      dirAccRef.current = 0;
      resetDockDirectionTimer();
      return;
    }

    // Short screens and the top edge always keep the full dock available.
    if (maxScrollTop < 160 || top <= 24) {
      lastTopRef.current = top;
      dirAccRef.current = 0;
      resetDockDirectionTimer();
      dockMinimizedRef.current = false;
      setDockMinimized(false);
      return;
    }

    // The first valid event establishes a baseline instead of guessing direction.
    if (lastTopRef.current === null) {
      lastTopRef.current = top;
      dirAccRef.current = 0;
      return;
    }

    const dy = top - lastTopRef.current;
    lastTopRef.current = top;
    if (dy === 0) return;

    const previousDirection = Math.sign(dirAccRef.current);
    dirAccRef.current =
      previousDirection === Math.sign(dy) ? dirAccRef.current + dy : dy;
    dirAccRef.current = Math.max(-11, Math.min(13, dirAccRef.current));

    if (dirAccRef.current > 12 && !dockMinimizedRef.current) {
      dockMinimizedRef.current = true;
      setDockMinimized(true);
    } else if (dirAccRef.current < -10 && dockMinimizedRef.current) {
      dockMinimizedRef.current = false;
      setDockMinimized(false);
    }

    resetDockDirectionTimer();
    dockDirectionResetTimerRef.current = setTimeout(() => {
      dirAccRef.current = 0;
      dockDirectionResetTimerRef.current = undefined;
    }, 180);
  };

  const onScreenPointerDownCapture = (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest("[data-dock-scroll-lock]")) return;
    clearTimeout(nestedScrollResumeTimerRef.current);
    nestedScrollResumeTimerRef.current = undefined;
    nestedScrollPointerRef.current = true;
    dirAccRef.current = 0;
    resetDockDirectionTimer();
  };

  const onDockPointerDownCapture = () => {
    dockPointerActiveRef.current = true;
    dirAccRef.current = 0;
    resetDockDirectionTimer();
  };

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
      resetDockDirectionTimer();
      clearTimeout(nestedScrollResumeTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    const releasePointer = () => {
      const wasDockPointerActive = dockPointerActiveRef.current;
      dockPointerActiveRef.current = false;
      lastTopRef.current =
        screenScrollRef.current?.scrollTop ?? lastTopRef.current;
      dirAccRef.current = 0;
      resetDockDirectionTimer();

      if (nestedScrollPointerRef.current) {
        clearTimeout(nestedScrollResumeTimerRef.current);
        nestedScrollResumeTimerRef.current = setTimeout(() => {
          nestedScrollPointerRef.current = false;
          nestedScrollResumeTimerRef.current = undefined;
          const scroller = screenScrollRef.current;
          if (!scroller) return;
          const maxScrollTop = Math.max(
            0,
            scroller.scrollHeight - scroller.clientHeight,
          );
          if (maxScrollTop < 160 || scroller.scrollTop <= 24) {
            dockMinimizedRef.current = false;
            setDockMinimized(false);
          }
        }, 180);
      } else if (wasDockPointerActive) {
        // Keep the current size until click fires, so the target never shifts under the finger.
        clearTimeout(nestedScrollResumeTimerRef.current);
        nestedScrollResumeTimerRef.current = undefined;
      }
    };
    const releaseAll = () => {
      dockPointerActiveRef.current = false;
      nestedScrollPointerRef.current = false;
      clearTimeout(nestedScrollResumeTimerRef.current);
      nestedScrollResumeTimerRef.current = undefined;
      dirAccRef.current = 0;
      lastTopRef.current =
        screenScrollRef.current?.scrollTop ?? lastTopRef.current;
      resetDockDirectionTimer();
    };

    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);
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

      if (root) {
        root.style.setProperty("--mobile-visible-height", `${visibleHeight}px`);
        root.style.setProperty("--mobile-visible-top", `${visibleTop}px`);
      }
      setKeyboardOpen(textEntryFocused && keyboardHeight > 120);
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

    syncViewport();
    viewport?.addEventListener("resize", scheduleViewportSync);
    viewport?.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("resize", scheduleViewportSync);
    document.addEventListener("focusin", scheduleViewportSync);
    document.addEventListener("focusout", scheduleViewportSync);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", scheduleViewportSync);
      viewport?.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      document.removeEventListener("focusin", scheduleViewportSync);
      document.removeEventListener("focusout", scheduleViewportSync);
    };
  }, []);
  const close = (exit = null, afterClose = null) => {
    if (!sheet || sheetClosing) return;
    clearTimeout(sheetCloseTimer.current);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (exit?.kind === "drag") {
      const returnFocus = sheetReturnFocusRef.current;
      sheetReturnFocusRef.current = null;
      setSheet(null);
      setSheetClosing(false);
      setSheetExitDuration(SHEET_EXIT_MS);
      setSheetExitFromTransform("translate3d(0, 0, 0)");
      setSheetExitFromOpacity("1");
      sheetCloseTimer.current = null;
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
  const captureSheetTrigger = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button");
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
        : null;
    sheetTriggerCandidateRef.current = null;
    resetDockDirectionTimer();
    dockMinimizedRef.current = false;
    setDockMinimized(false);
    dirAccRef.current = 0;
    lastTopRef.current = screenScrollRef.current?.scrollTop ?? 0;
    setSheetClosing(false);
    setSheetExitDuration(SHEET_EXIT_MS);
    setSheetExitFromTransform("translate3d(0, 0, 0)");
    setSheetExitFromOpacity("1");
    setSheet(nextSheet);
  };
  const nav = (t) => {
    resetDockDirectionTimer();
    const currentTop = screenScrollRef.current?.scrollTop ?? 0;
    dockMinimizedRef.current = false;
    setDockMinimized(false);
    dirAccRef.current = 0;
    lastTopRef.current = currentTop;
    if (t === tab && !appSettingsOpen && !profileSettingsOpen) {
      screenScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
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
    resetScreenScroll();
  };
  const openExpense = (id) => openSheet({ type: "det", id });
  const openTransaction = (id) => openSheet({ type: "txDet", id });
  const openBudget = () => openSheet({ type: "bud" });
  const detail =
    sheet?.type === "det" ? S.exp.find((x) => x.id === sheet.id) : null;
  const txDetail =
    sheet?.type === "txDet" ? S.tx.find((x) => x.id === sheet.id) : null;

  const saveExpense = (f) => {
    const isSavingsTransfer =
      f.cat === "Savings" && Boolean(getSavingsAccountId(cards));
    const isRecurring = f.iv !== "none";
    if (isSavingsTransfer && !String(f.amt ?? "").trim())
      return toast("Enter an amount for this savings transfer.");
    if (isSavingsTransfer && !f.acct)
      return toast("Select an account to transfer from.");
    const saved = onExpenseSave({
      description:
        f.desc.trim() || (isSavingsTransfer ? "Savings transfer" : f.cat),
      amount: f.amt,
      category: f.cat,
      date: f.date,
      account: f.acct,
      interval: f.iv,
    });
    if (!saved) {
      if (!f.amt && (isRecurring || isSavingsTransfer))
        return toast(
          isSavingsTransfer
            ? "Enter an amount for this savings transfer."
            : "Recurring expenses need an amount.",
        );
      return toast("Check the expense details and try again.");
    }
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
      const nextAccount = f.acct ?? "";
      setPreferredAccount(nextAccount);
      try {
        localStorage.setItem(
          STORAGE_KEYS.preferredAccount || "spend-preferred-account-v1",
          nextAccount,
        );
      } catch {}
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
    if (isSavings && !form.acct && Boolean(getSavingsAccountId(cards))) {
      return toast("Select an account to transfer from.");
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
    const saved = onTransactionSave(value);
    if (!saved) return toast("Enter a valid amount.");
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
  const removeRecurring = (id) => {
    const undo = onRemoveRec(id);
    toast("Recurring expense removed", undo);
  };
  const advanced = () => {
    close(null, () => {
      setProfileSettingsOpen(false);
      setAppSettingsOpen(true);
      setAnimateScreen(true);
      resetScreenScroll();
    });
  };
  const openProfileSettings = () => {
    close(null, () => {
      setAppSettingsOpen(false);
      setProfileSettingsOpen(true);
      setAnimateScreen(true);
      resetScreenScroll();
    });
  };
  const backToSettings = () => {
    setProfileSettingsOpen(false);
    setAppSettingsOpen(false);
    openSheet({ type: "set" });
    setAnimateScreen(true);
    resetScreenScroll();
  };
  const signIn = () => onSignIn?.();

  const settingsRoute = appSettingsOpen || profileSettingsOpen;
  useLayoutEffect(() => {
    const navNode = dockNavRef.current;
    const indicatorNode = dockIndicatorRef.current;
    const activeTabNode = dockTabRefs.current[tab];
    if (lastTopRef.current === null && screenScrollRef.current) {
      lastTopRef.current = screenScrollRef.current.scrollTop;
    }
    if (!navNode || !indicatorNode || !activeTabNode) return undefined;

    const updateIndicator = () => {
      indicatorNode.style.width = `${activeTabNode.offsetWidth}px`;
      indicatorNode.style.transform = `translate3d(${activeTabNode.offsetLeft}px, 0, 0)`;
    };
    updateIndicator();
    const readyFrame = window.requestAnimationFrame(() => {
      indicatorNode.classList.add("is-ready");
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateIndicator);
    resizeObserver?.observe(navNode);
    window.addEventListener("resize", updateIndicator);
    window.visualViewport?.addEventListener("resize", updateIndicator);

    return () => {
      window.cancelAnimationFrame(readyFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateIndicator);
      window.visualViewport?.removeEventListener("resize", updateIndicator);
    };
  }, [tab, settingsRoute]);
  const routeTitle = profileSettingsOpen
    ? "Profile"
    : appSettingsOpen
      ? "App settings"
      : tab === "home"
        ? "Spend"
        : tab === "activity"
          ? "Activity"
          : tab === "accounts"
            ? "Cards"
            : "Plans";
  const headerTitle =
    !settingsRoute && tab === "home" && isScrolled ? fM(S.m) : routeTitle;
  const screenKey = profileSettingsOpen
    ? "profile-settings"
    : appSettingsOpen
      ? "app-settings"
      : tab;

  if (isAppLocked) {
    return (
      <div
        ref={mobileRootRef}
        className="mobile-prototype is-locked-screen"
        data-theme={S.theme}
      >
        <SpendLogin
          verifyPin={handleVerifyPin}
          biometric={
            hasBiometricsConfigured()
              ? { type: "fingerprint", label: "Touch ID" }
              : null
          }
          onBiometric={handleBiometricAuth}
          onUnlock={handleUnlock}
          onForgot={handleForgotPin}
        />
        <ConfirmationModal
          isOpen={resetPinConfirmOpen}
          title="Reset App PIN?"
          message="Forgot your passcode? Resetting will remove the PIN lock and any biometric settings so you can access Spend."
          confirmLabel="Reset PIN"
          cancelLabel="Cancel"
          isDestructive={true}
          onConfirm={handleConfirmResetPin}
          onCancel={() => setResetPinConfirmOpen(false)}
        />
      </div>
    );
  }

  return (
    <div
      ref={mobileRootRef}
      className="mobile-prototype"
      onClickCapture={captureSheetTrigger}
      data-theme={S.theme}
      data-sheet-open={sheet ? "true" : undefined}
      data-sheet-closing={sheetClosing ? "true" : undefined}
      style={{
        "--sheet-exit-duration": `${sheetExitDuration}ms`,
        "--sheet-fade-duration": `${Math.round(sheetExitDuration * 0.88)}ms`,
        "--sheet-exit-from-transform": sheetExitFromTransform,
        "--sheet-exit-from-opacity": sheetExitFromOpacity,
      }}
    >
      {/* All notifications delivered via native built-in notifications on iOS and Android */}
      <header
        className={`prototype-header${isScrolled ? " is-scrolled" : ""}${settingsRoute ? " is-settings-route" : ""}`}
      >
        <div className="prototype-header-main">
          {settingsRoute && (
            <button
              className="prototype-header-back"
              type="button"
              aria-label="Back to settings"
              onClick={backToSettings}
            >
              <Icon n="l" />
            </button>
          )}
          <h1 className="prototype-header-title">{headerTitle}</h1>
        </div>
        {!settingsRoute && (
          <div
            className={`prototype-header-actions${animateScreen ? " animate-in" : ""}`}
            key={screenKey}
          >
            {tab === "home" ? (
              <button
                className="prototype-header-avatar"
                type="button"
                aria-label="Profile and settings"
                onClick={() => openSheet({ type: "set" })}
              >
                {profile?.initial || "A"}
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
            ) : (
              <button
                className="prototype-header-action"
                type="button"
                aria-label="Set monthly budget"
                onClick={openBudget}
              >
                <Icon n="calendar" />
              </button>
            )}
          </div>
        )}
      </header>

      <main
        id="app"
        ref={screenScrollRef}
        className={`prototype-screen-scroll${tab === "activity" ? " is-activity" : ""}${tab === "accounts" ? " is-accounts" : ""}`}
        onScroll={onScreenScroll}
        onPointerDownCapture={onScreenPointerDownCapture}
      >
        <div
          key={screenKey}
          className={`prototype-screen-enter${animateScreen ? ` ${slideDirection === "forward" ? "slides-from-right" : "slides-from-left"}` : ""}`}
        >
          <div className="prototype-screen-content">
            {profileSettingsOpen ? (
              <ProfileSettingsPage
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
                onSignIn={signIn}
                onSignOut={onSignOut}
                onResumeSync={onResumeSync}
              />
            ) : appSettingsOpen ? (
              <AppSettingsPage
                S={S}
                profile={profile}
                pushBackendConfigured={pushBackendConfigured}
                notificationPermission={notificationPermission}
                notificationStatus={notificationStatus}
                backgroundPushEnabled={backgroundPushEnabled}
                onSignIn={signIn}
                onReminder={onReminder}
                onToggleNotifications={onToggleNotifications}
                onTestNotification={onTestNotification}
                onBackupDownload={onBackupDownload}
                onEncryptedBackupDownload={onEncryptedBackupDownload}
                onExpensesCsv={onExpensesCsv}
                onBackupRestore={onBackupRestore}
                backupStatus={backupStatus}
              />
            ) : (
              tab === "home" && (
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
                  highlightedExpenseId={highlightedExpenseId}
                />
              )
            )}
            {!appSettingsOpen && !profileSettingsOpen && tab === "activity" && (
              <Activity
                S={S}
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
            )}
            {!appSettingsOpen && !profileSettingsOpen && tab === "accounts" && (
              <Accounts
                S={S}
                onTx={(t, acct) => openSheet({ type: "tx", t, acct })}
                onAddCardClick={() => openSheet({ type: "addCard" })}
                onOpenCardOptions={(cardId) =>
                  openSheet({ type: "cardOptions", cardId })
                }
                onDeleteCard={(cardId) => {
                  const undo = onDeleteCard?.(cardId);
                  toast("Card removed", undo);
                }}
                highlightedExpenseId={highlightedExpenseId}
                highlightedTransactionId={highlightedTransactionId}
                profile={profile}
                onTab={nav}
                onOpenExpense={openExpense}
                onOpenTransaction={openTransaction}
                onLockedCardNotice={(cardName) =>
                  toast(
                    `${cardName || "This card"} is locked. Unlock it in Card Options first.`,
                  )
                }
                onAddExpense={(acct) => openSheet({ type: "add", acct })}
                onActiveAccountChange={(acct) => {
                  activeAccountRef.current = acct;
                }}
              />
            )}
            {!appSettingsOpen && !profileSettingsOpen && tab === "plans" && (
              <Plans
                S={S}
                plan={plan}
                setPlan={setPlan}
                onShift={onShift}
                onBudget={openBudget}
                onAddRec={() => openSheet({ type: "add", iv: "monthly" })}
                onToggleRec={onToggleRec}
                onRemoveRec={removeRecurring}
              />
            )}
          </div>
        </div>
      </main>

      <div
        className="tabs"
        data-scrolled={isScrolled ? "true" : undefined}
        data-minimized={dockMinimized ? "true" : undefined}
        data-keyboard-open={keyboardOpen ? "true" : undefined}
        data-hidden={keyboardOpen || settingsRoute ? "true" : undefined}
        onPointerDownCapture={onDockPointerDownCapture}
        onClickCapture={() =>
          setIsScrolled((screenScrollRef.current?.scrollTop ?? 0) > 60)
        }
      >
        <nav ref={dockNavRef} aria-label="Main navigation">
          <span
            ref={dockIndicatorRef}
            className={`dock-active-indicator${settingsRoute ? " is-hidden" : ""}`}
            aria-hidden="true"
          />
          {TABS.map(([t, l]) =>
            t === "add" ? (
              <button
                key={t}
                className="fab"
                aria-label="Add expense"
                onClick={() => {
                  triggerHaptic("light");
                  const activeAcct =
                    tab === "accounts" && activeAccountRef.current !== undefined
                      ? activeAccountRef.current
                      : undefined;
                  openSheet({
                    type: "add",
                    ...(activeAcct !== undefined ? { acct: activeAcct } : {}),
                  });
                }}
              >
                <Icon n="plus" />
              </button>
            ) : (
              <button
                key={t}
                className={
                  "t " +
                  (!appSettingsOpen && !profileSettingsOpen && tab === t
                    ? "on"
                    : "")
                }
                ref={(node) => {
                  if (node) dockTabRefs.current[t] = node;
                  else delete dockTabRefs.current[t];
                }}
                aria-label={l}
                aria-current={
                  !appSettingsOpen && !profileSettingsOpen && tab === t
                    ? "page"
                    : undefined
                }
                onClick={() => nav(t)}
              >
                <span className="tab-icon">
                  <Icon n={t} />
                </span>
                <span className="tab-label">{l}</span>
              </button>
            ),
          )}
        </nav>
      </div>

      {sheet?.type === "cardOptions" && (
        <CardOptionsSheet
          initialCardId={sheet.cardId}
          cards={cards}
          balances={Object.fromEntries(cards.map((c) => [c.id, bal(S, c.id)]))}
          startBalances={S?.start || {}}
          onClose={close}
          onUpdateCard={(updated) => {
            onUpdateCard?.(updated);
            toast("Card updated");
          }}
          onDeleteCard={(cardId) => {
            const undo = onDeleteCard?.(cardId);
            toast("Card removed", undo);
          }}
          onAddCardClick={() => openSheet({ type: "addCard" })}
          onAdjustBalance={(cardId) =>
            openSheet({ type: "tx", t: "adjust", acct: cardId })
          }
          onSetPrimaryCard={(cardId) => {
            const res = onSetPrimaryCard?.(cardId);
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
            onMoveCardToFront?.(cardId);
            toast("Card moved to top");
          }}
        />
      )}
      {sheet?.type === "addCard" && (
        <AddCardSheet
          onClose={close}
          onAddCard={(newCard) => onAddCard?.(newCard)}
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
          onAccountChange={handlePreferredAccountChange}
          onSave={saveExpense}
          onClose={close}
        />
      )}
      {sheet?.type === "tx" && (
        <TxSheet
          type={sheet.t}
          defaultAccount={sheet.acct}
          cards={cards}
          onSave={saveTransaction}
          onClose={close}
        />
      )}
      {txDetail && (
        <AccountTxDetailSheet
          key={txDetail.id}
          tx={txDetail}
          cards={cards}
          onSave={updateTransaction}
          onDelete={deleteTransaction}
          onClose={close}
        />
      )}
      {detail && (
        <DetailSheet
          key={detail.id}
          e={detail}
          suggestion={suggestedCategory(detail.desc, S.exp, detail.id)}
          cards={cards}
          onSave={updateExpense}
          onDelete={deleteExpense}
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
      {sheet?.type === "set" && (
        <SettingsSheet
          S={S}
          profile={profile}
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
            ? `Are you sure you want to delete "${confirmDeleteExpense.desc || "this expense"}" (${M(confirmDeleteExpense.amt || 0)})?`
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
    </div>
  );
}
