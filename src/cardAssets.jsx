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

/* ───────────── Pixel-Perfect Payment & Bank Logos ───────────── */

/**
 * Official bKash Logo
 * Pure white origami bird + official bKash wordmark
 */
export function BkashLogo({ className = "", height = 24 }) {
  return (
    <div className={`card-brand-cluster ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, height }}>
      <img
        src={bkashSvg}
        alt="bKash"
        style={{ height: Math.round(height * 0.95), width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }}
      />
      <span style={{ color: "#ffffff", fontWeight: 850, fontSize: Math.round(height * 0.68), letterSpacing: "-0.03em", fontFamily: "system-ui, -apple-system, sans-serif" }}>
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
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "brightness(0) invert(1) drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
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
      className={`card-brand-img ${className}`}
      style={{
        height,
        width: "auto",
        maxHeight: height,
        objectFit: "contain",
        display: "block",
        filter: "brightness(0) invert(1) drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
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
    <div className={`card-brand-cluster ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, height }}>
      <img
        src={scbImg}
        alt="Standard Chartered"
        style={{ height, width: "auto", maxHeight: height, objectFit: "contain" }}
      />
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ color: "#ffffff", fontWeight: 800, fontSize: Math.round(height * 0.42), letterSpacing: "-0.01em" }}>standard</span>
        <span style={{ color: "#ffffff", fontWeight: 800, fontSize: Math.round(height * 0.42), letterSpacing: "-0.01em" }}>chartered</span>
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
export function VisaBadge({ className = "", height = 18, width }) {
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
        filter: "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
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
        <linearGradient id="emv-gold-grad" x1="0" y1="0" x2="52" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F9E29D" />
          <stop offset="0.3" stopColor="#E4BA62" />
          <stop offset="0.7" stopColor="#D5A23C" />
          <stop offset="1" stopColor="#B38025" />
        </linearGradient>
        <linearGradient id="emv-center-grad" x1="18" y1="12" x2="34" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFECA8" />
          <stop offset="1" stopColor="#C99432" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Contactless RFID Waves
 */
export function ContactlessWaves({ className = "", size = 16 }) {
  return (
    <svg
      className={`card-contactless-waves ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Contactless"
    >
      <path
        d="M8 7C10 9 11 11.5 11 14.5C11 17.5 10 20 8 22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M12.5 4C15.5 6.5 17 10 17 14.5C17 19 15.5 22.5 12.5 25"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M17 1C21 4 23 8.5 23 14.5C23 20.5 21 25 17 28"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ───────────── Provider Catalog Registry ───────────── */

export const CARD_PROVIDERS = [
  /* ──── Video Featured International Card Templates ──── */
  {
    id: "amazon",
    name: "Amazon Platinum",
    category: "bank",
    subtitle: "Amazon Platinum Mastercard",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "USD",
    color: "#6358DC",
    gradient: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #4338ca 100%)",
    numberPrefix: "4756",
    numberPlaceholder: "4756 8214 0024 9018",
    isPhone: false,
  },
  {
    id: "citi_mc",
    name: "Citi Master Card",
    category: "bank",
    subtitle: "Citi Master Card *4328",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "USD",
    color: "#1e293b",
    gradient: "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
    numberPrefix: "5428",
    numberPlaceholder: "5428 1254 0024 4328",
    isPhone: false,
  },
  {
    id: "hdfc_visa",
    name: "HDFC Visa Card",
    category: "bank",
    subtitle: "HDFC Visa Card *7892",
    defaultType: "debit",
    defaultNetwork: "visa",
    currency: "USD",
    color: "#004c8f",
    gradient: "linear-gradient(135deg, #004c8f 0%, #002d56 70%, #001933 100%)",
    numberPrefix: "4892",
    numberPlaceholder: "4892 7812 3456 7892",
    isPhone: false,
  },
  {
    id: "sc_visa",
    name: "SC Visa Card",
    category: "bank",
    subtitle: "SC Visa Card *3245",
    defaultType: "credit",
    defaultNetwork: "visa",
    currency: "USD",
    color: "#0284c7",
    gradient: "linear-gradient(135deg, #0284c7 0%, #0369a1 60%, #075985 100%)",
    numberPrefix: "4245",
    numberPlaceholder: "4245 9012 3456 3245",
    isPhone: false,
  },
  {
    id: "hdfc_credit",
    name: "HDFC Credit Card",
    category: "bank",
    subtitle: "HDFC Credit Card *2219",
    defaultType: "credit",
    defaultNetwork: "visa",
    currency: "USD",
    color: "#1e3a8a",
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #172554 75%, #0f172a 100%)",
    numberPrefix: "4219",
    numberPlaceholder: "4219 5566 7788 2219",
    isPhone: false,
  },
  {
    id: "gold_mc",
    name: "Gold Master Card",
    category: "bank",
    subtitle: "Gold Master Card *1234",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "USD",
    color: "#b45309",
    gradient: "linear-gradient(135deg, #d97706 0%, #b45309 50%, #78350f 100%)",
    numberPrefix: "5134",
    numberPlaceholder: "5134 4455 6677 1234",
    isPhone: false,
  },
  {
    id: "citi_credit",
    name: "Citi Credit Card",
    category: "bank",
    subtitle: "Citi Credit Card *2134",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "USD",
    color: "#0f766e",
    gradient: "linear-gradient(135deg, #0f766e 0%, #115e59 60%, #134e4a 100%)",
    numberPrefix: "5214",
    numberPlaceholder: "5214 3344 5566 2134",
    isPhone: false,
  },
  {
    id: "virtual_mc",
    name: "Virtual MasterCard",
    category: "bank",
    subtitle: "Virtual MasterCard",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "USD",
    color: "#475569",
    gradient: "linear-gradient(135deg, #64748b 0%, #475569 60%, #334155 100%)",
    numberPrefix: "5500",
    numberPlaceholder: "5500 0011 2233 4455",
    isPhone: false,
  },
  {
    id: "virtual_visa",
    name: "Virtual Visa Card",
    category: "bank",
    subtitle: "Virtual Visa Card",
    defaultType: "debit",
    defaultNetwork: "visa",
    currency: "USD",
    color: "#0d9488",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0d9488 60%, #0f766e 100%)",
    numberPrefix: "4111",
    numberPlaceholder: "4111 2233 4455 6677",
    isPhone: false,
  },

  /* ──── Bangladeshi Mobile Wallets & Banks ──── */
  {
    id: "bkash",
    name: "bKash",
    category: "mfs",
    subtitle: "bKash Personal",
    defaultType: "mfs",
    defaultNetwork: "mfs",
    currency: "BDT",
    color: "#e2136e",
    gradient: "linear-gradient(135deg, #e2136e 0%, #b80053 50%, #800038 100%)",
    numberPrefix: "017",
    numberPlaceholder: "01712 345678",
    isPhone: true,
  },
  {
    id: "nagad",
    name: "Nagad",
    category: "mfs",
    subtitle: "Nagad Wallet",
    defaultType: "mfs",
    defaultNetwork: "mfs",
    currency: "BDT",
    color: "#f37021",
    gradient: "linear-gradient(135deg, #f37021 0%, #e31b23 50%, #a81117 100%)",
    numberPrefix: "018",
    numberPlaceholder: "01812 345678",
    isPhone: true,
  },
  {
    id: "rocket",
    name: "Rocket",
    category: "mfs",
    subtitle: "DBBL Rocket Wallet",
    defaultType: "mfs",
    defaultNetwork: "mfs",
    currency: "BDT",
    color: "#8c3494",
    gradient: "linear-gradient(135deg, #8c3494 0%, #5d1c68 60%, #3a0842 100%)",
    numberPrefix: "019",
    numberPlaceholder: "01912 345678",
    isPhone: true,
  },
  {
    id: "upay",
    name: "Upay",
    category: "mfs",
    subtitle: "UCB Upay Digital",
    defaultType: "mfs",
    defaultNetwork: "mfs",
    currency: "BDT",
    color: "#003087",
    gradient: "linear-gradient(135deg, #003087 0%, #001f5c 70%, #d4a017 100%)",
    numberPrefix: "016",
    numberPlaceholder: "01612 345678",
    isPhone: true,
  },
  {
    id: "brac",
    name: "BRAC Bank",
    category: "bank",
    subtitle: "BRAC Platinum Visa",
    defaultType: "debit",
    defaultNetwork: "visa",
    currency: "BDT",
    color: "#002D62",
    gradient: "linear-gradient(135deg, #002D62 0%, #0b1d3a 65%, #182747 100%)",
    numberPrefix: "4756",
    numberPlaceholder: "4756 8214 0024 9018",
    isPhone: false,
  },
  {
    id: "city",
    name: "City Bank",
    category: "bank",
    subtitle: "City Bank World Mastercard",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "BDT",
    color: "#004b87",
    gradient: "linear-gradient(135deg, #004b87 0%, #00274c 65%, #1a365d 100%)",
    numberPrefix: "5214",
    numberPlaceholder: "5214 1254 0024 0241",
    isPhone: false,
  },
  {
    id: "ebl",
    name: "Eastern Bank PLC",
    category: "bank",
    subtitle: "EBL Titanium Mastercard",
    defaultType: "credit",
    defaultNetwork: "mastercard",
    currency: "BDT",
    color: "#b31217",
    gradient: "linear-gradient(135deg, #b31217 0%, #1b2845 75%, #0d1b2a 100%)",
    numberPrefix: "5412",
    numberPlaceholder: "5412 9012 3456 7890",
    isPhone: false,
  },
  {
    id: "dbbl",
    name: "Dutch-Bangla Bank",
    category: "bank",
    subtitle: "DBBL Nexus Visa",
    defaultType: "debit",
    defaultNetwork: "visa",
    currency: "BDT",
    color: "#006666",
    gradient: "linear-gradient(135deg, #006666 0%, #004d4d 60%, #002b2b 100%)",
    numberPrefix: "4214",
    numberPlaceholder: "4214 8820 1204 8841",
    isPhone: false,
  },
  {
    id: "sc",
    name: "Standard Chartered",
    category: "bank",
    subtitle: "SC Visa Signature",
    defaultType: "credit",
    defaultNetwork: "visa",
    currency: "BDT",
    color: "#0072ce",
    gradient: "linear-gradient(135deg, #0072ce 0%, #004b87 50%, #00274c 100%)",
    numberPrefix: "4024",
    numberPlaceholder: "4024 1122 3344 5592",
    isPhone: false,
  },
  {
    id: "savings",
    name: "Savings",
    category: "savings",
    subtitle: "High-Yield Vault",
    defaultType: "savings",
    defaultNetwork: "none",
    currency: "BDT",
    color: "#047857",
    gradient: "linear-gradient(135deg, #065f46 0%, #047857 35%, #064e3b 70%, #022c22 100%)",
    numberPrefix: "SAV",
    numberPlaceholder: "SAV-8829-01",
    isPhone: false,
  },
  {
    id: "custom",
    name: "Custom Card",
    category: "bank",
    subtitle: "Custom Visa / Mastercard",
    defaultType: "debit",
    defaultNetwork: "visa",
    currency: "USD",
    color: "#1e293b",
    gradient: "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
    numberPrefix: "4000",
    numberPlaceholder: "4000 1234 5678 9010",
    isPhone: false,
  },
];

export function getProviderMeta(providerId) {
  return (
    CARD_PROVIDERS.find((p) => p.id === providerId) ||
    CARD_PROVIDERS.find((p) => p.id === "custom")
  );
}

export function renderProviderLogo(providerId, { height = 24, className = "" } = {}) {
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
        <span className={`card-generic-logo ${className}`} style={{ color: "#FDE68A", fontWeight: 900, letterSpacing: "0.08em", fontSize: 13 }}>
          GOLD
        </span>
      );
    case "virtual_mc":
    case "virtual_visa":
      return (
        <span className={`card-generic-logo ${className}`} style={{ color: "rgba(255,255,255,0.9)", fontWeight: 900, letterSpacing: "0.1em", fontSize: 11 }}>
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
        <span className={`card-generic-logo ${className}`} style={{ color: "#ffffff", fontWeight: 800 }}>
          BANK
        </span>
      );
  }
}
