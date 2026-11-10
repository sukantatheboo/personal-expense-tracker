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

/* ───────────── Authentic, High-Contrast Bank & MFS Brand Logos ───────────── */

/**
 * Official bKash Logo
 * Crisp white bKash wordmark + authentic multi-faceted origami hummingbird from bkash.svg
 */
export function BkashLogo({ className = "", height = 30 }) {
  const birdH = Math.round(height * 0.96);
  return (
    <div
      className={`card-brand-cluster is-bkash ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.22)),
        height,
      }}
    >
      <span
        style={{
          color: "#ffffff",
          fontWeight: 850,
          fontSize: Math.round(height * 0.68),
          letterSpacing: "-0.035em",
          lineHeight: 1,
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
          textShadow: "0 1px 3px rgba(0,0,0,0.28)",
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
            "drop-shadow(0 0 1.2px rgba(255,255,255,0.92)) drop-shadow(0 1.5px 3px rgba(0,0,0,0.32))",
        }}
      />
    </div>
  );
}

/**
 * Official Nagad Logo (from nagad.png)
 * Full-color Nagad flame & runner emblem + pure white Nagad Bangla wordmark
 */
export function NagadLogo({ className = "", height = 30 }) {
  // nagad.png is 410x144 (ratio 2.847:1)
  // Left emblem: x = 0..145 (35.4% width, 1:1 square)
  // Right main wordmark: x = 158..410 (61.5% width), y = 20..110 (62.5% height)
  const emblemSize = height;
  const fullWAtEmblem = Math.round(emblemSize * (410 / 144));

  const wordH = Math.round(height * 0.68);
  const fullHForWord = Math.round(wordH / 0.64);
  const fullWForWord = Math.round(fullHForWord * (410 / 144));
  const wordBoxW = Math.round(fullWForWord * 0.62);

  return (
    <div
      className={`card-brand-cluster is-nagad ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.2)),
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
              "drop-shadow(0 0 1px rgba(255,255,255,0.85)) drop-shadow(0 1.5px 3px rgba(0,0,0,0.3))",
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
              "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official DBBL Rocket Logo (from rocket.png)
 * Trims the microscopic bottom tagline so ROCKET + paper plane renders large and crisp
 */
export function RocketLogo({ className = "", height = 30 }) {
  // rocket.png is 445x144; main ROCKET + plane is top 85% (y: 0..122)
  const fullH = Math.round(height / 0.85);
  const fullW = Math.round(fullH * (445 / 144));
  return (
    <div
      className={`card-brand-cluster is-rocket ${className}`}
      style={{
        width: fullW,
        height,
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
            "brightness(0) invert(1) drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
        }}
      />
    </div>
  );
}

/**
 * Official Upay Logo (from upay.png)
 * Horizontal lockup: authentic yellow & blue 'u' emblem + crisp white Bangla wordmark
 */
export function UpayLogo({ className = "", height = 30 }) {
  // upay.png is 95x95:
  // Top icon: x=18..75 (60% w), y=7..61 (57% h)
  // Bottom Bangla wordmark: x=18..75 (60% w), y=62..87 (26.5% h)
  const iconH = Math.round(height * 0.92);
  const iconFullSize = Math.round(iconH / 0.58);
  const iconBoxW = Math.round(iconFullSize * 0.62);

  const wordH = Math.round(height * 0.58);
  const wordFullSize = Math.round(wordH / 0.28);
  const wordBoxW = Math.round(wordFullSize * 0.62);

  return (
    <div
      className={`card-brand-cluster is-upay ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(5, Math.round(height * 0.2)),
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
              "drop-shadow(0 0 1.2px rgba(255,255,255,0.92)) drop-shadow(0 1.5px 3px rgba(0,0,0,0.35))",
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
              "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.32))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official BRAC Bank Logo (from vector brac-bank.svg)
 * Preserves the full-color blue, gold & sun square emblem + official vector 'BRAC' short wordmark
 */
export function BracBankLogo({ className = "", height = 28 }) {
  // brac-bank.svg viewBox is 230.4 x 25 (ratio 9.216:1)
  // Left square emblem is 25 x 25 (1:1); vector 'BRAC' spans x = 31.4..125.3 (13.6%..54.5% of width)
  const emblemSize = Math.round(height * 0.92);
  const fullWAtEmblem = Math.round(emblemSize * 9.216);

  const wordH = Math.round(height * 0.56);
  const fullWAtWord = Math.round(wordH * 9.216);
  const wordOffsetLeft = Math.round(fullWAtWord * 0.134);
  const wordBoxW = Math.round(fullWAtWord * 0.415);

  return (
    <div
      className={`card-brand-cluster is-brac ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(6, Math.round(height * 0.22)),
        height,
      }}
      aria-label="BRAC"
    >
      <div
        style={{
          width: emblemSize,
          height: emblemSize,
          overflow: "hidden",
          borderRadius: 4,
          flexShrink: 0,
          boxShadow: "0 1.5px 4px rgba(0,0,0,0.28)",
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
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.32))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Official City Bank Logo (from city-bank.png)
 * Preserves the 3D red & silver checkered kite + short bold 'CITY' wordmark
 */
export function CityBankLogo({ className = "", height = 30 }) {
  // city-bank.png is 237x160 (ratio 1.481:1)
  const kiteH = Math.round(height * 0.96);
  const kiteFullW = Math.round(kiteH * (237 / 160));
  const kiteBoxW = Math.round(kiteFullW * 0.56);
  const fontSize = Math.round(height * 0.54);

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
            filter: "drop-shadow(0 1.5px 3px rgba(0,0,0,0.34))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 900,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        CITY
      </span>
    </div>
  );
}

/**
 * Official Eastern Bank PLC Logo (from vector ebl.svg)
 * Preserves the 3-color EBL emblem on a crisp white badge + short bold 'EBL' wordmark
 */
export function EblLogo({ className = "", height = 28 }) {
  // ebl.svg viewBox is 11.00 4.40 175.50 28.40 (ratio 6.18:1)
  // Left emblem badge is 38 / 175.5 = 21.65% of width
  const emblemH = Math.round(height * 0.94);
  const fullWAtEmblem = Math.round(emblemH * 6.18);
  const emblemBoxW = Math.round(fullWAtEmblem * 0.218);
  const fontSize = Math.round(height * 0.58);

  return (
    <div
      className={`card-brand-cluster is-ebl ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(6, Math.round(height * 0.22)),
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
            filter: "drop-shadow(0 1.5px 3px rgba(0,0,0,0.28))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 900,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        EBL
      </span>
    </div>
  );
}

/**
 * Official Dutch-Bangla Bank Logo (from dbbl.png)
 * Preserves the 3D silver/blue/red/green oval globe + short bold 'DBBL' wordmark
 */
export function DbblLogo({ className = "", height = 28 }) {
  // dbbl.png is 625x120 (ratio 5.208:1)
  // Left 3D oval globe is 0..187 (30% of width)
  const globeH = Math.round(height * 0.92);
  const fullWAtGlobe = Math.round(globeH * (625 / 120));
  const globeBoxW = Math.round(fullWAtGlobe * 0.302);
  const fontSize = Math.round(height * 0.56);

  return (
    <div
      className={`card-brand-cluster is-dbbl ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(6, Math.round(height * 0.2)),
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
            filter: "drop-shadow(0 1.5px 3px rgba(0,0,0,0.32))",
          }}
        />
      </div>
      <span
        style={{
          color: "#ffffff",
          fontWeight: 900,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        DBBL
      </span>
    </div>
  );
}

/**
 * Official Standard Chartered Bank Logo (from scb.png)
 * Preserves the green/blue SC trustmark + short bold 'SC' wordmark
 */
export function StandardCharteredLogo({ className = "", height = 30 }) {
  const markH = Math.round(height * 0.94);
  const fontSize = Math.round(height * 0.56);
  return (
    <div
      className={`card-brand-cluster is-scb ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(6, Math.round(height * 0.2)),
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
            "drop-shadow(0 0 1px rgba(255,255,255,0.8)) drop-shadow(0 1.5px 3px rgba(0,0,0,0.3))",
        }}
      />
      <span
        style={{
          color: "#ffffff",
          fontWeight: 900,
          fontSize,
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontFamily: "Manrope, system-ui, -apple-system, sans-serif",
          textShadow: "0 1px 2px rgba(0,0,0,0.28)",
        }}
      >
        SC
      </span>
    </div>
  );
}

/**
 * Official Amazon Logo (Precision Vector Lockup, Immune to Global SVG Stroke Overrides)
 */
export function AmazonLogo({ className = "", height = 28 }) {
  const width = Math.round(height * 3.15);
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
 * Official Citi Logo (Precision Vector Lockup with Red Umbrella Arc)
 */
export function CitiLogo({ className = "", height = 28 }) {
  const width = Math.round(height * 2.1);
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
 * Official HDFC Logo (Authentic Bracketed Red/Blue Mark + Short Bold 'HDFC' Wordmark)
 */
export function HdfcLogo({ className = "", height = 28 }) {
  const width = Math.round(height * 2.75);
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
        fontWeight="900"
        letterSpacing="0.04em"
      >
        HDFC
      </text>
    </svg>
  );
}

/**
 * Official Savings Vault Piggy Bank Logo
 */
export function SavingsLogo({ className = "", height = 26 }) {
  return (
    <div className={`card-vault-badge ${className}`}>
      <img
        src={savingsPiggySvg}
        alt="Savings Vault"
        className="card-vault-piggy-img"
        style={{ height: Math.round(height * 0.88) }}
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
  height = 19,
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
 * High-Res Official Mastercard Logo from tight-cropped payment-logos/mastercard.svg
 */
export function MastercardBadge({ className = "", height = 26, width }) {
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
        filter: "drop-shadow(0 1px 2.5px rgba(0,0,0,0.28))",
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
        filter:
          "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.28))",
      }}
    />
  );
}

/**
 * Realistic Metallic Gold EMV Smart Chip (Immune to Global SVG Overrides)
 */
export function EmvChip({ className = "", size = 38 }) {
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
  size = 19,
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
        opacity: 0.92,
        ...style,
      }}
    />
  );
}

import { CARD_PROVIDERS, getProviderMeta } from "./cardProviders.js";
export { CARD_PROVIDERS, getProviderMeta };

export function renderProviderLogo(
  providerId,
  { height = 30, className = "" } = {},
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
          className={`card-generic-logo is-gold ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(253, 230, 138, 0.18)",
            border: "1px solid rgba(253, 230, 138, 0.42)",
            color: "#FDE68A",
            fontWeight: 850,
            letterSpacing: "0.08em",
            fontSize: 11.5,
            lineHeight: 1,
          }}
        >
          ★ GOLD
        </span>
      );
    case "virtual_mc":
    case "virtual_visa":
      return (
        <span
          className={`card-generic-logo is-virtual ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.16)",
            border: "1px solid rgba(255, 255, 255, 0.28)",
            color: "#ffffff",
            fontWeight: 850,
            letterSpacing: "0.08em",
            fontSize: 11,
            lineHeight: 1,
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
      return <AmexBadge height={Math.round(height * 0.72)} className={className} />;
    default:
      return (
        <span
          className={`card-generic-logo ${className}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.16)",
            border: "1px solid rgba(255, 255, 255, 0.26)",
            color: "#ffffff",
            fontWeight: 850,
            fontSize: 11,
            letterSpacing: "0.08em",
            lineHeight: 1,
          }}
        >
          CARD
        </span>
      );
  }
}

/**
 * Senior Native App Dev Grade Mini Card Preview (56px × 35px)
 * Designed with authentic physical credit card ratio (1.586:1), hairline metallic border,
 * specular gloss sheen, micro EMV chip / contactless indicator, SF Mono masked digits,
 * and iconic institution emblems that remain crisp at thumbnail scale.
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
                  height: 12,
                  width: "auto",
                  filter: "drop-shadow(0 0 0.8px rgba(255,255,255,0.9))",
                }}
              />
            )}
            {brandKey === "nagad" && (
              <div
                style={{
                  width: 12,
                  height: 12,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={nagadImg}
                  alt="Nagad"
                  style={{
                    height: 12,
                    width: 34,
                    maxWidth: "none",
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
                  height: 11,
                  width: "auto",
                  filter: "brightness(0) invert(1)",
                }}
              />
            )}
            {brandKey === "upay" && (
              <div
                style={{
                  width: 11,
                  height: 11,
                  overflow: "hidden",
                  flexShrink: 0,
                }}
              >
                <img
                  src={upayImg}
                  alt="Upay"
                  style={{
                    width: 18,
                    height: 18,
                    maxWidth: "none",
                    marginLeft: -3.5,
                    marginTop: -1,
                    filter: "drop-shadow(0 0 0.8px rgba(255,255,255,0.9))",
                  }}
                />
              </div>
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
              style={{ height: 12, width: "auto" }}
            />
          </div>
        ) : (
          <div className="mini-card-chip-waves">
            <svg
              className="mini-card-emv"
              width="11"
              height="8"
              style={{ width: 11, height: 8, stroke: "none" }}
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
              brandKey === "citi_credit") && <CitiLogo height={9.5} />}
            {brandKey === "amazon" && <AmazonLogo height={8.5} />}
            {(brandKey === "hdfc" ||
              brandKey === "hdfc_visa" ||
              brandKey === "hdfc_credit") && (
              <svg
                width="10"
                height="10"
                style={{ width: 10, height: 10, stroke: "none" }}
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
                style={{ height: 11, width: "auto", objectFit: "contain" }}
              />
            )}
            {brandKey === "brac" && (
              <div
                style={{
                  width: 10,
                  height: 10,
                  overflow: "hidden",
                  borderRadius: 2,
                }}
              >
                <img
                  src={bracBankSvg}
                  alt=""
                  style={{ height: 10, width: 92, maxWidth: "none" }}
                />
              </div>
            )}
            {brandKey === "city" && (
              <div style={{ width: 11, height: 11, overflow: "hidden" }}>
                <img
                  src={cityBankImg}
                  alt=""
                  style={{
                    height: 12,
                    width: 18,
                    maxWidth: "none",
                    clipPath:
                      "polygon(0 0, 100% 0, 100% 63.5%, 18.2% 63.5%, 18.2% 100%, 0 100%)",
                  }}
                />
              </div>
            )}
            {brandKey === "ebl" && (
              <div style={{ width: 14, height: 10, overflow: "hidden" }}>
                <img
                  src={eblSvg}
                  alt=""
                  style={{ height: 10, width: 62, maxWidth: "none" }}
                />
              </div>
            )}
            {brandKey === "dbbl" && (
              <div style={{ width: 15, height: 10, overflow: "hidden" }}>
                <img
                  src={dbblImg}
                  alt=""
                  style={{ height: 10, width: 52, maxWidth: "none" }}
                />
              </div>
            )}
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
            <svg
              width="14"
              height="9"
              style={{ width: 14, height: 9, stroke: "none" }}
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
          {isMfs && <span className="mini-card-mfs-text">MFS</span>}
          {isSavings && <span className="mini-card-vault-star">★</span>}
        </div>
      </div>
    </div>
  );
}
