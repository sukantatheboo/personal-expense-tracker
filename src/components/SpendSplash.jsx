import { useEffect, useRef } from "react";

const EASE = {
  out: "cubic-bezier(.22,1,.36,1)",
  inOut: "cubic-bezier(.65,0,.35,1)",
};

const T = {
  shaft: 640,
  arms: 980,
  shift: 1340,
  letters: 1400,
  hold: 2750,
  exit: 450,
};

export default function SpendSplash({
  onDone,
  once = true,
  storageKey = "spend-splash",
  fontFamily = '"Outfit", "Nunito Sans", ui-rounded, system-ui, sans-serif',
  fontUrl = "https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=swap",
}) {
  const rootRef = useRef(null);

  const isAlreadySeen = () => {
    try {
      return Boolean(once && sessionStorage.getItem(storageKey));
    } catch {
      return false;
    }
  };

  const alreadySeen = useRef(typeof window !== "undefined" && isAlreadySeen());

  useEffect(() => {
    if (alreadySeen.current) {
      onDone?.();
      return undefined;
    }

    let active = true;
    const anims = [];
    let holdTimer = null;
    let cleanListeners = () => {};

    // Load font stylesheet if requested and not already present
    if (fontUrl && typeof document !== "undefined") {
      if (!document.querySelector(`link[href="${fontUrl}"]`)) {
        if (!document.querySelector('link[href="https://fonts.googleapis.com"]')) {
          const pre1 = document.createElement("link");
          pre1.rel = "preconnect";
          pre1.href = "https://fonts.googleapis.com";
          document.head.appendChild(pre1);
        }
        if (!document.querySelector('link[href="https://fonts.gstatic.com"]')) {
          const pre2 = document.createElement("link");
          pre2.rel = "preconnect";
          pre2.href = "https://fonts.gstatic.com";
          pre2.crossOrigin = "anonymous";
          document.head.appendChild(pre2);
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = fontUrl;
        document.head.appendChild(link);
      }
    }

    function checkFontsReady() {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      const firstFamily = (fontFamily || "Outfit")
        .split(",")[0]
        .replace(/['"]/g, "")
        .trim();
      if (
        document.fonts.check &&
        document.fonts.check(`600 1em ${firstFamily || "Outfit"}`)
      ) {
        return Promise.resolve();
      }
      return Promise.race([
        document.fonts.load(`600 1em ${firstFamily || "Outfit"}`),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]).catch(() => {});
    }

    const root = rootRef.current;
    if (!root) return undefined;

    checkFontsReady().then(() => {
      if (!active || !rootRef.current) return;
      const el = rootRef.current;
      el.hidden = false;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const t = (ms) => (reduce ? 0 : ms);
      const cs = getComputedStyle(el);
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const ink =
        cs.getPropertyValue("--sp-ink").trim() || (isDark ? "#eef6f1" : "#12261d");
      const mist =
        cs.getPropertyValue("--sp-mist").trim() || (isDark ? "#5f7468" : "#a3b5ab");

      const q = (s) => el.querySelector(s);
      const tile = q(".sp-tile");
      const stage = q(".sp-stage");
      const lockup = q(".sp-lockup");
      const word = q(".sp-word");
      const shaft = q(".sp-shaft");
      const arms = el.querySelectorAll(".sp-arm");
      const letters = Array.prototype.slice.call(el.querySelectorAll(".sp-word span"));

      if (!tile || !stage || !lockup || !word || !shaft) return;

      function run(target, kf, o) {
        const a = target.animate(kf, Object.assign({ fill: "both" }, o));
        anims.push(a);
        return a;
      }

      function draw(target, delay, dur, easing) {
        run(
          target,
          [
            { strokeDashoffset: 1, opacity: 0, offset: 0 },
            { strokeDashoffset: 1, opacity: 1, offset: 0.001 },
            { strokeDashoffset: 0, opacity: 1, offset: 1 },
          ],
          { delay: t(delay), duration: t(dur), easing },
        );
      }

      // 1. Dot pops in, then swells into the rounded tile (circle -> 25% radius)
      run(
        tile,
        [
          {
            transform: "scale(0) translateZ(0)",
            easing: "cubic-bezier(.2,.8,.3,1)",
          },
          {
            transform: "scale(.07) translateZ(0)",
            offset: 0.2,
            easing: "cubic-bezier(.34,1.3,.64,1)",
          },
          { transform: "scale(1) translateZ(0)" },
        ],
        { duration: t(800) },
      );

      run(
        tile,
        [
          { borderRadius: "50%", easing: "cubic-bezier(.2,.8,.3,1)" },
          {
            borderRadius: "50%",
            offset: 0.2,
            easing: "cubic-bezier(.34,1.3,.64,1)",
          },
          { borderRadius: "25%" },
        ],
        { duration: t(800) },
      );

      // 2. Arrow draws itself: shaft first, then the head opens out from the tip
      draw(shaft, T.shaft, 400, EASE.inOut);
      Array.prototype.forEach.call(arms, (a) => {
        draw(a, T.arms, 300, EASE.out);
      });

      // 3. Tile slides left as the wordmark arrives; lockup ends perfectly centred
      const gap = parseFloat(getComputedStyle(lockup).columnGap) || 0;
      const shift = (word.offsetWidth + gap) / 2;
      run(
        lockup,
        [
          { transform: `translateX(${shift}px) translateZ(0)` },
          { transform: "translateX(0) translateZ(0)" },
        ],
        { delay: t(T.shift), duration: t(720), easing: EASE.out },
      );

      letters.forEach((l, i) => {
        run(
          l,
          [
            { opacity: 0, transform: "translateX(-.16em) translateZ(0)" },
            { opacity: 1, transform: "translateX(0) translateZ(0)" },
          ],
          {
            delay: t(T.letters + i * 60),
            duration: t(480),
            easing: EASE.out,
          },
        );
        run(
          l,
          [
            { color: mist },
            { color: ink },
          ],
          {
            delay: t(T.letters + i * 60),
            duration: t(480),
            easing: EASE.out,
          },
        );
      });

      // 4. Hold, then exit. Tap, click, Esc, Enter or Space skips the hold.
      let isReleased = false;
      let releaseResolver;
      const held = new Promise((resolve) => {
        releaseResolver = resolve;
      });

      function triggerRelease() {
        if (isReleased) return;
        isReleased = true;
        if (releaseResolver) releaseResolver();
      }

      holdTimer = setTimeout(triggerRelease, reduce ? 900 : T.hold);

      function onKey(e) {
        if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
          triggerRelease();
        }
      }

      el.addEventListener("pointerdown", triggerRelease);
      window.addEventListener("keydown", onKey);

      cleanListeners = () => {
        clearTimeout(holdTimer);
        el.removeEventListener("pointerdown", triggerRelease);
        window.removeEventListener("keydown", onKey);
      };

      held
        .then(() => {
          if (!active || !rootRef.current) return undefined;
          cleanListeners();
          const d = reduce ? 200 : T.exit;
          run(
            stage,
            [
              { transform: "scale(1) translateZ(0)" },
              { transform: reduce ? "scale(1) translateZ(0)" : "scale(.94) translateZ(0)" },
            ],
            { duration: d, easing: "cubic-bezier(.4,0,1,1)" },
          );
          const fadeAnim = run(
            el,
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: d, easing: "ease-out" },
          );
          return fadeAnim.finished;
        })
        .then(() => {
          if (!active) return;
          anims.forEach((a) => {
            try {
              a.cancel();
            } catch {}
          });
          if (rootRef.current) {
            rootRef.current.hidden = true;
          }
          try {
            sessionStorage.setItem(storageKey, "1");
          } catch {}
          document.dispatchEvent(new CustomEvent("spend:splash-done"));
          onDone?.();
        });
    });

    return () => {
      active = false;
      cleanListeners();
      anims.forEach((a) => {
        try {
          a.cancel();
        } catch {}
      });
    };
  }, [once, storageKey, fontFamily, fontUrl, onDone]);

  if (alreadySeen.current) {
    return null;
  }

  const effectiveFont =
    fontFamily || '"Outfit", "Nunito Sans", ui-rounded, system-ui, sans-serif';

  return (
    <>
      <style>{`
        :root, #spend-splash {
          --sp-green: #39785d;
          --sp-ink: #12261d;
          --sp-mist: #a3b5ab;
          --sp-top: #ffffff;
          --sp-bot: #e3efe8;
          --sp-font: ${effectiveFont};
        }
        @media (prefers-color-scheme: dark) {
          :root, #spend-splash {
            --sp-ink: #eef6f1;
            --sp-mist: #5f7468;
            --sp-top: #0d1511;
            --sp-bot: #14271e;
          }
        }
        #spend-splash {
          --tile: clamp(76px, 24vw, 112px);
          position: fixed; inset: 0; z-index: 9999;
          display: grid; place-items: center;
          background: linear-gradient(180deg, var(--sp-top) 35%, var(--sp-bot));
          cursor: pointer; overflow: hidden;
          contain: strict;
          isolation: isolate;
          transform: translateZ(0);
          will-change: transform, opacity;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        #spend-splash[hidden] { display: none; }
        .sp-stage {
          transform: translateZ(0);
          will-change: transform;
          backface-visibility: hidden;
        }
        .sp-lockup {
          display: flex; align-items: center; gap: calc(var(--tile) * .2);
          transform: translateZ(0);
          will-change: transform;
          backface-visibility: hidden;
        }
        .sp-tile {
          flex: none; width: var(--tile); height: var(--tile);
          background: var(--sp-green); border-radius: 25%;
          transform: scale(0) translateZ(0);
          will-change: transform;
          backface-visibility: hidden;
        }
        .sp-tile svg { display: block; width: 100%; height: 100%; overflow: visible; }
        .sp-draw {
          fill: none; stroke: #fff; stroke-width: 4.5;
          stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0;
          will-change: stroke-dashoffset, opacity;
        }
        .sp-word {
          display: flex; padding-bottom: .05em;
          font: 600 calc(var(--tile) * .68) / 1 var(--sp-font);
          letter-spacing: -.025em; color: var(--sp-ink);
        }
        .sp-word span {
          display: inline-block; opacity: 0;
          transform: translateZ(0);
          will-change: transform, opacity;
          backface-visibility: hidden;
        }
      `}</style>
      <div id="spend-splash" ref={rootRef} role="img" aria-label="Spend">
        <div className="sp-stage">
          <div className="sp-lockup">
            <div className="sp-tile">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <path className="sp-draw sp-shaft" pathLength="1" d="M22 43 43 22" />
                <path className="sp-draw sp-arm" pathLength="1" d="M43 22H28" />
                <path className="sp-draw sp-arm" pathLength="1" d="M43 22V37" />
              </svg>
            </div>
            <div className="sp-word" aria-hidden="true">
              <span>s</span>
              <span>p</span>
              <span>e</span>
              <span>n</span>
              <span>d</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
