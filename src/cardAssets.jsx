import bracBankSvg from "./assets/payment-logos/brac-bank.svg";
import cityBankImg from "./assets/payment-logos/city-bank.png";
import dbblImg from "./assets/payment-logos/dbbl.png";
import eblSvg from "./assets/payment-logos/ebl.svg";
import mastercardSvg from "./assets/payment-logos/mastercard.svg";
import nagadImg from "./assets/payment-logos/nagad.png";
import rocketImg from "./assets/payment-logos/rocket.png";
import scbImg from "./assets/payment-logos/scb.png";
import upayImg from "./assets/payment-logos/upay.png";
import visaImg from "./assets/payment-logos/visa.png";
import bkashSvg from "./assets/payment-logos/bkash.svg";
import amexSvg from "./assets/payment-logos/amex.svg";
import savingsPiggySvg from "./assets/payment-logos/savings-piggy.svg";
import contactlessImg from "./assets/payment-logos/contactless.png";

/* ───────────── Pixel-Perfect Payment & Bank Logos ───────────── */

/**
 * Official bKash Logo
 * Pure white origami bird + official bKash wordmark
 */
export function BkashLogo({ className = "", height = 24 }) {
  return (
    <div
      className={`card-brand-cluster ${className}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, height }}
    >
      <img
        src={bkashSvg}
        alt="bKash"
        loading="lazy"
        decoding="async"
        style={{
          height: Math.round(height * 0.95),
          width: "auto",
          objectFit: "contain",
          filter: "brightness(0) invert(1)",
        }}
      />
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize: Math.round(height * 0.68),
          letterSpacing: "-0.03em",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        bKash
      </span>
    </div>
  );
}

/**
 * Official Nagad Logo
 */
export function NagadLogo({ className = "", height = 24 }) {
  return (
    <img
      src={nagadImg}
      alt="Nagad"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official DBBL Rocket Logo
 */
export function RocketLogo({ className = "", height = 24 }) {
  return (
    <img
      src={rocketImg}
      alt="Rocket"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter:
          "brightness(0) invert(1) drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official Upay Logo
 */
export function UpayLogo({ className = "", height = 24 }) {
  return (
    <img
      src={upayImg}
      alt="Upay"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official BRAC Bank Logo (from vector brac-bank.svg)
 */
export function BracBankLogo({ className = "", height = 24 }) {
  return (
    <img
      src={bracBankSvg}
      alt="BRAC Bank"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter:
          "brightness(0) invert(1) drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official City Bank Logo
 */
export function CityBankLogo({ className = "", height = 24 }) {
  return (
    <img
      src={cityBankImg}
      alt="City Bank"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official Eastern Bank PLC Logo (from vector ebl.svg)
 */
export function EblLogo({ className = "", height = 24 }) {
  return (
    <img
      src={eblSvg}
      alt="Eastern Bank"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official Dutch-Bangla Bank Logo (from png dbbl.png)
 */
export function DbblLogo({ className = "", height = 24 }) {
  return (
    <img
      src={dbblImg}
      alt="DBBL"
      loading="lazy"
      decoding="async"
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

/**
 * Official Standard Chartered Bank Logo
 */
export function StandardCharteredLogo({ className = "", height = 24 }) {
  return (
    <div
      className={`card-brand-cluster ${className}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height }}
    >
      <img
        src={scbImg}
        alt="Standard Chartered"
        loading="lazy"
        decoding="async"
        style={{
          height,
          width: "auto",
          maxHeight: height,
          objectFit: "contain",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span
          style={{
            color: "#ffffff",
            fontWeight: 800,
            fontSize: Math.round(height * 0.42),
            letterSpacing: "-0.01em",
          }}
        >
          standard
        </span>
        <span
          style={{
            color: "#ffffff",
            fontWeight: 800,
            fontSize: Math.round(height * 0.42),
            letterSpacing: "-0.01em",
          }}
        >
          chartered
        </span>
      </div>
    </div>
  );
}

/**
 * Official Amazon Logo (Video Front Card)
 */
export function AmazonLogo({ className = "", height = 24 }) {
  const width = Math.round(height * 3.3);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      viewBox="0 0 100 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Amazon"
    >
      <text
        x="2"
        y="18"
        fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="18"
        fontWeight="800"
        letterSpacing="-0.03em"
      >
        amazon
      </text>
      <path
        d="M8 22C24 28 54 28 68 20"
        stroke="#FF9900"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M64 18L70 20L66 24"
        stroke="#FF9900"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Official Citi Logo (Video Citi Card)
 */
export function CitiLogo({ className = "", height = 24 }) {
  const width = Math.round(height * 2.2);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      viewBox="0 0 66 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Citi"
    >
      <path
        d="M19 12C28 4 44 4 53 12"
        stroke="#ED1C24"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <text
        x="6"
        y="25"
        fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="22"
        fontWeight="850"
        letterSpacing="-0.03em"
      >
        citi
      </text>
    </svg>
  );
}

/**
 * Official HDFC Bank Logo
 */
export function HdfcLogo({ className = "", height = 24 }) {
  const width = Math.round(height * 3.8);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      viewBox="0 0 114 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="HDFC Bank"
    >
      <g transform="translate(2, 4) scale(0.72)">
        <rect x="0" y="0" width="30" height="30" rx="3" fill="#004C8F" />
        <rect x="10" y="0" width="10" height="30" fill="#ED232A" />
        <rect x="0" y="10" width="30" height="10" fill="#ED232A" />
        <rect x="10" y="10" width="10" height="10" fill="#FFFFFF" />
      </g>
      <text
        x="30"
        y="18"
        fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="11.5"
        fontWeight="900"
        letterSpacing="0.04em"
      >
        HDFC BANK
      </text>
    </svg>
  );
}

/**
 * Official Savings Vault Piggy Bank Logo (Matching images.png)
 */
export function SavingsLogo({ className = "", height = 24 }) {
  return (
    <div className={`card-vault-badge ${className}`}>
      <img
        src={savingsPiggySvg}
        alt="Savings Vault"
        className="card-vault-piggy-img"
        style={{ height }}
      />
      <span className="card-vault-badge-text">VAULT</span>
    </div>
  );
}

/* ───────────── Official Payment Networks (Visa / Mastercard / Amex) ───────────── */

/**
 * High-Res Official Visa Logo from payment-logos/visa.png
 */
export function VisaBadge({
  className = "",
  height = 18,
  width,
  variant = "auto",
}) {
  const isAdaptive = variant === "adaptive";
  return (
    <img
      src={visaImg}
      alt="Visa"
      className={`card-network-badge ${className}`}
      style={{
        height,
        width: width || "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: isAdaptive
          ? "var(--visa-badge-filter, brightness(0))"
          : "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
      }}
    />
  );
}

/**
 * High-Res Official Mastercard Logo from payment-logos/mastercard.svg
 */
export function MastercardBadge({ className = "", height = 24, width }) {
  return (
    <img
      src={mastercardSvg}
      alt="Mastercard"
      className={`card-network-badge ${className}`}
      style={{
        height,
        width: width || "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
      }}
    />
  );
}

/**
 * High-Res Official American Express Logo from payment-logos/amex.svg
 */
export function AmexBadge({ className = "", height = 20, width }) {
  return (
    <img
      src={amexSvg}
      alt="American Express"
      className={`card-network-badge ${className}`}
      style={{
        height,
        width: width || "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
      }}
    />
  );
}

/**
 * Realistic Gold EMV Smart Chip
 */
export function EmvChip({ className = "", size = 30 }) {
  return (
    <svg
      className={`card-emv-chip ${className}`}
      width={size}
      height={Math.round(size * 0.74)}
      viewBox="0 0 52 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="50"
        height="38"
        rx="7"
        fill="url(#emv-gold-grad)"
        stroke="#8C651A"
        strokeWidth="1.2"
      />
      <path
        d="M1 14H18M1 26H18M34 14H51M34 26H51M26 1V14M26 26V39"
        stroke="#7A5612"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <rect
        x="18"
        y="12"
        width="16"
        height="16"
        rx="3"
        fill="url(#emv-center-grad)"
        stroke="#7A5612"
        strokeWidth="1"
      />
      <defs>
        <linearGradient
          id="emv-gold-grad"
          x1="0"
          y1="0"
          x2="52"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F9E29D" />
          <stop offset="0.3" stopColor="#E4BA62" />
          <stop offset="0.7" stopColor="#D5A23C" />
          <stop offset="1" stopColor="#B38025" />
        </linearGradient>
        <linearGradient
          id="emv-center-grad"
          x1="18"
          y1="12"
          x2="34"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFECA8" />
          <stop offset="1" stopColor="#C99432" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Official Real Contactless Payment Waves Indicator (from contactless.png)
 */
export function ContactlessWaves({
  className = "",
  size = 18,
  height,
  width,
  style = {},
}) {
  const h = height || size;
  return (
    <img
      src={contactlessImg}
      alt="Contactless"
      className={`card-contactless-waves ${className}`}
      style={{
        height: h,
        width: width || "auto",
        maxHeight: h,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
        opacity: 0.9,
        ...style,
      }}
    />
  );
}

import { CARD_PROVIDERS, getProviderMeta } from "./cardProviders.js";
export { CARD_PROVIDERS, getProviderMeta };

export function renderProviderLogo(
  providerId,
  { height = 24, className = "" } = {},
) {
  switch (providerId) {
    case "amazon":
      return <AmazonLogo height={height} className={className} />;
    case "citi":
    case "citi_mc":
    case "citi_credit":
      return <CitiLogo height={height} className={className} />;
    case "hdfc":
    case "hdfc_visa":
    case "hdfc_credit":
      return <HdfcLogo height={height} className={className} />;
    case "sc_visa":
    case "sc":
      return <StandardCharteredLogo height={height} className={className} />;
    case "gold_mc":
      return (
        <span
          className={`card-generic-logo ${className}`}
          style={{
            color: "#FDE68A",
            fontWeight: 900,
            letterSpacing: "0.08em",
            fontSize: 13,
          }}
        >
          GOLD
        </span>
      );
    case "virtual_mc":
    case "virtual_visa":
      return (
        <span
          className={`card-generic-logo ${className}`}
          style={{
            color: "rgba(255,255,255,0.9)",
            fontWeight: 900,
            letterSpacing: "0.1em",
            fontSize: 11,
          }}
        >
          VIRTUAL
        </span>
      );
    case "bkash":
      return <BkashLogo height={height} className={className} />;
    case "nagad":
      return <NagadLogo height={height} className={className} />;
    case "rocket":
      return <RocketLogo height={height} className={className} />;
    case "upay":
      return <UpayLogo height={height} className={className} />;
    case "brac":
      return <BracBankLogo height={height} className={className} />;
    case "city":
      return <CityBankLogo height={height} className={className} />;
    case "ebl":
      return <EblLogo height={height} className={className} />;
    case "dbbl":
      return <DbblLogo height={height} className={className} />;
    case "savings":
      return <SavingsLogo height={height} className={className} />;
    case "amex":
      return <AmexBadge height={height} className={className} />;
    default:
      return (
        <span
          className={`card-generic-logo ${className}`}
          style={{ color: "#ffffff", fontWeight: 800 }}
        >
          BANK
        </span>
      );
  }
}

/**
 * Senior Native App Dev Grade Mini Card Preview (56px × 35px)
 * Designed with authentic physical credit card ratio (1.586:1), hairline metallic border,
 * specular gloss sheen, micro EMV chip / contactless indicator, SF Mono masked digits,
 * and vector network emblems (Mastercard dual interlocking circles, Visa italic wordmark, etc.)
 */
export function MiniCardPreview({ provider, card, className = "" }) {
  const isCash = card?.id === "cash" || card?.type === "cash";
  const provId = card?.provider || card?.id;
  const p =
    provider || (provId ? getProviderMeta(provId) : null) || CARD_PROVIDERS[0];
  const network = card?.network || p?.defaultNetwork || "visa";
  const category = card?.category || p?.category || "bank";
  const isMfs =
    !isCash &&
    (category === "mfs" ||
      card?.type === "mfs" ||
      network === "mfs" ||
      Boolean(card?.isPhone || p?.isPhone));
  const isSavings =
    !isCash &&
    (category === "savings" ||
      card?.type === "savings" ||
      p?.id === "savings" ||
      provId === "savings");
  const gradient = isCash
    ? "linear-gradient(135deg, #10b981 0%, #059669 60%, #047857 100%)"
    : card?.gradient ||
      p?.gradient ||
      card?.color ||
      "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";

  // Extract last 4 digits or masked identifier
  const rawNum = card?.last4 || card?.number || p?.numberPlaceholder || "4328";
  const cleanDigits = String(rawNum).replace(/\D/g, "");
  const last4 =
    cleanDigits.slice(-4) ||
    (p?.numberPrefix ? p.numberPrefix.slice(-4) : "4328");

  const brandKey = provId || p?.id || "";

  return (
    <div
      className={`mini-card-preview ${isCash ? "is-cash" : ""} ${className}`}
      style={{ background: gradient }}
      aria-hidden="true"
    >
      <div className="mini-card-sheen" />
      <div className="mini-card-pattern" />

      {/* Top Row: Micro EMV Chip + Waves (Left) & Brand Mark (Right) */}
      <div className="mini-card-top-row">
        {isCash ? (
          <span className="mini-card-cash-symbol">৳</span>
        ) : isMfs ? (
          <div className="mini-card-mfs-brand">
            {brandKey === "bkash" && (
              <img
                src={bkashSvg}
                alt="bKash"
                style={{
                  height: 10,
                  width: "auto",
                  filter: "brightness(0) invert(1)",
                }}
              />
            )}
            {brandKey === "nagad" && (
              <img
                src={nagadImg}
                alt="Nagad"
                style={{ height: 10, width: "auto" }}
              />
            )}
            {brandKey === "rocket" && (
              <img
                src={rocketImg}
                alt="Rocket"
                style={{
                  height: 10,
                  width: "auto",
                  filter: "brightness(0) invert(1)",
                }}
              />
            )}
            {brandKey === "upay" && (
              <img
                src={upayImg}
                alt="Upay"
                style={{ height: 10, width: "auto" }}
              />
            )}
            {!["bkash", "nagad", "rocket", "upay"].includes(brandKey) && (
              <ContactlessWaves size={8} className="mini-card-contactless" />
            )}
          </div>
        ) : isSavings ? (
          <div className="mini-card-savings-brand">
            <img
              src={savingsPiggySvg}
              alt="Savings"
              style={{ height: 11, width: "auto" }}
            />
          </div>
        ) : (
          <div className="mini-card-chip-waves">
            <svg
              className="mini-card-emv"
              width="10"
              height="7.5"
              viewBox="0 0 20 15"
              fill="none"
            >
              <rect
                x="0.5"
                y="0.5"
                width="19"
                height="14"
                rx="2.5"
                fill="#E5C158"
                stroke="#9A7B1C"
                strokeWidth="1"
              />
              <path
                d="M0.5 5.5H7.5M0.5 9.5H7.5M12.5 5.5H19.5M12.5 9.5H19.5M9.5 0.5V5.5M9.5 9.5V14.5"
                stroke="#7A5612"
                strokeWidth="0.8"
              />
              <rect
                x="7"
                y="4.5"
                width="6"
                height="6"
                rx="1"
                fill="#FFEAA0"
                stroke="#7A5612"
                strokeWidth="0.7"
              />
            </svg>
            <ContactlessWaves size={7.5} className="mini-card-contactless" />
          </div>
        )}

        {!isCash && !isMfs && !isSavings && (
          <div className="mini-card-brand-mark">
            {(brandKey === "citi" ||
              brandKey === "citi_mc" ||
              brandKey === "citi_credit") && <CitiLogo height={8.5} />}
            {brandKey === "amazon" && <AmazonLogo height={8} />}
            {(brandKey === "hdfc" ||
              brandKey === "hdfc_visa" ||
              brandKey === "hdfc_credit") && <HdfcLogo height={7} />}
            {(brandKey === "sc" || brandKey === "sc_visa") && (
              <img
                src={scbImg}
                alt=""
                style={{ height: 9, width: "auto", objectFit: "contain" }}
              />
            )}
            {brandKey === "brac" && <BracBankLogo height={7.5} />}
            {brandKey === "city" && <CityBankLogo height={8} />}
            {brandKey === "ebl" && <EblLogo height={8} />}
            {brandKey === "dbbl" && <DbblLogo height={8} />}
            {brandKey === "gold_mc" && (
              <span className="mini-card-tier-tag is-gold">GOLD</span>
            )}
            {(brandKey === "virtual_mc" || brandKey === "virtual_visa") && (
              <span className="mini-card-tier-tag">VIRT</span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Row: Digits + Network Emblem */}
      <div className="mini-card-bottom-row">
        <span className="mini-card-digits">
          {isCash
            ? "CASH"
            : isMfs
              ? `•• ${last4.slice(-2) || "88"}`
              : isSavings
                ? "VAULT"
                : `•• ${last4}`}
        </span>

        <div className="mini-card-network-emblem">
          {!isCash && !isMfs && !isSavings && network === "mastercard" && (
            <svg width="14" height="9" viewBox="0 0 30 20" fill="none">
              <circle cx="10" cy="10" r="9.5" fill="#EB001B" />
              <circle
                cx="20"
                cy="10"
                r="9.5"
                fill="#F79E1B"
                fillOpacity="0.88"
              />
            </svg>
          )}
          {!isCash && !isMfs && !isSavings && network === "visa" && (
            <span className="mini-card-visa-text">VISA</span>
          )}
          {!isCash && !isMfs && !isSavings && network === "amex" && (
            <span className="mini-card-amex-text">AMEX</span>
          )}
          {isMfs && <span className="mini-card-mfs-text">MFS</span>}
          {isSavings && <span className="mini-card-vault-star">★</span>}
        </div>
      </div>
    </div>
  );
}
