import billsSvg from "./assets/spend-trans-icns/bills.svg";
import educationSvg from "./assets/spend-trans-icns/education.svg";
import entertainmentSvg from "./assets/spend-trans-icns/entertainment.svg";
import foodSvg from "./assets/spend-trans-icns/food.svg";
import healthSvg from "./assets/spend-trans-icns/health.svg";
import homeSvg from "./assets/spend-trans-icns/home.svg";
import otherSvg from "./assets/spend-trans-icns/other.svg";
import savingsSvg from "./assets/spend-trans-icns/savings.svg";
import shoppingSvg from "./assets/spend-trans-icns/shopping.svg";
import transportSvg from "./assets/spend-trans-icns/transport.svg";

import adjustSvg from "./assets/spend-trans-icns/adjust.svg";
import incomeSvg from "./assets/spend-trans-icns/income.svg";
import transferSvg from "./assets/spend-trans-icns/transfer.svg";
import cardOptionsSvg from "./assets/spend-trans-icns/card-options.svg";

import alertSvg from "./assets/spend-trans-icns/alert.svg";
import cashSvg from "./assets/spend-trans-icns/cash.svg";
import starSvg from "./assets/spend-trans-icns/star.svg";
import refreshSvg from "./assets/spend-trans-icns/refresh.svg";
import suggestionSvg from "./assets/spend-trans-icns/suggestion.svg";

// Dynamic Entertainment & Subscription Icons
import spotifySvg from "./assets/spend-trans-icns/spotify.svg";
import netflixSvg from "./assets/spend-trans-icns/netflix.svg";
import ytSvg from "./assets/spend-trans-icns/yt.svg";
import ytMusicSvg from "./assets/spend-trans-icns/yt-music.svg";
import chatgptSvg from "./assets/spend-trans-icns/chatgpt.svg";
import claudeSvg from "./assets/spend-trans-icns/claude.svg";
import appleMusicSvg from "./assets/spend-trans-icns/apple-music.svg";
import geminiSvg from "./assets/spend-trans-icns/gemini.svg";

export {
  billsSvg,
  educationSvg,
  entertainmentSvg,
  foodSvg,
  healthSvg,
  homeSvg,
  otherSvg,
  savingsSvg,
  shoppingSvg,
  transportSvg,
  adjustSvg,
  incomeSvg,
  transferSvg,
  cardOptionsSvg,
  alertSvg,
  cashSvg,
  starSvg,
  refreshSvg,
  suggestionSvg,
  spotifySvg,
  netflixSvg,
  ytSvg,
  ytMusicSvg,
  chatgptSvg,
  claudeSvg,
  appleMusicSvg,
  geminiSvg,
};

export const DYNAMIC_SERVICES = {
  spotify: {
    id: "spotify",
    name: "Spotify",
    icon: spotifySvg,
    color: "#25D865",
  },
  netflix: {
    id: "netflix",
    name: "Netflix",
    icon: netflixSvg,
    color: "#E50914",
  },
  "yt-music": {
    id: "yt-music",
    name: "YT Music",
    icon: ytMusicSvg,
    color: "#FF4B4B",
  },
  yt: {
    id: "yt",
    name: "YouTube",
    icon: ytSvg,
    color: "#FF4B4B",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    icon: chatgptSvg,
    color: "#74AA9C",
  },
  claude: {
    id: "claude",
    name: "Claude",
    icon: claudeSvg,
    color: "#D97757",
  },
  "apple-music": {
    id: "apple-music",
    name: "Apple Music",
    icon: appleMusicSvg,
    color: "#FF4D6D",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    icon: geminiSvg,
    color: "#6884F7",
  },
};

export function getDynamicEntertainmentService(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().trim();
  if (!s) return null;

  // 1. YouTube Music / YT Music (check before generic YouTube / YT)
  if (
    /\b(yt\s*music|youtube\s*music|you\s*tube\s*music)\b/i.test(s) ||
    s.includes("yt-music") ||
    s.includes("ytmusic")
  ) {
    return DYNAMIC_SERVICES["yt-music"];
  }

  // 2. YouTube / YT
  if (
    /\b(youtube|you\s*tube|yt|yt\s*premium|youtube\s*premium)\b/i.test(s) ||
    s.includes("youtube") ||
    s === "yt" ||
    s.startsWith("yt ") ||
    s.endsWith(" yt") ||
    s.includes(" yt ")
  ) {
    return DYNAMIC_SERVICES["yt"];
  }

  // 3. Spotify
  if (/\b(spotify)\b/i.test(s) || s.includes("spotify")) {
    return DYNAMIC_SERVICES["spotify"];
  }

  // 4. Netflix
  if (/\b(netflix)\b/i.test(s) || s.includes("netflix")) {
    return DYNAMIC_SERVICES["netflix"];
  }

  // 5. ChatGPT / OpenAI
  if (
    /\b(chatgpt|chat\s*gpt|openai|gpt-?4o?|gpt-?3\.?5?)\b/i.test(s) ||
    s.includes("chatgpt")
  ) {
    return DYNAMIC_SERVICES["chatgpt"];
  }

  // 6. Claude / Calude (handles user's typo) / Anthropic
  if (
    /\b(claude|calude|anthropic)\b/i.test(s) ||
    s.includes("claude") ||
    s.includes("calude")
  ) {
    return DYNAMIC_SERVICES["claude"];
  }

  // 7. Apple Music
  if (
    /\b(apple\s*music|applemusic)\b/i.test(s) ||
    s.includes("apple-music") ||
    s.includes("apple music")
  ) {
    return DYNAMIC_SERVICES["apple-music"];
  }

  // 8. Gemini
  if (/\b(gemini|bard)\b/i.test(s) || s.includes("gemini")) {
    return DYNAMIC_SERVICES["gemini"];
  }

  return null;
}

export const CATEGORY_ICONS = {
  Food: foodSvg,
  Transport: transportSvg,
  Bills: billsSvg,
  Home: homeSvg,
  Shopping: shoppingSvg,
  Health: healthSvg,
  Entertainment: entertainmentSvg,
  Education: educationSvg,
  Savings: savingsSvg,
  Other: otherSvg,
  // Aliases for common alternative labels
  Grocery: shoppingSvg,
  Medicine: healthSvg,
  Utilities: billsSvg,
  Travel: transportSvg,
  // Dynamic entertainment service aliases
  Spotify: spotifySvg,
  Netflix: netflixSvg,
  YouTube: ytSvg,
  YT: ytSvg,
  "YT Music": ytMusicSvg,
  "YouTube Music": ytMusicSvg,
  ChatGPT: chatgptSvg,
  Claude: claudeSvg,
  Calude: claudeSvg,
  "Apple Music": appleMusicSvg,
  Gemini: geminiSvg,
};

export const CATEGORY_COLORS = {
  Food: "#f97316",
  Transport: "#2563eb",
  Bills: "#eab308",
  Home: "#10b981",
  Shopping: "#8b5cf6",
  Health: "#dc2626",
  Entertainment: "#06b6d4",
  Education: "#4f46e5",
  Savings: "#be185d",
  Other: "#64748b",
  Grocery: "#8b5cf6",
  Medicine: "#dc2626",
  Utilities: "#eab308",
  Travel: "#2563eb",
  // Dynamic entertainment service colors
  Spotify: "#25D865",
  Netflix: "#E50914",
  YouTube: "#FF4B4B",
  YT: "#FF4B4B",
  "YT Music": "#FF4B4B",
  "YouTube Music": "#FF4B4B",
  ChatGPT: "#74AA9C",
  Claude: "#D97757",
  Calude: "#D97757",
  "Apple Music": "#FF4D6D",
  Gemini: "#6884F7",
};

export const TRANSACTION_ICONS = {
  income: incomeSvg,
  transfer: transferSvg,
  adjust: adjustSvg,
  adjustment: adjustSvg,
  "card-options": cardOptionsSvg,
  card_options: cardOptionsSvg,
  cardoptions: cardOptionsSvg,
  Income: incomeSvg,
  Transfer: transferSvg,
  Adjust: adjustSvg,
  Adjustment: adjustSvg,
  "Card Options": cardOptionsSvg,
};

export const TRANSACTION_COLORS = {
  income: "#a855f7",
  transfer: "#3b82c4",
  adjust: "#8b5cf6",
  adjustment: "#8b5cf6",
  "card-options": "#6366f1",
  card_options: "#6366f1",
  cardoptions: "#6366f1",
  Income: "#a855f7",
  Transfer: "#3b82c4",
  Adjust: "#8b5cf6",
  Adjustment: "#8b5cf6",
  "Card Options": "#6366f1",
};

function normalizeKey(str) {
  if (!str) return "";
  const s = String(str).trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function getCategoryIcon(category, description) {
  // If description matches a dynamic entertainment service
  if (description) {
    const service = getDynamicEntertainmentService(description);
    if (service) {
      if (
        !category ||
        category === "Entertainment" ||
        normalizeKey(category) === "Entertainment" ||
        category === service.name ||
        category === "Other"
      ) {
        return service.icon;
      }
    }
  }

  // Check if category itself is a dynamic service
  if (category) {
    const service = getDynamicEntertainmentService(category);
    if (service) return service.icon;
  }

  if (!category) return otherSvg;
  return (
    CATEGORY_ICONS[category] ||
    CATEGORY_ICONS[normalizeKey(category)] ||
    otherSvg
  );
}

export function getCategoryColor(category, description) {
  if (description) {
    const service = getDynamicEntertainmentService(description);
    if (service) {
      if (
        !category ||
        category === "Entertainment" ||
        normalizeKey(category) === "Entertainment" ||
        category === service.name ||
        category === "Other"
      ) {
        return service.color;
      }
    }
  }

  if (category) {
    const service = getDynamicEntertainmentService(category);
    if (service) return service.color;
  }

  if (!category) return "#7d8a82";
  return (
    CATEGORY_COLORS[category] ||
    CATEGORY_COLORS[normalizeKey(category)] ||
    "#7d8a82"
  );
}

export function getTransactionIcon(type) {
  if (!type) return adjustSvg;
  const key = String(type).trim().toLowerCase();
  return TRANSACTION_ICONS[key] || adjustSvg;
}

export function getTransactionColor(type) {
  if (!type) return "#8b5cf6";
  const key = String(type).trim().toLowerCase();
  return TRANSACTION_COLORS[key] || "#8b5cf6";
}

export function CategorySymbol({
  category,
  description,
  className = "",
  size,
  style,
}) {
  const iconSrc = getCategoryIcon(category, description);
  const color = getCategoryColor(category, description);
  const dynamicService =
    getDynamicEntertainmentService(description) ||
    getDynamicEntertainmentService(category);
  const serviceClass = dynamicService ? `is-${dynamicService.id}` : "";

  const inlineStyle = {
    "--c": color,
    ...(size ? { width: size, height: size } : {}),
    ...style,
  };

  const classes = [
    "category-symbol",
    `is-${String(category || "other").toLowerCase()}`,
    serviceClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true" style={inlineStyle}>
      <img
        src={iconSrc}
        alt=""
        className="category-symbol-img"
        draggable="false"
      />
    </span>
  );
}

export function TransactionSymbol({ type, className = "", size, style }) {
  const iconSrc = getTransactionIcon(type);
  const color = getTransactionColor(type);
  const inlineStyle = {
    "--c": color,
    ...(size ? { width: size, height: size } : {}),
    ...style,
  };

  const classes = [
    "transaction-symbol",
    `is-${String(type || "adjust").toLowerCase()}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true" style={inlineStyle}>
      <img
        src={iconSrc}
        alt=""
        className="transaction-symbol-img"
        draggable="false"
      />
    </span>
  );
}
