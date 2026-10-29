import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaPenToSquare } from "react-icons/fa6";
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
  Savings: ["🐖", "#2f9a6b"],
  Other: ["", "#7d8a82"],
};
const ACC = { bkash: ["bKash", "#e2136e"], bank: ["Bank", "#2563a8"] };
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
  inc: <path d="M12 19V5M5 12l7-7 7 7" />,
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
  for (const e of S.exp)
    if (
      e.acct === id &&
      e.amt != null &&
      e.date >= S.start.date &&
      e.date <= ld()
    )
      b -= e.amt;
  for (const t of S.tx) {
    if (t.date < S.start.date) continue;
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
    <button aria-label="Previous month" onClick={() => onShift(-1)}>
      <Icon n="l" />
    </button>
    <b>{fM(m)}</b>
    <button
      aria-label="Next month"
      disabled={m >= ld().slice(0, 7)}
      onClick={() => onShift(1)}
    >
      <Icon n="r" />
    </button>
  </div>
);

function suggestedCategory(description, expenses = []) {
  const title = String(description || "").trim().toLocaleLowerCase();
  if (!title) return "";
  const exactCategory = Object.keys(CAT).find(
    (category) => category.toLocaleLowerCase() === title,
  );
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
      "Savings",
      /\b(saving|savings|deposit|dps|fdr|investment|investing|transfer to savings)\b/,
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
    const pastWords = new Set(
      String(expense.desc || "")
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2),
    );
    const overlap = [...words].filter((word) => pastWords.has(word)).length;
    const score = overlap / Math.max(words.size, pastWords.size, 1);
    if (overlap && score > best.score)
      best = { score, category: expense.cat };
  }
  return best.score >= 0.5 ? best.category : "";
}

function ExpenseRow({
  e,
  onOpen,
  onDelete,
  onDuplicate,
  suggestion = "",
  isNew = false,
}) {
  const [, c] = CAT[e.cat];
  const pointerRef = useRef(null);
  const rowRef = useRef(null);
  const holdTimerRef = useRef();
  const swipeTimerRef = useRef();
  const collapseTimerRef = useRef();
  const suppressClickTimerRef = useRef();
  const suppressClickRef = useRef(false);
  const [swipe, setSwipe] = useState({ offset: 0, phase: "idle" });
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
  const beginDelete = () => {
    if (
      !onDelete ||
      swipeRef.current.phase === "deleting" ||
      swipeRef.current.phase === "collapsing"
    )
      return;
    clearTimeout(swipeTimerRef.current);
    clearTimeout(collapseTimerRef.current);
    const width = pointerRef.current?.width || rowRef.current?.offsetWidth || 320;
    updateSwipe({ offset: -width, phase: "deleting" });
    collapseTimerRef.current = setTimeout(() => {
      updateSwipe({ offset: -width, phase: "collapsing" });
    }, 220);
    swipeTimerRef.current = setTimeout(() => onDelete(e.id), 460);
  };
  useEffect(
    () => () => {
      clearTimeout(holdTimerRef.current);
      clearTimeout(swipeTimerRef.current);
      clearTimeout(collapseTimerRef.current);
      clearTimeout(suppressClickTimerRef.current);
    },
    [],
  );
  const startGesture = (event) => {
    if (!onDelete && !onDuplicate) return;
    if (event.button != null && event.button !== 0) return;
    if (["deleting", "collapsing"].includes(swipeRef.current.phase)) return;
    clearHoldTimer();
    clearTimeout(swipeTimerRef.current);
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
      width: rowRef.current?.offsetWidth || 320,
      moved: false,
      horizontal: false,
      draggingStateApplied: false,
      initialOffset: swipeRef.current.offset,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    };
    suppressClickRef.current = false;
    if (event.pointerType === "touch" && onDuplicate) {
      holdTimerRef.current = setTimeout(() => {
        if (!pointerRef.current?.moved) {
          suppressNextClick();
          onDuplicate(e);
        }
      }, 560);
    }
  };
  const moveGesture = (event) => {
    if (!pointerRef.current) return;
    const dx = event.clientX - pointerRef.current.x;
    const dy = event.clientY - pointerRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      pointerRef.current.moved = true;
      clearHoldTimer();
    }
    if (
      onDelete &&
      !pointerRef.current.horizontal &&
      (dx < -8 || (pointerRef.current.initialOffset < 0 && dx > 8)) &&
      Math.abs(dx) > Math.abs(dy) * 1.15
    ) {
      pointerRef.current.horizontal = true;
      suppressNextClick();
      rowRef.current?.classList.add("is-swipe-dragging");
      try {
        event.currentTarget.setPointerCapture(pointerRef.current.pointerId);
      } catch {
        // Pointer capture is an enhancement; dragging still works without it.
      }
    }
    if (pointerRef.current.horizontal) {
      const offset = Math.max(
        -pointerRef.current.width,
        Math.min(0, pointerRef.current.initialOffset + dx),
      );
      const nextSwipe = { offset, phase: "dragging" };
      swipeRef.current = nextSwipe;
      rowRef.current?.style.setProperty("--swipe-x", `${offset}px`);
      if (!pointerRef.current.draggingStateApplied) {
        pointerRef.current.draggingStateApplied = true;
        setSwipe(nextSwipe);
      }
    }
  };
  const endGesture = (event) => {
    clearHoldTimer();
    const gesture = pointerRef.current;
    if (gesture && event.type === "pointercancel") {
      updateSwipe({ offset: 0, phase: "idle" });
    } else if (gesture) {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.horizontal && onDelete && Math.abs(dy) < 72) {
        const offset = Math.min(0, gesture.initialOffset + dx);
        const elapsed = Math.max(1, performance.now() - gesture.startedAt);
        const velocity = dx / elapsed;
        suppressNextClick();
        if (
          offset <= -Math.max(118, gesture.width * 0.42) ||
          (dx < -54 && velocity < -0.72)
        ) {
          beginDelete();
        } else if (offset <= -52) {
          updateSwipe({ offset: -78, phase: "revealed" });
        } else {
          updateSwipe({ offset: 0, phase: "idle" });
        }
      }
    }
    pointerRef.current = null;
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
      ? "Tap to edit, swipe left to delete, or press and hold to duplicate."
      : "Tap to edit.";
  const rowClasses = [
    "ri",
    "expense-row",
    isNew && "is-new",
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
      style={onDelete ? { "--swipe-x": `${swipe.offset}px` } : undefined}
      aria-label={`${e.desc}, ${M(e.amt || 0)}${e.cat === "Savings" ? ", savings transfer" : ""}. ${gestureHint}`}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          clearTimeout(suppressClickTimerRef.current);
          return;
        }
        if (swipeRef.current.phase === "revealed") {
          updateSwipe({ offset: 0, phase: "idle" });
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
        <b className={amountClass}>{amountPrefix}{M(e.amt)}</b>
      )}
    </button>
  );
  if (!onDelete) return row;
  return (
    <div
      className={`expense-swipe-shell${swipe.phase === "collapsing" ? " is-collapsing" : ""}`}
    >
      <button
        className="expense-swipe-delete"
        type="button"
        aria-label={`Delete ${e.desc}`}
        disabled={swipe.phase !== "revealed"}
        tabIndex={swipe.phase === "revealed" ? 0 : -1}
        onClick={beginDelete}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v6m4-6v6" />
        </svg>
      </button>
      {row}
    </div>
  );
}

function Sheet({ onClose, children, actions, actionsClassName = "" }) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const sheetRef = useRef(null);

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
    const scrollNode = sheetNode?.querySelector(".sheet-content");
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
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
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
        (!focusIsInside || activeElement === sheetNode || activeElement === first)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (!focusIsInside || activeElement === sheetNode || activeElement === last)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const startDrag = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };
  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    setDragOffset(Math.max(0, event.clientY - drag.startY));
  };
  const finishDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.startY);
    const shouldClose = distance >= 112 || (distance >= 48 && drag.velocity > 0.72);
    dragRef.current = null;
    setIsDragging(false);
    if (shouldClose) {
      setDragOffset(distance);
      onClose({ kind: "drag", distance, velocity: drag.velocity });
    } else {
      setDragOffset(0);
    }
  };
  const cancelDrag = () => {
    dragRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  return (
    <div
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
        data-dragging={isDragging ? "true" : undefined}
        style={{ "--sheet-drag-y": `${dragOffset}px` }}
      >
        <div
          className="sheet-drag-zone"
          aria-hidden="true"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
        >
          <div className="grab" />
        </div>
        <div className="sheet-content">{children}</div>
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
  const namedCategoryTotal = Object.values(by).reduce((sum, value) => sum + value, 0);
  const otherTotal = Math.max(0, Number((total - namedCategoryTotal).toFixed(2)));
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
                {overBudget
                  ? `${M(t - b)} over budget`
                  : `${M(b - t)} left`}
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
          <b className="mini-next-value">
            {nx ? nx.desc : "Nothing due"}
          </b>
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
                style={{ width: (v / total) * 100 + "%", background: CAT[c][1] }}
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

function Accounts({ S, onTx, highlightedExpenseId, highlightedTransactionId }) {
  const b1 = bal(S, "bkash"),
    b2 = bal(S, "bank");
  const act = [
    ...S.exp
      .filter((e) => e.acct && e.amt != null)
      .map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        d: e.date,
        t: e.desc,
        a: -e.amt,
        k: ACC[e.acct][0],
      })),
    ...S.tx.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      d: t.date,
      t:
        t.note ||
        { income: "Income", transfer: "Transfer", adjust: "Adjustment" }[
          t.type
        ],
      a:
        t.type === "transfer"
          ? t.amt
          : t.type === "adjust" && t.dir === "down"
            ? -t.amt
            : t.amt,
      k:
        t.type === "transfer"
          ? ACC[t.acct][0] + " → " + ACC[t.to][0]
          : ACC[t.acct][0],
    })),
  ]
    .sort(
      (a, b) =>
        b.d.localeCompare(a.d) ||
        activityTime(b) - activityTime(a),
    )
    .slice(0, 8);

  return (
    <>
      <div className="card" style={{ margin: 0 }}>
        <small className="lbl">Total balance</small>
        <div className="big" style={{ margin: "4px 0 0" }}>
          <AnimatedAmount value={b1 + b2} />
        </div>
      </div>

      <div className="two">
        {[
          ["bkash", b1],
          ["bank", b2],
        ].map(([i, v]) => (
          <div
            key={i}
            className="acc"
            style={{
              background: `linear-gradient(145deg,${ACC[i][1]},color-mix(in srgb,${ACC[i][1]} 75%,#000))`,
            }}
          >
            <div className="al">
              <span className={"lg " + i}>
                {i === "bkash" ? <img src={BK} alt="" /> : <Icon n="bank" />}
              </span>
              <small>{ACC[i][0]}</small>
            </div>
            <div className="big">
              <AnimatedAmount value={v} />
            </div>
          </div>
        ))}
      </div>

      <div className="acts">
        {[
          ["income", "inc", "Income"],
          ["transfer", "tr", "Transfer"],
          ["adjust", "adj", "Adjust"],
        ].map(([t, i, l]) => (
          <button key={t} onClick={() => onTx(t)}>
            <Icon n={i} />
            {l}
          </button>
        ))}
      </div>

      <div className="sec">
        <h2>Account activity</h2>
      </div>
      <div className="card" style={{ margin: 0, padding: "6px 14px" }}>
        {act.length ? (
          act.map((x) => (
            <div
              className={`ri account-activity-row${
                highlightedExpenseId === x.id || highlightedTransactionId === x.id
                  ? " is-new"
                  : ""
              }`}
              key={x.id}
            >
              <span className="nm">
                <b>{x.t}</b>
                <small>
                  {x.k} · {fD(x.d)}
                </small>
              </span>
              <b
                className="am"
                style={{ color: x.a > 0 ? "var(--g)" : "inherit" }}
              >
                {x.a > 0 ? "+" : "−"}
                {M(Math.abs(x.a))}
              </b>
            </div>
          ))
        ) : (
          <div className="account-activity-empty" role="status">
            <span className="account-activity-empty-icon">
              <Icon n="activity" />
            </span>
            <span>
              <b>No account activity yet</b>
              <small>
                Income, transfers, and balance adjustments will show up here.
              </small>
            </span>
          </div>
        )}
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
  const b = S.bud[S.m] || 0,
    t = tot(S, S.m),
    pc = b ? t / b : 0,
    C = 2 * Math.PI * 62;
  const act = S.rec.filter((r) => r.on);
  const est = act.reduce((a, r) => a + r.amt * (r.iv === "weekly" ? 4 : 1), 0);

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
function AddSheet({ iv, categoryOrder, expenses, onSave, onClose }) {
  const [f, setF] = useState({
    amt: "",
    desc: "",
    cat: categoryOrder[0] || "Food",
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
          Add expense
        </button>
      }
    >
      <h3 id="sheet-title">New expense</h3>
      <div className="amt">
        <span>৳</span>
        <input
          inputMode="decimal"
          autoFocus
          data-sheet-autofocus
          enterKeyHint="next"
          aria-label="Expense amount"
          placeholder="0"
          value={f.amt}
          onChange={(e) => set("amt", e.target.value)}
        />
      </div>
      <p className="hint">
        {f.iv === "none"
          ? "Leave the amount blank to fill it in later."
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
              set("cat", c);
            }}
          >
            <CategorySymbol category={c} /> {c}
          </button>
        ))}
      </div>

      <span className="lbl">What was it for?</span>
      <input
        className="in"
        maxLength={80}
        aria-label="Expense description"
        placeholder="e.g. Lunch"
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
        <p className="category-suggestion-hint" role="status" aria-live="polite">
          <span>Suggested category:</span>
          <b><CategorySuggestionValue category={categorySuggestion} /></b>
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

      <span className="lbl">Paid from</span>
      <Seg
        value={f.acct}
        onPick={(v) => set("acct", v)}
        options={[
          ["", "Cash"],
          ["bkash", "bKash"],
          ["bank", "Bank"],
        ]}
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

function TxSheet({ type, onSave, onClose }) {
  const [g, setG] = useState({
    type,
    amt: "",
    acct: "bank",
    dir: "up",
    note: "",
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
        onPick={(v) => set("type", v)}
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

      <span className="lbl">{tr ? "From" : "Account"}</span>
      <Seg
        value={g.acct}
        onPick={(v) => set("acct", v)}
        options={[
          ["bkash", "bKash"],
          ["bank", "Bank"],
        ]}
      />
      {tr && (
        <p className="hint" style={{ marginTop: 10 }}>
          → to {g.acct === "bank" ? "bKash" : "Bank"}
        </p>
      )}

      {g.type === "adjust" && (
        <>
          <span className="lbl">Correction</span>
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

      <span className="lbl">Note</span>
      <input
        className="in"
        maxLength={80}
        aria-label="Transaction note"
        placeholder="e.g. Salary, cash deposit"
        value={g.note}
        onChange={(e) => set("note", e.target.value)}
      />
    </Sheet>
  );
}

function DetailSheet({ e, suggestion, onSave, onDelete, onClose }) {
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
        options={[["", "Cash"], ["bkash", "bKash"], ["bank", "Bank"]]}
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
            ? `Last backed up ${new Date(lastBackupAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}. Consider downloading a fresh copy from time to time.`
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
      <p className="settings-page-intro">
        Manage accounts and reminders.
      </p>

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
  backupStatus,
  lastBackupAt,
  onBackupDownload,
  onExpensesCsv,
  onBackupRestore,
  accountStatus,
  authBusy,
}) {
  const [tab, setTab] = useState("home");
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
  const [highlightedTransactionId, setHighlightedTransactionId] = useState(null);
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
    const themeColor = activeTheme === "dark" ? "#101315" : "#f5f7f5";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", themeColor));
  }, [S.theme]);

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
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
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
      lastTopRef.current = screenScrollRef.current?.scrollTop ?? lastTopRef.current;
      dirAccRef.current = 0;
      resetDockDirectionTimer();

      if (nestedScrollPointerRef.current) {
        clearTimeout(nestedScrollResumeTimerRef.current);
        nestedScrollResumeTimerRef.current = setTimeout(() => {
          nestedScrollPointerRef.current = false;
          nestedScrollResumeTimerRef.current = undefined;
          const scroller = screenScrollRef.current;
          if (!scroller) return;
          const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
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
      lastTopRef.current = screenScrollRef.current?.scrollTop ?? lastTopRef.current;
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
      exit?.kind === "drag" ? Math.max(0, Math.min(exit.velocity || 0, 2.4)) : 0;
    const exitDuration = prefersReducedMotion
      ? SHEET_REDUCED_EXIT_MS
      : exit?.kind === "drag"
        ? Math.max(
            150,
            Math.round(
              SHEET_EXIT_MS * Math.sqrt(remaining) / (1 + velocity * 0.12),
            ),
          )
        : SHEET_EXIT_MS;
    setSheetExitDuration(exitDuration);
    sheetCloseTimer.current = window.setTimeout(
      () => {
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
      },
      exitDuration,
    );
  };
  const captureSheetTrigger = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("button");
    sheetTriggerCandidateRef.current = button && !button.closest(".sh") ? button : null;
  };
  const openSheet = (nextSheet) => {
    clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = null;
    const candidate = sheetTriggerCandidateRef.current;
    const activeElement = document.activeElement;
    sheetReturnFocusRef.current =
      candidate?.isConnected
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
    if (
      (t !== tab || appSettingsOpen || profileSettingsOpen) &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(8);
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
    const saved = onExpenseSave({
      description: f.desc.trim() || f.cat,
      amount: f.amt,
      category: f.cat,
      date: f.date,
      account: f.acct,
      interval: f.iv,
    });
    if (!saved)
      return toast(
        f.iv !== "none" && !f.amt
          ? "Recurring expenses need an amount."
          : "Check the expense details and try again.",
      );
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
    toast("Expense added");
  };
  const deleteExpense = (id) => {
    const expense = S.exp.find((item) => item.id === id);
    const undo = expense ? onExpenseDelete(expense) : undefined;
    close();
    toast("Expense removed", undo);
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
    if (!saved) return toast("Could not duplicate this expense.");
    if (typeof saved === "object" && saved.expenseId) {
      clearTimeout(highlightTimer.current);
      setHighlightedExpenseId(saved.expenseId);
      highlightTimer.current = setTimeout(() => setHighlightedExpenseId(null), 1500);
    }
    toast("Expense duplicated");
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
    if (!onExpenseUpdate(id, {
      description: form.desc.trim(),
      amount,
      category: form.cat,
      date: form.date,
      account: form.acct,
    })) return toast("Could not update this expense.");
    close();
    toast("Expense updated");
  };
  const saveBudget = (value) => {
    if (!Number.isFinite(value) || value <= 0)
      return toast("Enter a monthly budget.");
    onBudgetSave(value);
    close();
    toast("Budget saved");
  };
  const clearBudget = () => {
    const undo = onBudgetClear();
    close();
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
            ? "Accounts"
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
                aria-label="Add income"
                onClick={() => openSheet({ type: "tx", t: "income" })}
              >
                <Icon n="plus" />
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
        className={`prototype-screen-scroll${tab === "activity" ? " is-activity" : ""}`}
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
                onDuplicate={duplicateExpense}
                searchRef={activitySearchRef}
                highlightedExpenseId={highlightedExpenseId}
              />
            )}
            {!appSettingsOpen && !profileSettingsOpen && tab === "accounts" && (
              <Accounts
                S={S}
                onTx={(t) => openSheet({ type: "tx", t })}
                highlightedExpenseId={highlightedExpenseId}
                highlightedTransactionId={highlightedTransactionId}
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
        data-hidden={keyboardOpen || Boolean(sheet) || settingsRoute ? "true" : undefined}
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
                onClick={() => openSheet({ type: "add" })}
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

      {sheet?.type === "add" && (
        <AddSheet
          iv={sheet.iv}
          categoryOrder={categoryOrder}
          expenses={S.exp}
          onSave={saveExpense}
          onClose={close}
        />
      )}
      {sheet?.type === "tx" && (
        <TxSheet type={sheet.t} onSave={saveTransaction} onClose={close} />
      )}
      {detail && (
        <DetailSheet
          e={detail}
          suggestion={suggestedCategory(
            detail.desc,
            S.exp.filter((pastExpense) => pastExpense.id !== detail.id),
          )}
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
