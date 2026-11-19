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
import contactlessImg from "./assets/payment-logos/contactless.png";

/* ───────────── Authentic, Minimal Bank & MFS Brand Logos ───────────── */

/**
 * Official bKash Logo (Refined Minimal Scale)
 */
export function BkashLogo({ className = "", height = 22 }) {
  const birdH = Math.round(height * 0.88);
  return (
    <div
      className={`card-brand-cluster is-bkash ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(4, Math.round(height * 0.2)),
        height,
      }}
    >
      <span
        style={{
          color: "#ffffff",
          fontWeight: 800,
          fontSize: Math.round(height * 0.62),
          letterSpacing: "-0.03em",
          lineHeight: 1,
          fontFamily:
            '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
          textShadow: "0 1px 2px rgba(0,0,0,0.22)",
        }}
      >
        bKash
      </span>
      <img
        src={bkashSvg}
        alt="bKash"
        style={{
          height: birdH,
          width: "auto",
          maxHeight: birdH,
          maxWidth: "none",
          objectFit: "contain",
          display: "block",
          filter:
            "drop-shadow(0 0 1px rgba(255,255,255,0.85)) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
        }}
      />
    </div>
  );
}

/**
 * Official Nagad Logo (Refined Minimal Scale)
 */
export function NagadLogo({ className = "", height = 22 }) {
  const emblemSize = Math.round(height * 0.86);
  const fullWAtEmblem = Math.round(emblemSize * (410 / 144));

  const wordH = Math.round(height * 0.56);
  const fullHForWord = Math.round(wordH / 0.64);
  const fullWForWord = Math.round(fullHForWord * (410 / 144));
  const wordBoxW = Math.round(fullWForWord * 0.62);

  return (
    <div
      className={`card-brand-cluster is-nagad ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(4, Math.round(height * 0.18)),
        height,
      }}
      aria-label="Nagad"
    >
      <div
        style={{
          width: emblemSize,
          height: emblemSize,
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <img
          src={nagadImg}
          alt=""
          style={{
            height: emblemSize,
            width: fullWAtEmblem,
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
            filter:
              "drop-shadow(0 0 0.8px rgba(255,255,255,0.8)) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
          }}
        />
      </div>
      <div
        style={{
          width: wordBoxW,
          height: wordH,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <img
          src={nagadImg}
          alt="Nagad"
          style={{
            height: fullHForWord,
            width: fullWForWord,
            maxWidth: "none",
            maxHeight: "none",
            marginLeft: -Math.round(fullWForWord * 0.382),
            marginTop: -Math.round(fullHForWord * 0.14),
            display: "block",
            filter:
              "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official DBBL Rocket Logo (Refined Minimal Scale)
 */
export function RocketLogo({ className = "", height = 20 }) {
  const scaledH = Math.round(height * 0.88);
  const fullH = Math.round(scaledH / 0.85);
  const fullW = Math.round(fullH * (445 / 144));
  return (
    <div
      className={`card-brand-cluster is-rocket ${className}`}
      style={{
        width: fullW,
        height: scaledH,
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "flex-start",
        flexShrink: 0,
      }}
      aria-label="Rocket"
    >
      <img
        src={rocketImg}
        alt="Rocket"
        style={{
          height: fullH,
          width: fullW,
          maxWidth: "none",
          maxHeight: "none",
          display: "block",
          filter:
            "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.28))",
        }}
      />
    </div>
  );
}

/**
 * Official Upay Logo (Refined Minimal Scale)
 */
export function UpayLogo({ className = "", height = 22 }) {
  const iconH = Math.round(height * 0.84);
  const iconFullSize = Math.round(iconH / 0.58);
  const iconBoxW = Math.round(iconFullSize * 0.62);

  const wordH = Math.round(height * 0.52);
  const wordFullSize = Math.round(wordH / 0.28);
  const wordBoxW = Math.round(wordFullSize * 0.62);

  return (
    <div
      className={`card-brand-cluster is-upay ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(4, Math.round(height * 0.18)),
        height,
      }}
      aria-label="Upay"
    >
      <div
        style={{
          width: iconBoxW,
          height: iconH,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <img
          src={upayImg}
          alt=""
          style={{
            width: iconFullSize,
            height: iconFullSize,
            maxWidth: "none",
            maxHeight: "none",
            marginLeft: -Math.round(iconFullSize * 0.19),
            marginTop: -Math.round(iconFullSize * 0.07),
            display: "block",
            filter:
              "drop-shadow(0 0 1px rgba(255,255,255,0.88)) drop-shadow(0 1px 2px rgba(0,0,0,0.28))",
          }}
        />
      </div>
      <div
        style={{
          width: wordBoxW,
          height: wordH,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <img
          src={upayImg}
          alt="Upay"
          style={{
            width: wordFullSize,
            height: wordFullSize,
            maxWidth: "none",
            maxHeight: "none",
            marginLeft: -Math.round(wordFullSize * 0.19),
            marginTop: -Math.round(wordFullSize * 0.645),
            display: "block",
            filter:
              "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.26))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official BRAC Bank Logo (Refined Minimal Scale)
 */
export function BracBankLogo({ className = "", height = 22 }) {
  const emblemSize = Math.round(height * 0.8);
  const fullWAtEmblem = Math.round(emblemSize * 9.216);

  const wordH = Math.round(height * 0.45);
  const fullWAtWord = Math.round(wordH * 9.216);
  const wordOffsetLeft = Math.round(fullWAtWord * 0.134);
  const wordBoxW = Math.round(fullWAtWord * 0.415);

  return (
    <div
      className={`card-brand-cluster is-brac ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.2)),
        height,
      }}
      aria-label="BRAC"
    >
      <div
        style={{
          width: emblemSize,
          height: emblemSize,
          overflow: "hidden",
          borderRadius: 3.5,
          flexShrink: 0,
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
        }}
      >
        <img
          src={bracBankSvg}
          alt=""
          style={{
            height: emblemSize,
            width: fullWAtEmblem,
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
          }}
        />
      </div>
      <div
        style={{
          width: wordBoxW,
          height: wordH,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img
          src={bracBankSvg}
          alt="BRAC"
          style={{
            height: wordH,
            width: fullWAtWord,
            maxWidth: "none",
            maxHeight: "none",
            marginLeft: -wordOffsetLeft,
            display: "block",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official City Bank Logo (Refined Minimal Scale)
 */
export function CityBankLogo({ className = "", height = 22 }) {
  const kiteH = Math.round(height * 0.86);
  const kiteFullW = Math.round(kiteH * (237 / 160));
  const kiteBoxW = Math.round(kiteFullW * 0.56);
  const fontSize = Math.round(height * 0.5);

  return (
    <div
      className={`card-brand-cluster is-city ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(4, Math.round(height * 0.14)),
        height,
      }}
      aria-label="City Bank"
    >
      <div
        style={{
          width: kiteBoxW,
          height: kiteH,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <img
          src={cityBankImg}
          alt=""
          style={{
            height: kiteH,
            width: kiteFullW,
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
            clipPath:
              "polygon(0 0, 100% 0, 100% 63.5%, 18.2% 63.5%, 18.2% 100%, 0 100%)",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.28))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily:
            '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        CITY
      </span>
    </div>
  );
}

/**
 * Official Eastern Bank PLC Logo (Refined Minimal Scale)
 */
export function EblLogo({ className = "", height = 22 }) {
  const emblemH = Math.round(height * 0.84);
  const fullWAtEmblem = Math.round(emblemH * 6.18);
  const emblemBoxW = Math.round(fullWAtEmblem * 0.218);
  const fontSize = Math.round(height * 0.52);

  return (
    <div
      className={`card-brand-cluster is-ebl ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.2)),
        height,
      }}
      aria-label="EBL"
    >
      <div
        style={{
          width: emblemBoxW,
          height: emblemH,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img
          src={eblSvg}
          alt=""
          style={{
            height: emblemH,
            width: fullWAtEmblem,
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.24))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily:
            '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        EBL
      </span>
    </div>
  );
}

/**
 * Official Dutch-Bangla Bank Logo (Refined Minimal Scale)
 */
export function DbblLogo({ className = "", height = 22 }) {
  const globeH = Math.round(height * 0.84);
  const fullWAtGlobe = Math.round(globeH * (625 / 120));
  const globeBoxW = Math.round(fullWAtGlobe * 0.302);
  const fontSize = Math.round(height * 0.52);

  return (
    <div
      className={`card-brand-cluster is-dbbl ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.18)),
        height,
      }}
      aria-label="DBBL"
    >
      <div
        style={{
          width: globeBoxW,
          height: globeH,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img
          src={dbblImg}
          alt=""
          style={{
            height: globeH,
            width: fullWAtGlobe,
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.26))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily:
            '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        DBBL
      </span>
    </div>
  );
}

/**
 * Official Standard Chartered Bank Logo (Refined Minimal Scale)
 */
export function StandardCharteredLogo({ className = "", height = 22 }) {
  const markH = Math.round(height * 0.86);
  const fontSize = Math.round(height * 0.52);
  return (
    <div
      className={`card-brand-cluster is-scb ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.18)),
        height,
      }}
      aria-label="SC"
    >
      <img
        src={scbImg}
        alt="Standard Chartered"
        style={{
          height: markH,
          width: "auto",
          maxHeight: markH,
          maxWidth: "none",
          objectFit: "contain",
          display: "block",
          filter:
            "drop-shadow(0 0 0.8px rgba(255,255,255,0.75)) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
        }}
      />
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily:
            '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
          textShadow: "0 1px 2px rgba(0,0,0,0.24)",
        }}
      >
        SC
      </span>
    </div>
  );
}

/**
 * Official Amazon Logo (Refined Minimal Scale)
 */
export function AmazonLogo({ className = "", height = 21 }) {
  const width = Math.round(height * 3.05);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      style={{
        width,
        height,
        display: "block",
        fill: "none",
        stroke: "none",
        overflow: "visible",
      }}
      viewBox="0 0 104 33"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Amazon"
    >
      <text
        x="3"
        y="20"
        fill="#FFFFFF"
        stroke="none"
        fontFamily="'Manrope Variable', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="21.5"
        fontWeight="850"
        letterSpacing="-0.04em"
      >
        amazon
      </text>
      <path
        d="M11 25.2C26.5 31.8 56.5 31.8 73.5 23.8"
        stroke="#FF9900"
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M68.5 21.6L75.2 23.3L71.2 28.5"
        stroke="#FF9900"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Official Citi Logo (Refined Minimal Scale)
 */
export function CitiLogo({ className = "", height = 21 }) {
  const width = Math.round(height * 2.05);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      style={{
        width,
        height,
        display: "block",
        fill: "none",
        stroke: "none",
        overflow: "visible",
      }}
      viewBox="0 0 64 31"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Citi"
    >
      <path
        d="M21 10.8C28.8 3.2 43.2 3.2 51 10.8"
        stroke="#FF2A32"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      <text
        x="6"
        y="26.5"
        fill="#FFFFFF"
        stroke="none"
        fontFamily="'Manrope Variable', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="24.5"
        fontWeight="850"
        letterSpacing="-0.03em"
      >
        citi
      </text>
    </svg>
  );
}

/**
 * Official HDFC Logo (Refined Minimal Scale)
 */
export function HdfcLogo({ className = "", height = 21 }) {
  const width = Math.round(height * 2.65);
  return (
    <svg
      className={`card-logo-svg ${className}`}
      width={width}
      height={height}
      style={{
        width,
        height,
        display: "block",
        fill: "none",
        stroke: "none",
        overflow: "visible",
      }}
      viewBox="0 0 82 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="HDFC"
    >
      <g transform="translate(2, 3)">
        <rect
          x="0"
          y="0"
          width="24"
          height="24"
          rx="3"
          fill="#FFFFFF"
          stroke="none"
        />
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="21"
          rx="1.5"
          fill="#ED232A"
          stroke="none"
        />
        <rect
          x="10.2"
          y="1.5"
          width="3.6"
          height="21"
          fill="#FFFFFF"
          stroke="none"
        />
        <rect
          x="1.5"
          y="10.2"
          width="21"
          height="3.6"
          fill="#FFFFFF"
          stroke="none"
        />
        <rect
          x="5.5"
          y="5.5"
          width="13"
          height="13"
          fill="#FFFFFF"
          stroke="none"
        />
        <rect
          x="7.8"
          y="7.8"
          width="8.4"
          height="8.4"
          fill="#004C8F"
          stroke="none"
        />
      </g>
      <text
        x="32"
        y="20.5"
        fill="#FFFFFF"
        stroke="none"
        fontFamily="'Manrope Variable', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="16.5"
        fontWeight="850"
        letterSpacing="0.04em"
      >
        HDFC
      </text>
    </svg>
  );
}

/**
 * Minimalist Architectural Vault Mark (No Piggy Bank, No Bulky Pill)
 */
export function SavingsLogo({ className = "", height = 20 }) {
  const size = Math.max(16, Math.round(height * 0.92));
  return (
    <span
      className={`card-vault-minimal-mark ${className}`}
      aria-label="Savings Vault"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        color: "rgba(255, 255, 255, 0.78)",
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ width: size, height: size, display: "block", stroke: "none" }}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="5"
          stroke="currentColor"
          strokeWidth="1.65"
        />
        <circle
          cx="12"
          cy="12"
          r="4.2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="12" r="1.25" fill="currentColor" />
        <path
          d="M12 6.2V7.8M12 16.2V17.8M6.2 12H7.8M16.2 12H17.8"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/* ───────────── Official Payment Networks (Visa / Mastercard / Amex) ───────────── */

/**
 * High-Res Official Visa Logo from payment-logos/visa.png
 */
export function VisaBadge({
  className = "",
  height = 16,
  width,
  variant = "auto",
}) {
  const isAdaptive = variant === "adaptive";
  const isNavy = variant === "navy";
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
          : isNavy
            ? "brightness(0) saturate(100%) invert(14%) sepia(78%) saturate(3825%) hue-rotate(228deg) brightness(86%) contrast(103%)"
            : "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
      }}
    />
  );
}

/**
 * High-Res Official Mastercard Logo from tight-cropped payment-logos/mastercard.svg
 */
export function MastercardBadge({
  className = "",
  height = 22,
  width,
  variant = "default",
}) {
  if (variant === "bronze") {
    const w = width || Math.round(height * 1.55);
    return (
      <svg
        width={w}
        height={height}
        viewBox="0 0 34 22"
        fill="none"
        className={`card-network-badge ${className}`}
        aria-label="Mastercard"
        style={{
          height,
          width: w,
          display: "block",
          stroke: "none",
        }}
      >
        <circle cx="12" cy="11" r="9.5" fill="#2B1E08" fillOpacity="0.9" />
        <circle cx="22" cy="11" r="9.5" fill="#2B1E08" fillOpacity="0.46" />
      </svg>
    );
  }
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
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.24))",
      }}
    />
  );
}

/**
 * High-Res Official American Express Logo from payment-logos/amex.svg
 */
export function AmexBadge({ className = "", height = 17, width }) {
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
        filter:
          "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.24))",
      }}
    />
  );
}

/**
 * Realistic Metallic Gold or Wireframe Etched EMV Smart Chip
 */
export function EmvChip({
  className = "",
  size = 32,
  variant = "gold",
  strokeColor = "rgba(255, 255, 255, 0.36)",
  fillColor = "rgba(255, 255, 255, 0.075)",
  centerFillColor = "transparent",
}) {
  const h = Math.round(size * 0.75);
  if (variant === "wireframe") {
    return (
      <svg
        className={`card-emv-chip is-wireframe ${className}`}
        width={size}
        height={h}
        style={{
          width: size,
          height: h,
          display: "block",
          flexShrink: 0,
        }}
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
          rx="8"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth="1.25"
        />
        <path
          d="M1 13.5H51M1 26.5H51M26 1V13.5M26 26.5V39"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="butt"
        />
        <rect
          x="17.5"
          y="13.5"
          width="17"
          height="13"
          rx="4.5"
          fill={centerFillColor}
          stroke={strokeColor}
          strokeWidth="1.2"
        />
      </svg>
    );
  }
  return (
    <svg
      className={`card-emv-chip ${className}`}
      width={size}
      height={h}
      style={{
        width: size,
        height: h,
        display: "block",
        flexShrink: 0,
      }}
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
        rx="7.5"
        fill="url(#emv-gold-grad)"
        stroke="#8C651A"
        strokeWidth="1.2"
      />
      <path
        d="M1 14H18M1 26H18M34 14H51M34 26H51M26 1V12M26 28V39"
        stroke="#7A5612"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <rect
        x="18"
        y="12"
        width="16"
        height="16"
        rx="3.5"
        fill="url(#emv-center-grad)"
        stroke="#7A5612"
        strokeWidth="1.1"
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
          <stop stopColor="#FFF0B8" />
          <stop offset="0.32" stopColor="#EAC46E" />
          <stop offset="0.7" stopColor="#D5A23C" />
          <stop offset="1" stopColor="#AF7B20" />
        </linearGradient>
        <linearGradient
          id="emv-center-grad"
          x1="18"
          y1="12"
          x2="34"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFF3C4" />
          <stop offset="1" stopColor="#CA9533" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Official Contactless Payment Waves Indicator (from contactless.png)
 */
export function ContactlessWaves({
  className = "",
  size = 15,
  height,
  width,
  tone = "light",
  style = {},
}) {
  const h = height || size;
  const toneFilter =
    tone === "bronze"
      ? "brightness(0) saturate(100%) invert(12%) sepia(38%) saturate(1100%) hue-rotate(12deg) brightness(94%) contrast(96%)"
      : tone === "teal"
        ? "brightness(0) saturate(100%) invert(18%) sepia(28%) saturate(1350%) hue-rotate(131deg) brightness(94%) contrast(95%)"
        : "drop-shadow(0 1px 2px rgba(0,0,0,0.25))";
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
        filter: toneFilter,
        opacity: tone === "light" ? 0.78 : 0.72,
        ...style,
      }}
    />
  );
}

import {
  CARD_PROVIDERS,
  CASH_CURRENCIES,
  getCashCurrencyMeta,
  getProviderMeta,
  resolveCardGradient,
} from "./cardProviders.js";
export {
  CARD_PROVIDERS,
  CASH_CURRENCIES,
  getCashCurrencyMeta,
  getProviderMeta,
  resolveCardGradient,
};

export function renderProviderLogo(
  providerId,
  { height = 22, className = "" } = {},
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
    case "gold_mc": {
      return (
        <span
          className={`card-bespoke-mark is-gold-mark ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 20,
            color: "#2B1E08",
          }}
        >
          <svg
            width="13"
            height="13"
            style={{
              width: 13,
              height: 13,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2.5L21.5 12L12 21.5L2.5 12L12 2.5Z"
              stroke="#2B1E08"
              strokeWidth="2"
            />
          </svg>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: "0.14em",
              color: "#2B1E08",
              lineHeight: 1,
            }}
          >
            GOLD BULLION
          </span>
        </span>
      );
    }
    case "virtual_visa": {
      return (
        <span
          className={`card-bespoke-mark is-virtual-visa-mark ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 20,
            color: "#0B6B61",
          }}
        >
          <svg
            width="15"
            height="15"
            style={{
              width: 15,
              height: 15,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 15C5.5 11 8.5 11 12 15C15.5 19 18.5 19 22 15"
              stroke="#0B6B61"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M2 9.5C5.5 5.5 8.5 5.5 12 9.5C15.5 13.5 18.5 13.5 22 9.5"
              stroke="#0B6B61"
              strokeOpacity="0.65"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: "0.16em",
              color: "#0B6B61",
              lineHeight: 1,
            }}
          >
            AERO
          </span>
        </span>
      );
    }
    case "virtual_mc": {
      return (
        <span
          className={`card-bespoke-mark is-virtual-mc-mark ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 20,
            color: "#C7D2FE",
          }}
        >
          <svg
            width="15"
            height="15"
            style={{
              width: 15,
              height: 15,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="5.5"
              width="11"
              height="9"
              rx="2.2"
              stroke="#A5B4FC"
              strokeWidth="1.7"
            />
            <rect
              x="9.5"
              y="9.5"
              width="11"
              height="9"
              rx="2.2"
              stroke="#A5B4FC"
              strokeWidth="1.7"
            />
          </svg>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: "0.16em",
              color: "#C7D2FE",
              lineHeight: 1,
            }}
          >
            STEALTH
          </span>
        </span>
      );
    }
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
      return (
        <AmexBadge height={Math.round(height * 0.72)} className={className} />
      );
    default: {
      return (
        <span
          className={`card-bespoke-mark is-custom-mark ${className}`}
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            height: 20,
            color: "rgba(255, 255, 255, 0.72)",
          }}
        >
          <svg
            width="15"
            height="15"
            style={{
              width: 15,
              height: 15,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M12 2L14.3 9.7L22 12L14.3 14.3L12 22L9.7 14.3L2 12L9.7 9.7L12 2Z"
              fill="currentColor"
            />
          </svg>
        </span>
      );
    }
  }
}

const MINI_CARD_PROTOTYPE_SPECS = {
  // Debit (.c)
  brac: { variant: "", a: "#1F3A68", mk: "BRAC", digits: "9018", net: "visa" },
  dbbl: { variant: "", a: "#1F6B5E", mk: "DBBL", digits: "8841", net: "visa" },
  hdfc_visa: {
    variant: "",
    a: "#223E7A",
    mk: "HDFC",
    digits: "7892",
    net: "visa",
  },

  // Credit (.c.cr)
  city: {
    variant: "cr",
    a: "#A6283A",
    b: "#7E1D2C",
    mk: "City",
    digits: "0241",
    net: "mastercard",
  },
  ebl: {
    variant: "cr",
    a: "#8A3B3F",
    b: "#5F2629",
    mk: "EBL",
    digits: "7890",
    net: "mastercard",
  },
  sc: {
    variant: "cr",
    a: "#2F6DB8",
    b: "#1E4C8A",
    mk: "SC",
    digits: "5592",
    net: "visa",
  },
  amazon: {
    variant: "cr",
    a: "#5A55C4",
    b: "#3C3894",
    mk: "Amazon",
    digits: "9018",
    net: "mastercard",
  },
  citi: {
    variant: "cr",
    a: "#323845",
    b: "#1D2129",
    mk: "Citi",
    digits: "4328",
    net: "mastercard",
  },
  citi_mc: {
    variant: "cr",
    a: "#323845",
    b: "#1D2129",
    mk: "Citi",
    digits: "4328",
    net: "mastercard",
  },
  sc_visa: {
    variant: "cr",
    a: "#3377B8",
    b: "#225A91",
    mk: "SC",
    digits: "3245",
    net: "visa",
  },
  hdfc: {
    variant: "cr",
    a: "#2A3F8A",
    b: "#182A63",
    mk: "HDFC",
    digits: "2219",
    net: "visa",
  },
  hdfc_credit: {
    variant: "cr",
    a: "#2A3F8A",
    b: "#182A63",
    mk: "HDFC",
    digits: "2219",
    net: "visa",
  },
  gold_mc: {
    variant: "cr",
    a: "#E0BC73",
    b: "#B98A3E",
    fg: "#2B1E08",
    mk: "Gold",
    digits: "1234",
    net: "mastercard",
  },
  citi_credit: {
    variant: "cr",
    a: "#2F7F70",
    b: "#1E5A4F",
    mk: "Citi",
    digits: "2134",
    net: "mastercard",
  },

  // Wallets (.c)
  rocket: { variant: "", a: "#7A2F8E", gl: "R", mk: "Wallet", digits: "78" },
  upay: { variant: "", a: "#1D3C8F", gl: "U", mk: "Wallet", digits: "78" },
  bkash: { variant: "", a: "#C41E5A", gl: "b", mk: "Wallet", digits: "78" },
  nagad: { variant: "", a: "#C93F18", gl: "N", mk: "Wallet", digits: "10" },

  // Virtual and other
  virtual_mc: {
    variant: "vt",
    a: "#1D1A3E",
    b: "#100E24",
    mk: "Virtual",
    digits: "4455",
    net: "mastercard",
  },
  virtual_visa: {
    variant: "vt",
    a: "#EDF6F3",
    b: "#D8EDE7",
    fg: "#0A3B34",
    mk: "Virtual",
    digits: "6677",
    net: "visa",
  },
  savings: { variant: "", a: "#2F6B4F", ring: true, mk: "Vault" },
  custom: {
    variant: "",
    a: "#141417",
    mk: "Sign",
    digits: "9010",
    net: "visa",
  },
  cash: { variant: "", a: "#23403C", fg: "#F2F7F6", gl: "৳", mk: "Cash" },
};

/**
 * Prototype Mini Card Preview (56px × 35px / 50px × 31px)
 * Implements the shared 4-type layout (Debit flat, Credit gradient, Wallets round mark, Virtual dashed outline)
 * with dynamic Visa / Mastercard / Amex support.
 */
export function MiniCardPreview({ provider, card, className = "" }) {
  const isCash = card?.id === "cash" || card?.type === "cash";
  const matchedByName =
    !provider && !card?.provider && card?.name
      ? CARD_PROVIDERS.find(
          (item) =>
            item.name.toLowerCase() === String(card.name).trim().toLowerCase(),
        )?.id
      : null;
  const rawProvId = isCash
    ? "cash"
    : card?.provider || matchedByName || provider?.id || card?.id;
  const p =
    provider ||
    (rawProvId ? getProviderMeta(rawProvId) : null) ||
    CARD_PROVIDERS[0];
  const brandKey = isCash
    ? "cash"
    : MINI_CARD_PROTOTYPE_SPECS[rawProvId]
      ? rawProvId
      : p?.id || "custom";
  const spec =
    MINI_CARD_PROTOTYPE_SPECS[brandKey] || MINI_CARD_PROTOTYPE_SPECS.custom;

  const category = card?.category || p?.category || "bank";
  const isMfs =
    !isCash &&
    (Boolean(spec.gl) ||
      category === "mfs" ||
      card?.type === "mfs" ||
      card?.network === "mfs" ||
      Boolean(card?.isPhone || p?.isPhone));
  const isSavings =
    !isCash &&
    (Boolean(spec.ring) ||
      category === "savings" ||
      card?.type === "savings" ||
      brandKey === "savings");
  const isVirtual =
    !isCash &&
    !isMfs &&
    !isSavings &&
    (spec.variant === "vt" ||
      brandKey === "virtual_mc" ||
      brandKey === "virtual_visa" ||
      card?.type === "virtual" ||
      Boolean(card?.isVirtual));

  // Determine variant class: "" (flat), "cr" (credit gradient), or "vt" (virtual dashed)
  let variant = spec.variant;
  if (isVirtual) {
    variant = "vt";
  } else if (!isCash && !isMfs && !isSavings && brandKey !== "custom") {
    if (card?.type === "debit") variant = "";
    else if (card?.type === "credit") variant = "cr";
  }

  // Allow custom card color override if user explicitly selected a non-default swatch
  let colorA = spec.a;
  let colorB =
    spec.b ||
    (variant === "cr" ? `color-mix(in srgb, ${spec.a} 72%, #000000)` : spec.a);
  const rawColor = card?.color ? String(card.color).trim().toLowerCase() : "";
  if (
    brandKey === "custom" &&
    rawColor &&
    rawColor !== "#1e293b" &&
    rawColor !== "#1f2430"
  ) {
    colorA = card.color;
    colorB =
      variant === "cr"
        ? `color-mix(in srgb, ${card.color} 72%, #000000)`
        : card.color;
  }

  // Dynamic network resolution: visa, mastercard (mc), or amex
  const rawNet = String(
    card?.network || spec.net || p?.defaultNetwork || "visa",
  )
    .trim()
    .toLowerCase();
  const isMastercard = rawNet === "mastercard" || rawNet === "mc";
  const isAmex =
    rawNet === "amex" ||
    rawNet === "american express" ||
    rawNet === "american_express";
  const isVisa = !isMastercard && !isAmex;

  // Dynamic digits resolution
  const explicitNum = card?.last4 || card?.number || "";
  const cleanExplicit = String(explicitNum).replace(/\D/g, "");
  let displayDigits = "";
  if (isMfs) {
    const last2 =
      cleanExplicit.slice(-2) ||
      spec.digits ||
      String(p?.numberPlaceholder || "")
        .replace(/\D/g, "")
        .slice(-2) ||
      "78";
    displayDigits = `•• ${last2}`;
  } else if (!isCash && !isSavings) {
    const last4 =
      cleanExplicit.slice(-4) ||
      spec.digits ||
      String(p?.numberPlaceholder || "")
        .replace(/\D/g, "")
        .slice(-4) ||
      "9010";
    displayDigits = `•• ${last4}`;
  }

  // Top-right mark (.mk)
  const markText = isVirtual
    ? "Virtual"
    : isMfs
      ? "Wallet"
      : isSavings
        ? "Vault"
        : isCash
          ? "Cash"
          : spec.mk || (p?.shortCode ? p.shortCode : "Sign");

  // Top-left round glyph for Wallets / Cash
  const glyphChar = isCash
    ? "৳"
    : spec.gl || (isMfs ? (p?.name || "W").charAt(0) : "");

  const cashMeta = isCash ? getCashCurrencyMeta(card?.currency) : null;
  const styleVars = {
    "--a": cashMeta ? cashMeta.bg : colorA,
    ...(colorB ? { "--b": colorB } : {}),
    ...(spec.fg ? { "--fg": spec.fg } : {}),
    ...(cashMeta
      ? {
          "--cash-bg": cashMeta.bg,
          "--cash-accent": cashMeta.accent,
          "--cash-font": cashMeta.font,
          "--cash-mark-font": cashMeta.markFont,
        }
      : {}),
  };

  return (
    <div
      className={`mini-card-preview c ${variant ? variant : ""} ${isCash ? "is-cash" : ""} ${isSavings ? "is-savings" : ""} ${className}`.trim()}
      data-currency={cashMeta ? cashMeta.code : undefined}
      style={styleVars}
      aria-hidden="true"
    >
      {isCash ? (
        <>
          <i className="cash-mini-tk cash-mini-tk-o" aria-hidden="true">
            {cashMeta.symbol}
          </i>
          <i className="cash-mini-tk cash-mini-tk-f" aria-hidden="true">
            {cashMeta.symbol}
          </i>
          <b className="cash-mini-lbl">Cash wallet</b>
        </>
      ) : (
        <>
          {isSavings ? (
            <i className="gl ring" />
          ) : isMfs ? (
            <i className="gl">{glyphChar}</i>
          ) : (
            <i className="ch" />
          )}

          <b className="mk">{markText}</b>

          {displayDigits && <span className="n">{displayDigits}</span>}

          {!isMfs && !isSavings && (
            <>
              {isMastercard && <i className="m" />}
              {isVisa && <em className="v">VISA</em>}
              {isAmex && <em className="amex">AMEX</em>}
            </>
          )}
        </>
      )}
    </div>
  );
}
