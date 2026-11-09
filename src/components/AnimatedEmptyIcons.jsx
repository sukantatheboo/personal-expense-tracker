import React from "react";
import "./AnimatedEmptyIcons.css";

/**
 * 1. Recurring — Calendar with orbiting sync arrows & sequential date pulse
 */
export function AnimatedRecurringIcon() {
  return (
    <div
      className="ico"
      style={{
        "--g1": "#a78bfa",
        "--g2": "#6d4aff",
        "--glow": "rgba(109,74,255,.55)",
      }}
    >
      <div className="tile">
        <svg className="g" viewBox="0 0 56 56" aria-hidden="true">
          <g
            className="orb o"
            style={{ transformOrigin: "28px 28px" }}
            opacity=".9"
          >
            <path
              className="sw"
              d="M5.45 19.79A24 24 0 0 1 46.39 12.57M45.96 7.6L46.4 12.6l-4.85-1.3"
            />
            <path
              className="sw"
              d="M50.55 36.21A24 24 0 0 1 9.61 43.43M10.04 48.4L9.6 43.4l4.85 1.3"
            />
          </g>
          <rect className="w" x="14" y="15" width="28" height="27" rx="6" />
          <path
            d="M14 21a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v2H14z"
            fill="#ffb020"
          />
          <rect className="w" x="21" y="11" width="3.4" height="8" rx="1.7" />
          <rect className="w" x="32.6" y="11" width="3.4" height="8" rx="1.7" />
          <circle
            className="dt f"
            style={{ "--i": 0 }}
            cx="21"
            cy="29"
            r="2.1"
          />
          <circle
            className="dt f"
            style={{ "--i": 1 }}
            cx="28"
            cy="29"
            r="2.1"
          />
          <circle
            className="dt f"
            style={{ "--i": 2 }}
            cx="35"
            cy="29"
            r="2.1"
          />
          <circle
            className="dt f"
            style={{ "--i": 3 }}
            cx="21"
            cy="36"
            r="2.1"
          />
          <circle
            className="dt hot f"
            style={{ "--i": 4 }}
            cx="28"
            cy="36"
            r="2.1"
          />
        </svg>
      </div>
    </div>
  );
}

/**
 * 2. Budget — Target bullseye with dart strike, shockwave ripples & spark burst
 */
export function AnimatedBudgetIcon() {
  return (
    <div
      className="ico"
      style={{
        "--g1": "#34d399",
        "--g2": "#059669",
        "--glow": "rgba(5,150,105,.55)",
        "--d": ".8s",
      }}
    >
      <div className="tile">
        <svg className="g" viewBox="0 0 56 56" aria-hidden="true">
          <g className="tg f">
            <circle cx="28" cy="28" r="22" fill="#fff" opacity=".25" />
            <circle cx="28" cy="28" r="15" fill="#fff" opacity=".45" />
            <circle cx="28" cy="28" r="8" fill="#fff" />
          </g>
          <circle className="rp f" cx="28" cy="28" r="4" />
          <circle
            className="rp f"
            cx="28"
            cy="28"
            r="4"
            style={{ animationDelay: ".22s" }}
          />
          <circle className="ctr f" cx="28" cy="28" r="3.6" />
          <circle
            className="sp"
            style={{ "--x": "-19px", "--y": "-9px" }}
            cx="28"
            cy="28"
            r="1.8"
          />
          <circle
            className="sp"
            style={{ "--x": "-14px", "--y": "14px" }}
            cx="28"
            cy="28"
            r="1.5"
          />
          <circle
            className="sp"
            style={{ "--x": "4px", "--y": "19px" }}
            cx="28"
            cy="28"
            r="1.8"
          />
          <circle
            className="sp"
            style={{ "--x": "18px", "--y": "8px" }}
            cx="28"
            cy="28"
            r="1.5"
          />
          <g className="dart">
            <path d="M29.5 26.5L46 10M42 14V8.5M42 14h5.5M38 18v-5.5M38 18h-5.5" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * 3. Transactions — Ledger card with staggered sliding rows & popping add badge
 */
export function AnimatedTransactionsIcon() {
  return (
    <div
      className="ico"
      style={{
        "--g1": "#60a5fa",
        "--g2": "#2563eb",
        "--glow": "rgba(37,99,235,.55)",
        "--d": "1.6s",
      }}
    >
      <div className="tile">
        <svg className="g" viewBox="0 0 56 56" aria-hidden="true">
          <rect className="w" x="9" y="7" width="32" height="42" rx="8" />
          <g className="rw" style={{ "--k": 0 }}>
            <circle cx="17" cy="17" r="3.4" fill="#ffb020" />
            <rect
              x="23"
              y="14.5"
              width="12"
              height="3.2"
              rx="1.6"
              fill="var(--g2)"
              opacity=".38"
            />
            <rect
              x="23"
              y="19.4"
              width="7"
              height="2.6"
              rx="1.3"
              fill="var(--g2)"
              opacity=".2"
            />
          </g>
          <g className="rw" style={{ "--k": 1 }}>
            <circle cx="17" cy="28" r="3.4" fill="#34d399" />
            <rect
              x="23"
              y="25.5"
              width="12"
              height="3.2"
              rx="1.6"
              fill="var(--g2)"
              opacity=".38"
            />
            <rect
              x="23"
              y="30.4"
              width="7"
              height="2.6"
              rx="1.3"
              fill="var(--g2)"
              opacity=".2"
            />
          </g>
          <g className="rw" style={{ "--k": 2 }}>
            <circle cx="17" cy="39" r="3.4" fill="#a78bfa" />
            <rect
              x="23"
              y="36.5"
              width="8"
              height="3.2"
              rx="1.6"
              fill="var(--g2)"
              opacity=".38"
            />
          </g>
          <g className="pop f">
            <circle
              cx="42"
              cy="42"
              r="9.5"
              fill="#22c58b"
              stroke="#fff"
              strokeWidth="2.5"
            />
            <g className="pl f">
              <path
                className="sw"
                strokeWidth="2.6"
                d="M42 37.5v9M37.5 42h9"
              />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * 4. Activity — Magnifying glass scanning over glowing activity rows
 */
export function AnimatedActivityIcon() {
  return (
    <div
      className="ico"
      style={{
        "--g1": "#ffb454",
        "--g2": "#ff6a2b",
        "--glow": "rgba(255,106,43,.55)",
        "--d": "2.4s",
      }}
    >
      <div className="tile">
        <svg className="g" viewBox="0 0 56 56" aria-hidden="true">
          <g>
            <circle
              className="sk"
              style={{ "--i": 0 }}
              cx="11"
              cy="14"
              r="2.4"
            />
            <rect
              className="sk"
              style={{ "--i": 0 }}
              x="17"
              y="12.3"
              width="26"
              height="3.4"
              rx="1.7"
            />
            <circle
              className="sk"
              style={{ "--i": 1 }}
              cx="11"
              cy="24"
              r="2.4"
            />
            <rect
              className="sk"
              style={{ "--i": 1 }}
              x="17"
              y="22.3"
              width="20"
              height="3.4"
              rx="1.7"
            />
            <circle
              className="sk"
              style={{ "--i": 2 }}
              cx="11"
              cy="34"
              r="2.4"
            />
            <rect
              className="sk"
              style={{ "--i": 2 }}
              x="17"
              y="32.3"
              width="24"
              height="3.4"
              rx="1.7"
            />
          </g>
          <g className="scan o" style={{ transformOrigin: "28px 28px" }}>
            <circle
              cx="24"
              cy="24"
              r="12.5"
              fill="rgba(255,255,255,.2)"
              stroke="#fff"
              strokeWidth="4.2"
            />
            <path className="sw" strokeWidth="6" d="M33.5 33.5L46 46" />
            <circle
              className="dash o sw"
              style={{ transformOrigin: "24px 24px" }}
              cx="24"
              cy="24"
              r="5.2"
              strokeWidth="2"
              strokeDasharray="2.4 3.4"
            />
            <path
              className="sw gl"
              strokeWidth="2.2"
              d="M16.5 22a8 8 0 0 1 4.8-5.4"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * 5. Expenses — Zigzag receipt printing lines with bouncing coin badge
 */
export function AnimatedExpensesIcon() {
  return (
    <div
      className="ico"
      style={{
        "--g1": "#ff7aa2",
        "--g2": "#f43f6e",
        "--glow": "rgba(244,63,110,.55)",
        "--d": "3.2s",
      }}
    >
      <div className="tile">
        <svg className="g" viewBox="0 0 56 56" aria-hidden="true">
          <g className="rc">
            <path
              className="w"
              d="M11 12a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v36l-3.5-2.75-3.5 2.75-3.5-2.75-3.5 2.75-3.5-2.75-3.5 2.75-3.5-2.75L11 48z"
            />
            <path
              className="ln"
              style={{ "--k": 0 }}
              pathLength="1"
              fill="none"
              stroke="var(--g2)"
              strokeOpacity=".4"
              strokeWidth="3.2"
              strokeLinecap="round"
              d="M17 17h16"
            />
            <path
              className="ln"
              style={{ "--k": 1 }}
              pathLength="1"
              fill="none"
              stroke="var(--g2)"
              strokeOpacity=".4"
              strokeWidth="3.2"
              strokeLinecap="round"
              d="M17 25h16"
            />
            <path
              className="ln"
              style={{ "--k": 2 }}
              pathLength="1"
              fill="none"
              stroke="var(--g2)"
              strokeOpacity=".4"
              strokeWidth="3.2"
              strokeLinecap="round"
              d="M17 33h9"
            />
          </g>
          <g className="drop f">
            <circle
              cx="42"
              cy="42"
              r="9.5"
              fill="#ffb020"
              stroke="#fff"
              strokeWidth="2.5"
            />
            <path
              className="sw"
              strokeWidth="2.8"
              d="M42 37.5v9M37.5 42h9"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
