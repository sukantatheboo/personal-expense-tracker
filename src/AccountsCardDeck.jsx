import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  SlidersHorizontal,
  CreditCard,
} from "lucide-react";
import {
  VisaBadge,
  MastercardBadge,
  AmexBadge,
  EmvChip,
  ContactlessWaves,
  getCashCurrencyMeta,
  getProviderMeta,
  resolveCardGradient,
  renderProviderLogo,
} from "./cardAssets.jsx";

import { triggerHaptic } from "./haptics.js";

/**
 * Fallback inline SVGs (24x24 viewBox, fill="none", stroke="currentColor",
 * strokeWidth=1.75, round caps & joins) if lucide-react isn't installed yet.
 */
const SVG_PROPS = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

export const FallbackIcons = {
  Income: (props) => (
    <svg {...SVG_PROPS} {...props}>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  ),
  Transfer: (props) => (
    <svg {...SVG_PROPS} {...props}>
      <path d="M4 8h15" />
      <path d="M15.5 4.5L19 8l-3.5 3.5" />
      <path d="M20 16H5" />
      <path d="M8.5 12.5L5 16l3.5 3.5" />
    </svg>
  ),
  Adjust: (props) => (
    <svg {...SVG_PROPS} {...props}>
      <path d="M4 8h8.5" />
      <path d="M17.5 8H20" />
      <circle cx="15" cy="8" r="2.5" />
      <path d="M4 16h2.5" />
      <path d="M11.5 16H20" />
      <circle cx="9" cy="16" r="2.5" />
    </svg>
  ),
  Card: (props) => (
    <svg {...SVG_PROPS} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <path d="M7 14.5h3" />
    </svg>
  ),
};

/**
 * @typedef {Object} QuickActionProps
 * @property {React.ComponentType<any>} icon - Icon component (Lucide or fallback SVG)
 * @property {string} label - Single-line visible label ("Add money", "Send", "Adjust", "Cards")
 * @property {() => void} onPress - Tap handler
 * @property {boolean} [primary=false] - Solid brand circle + white icon when true
 * @property {string} [ariaLabel] - Optional screen-reader override
 * @property {boolean} [disabled=false]
 */

/**
 * Reusable single quick-action column button (56x56 circle + 12.5px label).
 * The entire column is the tap target (>= 44px).
 * @param {QuickActionProps} props
 */
export const QuickAction = React.memo(function QuickAction({
  icon: Icon,
  label,
  onPress,
  primary = false,
  ariaLabel,
  disabled = false,
}) {
  return (
    <button
      type="button"
      className={`qa-item ${primary ? "is-primary" : ""}`}
      onClick={onPress}
      disabled={disabled}
      aria-label={ariaLabel || label}
    >
      <span className="qa-circle" aria-hidden="true">
        <Icon
          size={24}
          strokeWidth={1.75}
          aria-hidden="true"
          focusable="false"
        />
      </span>
      <span className="qa-label">{label}</span>
    </button>
  );
});

/**
 * @typedef {Object} QuickActionItem
 * @property {string} id
 * @property {React.ComponentType<any>} icon
 * @property {string} label
 * @property {() => void} onPress
 * @property {boolean} [primary]
 * @property {string} [ariaLabel]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {Object} QuickActionsRowProps
 * @property {QuickActionItem[]} [actions] - Custom action list override
 * @property {() => void} [onAddMoney] - Handler for Income ("Add money")
 * @property {() => void} [onSend] - Handler for Transfer ("Send")
 * @property {() => void} [onAdjust] - Handler for Adjust ("Adjust")
 * @property {() => void} [onCardOptions] - Handler for Card Options ("Cards")
 * @property {boolean} [highlightSend=false] - Set true to style "Send" as solid brand primary
 * @property {number} [activeDotIndex=0] - Active page dot (0-3)
 * @property {number} [dotCount=4] - Total page indicator dots
 * @property {boolean} [showDots=true] - Show 4-dot page indicator above the row
 */

/**
 * Horizontal row of 4 equal-width quick actions with optional 4-dot page indicator above.
 * @param {QuickActionsRowProps} props
 */
export const QuickActionsRow = React.memo(function QuickActionsRow({
  actions,
  onAddMoney,
  onSend,
  onAdjust,
  onCardOptions,
  highlightSend = false,
  activeDotIndex = 0,
  dotCount = 4,
  showDots = true,
}) {
  const resolvedActions = React.useMemo(
    () =>
      actions || [
        {
          id: "income",
          icon: ArrowDownToLine || FallbackIcons.Income,
          label: "Add money",
          onPress: onAddMoney,
        },
        {
          id: "transfer",
          icon: ArrowLeftRight || FallbackIcons.Transfer,
          label: "Send",
          primary: highlightSend,
          onPress: onSend,
        },
        {
          id: "adjust",
          icon: SlidersHorizontal || FallbackIcons.Adjust,
          label: "Adjust",
          onPress: onAdjust,
        },
        {
          id: "cards",
          icon: CreditCard || FallbackIcons.Card,
          label: "Cards",
          ariaLabel: "Card options",
          onPress: onCardOptions,
        },
      ],
    [actions, onAddMoney, onSend, onAdjust, onCardOptions, highlightSend],
  );

  return (
    <section className="qa-section" aria-label="Quick actions">
      {showDots && (
        <div className="qa-dots" aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, idx) => (
            <span
              key={idx}
              className={`qa-dot ${idx === activeDotIndex ? "is-active" : ""}`}
            />
          ))}
        </div>
      )}

      <div className="qa-row">
        {resolvedActions.map((action) => (
          <QuickAction
            key={action.id || action.label}
            icon={action.icon}
            label={action.label}
            primary={Boolean(action.primary)}
            ariaLabel={action.ariaLabel}
            disabled={action.disabled}
            onPress={action.onPress}
          />
        ))}
      </div>
    </section>
  );
});

export { renderProviderLogo, triggerHaptic };

/* ───────────── Currency & Number Formatters ───────────── */
const moneyFormatterInt = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const moneyFormatterDec = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const cashFormatterIntEn = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const cashFormatterDecEn = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatMoney = (n) => {
  const num = Number(n) || 0;
  const absNum = Math.abs(num);
  const hasFraction = Math.round(absNum * 100) % 100 !== 0;
  const formatted = (
    hasFraction ? moneyFormatterDec : moneyFormatterInt
  ).format(absNum);
  return `${num < 0 ? "-৳" : "৳"}${formatted}`;
};

export const formatCashMoney = (n, currencyCode = "BDT") => {
  const meta = getCashCurrencyMeta(currencyCode);
  const num = Number(n) || 0;
  const absNum = Math.abs(num);
  const useSouthAsian = meta.code === "BDT" || meta.code === "INR";
  const noDecimals = meta.code === "JPY";
  const hasFraction = !noDecimals && Math.round(absNum * 100) % 100 !== 0;
  const formatter = useSouthAsian
    ? hasFraction
      ? moneyFormatterDec
      : moneyFormatterInt
    : hasFraction
      ? cashFormatterDecEn
      : cashFormatterIntEn;
  return `${num < 0 ? "-" : ""}${meta.symbol}${formatter.format(absNum)}`;
};

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
    const d = digits.slice(0, 11);
    if (showFull) {
      if (d.length > 5) {
        return `${d.slice(0, 5)} ${d.slice(5)}`;
      }
      return d;
    }
    if (d.length >= 8) {
      return `${d.slice(0, 5)} •••• ${d.slice(-2)}`;
    }
    if (d.length > 5) {
      return `${d.slice(0, 5)} ${d.slice(5)}`;
    }
    return d;
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
const LEGACY_CARD_SUBTITLES = new Set([
  "High-Yield Vault · BDT",
  "High-Yield Vault",
  "Personal Vault · BDT",
  "Personal Card",
  "Custom Card Visa",
  "Custom Card Mastercard",
  "Custom Card Card",
  "Cash in Hand · BDT",
  "CASH IN HAND · BDT",
]);

const formatAbsMoneyNumber = (n) => {
  const num = Number(n) || 0;
  const absNum = Math.abs(num);
  const hasFraction = Math.round(absNum * 100) % 100 !== 0;
  return (hasFraction ? moneyFormatterDec : moneyFormatterInt).format(absNum);
};

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
  const gradient = resolveCardGradient(card, provider);
  const isMfs = card.type === "mfs" || provider?.category === "mfs";
  const isSavings =
    card.type === "savings" ||
    card.category === "savings" ||
    card.provider === "savings" ||
    provider?.category === "savings";
  const isCash =
    card.id === "cash" ||
    card.type === "cash" ||
    card.category === "cash" ||
    card.provider === "cash" ||
    provider?.category === "cash";
  const isVirtualVisa = card.provider === "virtual_visa";
  const isVirtualMc = card.provider === "virtual_mc";
  const isVirtual = isVirtualVisa || isVirtualMc;
  const isGold = card.provider === "gold_mc";
  const isCustom =
    !isCash &&
    (card.provider === "custom" || (!provider && !isSavings && !isMfs));
  const isFrozen = Boolean(card.frozen);

  const formattedNumber = formatCardNumber(
    card.number || card.last4 || "",
    isMfs,
    showFullDetails,
    isSavings,
  );

  const isCredit =
    !isSavings &&
    !isMfs &&
    !isCash &&
    String(card.type || "").toLowerCase() === "credit";

  const isLegacyProviderSubtitle =
    LEGACY_CARD_SUBTITLES.has(card.subtitle) ||
    ((isGold || isVirtualMc) &&
      (card.subtitle === "Mastercard Credit · USD" ||
        card.subtitle === "Mastercard Credit · BDT")) ||
    (isVirtualVisa &&
      (card.subtitle === "Visa Debit · USD" ||
        card.subtitle === "Visa Debit · BDT"));

  const cashMeta = isCash ? getCashCurrencyMeta(card.currency) : null;
  const rawSubtitle =
    card.subtitle && !isLegacyProviderSubtitle
      ? isCash
        ? String(card.subtitle)
        : String(card.subtitle).replace(/\bUSD\b/gi, "BDT")
      : "";
  const cardSubtitle =
    (isCash ? `Cash in hand · ${cashMeta.code}` : rawSubtitle) ||
    (isCash
      ? `Cash in hand · ${cashMeta.code}`
      : isMfs
        ? "Personal"
        : isSavings
          ? "Personal Savings"
          : isGold
            ? "Gold Credit · BDT"
            : isVirtualVisa
              ? "Virtual Debit · BDT"
              : isVirtualMc
                ? "Virtual Credit · BDT"
                : isCustom
                  ? "Signature Edition"
                  : isCredit
                    ? "Visa Credit · BDT"
                    : "Debit Card · BDT");

  const resolvedHolderName = isCash
    ? !card.holderName ||
      /^(cash\s*wallet|cash)$/i.test(String(card.holderName).trim())
      ? "Cash wallet"
      : card.holderName
    : card.holderName || card.name || "Cardholder";

  const formattedBalanceStr = isCash
    ? formatCashMoney(balance || 0, cashMeta.code)
    : formatMoney(balance || 0);
  const useSouthAsianCashFmt =
    cashMeta?.code === "BDT" || cashMeta?.code === "INR";
  const noCashDecimals = cashMeta?.code === "JPY";
  const absCashVal = Math.abs(Number(balance) || 0);
  const hasCashFraction =
    !noCashDecimals && Math.round(absCashVal * 100) % 100 !== 0;
  const formattedCashAbsStr = isCash
    ? (useSouthAsianCashFmt
        ? hasCashFraction
          ? moneyFormatterDec
          : moneyFormatterInt
        : hasCashFraction
          ? cashFormatterDecEn
          : cashFormatterIntEn
      ).format(absCashVal)
    : formatAbsMoneyNumber(balance || 0);
  const cashBalLengthClass = isCash
    ? formattedBalanceStr.length > 12
      ? " is-ultra-compact-cash"
      : formattedBalanceStr.length > 9
        ? " is-compact-cash"
        : ""
    : "";

  const rawSavingsStr = String(card.number || card.last4 || "").trim();
  const savingsRawDigits = rawSavingsStr.replace(/\D/g, "");
  const hasExplicitVaultPrefix =
    rawSavingsStr.startsWith("SAV-") ||
    rawSavingsStr.startsWith("VAULT-") ||
    rawSavingsStr.startsWith("DPS-");
  const savingsLast4 = savingsRawDigits ? savingsRawDigits.slice(-4) : "";
  const savingsRefFull = isSavings
    ? hasExplicitVaultPrefix
      ? rawSavingsStr
      : savingsRawDigits
        ? `SAV-${savingsRawDigits}`
        : "SAV-4710"
    : "";

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-currency={isCash ? cashMeta.code : undefined}
      aria-label={`${card.name}, ${cardSubtitle}, balance ${formattedBalanceStr}${isFrozen ? ", locked" : ""}`}
      className={`wallet-card ${isActive ? "is-active" : ""} ${isCash ? "is-cash" : ""} ${isMfs ? "is-mfs" : ""} ${isSavings ? "is-savings" : ""} ${isGold ? "is-gold" : ""} ${isVirtual ? "is-virtual" : ""} ${isVirtualVisa ? "is-virtual-visa" : ""} ${isVirtualMc ? "is-virtual-mc" : ""} ${isCustom ? "is-custom" : ""} ${isFrozen ? "is-frozen" : ""} ${className}`}
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
        ...(isCash
          ? {
              "--cash-bg": cashMeta.bg,
              "--cash-accent": cashMeta.accent,
              "--cash-muted": cashMeta.muted,
              "--cash-font": cashMeta.font,
              "--cash-mark-font": cashMeta.markFont,
            }
          : {}),
        ...style,
      }}
    >
      {isCash ? (
        <>
          <i className="cash-card-tk cash-card-tk-o" aria-hidden="true">
            {cashMeta.symbol}
          </i>
          <i className="cash-card-tk cash-card-tk-f" aria-hidden="true">
            {cashMeta.symbol}
          </i>
          <div className="cash-card-in">
            <div className="cash-card-top">
              <div>
                <b>{resolvedHolderName}</b>
                <span className="cash-card-sub">
                  {cardSubtitle}
                  {card.isPrimary && (
                    <span className="wallet-card-primary-badge">PRIMARY</span>
                  )}
                  {isFrozen && (
                    <span className="wallet-card-locked-badge">LOCKED</span>
                  )}
                </span>
              </div>
              {showBalance && (
                <span
                  className={`cash-card-st ${balance < 0 ? "is-overdrawn" : "is-available"}`}
                >
                  {balance < 0 ? "Overdrawn" : "Available"}
                </span>
              )}
            </div>
            {showBalance && (
              <div>
                <span className="cash-card-lbl">Cash on hand</span>
                <div
                  className={`cash-card-bal${balance < 0 ? " is-overdrawn" : ""}${cashBalLengthClass}`}
                >
                  {balance < 0 ? "−" : ""}
                  <em>{cashMeta.symbol}</em>
                  {formattedCashAbsStr}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="wallet-card-surface">
          {/* Holographic light sheen & ambient pattern */}
          <div className="wallet-card-sheen" aria-hidden="true" />
          <div className="wallet-card-pattern" aria-hidden="true" />

          {/* Bespoke Vector Surface Geometry — Each Card Type Has Its Own Unique Visual Language */}
          {isSavings && (
            <svg
              className="wallet-card-artwork is-savings-art"
              viewBox="0 0 326 206"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="268"
                cy="56"
                r="116"
                fill="rgba(167, 243, 208, 0.045)"
                stroke="rgba(167, 243, 208, 0.08)"
                strokeWidth="1"
              />
              <circle
                cx="268"
                cy="56"
                r="82"
                fill="rgba(16, 185, 129, 0.06)"
                stroke="rgba(167, 243, 208, 0.1)"
                strokeWidth="1"
              />
              <circle cx="268" cy="56" r="48" fill="rgba(2, 44, 34, 0.34)" />
            </svg>
          )}
          {isGold && (
            <svg
              className="wallet-card-artwork is-gold-art"
              viewBox="0 0 326 206"
              fill="none"
              aria-hidden="true"
            >
              {/* Minimalist Bullion Nested Diamond Outline */}
              <path
                d="M254 54L302 103L254 152L206 103L254 54Z"
                stroke="rgba(43, 30, 8, 0.16)"
                strokeWidth="1"
              />
              <path
                d="M254 76L280 103L254 130L228 103L254 76Z"
                stroke="rgba(43, 30, 8, 0.14)"
                strokeWidth="1"
              />
            </svg>
          )}
          {isVirtualVisa && (
            <svg
              className="wallet-card-artwork is-virtual-visa-art"
              viewBox="0 0 326 206"
              fill="none"
              aria-hidden="true"
            >
              {/* Subtle Aero Dual Horizon Wave Lines */}
              <path
                d="M-10 148C86 132 198 158 336 138L336 216L-10 216Z"
                fill="rgba(11, 107, 97, 0.035)"
              />
              <path
                d="M-10 146C86 132 198 156 336 138"
                stroke="rgba(11, 107, 97, 0.14)"
                strokeWidth="1"
              />
              <path
                d="M-10 156C94 142 204 166 336 148"
                stroke="rgba(11, 107, 97, 0.1)"
                strokeWidth="1"
              />
            </svg>
          )}
          {isVirtualMc && (
            <svg
              className="wallet-card-artwork is-virtual-mc-art"
              viewBox="0 0 326 206"
              fill="none"
              aria-hidden="true"
            >
              {/* Clean Overlapping Translucent Stealth Planes */}
              <rect
                x="246"
                y="48"
                width="94"
                height="68"
                rx="12"
                fill="rgba(165, 180, 252, 0.03)"
                stroke="rgba(165, 180, 252, 0.16)"
                strokeWidth="1"
              />
              <rect
                x="262"
                y="78"
                width="94"
                height="68"
                rx="12"
                fill="rgba(165, 180, 252, 0.035)"
                stroke="rgba(165, 180, 252, 0.14)"
                strokeWidth="1"
              />
            </svg>
          )}

          {/* Top Row: Card Title/Holder (Left) + Refined Brand Mark (Right) */}
          <div className="wallet-card-header">
            <div className="wallet-card-holder-info">
              <span className="wallet-card-holder-name">
                {resolvedHolderName}
              </span>
              <span className="wallet-card-type-tag">
                <span className="wallet-card-subtitle-text">
                  {cardSubtitle}
                </span>
                {card.isPrimary && (
                  <span className="wallet-card-primary-badge">PRIMARY</span>
                )}
                {isFrozen && (
                  <span className="wallet-card-locked-badge">LOCKED</span>
                )}
              </span>
            </div>

            <div className="wallet-card-brand-logo">
              {renderProviderLogo(card.provider, {
                height: isSavings ? 21 : 22,
              })}
            </div>
          </div>

          {/* Middle Section: Bespoke per-card-type geometry (No white HR on Savings) */}
          {isSavings ? (
            <div className="wallet-card-savings-mid">
              <div className="wallet-card-savings-meta-row">
                <span className="wallet-card-savings-status">
                  <span
                    className="wallet-card-savings-dot"
                    aria-hidden="true"
                  />
                  {isFrozen ? "VAULT LOCKED" : "RESERVE VAULT"}
                </span>
                {(savingsLast4 || savingsRefFull) && (
                  <span className="wallet-card-savings-ref">
                    {showFullDetails ? (
                      savingsRefFull
                    ) : savingsLast4 ? (
                      <>
                        <span
                          className="wallet-card-savings-dots"
                          aria-hidden="true"
                        >
                          ••
                        </span>
                        <span>{savingsLast4}</span>
                      </>
                    ) : (
                      savingsRefFull
                    )}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="wallet-card-mid">
                {!isMfs && !isVirtual && (
                  <div className="wallet-card-chip-cluster">
                    <EmvChip
                      size={32}
                      variant={isCustom || isGold ? "wireframe" : "gold"}
                      strokeColor={
                        isGold
                          ? "rgba(43, 30, 8, 0.5)"
                          : isCustom
                            ? "rgba(255, 255, 255, 0.36)"
                            : undefined
                      }
                      fillColor={
                        isGold
                          ? "rgba(43, 30, 8, 0.06)"
                          : "rgba(255, 255, 255, 0.075)"
                      }
                      centerFillColor={
                        isGold
                          ? "rgba(229, 193, 108, 0.55)"
                          : "rgba(255, 255, 255, 0.04)"
                      }
                    />
                    <ContactlessWaves
                      size={15}
                      tone={isGold ? "bronze" : "light"}
                      className="wallet-card-contactless"
                    />
                  </div>
                )}
                {isVirtualVisa && (
                  <div className="wallet-card-virtual-cluster is-visa-digital">
                    <span className="wallet-card-virtual-pill is-aero">
                      <svg
                        width="11"
                        height="11"
                        style={{
                          width: 11,
                          height: 11,
                          display: "block",
                          stroke: "none",
                        }}
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M13 2L4.5 13.5H11.5L10.5 22L19.5 10.5H12.5L13 2Z"
                          fill="#0B6B61"
                        />
                      </svg>
                      <span>INSTANT DEBIT</span>
                    </span>
                    <ContactlessWaves
                      size={14}
                      tone="teal"
                      className="wallet-card-contactless is-virtual-nfc"
                    />
                  </div>
                )}
                {isVirtualMc && (
                  <div className="wallet-card-virtual-cluster is-mc-digital">
                    <span className="wallet-card-virtual-pill is-stealth">
                      <svg
                        width="11"
                        height="11"
                        style={{
                          width: 11,
                          height: 11,
                          display: "block",
                          stroke: "none",
                        }}
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 2.5L19 5.8V11.5C19 16.4 15.9 20.6 12 22C8.1 20.6 5 16.4 5 11.5V5.8L12 2.5Z"
                          stroke="#A5B4FC"
                          strokeWidth="2"
                          fill="rgba(165, 180, 252, 0.16)"
                        />
                      </svg>
                      <span>DISPOSABLE KEY</span>
                    </span>
                    <ContactlessWaves
                      size={14}
                      className="wallet-card-contactless is-virtual-nfc"
                    />
                  </div>
                )}
              </div>

              {/* Card / Account Number in Refined Monospace */}
              <div className="wallet-card-number">
                {formattedNumber || (
                  <span className="wallet-card-num-placeholder">
                    {isMfs ? "01712 345678" : "•••• •••• •••• ••••"}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Bottom Row: Balance & Expiry (Left) + Bank Network Emblem Only (Right) */}
          <div className="wallet-card-footer">
            <div className="wallet-card-footer-left">
              {showBalance && (
                <div className="wallet-card-balance-block">
                  <span className="wallet-card-meta-lbl">
                    {isSavings
                      ? "TOTAL SAVED"
                      : isCredit
                        ? "AMOUNT OWED"
                        : "BALANCE"}
                  </span>
                  <b
                    className={`wallet-card-balance-val${balance < 0 && !isCredit ? " is-overdrawn" : ""}`}
                  >
                    {formattedBalanceStr}
                    {balance < 0 && !isCredit && (
                      <span className="wallet-card-overdrawn-badge">
                        OVERDRAWN
                      </span>
                    )}
                    {balance < 0 && isCredit && (
                      <span className="wallet-card-overdrawn-badge">
                        IN CREDIT
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

            {!isMfs && !isSavings && (
              <div className="wallet-card-network">
                {!isGold && card.network === "visa" && (
                  <VisaBadge
                    width={44}
                    height={15}
                    variant={isVirtualVisa ? "navy" : "auto"}
                  />
                )}
                {(isGold || card.network === "mastercard") && (
                  <MastercardBadge
                    width={34}
                    height={22}
                    variant={isGold ? "bronze" : "default"}
                  />
                )}
                {!isGold && card.network === "amex" && (
                  <AmexBadge width={38} height={17} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
  showDots = false,
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
    <div
      className="cards-deck-container"
      onWheel={onWheel}
      style={{
        "--cards-deck-top-padding": `${Math.ceil(
          14 + Math.min(totalCards - 1, 2) * SLIVER_OFFSET,
        )}px`,
      }}
    >
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
      {showDots && (
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
      )}
    </div>
  );
}
