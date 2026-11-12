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
  haptics: "spend-haptics-enabled-v1",
  currency: "spend-target-currency-v1",
  reminderTime: "spend-reminder-time-v1",
  profileName: "spend-profile-name-v1",
  profileAvatar: "spend-profile-avatar-v1",
  profileUpdatedAt: "spend-profile-updated-at-v1",
  preferredAccount: "spend-preferred-account-v1",
};

let hapticsEnabledCache = null;

export function isHapticsEnabled() {
  if (typeof hapticsEnabledCache === "boolean") return hapticsEnabledCache;
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.haptics);
    if (saved === "false" || saved === "0") {
      hapticsEnabledCache = false;
      return false;
    }
    hapticsEnabledCache = true;
    return true;
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled) {
  const next = Boolean(enabled);
  hapticsEnabledCache = next;
  try {
    localStorage.setItem(STORAGE_KEYS.haptics, next ? "true" : "false");
  } catch {
    // Keep in-memory preference for this session if storage is unavailable.
  }
  return next;
}

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

export async function flushStorageWriteQueues() {
  const pending = [...writeQueues.values()];
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }
}

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

export function isSavingsCard(card) {
  if (!card || typeof card !== "object") return false;
  return Boolean(
    card.category === "savings" ||
      card.type === "savings" ||
      card.provider === "savings" ||
      card.id === "savings" ||
      String(card.number || "").startsWith("SAV-") ||
      String(card.number || "").startsWith("VAULT-") ||
      String(card.number || "").startsWith("DPS-"),
  );
}

export function isPhantomAutoReconstructedCard(card) {
  if (!card || typeof card !== "object") return false;
  const hasNoCustomDetails =
    !card.last4 &&
    !card.number &&
    !card.expiry &&
    !card.provider &&
    !card.category &&
    !card.subtitle;
  const isDefaultPlaceholderAppearance =
    card.holderName === "Cardholder" &&
    card.type === "debit" &&
    card.network === "visa" &&
    card.color === "#1e293b";
  const isAutoNamed =
    card.name === "Account" ||
    card.name === card.id ||
    ["bkash", "bank", "savings"].includes(card.id);
  return (
    hasNoCustomDetails && isDefaultPlaceholderAppearance && isAutoNamed
  );
}

export function loadExpenses(
  saved = readStorage(STORAGE_KEYS.expenses, []),
  accountData = null,
  deletedRecords = null,
) {
  const remappedAccounts = accountData?.remappedAccountIds || {};
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
        .map((item) => {
          const rawAcct =
            typeof item.account === "string" ? item.account.trim() : "";
          const mappedAcct = remappedAccounts[rawAcct] || rawAcct;
          return {
            ...item,
            category: CATEGORIES.includes(item.category)
              ? item.category
              : "Other",
            account: isAccountId(mappedAcct, accountData, deletedRecords)
              ? mappedAcct
              : "",
          };
        })
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

export function isAccountId(value, accountData = null, deletedRecords = null) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === "cash") return true;
  if (
    deletedRecords?.cards &&
    Object.hasOwn(deletedRecords.cards, trimmed)
  ) {
    return true;
  }
  if (
    Array.isArray(accountData) &&
    accountData.some((c) => (c?.id || c?.[0]) === trimmed)
  )
    return true;
  if (accountData && typeof accountData === "object") {
    if (accountData?.remappedAccountIds?.[trimmed]) return true;
    if (accountData?.settings?.cards?.some((c) => c.id === trimmed))
      return true;
    if (
      accountData?.settings?.balances &&
      Object.hasOwn(accountData.settings.balances, trimmed)
    )
      return true;
    if (
      accountData?.deletedCards &&
      Object.hasOwn(accountData.deletedCards, trimmed)
    )
      return true;
    return false;
  }
  try {
    const deleted = readStorage(STORAGE_KEYS.deletedRecords, null);
    if (deleted?.cards && Object.hasOwn(deleted.cards, trimmed)) return true;
    const saved = readStorage(STORAGE_KEYS.accounts, null);
    if (saved?.settings?.cards?.some((c) => c.id === trimmed)) return true;
    if (
      saved?.settings?.balances &&
      Object.hasOwn(saved.settings.balances, trimmed)
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
  const remappedAccounts = accountData?.remappedAccountIds || {};
  return Array.isArray(saved)
    ? saved.filter(isValidRecurringSchedule).map((schedule) => {
        const rawAcct =
          typeof schedule.account === "string" ? schedule.account.trim() : "";
        const mappedAcct = remappedAccounts[rawAcct] || rawAcct;
        return {
          ...schedule,
          ...(typeof schedule.createdAt === "number" &&
          Number.isFinite(schedule.createdAt)
            ? { createdAt: schedule.createdAt }
            : typeof schedule.createdAt === "string" &&
                Number.isFinite(Date.parse(schedule.createdAt))
              ? { createdAt: Date.parse(schedule.createdAt) }
              : {}),
          ...(typeof schedule.updatedAt === "number" &&
          Number.isFinite(schedule.updatedAt)
            ? { updatedAt: schedule.updatedAt }
            : typeof schedule.updatedAt === "string" &&
                Number.isFinite(Date.parse(schedule.updatedAt))
              ? { updatedAt: Date.parse(schedule.updatedAt) }
              : {}),
          account: isAccountId(mappedAcct, accountData) ? mappedAcct : "",
          dayOfMonth:
            Number.isInteger(schedule.dayOfMonth) &&
            schedule.dayOfMonth >= 1 &&
            schedule.dayOfMonth <= 31
              ? schedule.dayOfMonth
              : Number(schedule.nextDate.slice(-2)),
        };
      })
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
  const rawBalances =
    settings.balances && typeof settings.balances === "object"
      ? settings.balances
      : {};
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
      if (isPhantomAutoReconstructedCard(card)) {
        continue;
      }
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

      const isMfs = Boolean(
        card?.isPhone ||
          card?.category === "mfs" ||
          card?.type === "mfs" ||
          card?.network === "mfs",
      );
      const isSavings = isSavingsCard(card);

      const rawNumber = String(card?.number || "").replace(/\D/g, "");
      const rawLast4 = card?.last4 || (rawNumber ? rawNumber.slice(-4) : "");

      // Explicitly delete full card number and CVV before saving / loading
      const { cvv: _cvv, number: _number, ...safeCard } = card || {};

      let storedNumber = "";
      if (isSavings) {
        storedNumber =
          String(card?.number || "").trim() ||
          (rawLast4 ? `SAV-${rawLast4}` : "");
      } else if (isMfs && rawNumber.length < 15) {
        storedNumber =
          String(card?.number || "").trim() ||
          (rawLast4 ? `01••• •••${rawLast4}` : "");
      } else {
        storedNumber = rawLast4 ? `•••• •••• •••• ${rawLast4}` : "";
      }

      const hasBalanceKey =
        Object.hasOwn(rawBalances, id) &&
        rawBalances[id] !== undefined &&
        rawBalances[id] !== null &&
        Number.isFinite(Number(rawBalances[id]));
      const hasCardInitBal =
        card.initialBalance !== undefined &&
        card.initialBalance !== null &&
        String(card.initialBalance).trim() !== "" &&
        Number.isFinite(Number(card.initialBalance));

      let resolvedBalance = 0;
      if (hasBalanceKey && hasCardInitBal) {
        const balVal = cleanBalance(rawBalances[id]);
        const initVal = cleanBalance(card.initialBalance);
        if (balVal === initVal) {
          resolvedBalance = balVal;
        } else if (balVal === 0 && initVal > 0) {
          resolvedBalance = initVal;
        } else {
          resolvedBalance = balVal;
        }
      } else if (hasBalanceKey) {
        resolvedBalance = cleanBalance(rawBalances[id]);
      } else if (hasCardInitBal) {
        resolvedBalance = cleanBalance(card.initialBalance);
      }

      cardMap.set(id, {
        ...safeCard,
        id,
        name: card.name || id,
        holderName: card.holderName || "Cardholder",
        type: isSavings ? "savings" : card.type || "credit",
        network: isSavings ? "none" : card.network || "visa",
        ...(isSavings ? { category: "savings" } : {}),
        last4: rawLast4,
        number: storedNumber,
        expiry: isSavings || isMfs ? "" : card.expiry || "",
        color: card.color || "#1e293b",
        gradient: card.gradient || "",
        initialBalance: resolvedBalance,
        createdAt,
        updatedAt,
      });
    }
  }

  // Deduplicate singleton Savings Vault if multiple savings cards exist from cross-device sync
  const remappedAccountIds = {};
  const savingsCards = Array.from(cardMap.values()).filter(isSavingsCard);
  if (savingsCards.length > 1) {
    savingsCards.sort((a, b) => {
      const timeDiff = (b.updatedAt || 0) - (a.updatedAt || 0);
      if (timeDiff !== 0) return timeDiff;
      const balDiff =
        cleanBalance(b.initialBalance) - cleanBalance(a.initialBalance);
      if (balDiff !== 0) return balDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const winningSavings = savingsCards[0];
    for (let i = 1; i < savingsCards.length; i += 1) {
      const duplicate = savingsCards[i];
      cardMap.delete(duplicate.id);
      remappedAccountIds[duplicate.id] = winningSavings.id;
    }
  }

  const cards = Array.from(cardMap.values());

  const initialBalances = {};
  for (const card of cards) {
    initialBalances[card.id] = cleanBalance(card.initialBalance);
  }

  const normalizedAccountContext = {
    settings: {
      cards,
      balances: initialBalances,
    },
    deletedCards: deletedCardTombstones,
    remappedAccountIds,
  };

  const resolvedPrimaryCardId =
    (typeof settings.primaryCardId === "string" &&
      cardMap.has(settings.primaryCardId) &&
      !isSavingsCard(cardMap.get(settings.primaryCardId)) &&
      settings.primaryCardId) ||
    cards.find((c) => c.isPrimary && !isSavingsCard(c))?.id ||
    "";

  const syncedCards = cards.map((c) => ({
    ...c,
    isPrimary: Boolean(resolvedPrimaryCardId && c.id === resolvedPrimaryCardId),
    initialBalance: initialBalances[c.id],
  }));

  const mapAcct = (id) => {
    if (!id || typeof id !== "string") return id;
    const trimmed = id.trim();
    return remappedAccountIds[trimmed] || trimmed;
  };

  const deletedTxTombstones = deletedRecords?.accountTransactions || {};

  return {
    settings: {
      startDate: isValidDateString(settings.startDate)
        ? settings.startDate
        : localDate(),
      balances: initialBalances,
      cards: syncedCards,
      ...(resolvedPrimaryCardId ? { primaryCardId: resolvedPrimaryCardId } : {}),
      configured: settings.configured === true || syncedCards.length > 0,
      cardsConfigured:
        settings.cardsConfigured === true || syncedCards.length > 0,
      updatedAt:
        typeof settings.updatedAt === "number" &&
        Number.isFinite(settings.updatedAt)
          ? settings.updatedAt
          : typeof settings.updatedAt === "string" &&
              Number.isFinite(Date.parse(settings.updatedAt))
            ? Date.parse(settings.updatedAt)
            : 0,
    },
    ...(Object.keys(remappedAccountIds).length > 0
      ? { remappedAccountIds }
      : {}),
    transactions: Array.isArray(saved.transactions)
      ? saved.transactions
          .filter((item) => {
            if (!item || typeof item !== "object" || !item.id) return false;
            const tombstone = deletedTxTombstones[item.id];
            const txTime =
              typeof item.updatedAt === "number"
                ? item.updatedAt
                : Date.parse(item.updatedAt) ||
                  (typeof item.createdAt === "number"
                    ? item.createdAt
                    : Date.parse(item.createdAt) || 0);
            return !(tombstone?.deleted && tombstone.updatedAt >= txTime);
          })
          .map((item) => {
            if (!item || typeof item !== "object") return item;
            const acct = mapAcct(item.account || item.accountId);
            const fromAcct = mapAcct(
              item.fromAccount || item.from_account || item.fromAccountId,
            );
            const toAcct = mapAcct(
              item.toAccount || item.to_account || item.toAccountId,
            );
            return {
              ...item,
              ...(acct ? { account: acct } : {}),
              ...(fromAcct ? { fromAccount: fromAcct } : {}),
              ...(toAcct ? { toAccount: toAcct } : {}),
            };
          })
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

export function parseAmount(val) {
  if (val === "" || val == null) return null;
  let str = String(val)
    .trim()
    .replace(/[৳$€£\s]/g, "");
  if (!str) return null;
  if (str.includes(",") && str.includes(".")) {
    if (str.indexOf(",") < str.indexOf(".")) {
      str = str.replace(/,/g, "");
    } else {
      str = str.replace(/\./g, "").replace(",", ".");
    }
  } else if (str.includes(",")) {
    const parts = str.split(",");
    if (parts.length === 2 && parts[1].length !== 3) {
      str = parts[0] + "." + parts[1];
    } else {
      str = str.replace(/,/g, "");
    }
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : NaN;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
  if (!Array.isArray(cards) || cards.length === 0) return "";
  const byCategoryOrType = cards.find((c) => isSavingsCard(c));
  if (byCategoryOrType) return byCategoryOrType.id;
  return "";
}
