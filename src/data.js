import {
  encryptData,
  decryptData,
  getSessionKey,
  hasAppPin,
  ENCRYPTED_STORAGE_FORMAT,
  SENSITIVE_STORAGE_KEYS,
} from "./security.js";

export const STORAGE_KEYS = {
  expenses: "spend-expenses-v1",
  budgets: "spend-monthly-budgets-v1",
  budgetUpdatedAt: "spend-budget-updated-at-v1",
  recurring: "spend-recurring-expenses-v1",
  accounts: "spend-account-balances-v1",
  deletedRecords: "spend-deleted-records-v1",
  theme: "spend-theme-v1",
  currency: "spend-target-currency-v1",
  reminderTime: "spend-reminder-time-v1",
  profileName: "spend-profile-name-v1",
};

const SENSITIVE_STORAGE_KEY_SET = new Set(SENSITIVE_STORAGE_KEYS);

export function isSensitiveStorageKey(key) {
  return SENSITIVE_STORAGE_KEY_SET.has(key);
}

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

export const DEFAULT_CARDS = [];

export const ACCOUNT_OPTIONS = [];

export function getAccountOptions(accountData) {
  const cards = accountData?.settings?.cards;
  if (Array.isArray(cards)) {
    return cards.map((c) => [c.id, c.name]);
  }
  return [];
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

export function isPureUnconfiguredDemoState(saved) {
  if (!saved || typeof saved !== "object") return false;
  const settings = saved.settings || {};
  if (settings.configured === true || settings.cardsConfigured === true)
    return false;
  if (Array.isArray(saved.transactions) && saved.transactions.length > 0)
    return false;

  const rawBalances = settings.balances || {};
  const isZeroOrDemoBalances =
    hasSeededDemoBalances(rawBalances) ||
    Object.values(rawBalances).every((v) => Number(v) === 0);
  if (!isZeroOrDemoBalances) return false;

  const rawCards = Array.isArray(settings.cards) ? settings.cards : [];
  if (rawCards.length === 0) return true;

  const isLegacyDemoCards = rawCards.every((c) =>
    ["amazon", "citi", "bkash", "bank", "savings"].includes(c?.id),
  );
  return isLegacyDemoCards;
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
    if (saved === null) return fallback;
    const parsed = JSON.parse(saved);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.format === ENCRYPTED_STORAGE_FORMAT
    ) {
      // Data is encrypted at rest; cannot be read synchronously.
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export async function readStorageAsync(
  key,
  fallback,
  keyMaterial = getSessionKey(),
) {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    const decrypted = await decryptData(saved, keyMaterial);
    return decrypted === null || decrypted === undefined ? fallback : decrypted;
  } catch (err) {
    console.warn(`Failed to read/decrypt storage for ${key}:`, err);
    return fallback;
  }
}

const writeQueues = new Map();

export async function writeStorageAsync(
  key,
  value,
  keyMaterial = getSessionKey(),
) {
  if (isSensitiveStorageKey(key) && hasAppPin() && !keyMaterial) {
    // Session is locked. Guard against overwriting encrypted storage with empty defaults.
    return false;
  }

  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      try {
        if (keyMaterial && isSensitiveStorageKey(key)) {
          const encrypted = await encryptData(value, keyMaterial);
          localStorage.setItem(key, encrypted);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
        return true;
      } catch (err) {
        console.error(`Storage write error for ${key}:`, err);
        return false;
      }
    });

  writeQueues.set(key, next);
  return next;
}

export function writeStorage(key, value, keyMaterial = getSessionKey()) {
  if (isSensitiveStorageKey(key) && hasAppPin() && !keyMaterial) {
    return false;
  }
  void writeStorageAsync(key, value, keyMaterial);
  return true;
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
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (ACCOUNT_OPTIONS.some(([id]) => id === trimmed)) return true;
  if (DEFAULT_CARDS.some((c) => c.id === trimmed)) return true;
  if (trimmed.startsWith("card_")) return true;
  if (Array.isArray(accountData) && accountData.some((c) => (c?.id || c?.[0]) === trimmed)) return true;
  if (accountData?.settings?.cards?.some((c) => c.id === trimmed)) return true;
  if (
    accountData?.settings?.balances &&
    Object.hasOwn(accountData.settings.balances, trimmed)
  )
    return true;
  if (
    Array.isArray(accountData?.transactions) &&
    accountData.transactions.some(
      (t) =>
        t.account === trimmed ||
        t.fromAccount === trimmed ||
        t.toAccount === trimmed,
    )
  )
    return true;
  try {
    const saved = readStorage(STORAGE_KEYS.accounts, null);
    if (saved?.settings?.cards?.some((c) => c.id === trimmed)) return true;
    if (
      saved?.settings?.balances &&
      Object.hasOwn(saved.settings.balances, trimmed)
    )
      return true;
    if (
      Array.isArray(saved?.transactions) &&
      saved.transactions.some(
        (t) =>
          t.account === trimmed ||
          t.fromAccount === trimmed ||
          t.toAccount === trimmed,
      )
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
      balances: {},
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
  const type = item.type === "adjust" ? "adjustment" : item.type;
  const acct = item.account || item.accountId;
  const fromAcct = item.fromAccount || item.from_account || item.fromAccountId;
  const toAcct = item.toAccount || item.to_account || item.toAccountId;

  if (type === "income") return isAccountId(acct, accountData);
  if (type === "adjustment")
    return (
      isAccountId(acct, accountData) &&
      ["increase", "decrease", "up", "down"].includes(item.direction)
    );
  if (type === "transfer")
    return (
      isAccountId(fromAcct, accountData) &&
      isAccountId(toAcct, accountData) &&
      fromAcct !== toAcct
    );
  return false;
}

export function loadAccountData(
  saved = readStorage(STORAGE_KEYS.accounts, null),
  deletedRecords = null,
) {
  if (!saved || typeof saved !== "object") return emptyAccountData();
  if (isPureUnconfiguredDemoState(saved)) return emptyAccountData();

  const settings = saved.settings || {};
  const rawBalances = settings.balances || {};
  const cleanBalance = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0
      ? Math.round(amount * 100) / 100
      : 0;
  };

  const deletedCardTombstones = deletedRecords?.cards || {};

  const rawCards = Array.isArray(settings.cards) ? settings.cards : [];
  const cardMap = new Map();

  for (const card of rawCards) {
    if (
      card &&
      typeof card === "object" &&
      typeof card.id === "string" &&
      card.id.trim()
    ) {
      const id = card.id.trim();
      const tombstone = deletedCardTombstones[id];
      const createdAt =
        typeof card.createdAt === "number"
          ? card.createdAt
          : Date.parse(card.createdAt) || 0;
      const updatedAt =
        typeof card.updatedAt === "number"
          ? card.updatedAt
          : Date.parse(card.updatedAt) || createdAt || 0;

      // Skip tombstoned cards unless card was explicitly updated after deletion
      if (tombstone?.deleted && tombstone.updatedAt >= updatedAt) {
        continue;
      }

      const existingMatch = DEFAULT_CARDS.find((d) => d.id === id);
      const isMfs = Boolean(
        card?.isPhone ||
        card?.category === "mfs" ||
        card?.type === "mfs" ||
        card?.network === "mfs",
      );
      const isSavings = Boolean(
        card?.category === "savings" ||
        card?.type === "savings" ||
        String(card?.number || "").startsWith("SAV-") ||
        String(card?.number || "").startsWith("VAULT-"),
      );

      const rawNumber = String(card?.number || "").replace(/\D/g, "");
      const rawLast4 =
        card?.last4 ||
        (rawNumber ? rawNumber.slice(-4) : "") ||
        existingMatch?.last4 ||
        "";

      // Explicitly delete full card number and CVV before saving / loading
      const { cvv: _cvv, number: _number, ...safeCard } = card || {};

      let storedNumber = "";
      if (isSavings) {
        storedNumber =
          String(card?.number || "").trim() || (rawLast4 ? `SAV-${rawLast4}` : "");
      } else if (isMfs && rawNumber.length < 15) {
        storedNumber =
          String(card?.number || "").trim() || (rawLast4 ? `01••• •••${rawLast4}` : "");
      } else {
        storedNumber = rawLast4 ? `•••• •••• •••• ${rawLast4}` : "";
      }

      cardMap.set(id, {
        ...(existingMatch || {}),
        ...safeCard,
        id,
        name: card.name || existingMatch?.name || id,
        holderName:
          card.holderName || existingMatch?.holderName || "Cardholder",
        type: card.type || existingMatch?.type || "credit",
        network: card.network || existingMatch?.network || "visa",
        last4: rawLast4,
        number: storedNumber,
        expiry: card.expiry || existingMatch?.expiry || "",
        color: card.color || existingMatch?.color || "#1e293b",
        gradient: card.gradient || existingMatch?.gradient || "",
        createdAt,
        updatedAt,
      });
    }
  }

  // Self-healing recovery: reconstruct accounts referenced in active transactions or non-zero balances
  const allReferencedAccountIds = new Set();
  for (const [key, val] of Object.entries(rawBalances)) {
    if (deletedCardTombstones[key]?.deleted) continue;
    if (Number(val) > 0) {
      allReferencedAccountIds.add(key);
    }
  }
  if (Array.isArray(saved.transactions)) {
    for (const t of saved.transactions) {
      const acct = t?.account || t?.accountId;
      const fromAcct = t?.fromAccount || t?.from_account || t?.fromAccountId;
      const toAcct = t?.toAccount || t?.to_account || t?.toAccountId;
      if (acct && !deletedCardTombstones[acct]?.deleted)
        allReferencedAccountIds.add(acct);
      if (fromAcct && !deletedCardTombstones[fromAcct]?.deleted)
        allReferencedAccountIds.add(fromAcct);
      if (toAcct && !deletedCardTombstones[toAcct]?.deleted)
        allReferencedAccountIds.add(toAcct);
    }
  }

  const isBrandNewAccount =
    !settings.configured &&
    !settings.cardsConfigured &&
    rawCards.length === 0 &&
    (!Array.isArray(saved.transactions) || saved.transactions.length === 0) &&
    Object.values(rawBalances).every((v) => Number(v) === 0);

  const cardsAlreadyConfigured =
    settings.cardsConfigured === true || rawCards.length > 0;

  if (!isBrandNewAccount) {
    const stableTime = settings.updatedAt
      ? typeof settings.updatedAt === "number"
        ? settings.updatedAt
        : Date.parse(settings.updatedAt) || 0
      : 0;
    for (const accountId of allReferencedAccountIds) {
      if (deletedCardTombstones[accountId]?.deleted) continue;
      // If cards are already configured, only reconstruct if there is a positive balance to prevent losing funds
      if (cardsAlreadyConfigured && !(Number(rawBalances[accountId]) > 0)) {
        continue;
      }
      if (!cardMap.has(accountId)) {
        const defaultMatch = DEFAULT_CARDS.find((d) => d.id === accountId);
        if (defaultMatch) {
          cardMap.set(accountId, {
            ...defaultMatch,
            createdAt: stableTime,
            updatedAt: stableTime,
          });
        } else {
          cardMap.set(accountId, {
            id: accountId,
            name: accountId.startsWith("card_") ? "Account" : accountId,
            holderName: "Cardholder",
            type: "debit",
            network: "visa",
            last4: "",
            number: "",
            expiry: "",
            color: "#1e293b",
            gradient:
              "linear-gradient(135deg, #334155 0%, #1e293b 60%, #0f172a 100%)",
            createdAt: stableTime,
            updatedAt: stableTime,
          });
        }
      }
    }
  }

  const cards = Array.from(cardMap.values());

  const initialBalances = {};
  for (const [key, val] of Object.entries(rawBalances)) {
    if (deletedCardTombstones[key]?.deleted) continue;
    if (cardMap.has(key)) {
      initialBalances[key] = cleanBalance(val);
    }
  }
  for (const card of cards) {
    if (initialBalances[card.id] === undefined) {
      initialBalances[card.id] = cleanBalance(card.initialBalance);
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
      configured: settings.configured === true || cards.length > 0,
      cardsConfigured: settings.cardsConfigured === true || cards.length > 0,
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
            ...(item.account || item.accountId
              ? { account: item.account || item.accountId }
              : {}),
            ...(item.fromAccount || item.from_account
              ? { fromAccount: item.fromAccount || item.from_account }
              : {}),
            ...(item.toAccount || item.to_account
              ? { toAccount: item.toAccount || item.to_account }
              : {}),
            type: item.type === "adjust" ? "adjustment" : item.type,
            direction:
              item.direction === "up"
                ? "increase"
                : item.direction === "down"
                  ? "decrease"
                  : item.direction,
            amount: Math.round(Number(item.amount) * 100) / 100,
            description:
              typeof item.description === "string"
                ? item.description.slice(0, 80)
                : typeof item.note === "string"
                  ? item.note.slice(0, 80)
                  : "",
            createdAt:
              typeof item.createdAt === "number"
                ? item.createdAt
                : Date.parse(item.createdAt) || Date.now(),
            updatedAt:
              typeof item.updatedAt === "number"
                ? item.updatedAt
                : Date.parse(item.updatedAt) || Date.now(),
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
    if (!transaction || typeof transaction !== "object") continue;
    const txDate = transaction.date;
    if (txDate > today) continue;
    const amount = Number(transaction.amount ?? transaction.amt ?? 0);
    const txType = transaction.type;
    const account = transaction.account ?? transaction.acct;

    if (txType === "income" && account === accountId) {
      balance += amount;
    } else if ((txType === "adjustment" || txType === "adjust") && account === accountId) {
      const isUp =
        transaction.direction === "increase" ||
        transaction.direction === "up" ||
        transaction.dir === "up" ||
        transaction.dir === "increase";
      balance += isUp ? amount : -amount;
    } else if (txType === "transfer") {
      const fromAcct = transaction.fromAccount ?? transaction.acct;
      const toAcct = transaction.toAccount ?? transaction.to;
      if (fromAcct === accountId) balance -= amount;
      if (toAcct === accountId) balance += amount;
    }
  }

  return roundMoney(balance);
}
