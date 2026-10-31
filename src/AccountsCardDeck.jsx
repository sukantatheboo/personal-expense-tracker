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

/* ───────────── Currency & Number Formatters ───────────── */
export const formatMoney = (n) =>
  "৳" +
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

export function formatCardNumber(raw = "", isPhone = false, showFull = false) {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";

  if (isPhone) {
    if (showFull && digits.length >= 11) {
      return `${digits.slice(0, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
    }
    if (digits.length >= 11) {
      return `${digits.slice(0, 5)} xxxx ${digits.slice(9, 11)}`;
    }
    if (digits.length > 5) {
      return `${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return digits;
  }

  // 16-digit bank card
  if (showFull && digits.length >= 16) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)} ${digits.slice(12, 16)}`;
  }
  if (digits.length >= 16) {
    return `${digits.slice(0, 4)} xxxx xxxx ${digits.slice(12, 16)}`;
  }

  const parts = [];
  for (let i = 0; i < digits.length && i < 16; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join(" ");
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
  const provider = getProviderMeta(card.provider);
  const gradient =
    card.gradient ||
    provider?.gradient ||
    "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
  const isMfs = card.type === "mfs" || provider?.category === "mfs";
  const isSavings = card.type === "savings" || provider?.category === "savings";

  const formattedNumber = formatCardNumber(
    card.number || "",
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
      aria-label={`${card.name}, ${cardSubtitle}, balance ${formatMoney(balance || 0)}`}
      className={`wallet-card ${isActive ? "is-active" : ""} ${isMfs ? "is-mfs" : ""} ${isSavings ? "is-savings" : ""} ${className}`}
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
              {card.holderName || card.name || "John Smith"}
            </span>
            <span className="wallet-card-type-tag">{cardSubtitle}</span>
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
            {!isMfs && !isSavings && (
              <div className="wallet-card-expiry-block">
                <span className="wallet-card-meta-lbl">CVV</span>
                <span className="wallet-card-meta-val">
                  {showFullDetails && card.cvv ? card.cvv : (card.cvv ? "***" : "•••")}
                </span>
              </div>
            )}
          </div>

          <div className="wallet-card-network">
            {card.network === "visa" && <VisaBadge width={48} height={18} />}
            {card.network === "mastercard" && (
              <MastercardBadge width={38} height={24} />
            )}
            {card.network === "amex" && (
              <AmexBadge width={42} height={20} />
            )}
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
}) {
  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = cards.findIndex((c) => c.id === selectedId);
    return idx >= 0 ? idx : 0;
  });

  // 'idle' | 'swapping-down' | 'swapping-up'
  const [swapPhase, setSwapPhase] = useState("idle");
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef(null);
  const animTimeoutRef = useRef(null);

  // Sync activeIndex if selectedId changes from external filter
  useEffect(() => {
    if (selectedId && swapPhase === "idle") {
      const idx = cards.findIndex((c) => c.id === selectedId);
      if (idx >= 0 && idx !== activeIndex) {
        setActiveIndex(idx);
      }
    }
  }, [selectedId, cards, activeIndex, swapPhase]);

  useEffect(() => {
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    };
  }, []);

  const totalCards = cards.length;

  // Swap Down: Front card glides down, tucks behind, middle card glides to front
  const handleSwapDown = useCallback(() => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    setSwapPhase("swapping-down");
    setDragY(0);

    const nextIndex = (activeIndex + 1) % totalCards;
    // Immediately synchronize active card selection so action buttons and details reflect the new card
    onSelectCard?.(cards[nextIndex]?.id);

    animTimeoutRef.current = setTimeout(() => {
      setActiveIndex(nextIndex);
      setSwapPhase("idle");
    }, 380);
  }, [totalCards, swapPhase, activeIndex, cards, onSelectCard]);

  // Swap Up: Back card glides up into front
  const handleSwapUp = useCallback(() => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    setSwapPhase("swapping-up");
    setDragY(0);

    const prevIndex = (activeIndex - 1 + totalCards) % totalCards;
    // Immediately synchronize active card selection
    onSelectCard?.(cards[prevIndex]?.id);

    animTimeoutRef.current = setTimeout(() => {
      setActiveIndex(prevIndex);
      setSwapPhase("idle");
    }, 380);
  }, [totalCards, swapPhase, activeIndex, cards, onSelectCard]);

  // Direct card click
  const handleCardClick = (offset, card) => {
    if (swapPhase !== "idle") return;
    if (offset === 0) {
      // Tap on front card: open Card Options / details immediately
      onOpenCardDetails?.(card);
    } else if (offset === 1) {
      // Tap on middle card: cycle down to it
      handleSwapDown();
    } else {
      // Tap on back card: cycle up
      handleSwapUp();
    }
  };

  // Pointer drag gestures for realistic finger tracking
  const onPointerDown = (e) => {
    if (totalCards <= 1 || swapPhase !== "idle") return;
    if (e.button !== undefined && e.button !== 0) return;
    dragStartRef.current = {
      startY: e.clientY,
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
    // Rubber band resistance when dragging up
    const resistedDy = dy > 0 ? dy * 0.88 : dy * 0.38;
    setDragY(resistedDy);
  };

  const onPointerUp = (e) => {
    if (!dragStartRef.current) return;
    const { startY, startTime, pointerId, target } = dragStartRef.current;
    dragStartRef.current = null;

    try {
      e.currentTarget.releasePointerCapture(pointerId);
    } catch {}

    const dy = e.clientY - startY;
    const dt = Math.max(1, performance.now() - startTime);
    const velocity = dy / dt;

    if (dy > 36 || (dy > 12 && velocity > 0.35)) {
      // Downward swipe or flick -> swap down
      handleSwapDown();
    } else if (dy < -36 || (dy < -12 && velocity < -0.35)) {
      // Upward swipe or flick -> swap up
      handleSwapUp();
    } else if (Math.abs(dy) <= 8) {
      // Discrete tap
      // If user tapped on middle or back card slot:
      const clickedSlot = target?.closest?.(".cards-deck-slot");
      if (clickedSlot?.classList?.contains("offset-1")) {
        handleSwapDown();
      } else if (clickedSlot?.classList?.contains("offset-2")) {
        handleSwapUp();
      } else {
        // Tap on front card: open Card Options / details immediately
        onOpenCardDetails?.(cards[activeIndex]);
      }
    } else {
      // Snap back to resting position
      setDragY(0);
    }
  };

  const onPointerCancel = () => {
    dragStartRef.current = null;
    setDragY(0);
  };

  return (
    <div className="cards-deck-container">
      {/* Deck Stage */}
      <div
        className={`cards-deck-stage ${swapPhase !== "idle" ? `is-${swapPhase}` : ""}`}
        tabIndex={0}
        aria-label="Stacked cards wallet. Tap or swipe to switch cards."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {cards.map((card, index) => {
          // Offset relative to activeIndex (0 = front, 1 = middle, 2 = back)
          const offset = (index - activeIndex + totalCards) % totalCards;
          const isFront = offset === 0;

          // Compute resting coordinates matching video:
          // Card 0 (front): y = 0, scale = 1.0, zIndex = 25
          // Card 1 (middle): y = -26, scale = 0.94, zIndex = 18
          // Card 2 (back): y = -48, scale = 0.88, zIndex = 12
          let y = 0;
          let scale = 1;
          let zIndex = 25 - offset * 6;
          let opacity = 1;

          if (offset === 0) {
            y = dragY > 0 ? dragY : dragY * 0.4;
            scale = 1;
            zIndex = 25;
            opacity = 1;
          } else if (offset === 1) {
            const dragProgress = Math.min(1, Math.max(0, dragY / 90));
            y = -26 + dragProgress * 26;
            scale = 0.94 + dragProgress * 0.06;
            zIndex = 18;
            opacity = 0.96;
          } else if (offset === 2) {
            const dragProgress = Math.min(1, Math.max(0, dragY / 90));
            y = -48 + dragProgress * 22;
            scale = 0.88 + dragProgress * 0.06;
            zIndex = 12;
            opacity = 0.90;
          } else {
            y = -64;
            scale = 0.82;
            zIndex = 5;
            opacity = 0;
          }

          // Slot CSS classes for active swapping animation
          let slotAnimClass = "";
          if (swapPhase === "swapping-down") {
            if (offset === 0) slotAnimClass = "slot-swap-down-leave";
            else if (offset === 1) slotAnimClass = "slot-swap-down-incoming";
            else if (offset === 2) slotAnimClass = "slot-swap-down-advance";
          } else if (swapPhase === "swapping-up") {
            if (offset === 0) slotAnimClass = "slot-swap-up-front";
            else if (offset === totalCards - 1) slotAnimClass = "slot-swap-up-enter";
          }

          return (
            <div
              key={card.id}
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
              onClick={() => handleCardClick(offset, card)}
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
            className={`cards-deck-dot ${idx === activeIndex ? "is-active" : ""}`}
            aria-label={`Switch to ${card.name}`}
            onClick={(e) => {
              e.stopPropagation();
              if (swapPhase !== "idle") return;
              setActiveIndex(idx);
              onSelectCard?.(card.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
