import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  BkashLogo,
  NagadLogo,
  RocketLogo,
  UpayLogo,
  BracBankLogo,
  CityBankLogo,
  EblLogo,
  DbblLogo,
  StandardCharteredLogo,
  SavingsLogo,
  AmazonLogo,
  CitiLogo,
  HdfcLogo,
  VisaBadge,
  MastercardBadge,
  AmexBadge,
  EmvChip,
  ContactlessWaves,
  CARD_PROVIDERS,
  getProviderMeta,
  renderProviderLogo,
} from "./cardAssets.jsx";

export { renderProviderLogo };

/* ───────────── Native & Web Haptics Engine ───────────── */
function triggerSafariWebHaptic() {
  if (typeof document === "undefined") return;
  try {
    let trigger = document.getElementById("safari-haptic-trigger");
    if (!trigger) {
      trigger = document.createElement("input");
      trigger.id = "safari-haptic-trigger";
      trigger.type = "checkbox";
      trigger.setAttribute("switch", "");
      trigger.setAttribute("aria-hidden", "true");
      trigger.tabIndex = -1;
      trigger.style.cssText =
        "position:fixed;opacity:0;pointer-events:none;left:-9999px;width:0;height:0;";
      document.body.appendChild(trigger);
    }
    trigger.click();
  } catch {
    // ignore
  }
}

export function triggerHaptic(type = "light") {
  try {
    // Web / PWA fallback tuned for mobile vibration
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      const patterns = {
        selection: 12,
        light: 20,
        medium: 35,
        heavy: 55,
        success: [25, 45, 30],
        warning: [35, 40, 20],
        delete: [35, 40, 20],
      };
      const pattern =
        typeof type === "number" ? Math.max(10, type) : patterns[type] || 20;
      navigator.vibrate(pattern);
      return true;
    }
  } catch {}

  // iOS Safari Web / WebKit Taptic Engine tick fallback (iOS 17.4+)
  triggerSafariWebHaptic();
  return true;
}

/* ───────────── Currency & Number Formatters ───────────── */
export const formatMoney = (n) =>
  "৳" +
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

export function formatCardNumber(
  raw = "",
  isPhone = false,
  showFull = false,
  isSavings = false,
) {
  const str = String(raw || "").trim();
  if (!str) return "";
  if (
    isSavings ||
    str.startsWith("SAV-") ||
    str.startsWith("VAULT-") ||
    str.startsWith("DPS-")
  )
    return str;

  const digits = str.replace(/\D/g, "");
  if (!digits) return str;

  if (isPhone) {
    const hasPlus = str.startsWith("+");
    if (digits.length >= 13 && digits.startsWith("880")) {
      const prefix = hasPlus ? "+880" : "880";
      const rest = digits.slice(3);
      if (showFull) {
        return `${prefix} ${rest.slice(0, 4)} ${rest.slice(4, 7)} ${rest.slice(7)}`;
      }
      return `${prefix} ${rest.slice(0, 4)} •••• ${rest.slice(-2)}`;
    }
    if (digits.length > 11) {
      const countryCodeLen = digits.length - 10;
      const prefix = hasPlus
        ? `+${digits.slice(0, countryCodeLen)}`
        : digits.slice(0, countryCodeLen);
      const rest = digits.slice(countryCodeLen);
      if (showFull) {
        return `${prefix} ${rest.slice(0, 4)} ${rest.slice(4, 7)} ${rest.slice(7)}`;
      }
      return `${prefix} ${rest.slice(0, 4)} •••• ${rest.slice(-2)}`;
    }
    if (showFull && digits.length >= 11) {
      return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    }
    if (digits.length >= 11) {
      return `${digits.slice(0, 5)} •••• ${digits.slice(-2)}`;
    }
    if (digits.length > 5) {
      return `${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return digits;
  }

  // Bank card:
  // If showFull is requested (e.g. inside form inputs during entry), display typed digits in readable 4-digit groups
  if (showFull) {
    const parts = [];
    for (let i = 0; i < digits.length && i < 16; i += 4) {
      parts.push(digits.slice(i, i + 4));
    }
    return parts.join(" ");
  }

  // Mask bank cards to last 4 digits for security
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits;
  return `•••• •••• •••• ${last4}`;
}

export function formatExpiry(raw = "") {
  const digits = String(raw).replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

/* ───────────── Clean, Authentic Mobile Wallet Card ───────────── */
export function WalletCard({
  card,
  balance,
  isActive = false,
  onClick,
  onOpenDetails,
  showBalance = true,
  interactive = true,
  showFullDetails = false,
  className = "",
  style = {},
}) {
  if (!card) return null;
  const provider = getProviderMeta(card.provider);
  const gradient =
    card.gradient ||
    provider?.gradient ||
    "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
  const isMfs = card.type === "mfs" || provider?.category === "mfs";
  const isSavings =
    card.type === "savings" ||
    card.category === "savings" ||
    card.provider === "savings" ||
    provider?.category === "savings";
  const isFrozen = Boolean(card.frozen);

  const formattedNumber = formatCardNumber(
    card.number || card.last4 || "",
    isMfs,
    showFullDetails,
    isSavings,
  );

  const cardSubtitle =
    card.subtitle ||
    (isMfs
      ? "Personal Wallet"
      : isSavings
        ? "Savings Vault"
        : card.type === "credit"
          ? "Platinum Credit"
          : "Debit Card");

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={`${card.name}, ${cardSubtitle}, balance ${formatMoney(balance || 0)}${isFrozen ? ", locked" : ""}`}
      className={`wallet-card ${isActive ? "is-active" : ""} ${isMfs ? "is-mfs" : ""} ${isSavings ? "is-savings" : ""} ${isFrozen ? "is-frozen" : ""} ${className}`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        "--card-gradient": gradient,
        ...style,
      }}
    >
      <div className="wallet-card-surface">
        {/* Holographic light sheen reflection */}
        <div className="wallet-card-sheen" aria-hidden="true" />
        <div className="wallet-card-pattern" aria-hidden="true" />

        {/* Top Row: Card Title/Holder (Left) + Official Brand Logo (Right) */}
        <div className="wallet-card-header">
          <div className="wallet-card-holder-info">
            <span className="wallet-card-holder-name">
              {card.holderName || card.name || "Cardholder"}
            </span>
            <span className="wallet-card-type-tag">
              {cardSubtitle}
              {card.isPrimary && (
                <span className="wallet-card-primary-badge">PRIMARY</span>
              )}
              {isFrozen && (
                <span className="wallet-card-locked-badge">LOCKED</span>
              )}
            </span>
          </div>

          <div className="wallet-card-brand-logo">
            {renderProviderLogo(card.provider, { height: 28 })}
          </div>
        </div>

        {/* Middle Row: EMV Chip + Contactless waves */}
        <div className="wallet-card-mid">
          {!isMfs && !isSavings ? (
            <div className="wallet-card-chip-cluster">
              <EmvChip size={32} />
              <ContactlessWaves size={18} className="wallet-card-contactless" />
            </div>
          ) : (
            <div className="wallet-card-mfs-icon">
              <ContactlessWaves size={19} className="wallet-card-contactless" />
            </div>
          )}
        </div>

        {/* Card Number in Monospace */}
        <div className="wallet-card-number">
          {formattedNumber || (
            <span className="wallet-card-num-placeholder">
              {isMfs ? "01••• ••••••" : "•••• •••• •••• ••••"}
            </span>
          )}
        </div>

        {/* Bottom Row: Balance & Expiry (Left) + Network / Vault Badge (Right) */}
        <div className="wallet-card-footer">
          <div className="wallet-card-footer-left">
            {showBalance && (
              <div className="wallet-card-balance-block">
                <span className="wallet-card-meta-lbl">BALANCE</span>
                <b
                  className={`wallet-card-balance-val${balance < 0 && card.type !== "credit" ? " is-overdrawn" : ""}`}
                >
                  {formatMoney(balance || 0)}
                  {balance < 0 && card.type !== "credit" && (
                    <span className="wallet-card-overdrawn-badge">
                      OVERDRAWN
                    </span>
                  )}
                </b>
              </div>
            )}
            {!isMfs && !isSavings && (
              <div className="wallet-card-expiry-block">
                <span className="wallet-card-meta-lbl">VALID THRU</span>
                <span className="wallet-card-meta-val">
                  {formatExpiry(card.expiry) || "MM/YY"}
                </span>
              </div>
            )}
          </div>

          <div className="wallet-card-network">
            {card.network === "visa" && <VisaBadge width={48} height={18} />}
            {card.network === "mastercard" && (
              <MastercardBadge width={38} height={24} />
            )}
            {card.network === "amex" && <AmexBadge width={42} height={20} />}
            {isMfs && (
              <span className="wallet-card-mfs-network-pill">
                {(card.name || "WALLET").toUpperCase()}
              </span>
            )}
            {isSavings && (
              <span className="wallet-card-mfs-network-pill is-savings">
                VAULT
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Smooth Vertical Swapping Card Deck (3D Tipping Stack Engine) ───────────── */
const SLIVER_OFFSET = 14 + 170 * 0.06; // = 24.2px, keeps visible tab sliver at exactly 14px

export function StackedCardDeck({
  cards = [],
  balances = {},
  selectedId,
  onSelectCard,
  onAddCardClick,
  onOpenCardDetails,
  onDragOffsetChange,
}) {
  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = cards.findIndex((c) => c.id === selectedId);
    return idx >= 0 ? idx : 0;
  });

  // \x27idle\x27 | \x27dragging\x27 | \x27commit-phase1\x27 | \x27commit-phase2\x27 | \x27snap-back\x27
  const [phase, setPhase] = useState("idle");
  const [dragProgress, setDragProgress] = useState(0); // p from 0 to 1
  const [rawDy, setRawDy] = useState(0);

  const dragStartRef = useRef(null);
  const dragReleasePRef = useRef(0);
  const phaseTimerRef = useRef(null);
  const passedHapticRef = useRef(false);
  const wasSwipeRef = useRef(false);
  const isDraggingRef = useRef(false);
  const hasCapturedPointerRef = useRef(false);
  const wheelCooldownRef = useRef(0);

  const totalCards = cards.length;
  const safeActiveIndex =
    totalCards > 0 ? Math.min(activeIndex, totalCards - 1) : 0;

  // Clamp activeIndex if cards array shrinks
  useEffect(() => {
    if (totalCards === 0) {
      if (activeIndex !== 0) setActiveIndex(0);
      if (phase !== "idle") setPhase("idle");
      return;
    }
    if (activeIndex >= totalCards) {
      const clamped = totalCards - 1;
      setActiveIndex(clamped);
      onSelectCard?.(cards[clamped]?.id);
    }
  }, [totalCards, activeIndex, cards, onSelectCard, phase]);

  // Sync activeIndex if selectedId changes externally
  useEffect(() => {
    if (selectedId && phase === "idle" && totalCards > 0) {
      const idx = cards.findIndex((c) => c.id === selectedId);
      if (idx >= 0 && idx !== activeIndex) {
        setActiveIndex(idx);
      }
    }
  }, [selectedId, cards, activeIndex, phase, totalCards]);

  useEffect(() => {
    return () => {
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, []);

  const updateDrag = (pVal, dyVal) => {
    setDragProgress(pVal);
    setRawDy(dyVal);
    onDragOffsetChange?.(dyVal);
  };

  // ──── Two-Phase Commit Execution (Exact User Spec) ────
  // Phase 1 (180ms ease-in): Front card tips forward edge-on to p = 1. Background cards hold apex.
  // Phase 2 (500ms spring overshoot): Order array rotates. New front card & stack ease into resting slots with cubic-bezier(.34, 1.45, .5, 1). Old card slides under stack to the back.
  const executeCommit = useCallback(() => {
    if (totalCards <= 1 || phase.startsWith("commit")) return;
    triggerHaptic("light");
    setPhase("commit-phase1");
    setDragProgress(1);
    updateDrag(1, 60);

    // Phase 1: 180ms ease-in
    phaseTimerRef.current = setTimeout(() => {
      const nextIndex = (safeActiveIndex + 1) % totalCards;
      setActiveIndex(nextIndex);
      onSelectCard?.(cards[nextIndex]?.id);

      setPhase("commit-phase2");
      setDragProgress(0);
      updateDrag(0, 0);

      // Phase 2: 500ms spring overshoot settle
      phaseTimerRef.current = setTimeout(() => {
        setPhase("idle");
      }, 500);
    }, 180);
  }, [totalCards, phase, safeActiveIndex, cards, onSelectCard]);

  // Reverse swap (Flick up to bring previous card to front)
  const executeCommitPrev = useCallback(() => {
    if (totalCards <= 1 || phase.startsWith("commit")) return;
    triggerHaptic("light");
    const prevIndex = (safeActiveIndex - 1 + totalCards) % totalCards;
    setActiveIndex(prevIndex);
    onSelectCard?.(cards[prevIndex]?.id);

    setPhase("commit-phase2");
    setDragProgress(0);
    updateDrag(0, 0);

    phaseTimerRef.current = setTimeout(() => {
      setPhase("idle");
    }, 500);
  }, [totalCards, phase, safeActiveIndex, cards, onSelectCard]);

  // Snap back when drag is released below threshold
  const executeSnapBack = useCallback(() => {
    setPhase("snap-back");
    setDragProgress(0);
    updateDrag(0, 0);

    phaseTimerRef.current = setTimeout(() => {
      setPhase("idle");
    }, 260);
  }, []);

  // Direct card selection (Tap any card in the stack)
  const handleSelectCardIndex = useCallback(
    (targetIndex) => {
      if (phase !== "idle" || targetIndex === safeActiveIndex) return;
      triggerHaptic("selection");

      onSelectCard?.(cards[targetIndex]?.id);
      setActiveIndex(targetIndex);
      setPhase("commit-phase2");
      updateDrag(0, 0);

      phaseTimerRef.current = setTimeout(() => {
        setPhase("idle");
      }, 500);
    },
    [phase, safeActiveIndex, cards, onSelectCard],
  );

  // Click on card
  const handleCardClick = (depth, card, cardIndex) => {
    if (phase.startsWith("commit") || !card) return;
    if (wasSwipeRef.current) {
      wasSwipeRef.current = false;
      return;
    }
    if (depth === 0) {
      triggerHaptic("selection");
      onOpenCardDetails?.(card);
    } else {
      handleSelectCardIndex(cardIndex);
    }
  };

  // ──── Pointer Drag Gestures ────
  const onPointerDown = (e) => {
    if (phase.startsWith("commit")) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);

    passedHapticRef.current = false;
    wasSwipeRef.current = false;
    isDraggingRef.current = false;
    hasCapturedPointerRef.current = false;
    dragReleasePRef.current = 0;

    if (totalCards <= 1) return;

    dragStartRef.current = {
      startY: e.clientY,
      startX: e.clientX,
      startTime: performance.now(),
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e) => {
    if (!dragStartRef.current || phase.startsWith("commit")) return;
    if (e.pointerId !== dragStartRef.current.pointerId) return;

    const dy = e.clientY - dragStartRef.current.startY;
    const dx = e.clientX - dragStartRef.current.startX;

    if (!isDraggingRef.current) {
      // Tap slop threshold: only initiate drag gesture if movement exceeds 10px
      if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
        isDraggingRef.current = true;
        wasSwipeRef.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          hasCapturedPointerRef.current = true;
        } catch {}
      } else {
        return; // Movement is within tap slop; keep as tap
      }
    }

    if (dy >= 0) {
      // Drag down: map distance to p from 0 to 1 (p = dy / 120)
      const p = Math.min(1, dy / 120);
      if (phase !== "dragging") {
        setPhase("dragging");
      }
      updateDrag(p, dy);

      // Haptic tick when passing commit threshold (p >= 0.35)
      if (p >= 0.35 && !passedHapticRef.current) {
        passedHapticRef.current = true;
        triggerHaptic("selection");
      } else if (p < 0.35 && passedHapticRef.current) {
        passedHapticRef.current = false;
      }
    } else {
      // Drag up: soft rubber-band resistance in direction of movement
      const pullUp = Math.max(-28, dy * 0.25);
      if (phase !== "dragging") {
        setPhase("dragging");
      }
      updateDrag(0, pullUp);
    }
  };

  const onPointerUp = (e) => {
    if (!dragStartRef.current) return;
    const { startY, startTime, pointerId } = dragStartRef.current;
    dragStartRef.current = null;
    passedHapticRef.current = false;

    if (hasCapturedPointerRef.current) {
      try {
        e.currentTarget.releasePointerCapture(pointerId);
      } catch {}
      hasCapturedPointerRef.current = false;
    }

    // If movement never exceeded tap slop, this was a tap/click!
    if (!isDraggingRef.current) {
      wasSwipeRef.current = false;
      isDraggingRef.current = false;
      // Do not run executeSnapBack() because no drag took place and phase is already 'idle'
      return;
    }

    isDraggingRef.current = false;

    const dy = e.clientY - startY;
    const dt = Math.max(1, performance.now() - startTime);
    const velocity = dy / dt; // px/ms (positive = down, negative = up)

    if (dy >= 0) {
      const p = Math.min(1, dy / 120);
      dragReleasePRef.current = p;
      // Commit condition: p > 0.35 OR downward flick velocity > 0.45 px/ms
      const shouldCommit = p > 0.35 || (dy > 18 && velocity > 0.45);
      if (shouldCommit) {
        wasSwipeRef.current = true;
        executeCommit();
      } else {
        wasSwipeRef.current = true;
        executeSnapBack();
      }
    } else {
      // Upward release: flick up cycles to previous card
      if (dy < -28 && velocity < -0.45) {
        wasSwipeRef.current = true;
        executeCommitPrev();
      } else {
        wasSwipeRef.current = true;
        executeSnapBack();
      }
    }
  };

  const onPointerCancel = (e) => {
    if (dragStartRef.current && hasCapturedPointerRef.current) {
      try {
        e.currentTarget.releasePointerCapture(dragStartRef.current.pointerId);
      } catch {}
    }
    dragStartRef.current = null;
    passedHapticRef.current = false;
    hasCapturedPointerRef.current = false;
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      wasSwipeRef.current = true;
      executeSnapBack();
    }
  };

  // Mouse wheel / trackpad scroll
  const onWheel = (e) => {
    if (totalCards <= 1 || phase !== "idle") return;
    const now = performance.now();
    if (now - wheelCooldownRef.current < 450) return;

    if (e.deltaY > 18) {
      wheelCooldownRef.current = now;
      dragReleasePRef.current = 0.35;
      executeCommit();
    } else if (e.deltaY < -18) {
      wheelCooldownRef.current = now;
      executeCommitPrev();
    }
  };

  if (totalCards === 0) {
    return (
      <div className="cards-deck-container is-empty">
        <button
          type="button"
          className="wallet-card-empty-state"
          onClick={() => onAddCardClick?.()}
          aria-label="Add your first card or wallet"
        >
          <div className="wallet-card-empty-icon" aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="5" width="20" height="14" rx="3" />
              <line x1="2" y1="10" x2="22" y2="10" />
              <path d="M12 14h4" />
            </svg>
          </div>
          <div className="wallet-card-empty-copy">
            <strong>No cards or wallets yet</strong>
            <span>
              Tap to add a bank card, bKash/Nagad wallet, or savings vault
            </span>
          </div>
          <span className="wallet-card-empty-cta">+ Add Card</span>
        </button>
      </div>
    );
  }

  const p = dragProgress;

  return (
    <div className="cards-deck-container" onWheel={onWheel}>
      {/* 3D Stack Stage (perspective: 900px) */}
      <div
        className={`cards-deck-stage phase-${phase} ${phase === "dragging" ? "is-dragging" : ""}`}
        tabIndex={0}
        aria-label="Stacked cards wallet. Swipe down or tap to cycle cards."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {cards.map((card, index) => {
          // Order array depth: index 0 is front card
          const depth = (index - safeActiveIndex + totalCards) % totalCards;
          const isFront = depth === 0;

          // ──── Core Transform Equations (from User Specification) ────
          let transformStyle = "";
          let transitionStyle = "";
          let zIndex = 30 - depth * 5;
          let opacity = depth >= 3 ? 0 : 1;

          if (phase === "dragging") {
            transitionStyle = "none";
            if (rawDy >= 0) {
              if (depth === 0) {
                transformStyle = `translateY(${p * 60}px) rotateX(${-p * 78}deg) scale(1)`;
                opacity = 1 - p * 0.25;
                zIndex = 30;
              } else {
                const d = depth - p;
                transformStyle = `translateY(${-SLIVER_OFFSET * d}px) rotateX(0deg) scale(${1 - 0.06 * d})`;
                zIndex = 30 - depth * 5;
              }
            } else {
              // Pulling up: slight elastic translation for front card
              if (depth === 0) {
                transformStyle = `translateY(${rawDy}px) rotateX(0deg) scale(1)`;
              } else {
                transformStyle = `translateY(${-SLIVER_OFFSET * depth}px) rotateX(0deg) scale(${1 - 0.06 * depth})`;
              }
            }
          } else if (phase === "commit-phase1") {
            // Phase 1: Front card leaves to p = 1 in 180ms ease-in
            if (depth === 0) {
              transitionStyle =
                "transform 180ms ease-in, opacity 180ms ease-in";
              transformStyle = `translateY(60px) rotateX(-78deg) scale(1)`;
              opacity = 0.25;
              zIndex = 30;
            } else {
              // Background cards hold position at apex so Phase 2 delivers full spring overshoot
              transitionStyle = "none";
              const releaseProgress = Math.max(0.35, dragReleasePRef.current);
              const d = Math.max(0, depth - releaseProgress);
              transformStyle = `translateY(${-SLIVER_OFFSET * d}px) rotateX(0deg) scale(${1 - 0.06 * d})`;
              zIndex = 30 - depth * 5;
            }
          } else if (phase === "commit-phase2") {
            // Phase 2: Order rotated, incoming front card and stack ease into resting slots over 0.5s with spring overshoot
            transitionStyle =
              "transform 500ms cubic-bezier(.34, 1.45, .5, 1), opacity 380ms ease, filter 500ms ease";
            transformStyle = `translateY(${-SLIVER_OFFSET * depth}px) rotateX(0deg) scale(${1 - 0.06 * depth})`;
            zIndex = 30 - depth * 5;
            opacity = depth >= 3 ? 0 : 1;
          } else if (phase === "snap-back") {
            // Spring back to resting positions
            transitionStyle =
              "transform 260ms cubic-bezier(.34, 1.45, .5, 1), opacity 260ms ease";
            transformStyle = `translateY(${-SLIVER_OFFSET * depth}px) rotateX(0deg) scale(${1 - 0.06 * depth})`;
            zIndex = 30 - depth * 5;
          } else {
            // Resting idle state
            transitionStyle =
              "transform 500ms cubic-bezier(.34, 1.45, .5, 1), filter 380ms ease, opacity 280ms ease";
            transformStyle = `translateY(${-SLIVER_OFFSET * depth}px) rotateX(0deg) scale(${1 - 0.06 * depth})`;
            zIndex = 30 - depth * 5;
            opacity = depth >= 3 ? 0 : 1;
          }

          // Dynamic Depth Shadow & Brightness
          let filterStyle = "";
          if (depth === 0) {
            filterStyle =
              "drop-shadow(0 20px 42px rgba(0, 0, 0, 0.40)) brightness(1)";
          } else if (depth === 1) {
            filterStyle =
              "drop-shadow(0 10px 22px rgba(0, 0, 0, 0.22)) brightness(0.96)";
          } else {
            filterStyle =
              "drop-shadow(0 6px 14px rgba(0, 0, 0, 0.16)) brightness(0.90)";
          }

          const pointerEvents =
            depth >= 3 || phase.startsWith("commit") ? "none" : "auto";

          return (
            <div
              key={card.id}
              data-card-index={index}
              data-card-depth={depth}
              className={`cards-deck-slot depth-${depth} ${isFront ? "is-front" : "is-back"}`}
              role="button"
              tabIndex={0}
              aria-label={
                isFront
                  ? `Card options for ${card.name}`
                  : `Switch to ${card.name}`
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(depth, card, index);
                }
              }}
              style={{
                transform: transformStyle,
                transition: transitionStyle,
                zIndex,
                opacity,
                filter: filterStyle,
                pointerEvents,
                cursor: isFront ? "pointer" : "default",
              }}
              onClick={() => handleCardClick(depth, card, index)}
            >
              <WalletCard
                card={card}
                balance={balances[card.id] || 0}
                isActive={isFront}
                interactive={false}
                onOpenDetails={isFront ? onOpenCardDetails : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* Subtle indicator dots */}
      <div className="cards-deck-dots">
        {cards.map((card, idx) => (
          <button
            key={card.id}
            type="button"
            className={`cards-deck-dot ${idx === safeActiveIndex ? "is-active" : ""}`}
            aria-label={`Switch to ${card.name}`}
            onClick={(e) => {
              e.stopPropagation();
              if (phase !== "idle") return;
              triggerHaptic("selection");
              handleSelectCardIndex(idx);
            }}
          />
        ))}
      </div>
    </div>
  );
}
