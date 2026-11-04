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

export function formatCardNumber(raw = "", isPhone = false, showFull = false) {
  const str = String(raw || "").trim();
  if (!str) return "";
  if (str.startsWith("SAV-") || str.startsWith("VAULT-")) return str;

  const digits = str.replace(/\D/g, "");
  if (!digits) return str;

  if (isPhone) {
    if (showFull && digits.length >= 11) {
      return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
    }
    if (digits.length >= 11) {
      return `${digits.slice(0, 5)} •••• ${digits.slice(9, 11)}`;
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
  const isSavings = card.type === "savings" || provider?.category === "savings";
  const isFrozen = Boolean(card.frozen);

  const formattedNumber = formatCardNumber(
    card.last4 || card.number || "",
    isMfs,
    showFullDetails,
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
                <b className="wallet-card-balance-val">
                  {formatMoney(balance || 0)}
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

/* ───────────── Smooth Vertical Swapping Card Deck ───────────── */
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

  // 'idle' | 'swapping-next' | 'swapping-prev' | 'swapping-select'
  const [swapPhase, setSwapPhase] = useState("idle");
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);
  const animTimeoutRef = useRef(null);
  const passedHapticRef = useRef(false);
  const wheelCooldownRef = useRef(0);

  const totalCards = cards.length;
  const safeActiveIndex =
    totalCards > 0 ? Math.min(activeIndex, totalCards - 1) : 0;

  // Clamp activeIndex if cards array shrinks
  useEffect(() => {
    if (totalCards === 0) {
      if (activeIndex !== 0) setActiveIndex(0);
      if (swapPhase !== "idle") setSwapPhase("idle");
      return;
    }
    if (activeIndex >= totalCards) {
      const clamped = totalCards - 1;
      setActiveIndex(clamped);
      onSelectCard?.(cards[clamped]?.id);
    }
  }, [totalCards, activeIndex, cards, onSelectCard, swapPhase]);

  // Sync activeIndex if selectedId changes from external filter
  useEffect(() => {
    if (selectedId && swapPhase === "idle" && totalCards > 0) {
      const idx = cards.findIndex((c) => c.id === selectedId);
      if (idx >= 0 && idx !== activeIndex) {
        setActiveIndex(idx);
      }
    }
  }, [selectedId, cards, activeIndex, swapPhase, totalCards]);

  useEffect(() => {
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    };
  }, []);

  const updateDrag = (val) => {
    setDragY(val);
    onDragOffsetChange?.(val);
  };

  // Swap Next (Swipe UP): Front card glides UP, slips behind into top/rear slot, next card glides forward
  const handleSwapNext = useCallback(() => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    triggerHaptic("light");
    setSwapPhase("swapping-next");
    updateDrag(0);

    const nextIndex = (safeActiveIndex + 1) % totalCards;
    onSelectCard?.(cards[nextIndex]?.id);

    animTimeoutRef.current = setTimeout(() => {
      setActiveIndex(nextIndex);
      setSwapPhase("idle");
    }, 360);
  }, [totalCards, swapPhase, safeActiveIndex, cards, onSelectCard]);

  // Swap Prev (Swipe DOWN): Front card glides DOWN, previous card glides into front
  const handleSwapPrev = useCallback(() => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    triggerHaptic("light");
    setSwapPhase("swapping-prev");
    updateDrag(0);

    const prevIndex = (safeActiveIndex - 1 + totalCards) % totalCards;
    onSelectCard?.(cards[prevIndex]?.id);

    animTimeoutRef.current = setTimeout(() => {
      setActiveIndex(prevIndex);
      setSwapPhase("idle");
    }, 360);
  }, [totalCards, swapPhase, safeActiveIndex, cards, onSelectCard]);

  // Direct card selection (Phase 3: Forefront Swapping & Expansion)
  const handleSelectCardIndex = useCallback(
    (targetIndex) => {
      if (swapPhase !== "idle" || targetIndex === safeActiveIndex) return;
      triggerHaptic("selection");
      setSwapPhase("swapping-select");
      updateDrag(0);

      onSelectCard?.(cards[targetIndex]?.id);

      animTimeoutRef.current = setTimeout(() => {
        setActiveIndex(targetIndex);
        setSwapPhase("idle");
      }, 360);
    },
    [swapPhase, safeActiveIndex, cards, onSelectCard],
  );

  // Direct card click
  const handleCardClick = (offset, card, cardIndex) => {
    if (swapPhase !== "idle" || !card) return;
    if (offset === 0) {
      triggerHaptic("selection");
      onOpenCardDetails?.(card);
    } else {
      // Tap any background tabbed header to expand it into forefront
      handleSelectCardIndex(cardIndex);
    }
  };

  // Pointer drag gestures with 1:1 finger tracking & tactile haptic tick
  const onPointerDown = (e) => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    if (e.button !== undefined && e.button !== 0) return;
    passedHapticRef.current = false;
    setIsDragging(true);
    dragStartRef.current = {
      startY: e.clientY,
      startX: e.clientX,
      startTime: performance.now(),
      pointerId: e.pointerId,
      target: e.target,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e) => {
    if (!dragStartRef.current || swapPhase !== "idle") return;
    if (e.pointerId !== dragStartRef.current.pointerId) return;

    const dy = e.clientY - dragStartRef.current.startY;

    // Direct 1:1 finger tracking with soft rubber-band resistance beyond ±130px
    let effectiveDy = dy;
    if (effectiveDy > 130) {
      effectiveDy = 130 + (effectiveDy - 130) * 0.35;
    } else if (effectiveDy < -130) {
      effectiveDy = -130 + (effectiveDy - -130) * 0.35;
    }
    updateDrag(effectiveDy);

    // Tactile haptic feedback when crossing the swap threshold
    const THRESHOLD = 32;
    if (Math.abs(effectiveDy) >= THRESHOLD && !passedHapticRef.current) {
      passedHapticRef.current = true;
      triggerHaptic("selection");
    } else if (Math.abs(effectiveDy) < THRESHOLD && passedHapticRef.current) {
      passedHapticRef.current = false;
    }
  };

  const onPointerUp = (e) => {
    if (!dragStartRef.current) return;
    const { startY, startX, startTime, pointerId, target } = dragStartRef.current;
    dragStartRef.current = null;
    passedHapticRef.current = false;
    setIsDragging(false);

    try {
      e.currentTarget.releasePointerCapture(pointerId);
    } catch {}

    const dy = e.clientY - startY;
    const dx = e.clientX - startX;
    const dt = Math.max(1, performance.now() - startTime);
    const velocity = dy / dt;

    // Fluid threshold & flick detection (Swipe UP = Next, Swipe DOWN = Prev)
    const isSwipeUp = dy < -24 || (dy < -10 && velocity < -0.24);
    const isSwipeDown = dy > 24 || (dy > 10 && velocity > 0.24);

    if (isSwipeUp) {
      handleSwapNext();
    } else if (isSwipeDown) {
      handleSwapPrev();
    } else if (Math.abs(dy) <= 6 && Math.abs(dx) <= 6) {
      // Tap detection on specific card slot
      const clickedSlot = target?.closest?.(".cards-deck-slot");
      const slotIndexAttr = clickedSlot?.getAttribute?.("data-card-index");
      if (slotIndexAttr != null) {
        const clickedIdx = parseInt(slotIndexAttr, 10);
        if (!isNaN(clickedIdx) && clickedIdx !== safeActiveIndex) {
          handleSelectCardIndex(clickedIdx);
        } else if (cards[safeActiveIndex]) {
          triggerHaptic("selection");
          onOpenCardDetails?.(cards[safeActiveIndex]);
        }
      } else if (cards[safeActiveIndex]) {
        triggerHaptic("selection");
        onOpenCardDetails?.(cards[safeActiveIndex]);
      }
    } else {
      // Release below threshold: smoothly spring back to 0
      updateDrag(0);
    }
  };

  const onPointerCancel = () => {
    dragStartRef.current = null;
    passedHapticRef.current = false;
    setIsDragging(false);
    updateDrag(0);
  };

  // Mouse wheel / trackpad vertical scroll gesture support
  const onWheel = (e) => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    const now = performance.now();
    if (now - wheelCooldownRef.current < 360) return;

    if (Math.abs(e.deltaY) > 18) {
      wheelCooldownRef.current = now;
      if (e.deltaY > 0) {
        handleSwapNext();
      } else {
        handleSwapPrev();
      }
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

  return (
    <div className="cards-deck-container" onWheel={onWheel}>
      {/* Deck Stage */}
      <div
        className={`cards-deck-stage ${swapPhase !== "idle" ? `is-${swapPhase}` : ""} ${isDragging ? "is-dragging" : ""}`}
        tabIndex={0}
        aria-label="Stacked cards wallet. Tap or swipe to switch cards."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {cards.map((card, index) => {
          const offset = (index - safeActiveIndex + totalCards) % totalCards;
          const isFront = offset === 0;

          let y = 0;
          let scale = 1;
          let zIndex = 30 - offset * 6;
          let opacity = 1;

          if (swapPhase === "idle") {
            if (offset === 0) {
              y = dragY;
              scale = 1 - Math.min(0.04, Math.abs(dragY) / 1200);
              zIndex = 30;
              opacity = 1;
            } else if (offset === 1) {
              const progress = dragY < 0 ? Math.min(1, Math.max(0, -dragY / 85)) : 0;
              y = -42 + progress * 42;
              scale = 0.94 + progress * 0.06;
              zIndex = 20;
              opacity = 0.96 + progress * 0.04;
            } else if (offset === 2) {
              const progress = dragY < 0 ? Math.min(1, Math.max(0, -dragY / 85)) : 0;
              y = -78 + progress * 36;
              scale = 0.88 + progress * 0.06;
              zIndex = 14;
              opacity = 0.9 + progress * 0.06;
            } else {
              y = -106;
              scale = 0.82;
              zIndex = 6;
              opacity = 0;
            }
          }

          let slotAnimClass = "";
          if (swapPhase === "swapping-next") {
            if (offset === 0) slotAnimClass = "slot-swap-next-leave";
            else if (offset === 1) slotAnimClass = "slot-swap-next-incoming";
            else if (offset === 2) slotAnimClass = "slot-swap-next-advance";
          } else if (swapPhase === "swapping-prev") {
            if (offset === 0) slotAnimClass = "slot-swap-prev-leave";
            else if (offset === totalCards - 1)
              slotAnimClass = "slot-swap-prev-incoming";
            else if (offset === 1) slotAnimClass = "slot-swap-prev-stepback";
          } else if (swapPhase === "swapping-select") {
            if (offset === 0) slotAnimClass = "slot-swap-select-incoming";
            else slotAnimClass = "slot-swap-select-tuck";
          }

          return (
            <div
              key={card.id}
              data-card-index={index}
              className={`cards-deck-slot offset-${offset} ${isFront ? "is-front" : "is-back"} ${slotAnimClass}`}
              style={{
                "--target-y": `${y}px`,
                "--target-scale": scale,
                transform:
                  swapPhase === "idle"
                    ? `translate3d(0, ${y}px, 0) scale(${scale})`
                    : undefined,
                zIndex,
                opacity,
              }}
              onClick={() => handleCardClick(offset, card, index)}
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
              if (swapPhase !== "idle") return;
              triggerHaptic("selection");
              setActiveIndex(idx);
              onSelectCard?.(card.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
