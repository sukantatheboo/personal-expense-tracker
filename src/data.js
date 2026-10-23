export const STORAGE_KEYS = {
  expenses: "spend-expenses-v1",
  budgets: "spend-monthly-budgets-v1",
  recurring: "spend-recurring-expenses-v1",
  accounts: "spend-account-balances-v1",
  theme: "spend-theme-v1",
  currency: "spend-target-currency-v1",
};

export const CATEGORIES = [
  "Food",
  "Transport",
  "Bills",
  "Shopping",
  "Health",
  "Entertainment",
  "Education",
  "Savings",
  "Other",
];

export const CURRENCIES = [
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["INR", "Indian Rupee"],
  ["AED", "UAE Dirham"],
  ["SAR", "Saudi Riyal"],
  ["CAD", "Canadian Dollar"],
  ["AUD", "Australian Dollar"],
  ["JPY", "Japanese Yen"],
  ["SGD", "Singapore Dollar"],
  ["MYR", "Malaysian Ringgit"],
  ["PKR", "Pakistani Rupee"],
  ["CNY", "Chinese Yuan"],
  ["THB", "Thai Baht"],
];

export const PRIMARY_CURRENCY = "BDT";

export function localDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}

export function currentMonth() {
  return localDate().slice(0, 7);
}

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : JSON.parse(saved);
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadExpenses(saved = readStorage(STORAGE_KEYS.expenses, [])) {
  return Array.isArray(saved)
    ? saved
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.description === "string" &&
            isValidDateString(item.date) &&
            (item.amount === null ||
              (Number.isFinite(Number(item.amount)) && Number(item.amount) > 0)),
        )
        .map((item) => ({
          ...item,
          category: CATEGORIES.includes(item.category) ? item.category : "Other",
          account: isAccountId(item.account) ? item.account : "",
        }))
    : [];
}

export function loadBudgets(saved = readStorage(STORAGE_KEYS.budgets, {})) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(
    Object.entries(saved).filter(
      ([month, amount]) =>
        /^\d{4}-\d{2}$/.test(month) &&
        Number.isFinite(Number(amount)) &&
        Number(amount) > 0,
    ),
  );
}

export function isAccountId(value) {
  return value === "bkash" || value === "bank";
}

function isValidRecurringSchedule(schedule) {
  return (
    schedule &&
    typeof schedule.id === "string" &&
    typeof schedule.description === "string" &&
    Number.isFinite(Number(schedule.amount)) &&
    Number(schedule.amount) > 0 &&
    CATEGORIES.includes(schedule.category) &&
    ["weekly", "monthly"].includes(schedule.interval) &&
    isValidDateString(schedule.nextDate) &&
    typeof schedule.active === "boolean"
  );
}

export function loadRecurringSchedules(
  saved = readStorage(STORAGE_KEYS.recurring, []),
) {
  return Array.isArray(saved)
    ? saved.filter(isValidRecurringSchedule).map((schedule) => ({
        ...schedule,
        account: isAccountId(schedule.account) ? schedule.account : "",
        dayOfMonth:
          Number.isInteger(schedule.dayOfMonth) &&
          schedule.dayOfMonth >= 1 &&
          schedule.dayOfMonth <= 31
            ? schedule.dayOfMonth
            : Number(schedule.nextDate.slice(-2)),
      }))
    : [];
}

export function emptyAccountData() {
  return {
    settings: {
      startDate: localDate(),
      balances: { bkash: 0, bank: 0 },
      configured: false,
    },
    transactions: [],
  };
}

function isValidAccountTransaction(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !Number.isFinite(Number(item.amount)) ||
    Number(item.amount) <= 0 ||
    !isValidDateString(item.date)
  )
    return false;
  if (item.type === "income") return isAccountId(item.account);
  if (item.type === "adjustment")
    return (
      isAccountId(item.account) &&
      ["increase", "decrease"].includes(item.direction)
    );
  if (item.type === "transfer")
    return (
      isAccountId(item.fromAccount) &&
      isAccountId(item.toAccount) &&
      item.fromAccount !== item.toAccount
    );
  return false;
}

export function loadAccountData(saved = readStorage(STORAGE_KEYS.accounts, null)) {
  if (!saved || typeof saved !== "object") return emptyAccountData();
  const settings = saved.settings || {};
  const balances = settings.balances || {};
  const cleanBalance = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0
      ? Math.round(amount * 100) / 100
      : 0;
  };
  return {
    settings: {
      startDate: isValidDateString(settings.startDate)
        ? settings.startDate
        : localDate(),
      balances: {
        bkash: cleanBalance(balances.bkash),
        bank: cleanBalance(balances.bank),
      },
      configured: settings.configured === true,
    },
    transactions: Array.isArray(saved.transactions)
      ? saved.transactions.filter(isValidAccountTransaction).map((item) => ({
          ...item,
          amount: Math.round(Number(item.amount) * 100) / 100,
          description:
            typeof item.description === "string"
              ? item.description.slice(0, 80)
              : "",
        }))
      : [],
  };
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value, currency = PRIMARY_CURRENCY) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "code",
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

export function formatDate(value) {
  if (!isValidDateString(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function nextOccurrenceDate(dateValue, interval, dayOfMonth) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (interval === "weekly") {
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 7);
    return localDate(date);
  }
  const nextMonth = new Date(year, month, 1);
  const lastDay = new Date(
    nextMonth.getFullYear(),
    nextMonth.getMonth() + 1,
    0,
  ).getDate();
  return localDate(
    new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth(),
      Math.min(dayOfMonth || day, lastDay),
    ),
  );
}

export function calculateAccountBalance(accountId, expenses, accountData) {
  const { startDate, balances } = accountData.settings;
  const today = localDate();
  let balance = Number(balances[accountId] || 0);

  for (const expense of expenses) {
    if (
      expense.account === accountId &&
      expense.amount !== null &&
      expense.date >= startDate &&
      expense.date <= today
    ) {
      balance -= Number(expense.amount);
    }
  }

  for (const transaction of accountData.transactions) {
    if (transaction.date < startDate || transaction.date > today) continue;
    if (transaction.type === "income" && transaction.account === accountId)
      balance += Number(transaction.amount);
    if (transaction.type === "adjustment" && transaction.account === accountId)
      balance +=
        transaction.direction === "increase"
          ? Number(transaction.amount)
          : -Number(transaction.amount);
    if (transaction.type === "transfer") {
      if (transaction.fromAccount === accountId)
        balance -= Number(transaction.amount);
      if (transaction.toAccount === accountId)
        balance += Number(transaction.amount);
    }
  }

  return roundMoney(balance);
}
