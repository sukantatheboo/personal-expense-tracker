import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * SpendSplash — opening animation.
 *
 * What was wrong (measured from the screen recording):
 *  1. The effect re-ran while the intro was playing (new `onDone` identity on
 *     every parent render), so the whole sequence restarted from the dot —
 *     twice. Now: the effect runs once, props live in a ref, and the timeline
 *     is anchored to a module-level clock, so even a re-render or remount
 *     resumes mid-flight instead of restarting.
 *  2. The overlay was un-hidden inside useEffect, which runs AFTER first paint,
 *     so the lock screen flashed for a frame. Now: the overlay is opaque and
 *     visible in the very first commit, and animations are created in a layout
 *     effect (before paint).
 *  3. Letters animated `color` (main-thread repaint x10) on top of
 *     transform/opacity. Over a dark background, a plain opacity fade gives the
 *     same mist -> ink look with zero repaints.
 *
 * Only transform + opacity run on the compositor, so they stay smooth even when
 * the app underneath is busy mounting. (The tile's radius morph and the arrow
 * stroke are tiny and main-thread; they finish before the heavy work usually
 * lands, and are the only things that can stutter.)
 */

const EASE = {
  out: "cubic-bezier(.22,1,.36,1)",
  inOut: "cubic-bezier(.65,0,.35,1)",
  swell: "cubic-bezier(.2,.8,.3,1)",
  pop: "cubic-bezier(.34,1.3,.64,1)",
  exit: "cubic-bezier(.4,0,1,1)",
};

// ms from the start of the intro
const T = {
  shaft: 640,
  arms: 980,
  shift: 1340,
  letters: 1400,
  stagger: 60,
  hold: 2750,
  exit: 450,
};

const WORD = "Spend";
const RESUME_WINDOW = 250; // a remount within this window continues the run

// Module-level timeline so re-renders / remounts can never restart the intro.
let clock = null; // performance.now() at intro start
let releaseAt = null; // ms since clock when the exit began
let lastCleanup = 0;

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function alreadySeen(once, key) {
  if (!once) return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export default function SpendSplash({
  onDone,
  once = false,
  storageKey = "spend-splash",
  fontFamily = '"Outfit", "Nunito Sans", ui-rounded, system-ui, sans-serif',
  // Set to null/"" if you bundle the font yourself (recommended, see notes).
  fontUrl = "https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=swap",
}) {
  const rootRef = useRef(null);
  const firedSkip = useRef(false);

  // Always-latest props, deliberately NOT effect dependencies.
  const live = useRef({});
  live.current = { onDone, once, storageKey, fontFamily, fontUrl };

  const [skip] = useState(() => alreadySeen(once, storageKey));

  useEffect(() => {
    if (!skip || firedSkip.current) return;
    firedSkip.current = true;
    document.dispatchEvent(new CustomEvent("spend:splash-done"));
    live.current.onDone?.();
  }, [skip]);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || skip) return undefined;

    const $ = (s) => root.querySelector(s);
    const stage = $(".sp-stage");
    const lockup = $(".sp-lockup");
    const mark = $(".sp-mark");
    const tile = $(".sp-tile");
    const word = $(".sp-word");
    const shaft = $(".sp-shaft");
    const arms = root.querySelectorAll(".sp-arm");
    const letters = root.querySelectorAll(".sp-l");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- timeline anchor: resume instead of restart ----------------------
    const now = performance.now();
    if (clock === null || now - lastCleanup > RESUME_WINDOW) {
      clock = now;
      releaseAt = null;
    }
    const sinceStart = () => performance.now() - clock;
    const elapsed = sinceStart(); // 0 on a fresh start

    // ---- helpers ----------------------------------------------------------
    const anims = [];
    const play = (el, keyframes, options, startAt = 0) => {
      const a = el.animate(keyframes, { fill: "both", ...options });
      if (startAt > 0) a.currentTime = startAt;
      anims.push(a);
      return a;
    };
    const intro = (el, kf, opts) => play(el, kf, opts, elapsed);

    // Font: inject once, never block the first frame.
    const { fontUrl: fUrl, fontFamily: fFam } = live.current;
    if (fUrl && !document.querySelector("link[data-spend-splash-font]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fUrl;
      link.setAttribute("data-spend-splash-font", "");
      document.head.appendChild(link);
    }

    let alive = true;
    let finished = false;
    let released = false;
    let holdTimer;

    const prevHtmlBg = document.documentElement.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#0c130f";
    document.body.style.backgroundColor = "#0c130f";
    const restoreBg = () => {
      document.documentElement.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
    };

    // ---- intro ------------------------------------------------------------
    const gap = parseFloat(getComputedStyle(lockup).columnGap) || 0;
    const shiftOf = () => (word.offsetWidth + gap) / 2;
    const shiftFrames = (px) => [
      { transform: `translate3d(${px}px,0,0)` },
      { transform: "translate3d(0,0,0)" },
    ];

    if (reduce) {
      root.classList.add("sp-reduce");
      intro(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    } else {
      // 1. Dot pops in, then swells into the rounded tile (circle -> 25%).
      intro(
        tile,
        [
          { transform: "scale3d(0,0,1)", easing: EASE.swell },
          { transform: "scale3d(.07,.07,1)", offset: 0.2, easing: EASE.pop },
          { transform: "scale3d(1,1,1)" },
        ],
        { duration: 800 }
      );
      intro(
        tile,
        [
          { borderRadius: "50%", easing: EASE.swell },
          { borderRadius: "50%", offset: 0.2, easing: EASE.pop },
          { borderRadius: "25%" },
        ],
        { duration: 800 }
      );

      // 2. Arrow draws itself: shaft first, then the head opens from the tip.
      const draw = (path, delay, duration, easing) => {
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        intro(
          path,
          [
            { strokeDashoffset: len, opacity: 0, offset: 0 },
            { strokeDashoffset: len, opacity: 1, offset: 0.001, easing },
            { strokeDashoffset: 0, opacity: 1, offset: 1 },
          ],
          { delay, duration }
        );
      };
      draw(shaft, T.shaft, 400, EASE.inOut);
      arms.forEach((a) => draw(a, T.arms, 300, EASE.out));

      // 3. Tile slides left as the wordmark arrives; lockup ends centred.
      const shiftAnim = intro(mark, shiftFrames(shiftOf()), {
        delay: T.shift,
        duration: 720,
        easing: EASE.out,
      });
      // If the web font lands after we measured, re-aim the slide (no restart).
      if (document.fonts?.load) {
        document.fonts
          .load(`600 64px ${fFam}`)
          .then(() => {
            if (alive) shiftAnim.effect?.setKeyframes?.(shiftFrames(shiftOf()));
          })
          .catch(() => {});
      }

      // 4. Letters: transform + opacity only (compositor).
      letters.forEach((l, i) =>
        intro(
          l,
          [
            { opacity: 0, transform: "translate3d(-.16em,0,0)" },
            { opacity: 1, transform: "translate3d(0,0,0)" },
          ],
          {
            delay: T.letters + i * T.stagger,
            duration: 480,
            easing: EASE.out,
          }
        )
      );
    }

    // ---- hold + exit ------------------------------------------------------
    const finish = () => {
      if (finished) return;
      finished = true;
      restoreBg();
      root.hidden = true;
      clock = null;
      releaseAt = null;
      try {
        if (live.current.once) sessionStorage.setItem(live.current.storageKey, "1");
      } catch {}
      document.dispatchEvent(new CustomEvent("spend:splash-done"));
      live.current.onDone?.();
    };

    const exit = () => {
      restoreBg();
      if (releaseAt === null) releaseAt = sinceStart();
      const since = Math.max(0, sinceStart() - releaseAt);
      const d = reduce ? 200 : T.exit;
      root.style.pointerEvents = "none";
      play(
        stage,
        [
          { transform: "scale3d(1,1,1)" },
          { transform: reduce ? "scale3d(1,1,1)" : "scale3d(.94,.94,1)" },
        ],
        { duration: d, easing: EASE.exit },
        since
      );
      const fade = play(
        root,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: d, easing: EASE.exit },
        since
      );
      fade.onfinish = finish;
    };

    // Tap, click, Esc, Enter or Space skips the hold.
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") release();
    };
    const unlisten = () => {
      root.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", onKey);
    };
    function release() {
      if (released || !alive) return;
      released = true;
      clearTimeout(holdTimer);
      unlisten();
      exit();
    }

    if (releaseAt !== null) {
      // Remounted during the exit: continue it from where it was.
      released = true;
      exit();
    } else {
      root.addEventListener("pointerdown", release);
      window.addEventListener("keydown", onKey);
      const hold = reduce ? 900 : T.hold;
      holdTimer = setTimeout(release, Math.max(0, hold - elapsed));
    }

    return () => {
      alive = false;
      restoreBg();
      lastCleanup = performance.now();
      clearTimeout(holdTimer);
      unlisten();
      anims.forEach((a) => {
        a.onfinish = null;
        a.cancel();
      });
    };
  }, [skip]);

  if (skip) return null;

  return (
    <div
      ref={rootRef}
      className="sp-root"
      role="img"
      aria-label="Spend"
      style={{ "--sp-font": fontFamily }}
    >
      <style>{CSS}</style>
      <div className="sp-stage">
        <div className="sp-lockup">
          <div className="sp-mark">
            <div className="sp-tile">
              <svg className="sp-arrow" viewBox="0 0 100 100" aria-hidden="true">
                <path className="sp-shaft" d="M34 66L66 34" />
                <path className="sp-arm" d="M66 34H44" />
                <path className="sp-arm" d="M66 34V56" />
              </svg>
            </div>
          </div>
          <div className="sp-word" aria-hidden="true">
            {[...WORD].map((c, i) => (
              <span key={i} className="sp-l">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Colours / sizes measured from the recording of the real app.
const CSS = `
.sp-root {
  --sp-bg: #0c130f;
  --sp-green: #316c51;
  --sp-ink: #eaf4ed;
  --tile: min(96px, 26vw);
  --gap: 16px;
  position: fixed; inset: -2px; z-index: 2147483000;
  width: calc(100vw + 4px); height: calc(100dvh + 4px);
  box-shadow: 0 0 0 4px var(--sp-bg);
  display: grid; place-items: center;
  background: var(--sp-bg);
  font-family: var(--sp-font);
  -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none;
  touch-action: none; overscroll-behavior: contain;
}
.sp-root[hidden] { display: none; }
.sp-stage { display: grid; place-items: center; will-change: transform; }
.sp-lockup { display: flex; align-items: center; column-gap: var(--gap); }
.sp-mark { flex: none; width: var(--tile); height: var(--tile); will-change: transform; }
.sp-tile {
  width: 100%; height: 100%;
  background: var(--sp-green); border-radius: 25%;
  transform: scale3d(0,0,1);
  will-change: transform; backface-visibility: hidden;
}
.sp-tile svg { display: block; width: 100%; height: 100%; overflow: visible; }
.sp-arrow path {
  fill: none; stroke: #fff; stroke-width: 7.5;
  stroke-linecap: round; stroke-linejoin: round; opacity: 0;
}
.sp-word {
  display: flex; white-space: nowrap;
  font-size: calc(var(--tile) * .667); line-height: 1;
  font-weight: 600; letter-spacing: -.03em; color: var(--sp-ink);
}
.sp-l { display: inline-block; opacity: 0; will-change: transform, opacity; }
.sp-reduce .sp-tile { transform: none; }
.sp-reduce .sp-l, .sp-reduce .sp-arrow path { opacity: 1; }
`;
