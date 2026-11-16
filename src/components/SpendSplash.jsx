import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./SpendSplash.css";

/**
 * SpendSplash — redesigned opening animation matching favicon.svg,
 * with Lime (light) and Night (dark) themes.
 */

const T = {
  hold: 2750,
  reduceHold: 900,
  exit: 450,
  reduceExit: 200,
  fontWait: 700,
};

const EASE_EXIT = "cubic-bezier(.4,0,1,1)";
const RESUME_WINDOW = 250; // a remount within this window continues the run

// Module-level timeline so re-renders / remounts can never restart the intro.
let clock = null; // performance.now() when `play` started
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
  const color = isDark ? "#08080c" : "#f4f3ee";
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", color));
}

function handoffStaticSplash() {
  if (typeof document === "undefined") return;
  const staticSplash = document.getElementById("initial-splash");
  if (staticSplash) staticSplash.remove();
}

const fUrlBase = "https://fonts.googleapis.com/css2?family=";

function ensureAppFontsLoaded(fUrl) {
  if (typeof document === "undefined" || !fUrl) return;
  if (!document.querySelector("link[data-spend-splash-font]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fUrl;
    link.setAttribute("data-spend-splash-font", "");
    document.head.appendChild(link);
  }
}

export default function SpendSplash({
  onDone,
  canExit = true,
  once = false,
  storageKey = "spend-splash",
  fontFamily = '"Manrope", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontUrl = fUrlBase + "Manrope:wght@500;600;700;800&display=swap",
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
    ensureAppFontsLoaded(live.current.fontUrl);
    if (!skip || firedSkip.current) return;
    firedSkip.current = true;
    handoffStaticSplash();
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

    handoffStaticSplash();
    ensureAppFontsLoaded(live.current.fontUrl);

    const stage = root.querySelector(".sp-stage");
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const now = performance.now();
    const isResume = clock !== null && now - lastCleanup <= RESUME_WINDOW;
    if (!isResume) {
      clock = null;
      releaseAt = null;
    }

    const sinceStart = () =>
      clock === null ? 0 : Math.max(0, performance.now() - clock);

    let alive = true;
    let finished = false;
    let released = false;
    let holdTimer;
    const exitAnims = [];

    const restoreBg = () => {
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      syncThemeColorMeta();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
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
      restoreBg();
      if (clock === null) clock = performance.now();
      if (releaseAt === null) releaseAt = sinceStart();
      const since = Math.max(0, sinceStart() - releaseAt);
      const d = reduce ? T.reduceExit : T.exit;
      root.style.pointerEvents = "none";

      if (!reduce && stage) {
        const sAnim = stage.animate(
          [
            { transform: "scale3d(1,1,1)" },
            { transform: "scale3d(.94,.94,1)" },
          ],
          { duration: d, easing: EASE_EXIT, fill: "both" },
        );
        if (since > 0) sAnim.currentTime = since;
        exitAnims.push(sAnim);
      }

      const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: d,
        easing: EASE_EXIT,
        fill: "both",
      });
      if (since > 0) fade.currentTime = since;
      exitAnims.push(fade);
      fade.onfinish = finish;
      window.setTimeout(finish, Math.max(0, d - since) + 50);
    };

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

    const startPlayback = () => {
      if (!alive || released) return;
      if (clock === null) {
        clock = performance.now();
      }
      const elapsed = sinceStart();

      if (!reduce && stage) {
        stage.classList.remove("play");
        void stage.offsetWidth;
        stage.classList.add("play");
        if (elapsed > 0 && stage.getAnimations) {
          try {
            stage.getAnimations({ subtree: true }).forEach((a) => {
              if (typeof a.currentTime === "number") a.currentTime = elapsed;
            });
          } catch {
            // Ignore if browser does not support subtree getAnimations
          }
        }
      }

      const hold = reduce ? T.reduceHold : T.hold;
      holdTimer = setTimeout(requestRelease, Math.max(0, hold - elapsed));
    };

    if (releaseAt !== null) {
      released = true;
      exit();
    } else {
      root.addEventListener("pointerdown", requestRelease);
      window.addEventListener("keydown", onKey);

      if (reduce || isResume) {
        startPlayback();
      } else {
        const fontReady = document.fonts?.load
          ? document.fonts.load("800 1em Manrope").catch(() => {})
          : Promise.resolve();
        Promise.race([
          fontReady,
          new Promise((r) => setTimeout(r, T.fontWait)),
        ]).then(startPlayback);
      }
    }

    return () => {
      alive = false;
      releaseFnRef.current = null;
      restoreBg();
      lastCleanup = performance.now();
      clearTimeout(holdTimer);
      unlisten();
      exitAnims.forEach((a) => {
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
      style={{ "--sp-font": fontFamily }}
    >
      <main className="sp-stage" aria-label="Spend">
        <div className="sp-lockup">
          <div className="sp-tile">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path className="sp-shaft" pathLength="1" d="M22 43 43 22" />
              <path className="sp-head" pathLength="1" d="M28 22h15v15" />
            </svg>
          </div>
          <div className="sp-word" aria-hidden="true">
            <span>
              <b>Spend</b>
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
