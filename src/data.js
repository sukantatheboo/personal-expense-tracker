export const STORAGE_KEYS = {
  expenses: "spend-expenses-v1",
  budgets: "spend-monthly-budgets-v1",
  budgetUpdatedAt: "spend-budget-updated-at-v1",
  recurring: "spend-recurring-expenses-v1",
  accounts: "spend-account-balances-v1",
  theme: "spend-theme-v1",
  currency: "spend-target-currency-v1",
  reminderTime: "spend-reminder-time-v1",
  profileName: "spend-profile-name-v1",
};

export const CATEGORIES = [
  "Food",
  "Transport",
  "Bills",
  "Home",
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

export const DEFAULT_CARDS = [
  {
    id: "amazon",
    name: "Amazon Platinum",
    provider: "amazon",
    type: "credit",
    network: "mastercard",
    holderName: "John Smith",
    subtitle: "Amazon Platinum",
    number: "4756 8214 0024 9018",
    expiry: "12/28",
    cvv: "654",
    color: "#6358DC",
    gradient: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #4338ca 100%)",
  },
  {
    id: "citi",
    name: "Citi Master Card",
    provider: "citi_mc",
    type: "credit",
    network: "mastercard",
    holderName: "John Smith",
    subtitle: "Platinum Mastercard",
    number: "5428 1254 0024 4328",
    expiry: "11/25",
    cvv: "654",
    color: "#1e293b",
    gradient: "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
  },
  {
    id: "bkash",
    name: "bKash",
    provider: "bkash",
    type: "mfs",
    network: "mfs",
    holderName: "Personal Account",
    subtitle: "Personal Wallet",
    number: "01712 345678",
    expiry: "",
    cvv: "",
    color: "#e2136e",
    gradient: "linear-gradient(135deg, #e2136e 0%, #b80053 50%, #800038 100%)",
  },
  {
    id: "bank",
    name: "Bank",
    provider: "brac",
    type: "debit",
    network: "visa",
    holderName: "Primary Debit",
    subtitle: "BRAC Platinum Visa",
    number: "4756 8214 0024 9018",
    expiry: "12/28",
    cvv: "349",
    color: "#002D62",
    gradient: "linear-gradient(135deg, #002D62 0%, #0b1d3a 65%, #182747 100%)",
  },
  {
    id: "savings",
    name: "Savings",
    provider: "savings",
    type: "savings",
    network: "none",
    holderName: "Personal Savings",
    subtitle: "High-Yield Vault",
    number: "SAV-8829-01",
    expiry: "",
    cvv: "",
    color: "#047857",
    gradient: "linear-gradient(135deg, #065f46 0%, #047857 35%, #064e3b 70%, #022c22 100%)",
  },
];

export const ACCOUNT_OPTIONS = [
  ["amazon", "Amazon Platinum"],
  ["citi", "Citi Master Card"],
  ["bkash", "bKash"],
  ["bank", "Bank"],
  ["savings", "Savings"],
];

export function getAccountOptions(accountData) {
  const cards = accountData?.settings?.cards;
  if (Array.isArray(cards)) {
    return cards.map((c) => [c.id, c.name]);
  }
  return [];
}

export function isSeededDemoCard(card) {
  if (!card || typeof card !== "object") return false;
  if (card.createdAt || card.updatedAt) return false;
  const demoMatch = DEFAULT_CARDS.find((d) => d.id === card.id);
  if (!demoMatch) return false;
  return (
    card.name === demoMatch.name &&
    card.number === demoMatch.number &&
    card.holderName === demoMatch.holderName &&
    card.provider === demoMatch.provider
  );
}

export function hasSeededDemoBalances(balances) {
  if (!balances || typeof balances !== "object") return false;
  return (
    Number(balances.amazon) === 12450 &&
    Number(balances.citi) === 8500 &&
    Number(balances.bkash) === 3200 &&
    Number(balances.bank) === 15000 &&
    Number(balances.savings) === 50000
  );
}

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
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
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

export function loadExpenses(
  saved = readStorage(STORAGE_KEYS.expenses, []),
  accountData = null,
) {
  return Array.isArray(saved)
    ? saved
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.description === "string" &&
            isValidDateString(item.date) &&
            (item.amount === null ||
              (Number.isFinite(Number(item.amount)) &&
                Number(item.amount) > 0)),
        )
        .map((item) => ({
          ...item,
          category: CATEGORIES.includes(item.category)
            ? item.category
            : "Other",
          account: isAccountId(item.account, accountData) ? item.account : "",
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

export function isAccountId(value, accountData = null) {
  if (!value || typeof value !== "string") return false;
  if (ACCOUNT_OPTIONS.some(([id]) => id === value)) return true;
  if (DEFAULT_CARDS.some((c) => c.id === value)) return true;
  if (value.startsWith("card_")) return true;
  if (accountData?.settings?.cards?.some((c) => c.id === value)) return true;
  if (
    accountData?.settings?.balances &&
    Object.hasOwn(accountData.settings.balances, value)
  )
    return true;
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.accounts) || "null",
    );
    if (saved?.settings?.cards?.some((c) => c.id === value)) return true;
    if (
      saved?.settings?.balances &&
      Object.hasOwn(saved.settings.balances, value)
    )
      return true;
  } catch {}
  return false;
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
  accountData = null,
) {
  return Array.isArray(saved)
    ? saved.filter(isValidRecurringSchedule).map((schedule) => ({
        ...schedule,
        account: isAccountId(schedule.account, accountData)
          ? schedule.account
          : "",
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
      balances: { bkash: 0, bank: 0, savings: 0 },
      cards: [],
      configured: false,
      cardsConfigured: false,
      updatedAt: 0,
    },
    transactions: [],
  };
}

function isValidAccountTransaction(item, accountData = null) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !Number.isFinite(Number(item.amount)) ||
    Number(item.amount) <= 0 ||
    !isValidDateString(item.date)
  )
    return false;
  if (item.type === "income") return isAccountId(item.account, accountData);
  if (item.type === "adjustment")
    return (
      isAccountId(item.account, accountData) &&
      ["increase", "decrease"].includes(item.direction)
    );
  if (item.type === "transfer")
    return (
      isAccountId(item.fromAccount, accountData) &&
      isAccountId(item.toAccount, accountData) &&
      item.fromAccount !== item.toAccount
    );
  return false;
}

export function loadAccountData(
  saved = readStorage(STORAGE_KEYS.accounts, null),
) {
  if (!saved || typeof saved !== "object") return emptyAccountData();
  const settings = saved.settings || {};
  const rawBalances = settings.balances || {};
  const cleanBalance = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0
      ? Math.round(amount * 100) / 100
      : 0;
  };

  const rawCards = Array.isArray(settings.cards) ? settings.cards : [];
  const cards = rawCards.filter(
    (card) =>
      card &&
      typeof card === "object" &&
      typeof card.id === "string" &&
      card.id.trim().length > 0 &&
      !isSeededDemoCard(card),
  );

  const isDemoBalanceSet =
    settings.configured !== true && hasSeededDemoBalances(rawBalances);
  const balances = isDemoBalanceSet ? {} : rawBalances;

  const initialBalances = {
    bkash: cleanBalance(balances.bkash),
    bank: cleanBalance(balances.bank),
    savings: cleanBalance(balances.savings),
  };
  for (const [key, val] of Object.entries(balances)) {
    if (isDemoBalanceSet && (key === "amazon" || key === "citi")) continue;
    initialBalances[key] = cleanBalance(val);
  }
  for (const card of cards) {
    if (balances[card.id] !== undefined) {
      initialBalances[card.id] = cleanBalance(balances[card.id]);
    } else if (initialBalances[card.id] === undefined) {
      initialBalances[card.id] = 0;
    }
  }

  const normalizedAccountContext = {
    settings: {
      cards,
      balances: initialBalances,
    },
  };

  return {
    settings: {
      startDate: isValidDateString(settings.startDate)
        ? settings.startDate
        : localDate(),
      balances: initialBalances,
      cards,
      configured: settings.configured === true,
      cardsConfigured:
        settings.cardsConfigured === true || cards.length > 0,
      updatedAt:
        typeof settings.updatedAt === "number" &&
        Number.isFinite(settings.updatedAt)
          ? settings.updatedAt
          : typeof settings.updatedAt === "string" &&
              Number.isFinite(Date.parse(settings.updatedAt))
            ? Date.parse(settings.updatedAt)
            : 0,
    },
    transactions: Array.isArray(saved.transactions)
      ? saved.transactions
          .filter((item) =>
            isValidAccountTransaction(item, normalizedAccountContext),
          )
          .map((item) => ({
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

export function getSavingsAccountId(cards = []) {
  if (!Array.isArray(cards) || cards.length === 0) return "savings";
  const exact = cards.find((c) => c.id === "savings");
  if (exact) return exact.id;
  const byType = cards.find(
    (c) => c.type === "savings" || c.provider === "savings",
  );
  return byType ? byType.id : "savings";
}

export function calculateAccountBalance(accountId, expenses, accountData) {
  const { balances, cards = [] } = accountData.settings;
  const savingsId = getSavingsAccountId(cards);
  const today = localDate();
  let balance = Number(balances[accountId] || 0);

  for (const expense of expenses) {
    if (expense.amount !== null && expense.date <= today) {
      if (expense.category === "Savings") {
        if (
          accountId === savingsId &&
          expense.account &&
          expense.account !== savingsId &&
          isAccountId(expense.account, accountData)
        )
          balance += Number(expense.amount);
        else if (expense.account === accountId && accountId !== savingsId)
          balance -= Number(expense.amount);
      } else if (expense.account === accountId) {
        balance -= Number(expense.amount);
      }
    }
  }

  for (const transaction of accountData.transactions) {
    if (transaction.date > today) continue;
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
