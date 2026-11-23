import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import "./WelcomeFlow.css";

const SLIDE_COUNT = 4;
const SPLASH_DURATION_MS = 2100;
const SPLASH_SLIDE_DELAY_MS = 350;
const SWIPE_THRESHOLD_PX = 50;

const DONUT_CIRCUMFERENCE = 2 * Math.PI * 40;
const DONUT_VALUES = [47, 25, 21, 5, 2];
const DONUT_COLORS = ["#e8793a", "#b5305a", "#8b5cf6", "#64748b", "#e0334c"];

export default function WelcomeFlow({ onDone, theme, exiting = false }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [splashRun, setSplashRun] = useState(!exiting);
  const [splashGone, setSplashGone] = useState(exiting);
  const [slidesReady, setSlidesReady] = useState(exiting);
  const [amountShown, setAmountShown] = useState(false);
  const [localExiting, setLocalExiting] = useState(false);
  const isExiting = exiting || localExiting;

  const pointerStartXRef = useRef(null);
  const pointerIdRef = useRef(null);
  const touchStartXRef = useRef(null);
  const splashGoneRef = useRef(exiting);
  const finishedRef = useRef(false);
  const slideIndexRef = useRef(0);

  useEffect(() => {
    splashGoneRef.current = splashGone;
  }, [splashGone]);

  useEffect(() => {
    slideIndexRef.current = slideIndex;
  }, [slideIndex]);

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      document.documentElement.dataset.platform !== "android"
    ) {
      return undefined;
    }
    const appPlugin = CapacitorApp || window.Capacitor?.Plugins?.App;
    if (!appPlugin?.addListener) return undefined;
    let listener = null;
    try {
      listener = appPlugin.addListener("backButton", () => {
        if (slideIndexRef.current > 0) {
          setSlideIndex((prev) => Math.max(0, prev - 1));
          setSlidesReady(true);
        } else if (typeof appPlugin.minimizeApp === "function") {
          appPlugin.minimizeApp().catch(() => {});
        }
      });
    } catch {}
    return () => {
      Promise.resolve(listener)
        .then((h) => h?.remove?.())
        .catch(() => {});
    };
  }, []);

  const donutSegments = useMemo(() => {
    let offset = 0;
    return DONUT_VALUES.map((pct, k) => {
      const length = (DONUT_CIRCUMFERENCE * pct) / 100 - 2;
      const dashOffset = -offset;
      offset += (DONUT_CIRCUMFERENCE * pct) / 100;
      return {
        key: k,
        stroke: DONUT_COLORS[k],
        length: length.toFixed(1),
        dashOffset: dashOffset.toFixed(1),
      };
    });
  }, []);

  const bars = useMemo(
    () =>
      Array.from({ length: 26 }, (_, k) => ({
        key: k,
        filled: k < 8,
      })),
    [],
  );

  const go = useCallback((nextIndex) => {
    const clamped = Math.max(0, Math.min(SLIDE_COUNT - 1, nextIndex));
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".welcome-flow .slide")
    ) {
      document.activeElement.blur();
    }
    setSlideIndex(clamped);
    setSlidesReady(true);
  }, []);

  const finish = useCallback(
    (mode = "sign-in") => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(".welcome-flow")
      ) {
        document.activeElement.blur();
      }
      setLocalExiting(true);
      onDone?.(mode);
    },
    [onDone],
  );

  useEffect(() => {
    if (
      isExiting &&
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".welcome-flow")
    ) {
      document.activeElement.blur();
    }
  }, [isExiting]);

  useLayoutEffect(() => {
    const restoreAppChrome = () => {
      if (typeof document === "undefined") return;
      const root = document.documentElement;
      delete root.dataset.splashActive;
      const isDark = root.dataset.theme === "dark";
      const color = isDark ? "#08080c" : "#f4f3ee";
      root.style.colorScheme = isDark ? "dark" : "light";
      root.style.backgroundColor = color;
      if (document.body) {
        document.body.style.backgroundColor = color;
      }
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute("content", color));
    };

    if (typeof document !== "undefined") {
      document.getElementById("initial-splash")?.remove();
    }
    if (exiting || finishedRef.current) {
      restoreAppChrome();
      return undefined;
    }

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.splashActive = "1";
      root.style.colorScheme = "dark";
      root.style.backgroundColor = "#161d2b";
      if (document.body) {
        document.body.style.backgroundColor = "#161d2b";
      }
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute("content", "#161d2b"));
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    setSlideIndex(0);
    setSlidesReady(reducedMotion);
    setSplashGone(false);
    splashGoneRef.current = false;
    setSplashRun(true);

    let slideTimer = null;
    const splashTimer = window.setTimeout(() => {
      splashGoneRef.current = true;
      setSplashGone(true);
      restoreAppChrome();
      if (reducedMotion) {
        setSlidesReady(true);
      } else {
        slideTimer = window.setTimeout(() => {
          setSlidesReady(true);
        }, SPLASH_SLIDE_DELAY_MS);
      }
    }, SPLASH_DURATION_MS);

    return () => {
      window.clearTimeout(splashTimer);
      if (slideTimer) window.clearTimeout(slideTimer);
      restoreAppChrome();
    };
  }, [exiting]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!splashGoneRef.current || finishedRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSlideIndex((current) => Math.min(SLIDE_COUNT - 1, current + 1));
        setSlidesReady(true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSlideIndex((current) => Math.max(0, current - 1));
        setSlidesReady(true);
      }
    };

    const handlePointerUp = (event) => {
      if (
        pointerStartXRef.current === null ||
        (pointerIdRef.current !== null &&
          event.pointerId !== pointerIdRef.current)
      ) {
        return;
      }
      const deltaX = event.clientX - pointerStartXRef.current;
      pointerStartXRef.current = null;
      pointerIdRef.current = null;
      if (!splashGoneRef.current || finishedRef.current) return;
      if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) {
        setSlideIndex((current) =>
          Math.max(
            0,
            Math.min(SLIDE_COUNT - 1, current + (deltaX < 0 ? 1 : -1)),
          ),
        );
        setSlidesReady(true);
      }
    };

    const handlePointerCancel = () => {
      pointerStartXRef.current = null;
      pointerIdRef.current = null;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, []);

  const handleTrackPointerDown = (event) => {
    if (!splashGone) return;
    if (event.pointerType === "touch") return;
    if (event.target instanceof Element && event.target.closest("button"))
      return;
    pointerStartXRef.current = event.clientX;
    pointerIdRef.current = event.pointerId;
  };

  const handleTrackTouchStart = (event) => {
    if (!splashGone) return;
    if (event.target instanceof Element && event.target.closest("button"))
      return;
    if (event.touches?.length === 1) {
      touchStartXRef.current = event.touches[0].clientX;
    }
  };

  const handleTrackTouchEnd = (event) => {
    if (touchStartXRef.current === null) return;
    const touch = event.changedTouches?.[0];
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (!touch || !splashGone) return;
    const deltaX = touch.clientX - startX;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) {
      go(slideIndex + (deltaX < 0 ? 1 : -1));
    }
  };

  const handleTrackTouchCancel = () => {
    touchStartXRef.current = null;
  };

  const isLastSlide = slideIndex === SLIDE_COUNT - 1;

  return (
    <div
      className={`welcome-flow${isExiting ? " is-exiting" : ""}`}
      data-theme={theme === "dark" || theme === "light" ? theme : undefined}
      role="region"
      aria-label="Welcome to Spend"
      inert={isExiting ? true : undefined}
    >
      <div className="phone">
        <section
          className={`splash${splashRun ? " run" : ""}${splashGone ? " gone" : ""}`}
          id="splash"
          aria-label="Spend It"
          aria-hidden={splashGone ? "true" : undefined}
        >
          <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="16" fill="#d5f45b" />
            <path
              pathLength="1"
              d="M22 43 43 22M28 22h15v15"
              fill="none"
              stroke="#161d2b"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="4.5"
            />
          </svg>
          <div className="word">Spend It</div>
        </section>

        <div className="top">
          <div className="seg" id="seg" aria-hidden="true">
            {Array.from({ length: SLIDE_COUNT }, (_, k) => (
              <i
                key={k}
                className={
                  k < slideIndex ? "done" : k === slideIndex ? "cur" : ""
                }
              />
            ))}
          </div>
        </div>

        <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="#161d2b" />
          <path
            d="M22 43 43 22M28 22h15v15"
            fill="none"
            stroke="#d5f45b"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4.5"
          />
        </svg>

        <div
          className="track"
          id="track"
          style={{ transform: `translateX(${-slideIndex * 100}%)` }}
          onPointerDown={handleTrackPointerDown}
          onTouchStart={handleTrackTouchStart}
          onTouchEnd={handleTrackTouchEnd}
          onTouchCancel={handleTrackTouchCancel}
        >
          <article
            className={`slide${slidesReady && slideIndex === 0 ? " on" : ""}`}
            aria-label="1 of 4"
            inert={!slidesReady || slideIndex !== 0 ? true : undefined}
          >
            <h2>See what’s left, not just what you spent</h2>
            <div className="art">
              <div className="navy rise">
                <div className="row">
                  <span className="dim">Left this month</span>
                  <span className="pill">↓ 12% vs last month</span>
                </div>
                <div className="big">৳ 8,420</div>
                <div className="bars" id="bars">
                  {bars.map((bar) => (
                    <b
                      key={bar.key}
                      className={bar.filled ? "f" : ""}
                      style={{ "--i": bar.key }}
                    />
                  ))}
                </div>
                <div className="pace">
                  <i />৳ 420/day safe pace<span>19 days left</span>
                </div>
              </div>
            </div>
          </article>

          <article
            className={`slide${slidesReady && slideIndex === 1 ? " on" : ""}`}
            aria-label="2 of 4"
            inert={!slidesReady || slideIndex !== 1 ? true : undefined}
          >
            <h2>Know where every taka went</h2>
            <div className="art">
              <div className="card dn rise">
                <div style={{ position: "relative", flex: "none" }}>
                  <svg viewBox="0 0 100 100" id="donut" aria-hidden="true">
                    {donutSegments.map((seg) => (
                      <circle
                        key={seg.key}
                        cx="50"
                        cy="50"
                        r="40"
                        stroke={seg.stroke}
                        style={{
                          "--l": seg.length,
                          "--k": seg.key,
                          strokeDashoffset: seg.dashOffset,
                        }}
                      />
                    ))}
                  </svg>
                  <div className="tot">
                    Total<b>৳ 4,928</b>
                  </div>
                </div>
                <div className="leg">
                  <p>
                    <i style={{ background: "#e8793a" }} />
                    Food<b>47%</b>
                  </p>
                  <p>
                    <i style={{ background: "#b5305a" }} />
                    Savings<b>25%</b>
                  </p>
                  <p>
                    <i style={{ background: "#8b5cf6" }} />
                    Shopping<b>21%</b>
                  </p>
                  <p>
                    <i style={{ background: "#64748b" }} />
                    Other<b>7%</b>
                  </p>
                </div>
              </div>
            </div>
          </article>

          <article
            className={`slide${slidesReady && slideIndex === 2 ? " on" : ""}`}
            aria-label="3 of 4"
            inert={!slidesReady || slideIndex !== 2 ? true : undefined}
          >
            <h2>Never get surprised by a bill</h2>
            <div className="art">
              <div className="card bill hot rise" style={{ "--d": 0 }}>
                <span className="ic">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#161d2b"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 3l4 4-4 4M3 11V9a2 2 0 012-2h16M7 21l-4-4 4-4M21 13v2a2 2 0 01-2 2H3" />
                  </svg>
                </span>
                <div>
                  Rent<small>Due 15 Nov</small>
                </div>
                <span className="pill">in 3 days</span>
              </div>
              <div className="card bill rise" style={{ "--d": 140 }}>
                <span className="ic">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                    <line x1="12" y1="20" x2="12.01" y2="20" />
                  </svg>
                </span>
                <div>
                  Internet<small>Due 20 Nov</small>
                </div>
                <span className="pill">in 8 days</span>
              </div>
              <div className="card bill rise" style={{ "--d": 280 }}>
                <span className="ic">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6.5 6.5 11 11" />
                    <path d="m21 21-1-1" />
                    <path d="m3 3 1 1" />
                    <path d="m18 22 4-4" />
                    <path d="m2 6 4-4" />
                    <path d="m3 10 7-7" />
                    <path d="m14 21 7-7" />
                  </svg>
                </span>
                <div>
                  Gym<small>Due 1 Dec</small>
                </div>
                <span className="pill">in 19 days</span>
              </div>
            </div>
          </article>

          <article
            className={`slide${slidesReady && slideIndex === 3 ? " on" : ""}`}
            aria-label="4 of 4"
            inert={!slidesReady || slideIndex !== 3 ? true : undefined}
          >
            <h2>Your balance stays private until you say so</h2>
            <div className="art">
              <div className="navy rise">
                <div className="row">
                  <span className="dim">Spent this month</span>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <div
                    className="big"
                    id="amt"
                    style={{ margin: 0 }}
                    aria-live="polite"
                  >
                    {amountShown ? "৳ 4,928" : "৳ ••••"}
                  </div>
                  <button
                    type="button"
                    className="eye"
                    id="eye"
                    aria-pressed={amountShown ? "true" : "false"}
                    aria-label={amountShown ? "Hide amount" : "Show amount"}
                    tabIndex={slideIndex === 3 ? 0 : -1}
                    onClick={() => setAmountShown((prev) => !prev)}
                  >
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                      <circle cx="12" cy="12" r="3" />
                      <path className="sl" d="M4 20 20 4" />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="hint rise" style={{ "--d": 200 }}>
                Tap the eye to show or hide your amounts
              </p>
            </div>
          </article>
        </div>

        <div className="foot" inert={!splashGone ? true : undefined}>
          <button
            type="button"
            className="next"
            id="next"
            disabled={!splashGone}
            onClick={() =>
              isLastSlide ? finish("sign-in") : go(slideIndex + 1)
            }
          >
            {isLastSlide ? "Get started" : "Next"}
          </button>
          <button
            type="button"
            className="skip"
            id="skip"
            disabled={!splashGone}
            onClick={() => (isLastSlide ? finish("skip") : finish("sign-in"))}
          >
            {isLastSlide ? "Continue without account" : "Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}
