import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * SpendSplash — opening animation with zero-flicker static splash handoff.
 *
 * Syncs seamlessly with the inline `#initial-splash` element in `index.html`:
 *  1. `#initial-splash` paints on the very first browser frame (before any JS
 *     downloads or executes) and begins the opening animation via CSS keyframes.
 *  2. When React mounts `SpendSplash`, it reads the exact sub-millisecond
 *     `currentTime` from `#initial-splash`'s running CSS animation, starts its
 *     compositor animations at that exact timestamp underneath `#initial-splash`,
 *     and fades `#initial-splash` out before removing it from the DOM.
 *  3. Once the intro hold completes (and the app underneath has mounted),
 *     `SpendSplash` fades out and restores the document theme background.
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

function syncThemeColorMeta() {
  if (typeof document === "undefined") return;
  const isDark = document.documentElement.dataset.theme === "dark";
  const color = isDark ? "#0e1411" : "#f4f3ee";
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", color));
}

function handoffStaticSplash(immediate = false) {
  if (typeof document === "undefined") return null;
  const staticSplash = document.getElementById("initial-splash");
  if (!staticSplash) return null;

  let animTime = null;
  try {
    const tileAnim = staticSplash
      .querySelector(".sp-tile")
      ?.getAnimations?.()[0];
    if (tileAnim && typeof tileAnim.currentTime === "number") {
      animTime = tileAnim.currentTime;
    }
  } catch {
    // Fallback to performance.now() below
  }

  if (immediate) {
    staticSplash.remove();
    return animTime;
  }

  if (!staticSplash.classList.contains("sp-handoff")) {
    staticSplash.classList.add("sp-handoff");
    window.setTimeout(() => {
      staticSplash.remove();
    }, 180);
  }
  return animTime;
}

export default function SpendSplash({
  onDone,
  canExit = true,
  once = false,
  storageKey = "spend-splash",
  fontFamily = '"Outfit", "Nunito Sans", ui-rounded, system-ui, sans-serif',
  fontUrl = "https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=swap",
}) {
  const rootRef = useRef(null);
  const firedSkip = useRef(false);
  const releaseFnRef = useRef(null);
  const pendingExitRef = useRef(false);

  // Always-latest props, deliberately NOT effect dependencies.
  const live = useRef({});
  live.current = { onDone, canExit, once, storageKey, fontFamily, fontUrl };

  const [skip] = useState(() => alreadySeen(once, storageKey));

  useEffect(() => {
    if (!skip || firedSkip.current) return;
    firedSkip.current = true;
    handoffStaticSplash(true);
    document.documentElement.style.backgroundColor = "";
    document.body.style.backgroundColor = "";
    syncThemeColorMeta();
    document.dispatchEvent(new CustomEvent("spend:splash-done"));
    live.current.onDone?.();
  }, [skip]);

  useEffect(() => {
    if (canExit && pendingExitRef.current && releaseFnRef.current) {
      pendingExitRef.current = false;
      releaseFnRef.current();
    }
  }, [canExit]);

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

    // Read currentTime from the inline `#initial-splash` CSS animation so React
    // continues from the exact sub-millisecond frame without restarting.
    const staticAnimTime = handoffStaticSplash(false);
    const now = performance.now();
    if (clock === null || now - lastCleanup > RESUME_WINDOW) {
      if (
        typeof staticAnimTime === "number" &&
        Number.isFinite(staticAnimTime) &&
        staticAnimTime >= 0
      ) {
        clock = now - staticAnimTime;
      } else {
        clock = 0; // Anchor to document navigation start when static splash was painted
      }
      releaseAt = null;
    }
    const sinceStart = () => Math.max(0, performance.now() - clock);
    const elapsed = sinceStart();

    // ---- helpers ----------------------------------------------------------
    const anims = [];
    const play = (el, keyframes, options, startAt = 0) => {
      const a = el.animate(keyframes, { fill: "both", ...options });
      if (startAt > 0) a.currentTime = startAt;
      anims.push(a);
      return a;
    };
    const intro = (el, kf, opts) => play(el, kf, opts, elapsed);

    // Font: inject once asynchronously after first paint, never block FCP.
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

    const restoreBg = () => {
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      syncThemeColorMeta();
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
          { transform: "scale3d(.07,.07,1)", easing: EASE.swell },
          { transform: "scale3d(.07,.07,1)", offset: 0.2, easing: EASE.pop },
          { transform: "scale3d(1,1,1)" },
        ],
        { duration: 800 },
      );
      intro(
        tile,
        [
          { borderRadius: "50%", easing: EASE.swell },
          { borderRadius: "50%", offset: 0.2, easing: EASE.pop },
          { borderRadius: "25%" },
        ],
        { duration: 800 },
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
          { delay, duration },
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
          },
        ),
      );
    }

    // ---- hold + exit ------------------------------------------------------
    const finish = () => {
      if (finished) return;
      finished = true;
      handoffStaticSplash(true);
      root.hidden = true;
      restoreBg();
      clock = null;
      releaseAt = null;
      try {
        if (live.current.once)
          sessionStorage.setItem(live.current.storageKey, "1");
      } catch {}
      document.dispatchEvent(new CustomEvent("spend:splash-done"));
      live.current.onDone?.();
    };

    const exit = () => {
      handoffStaticSplash(true);
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
        since,
      );
      const fade = play(
        root,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: d, easing: EASE.exit },
        since,
      );
      fade.onfinish = finish;
    };

    // Tap, click, Esc, Enter or Space skips the hold.
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ")
        requestRelease();
    };
    const unlisten = () => {
      root.removeEventListener("pointerdown", requestRelease);
      window.removeEventListener("keydown", onKey);
    };
    function executeRelease() {
      if (released || !alive) return;
      released = true;
      pendingExitRef.current = false;
      clearTimeout(holdTimer);
      unlisten();
      exit();
    }
    function requestRelease() {
      if (released || !alive) return;
      if (live.current.canExit === false) {
        pendingExitRef.current = true;
        return;
      }
      executeRelease();
    }
    releaseFnRef.current = executeRelease;

    if (releaseAt !== null) {
      // Remounted during the exit: continue it from where it was.
      released = true;
      exit();
    } else {
      root.addEventListener("pointerdown", requestRelease);
      window.addEventListener("keydown", onKey);
      const hold = reduce ? 900 : T.hold;
      holdTimer = setTimeout(requestRelease, Math.max(0, hold - elapsed));
    }

    return () => {
      alive = false;
      releaseFnRef.current = null;
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
  transform: scale3d(.07,.07,1);
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
