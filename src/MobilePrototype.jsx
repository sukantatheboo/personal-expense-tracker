import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { FaPenToSquare, FaPiggyBank } from "react-icons/fa6";
import { ACCOUNT_OPTIONS, DEFAULT_CARDS } from "./data.js";
import {
  StackedCardDeck,
  WalletCard,
  renderProviderLogo,
  formatCardNumber,
  formatExpiry,
} from "./AccountsCardDeck.jsx";
import { CARD_PROVIDERS } from "./cardAssets.jsx";
import "./MobilePrototype.css";

/* ───────────── constants ───────────── */
const CAT = {
  Food: ["🍜", "#e8873a"],
  Transport: ["🚌", "#3b82c4"],
  Bills: ["⚡", "#d6a31f"],
  Home: ["🏠", "#8a6fd1"],
  Shopping: ["🛍️", "#d9528a"],
  Health: ["💊", "#e0594f"],
  Entertainment: ["🎧", "#20a4a4"],
  Education: ["📚", "#5b73d9"],
  Savings: ["", "#b6404b"],
  Other: ["", "#7d8a82"],
};
const ACC = {
  bkash: ["bKash", "#e2136e"],
  bank: ["Bank", "#2563a8"],
  savings: ["Savings", "#b6404b"],
};

function getAccountDisplay(id, cards = []) {
  const match = cards.find((c) => c.id === id);
  if (match) return [match.name, match.color || "#2563a8"];
  if (ACC[id]) return ACC[id];
  return [id || "Account", "#2563a8"];
}
const TABS = [
  ["home", "Home"],
  ["activity", "Activity"],
  ["add"],
  ["accounts", "Accounts"],
  ["plans", "Plans"],
];
const SHEET_EXIT_MS = 360;
const SHEET_REDUCED_EXIT_MS = 180;

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

function SavingsMark({ className }) {
  return (
    <span className={`savings-mark ${className}`} aria-hidden="true">
      <FaPiggyBank focusable="false" />
      <span className="savings-mark-coin">৳</span>
    </span>
  );
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
  return false;
}

function CategorySymbol({ category }) {
  if (category === "Other") {
    return (
      <svg
        className="category-symbol category-symbol-other"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="4" cy="12" r="2.1" />
        <circle cx="12" cy="12" r="2.1" />
        <circle cx="20" cy="12" r="2.1" />
      </svg>
    );
  }
  if (category === "Savings") {
    return <SavingsMark className="category-symbol category-symbol-savings" />;
  }
  return (
    <span className="category-symbol" aria-hidden="true">
      {CAT[category]?.[0] || ""}
    </span>
  );
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
  const [y, mo] = m.split("-").map(Number);
  return ld(new Date(y, mo - 1 + o, 1)).slice(0, 7);
};
const fM = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
};
const fD = (d) => {
  const [y, m, x] = d.split("-").map(Number);
  return new Date(y, m - 1, x).toLocaleDateString("en-GB", {
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
  S.exp
    .filter((e) => e.date.startsWith(m) && e.amt != null)
    .reduce((a, e) => a + e.amt, 0);
const monthExp = (S) =>
  S.exp
    .filter((e) => e.date.startsWith(S.m))
    .sort((a, b) => b.date.localeCompare(a.date));
function bal(S, id) {
  let b = S.start[id];
  for (const e of S.exp) {
    if (e.amt == null || e.date < S.start.date || e.date > ld()) continue;
    if (e.cat === "Savings") {
      if (id === "savings" && e.acct !== "savings" && ACC[e.acct]) b += e.amt;
      else if (e.acct === id && id !== "savings") b -= e.amt;
    } else if (e.acct === id) b -= e.amt;
  }
  for (const t of S.tx) {
    if (t.date < S.start.date || t.date > ld()) continue;
    if (t.type === "income" && t.acct === id) b += t.amt;
    if (t.type === "adjust" && t.acct === id)
      b += t.dir === "up" ? t.amt : -t.amt;
    if (t.type === "transfer") {
      if (t.acct === id) b -= t.amt;
      if (t.to === id) b += t.amt;
    }
  }
  return b;
}

/* ───────────── small shared pieces ───────────── */
const Seg = ({ value, options, onPick }) => (
  <div className="seg">
    {options.map(([x, l]) => (
      <button
        key={l}
        className={value === x ? "on" : ""}
        onClick={() => onPick(x)}
      >
        {l}
      </button>
    ))}
  </div>
);

const MonthSwitch = ({ m, onShift }) => (
  <div className="mon">
    <button
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
      aria-label="Next month"
      disabled={m >= ld().slice(0, 7)}
      onClick={() => {
        triggerHaptic("selection");
        onShift(1);
      }}
    >
      <Icon n="r" />
    </button>
  </div>
);

function suggestedCategory(description, expenses = []) {
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
    if (expense.cat === "Savings") continue;
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
  onOpen,
  onDelete,
  onSkip,
  onDuplicate,
  suggestion = "",
  isNew = false,
}) {
  const [, c] = CAT[e.cat];
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
  const wasPastThresholdRef = useRef(false);
  const [swipe, setSwipe] = useState({ offset: 0, phase: "idle" });
  const [duplicatePress, setDuplicatePress] = useState(false);
  const swipeRef = useRef(swipe);

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

  const beginDelete = (commit = onDelete, direction = "left") => {
    if (
      !commit ||
      swipeRef.current.phase === "deleting" ||
      swipeRef.current.phase === "collapsing"
    )
      return;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    triggerHaptic("delete");
    clearTimeout(swipeTimerRef.current);
    clearTimeout(collapseTimerRef.current);
    const width =
      pointerRef.current?.width || rowRef.current?.offsetWidth || 320;
    const targetOffset = direction === "right" ? width + 24 : -(width + 24);

    rowRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.classList.remove("is-swipe-dragging");
    if (rowRef.current) {
      rowRef.current.style.transform = `translate3d(${targetOffset}px, 0, 0)`;
    }
    updateSwipe({ offset: targetOffset, phase: "deleting" });

    collapseTimerRef.current = setTimeout(() => {
      updateSwipe({ offset: targetOffset, phase: "collapsing" });
    }, 220);
    swipeTimerRef.current = setTimeout(() => commit(e.id), 460);
  };

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
          rowRef.current.style.transform = "translate3d(0, 0, 0)";
        }
      }
    };
    window.addEventListener("pointerdown", handleOutside, true);
    return () => window.removeEventListener("pointerdown", handleOutside, true);
  }, [swipe.phase]);

  const startGesture = (event) => {
    if (!onDelete && !onDuplicate) return;
    if (event.button != null && event.button !== 0) return;
    if (["deleting", "collapsing"].includes(swipeRef.current.phase)) return;
    clearHoldTimer();
    clearTimeout(swipeTimerRef.current);
    clearTimeout(collapseTimerRef.current);
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
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

    if (event.pointerType === "touch" && onDuplicate) {
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

    if (!gesture.horizontal && onDelete) {
      // Support swiping left (dx < -6) or right (dx > 6)
      const isHorizontalIntent =
        (absDx > 6 && absDx > absDy * 1.05) ||
        (gesture.initialOffset !== 0 && absDx > 5);

      if (isHorizontalIntent) {
        gesture.horizontal = true;
        suppressNextClick();
        rowRef.current?.classList.add("is-swipe-dragging");
        shellRef.current?.classList.add("is-swipe-dragging");
        try {
          event.currentTarget.setPointerCapture(gesture.pointerId);
        } catch {
          // Pointer capture is an enhancement
        }
        if (!gesture.draggingStateApplied) {
          gesture.draggingStateApplied = true;
          swipeRef.current = { offset: gesture.initialOffset, phase: "dragging" };
          setSwipe((prev) => ({ ...prev, phase: "dragging" }));
        }
      }
    }

    if (gesture.horizontal) {
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;

      let targetOffset = gesture.initialOffset + dx;

      // Soft rubber-band resistance when dragging beyond width bounds
      const maxDrag = gesture.width * 0.8;
      if (targetOffset > maxDrag) {
        targetOffset = maxDrag + (targetOffset - maxDrag) * 0.2;
      } else if (targetOffset < -maxDrag) {
        targetOffset = -maxDrag + (targetOffset - -maxDrag) * 0.2;
      }

      // Check deletion threshold for haptic cue
      const deleteThreshold = Math.max(110, gesture.width * 0.38);
      const isPastThreshold = Math.abs(targetOffset) >= deleteThreshold;
      if (isPastThreshold && !gesture.passedHaptic) {
        gesture.passedHaptic = true;
        triggerHaptic("selection");
      } else if (!isPastThreshold && gesture.passedHaptic) {
        gesture.passedHaptic = false;
      }

      swipeRef.current.offset = targetOffset;
      pendingOffsetRef.current = targetOffset;

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          dragFrameRef.current = null;
          const offset = pendingOffsetRef.current;
          if (rowRef.current) {
            rowRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
          }
          const past = Math.abs(offset) >= deleteThreshold;
          if (past !== wasPastThresholdRef.current) {
            wasPastThresholdRef.current = past;
            if (past) {
              shellRef.current?.setAttribute("data-threshold", "true");
            } else {
              shellRef.current?.removeAttribute("data-threshold");
            }
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
    } catch {
      // ignore
    }

    rowRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.classList.remove("is-swipe-dragging");
    shellRef.current?.removeAttribute("data-threshold");
    wasPastThresholdRef.current = false;

    if (event?.type === "pointercancel") {
      const resetOffset = Math.abs(gesture.initialOffset) === 76 ? gesture.initialOffset : 0;
      updateSwipe({ offset: resetOffset, phase: resetOffset === 0 ? "idle" : "revealed" });
      if (rowRef.current) {
        rowRef.current.style.transform = `translate3d(${resetOffset}px, 0, 0)`;
      }
      return;
    }

    if (gesture.horizontal && onDelete) {
      const dx = (event?.clientX ?? gesture.lastX) - gesture.startX;
      const currentOffset = swipeRef.current.offset;
      const elapsed = Math.max(1, performance.now() - gesture.startedAt);
      const velocity = dx / elapsed;
      const deleteThreshold = Math.max(110, gesture.width * 0.38);
      const revealThreshold = 48;

      suppressNextClick();

      const shouldDeleteRight =
        currentOffset >= deleteThreshold || (dx > 45 && velocity > 0.55);
      const shouldDeleteLeft =
        currentOffset <= -deleteThreshold || (dx < -45 && velocity < -0.55);

      if (shouldDeleteRight) {
        beginDelete(e.rec && onSkip ? onSkip : onDelete, "right");
      } else if (shouldDeleteLeft) {
        beginDelete(e.rec && onSkip ? onSkip : onDelete, "left");
      } else if (currentOffset >= revealThreshold) {
        updateSwipe({ offset: 76, phase: "revealed" });
        if (rowRef.current) {
          rowRef.current.style.transform = "translate3d(76px, 0, 0)";
        }
      } else if (currentOffset <= -revealThreshold) {
        updateSwipe({ offset: -76, phase: "revealed" });
        if (rowRef.current) {
          rowRef.current.style.transform = "translate3d(-76px, 0, 0)";
        }
      } else {
        updateSwipe({ offset: 0, phase: "idle" });
        if (rowRef.current) {
          rowRef.current.style.transform = "translate3d(0, 0, 0)";
        }
      }
    }
  };

  const isPositive =
    e.type === "income" || e.type === "refund" || Boolean(e.refund);
  const amountClass = isPositive
    ? "am is-positive"
    : e.cat === "Savings"
      ? "am is-neutral"
      : "am";
  const amountPrefix = isPositive ? "+" : "";
  const gestureHint =
    onDelete && onDuplicate
      ? e.rec
        ? "Tap to edit, swipe left or right to skip this occurrence, or press and hold to duplicate."
        : "Tap to edit, swipe left or right to delete, or press and hold to duplicate."
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
      style={onDelete && swipe.offset !== 0 ? { transform: `translate3d(${swipe.offset}px, 0, 0)` } : undefined}
      aria-label={`${e.desc}, ${M(e.amt || 0)}${e.cat === "Savings" ? ", savings transfer" : ""}. ${gestureHint}`}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          clearTimeout(suppressClickTimerRef.current);
          return;
        }
        if (swipeRef.current.phase === "revealed") {
          updateSwipe({ offset: 0, phase: "idle" });
          if (rowRef.current) {
            rowRef.current.style.transform = "translate3d(0, 0, 0)";
          }
          return;
        }
        onOpen(e.id);
      }}
    >
      <i className="ic" style={{ "--c": c }}>
        <CategorySymbol category={e.cat} />
      </i>
      <span className="nm">
        <b>{e.desc}</b>
        <small>
          {e.cat}
          {e.acct ? " · " + ACC[e.acct][0] : ""}
          {e.rec ? " · Recurring" : ""}
          {suggestion && suggestion !== e.cat ? (
            <span className="category-suggestion-inline">
              <span> · Suggested:</span>
              <CategorySuggestionValue category={suggestion} />
            </span>
          ) : null}
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

  if (!onDelete) return row;

  const isSwipeRight = swipe.offset > 0;
  const isSwipeLeft = swipe.offset < 0;

  return (
    <div
      ref={shellRef}
      className={`expense-swipe-shell${swipe.phase === "dragging" ? " is-dragging" : ""}${swipe.phase === "revealed" ? " is-revealed" : ""}${["deleting", "collapsing"].includes(swipe.phase) ? " is-deleting" : ""}${swipe.phase === "collapsing" ? " is-collapsing" : ""}${isSwipeRight ? " is-swipe-right" : isSwipeLeft ? " is-swipe-left" : ""}${e.rec ? " is-skip-shell" : ""}`}
    >
      {/* Revealed when swiping left-to-right (button on the left) */}
      <button
        className={`expense-swipe-delete is-left${e.rec ? " is-skip" : ""}`}
        type="button"
        aria-label={
          e.rec ? `Skip ${e.desc} for this occurrence` : `Delete ${e.desc}`
        }
        aria-hidden={swipe.phase !== "revealed" || swipe.offset <= 0}
        disabled={swipe.phase !== "revealed" || swipe.offset <= 0}
        tabIndex={swipe.phase === "revealed" && swipe.offset > 0 ? 0 : -1}
        onClick={() => beginDelete(e.rec && onSkip ? onSkip : onDelete, "right")}
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

      {/* Revealed when swiping right-to-left (button on the right) */}
      <button
        className={`expense-swipe-delete is-right${e.rec ? " is-skip" : ""}`}
        type="button"
        aria-label={
          e.rec ? `Skip ${e.desc} for this occurrence` : `Delete ${e.desc}`
        }
        aria-hidden={swipe.phase !== "revealed" || swipe.offset >= 0}
        disabled={swipe.phase !== "revealed" || swipe.offset >= 0}
        tabIndex={swipe.phase === "revealed" && swipe.offset < 0 ? 0 : -1}
        onClick={() => beginDelete(e.rec && onSkip ? onSkip : onDelete, "left")}
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
    const initialFocus = sheetNode.querySelector("[data-sheet-autofocus]");
    if (initialFocus instanceof HTMLElement) {
      if (document.activeElement !== initialFocus)
        initialFocus.focus({ preventScroll: true });
    } else {
      sheetNode.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const sheetNode = sheetRef.current;
    const initialFocus = sheetNode?.querySelector("[data-sheet-autofocus]");
    const scrollNode =
      scrollRef.current || sheetNode?.querySelector(".sheet-content");
    if (!scrollNode || !initialFocus) return undefined;

    const resetInitialFocusScroll = () => {
      if (document.activeElement === initialFocus) scrollNode.scrollTop = 0;
    };
    const viewport = window.visualViewport;
    const frame = window.requestAnimationFrame(resetInitialFocusScroll);
    viewport?.addEventListener("resize", resetInitialFocusScroll);
    const releaseViewportListener = window.setTimeout(() => {
      viewport?.removeEventListener("resize", resetInitialFocusScroll);
    }, 650);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(releaseViewportListener);
      viewport?.removeEventListener("resize", resetInitialFocusScroll);
    };
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

  const applyDragFrame = () => {
    rAFRef.current = null;
    const drag = dragRef.current;
    if (!drag || !drag.active) return;

    let offset = pendingDyRef.current;
    if (offset < 0) {
      // Elastic rubber-band resistance when pulling up
      offset = offset * 0.2;
    }
    drag.currentOffset = offset;

    // DIRECT DOM TRANSFORM: Sheet dynamically follows your finger 1:1 in real time
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
    }

    // Dynamic backdrop opacity fading on GPU compositor layer
    if (overlayRef.current) {
      const progress = Math.max(
        0,
        Math.min(1, 1 - offset / (drag.sheetHeight * 0.85)),
      );
      overlayRef.current.style.opacity = progress.toFixed(3);
    }
  };

  const updateDragPosition = (rawDy) => {
    pendingDyRef.current = rawDy;
    if (!rAFRef.current) {
      rAFRef.current = requestAnimationFrame(applyDragFrame);
    }
  };

  const onDragStart = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const target = event.target;
    // Don't drag if tapping interactive elements
    if (
      target.closest(
        'input, textarea, select, button, a, [role="button"], [role="switch"]',
      )
    ) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    if (rAFRef.current) {
      cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;
    }

    const sheetHeight = sheetRef.current?.offsetHeight || 440;

    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startY: event.clientY,
      currentOffset: 0,
      recentPoints: [{ y: event.clientY, t: performance.now() }],
      sheetHeight,
      active: true,
    };

    if (sheetRef.current) {
      sheetRef.current.setAttribute("data-dragging", "true");
      sheetRef.current.style.animation = "none";
      sheetRef.current.style.transition = "none";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = "none";
    }
  };

  const onDragMove = (event) => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;
    if (event.pointerId !== drag.pointerId) return;

    const now = performance.now();
    drag.recentPoints.push({ y: event.clientY, t: now });
    if (drag.recentPoints.length > 5) {
      drag.recentPoints.shift();
    }

    const dy = event.clientY - drag.startY;
    updateDragPosition(dy);
  };

  const onDragEnd = () => {
    if (rAFRef.current) {
      cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.active) return;

    try {
      if (drag.target?.hasPointerCapture?.(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // ignore
    }

    let velocity = 0;
    if (drag.recentPoints.length >= 2) {
      const oldest = drag.recentPoints[0];
      const newest = drag.recentPoints[drag.recentPoints.length - 1];
      const dt = Math.max(1, newest.t - oldest.t);
      velocity = (newest.y - oldest.y) / dt;
    }

    const distance = drag.currentOffset;
    const sheetHeight = drag.sheetHeight;

    // Real-app dismissal conditions:
    // User must deliberately pull down past 95px (or 22% of sheet height),
    // or flick down with positive distance and downward velocity!
    const shouldClose =
      distance >= 95 ||
      distance >= sheetHeight * 0.22 ||
      (distance >= 45 && velocity > 0.45);

    if (shouldClose) {
      // Smooth animated dismissal gliding off the screen
      if (sheetRef.current) {
        sheetRef.current.removeAttribute("data-dragging");
        sheetRef.current.style.transition =
          "transform 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetRef.current.style.transform = "translate3d(0, 105%, 0)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = "opacity 240ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        overlayRef.current.style.opacity = "0";
      }

      window.setTimeout(() => {
        onClose({ kind: "drag", distance, velocity });
      }, 250);
    } else {
      // Spring back up to top (0px)
      if (sheetRef.current) {
        sheetRef.current.removeAttribute("data-dragging");
        sheetRef.current.style.transition =
          "transform 280ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        sheetRef.current.style.transform = "translate3d(0, 0, 0)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = "opacity 260ms cubic-bezier(0.2, 0.9, 0.28, 1)";
        overlayRef.current.style.opacity = "1";
      }

      window.setTimeout(() => {
        if (sheetRef.current && !dragRef.current?.active) {
          sheetRef.current.style.transition = "";
          sheetRef.current.style.transform = "";
        }
        if (overlayRef.current && !dragRef.current?.active) {
          overlayRef.current.style.transition = "";
          overlayRef.current.style.opacity = "";
        }
      }, 290);
    }
  };

  // Wire header title drag
  useEffect(() => {
    const sheetNode = sheetRef.current;
    if (!sheetNode) return undefined;
    const titleNode = sheetNode.querySelector("#sheet-title");
    if (!titleNode) return undefined;

    titleNode.style.touchAction = "none";
    titleNode.style.cursor = "grab";

    titleNode.addEventListener("pointerdown", onDragStart);
    titleNode.addEventListener("pointermove", onDragMove);
    titleNode.addEventListener("pointerup", onDragEnd);
    titleNode.addEventListener("pointercancel", onDragEnd);

    return () => {
      titleNode.removeEventListener("pointerdown", onDragStart);
      titleNode.removeEventListener("pointermove", onDragMove);
      titleNode.removeEventListener("pointerup", onDragEnd);
      titleNode.removeEventListener("pointercancel", onDragEnd);
    };
  }, []);

  // Support pull-down from top of scrollable content when at scrollTop <= 0
  useEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return undefined;

    let touchStartY = 0;
    let isPulling = false;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const target = e.target;
      if (
        target.closest(
          'input, textarea, select, button, a, [role="button"], [role="switch"]',
        )
      ) {
        return;
      }
      touchStartY = e.touches[0].clientY;
      isPulling = false;
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const clientY = e.touches[0].clientY;
      const dy = clientY - touchStartY;

      if (scrollNode.scrollTop <= 1 && dy > 0) {
        if (!isPulling && dy > 6) {
          isPulling = true;
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          if (rAFRef.current) {
            cancelAnimationFrame(rAFRef.current);
            rAFRef.current = null;
          }
          const sheetHeight = sheetRef.current?.offsetHeight || 440;
          dragRef.current = {
            pointerId: -1,
            target: null,
            startY: touchStartY,
            currentOffset: 0,
            recentPoints: [{ y: clientY, t: performance.now() }],
            sheetHeight,
            active: true,
          };
          if (sheetRef.current) {
            sheetRef.current.setAttribute("data-dragging", "true");
            sheetRef.current.style.animation = "none";
            sheetRef.current.style.transition = "none";
          }
          if (overlayRef.current) {
            overlayRef.current.style.transition = "none";
          }
        }
        if (isPulling) {
          e.preventDefault();
          const now = performance.now();
          if (dragRef.current) {
            dragRef.current.recentPoints.push({ y: clientY, t: now });
            if (dragRef.current.recentPoints.length > 5) {
              dragRef.current.recentPoints.shift();
            }
          }
          updateDragPosition(dy);
        }
      } else {
        isPulling = false;
      }
    };

    const onTouchEnd = () => {
      if (isPulling) {
        isPulling = false;
        onDragEnd();
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
  }, []);

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
      >
        <div
          className="sheet-drag-zone"
          aria-hidden="true"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="grab" />
        </div>
        <div ref={scrollRef} className="sheet-content">
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
  const total = tot(S, S.m);
  const saved = monthExp(S)
    .filter((expense) => expense.cat === "Savings" && expense.amt != null)
    .reduce((sum, expense) => sum + expense.amt, 0);
  const t = total - saved;
  const previousMonth = shift(S.m, -1);
  const previousSaved = monthExp({ ...S, m: previousMonth })
    .filter((expense) => expense.cat === "Savings" && expense.amt != null)
    .reduce((sum, expense) => sum + expense.amt, 0);
  const p = tot(S, previousMonth) - previousSaved;
  const b = S.bud[S.m] || 0;
  const d = t - p;
  const overBudget = b > 0 && t > b;
  const overflowShare = overBudget ? ((t - b) / t) * 100 : 0;
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
  const nx = S.rec
    .filter((r) => r.on)
    .sort((x, y) => x.next.localeCompare(y.next))[0];
  const h = currentTime.getHours();
  useEffect(() => setHighlightedCategory(""), [S.m]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const timeGreeting =
    h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : h < 21
          ? "Good evening"
          : "Good night";
  const greetingName = greetingFirstName(profile);

  return (
    <>
      <div className="hd">
        <div>
          <small>
            {timeGreeting}, {greetingName}
          </small>
          <h1>{fM(S.m)}</h1>
        </div>
        <div className="mn">
          <button aria-label="Previous month" onClick={() => onShift(-1)}>
            <Icon n="l" />
          </button>
          <button
            aria-label="Next month"
            disabled={S.m >= ld().slice(0, 7)}
            onClick={() => onShift(1)}
          >
            <Icon n="r" />
          </button>
        </div>
      </div>

      <section className={`hero${overBudget ? " is-over-budget" : ""}`}>
        <div className="row">
          <span>Spent this month</span>
          {p ? (
            <span className="chip">
              {d > 0 ? "▲" : "▼"} {M(Math.abs(d))} vs last
            </span>
          ) : null}
        </div>
        <div className="big">{M(t)}</div>
        {saved > 0 && (
          <div className="hero-saved">
            <span>Saved</span>
            <b>{M(saved)}</b>
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
                {overBudget ? `${M(t - b)} over budget` : `${M(b - t)} left`}
              </span>
              <span>of {M(b)}</span>
            </div>
          </>
        ) : (
          <button className="ghost" onClick={onBudget}>
            Set a monthly budget
          </button>
        )}
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

      {cs.length > 0 && (
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
                  width: (v / total) * 100 + "%",
                  background: CAT[c][1],
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
              <span className="dot" style={{ "--c": CAT[c][1] }} />
              <span>{c}</span>
              <b>{M(v)}</b>
              <em>{Math.round((v / total) * 100)}%</em>
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
                onOpen={onOpen}
                isNew={highlightedExpenseId === e.id}
              />
            ))
        ) : (
          <div className="emp">
            No expenses yet.
            <br />
            Tap + to add your first.
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
  searchRef,
  highlightedExpenseId,
}) {
  const l = monthExp(S).filter(
    (e) =>
      (!cf || e.cat === cf) &&
      (!q || e.desc.toLowerCase().includes(q.toLowerCase())),
  );
  const g = {};
  l.forEach((e) => (g[e.date] = g[e.date] || []).push(e));

  return (
    <>
      <label className="srch">
        <Icon n="s" />
        <input
          ref={searchRef}
          placeholder="Search expenses"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="chips" data-dock-scroll-lock>
        <button className={cf ? "" : "on"} onClick={() => setCf("")}>
          All
        </button>
        {Object.keys(CAT).map((c) => (
          <button
            key={c}
            className={cf === c ? "on" : ""}
            onClick={() => setCf(c)}
          >
            <CategorySymbol category={c} /> {c}
          </button>
        ))}
      </div>
      {cf && (
        <div className="activity-filter-summary" role="status">
          <b>{cf}</b>
          <span>·</span>
          <strong>
            {M(l.reduce((sum, expense) => sum + (expense.amt || 0), 0))}
          </strong>
          <span>·</span>
          <span>
            {l.length} {l.length === 1 ? "item" : "items"}
          </span>
        </div>
      )}
      <div>
        {!l.length ? (
          <div className="emp">Nothing matches.</div>
        ) : (
          Object.keys(g)
            .sort()
            .reverse()
            .map((d) => (
              <Fragment key={d}>
                <div className="day">
                  <span>
                    {d === ld() ? "Today" : d === ago(1) ? "Yesterday" : fD(d)}
                  </span>
                  {g[d].length >= 2 && (
                    <span>{M(g[d].reduce((a, e) => a + (e.amt || 0), 0))}</span>
                  )}
                </div>
                <div className="card expense-day-card">
                  {g[d].map((e) => (
                    <ExpenseRow
                      key={e.id}
                      e={e}
                      onOpen={onOpen}
                      onDelete={onDelete}
                      onSkip={onSkip}
                      onDuplicate={onDuplicate}
                      suggestion={suggestedCategory(
                        e.desc,
                        S.exp.filter((pastExpense) => pastExpense.id !== e.id),
                      )}
                      isNew={highlightedExpenseId === e.id}
                    />
                  ))}
                </div>
              </Fragment>
            ))
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
  onDeleteCard,
  highlightedExpenseId,
  highlightedTransactionId,
  profile,
  onTab,
  onOpenExpense,
}) {
  const cards = S.cards && S.cards.length > 0 ? S.cards : DEFAULT_CARDS;
  const balances = Object.fromEntries(cards.map((c) => [c.id, bal(S, c.id)]));
  const [selectedAccount, setSelectedAccount] = useState(() => cards[0]?.id || "amazon");
  const [infoCard, setInfoCard] = useState(null);
  const [copiedCard, setCopiedCard] = useState(false);
  const [showCardSecrets, setShowCardSecrets] = useState(false);
  const [frozenCards, setFrozenCards] = useState({});

  const activeCard = cards.find((c) => c.id === selectedAccount) || cards[0];

  const chooseAccount = (accountId) => {
    triggerHaptic("selection");
    setSelectedAccount(accountId);
  };

  const getAccountName = (id) =>
    cards.find((c) => c.id === id)?.name || ACC[id]?.[0] || id || "Account";

  const events = [
    ...S.exp
      .filter(
        (expense) =>
          expense.acct &&
          expense.amt != null &&
          expense.date >= S.start.date &&
          expense.date <= ld(),
      )
      .map((expense) => {
        const isSavingsTransfer = expense.cat === "Savings";
        return {
          id: expense.id,
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
          to: isSavingsTransfer ? "savings" : "",
        };
      }),
    ...S.tx
      .filter(
        (transaction) =>
          transaction.date >= S.start.date && transaction.date <= ld(),
      )
      .map((transaction) => ({
        id: transaction.id,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        d: transaction.date,
        title:
          capitalizeFirstLetter(transaction.note) ||
          { income: "Income", transfer: "Transfer", adjust: "Adjustment" }[
            transaction.type
          ],
        type: transaction.type,
        cat: transaction.type === "income" ? "Savings" : transaction.type === "transfer" ? "Transport" : "Bills",
        amount: transaction.amt,
        account: transaction.acct,
        from: transaction.acct,
        to: transaction.to,
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
    else if (event.type === "adjust") {
      changes[event.account] =
        event.direction === "up" ? event.amount : -event.amount;
    } else if (event.type === "transfer") {
      changes[event.from] = (changes[event.from] || 0) - event.amount;
      changes[event.to] = (changes[event.to] || 0) + event.amount;
    }

    if (event.type === "adjust") {
      const before = runningBalances[event.account] || 0;
      adjustmentBalances.set(event.id, {
        before,
        after: before + changes[event.account],
      });
    }
    for (const [accountId, change] of Object.entries(changes))
      runningBalances[accountId] = (runningBalances[accountId] || 0) + change;
  }

  const visibleEvents = events
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
    )
    .slice(0, 8);

  const displayDate = (date) =>
    date === ld() ? "Today" : date === ago(1) ? "Yesterday" : fD(date);
  const displayAmount = (event) => {
    if (event.type === "expense") return { value: -event.amount, signed: true };
    if (event.type === "income") return { value: event.amount, signed: true };
    if (event.type === "adjust")
      return {
        value: event.direction === "up" ? event.amount : -event.amount,
        signed: true,
      };
    if (selectedAccount) {
      const value =
        event.from === selectedAccount ? -event.amount : event.amount;
      return { value, signed: true };
    }
    return { value: event.amount, signed: false };
  };

  const handleCopyCard = (num) => {
    triggerHaptic("success");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(num.replace(/\s+/g, "")).catch(() => {});
    }
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
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
        onOpenCardDetails={(card) => setInfoCard(card)}
      />

      {/* 2×2 Quick Action Buttons Grid (Card Info, Card Options, Withdraw, Converter - Matching Video) */}
      <div className="accounts-actions-grid">
        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("selection");
            setInfoCard(activeCard);
          }}
          aria-label="View card options and details"
        >
          <div className="action-icon-badge is-card-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="3" />
              <line x1="2" y1="10" x2="22" y2="10" />
              <circle cx="7" cy="15" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="action-label">Card Info</span>
        </button>

        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("light");
            onTx("adjust", selectedAccount);
          }}
          aria-label="Adjust balance and card options"
        >
          <div className="action-icon-badge is-card-options">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </div>
          <span className="action-label">Card Options</span>
        </button>

        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("light");
            onTx("transfer", selectedAccount);
          }}
          aria-label="Withdraw or transfer between accounts"
        >
          <div className="action-icon-badge is-withdraw">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
              <polyline points="12 15 17 20 22 15" />
              <line x1="17" y1="9" x2="17" y2="20" />
            </svg>
          </div>
          <span className="action-label">Withdraw</span>
        </button>

        <button
          type="button"
          className="accounts-action-card"
          onClick={() => {
            triggerHaptic("light");
            onTx("income", selectedAccount);
          }}
          aria-label="Add income or convert currency"
        >
          <div className="action-icon-badge is-converter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 16l-4-4 4-4M3 12h14M17 8l4 4-4 4M21 12H7" />
            </svg>
          </div>
          <span className="action-label">Converter</span>
        </button>
      </div>

      {/* Transactions Section matching Video Header & List */}
      <div className="accounts-transactions-header">
        <h2>Transactions</h2>
        <button
          type="button"
          className="accounts-see-all-link"
          onClick={() => onTab?.("activity")}
        >
          See all
        </button>
      </div>

      <div className="accounts-transactions-card">
        {visibleEvents.length ? (
          visibleEvents.map((event) => {
            const amount = displayAmount(event);
            const isPositive = amount.value > 0;
            const adjustment = adjustmentBalances.get(event.id);
            const isExpense = event.type === "expense";
            const category = event.cat || "Food";

            return (
              <button
                type="button"
                className={`accounts-tx-row${highlightedExpenseId === event.id || highlightedTransactionId === event.id ? " is-new" : ""}`}
                key={event.id}
                onClick={() => {
                  if (isExpense && onOpenExpense) {
                    onOpenExpense(event.id);
                  }
                }}
              >
                <div className={`accounts-tx-icon-circle is-${category.toLowerCase()}`}>
                  <CategorySymbol category={category} />
                </div>

                <div className="accounts-tx-info">
                  <b className="accounts-tx-title">{event.title}</b>
                  <small className="accounts-tx-date">{displayDate(event.d)}</small>
                  {adjustment && (
                    <small className="accounts-tx-adj-note">
                      {M(adjustment.before)} → {M(adjustment.after)}
                    </small>
                  )}
                </div>

                <b className={`accounts-tx-amount${isPositive ? " is-positive" : ""}`}>
                  {amount.signed ? (isPositive ? "+" : "−") : ""}
                  {M(Math.abs(amount.value))}
                </b>
              </button>
            );
          })
        ) : (
          <div className="accounts-tx-empty">
            <span className="accounts-tx-empty-icon">
              <Icon n="activity" />
            </span>
            <span>
              <b>No transactions yet</b>
              <small>Activity for {activeCard?.name || "this card"} will show up here.</small>
            </span>
          </div>
        )}
      </div>

      {/* Card Info Details Modal */}
      {infoCard && (
        <div
          className="card-info-backdrop"
          onClick={() => {
            setInfoCard(null);
            setShowCardSecrets(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setInfoCard(null);
              setShowCardSecrets(false);
            }
          }}
          tabIndex={-1}
        >
          <div
            className="card-info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-info-header">
              <div className="card-info-header-title-group">
                <h3 id="card-info-title">Card Details</h3>
                <span className={`card-info-status-pill ${frozenCards[infoCard.id] ? "is-frozen" : "is-active"}`}>
                  <span className="card-info-status-dot" />
                  {frozenCards[infoCard.id] ? "Frozen" : "Active • Contactless"}
                </span>
              </div>
              <button
                type="button"
                className="card-info-close"
                aria-label="Close card details"
                onClick={() => {
                  setInfoCard(null);
                  setShowCardSecrets(false);
                }}
              >
                ×
              </button>
            </div>

            <div className="card-info-preview-wrap">
              <WalletCard
                card={infoCard}
                balance={balances[infoCard.id] || 0}
                isActive={true}
                interactive={false}
                showBalance={true}
                showFullDetails={showCardSecrets}
              />
            </div>

            <div className="card-info-actions-bar">
              <button
                type="button"
                className={`card-info-toggle-secrets-btn ${showCardSecrets ? "is-revealed" : ""}`}
                onClick={() => {
                  triggerHaptic("selection");
                  setShowCardSecrets((prev) => !prev);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {showCardSecrets ? (
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
                {showCardSecrets ? "Hide Details" : "Show Details"}
              </button>

              <button
                type="button"
                className={`card-info-freeze-btn ${frozenCards[infoCard.id] ? "is-frozen" : ""}`}
                onClick={() => {
                  triggerHaptic("warning");
                  setFrozenCards((prev) => ({
                    ...prev,
                    [infoCard.id]: !prev[infoCard.id],
                  }));
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {frozenCards[infoCard.id] ? "Unfreeze" : "Freeze Card"}
              </button>
            </div>

            <div className="card-info-details-list">
              <div className="card-info-row">
                <span>Account Name</span>
                <b>{infoCard.name}</b>
              </div>
              <div className="card-info-row">
                <span>Cardholder</span>
                <b>{infoCard.holderName || profile?.name || "John Smith"}</b>
              </div>
              <div className="card-info-row">
                <span>Account Number</span>
                <div className="card-info-copy-group">
                  <b className="card-info-num-display">
                    {showCardSecrets
                      ? formatCardNumber(infoCard.number || "", infoCard.type === "mfs", true)
                      : formatCardNumber(infoCard.number || "", infoCard.type === "mfs", false)}
                  </b>
                  <button
                    type="button"
                    className="card-info-copy-btn"
                    onClick={() => handleCopyCard(infoCard.number || "")}
                  >
                    {copiedCard ? "Copied! ✓" : "Copy"}
                  </button>
                </div>
              </div>
              {infoCard.expiry && (
                <div className="card-info-row">
                  <span>Valid Thru</span>
                  <b>{formatExpiry(infoCard.expiry)}</b>
                </div>
              )}
              {infoCard.cvv && (
                <div className="card-info-row">
                  <span>CVV Security Code</span>
                  <b>{showCardSecrets ? infoCard.cvv : "•••"}</b>
                </div>
              )}
              <div className="card-info-row">
                <span>Current Balance</span>
                <b className="card-info-bal-highlight">{formatMoney(balances[infoCard.id] || 0)}</b>
              </div>
            </div>

            <div className="card-info-modal-actions">
              <button
                type="button"
                className="btn pri card-info-done-btn"
                onClick={() => {
                  setInfoCard(null);
                  setShowCardSecrets(false);
                }}
              >
                Done
              </button>

              {!["amazon", "citi", "bkash", "bank", "savings"].includes(infoCard.id) && (
                <button
                  type="button"
                  className="btn del card-info-delete-btn"
                  onClick={() => {
                    triggerHaptic("warning");
                    onDeleteCard?.(infoCard.id);
                    setInfoCard(null);
                    setShowCardSecrets(false);
                    setSelectedAccount(cards[0]?.id || "amazon");
                  }}
                >
                  Remove this Card
                </button>
              )}
            </div>
          </div>
        </div>
      )}
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
                <circle
                  cx="75"
                  cy="75"
                  r="62"
                  stroke="var(--line)"
                  strokeWidth="14"
                />
                <circle
                  cx="75"
                  cy="75"
                  r="62"
                  stroke={pc > 1 ? "var(--bad)" : "var(--g)"}
                  strokeWidth="14"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - Math.min(pc, 1))}
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
          </>
        ) : (
          <div className="emp">No budget for this month yet.</div>
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
          <div className="emp">No recurring expenses.</div>
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
function AddSheet({ iv, categoryOrder, expenses, cards = DEFAULT_CARDS, onSave, onClose }) {
  const [f, setF] = useState({
    amt: "",
    desc: "",
    cat: categoryOrder.find((category) => category !== "Savings") || "Food",
    date: ld(),
    acct: "",
    iv: iv || "none",
  });
  const [categoryTouched, setCategoryTouched] = useState(false);
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
          {f.cat === "Savings"
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
        {f.cat === "Savings" ? "Savings transfer" : "New expense"}
      </h3>
      <div className="amt">
        <span>৳</span>
        <input
          inputMode="decimal"
          autoFocus
          data-sheet-autofocus
          enterKeyHint="next"
          aria-label={
            f.cat === "Savings" ? "Savings transfer amount" : "Expense amount"
          }
          placeholder="0"
          value={f.amt}
          onChange={(e) => set("amt", e.target.value)}
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
                ...(c === "Savings" && !current.acct ? { acct: "bkash" } : {}),
              }));
            }}
          >
            <CategorySymbol category={c} /> {c}
          </button>
        ))}
      </div>
      {f.cat === "Savings" && (
        <p className="hint savings-transfer-note">
          Moves money from the selected account into Savings. It is not counted
          as spending or against your budget.
        </p>
      )}

      <span className="lbl">What was it for?</span>
      <input
        className="in"
        maxLength={80}
        aria-label="Expense description"
        placeholder={
          f.cat === "Savings" ? "e.g. Monthly savings" : "e.g. Lunch"
        }
        value={f.desc}
        onChange={(event) => {
          const description = event.target.value;
          set("desc", description);
          if (!categoryTouched) {
            const suggestion = suggestedCategory(description, expenses);
            if (suggestion) set("cat", suggestion);
          }
        }}
      />
      {categorySuggestion && (
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
        {f.cat === "Savings" ? "Transfer from" : "Paid from"}
      </span>
      <Seg
        value={f.acct}
        onPick={(v) => set("acct", v)}
        options={
          f.cat === "Savings"
            ? cards.filter((c) => c.type !== "savings").map((c) => [c.id, c.name])
            : [
                ["", "Cash"],
                ...cards.filter((c) => c.type !== "savings").map((c) => [c.id, c.name]),
              ]
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

function TxSheet({ type, defaultAccount, cards = DEFAULT_CARDS, onSave, onClose }) {
  const accountOptions = cards.map((c) => [c.id, c.name]);
  const defaultFrom =
    defaultAccount && cards.some((c) => c.id === defaultAccount)
      ? defaultAccount
      : cards[0]?.id || "bkash";
  const defaultTo =
    cards.find((c) => c.id !== defaultFrom)?.id ||
    cards[1]?.id ||
    "savings";

  const [g, setG] = useState({
    type,
    amt: "",
    acct: defaultFrom,
    dir: "up",
    note: "",
    fromAccount: defaultFrom,
    toAccount: defaultTo,
  });
  const set = (k, v) => setG((x) => ({ ...x, [k]: v }));
  const tr = g.type === "transfer";

  return (
    <Sheet
      onClose={onClose}
      actions={
        <button className="btn" onClick={() => onSave(g)}>
          Save
        </button>
      }
    >
      <h3 id="sheet-title">Account activity</h3>
      <Seg
        value={g.type}
        onPick={(v) => setG((current) => ({ ...current, type: v, note: "" }))}
        options={[
          ["income", "Income"],
          ["transfer", "Transfer"],
          ["adjust", "Adjust"],
        ]}
      />
      <div className="amt">
        <span>৳</span>
        <input
          inputMode="decimal"
          autoFocus
          data-sheet-autofocus
          aria-label={`${g.type === "adjust" ? "Adjustment" : g.type === "transfer" ? "Transfer" : "Income"} amount in taka`}
          placeholder="0"
          value={g.amt}
          onChange={(e) => set("amt", e.target.value)}
        />
      </div>

      {tr && (
        <>
          <span className="lbl">From</span>
          <Seg
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
            options={accountOptions}
          />
          <span className="lbl">To</span>
          <Seg
            value={g.toAccount}
            onPick={(value) => set("toAccount", value)}
            options={accountOptions.filter(([id]) => id !== g.fromAccount)}
          />
        </>
      )}

      {!tr && (
        <>
          <span className="lbl">Account</span>
          <Seg
            value={g.acct}
            onPick={(v) => set("acct", v)}
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

      {g.type === "adjust" ? (
        <>
          <span className="lbl">Reason (optional)</span>
          <select
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
            className="in"
            maxLength={80}
            aria-label="Transaction note"
            autoCapitalize="sentences"
            placeholder={
              g.type === "income" ? "e.g. Salary, cash in" : "Optional note"
            }
            value={g.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </>
      )}
    </Sheet>
  );
}

function DetailSheet({ e, suggestion, cards = DEFAULT_CARDS, onSave, onDelete, onClose }) {
  const [f, setF] = useState({
    desc: e.desc,
    amt: e.amt ?? "",
    cat: e.cat,
    date: e.date,
    acct: e.acct || "",
  });
  const set = (key, value) => setF((current) => ({ ...current, [key]: value }));
  return (
    <Sheet
      onClose={onClose}
      actionsClassName="is-paired"
      actions={
        <>
          <button className="btn" onClick={() => onSave(e.id, f)}>
            Save changes
          </button>
          <button className="btn del" onClick={() => onDelete(e.id)}>
            Delete expense
          </button>
        </>
      }
    >
      <h3 id="sheet-title">Edit expense</h3>
      <div className="amt">
        <span>৳</span>
        <input
          inputMode="decimal"
          aria-label="Expense amount in taka"
          placeholder="0"
          value={f.amt}
          onChange={(event) => set("amt", event.target.value)}
        />
      </div>
      <span className="lbl">What was it for?</span>
      <input
        className="in"
        maxLength={80}
        aria-label="Expense description"
        value={f.desc}
        onChange={(event) => set("desc", event.target.value)}
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
            key={category}
            className={f.cat === category ? "on" : ""}
            onClick={() => set("cat", category)}
          >
            <CategorySymbol category={category} /> {category}
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
      <span className="lbl">Paid from</span>
      <Seg
        value={f.acct}
        onPick={(value) => set("acct", value)}
        options={[
          ["", "Cash"],
          ...cards.filter((c) => c.type !== "savings").map((c) => [c.id, c.name]),
        ]}
      />
    </Sheet>
  );
}

function BudgetSheet({ S, onSave, onClear, onClose }) {
  const [v, setV] = useState(S.bud[S.m] || "");
  return (
    <Sheet
      onClose={onClose}
      actionsClassName={S.bud[S.m] ? "is-paired" : ""}
      actions={
        <>
          <button className="btn" onClick={() => onSave(parseFloat(v))}>
            Save budget
          </button>
          {S.bud[S.m] ? (
            <button className="btn del" onClick={onClear}>
              Clear budget
            </button>
          ) : null}
        </>
      }
    >
      <h3 id="sheet-title">Monthly budget</h3>
      <p className="hint" style={{ textAlign: "left" }}>
        {fM(S.m)}
      </p>
      <div className="amt">
        <span>৳</span>
        <input
          inputMode="decimal"
          autoFocus
          data-sheet-autofocus
          aria-label="Monthly budget amount in taka"
          placeholder="20000"
          value={v}
          onChange={(x) => setV(x.target.value)}
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
  backupStatus,
  lastBackupAt,
  onBackupDownload,
  onExpensesCsv,
  onBackupRestore,
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
        <i className="ic" style={{ "--c": "#2f7a5a" }}>
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
          <small>Accounts and reminders</small>
        </span>
        <span className="settings-chevron" aria-hidden="true">
          <Icon n="r" />
        </span>
      </button>
      <div className="settings-menu-section">
        <h4>Data &amp; backups</h4>
        <button
          className="ri settings-action"
          type="button"
          onClick={onBackupDownload}
        >
          <i className="ic" style={{ "--c": "#5b73d9" }}>
            <Icon n="backup" />
          </i>
          <span className="nm">
            <b>Export JSON backup</b>
            <small>All expenses, budgets, and settings</small>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <button
          className="ri settings-action"
          type="button"
          onClick={onExpensesCsv}
        >
          <i className="ic" style={{ "--c": "#2f9a6b" }}>
            <Icon n="csv" />
          </i>
          <span className="nm">
            <b>Export expenses CSV</b>
            <small>Full history for a spreadsheet</small>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <button
          className="ri settings-action"
          type="button"
          onClick={onBackupRestore}
        >
          <i className="ic" style={{ "--c": "#8a6fd1" }}>
            <Icon n="restore" />
          </i>
          <span className="nm">
            <b>Restore from backup</b>
            <small>Choose a Spend backup file</small>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
        <p className="settings-note">
          Restoring replaces current data. Spend will ask you to confirm first.
        </p>
        <p className="settings-note backup-reminder">
          {lastBackupAt
            ? `Last backed up ${new Date(lastBackupAt).toLocaleString(
                undefined,
                {
                  dateStyle: "medium",
                  timeStyle: "short",
                },
              )}. Consider downloading a fresh copy from time to time.`
            : "No backup yet. Download a JSON backup to keep a copy off this device."}
        </p>
        {backupStatus && (
          <p className="settings-status" role="status" aria-live="polite">
            {backupStatus}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function AddCardSheet({ onClose, onAddCard, userProfileName = "Cardholder" }) {
  const [step, setStep] = useState("catalog"); // 'catalog' | 'customize' | 'success'
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(CARD_PROVIDERS[0]);
  const [createdCard, setCreatedCard] = useState(null);

  // Form State with Live Synchronization
  const [formData, setFormData] = useState({
    name: "",
    holderName: userProfileName || "John Smith",
    number: "",
    type: "credit",
    network: "mastercard",
    expiry: "11/25",
    cvv: "654",
    initialBalance: "",
  });

  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return CARD_PROVIDERS;
    const q = searchQuery.toLowerCase();
    return CARD_PROVIDERS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.currency && p.currency.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  const handlePickProvider = (prov) => {
    setSelectedProvider(prov);
    setFormData((prev) => ({
      ...prev,
      name: prov.name,
      holderName: prev.holderName || userProfileName || "John Smith",
      type: prov.defaultType,
      network: prov.defaultNetwork,
      number: prov.isPhone
        ? `${prov.numberPrefix}12345678`
        : `${prov.numberPrefix}12540024${prov.id.includes("citi") ? "4328" : "9018"}`,
      expiry: prov.isPhone ? "" : "11/25",
      cvv: prov.isPhone ? "" : "654",
    }));
    setStep("customize");
  };

  const handleFormChange = (field, val) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleCardNumberChange = (raw) => {
    // If not phone, strip non-digits and limit to 16
    if (!selectedProvider.isPhone) {
      const digits = raw.replace(/\D/g, "").slice(0, 16);
      setFormData((prev) => ({ ...prev, number: digits }));
    } else {
      const digits = raw.replace(/[^\d+]/g, "").slice(0, 14);
      setFormData((prev) => ({ ...prev, number: digits }));
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

  const handleSubmitCard = (e) => {
    e?.preventDefault();
    const isMfs = selectedProvider.category === "mfs";
    const isSavings = selectedProvider.category === "savings";

    const newCard = {
      id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: formData.name.trim() || selectedProvider.name,
      provider: selectedProvider.id,
      category: selectedProvider.category,
      type: isMfs ? "mfs" : isSavings ? "savings" : formData.type,
      network: isMfs ? "mfs" : isSavings ? "none" : formData.network,
      holderName: formData.holderName.trim() || "John Smith",
      subtitle: selectedProvider.subtitle || `${selectedProvider.name} Platinum`,
      number: formData.number.trim() || selectedProvider.numberPlaceholder.replace(/\s+/g, ""),
      expiry: isMfs || isSavings ? "" : formData.expiry || "11/25",
      cvv: isMfs || isSavings ? "" : formData.cvv || "654",
      color: selectedProvider.color,
      gradient: selectedProvider.gradient,
      initialBalance: parseFloat(formData.initialBalance) || 0,
    };

    onAddCard(newCard);
    setCreatedCard(newCard);
    setStep("success");
    triggerHaptic("success");
  };

  const previewCard = {
    id: "preview",
    name: formData.name.trim() || selectedProvider.name,
    provider: selectedProvider.id,
    type: formData.type,
    network: formData.network,
    holderName: formData.holderName || "John Smith",
    subtitle: selectedProvider.subtitle || "Platinum Card",
    number:
      formData.number ||
      (selectedProvider.isPhone ? "01712 345678" : "6214 1254 0024 0241"),
    expiry: formData.expiry || "11/25",
    cvv: formData.cvv || "654",
    color: selectedProvider.color,
    gradient: selectedProvider.gradient,
  };

  return (
    <Sheet onClose={onClose}>
      {/* ──── Step 1: Catalog ("Add New Card") ──── */}
      {step === "catalog" && (
        <div className="add-new-card-catalog">
          <div className="add-card-header-bar">
            <h3 id="sheet-title" className="add-card-title">Add New Card</h3>
            <button
              type="button"
              className="add-card-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Search Bar matching video */}
          <div className="add-card-search-wrap">
            <svg viewBox="0 0 24 24" className="add-card-search-icon" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" fill="none" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="add-card-search-input"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
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

          {/* Card Templates List matching video */}
          <div className="add-card-template-list">
            {filteredProviders.length ? (
              filteredProviders.map((prov) => (
                <button
                  key={prov.id}
                  type="button"
                  className="add-card-template-row"
                  onClick={() => handlePickProvider(prov)}
                >
                  <div
                    className="add-card-mini-card"
                    style={{ background: prov.gradient }}
                  >
                    <div className="add-card-mini-logo">
                      {renderProviderLogo(prov.id, { height: 14 })}
                    </div>
                    <span className="add-card-mini-num">
                      {prov.isPhone ? "01X••" : "•••• 4328"}
                    </span>
                  </div>

                  <div className="add-card-template-meta">
                    <b className="add-card-template-name">{prov.name}</b>
                    <small className="add-card-template-sub">{prov.subtitle}</small>
                  </div>

                  <span className="add-card-currency-badge">{prov.currency || "USD"}</span>

                  <span className="add-card-template-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))
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
            <h3 id="sheet-title" className="add-card-title">Add Card</h3>
            <button
              type="button"
              className="add-card-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Real-time Dynamic Card Preview */}
          <div className="add-card-live-preview-wrap">
            <WalletCard
              card={previewCard}
              balance={parseFloat(formData.initialBalance) || 0}
              isActive={true}
              interactive={false}
              showBalance={false}
              showFullDetails={true}
            />
          </div>

          {/* Form Fields ("Card Details") */}
          <div className="add-card-form-body">
            <h4 className="add-card-section-label">Card Details</h4>

            <div className="add-card-field">
              <label className="add-card-input-lbl">Card Holder Name</label>
              <input
                className="add-card-native-input"
                type="text"
                required
                maxLength={30}
                placeholder="John Smith"
                value={formData.holderName}
                onChange={(e) => handleFormChange("holderName", e.target.value)}
              />
            </div>

            <div className="add-card-field">
              <label className="add-card-input-lbl">
                {selectedProvider.isPhone ? "Mobile Number" : "Card Number"}
              </label>
              <input
                className="add-card-native-input"
                type="text"
                required
                inputMode="numeric"
                placeholder={selectedProvider.isPhone ? "01712 345678" : "6214 1254 0024 0241"}
                value={
                  selectedProvider.isPhone
                    ? formData.number
                    : formatCardNumber(formData.number, false, true)
                }
                onChange={(e) => handleCardNumberChange(e.target.value)}
              />
            </div>

            {!selectedProvider.isPhone && selectedProvider.category !== "savings" && (
              <div className="add-card-two-col">
                <div className="add-card-field">
                  <label className="add-card-input-lbl">MM/YY</label>
                  <input
                    className="add-card-native-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="11/25"
                    maxLength={5}
                    value={formData.expiry}
                    onChange={(e) => handleExpiryChange(e.target.value)}
                  />
                </div>

                <div className="add-card-field">
                  <label className="add-card-input-lbl">CVC</label>
                  <input
                    className="add-card-native-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="654"
                    maxLength={4}
                    value={formData.cvv}
                    onChange={(e) => handleFormChange("cvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </div>
              </div>
            )}

            <div className="add-card-field">
              <label className="add-card-input-lbl">Starting Balance</label>
              <div className="add-card-balance-input-wrap">
                <span className="add-card-curr-prefix">৳</span>
                <input
                  className="add-card-native-input add-card-balance-input"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={formData.initialBalance}
                  onChange={(e) => handleFormChange("initialBalance", e.target.value)}
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

            <h3 className="add-card-success-title">Your card has been added successfully</h3>
            <p className="add-card-success-desc">
              We will notify you about your activities via email
            </p>

            <button
              type="button"
              className="add-card-home-cta"
              onClick={onClose}
            >
              Go Home
            </button>
          </div>
        </div>
      )}
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
            <i className="ic" style={{ "--c": "#2f7a5a" }}>
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
            <i className="ic" style={{ "--c": "#2f7a5a" }}>
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
        {profile?.connected && !cloudSyncEnabled && (
          <button
            className="btn settings-account-action"
            type="button"
            disabled={authBusy}
            onClick={onResumeSync}
            style={{ marginBottom: "10px" }}
          >
            Resume sync
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
  onAccounts,
  onSignIn,
  onReminder,
  onToggleNotifications,
  onTestNotification,
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
        <h2>Accounts</h2>
        <button
          className="ri settings-action"
          type="button"
          onClick={onAccounts}
        >
          <i className="ic" style={{ "--c": "#3b82c4" }}>
            <Icon n="bank" />
          </i>
          <span className="nm">
            <b>Account setup</b>
            <small>Starting balances, transfers, and account activity</small>
          </span>
          <span className="settings-chevron" aria-hidden="true">
            <Icon n="r" />
          </span>
        </button>
      </section>

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
        {pushBackendConfigured && profile?.connected ? (
          <>
            <button
              className="ri settings-action"
              type="button"
              role="switch"
              aria-checked={backgroundPushEnabled}
              disabled={
                !backgroundPushEnabled &&
                (notificationBlocked || notificationUnavailable)
              }
              onClick={onToggleNotifications}
            >
              <i className="ic" style={{ "--c": "#2f9a6b" }}>
                <Icon n="bell" />
              </i>
              <span className="nm">
                <b>Background reminders</b>
                <small>{notificationLabel}</small>
              </span>
              <span
                className={"sw " + (backgroundPushEnabled ? "on" : "")}
                aria-hidden="true"
              />
            </button>
            {backgroundPushEnabled && onTestNotification && (
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
                  <small>Fires in 3s (lock screen or switch apps)</small>
                </span>
                <span className="settings-chevron" aria-hidden="true">
                  <Icon n="r" />
                </span>
              </button>
            )}
          </>
        ) : pushBackendConfigured ? (
          <button
            className="ri settings-action"
            type="button"
            onClick={onSignIn}
          >
            <i className="ic" style={{ "--c": "#2f9a6b" }}>
              <Icon n="bell" />
            </i>
            <span className="nm">
              <b>Background reminders</b>
              <small>Sign in to enable push reminders</small>
            </span>
            <span className="settings-chevron" aria-hidden="true">
              <Icon n="r" />
            </span>
          </button>
        ) : (
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
              <b>System notifications</b>
              <small>{notificationLabel}</small>
            </span>
            <span className="settings-inline-action">
              {notificationPermission === "granted" ? "Test" : "Enable"}
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
    </>
  );
}

/* These screens stay presentational. App supplies shared expense data,
   persistence, account actions, and sync state. */
export default function MobilePrototype({
  S,
  onShift,
  onExpenseSave,
  onExpenseUpdate,
  onExpenseDelete,
  onBudgetSave,
  onBudgetClear,
  onTransactionSave,
  onAddCard,
  onDeleteCard,
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
  onExpensesCsv,
  onBackupRestore,
  accountStatus,
  authBusy,
  onResumeSync,
  inAppNotification,
  onDismissNotification,
}) {
  const [tab, setTab] = useState("home");
  const cards = S.cards && S.cards.length > 0 ? S.cards : DEFAULT_CARDS;
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
      if (
        targetTab &&
        ["home", "activity", "accounts", "plans"].includes(targetTab)
      ) {
        setAppSettingsOpen(false);
        setProfileSettingsOpen(false);
        setTab(targetTab);
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
    const sheetNode = mobileRootRef.current?.querySelector(".sh");
    const sheetStyle = sheetNode ? window.getComputedStyle(sheetNode) : null;
    const sheetHeight = sheetNode?.getBoundingClientRect().height ?? 0;
    setSheetExitFromTransform(
      exit?.kind === "drag"
        ? `translate3d(0, ${exit.distance}px, 0)`
        : sheetStyle?.transform || "translate3d(0, 0, 0)",
    );
    setSheetExitFromOpacity(sheetStyle?.opacity || "1");
    const remaining =
      exit?.kind === "drag" && sheetHeight > 0
        ? Math.max(0.08, 1 - exit.distance / sheetHeight)
        : 1;
    const velocity =
      exit?.kind === "drag"
        ? Math.max(0, Math.min(exit.velocity || 0, 2.4))
        : 0;
    const exitDuration = prefersReducedMotion
      ? SHEET_REDUCED_EXIT_MS
      : exit?.kind === "drag"
        ? Math.max(
            150,
            Math.round(
              (SHEET_EXIT_MS * Math.sqrt(remaining)) / (1 + velocity * 0.12),
            ),
          )
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
  const openBudget = () => openSheet({ type: "bud" });
  const detail =
    sheet?.type === "det" ? S.exp.find((x) => x.id === sheet.id) : null;

  const saveExpense = (f) => {
    const isSavingsTransfer = f.cat === "Savings";
    const isRecurring = f.iv !== "none";
    if (isSavingsTransfer && !String(f.amt ?? "").trim())
      return toast("Enter an amount for this savings transfer.");
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
  const deleteExpense = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    const undo = expense ? onExpenseDelete(expense) : undefined;
    close();
    triggerHaptic("delete");
    toast("Expense removed", undo);
  };
  const skipRecurringExpense = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    if (!expense?.rec) return deleteExpense(id);
    const undo = onExpenseDelete(expense);
    close();
    triggerHaptic("warning");
    toast("Skipped this recurring occurrence", undo);
  };
  const duplicateExpense = (expense) => {
    const saved = onExpenseSave({
      description: expense.desc,
      amount: expense.amt,
      category: expense.cat,
      date: ld(),
      account: expense.acct,
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
    const amountText = String(form.amt ?? "").trim();
    const amount = amountText ? Number(amountText) : null;
    if (
      !form.desc.trim() ||
      !form.date ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0))
    ) {
      return toast("Check the description, amount, and date.");
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
      {inAppNotification && (
        <div
          className="in-app-notification-banner"
          role="alert"
          aria-live="assertive"
          onClick={() => {
            triggerHaptic("selection");
            if (inAppNotification.onAction) {
              inAppNotification.onAction();
            } else if (inAppNotification.tab) {
              nav(inAppNotification.tab);
            } else {
              nav("activity");
            }
            onDismissNotification?.();
          }}
        >
          <div
            className={`in-app-notification-icon${
              inAppNotification.iconType === "budget"
                ? " is-budget"
                : inAppNotification.iconType === "danger"
                  ? " is-danger"
                  : ""
            }`}
          >
            {inAppNotification.icon || <Icon n="bell" />}
          </div>
          <div className="in-app-notification-content">
            <span className="in-app-notification-title">
              {inAppNotification.title}
            </span>
            <span className="in-app-notification-desc">
              {inAppNotification.body}
            </span>
          </div>
          {inAppNotification.actionLabel && (
            <button
              type="button"
              className="in-app-notification-action"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic("selection");
                inAppNotification.onAction?.();
                onDismissNotification?.();
              }}
            >
              {inAppNotification.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="in-app-notification-close"
            aria-label="Dismiss notification"
            onClick={(e) => {
              e.stopPropagation();
              onDismissNotification?.();
            }}
          >
            ×
          </button>
        </div>
      )}
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
                className="prototype-header-add-pill"
                type="button"
                aria-label="Add new card or account"
                onClick={() => openSheet({ type: "addCard" })}
              >
                <span className="pill-plus">+</span>
                <span>Add Card</span>
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
                onAccounts={() => nav("accounts")}
                onSignIn={signIn}
                onReminder={onReminder}
                onToggleNotifications={onToggleNotifications}
                onTestNotification={onTestNotification}
              />
            ) : (
              tab === "home" && (
                <Home
                  S={S}
                  profile={profile}
                  onShift={onShift}
                  onTab={nav}
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
                onDelete={deleteExpense}
                onSkip={skipRecurringExpense}
                onDuplicate={duplicateExpense}
                searchRef={activitySearchRef}
                highlightedExpenseId={highlightedExpenseId}
              />
            )}
            {!appSettingsOpen && !profileSettingsOpen && tab === "accounts" && (
              <Accounts
                S={S}
                onTx={(t, acct) => openSheet({ type: "tx", t, acct })}
                onAddCardClick={() => openSheet({ type: "addCard" })}
                onDeleteCard={(cardId) => {
                  onDeleteCard?.(cardId);
                  toast("Card removed");
                }}
                highlightedExpenseId={highlightedExpenseId}
                highlightedTransactionId={highlightedTransactionId}
                profile={profile}
                onTab={nav}
                onOpenExpense={openExpense}
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
        data-hidden={
          keyboardOpen || Boolean(sheet) || settingsRoute ? "true" : undefined
        }
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
                  openSheet({ type: "add" });
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

      {sheet?.type === "addCard" && (
        <AddCardSheet
          onClose={close}
          onAddCard={(newCard) => {
            const added = onAddCard?.(newCard);
            toast(`Card ${newCard.name} added`);
            return added;
          }}
          userProfileName={profile?.name}
        />
      )}
      {sheet?.type === "add" && (
        <AddSheet
          iv={sheet.iv}
          categoryOrder={categoryOrder}
          expenses={S.exp}
          cards={cards}
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
      {detail && (
        <DetailSheet
          e={detail}
          suggestion={suggestedCategory(
            detail.desc,
            S.exp.filter((pastExpense) => pastExpense.id !== detail.id),
          )}
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
          backupStatus={backupStatus}
          lastBackupAt={lastBackupAt}
          onBackupDownload={onBackupDownload}
          onExpensesCsv={onExpensesCsv}
          onBackupRestore={onBackupRestore}
        />
      )}

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
