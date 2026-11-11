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
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
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
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
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
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
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
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
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
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
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
        fontFamily="Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
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
        fontFamily="Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
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
        fontFamily="Manrope, -apple-system, BlinkMacSystemFont, sans-serif"
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
          : "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
      }}
    />
  );
}

/**
 * High-Res Official Mastercard Logo from tight-cropped payment-logos/mastercard.svg
 */
export function MastercardBadge({ className = "", height = 22, width }) {
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
 * Realistic Metallic Gold EMV Smart Chip (Refined Minimal Scale)
 */
export function EmvChip({ className = "", size = 32 }) {
  const h = Math.round(size * 0.75);
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
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))",
        opacity: 0.78,
        ...style,
      }}
    />
  );
}

import {
  CARD_PROVIDERS,
  getProviderMeta,
  resolveCardGradient,
} from "./cardProviders.js";
export { CARD_PROVIDERS, getProviderMeta, resolveCardGradient };

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
            height: 22,
            color: "#FEF08A",
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
              d="M12 2L21 12L12 22L3 12L12 2Z"
              stroke="#FDE047"
              strokeWidth="1.6"
              fill="rgba(253, 224, 71, 0.14)"
            />
            <path
              d="M12 2L16.5 12L12 22L7.5 12L12 2Z"
              stroke="rgba(254, 240, 138, 0.55)"
              strokeWidth="1.1"
            />
            <path
              d="M3 12H21"
              stroke="rgba(254, 240, 138, 0.45)"
              strokeWidth="1.1"
            />
          </svg>
          <span
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "flex-end",
              lineHeight: 1,
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 850,
                letterSpacing: "0.18em",
                color: "#FEF9C3",
              }}
            >
              GOLD
            </span>
            <span
              style={{
                fontSize: 6.5,
                fontWeight: 700,
                letterSpacing: "0.22em",
                color: "rgba(253, 224, 71, 0.72)",
              }}
            >
              BULLION
            </span>
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
            height: 22,
            color: "#CCFBF1",
          }}
        >
          <svg
            width="16"
            height="16"
            style={{
              width: 16,
              height: 16,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 15C5.5 11 8.5 11 12 15C15.5 19 18.5 19 22 15"
              stroke="#5EEAD4"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <path
              d="M2 9.5C5.5 5.5 8.5 5.5 12 9.5C15.5 13.5 18.5 13.5 22 9.5"
              stroke="rgba(153, 246, 228, 0.55)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "flex-end",
              lineHeight: 1,
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 850,
                letterSpacing: "0.15em",
                color: "#F0FDFA",
              }}
            >
              AERO
            </span>
            <span
              style={{
                fontSize: 6.5,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "rgba(94, 234, 212, 0.78)",
              }}
            >
              VIRTUAL
            </span>
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
            height: 22,
            color: "#E0E7FF",
          }}
        >
          <svg
            width="16"
            height="16"
            style={{
              width: 16,
              height: 16,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="6"
              width="12"
              height="9"
              rx="2"
              transform="rotate(-10 9 10.5)"
              stroke="#A5B4FC"
              strokeWidth="1.6"
              fill="rgba(129, 140, 248, 0.16)"
            />
            <rect
              x="9"
              y="9"
              width="12"
              height="9"
              rx="2"
              transform="rotate(-10 15 13.5)"
              stroke="#FDA4AF"
              strokeWidth="1.6"
              fill="rgba(244, 63, 94, 0.16)"
            />
          </svg>
          <span
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "flex-end",
              lineHeight: 1,
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 850,
                letterSpacing: "0.15em",
                color: "#EEF2FF",
              }}
            >
              STEALTH
            </span>
            <span
              style={{
                fontSize: 6.5,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "rgba(165, 180, 252, 0.76)",
              }}
            >
              VIRTUAL
            </span>
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
            gap: 5.5,
            height: 22,
            color: "rgba(255, 255, 255, 0.9)",
          }}
        >
          <svg
            width="14"
            height="14"
            style={{
              width: 14,
              height: 14,
              display: "block",
              stroke: "none",
            }}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="rgba(255, 255, 255, 0.14)"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 800,
              letterSpacing: "0.18em",
              color: "rgba(255, 255, 255, 0.84)",
            }}
          >
            SIGNATURE
          </span>
        </span>
      );
    }
  }
}

/**
 * Senior Native App Dev Grade Mini Card Preview (56px × 35px)
 * Minimalist thumbnail representation for Bank, MFS, Savings, and Cash accounts.
 */
export function MiniCardPreview({ provider, card, className = "" }) {
  const isCash = card?.id === "cash" || card?.type === "cash";
  const provId = card?.provider || card?.id;
  const p =
    provider || (provId ? getProviderMeta(provId) : null) || CARD_PROVIDERS[0];
  const network = card?.network || p?.defaultNetwork || "visa";
  const category = card?.category || p?.category || "bank";
  const brandKey = provId || p?.id || "";
  const isVirtual = brandKey === "virtual_mc" || brandKey === "virtual_visa";
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
    : resolveCardGradient(card, p);

  // Extract last 4 digits or masked identifier
  const rawNum = card?.last4 || card?.number || p?.numberPlaceholder || "4328";
  const cleanDigits = String(rawNum).replace(/\D/g, "");
  const last4 =
    cleanDigits.slice(-4) ||
    (p?.numberPrefix ? p.numberPrefix.slice(-4) : "4328");

  return (
    <div
      className={`mini-card-preview ${isCash ? "is-cash" : ""} ${isSavings ? "is-savings" : ""} ${className}`}
      style={{ background: gradient }}
      aria-hidden="true"
    >
      <div className="mini-card-sheen" />
      <div className="mini-card-pattern" />

      {/* Top Row: Micro EMV Chip / Digital Mark (Left) & Brand Mark (Right) */}
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
                  height: 11,
                  width: "auto",
                  maxHeight: "none",
                  filter: "drop-shadow(0 0 0.8px rgba(255,255,255,0.9))",
                }}
              />
            )}
            {brandKey === "nagad" && (
              <div
                style={{
                  width: 11,
                  height: 11,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={nagadImg}
                  alt="Nagad"
                  style={{
                    height: 11,
                    width: 31,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                    filter: "drop-shadow(0 0 0.8px rgba(255,255,255,0.85))",
                  }}
                />
              </div>
            )}
            {brandKey === "rocket" && (
              <img
                src={rocketImg}
                alt="Rocket"
                style={{
                  height: 10,
                  width: "auto",
                  maxHeight: "none",
                  filter: "brightness(0) invert(1)",
                }}
              />
            )}
            {brandKey === "upay" && (
              <div
                style={{
                  width: 10,
                  height: 10,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={upayImg}
                  alt="Upay"
                  style={{
                    width: 16,
                    height: 16,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                    marginLeft: -3,
                    marginTop: -1,
                    filter: "drop-shadow(0 0 0.8px rgba(255,255,255,0.9))",
                  }}
                />
              </div>
            )}
            {!["bkash", "nagad", "rocket", "upay"].includes(brandKey) && (
              <ContactlessWaves size={7.5} className="mini-card-contactless" />
            )}
          </div>
        ) : isSavings ? (
          <div className="mini-card-savings-brand">
            <svg
              width="10"
              height="10"
              style={{
                width: 10,
                height: 10,
                display: "block",
                stroke: "none",
              }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect
                x="2.5"
                y="2.5"
                width="19"
                height="19"
                rx="5"
                stroke="rgba(255,255,255,0.88)"
                strokeWidth="2"
              />
              <circle
                cx="12"
                cy="12"
                r="4"
                stroke="rgba(255,255,255,0.88)"
                strokeWidth="1.8"
              />
              <circle cx="12" cy="12" r="1.3" fill="rgba(255,255,255,0.9)" />
            </svg>
          </div>
        ) : brandKey === "virtual_visa" ? (
          <div className="mini-card-virtual-brand">
            <svg
              width="10"
              height="10"
              style={{
                width: 10,
                height: 10,
                display: "block",
                stroke: "none",
              }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M2 15C5.5 11 8.5 11 12 15C15.5 19 18.5 19 22 15M2 9.5C5.5 5.5 8.5 5.5 12 9.5C15.5 13.5 18.5 13.5 22 9.5"
                stroke="#5EEAD4"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : brandKey === "virtual_mc" ? (
          <div className="mini-card-virtual-brand">
            <svg
              width="10"
              height="10"
              style={{
                width: 10,
                height: 10,
                display: "block",
                stroke: "none",
              }}
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect
                x="2.5"
                y="5.5"
                width="12"
                height="9"
                rx="2"
                stroke="#A5B4FC"
                strokeWidth="2"
              />
              <rect
                x="9.5"
                y="9.5"
                width="12"
                height="9"
                rx="2"
                stroke="#FDA4AF"
                strokeWidth="2"
              />
            </svg>
          </div>
        ) : (
          <div className="mini-card-chip-waves">
            <svg
              className="mini-card-emv"
              width="10"
              height="7.5"
              style={{ width: 10, height: 7.5, stroke: "none" }}
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
          </div>
        )}

        {!isCash && !isMfs && !isSavings && (
          <div className="mini-card-brand-mark">
            {(brandKey === "citi" ||
              brandKey === "citi_mc" ||
              brandKey === "citi_credit") && <CitiLogo height={8.5} />}
            {brandKey === "amazon" && <AmazonLogo height={7.5} />}
            {(brandKey === "hdfc" ||
              brandKey === "hdfc_visa" ||
              brandKey === "hdfc_credit") && (
              <svg
                width="9"
                height="9"
                style={{ width: 9, height: 9, stroke: "none" }}
                viewBox="0 0 24 24"
                fill="none"
              >
                <rect width="24" height="24" rx="3" fill="#FFFFFF" />
                <rect x="2" y="2" width="20" height="20" fill="#ED232A" />
                <rect x="10" y="2" width="4" height="20" fill="#FFFFFF" />
                <rect x="2" y="10" width="20" height="4" fill="#FFFFFF" />
                <rect x="7" y="7" width="10" height="10" fill="#004C8F" />
              </svg>
            )}
            {(brandKey === "sc" || brandKey === "sc_visa") && (
              <img
                src={scbImg}
                alt=""
                style={{ height: 10, width: "auto", objectFit: "contain" }}
              />
            )}
            {brandKey === "brac" && (
              <div
                style={{
                  width: 9,
                  height: 9,
                  overflow: "hidden",
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              >
                <img
                  src={bracBankSvg}
                  alt=""
                  style={{
                    height: 9,
                    width: 83,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                  }}
                />
              </div>
            )}
            {brandKey === "city" && (
              <div
                style={{
                  width: 10,
                  height: 10,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={cityBankImg}
                  alt=""
                  style={{
                    height: 11,
                    width: 16,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                    clipPath:
                      "polygon(0 0, 100% 0, 100% 63.5%, 18.2% 63.5%, 18.2% 100%, 0 100%)",
                  }}
                />
              </div>
            )}
            {brandKey === "ebl" && (
              <div
                style={{
                  width: 13,
                  height: 9,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={eblSvg}
                  alt=""
                  style={{
                    height: 9,
                    width: 56,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                  }}
                />
              </div>
            )}
            {brandKey === "dbbl" && (
              <div
                style={{
                  width: 14,
                  height: 9,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={dbblImg}
                  alt=""
                  style={{
                    height: 9,
                    width: 47,
                    maxWidth: "none",
                    maxHeight: "none",
                    objectFit: "fill",
                  }}
                />
              </div>
            )}
            {brandKey === "gold_mc" && (
              <span className="mini-card-tier-tag is-gold">GOLD</span>
            )}
            {brandKey === "virtual_visa" && (
              <span className="mini-card-tier-tag is-virtual">AERO</span>
            )}
            {brandKey === "virtual_mc" && (
              <span className="mini-card-tier-tag is-virtual">STLH</span>
            )}
            {brandKey === "custom" && (
              <span className="mini-card-tier-tag is-custom">SIGN</span>
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
            <svg
              width="13"
              height="8.5"
              style={{ width: 13, height: 8.5, stroke: "none" }}
              viewBox="0 0 30 20"
              fill="none"
            >
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
        </div>
      </div>
    </div>
  );
}
