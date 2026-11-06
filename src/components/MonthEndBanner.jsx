import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryIcon } from "../categoryAssets.jsx";

/* ---------- distinct tints matching all 10 app categories ---------- */
export const CATEGORY_TINTS = {
  Food: "#fbe3da",
  Transport: "#dfe8f7",
  Bills: "#fbf0c9",
  Home: "#d1fae5",
  Shopping: "#e8dcf5",
  Health: "#fee2e2",
  Entertainment: "#cffafe",
  Education: "#e0e7ff",
  Savings: "#fce7f3",
  Other: "#e1e8dc",
};

const TINTS = [
  "#fbe3da",
  "#dfe8f7",
  "#fbf0c9",
  "#d1fae5",
  "#e8dcf5",
  "#fee2e2",
  "#cffafe",
  "#e0e7ff",
  "#e1e8dc",
];

/* ---------- sample data (used when no `data` or matching transactions passed) ---------- */
const SAMPLE = {
  monthKey: "2026-10",
  month: "October",
  prevMonth: "September",
  nextMonth: "November",
  total: 12480,
  prevTotal: 14200,
  entries: 48,
  daysInMonth: 31,
  categories: [
    { name: "Food", amount: 5200, icon: getCategoryIcon("Food"), tint: CATEGORY_TINTS.Food },
    { name: "Transport", amount: 2300, icon: getCategoryIcon("Transport"), tint: CATEGORY_TINTS.Transport },
    { name: "Bills", amount: 2100, icon: getCategoryIcon("Bills"), tint: CATEGORY_TINTS.Bills },
    { name: "Shopping", amount: 1780, icon: getCategoryIcon("Shopping"), tint: CATEGORY_TINTS.Shopping },
    { name: "Home", amount: 1400, icon: getCategoryIcon("Home"), tint: CATEGORY_TINTS.Home },
  ],
  days: {
    2: 320, 3: 540, 5: 410, 6: 260, 8: 780, 9: 350, 11: 620, 12: 290, 14: 480,
    15: 1250, 17: 2100, 18: 380, 20: 540, 21: 660, 23: 310, 24: 890, 26: 450,
    27: 520, 29: 760, 30: 430, 31: 140,
  },
};

/* ---------- helper: build `data` from raw transactions ----------
   month = "YYYY-MM" of the month to recap. Expenses must be positive numbers
   (use amountOf={(t) => -t.amount} if yours are negative). */
export function buildRecap(
  transactions = [],
  {
    month,
    amountOf = (t) => t.amount ?? t.amt,
    dateOf = (t) => t.date,
    categoryOf = (t) => t.category ?? t.cat,
    locale = "en-US",
  } = {},
) {
  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  let y, m;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const parts = month.split("-").map(Number);
    y = parts[0];
    m = parts[1];
  } else {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    y = prev.getFullYear();
    m = prev.getMonth() + 1;
  }

  const targetKey = `${y}-${String(m).padStart(2, "0")}`;
  const prevDate = new Date(y, m - 2, 1);
  const prevKey = key(prevDate);
  const name = (mm) =>
    new Date(y, mm, 1).toLocaleString(locale, { month: "long" });

  let total = 0,
    prevTotal = 0,
    entries = 0;
  const cats = {},
    days = {};

  for (const t of transactions) {
    if (!t) continue;
    const dateVal = dateOf(t);
    const d =
      typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)
        ? new Date(`${dateVal.slice(0, 10)}T00:00:00`)
        : new Date(dateVal);
    if (isNaN(d.getTime())) continue;

    const a = Number(amountOf(t)) || 0;
    if (a <= 0) continue;

    const k = key(d);
    if (k === prevKey) {
      prevTotal += a;
    } else if (k === targetKey) {
      const c = categoryOf(t) || "Other";
      total += a;
      entries++;
      cats[c] = (cats[c] || 0) + a;
      const dayNum = d.getDate();
      days[dayNum] = (days[dayNum] || 0) + a;
    }
  }

  return {
    monthKey: targetKey,
    month: name(m - 1),
    prevMonth: name(m - 2),
    nextMonth: name(m),
    total,
    prevTotal,
    entries,
    daysInMonth: new Date(y, m, 0).getDate(),
    days,
    categories: Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .map(([n, amount], i) => ({
        name: n,
        amount,
        icon: getCategoryIcon(n),
        tint: CATEGORY_TINTS[n] || TINTS[i % TINTS.length],
      })),
  };
}

const BG = ["#16241b", "#1f3329", "#171d2e", "#22392e", "#16241b"];
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const buzz = () => typeof navigator !== "undefined" && navigator.vibrate?.(8);

function useCountUp(target, run, delay = 250, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) {
      setV(0);
      return;
    }
    let raf;
    const t0 = performance.now();
    const f = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / ms));
      setV(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [target, run, delay, ms]);
  return v;
}

export default function MonthRecap({
  data,
  transactions,
  month,
  amountOf,
  dateOf,
  categoryOf,
  currency = "BDT",
  onDismiss,
  onOpen,
  onClose,
  slideMs = 5500,
}) {
  const resolvedData = useMemo(() => {
    if (data) return data;
    if (Array.isArray(transactions) && transactions.length > 0) {
      const built = buildRecap(transactions, {
        month,
        amountOf,
        dateOf,
        categoryOf,
      });
      if (built && built.total > 0) return built;
    }
    return SAMPLE;
  }, [data, transactions, month, amountOf, dateOf, categoryOf]);

  const activeData = resolvedData || SAMPLE;
  const dismissId = activeData.monthKey || activeData.month || "October";

  const [gone, setGone] = useState(() => {
    try {
      return localStorage.getItem("spend-recap-dismissed") === dismissId;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      setGone(localStorage.getItem("spend-recap-dismissed") === dismissId);
    } catch {
      setGone(false);
    }
  }, [dismissId]);

  const [phase, setPhase] = useState("closed"); // closed | mount | open | closing
  const [rect, setRect] = useState(null);
  const [ready, setReady] = useState(false);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const cardRef = useRef(null),
    colRef = useRef(null),
    hold = useRef({ t: 0, held: false, y: 0 });

  const cats = activeData.categories || [];
  const dayEntries = Object.entries(activeData.days || {});
  const slides = [
    "total",
    ...(cats.length ? ["top", "rank"] : []),
    ...(dayEntries.length ? ["day"] : []),
    "end",
  ];
  const active = phase !== "closed";
  const delta =
    activeData.prevTotal > 0
      ? Math.round(
          ((activeData.total - activeData.prevTotal) / activeData.prevTotal) *
            100,
        )
      : null;
  const pill =
    delta !== null
      ? `${delta <= 0 ? "▾" : "▴"} ${Math.abs(delta)}% ${delta <= 0 ? "less" : "more"} than ${activeData.prevMonth}`
      : `${activeData.entries} ${activeData.entries === 1 ? "entry" : "entries"} · ${cats.length} ${cats.length === 1 ? "category" : "categories"}`;

  const cardNum = useCountUp(activeData.total, true, 100, 900);
  const heroNum = useCountUp(activeData.total, ready && slides[i] === "total");

  const measure = () => {
    if (!cardRef.current) return { top: 0, left: 0, width: 0, height: 0 };
    const r = cardRef.current.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };

  const open = () => {
    if (phase !== "closed") return;
    buzz();
    setRect(measure());
    setI(0);
    setPhase("mount");
    onOpen?.(activeData.month);
  };

  const close = () => {
    if (phase !== "open") return;
    buzz();
    setReady(false);
    setPaused(false);
    setRect(measure());
    setPhase("closing");
    onClose?.(activeData.month);
  };

  const go = (k) => {
    if (k >= slides.length) return close();
    setI(Math.max(0, k));
  };

  useEffect(() => {
    if (phase !== "mount") return;
    let b;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => setPhase("open"));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "open") {
      const t = setTimeout(() => setReady(true), 280);
      return () => clearTimeout(t);
    }
    if (phase === "closing") {
      const t = setTimeout(() => setPhase("closed"), 620);
      return () => clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  useEffect(() => {
    if (phase !== "open") return;
    const k = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [phase, i]);

  if (gone) return null;

  const down = (e) => {
    const h = hold.current;
    h.y = e.clientY;
    h.held = false;
    h.t = setTimeout(() => {
      h.held = true;
      setPaused(true);
    }, 220);
  };

  const cancel = () => {
    clearTimeout(hold.current.t);
    setPaused(false);
  };

  const up = (e) => {
    const h = hold.current;
    cancel();
    if (e.target.closest("button")) return;
    if (e.clientY - h.y > 110) return close();
    if (h.held) {
      h.held = false;
      return;
    }
    const r = colRef.current.getBoundingClientRect();
    buzz();
    go(e.clientX - r.left < r.width * 0.3 ? i - 1 : i + 1);
  };

  const s = slides[i];
  const peak = [...dayEntries].sort((a, b) => b[1] - a[1])[0] || [1, 1];
  const peakAmount = Number(peak[1]) || 1;
  const pct =
    cats.length && activeData.total > 0
      ? Math.round((cats[0].amount / activeData.total) * 100)
      : 0;
  const maxCatAmount = Number(cats[0]?.amount) || 1;
  const up_ = (c, d, extra) => ({
    className: `${c} mr-up`,
    style: { "--d": d, ...extra },
  });

  const storyStyle =
    phase === "open"
      ? {
          top: 0,
          left: 0,
          width: "100vw",
          height: "100dvh",
          borderRadius: 0,
          background: BG[i % BG.length],
        }
      : { ...rect, borderRadius: 28, background: BG[0] };

  return (
    <>
      <style>{CSS}</style>

      <div ref={cardRef} className="mr-card" onClick={open}>
        <div className="mr-tile">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="#fff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="7" y1="17" x2="17" y2="7" />
            <polyline points="7 7 17 7 17 17" />
          </svg>
        </div>
        <button
          type="button"
          className="mr-x"
          aria-label={`Dismiss ${activeData.month} recap`}
          onClick={(e) => {
            e.stopPropagation();
            setGone(true);
            try {
              localStorage.setItem("spend-recap-dismissed", dismissId);
            } catch {}
            onDismiss?.(activeData.month);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <small>Spent in {activeData.month}</small>
        <b>
          <span className="mr-card-cu">{currency}</span>
          {fmt(cardNum)}
        </b>
        <div className="mr-hrow">
          {pill && <span className="mr-pill">{pill}</span>}
          <button
            type="button"
            className="mr-vbtn"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            View recap
          </button>
        </div>
      </div>

      {active &&
        createPortal(
          <div
            className={`mr-story${ready ? " mr-in" : ""}${paused ? " mr-hold" : ""}`}
            style={{ ...storyStyle, "--ms": `${slideMs}ms` }}
            role="dialog"
            aria-modal="true"
            aria-label={`${activeData.month} recap`}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={cancel}
          >
            <div className="mr-layer">
              <div className="mr-col" ref={colRef}>
                <div className="mr-bars">
                  {slides.map((n, k) => (
                    <div className="mr-bar" key={n}>
                      <i
                        className={k < i ? "d" : k === i && ready ? "on" : ""}
                        onAnimationEnd={k === i ? () => go(i + 1) : undefined}
                      />
                    </div>
                  ))}
                </div>
                <div className="mr-top">
                  <div className="mr-tile">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="7" y1="17" x2="17" y2="7" />
                      <polyline points="7 7 17 7 17 17" />
                    </svg>
                  </div>
                  <span>{activeData.month} recap</span>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close recap"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {ready && (
                  <section className="mr-sl" key={s}>
                    {s === "total" && (
                      <>
                        <p {...up_("mr-k", 0)}>Spent in {activeData.month}</p>
                        <p {...up_("mr-big", 1)}>
                          <span className="mr-cu">{currency}</span>
                          {fmt(heroNum)}
                        </p>
                        {pill && (
                          <span
                            className="mr-pill mr-up"
                            style={{
                              "--d": 2,
                              alignSelf: "flex-start",
                              marginTop: 18,
                            }}
                          >
                            {pill}
                          </span>
                        )}
                        <p {...up_("mr-sub", 3)}>
                          {activeData.entries}{" "}
                          {activeData.entries === 1 ? "entry" : "entries"}{" "}
                          across {cats.length}{" "}
                          {cats.length === 1 ? "category" : "categories"}.
                        </p>
                      </>
                    )}

                    {s === "top" && cats.length > 0 && (
                      <>
                        <div {...up_("mr-ring", 0)}>
                          <svg width="176" height="176" viewBox="0 0 160 160">
                            <circle
                              cx="80"
                              cy="80"
                              r="70"
                              fill="none"
                              stroke="#ffffff1f"
                              strokeWidth="12"
                            />
                            <circle
                              className="mr-arc"
                              style={{ "--o": 440 * (1 - pct / 100) }}
                              cx="80"
                              cy="80"
                              r="70"
                              fill="none"
                              stroke="#d6e48c"
                              strokeWidth="12"
                              strokeLinecap="round"
                            />
                          </svg>
                          <div
                            className="mr-pt"
                            style={{ background: cats[0].tint }}
                          >
                            {cats[0].icon ? (
                              <img
                                src={cats[0].icon}
                                alt={cats[0].name}
                                draggable="false"
                              />
                            ) : (
                              cats[0].emoji || "✨"
                            )}
                          </div>
                        </div>
                        <p {...up_("mr-k", 1)}>Your top category</p>
                        <p {...up_("mr-big", 2)}>{cats[0].name}</p>
                        <p {...up_("mr-sub", 3)}>
                          {pct}% of what you spent went here.
                        </p>
                      </>
                    )}

                    {s === "rank" && (
                      <>
                        <p {...up_("mr-k", 0)}>Where it went</p>
                        <div className="mr-rank">
                          {cats.slice(0, 5).map((c, k) => (
                            <div
                              className="mr-ri"
                              key={c.name}
                              style={{ "--i": k }}
                            >
                              <div
                                className="mr-pt2"
                                style={{ background: c.tint }}
                              >
                                {c.icon ? (
                                  <img
                                    src={c.icon}
                                    alt={c.name}
                                    draggable="false"
                                  />
                                ) : (
                                  c.emoji || "✨"
                                )}
                              </div>
                              <div className="mr-rb">
                                <div className="mr-rt">
                                  <span>
                                    {c.name}
                                    <em>
                                      {Math.round(
                                        (c.amount / activeData.total) * 100,
                                      )}
                                      %
                                    </em>
                                  </span>
                                  <b>
                                    {currency} {fmt(c.amount)}
                                  </b>
                                </div>
                                <div className="mr-tr">
                                  <i
                                    style={{
                                      "--w": `${Math.min(100, (c.amount / maxCatAmount) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {s === "day" && (
                      <>
                        <div {...up_("mr-chart", 0)}>
                          {Array.from(
                            { length: activeData.daysInMonth },
                            (_, k) => {
                              const v = activeData.days[k + 1] || 0;
                              return (
                                <div
                                  key={k}
                                  className={`mr-c${v === peak[1] ? " hit" : v ? " on2" : ""}`}
                                  style={{
                                    "--i": k,
                                    "--h": `${v ? Math.max(10, (v / peakAmount) * 100) : 7}%`,
                                  }}
                                />
                              );
                            },
                          )}
                        </div>
                        <p {...up_("mr-k", 1)}>Your busiest day</p>
                        <p
                          {...up_("mr-big", 2, {
                            fontSize: "clamp(44px,15vw,64px)",
                          })}
                        >
                          {peak[0]} {activeData.month.slice(0, 3)}
                        </p>
                        <p {...up_("mr-sub", 3)}>
                          {currency} {fmt(peak[1])}, the most you spent in a
                          single day.
                        </p>
                      </>
                    )}

                    {s === "end" && (
                      <>
                        <p {...up_("mr-k", 0)}>That’s {activeData.month}.</p>
                        <p
                          {...up_("mr-big", 1, {
                            fontSize: "clamp(52px,17vw,76px)",
                          })}
                        >
                          On to
                          <br />
                          {activeData.nextMonth}.
                        </p>
                        <button
                          type="button"
                          className="mr-cta mr-up"
                          style={{ "--d": 3 }}
                          onClick={close}
                        >
                          Back to Spend
                        </button>
                      </>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const CSS = `
.mr-card,
.mr-story {
  --mr-forest: #16241b;
  --mr-sage: #3f6e56;
  --mr-mist: #9bb0a3;
  --mr-lime: #d6e48c;
  --mr-peach: #fbe3da;
  --mr-ease: cubic-bezier(0.2, 0.85, 0.2, 1);
  font-family: inherit;
}
.mr-card {
  position: relative;
  background: var(--mr-forest);
  color: #eef5f0;
  border-radius: 28px;
  padding: 24px 22px 24px;
  cursor: pointer;
  transition: transform 0.25s var(--mr-ease);
  margin-bottom: 16px;
  text-align: left;
}
.mr-card:active {
  transform: scale(0.98);
}
.mr-card .mr-tile,
.mr-story .mr-tile {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--mr-sage);
  border: 1px solid rgba(255, 255, 255, 0.22);
  display: grid;
  place-items: center;
  color: #fff;
  flex: none;
}
.mr-card .mr-tile svg {
  display: block;
  width: 20px;
  height: 20px;
  stroke: #fff;
  stroke-width: 2.6;
}
.mr-card button.mr-x {
  position: absolute;
  top: 22px;
  right: 22px;
  width: 36px;
  height: 36px;
  border: 0;
  background: none;
  color: var(--mr-mist);
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: 50%;
  padding: 0;
  z-index: 2;
  transition: background-color 150ms ease, color 150ms ease;
}
.mr-card button.mr-x svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  stroke-width: 2.2;
}
.mr-card button.mr-x:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.mr-card small {
  display: block;
  margin-top: 26px;
  font-size: 17px;
  font-weight: 600;
  color: var(--mr-mist);
  letter-spacing: -0.01em;
}
.mr-card b {
  display: block;
  font-size: clamp(44px, 13vw, 64px);
  line-height: 1.05;
  letter-spacing: -0.04em;
  font-weight: 800;
  color: #fff;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.mr-card .mr-card-cu {
  margin-right: 0.08em;
}
.mr-hrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 20px;
}
.mr-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(214, 228, 140, 0.16);
  color: var(--mr-lime);
  border-radius: 99px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.mr-card button.mr-vbtn {
  margin-left: auto;
  border: 0;
  background: #eef5f0;
  color: var(--mr-forest);
  border-radius: 99px;
  padding: 10px 18px;
  font: inherit;
  font-size: 14px;
  font-weight: 750;
  cursor: pointer;
  letter-spacing: -0.01em;
  text-align: center;
  transition: opacity 150ms ease, transform 150ms ease;
}
.mr-card button.mr-vbtn:hover {
  opacity: 0.92;
}
.mr-story {
  position: fixed;
  z-index: 9999;
  overflow: hidden;
  color: #eef5f0;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    top 0.6s var(--mr-ease),
    left 0.6s var(--mr-ease),
    width 0.6s var(--mr-ease),
    height 0.6s var(--mr-ease),
    border-radius 0.6s var(--mr-ease),
    background 0.7s;
}
.mr-layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.35s 0.15s;
}
.mr-in .mr-layer {
  opacity: 1;
}
.mr-story:not(.mr-in) .mr-layer {
  transition-delay: 0s;
  transition-duration: 0.15s;
}
.mr-col {
  position: relative;
  height: 100%;
  max-width: 480px;
  margin: 0 auto;
}
.mr-bars {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top, 0px));
  left: 18px;
  right: 18px;
  display: flex;
  gap: 5px;
  z-index: 3;
}
.mr-bar {
  flex: 1;
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}
.mr-bar i {
  display: block;
  height: 100%;
  width: 0;
  background: #fff;
}
.mr-bar i.d {
  width: 100%;
}
.mr-bar i.on {
  animation: mr-fill var(--ms) linear forwards;
}
@keyframes mr-fill {
  to {
    width: 100%;
  }
}
.mr-hold .mr-bar i.on {
  animation-play-state: paused;
}
.mr-top {
  position: absolute;
  top: calc(26px + env(safe-area-inset-top, 0px));
  left: 20px;
  right: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 3;
  font-weight: 700;
  font-size: 15px;
  color: var(--mr-mist);
}
.mr-story .mr-top .mr-tile {
  width: 36px;
  height: 36px;
  border-radius: 10px;
}
.mr-story .mr-top .mr-tile svg {
  display: block;
  width: 16px;
  height: 16px;
  stroke: #fff;
  stroke-width: 2.6;
}
.mr-story .mr-top button {
  margin-left: auto;
  width: 40px;
  height: 40px;
  border: 0;
  background: none;
  color: var(--mr-mist);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}
.mr-story .mr-top button svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  stroke-width: 2;
}
.mr-sl {
  position: absolute;
  inset: 0;
  padding: 0 24px calc(14% + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  text-align: left;
}
.mr-k {
  font-size: 20px;
  font-weight: 600;
  color: var(--mr-mist);
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}
.mr-big {
  font-size: clamp(56px, 18vw, 76px);
  line-height: 1;
  letter-spacing: -0.05em;
  font-weight: 800;
  margin: 0;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.mr-cu {
  font-size: 0.45em;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--mr-mist);
  margin-right: 0.18em;
  vertical-align: 0.1em;
}
.mr-sub {
  font-size: 18px;
  line-height: 1.4;
  color: var(--mr-mist);
  margin: 18px 0 0;
  font-weight: 500;
  max-width: 32ch;
}
.mr-up {
  animation: mr-up 0.8s var(--mr-ease) both;
  animation-delay: calc(var(--d, 0) * 110ms + 0.1s);
}
@keyframes mr-up {
  from {
    opacity: 0;
    transform: translateY(26px);
  }
}
.mr-ring {
  position: relative;
  width: 176px;
  height: 176px;
  margin-bottom: 30px;
}
.mr-ring svg {
  width: 176px;
  height: 176px;
  transform: rotate(-90deg);
}
.mr-arc {
  stroke-dasharray: 440;
  stroke-dashoffset: 440;
  animation: mr-ring 1.3s 0.35s var(--mr-ease) forwards;
}
@keyframes mr-ring {
  to {
    stroke-dashoffset: var(--o);
  }
}
.mr-pt {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 84px;
  height: 84px;
  border-radius: 24px;
  display: grid;
  place-items: center;
  font-size: 40px;
}
.mr-pt img {
  width: 46px;
  height: 46px;
  object-fit: contain;
  display: block;
}
.mr-rank {
  margin-top: 18px;
}
.mr-ri {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
  animation: mr-up 0.8s var(--mr-ease) both;
  animation-delay: calc(var(--i) * 120ms + 0.15s);
}
.mr-pt2 {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 22px;
}
.mr-pt2 img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  display: block;
}
.mr-rb {
  flex: 1;
}
.mr-rt {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 8px;
}
.mr-rt em {
  font-style: normal;
  color: var(--mr-mist);
  font-weight: 600;
  margin-left: 6px;
}
.mr-tr {
  height: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.mr-tr i {
  display: block;
  height: 100%;
  width: 0;
  border-radius: 8px;
  background: #7fae96;
  animation: mr-wd 1s var(--mr-ease) forwards;
  animation-delay: calc(var(--i, 0) * 120ms + 0.35s);
}
.mr-ri:first-child .mr-tr i {
  background: var(--mr-lime);
}
@keyframes mr-wd {
  to {
    width: var(--w);
  }
}
.mr-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 170px;
  margin-bottom: 28px;
}
.mr-c {
  flex: 1;
  height: 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  animation: mr-grow 0.9s var(--mr-ease) forwards;
  animation-delay: calc(var(--i) * 22ms + 0.2s);
}
.mr-c.on2 {
  background: rgba(255, 255, 255, 0.35);
}
.mr-c.hit {
  background: var(--mr-lime);
}
@keyframes mr-grow {
  to {
    height: var(--h);
  }
}
.mr-story button.mr-cta {
  margin-top: 30px;
  align-self: flex-start;
  border: 0;
  border-radius: 99px;
  background: #eef5f0;
  color: var(--mr-forest);
  font: inherit;
  font-weight: 700;
  font-size: 16px;
  padding: 15px 26px;
  cursor: pointer;
  text-align: center;
}
.mr-card button:focus-visible,
.mr-story button:focus-visible {
  outline: 2px solid var(--mr-lime);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .mr-story,
  .mr-card {
    transition-duration: 0.01s;
  }
}
`;
