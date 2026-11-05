import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

/**
 * Triggers light haptic feedback on native or Web vibration
 */
function triggerSplashHaptic() {
  if (Capacitor.isNativePlatform()) {
    try {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      return;
    } catch {
      // fallback
    }
  }
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
    try {
      navigator.vibrate(18);
    } catch {
      // ignore
    }
  }
}

/**
 * SpendSplash Component
 * App-opening splash animation matching the Spend UI:
 * - Brand squircle icon with white arrow (↗) entering with spring dynamics
 * - "Spent this month" title sliding up
 * - Rolling count-up number counter to total amount
 * - Smooth dissolve/exit morph into dashboard
 * - Tap anywhere or press Esc/Enter/Space to skip instantly
 * - Session storage gating for one-time play per session
 */
export default function SpendSplash({
  onDone,
  onComplete,
  once = true,
  storageKey = "spend-splash",
  totalSpent = 1284,
  currencySymbol = "৳",
  autoDismissMs = 2800,
  fontFamily = "Manrope, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  fontUrl = null,
}) {
  const isAlreadySeen = () => {
    try {
      return Boolean(once && sessionStorage.getItem(storageKey));
    } catch {
      return false;
    }
  };

  const alreadySeen = useRef(typeof window !== "undefined" && isAlreadySeen());

  const targetNumber = Number(totalSpent) > 0 ? Number(totalSpent) : 1284;
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  const isExitingRef = useRef(false);
  const animFrameRef = useRef(null);
  const exitTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const hasTriggeredCompleteRef = useRef(false);

  const completeCallback = useCallback(() => {
    if (hasTriggeredCompleteRef.current) return;
    hasTriggeredCompleteRef.current = true;
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {}
    document.dispatchEvent(new CustomEvent("spend:splash-done"));
    if (onDone) onDone();
    else if (onComplete) onComplete();
  }, [onDone, onComplete, storageKey]);

  const handleDismiss = useCallback(() => {
    if (isExitingRef.current || hasTriggeredCompleteRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    triggerSplashHaptic();

    exitTimerRef.current = setTimeout(() => {
      completeCallback();
    }, 400);
  }, [completeCallback]);

  // Clean up exit timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(exitTimerRef.current);
    };
  }, []);

  // Handle immediate skip when already seen
  useEffect(() => {
    if (alreadySeen.current) {
      completeCallback();
    }
  }, [completeCallback]);

  // Optional font loading if provided
  useEffect(() => {
    if (!fontUrl || typeof document === "undefined") return;
    if (!document.querySelector(`link[href="${fontUrl}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontUrl;
      document.head.appendChild(link);
    }
  }, [fontUrl]);

  // Rolling Number Counter Animation (Starts at 280ms, runs for ~680ms)
  useEffect(() => {
    if (alreadySeen.current) return undefined;

    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    if (prefersReducedMotion) {
      setDisplayedAmount(targetNumber);
      return undefined;
    }

    let isCancelled = false;
    const startDelayTimer = setTimeout(() => {
      if (isCancelled) return;
      const startTime = performance.now();
      const countDuration = 680;

      const updateCounter = (now) => {
        if (isCancelled) return;
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / countDuration);

        // Quintic ease-out: 1 - (1 - progress)^5
        const eased = 1 - Math.pow(1 - progress, 5);
        const current = Math.round(eased * targetNumber);

        setDisplayedAmount(current);

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(updateCounter);
        } else {
          setDisplayedAmount(targetNumber);
          triggerSplashHaptic();
        }
      };

      animFrameRef.current = requestAnimationFrame(updateCounter);
    }, 280);

    return () => {
      isCancelled = true;
      clearTimeout(startDelayTimer);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [targetNumber]);

  // Keyboard skip handler (Esc, Enter, Space)
  useEffect(() => {
    if (alreadySeen.current) return undefined;

    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        if (e.key === " ") e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDismiss]);

  // Auto-dismiss sequence
  useEffect(() => {
    if (alreadySeen.current) return undefined;

    dismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => {
      clearTimeout(dismissTimerRef.current);
    };
  }, [autoDismissMs, handleDismiss]);

  if (alreadySeen.current) {
    return null;
  }

  const formattedDigits = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(displayedAmount);

  return (
    <>
      <style>{`
        .spend-splash-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background-color: var(--page-bg, #f4f3ee);
          color: var(--ink, #18201b);
          font-family: ${fontFamily};
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
          cursor: pointer;
          will-change: transform, opacity, filter;
          transition:
            opacity 400ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 400ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 400ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        :root[data-theme="dark"] .spend-splash-overlay,
        html[data-theme="dark"] .spend-splash-overlay,
        .mobile-prototype[data-theme="dark"] ~ .spend-splash-overlay {
          background-color: var(--page-bg, #0e1411);
          color: var(--ink, #f0f3f1);
        }

        @media (prefers-color-scheme: dark) {
          html:not([data-theme="light"]) .spend-splash-overlay {
            background-color: var(--page-bg, #0e1411);
            color: var(--ink, #f0f3f1);
          }
        }

        /* Ambient Radial Glow */
        .spend-splash-ambient {
          position: absolute;
          width: 380px;
          height: 380px;
          border-radius: 50%;
          pointer-events: none;
          background: radial-gradient(
            circle,
            rgba(57, 120, 93, 0.22) 0%,
            rgba(57, 120, 93, 0.08) 45%,
            transparent 72%
          );
          filter: blur(48px);
          transform: translate3d(0, -20px, 0);
          animation: splash-ambient-pulse 2.4s ease-in-out infinite alternate;
        }

        html[data-theme="light"] .spend-splash-ambient {
          background: radial-gradient(
            circle,
            rgba(57, 120, 93, 0.16) 0%,
            rgba(57, 120, 93, 0.04) 50%,
            transparent 72%
          );
          filter: blur(40px);
        }

        /* Main Content Wrapper */
        .spend-splash-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          width: 100%;
          max-width: 320px;
          padding: 0 24px;
          box-sizing: border-box;
        }

        /* Brand Icon Badge (Squircle + Arrow) */
        .spend-splash-icon-wrapper {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 28px;
          animation: splash-icon-spring 680ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .spend-splash-badge {
          position: relative;
          width: 68px;
          height: 68px;
          border-radius: 20px;
          background: linear-gradient(135deg, #3aa376 0%, #206848 100%);
          color: #ffffff;
          display: grid;
          place-items: center;
          box-shadow:
            inset 0 1px 1px rgba(255, 255, 255, 0.4),
            0 14px 34px -6px rgba(47, 122, 90, 0.45),
            0 4px 14px rgba(0, 0, 0, 0.16);
          overflow: hidden;
        }

        .spend-splash-badge-sheen {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.28) 0%,
            rgba(255, 255, 255, 0.05) 45%,
            transparent 65%
          );
        }

        .spend-splash-badge svg {
          width: 34px;
          height: 34px;
          stroke: #ffffff;
          stroke-width: 4.8;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none;
          transform: translate3d(0, 0, 0);
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
          animation: splash-arrow-entrance 720ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
        }

        /* Subtle Badge Halo Pulse on Entry */
        .spend-splash-halo {
          position: absolute;
          inset: -6px;
          border-radius: 24px;
          background: rgba(58, 163, 118, 0.25);
          filter: blur(8px);
          pointer-events: none;
          animation: splash-halo-pulse 900ms cubic-bezier(0.16, 1, 0.3, 1) 100ms both;
        }

        /* Text & Counter Section */
        .spend-splash-text-group {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
        }

        .spend-splash-label {
          font-size: 15px;
          font-weight: 600;
          color: var(--mut, #626e66);
          letter-spacing: -0.01em;
          line-height: 1.25;
          margin: 0;
          opacity: 0;
          transform: translate3d(0, 16px, 0);
          animation: splash-fade-up 520ms cubic-bezier(0.2, 0.9, 0.28, 1) 220ms forwards;
        }

        :root[data-theme="dark"] .spend-splash-label,
        html[data-theme="dark"] .spend-splash-label {
          color: var(--mut, #aab4ae);
        }

        @media (prefers-color-scheme: dark) {
          html:not([data-theme="light"]) .spend-splash-label {
            color: var(--mut, #aab4ae);
          }
        }

        .spend-splash-amount-row {
          display: inline-flex;
          align-items: baseline;
          gap: 3px;
          font-size: clamp(48px, 13vw, 58px);
          font-weight: 800;
          color: var(--ink, #18201b);
          letter-spacing: -0.035em;
          line-height: 1.05;
          font-variant-numeric: tabular-nums;
          opacity: 0;
          transform: translate3d(0, 20px, 0);
          animation: splash-fade-up 560ms cubic-bezier(0.16, 1, 0.3, 1) 320ms forwards;
        }

        :root[data-theme="dark"] .spend-splash-amount-row,
        html[data-theme="dark"] .spend-splash-amount-row {
          color: var(--ink, #f0f3f1);
        }

        @media (prefers-color-scheme: dark) {
          html:not([data-theme="light"]) .spend-splash-amount-row {
            color: var(--ink, #f0f3f1);
          }
        }

        .spend-splash-currency {
          font-size: 0.88em;
          font-weight: 750;
          margin-right: 1px;
          opacity: 0.95;
        }

        .spend-splash-digits {
          display: inline-block;
          font-variant-numeric: tabular-nums;
        }

        /* Bottom Brand Signature */
        .spend-splash-footer {
          position: absolute;
          bottom: calc(28px + env(safe-area-inset-bottom, 0px));
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--mut, #626e66);
          font-size: 11.5px;
          font-weight: 650;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0;
          animation: splash-fade-up 600ms ease 600ms forwards;
        }

        :root[data-theme="dark"] .spend-splash-footer,
        html[data-theme="dark"] .spend-splash-footer {
          color: var(--mut, #aab4ae);
        }

        @media (prefers-color-scheme: dark) {
          html:not([data-theme="light"]) .spend-splash-footer {
            color: var(--mut, #aab4ae);
          }
        }

        .spend-splash-footer-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #39785d;
        }

        /* Exit Morph Transition Phase */
        .spend-splash-overlay.is-exiting {
          opacity: 0;
          transform: scale(1.04) translate3d(0, -8px, 0);
          filter: blur(8px);
          pointer-events: none;
        }

        .spend-splash-overlay.is-exiting .spend-splash-badge {
          transform: scale(0.92);
          transition: transform 380ms cubic-bezier(0.4, 0, 0.8, 1);
        }

        @keyframes splash-icon-spring {
          0% {
            opacity: 0;
            transform: scale(0.45) translate3d(0, 18px, 0);
          }
          65% {
            opacity: 1;
            transform: scale(1.06) translate3d(0, -3px, 0);
          }
          100% {
            opacity: 1;
            transform: scale(1) translate3d(0, 0, 0);
          }
        }

        @keyframes splash-arrow-entrance {
          0% {
            opacity: 0;
            transform: translate3d(-6px, 6px, 0) scale(0.85);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes splash-halo-pulse {
          0% {
            opacity: 0;
            transform: scale(0.7);
          }
          50% {
            opacity: 0.85;
            transform: scale(1.18);
          }
          100% {
            opacity: 0;
            transform: scale(1.4);
          }
        }

        @keyframes splash-fade-up {
          0% {
            opacity: 0;
            transform: translate3d(0, 16px, 0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        @keyframes splash-ambient-pulse {
          0% {
            opacity: 0.7;
            transform: scale(0.92) translate3d(0, -20px, 0);
          }
          100% {
            opacity: 1;
            transform: scale(1.08) translate3d(0, -10px, 0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .spend-splash-overlay {
            transition: opacity 220ms ease !important;
            transform: none !important;
            filter: none !important;
          }
          .spend-splash-overlay.is-exiting {
            transform: none !important;
            filter: none !important;
          }
          .spend-splash-icon-wrapper,
          .spend-splash-badge,
          .spend-splash-badge svg,
          .spend-splash-halo,
          .spend-splash-label,
          .spend-splash-amount-row,
          .spend-splash-ambient,
          .spend-splash-footer {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
      <aside
        className={`spend-splash-overlay${isExiting ? " is-exiting" : ""}`}
        onClick={handleDismiss}
        aria-label="Spend is opening. Tap anywhere to skip."
        role="dialog"
        aria-modal="true"
      >
        <div className="spend-splash-ambient" aria-hidden="true" />

        <div className="spend-splash-content">
          <div className="spend-splash-icon-wrapper">
            <div className="spend-splash-halo" aria-hidden="true" />
            <div className="spend-splash-badge">
              <div className="spend-splash-badge-sheen" aria-hidden="true" />
              <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                <path d="M22 43 43 22M28 22h15v15" />
              </svg>
            </div>
          </div>

          <div className="spend-splash-text-group">
            <p className="spend-splash-label">Spent this month</p>
            <div className="spend-splash-amount-row" aria-live="polite">
              <span className="spend-splash-currency">{currencySymbol}</span>
              <span className="spend-splash-digits">{formattedDigits}</span>
            </div>
          </div>
        </div>

        <div className="spend-splash-footer" aria-hidden="true">
          <span>Spend</span>
          <span className="spend-splash-footer-dot" />
          <span>Private &amp; Offline</span>
        </div>
      </aside>
    </>
  );
}
