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
};

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
};

export const CATEGORY_COLORS = {
  Food: "#e8873a",
  Transport: "#3b82c4",
  Bills: "#d6a31f",
  Home: "#8a6fd1",
  Shopping: "#d9528a",
  Health: "#e0594f",
  Entertainment: "#20a4a4",
  Education: "#5b73d9",
  Savings: "#b6404b",
  Other: "#7d8a82",
  Grocery: "#d9528a",
  Medicine: "#e0594f",
  Utilities: "#d6a31f",
  Travel: "#3b82c4",
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
  income: "#10b981",
  transfer: "#3b82c4",
  adjust: "#8b5cf6",
  adjustment: "#8b5cf6",
  "card-options": "#6366f1",
  card_options: "#6366f1",
  cardoptions: "#6366f1",
  Income: "#10b981",
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

export function getCategoryIcon(category) {
  if (!category) return otherSvg;
  return (
    CATEGORY_ICONS[category] ||
    CATEGORY_ICONS[normalizeKey(category)] ||
    otherSvg
  );
}

export function getCategoryColor(category) {
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
  className = "",
  size,
  style,
}) {
  const iconSrc = getCategoryIcon(category);
  const color = getCategoryColor(category);
  const inlineStyle = {
    "--c": color,
    ...(size ? { width: size, height: size } : {}),
    ...style,
  };

  const classes = [
    "category-symbol",
    `is-${String(category || "other").toLowerCase()}`,
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

export function TransactionSymbol({
  type,
  className = "",
  size,
  style,
}) {
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
