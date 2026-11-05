import { useEffect, useRef, useState, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import "./SpendSplash.css";

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
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(18);
    } catch {
      // ignore
    }
  }
}

/**
 * SpendSplash Component
 * Recreates the exact opening animation prototype:
 * - Brand squircle icon with white arrow (↗) entering with spring dynamics
 * - "Spent this month" title sliding up
 * - Rolling count-up number counter to total amount
 * - Smooth dissolve/exit morph into dashboard
 * - Tap anywhere to skip instantly
 */
export default function SpendSplash({
  totalSpent = 1284,
  currencySymbol = "$",
  onComplete,
  autoDismissMs = 1750,
}) {
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const animFrameRef = useRef(null);
  const exitTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);
  const hasTriggeredCompleteRef = useRef(false);

  // Target amount to roll to (fallback to 1284 if 0 for prototype beauty)
  const targetNumber = Number(totalSpent) > 0 ? Number(totalSpent) : 1284;

  const handleDismiss = useCallback(() => {
    if (isExiting || hasTriggeredCompleteRef.current) return;
    setIsExiting(true);
    triggerSplashHaptic();

    // Allow 380ms for fluid CSS exit morph transition
    exitTimerRef.current = setTimeout(() => {
      if (!hasTriggeredCompleteRef.current) {
        hasTriggeredCompleteRef.current = true;
        onComplete?.();
      }
    }, 380);
  }, [isExiting, onComplete]);

  // Rolling Number Counter Animation (Starts at 320ms, runs for ~680ms)
  useEffect(() => {
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    if (prefersReducedMotion) {
      setDisplayedAmount(targetNumber);
      return undefined;
    }

    const startDelayTimer = setTimeout(() => {
      const startTime = performance.now();
      const countDuration = 680; // ms

      const updateCounter = (now) => {
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
      clearTimeout(startDelayTimer);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [targetNumber]);

  // Auto-dismiss sequence
  useEffect(() => {
    dismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => {
      clearTimeout(dismissTimerRef.current);
      clearTimeout(exitTimerRef.current);
    };
  }, [autoDismissMs, handleDismiss]);

  const formattedDigits = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(displayedAmount);

  return (
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
            <svg
              viewBox="0 0 64 64"
              aria-hidden="true"
              focusable="false"
            >
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
  );
}
