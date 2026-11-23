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

export const TOMBSTONE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
export const MAX_TOMBSTONES_PER_COLLECTION = 500;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function cleanEnv(value) {
  return typeof value === "string"
    ? value.trim().replace(/^['"]|['"]$/g, "")
    : "";
}

export function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function recordUpdatedAt(record) {
  return parseTimestampMs(record?.updatedAt ?? record?.updated_at);
}

export function clampDayOfMonth(dayOrYear, month, day) {
  if (month !== undefined && day !== undefined) {
    const y = Number(dayOrYear);
    const m = Number(month);
    const d = Math.max(1, Math.min(31, Math.round(Number(day) || 1)));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      return d;
    }
    const lastDay = new Date(y, m, 0).getDate();
    return Math.min(d, lastDay);
  }
  const num = Number(dayOrYear);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(31, Math.round(num)));
}

export function addDaysToDateString(dateStr, days) {
  const [y, m, d] = String(dateStr || "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return localDate();
  return localDate(new Date(y, m - 1, d + (Number(days) || 0)));
}

export function toPoisha(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function fromPoisha(poisha) {
  const intVal = Math.round(Number(poisha) || 0);
  const result = intVal / 100;
  return Object.is(result, -0) ? 0 : Number(result.toFixed(2));
}

export function roundMoney(value) {
  return fromPoisha(toPoisha(value));
}

export function emptyDeletedRecords() {
  return {
    expenses: {},
    budgets: {},
    recurringSchedules: {},
    accountTransactions: {},
    cards: {},
  };
}

export function normalizeDeletedRecords(value, now = Date.now()) {
  const safeNow =
    Number.isFinite(Number(now)) && Number(now) > 0 ? Number(now) : Date.now();
  const cutoff = safeNow - TOMBSTONE_MAX_AGE_MS;

  const cleanChanges = (changes) => {
    let entries = [];
    if (Array.isArray(changes)) {
      const uniqueIds = [
        ...new Set(changes.filter((id) => typeof id === "string" && id.trim())),
      ];
      entries = uniqueIds.map((id) => [
        id.trim().slice(0, 120),
        { deleted: true, updatedAt: safeNow },
      ]);
    } else if (changes && typeof changes === "object") {
      for (const [rawId, change] of Object.entries(changes)) {
        const id = typeof rawId === "string" ? rawId.trim().slice(0, 120) : "";
        if (
          !id ||
          !change ||
          typeof change !== "object" ||
          typeof change.deleted !== "boolean"
        ) {
          continue;
        }
        const rawUpdatedAt = parseTimestampMs(change.updatedAt);
        // Legacy entries with updatedAt: 0 are stamped so they can age out cleanly instead of persisting forever
        const updatedAt =
          rawUpdatedAt > 0
            ? rawUpdatedAt
            : safeNow - TOMBSTONE_MAX_AGE_MS + 24 * 60 * 60 * 1000;
        if (updatedAt < cutoff) continue;
        entries.push([
          id,
          {
            deleted: change.deleted,
            updatedAt,
            ...(typeof change.name === "string"
              ? { name: change.name.slice(0, 80) }
              : {}),
            ...(typeof change.color === "string"
              ? { color: change.color.slice(0, 32) }
              : {}),
          },
        ]);
      }
    }

    if (entries.length > MAX_TOMBSTONES_PER_COLLECTION) {
      entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
      entries = entries.slice(0, MAX_TOMBSTONES_PER_COLLECTION);
    }

    return Object.fromEntries(entries);
  };

  return {
    expenses: cleanChanges(value?.expenses),
    budgets: cleanChanges(value?.budgets),
    recurringSchedules: cleanChanges(value?.recurringSchedules),
    accountTransactions: cleanChanges(value?.accountTransactions),
    cards: cleanChanges(value?.cards),
  };
}

export function mergeDeletedRecords(...values) {
  const now = Date.now();
  const merged = emptyDeletedRecords();
  for (const value of values) {
    const normalized = normalizeDeletedRecords(value, now);
    for (const key of Object.keys(merged)) {
      for (const [id, change] of Object.entries(normalized[key])) {
        if (!merged[key][id] || change.updatedAt >= merged[key][id].updatedAt) {
          merged[key][id] = change;
        }
      }
    }
  }
  return normalizeDeletedRecords(merged, now);
}

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
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
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

export function isCashCard(card) {
  if (!card || typeof card !== "object") return false;
  return Boolean(
    card.id === "cash" ||
    card.provider === "cash" ||
    card.category === "cash" ||
    card.type === "cash",
  );
}

export function isMfsCard(card) {
  if (!card || typeof card !== "object") return false;
  return Boolean(
    card.isPhone ||
    card.category === "mfs" ||
    card.type === "mfs" ||
    card.network === "mfs" ||
    ["bkash", "nagad", "rocket", "upay"].includes(
      String(card.provider || "").toLowerCase(),
    ),
  );
}

export function isCreditCard(card) {
  if (!card || typeof card !== "object") return false;
  if (isSavingsCard(card) || isCashCard(card) || isMfsCard(card)) return false;
  return String(card.type || "").toLowerCase() === "credit";
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
  return hasNoCustomDetails && isDefaultPlaceholderAppearance && isAutoNamed;
}

export function loadExpenses(
  saved = readStorage(STORAGE_KEYS.expenses, []),
  accountData = null,
  deletedRecords = null,
) {
  const remappedAccounts = accountData?.remappedAccountIds || {};
  const deletedExpenseTombstones = deletedRecords?.expenses || {};
  return Array.isArray(saved)
    ? saved
        .filter((item) => {
          if (
            !item ||
            typeof item.id !== "string" ||
            !item.id.trim() ||
            typeof item.description !== "string" ||
            !isValidDateString(item.date) ||
            !(
              item.amount === null ||
              (Number.isFinite(Number(item.amount)) && Number(item.amount) > 0)
            )
          ) {
            return false;
          }
          const id = item.id.trim();
          if (deletedExpenseTombstones[id]?.deleted === true) {
            return false;
          }
          if (
            item.recurringId &&
            deletedExpenseTombstones[
              `recurring:${item.recurringId}:${item.date}`
            ]?.deleted === true
          ) {
            return false;
          }
          return true;
        })
        .map((item) => {
          const rawAcct =
            typeof item.account === "string" ? item.account.trim() : "";
          const mappedAcct = remappedAccounts[rawAcct] || rawAcct;
          const createdAt = parseTimestampMs(item.createdAt);
          const updatedAt = parseTimestampMs(item.updatedAt) || createdAt;
          return {
            ...item,
            id: item.id.trim().slice(0, 120),
            description: item.description.trim().slice(0, 160),
            amount:
              item.amount === null ? null : roundMoney(Number(item.amount)),
            category: CATEGORIES.includes(item.category)
              ? item.category
              : "Other",
            account: isAccountId(mappedAcct, accountData, deletedRecords)
              ? mappedAcct.slice(0, 120)
              : "",
            ...(item.recurringId
              ? { recurringId: String(item.recurringId).trim().slice(0, 120) }
              : {}),
            ...(createdAt > 0 ? { createdAt } : {}),
            ...(updatedAt > 0 ? { updatedAt } : {}),
          };
        })
    : [];
}

export function loadBudgets(saved = readStorage(STORAGE_KEYS.budgets, {})) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(
    Object.entries(saved)
      .filter(
        ([month, amount]) =>
          /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
          Number.isFinite(Number(amount)) &&
          Number(amount) > 0,
      )
      .map(([month, amount]) => [month, roundMoney(Number(amount))]),
  );
}

export function isAccountId(value, accountData = null, deletedRecords = null) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === "cash") return true;
  if (deletedRecords?.cards && Object.hasOwn(deletedRecords.cards, trimmed)) {
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
  } catch (err) {
    console.warn("Could not inspect fallback account storage:", err);
  }
  return false;
}

function isValidRecurringSchedule(schedule) {
  return (
    schedule &&
    typeof schedule.id === "string" &&
    Boolean(schedule.id.trim()) &&
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
        const createdAt = parseTimestampMs(schedule.createdAt);
        const updatedAt = parseTimestampMs(schedule.updatedAt) || createdAt;
        const rawDay = Number(schedule.dayOfMonth);
        return {
          ...schedule,
          id: schedule.id.trim().slice(0, 120),
          description: schedule.description.trim().slice(0, 160),
          amount: roundMoney(Number(schedule.amount)),
          ...(createdAt > 0 ? { createdAt } : {}),
          ...(updatedAt > 0 ? { updatedAt } : {}),
          account: isAccountId(mappedAcct, accountData)
            ? mappedAcct.slice(0, 120)
            : "",
          dayOfMonth:
            Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31
              ? rawDay
              : clampDayOfMonth(Number(schedule.nextDate.slice(-2))),
        };
      })
    : [];
}

export function emptyAccountData() {
  return {
    settings: {
      startDate: localDate(),
      balances: {},
      openingBalances: {},
      currentBalances: {},
      cards: [],
      configured: false,
      cardsConfigured: false,
      updatedAt: 0,
    },
    transactions: [],
  };
}

/**
 * Deterministic MFS-grade balance engine shared across App state,
 * MobilePrototype UI, backups, CSV exports, and mirrored in SQL.
 * Uses integer poisha arithmetic internally to prevent IEEE-754 float drift.
 */
export function computeAccountBalances(
  cards = [],
  openingBalances = {},
  expenses = [],
  transactions = [],
  reportedBalances = null,
) {
  const safeCards = Array.isArray(cards) ? cards : [];
  const rawOpening =
    openingBalances && typeof openingBalances === "object"
      ? openingBalances
      : {};
  const savingsId = getSavingsAccountId(safeCards);
  const cashCard = safeCards.find(isCashCard) || null;
  const cashAccountId = cashCard?.id || "cash";
  const creditCardIds = new Set(
    safeCards.filter(isCreditCard).map((c) => c.id),
  );

  const normalizeAcctId = (raw) => {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed || trimmed === "cash") return cashAccountId;
    return trimmed;
  };

  const openingPoishaMap = {};
  const creditsPoishaByAccount = {};
  const debitsPoishaByAccount = {};

  for (const [k, v] of Object.entries(rawOpening)) {
    if (k === "date") continue;
    const key = k === "cash" ? cashAccountId : k;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0) {
      openingPoishaMap[key] = toPoisha(num);
      creditsPoishaByAccount[key] = 0;
      debitsPoishaByAccount[key] = 0;
    }
  }
  for (const card of safeCards) {
    if (!card?.id) continue;
    const rawVal =
      rawOpening[card.id] ??
      (isCashCard(card) ? rawOpening.cash : undefined) ??
      card.initialBalance ??
      0;
    const num = Number(rawVal);
    openingPoishaMap[card.id] =
      Number.isFinite(num) && num >= 0 ? toPoisha(num) : 0;
    creditsPoishaByAccount[card.id] = 0;
    debitsPoishaByAccount[card.id] = 0;
  }

  const ensureAccountInitialized = (acctId) => {
    if (!acctId || acctId === "date") return;
    if (!Object.hasOwn(openingPoishaMap, acctId)) {
      openingPoishaMap[acctId] = 0;
    }
    if (!Object.hasOwn(creditsPoishaByAccount, acctId)) {
      creditsPoishaByAccount[acctId] = 0;
    }
    if (!Object.hasOwn(debitsPoishaByAccount, acctId)) {
      debitsPoishaByAccount[acctId] = 0;
    }
  };

  const addCreditPoisha = (acctId, amountPoisha) => {
    if (!acctId || acctId === "date") return;
    ensureAccountInitialized(acctId);
    creditsPoishaByAccount[acctId] =
      (creditsPoishaByAccount[acctId] || 0) + amountPoisha;
  };
  const addDebitPoisha = (acctId, amountPoisha) => {
    if (!acctId || acctId === "date") return;
    ensureAccountInitialized(acctId);
    debitsPoishaByAccount[acctId] =
      (debitsPoishaByAccount[acctId] || 0) + amountPoisha;
  };

  const runningPoishaBalances = { ...openingPoishaMap };
  const rawEvents = [];

  if (Array.isArray(expenses)) {
    for (const exp of expenses) {
      if (!exp || typeof exp !== "object") continue;
      const amt = Number(exp.amount ?? exp.amt);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const amountPoisha = toPoisha(amt);
      if (amountPoisha <= 0) continue;
      const date = exp.date ?? exp.d ?? "";
      const rawAcct =
        typeof (exp.account ?? exp.acct) === "string"
          ? (exp.account ?? exp.acct).trim()
          : "";
      const acct = normalizeAcctId(rawAcct);
      const cat = exp.category ?? exp.cat ?? "Other";
      const isSavingsTransfer =
        cat === "Savings" && Boolean(savingsId) && acct !== savingsId;

      const createdAt = parseTimestampMs(exp.createdAt);
      const updatedAt = parseTimestampMs(exp.updatedAt) || createdAt;
      rawEvents.push({
        id: String(exp.id || ""),
        sourceType: "expense",
        type: isSavingsTransfer ? "savings" : "expense",
        date: String(date),
        createdAt,
        updatedAt,
        amountPoisha,
        amount: fromPoisha(amountPoisha),
        description: String(exp.description ?? exp.desc ?? cat ?? "Expense"),
        category: String(cat),
        recurringId: exp.recurringId || (exp.rec ? "recurring" : ""),
        account: isSavingsTransfer ? acct || savingsId : acct,
        fromAccount: isSavingsTransfer ? acct : "",
        toAccount: isSavingsTransfer ? savingsId : "",
        direction: null,
      });
    }
  }

  if (Array.isArray(transactions)) {
    for (const tx of transactions) {
      if (!tx || typeof tx !== "object") continue;
      const amt = Number(tx.amount ?? tx.amt);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const amountPoisha = toPoisha(amt);
      if (amountPoisha <= 0) continue;
      const rawType = tx.type === "adjust" ? "adjustment" : tx.type;
      if (!["income", "adjustment", "transfer"].includes(rawType)) continue;
      const date = tx.date ?? tx.d ?? "";
      const rawAcct =
        typeof (tx.account ?? tx.acct) === "string"
          ? (tx.account ?? tx.acct).trim()
          : "";
      const rawFrom =
        typeof (tx.fromAccount ?? tx.from_account ?? tx.acct) === "string"
          ? (tx.fromAccount ?? tx.from_account ?? tx.acct).trim()
          : "";
      const rawTo =
        typeof (tx.toAccount ?? tx.to_account ?? tx.to) === "string"
          ? (tx.toAccount ?? tx.to_account ?? tx.to).trim()
          : "";
      const acct = rawAcct ? normalizeAcctId(rawAcct) : "";
      const fromAcct = rawFrom ? normalizeAcctId(rawFrom) : "";
      const toAcct = rawTo ? normalizeAcctId(rawTo) : "";
      const rawDir = tx.direction ?? tx.dir;
      const direction =
        rawDir === "up" || rawDir === "increase" ? "increase" : "decrease";
      const createdAt = parseTimestampMs(tx.createdAt);
      const updatedAt = parseTimestampMs(tx.updatedAt) || createdAt;

      rawEvents.push({
        id: String(tx.id || ""),
        sourceType: "tx",
        type: rawType,
        date: String(date),
        createdAt,
        updatedAt,
        amountPoisha,
        amount: fromPoisha(amountPoisha),
        description: String(tx.description ?? tx.note ?? ""),
        category:
          rawType === "income"
            ? "Income"
            : rawType === "transfer"
              ? "Transfer"
              : "Adjustment",
        recurringId: "",
        account: rawType === "transfer" ? fromAcct : acct,
        fromAccount: rawType === "transfer" ? fromAcct : "",
        toAccount: rawType === "transfer" ? toAcct : "",
        direction: rawType === "adjustment" ? direction : null,
      });
    }
  }

  // Strictly sort by chronological creation order (date ASC, createdAt ASC, id ASC)
  rawEvents.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );

  const ledgerById = new Map();
  const ledgerEvents = [];
  let totalExpensesPoisha = 0;
  let totalIncomePoisha = 0;
  let totalSavingsTransfersPoisha = 0;
  let totalAccountTransfersPoisha = 0;
  let totalAdjustmentsNetPoisha = 0;

  for (const ev of rawEvents) {
    const pAmt = ev.amountPoisha;
    let balanceBefore = null;
    let balanceAfter = null;
    let fromBalanceBefore = null;
    let fromBalanceAfter = null;
    let toBalanceBefore = null;
    let toBalanceAfter = null;

    if (ev.type === "expense") {
      totalExpensesPoisha += pAmt;
      if (ev.account) {
        ensureAccountInitialized(ev.account);
        const beforeP = runningPoishaBalances[ev.account] || 0;
        const afterP = creditCardIds.has(ev.account)
          ? beforeP + pAmt
          : beforeP - pAmt;
        runningPoishaBalances[ev.account] = afterP;
        if (creditCardIds.has(ev.account)) {
          addCreditPoisha(ev.account, pAmt);
        } else {
          addDebitPoisha(ev.account, pAmt);
        }
        balanceBefore = fromPoisha(beforeP);
        balanceAfter = fromPoisha(afterP);
      }
    } else if (ev.type === "income") {
      totalIncomePoisha += pAmt;
      if (ev.account) {
        ensureAccountInitialized(ev.account);
        const beforeP = runningPoishaBalances[ev.account] || 0;
        const afterP = creditCardIds.has(ev.account)
          ? beforeP - pAmt
          : beforeP + pAmt;
        runningPoishaBalances[ev.account] = afterP;
        if (creditCardIds.has(ev.account)) {
          addDebitPoisha(ev.account, pAmt);
        } else {
          addCreditPoisha(ev.account, pAmt);
        }
        balanceBefore = fromPoisha(beforeP);
        balanceAfter = fromPoisha(afterP);
      }
    } else if (ev.type === "adjustment") {
      const deltaP = ev.direction === "increase" ? pAmt : -pAmt;
      totalAdjustmentsNetPoisha += deltaP;
      if (ev.account) {
        ensureAccountInitialized(ev.account);
        const beforeP = runningPoishaBalances[ev.account] || 0;
        const afterP = beforeP + deltaP;
        runningPoishaBalances[ev.account] = afterP;
        if (ev.direction === "increase") {
          addCreditPoisha(ev.account, pAmt);
        } else {
          addDebitPoisha(ev.account, pAmt);
        }
        balanceBefore = fromPoisha(beforeP);
        balanceAfter = fromPoisha(afterP);
      }
    } else if (ev.type === "savings") {
      totalSavingsTransfersPoisha += pAmt;
      const hasValidFunding =
        Boolean(ev.fromAccount) && ev.fromAccount !== ev.toAccount;
      if (hasValidFunding) {
        ensureAccountInitialized(ev.fromAccount);
        const fromBeforeP = runningPoishaBalances[ev.fromAccount] || 0;
        const fromAfterP = creditCardIds.has(ev.fromAccount)
          ? fromBeforeP + pAmt
          : fromBeforeP - pAmt;
        runningPoishaBalances[ev.fromAccount] = fromAfterP;
        if (creditCardIds.has(ev.fromAccount)) {
          addCreditPoisha(ev.fromAccount, pAmt);
        } else {
          addDebitPoisha(ev.fromAccount, pAmt);
        }
        fromBalanceBefore = fromPoisha(fromBeforeP);
        fromBalanceAfter = fromPoisha(fromAfterP);
        balanceBefore = fromBalanceBefore;
        balanceAfter = fromBalanceAfter;
      }
      if (ev.toAccount && hasValidFunding) {
        ensureAccountInitialized(ev.toAccount);
        const toBeforeP = runningPoishaBalances[ev.toAccount] || 0;
        const toAfterP = toBeforeP + pAmt;
        runningPoishaBalances[ev.toAccount] = toAfterP;
        addCreditPoisha(ev.toAccount, pAmt);
        toBalanceBefore = fromPoisha(toBeforeP);
        toBalanceAfter = fromPoisha(toAfterP);
        if (balanceBefore === null) {
          balanceBefore = toBalanceBefore;
          balanceAfter = toBalanceAfter;
        }
      }
    } else if (ev.type === "transfer") {
      totalAccountTransfersPoisha += pAmt;
      if (ev.fromAccount && ev.fromAccount !== ev.toAccount) {
        ensureAccountInitialized(ev.fromAccount);
        const fromBeforeP = runningPoishaBalances[ev.fromAccount] || 0;
        const fromAfterP = creditCardIds.has(ev.fromAccount)
          ? fromBeforeP + pAmt
          : fromBeforeP - pAmt;
        runningPoishaBalances[ev.fromAccount] = fromAfterP;
        if (creditCardIds.has(ev.fromAccount)) {
          addCreditPoisha(ev.fromAccount, pAmt);
        } else {
          addDebitPoisha(ev.fromAccount, pAmt);
        }
        fromBalanceBefore = fromPoisha(fromBeforeP);
        fromBalanceAfter = fromPoisha(fromAfterP);
        balanceBefore = fromBalanceBefore;
        balanceAfter = fromBalanceAfter;
      }
      if (ev.toAccount && ev.toAccount !== ev.fromAccount) {
        ensureAccountInitialized(ev.toAccount);
        const toBeforeP = runningPoishaBalances[ev.toAccount] || 0;
        const toAfterP = creditCardIds.has(ev.toAccount)
          ? toBeforeP - pAmt
          : toBeforeP + pAmt;
        runningPoishaBalances[ev.toAccount] = toAfterP;
        if (creditCardIds.has(ev.toAccount)) {
          addDebitPoisha(ev.toAccount, pAmt);
        } else {
          addCreditPoisha(ev.toAccount, pAmt);
        }
        toBalanceBefore = fromPoisha(toBeforeP);
        toBalanceAfter = fromPoisha(toAfterP);
        if (balanceBefore === null) {
          balanceBefore = toBalanceBefore;
          balanceAfter = toBalanceAfter;
        }
      }
    }

    const { amountPoisha: _amountPoisha, ...restEvent } = ev;
    const enriched = {
      ...restEvent,
      balanceBefore,
      balanceAfter,
      fromBalanceBefore,
      fromBalanceAfter,
      toBalanceBefore,
      toBalanceAfter,
    };
    ledgerEvents.push(enriched);
    if (ev.id) {
      ledgerById.set(ev.id, enriched);
    }
  }

  // Keep "cash" alias synchronized if cashCard has a custom ID
  if (
    cashAccountId !== "cash" &&
    Object.hasOwn(runningPoishaBalances, cashAccountId)
  ) {
    openingPoishaMap.cash = openingPoishaMap[cashAccountId];
    runningPoishaBalances.cash = runningPoishaBalances[cashAccountId];
  }

  const openingMap = {};
  const runningBalances = {};
  const creditsByAccount = {};
  const debitsByAccount = {};
  for (const [k, v] of Object.entries(openingPoishaMap)) {
    openingMap[k] = fromPoisha(v);
  }
  for (const [k, v] of Object.entries(runningPoishaBalances)) {
    runningBalances[k] = fromPoisha(v);
  }
  for (const [k, v] of Object.entries(creditsPoishaByAccount)) {
    creditsByAccount[k] = fromPoisha(v);
  }
  for (const [k, v] of Object.entries(debitsPoishaByAccount)) {
    debitsByAccount[k] = fromPoisha(v);
  }

  // Ledger Reconciliation Check: opening + credits - debits == current_balance (in integer poisha)
  const accountIds = new Set([
    ...Object.keys(openingPoishaMap),
    ...Object.keys(runningPoishaBalances),
    ...safeCards.map((c) => c?.id).filter(Boolean),
  ]);
  const cardNameMap = new Map(
    safeCards.filter((c) => c?.id).map((c) => [c.id, c.name || c.id]),
  );
  if (!cardNameMap.has("cash")) {
    cardNameMap.set("cash", "Cash");
  }
  const reconciliationAccounts = {};
  let discrepancyCount = 0;
  let totalOpeningPoisha = 0;
  let totalCreditsPoisha = 0;
  let totalDebitsPoisha = 0;
  let totalExpectedPoisha = 0;
  let totalCurrentPoisha = 0;
  let totalDiscrepancyPoisha = 0;

  for (const acctId of accountIds) {
    if (!acctId || acctId === "date") continue;
    if (acctId === "cash" && cashAccountId !== "cash") continue;
    const openP = openingPoishaMap[acctId] || 0;
    const credP = creditsPoishaByAccount[acctId] || 0;
    const debP = debitsPoishaByAccount[acctId] || 0;
    const expectedP = openP + credP - debP;
    const hasReported =
      reportedBalances &&
      typeof reportedBalances === "object" &&
      Object.hasOwn(reportedBalances, acctId) &&
      Number.isFinite(Number(reportedBalances[acctId]));
    const currentP = hasReported
      ? toPoisha(reportedBalances[acctId])
      : runningPoishaBalances[acctId] || 0;
    const diffP = currentP - expectedP;
    const isBalanced = diffP === 0;
    if (!isBalanced) {
      discrepancyCount += 1;
    }
    totalOpeningPoisha += openP;
    totalCreditsPoisha += credP;
    totalDebitsPoisha += debP;
    totalExpectedPoisha += expectedP;
    totalCurrentPoisha += currentP;
    totalDiscrepancyPoisha += Math.abs(diffP);

    reconciliationAccounts[acctId] = {
      id: acctId,
      name: cardNameMap.get(acctId) || (acctId === "cash" ? "Cash" : acctId),
      type: creditCardIds.has(acctId)
        ? "credit"
        : acctId === cashAccountId || acctId === "cash"
          ? "cash"
          : "asset",
      opening: fromPoisha(openP),
      credits: fromPoisha(credP),
      debits: fromPoisha(debP),
      expectedBalance: fromPoisha(expectedP),
      currentBalance: fromPoisha(currentP),
      discrepancy: fromPoisha(diffP),
      isBalanced,
    };
  }

  const reconciliation = {
    isBalanced: discrepancyCount === 0,
    accountCount: Object.keys(reconciliationAccounts).length,
    discrepancyCount,
    totalOpening: fromPoisha(totalOpeningPoisha),
    totalCredits: fromPoisha(totalCreditsPoisha),
    totalDebits: fromPoisha(totalDebitsPoisha),
    totalExpectedBalance: fromPoisha(totalExpectedPoisha),
    totalCurrentBalance: fromPoisha(totalCurrentPoisha),
    totalDiscrepancy: fromPoisha(totalDiscrepancyPoisha),
    accounts: reconciliationAccounts,
  };

  return {
    openingBalances: openingMap,
    currentBalances: runningBalances,
    creditsByAccount,
    debitsByAccount,
    reconciliation,
    ledgerEvents,
    ledgerById,
    summary: {
      totalExpenses: fromPoisha(totalExpensesPoisha),
      totalIncome: fromPoisha(totalIncomePoisha),
      totalSavingsTransfers: fromPoisha(totalSavingsTransfersPoisha),
      totalAccountTransfers: fromPoisha(totalAccountTransfersPoisha),
      totalAdjustmentsNet: fromPoisha(totalAdjustmentsNetPoisha),
    },
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
  expenses = null,
) {
  if (!saved || typeof saved !== "object") return emptyAccountData();
  if (isPureUnconfiguredDemoState(saved)) return emptyAccountData();

  const settings = saved.settings || {};
  const rawBalances =
    settings.openingBalances &&
    typeof settings.openingBalances === "object" &&
    Object.keys(settings.openingBalances).length > 0
      ? settings.openingBalances
      : settings.balances && typeof settings.balances === "object"
        ? settings.balances
        : {};
  const cleanBalance = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : 0;
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
      const id = card.id.trim().slice(0, 120);
      if (isPhantomAutoReconstructedCard(card)) {
        continue;
      }
      const tombstone = deletedCardTombstones[id];
      const createdAt = parseTimestampMs(card.createdAt);
      const updatedAt = parseTimestampMs(card.updatedAt) || createdAt;

      // Skip tombstoned cards unless card was explicitly updated after deletion
      if (tombstone?.deleted && tombstone.updatedAt >= updatedAt) {
        continue;
      }

      const isMfs = isMfsCard(card);
      const isSavings = isSavingsCard(card);

      const rawNumber = String(card?.number || "").replace(/\D/g, "");
      const rawLast4 = String(
        card?.last4 || (rawNumber ? rawNumber.slice(-4) : ""),
      ).slice(0, 8);

      // Explicitly delete full card number and CVV before saving / loading
      const { cvv: _cvv, number: _number, ...safeCard } = card || {};

      let storedNumber = "";
      if (isSavings) {
        storedNumber =
          String(card?.number || "")
            .trim()
            .slice(0, 32) || (rawLast4 ? `SAV-${rawLast4}` : "");
      } else if (isCashCard(card)) {
        const cashCurr = String(card?.currency || "BDT")
          .trim()
          .toUpperCase()
          .slice(0, 8);
        storedNumber = String(card?.number || "")
          .trim()
          .startsWith("CASH-")
          ? String(card.number).trim().slice(0, 32)
          : `CASH-${cashCurr}`;
      } else if (isMfs && rawNumber.length < 15) {
        storedNumber =
          String(card?.number || "")
            .trim()
            .slice(0, 32) || (rawLast4 ? `01••• •••${rawLast4}` : "");
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
        name: String(card.name || id).slice(0, 80),
        holderName: String(card.holderName || "Cardholder").slice(0, 80),
        subtitle:
          typeof card.subtitle === "string"
            ? (isCashCard(card)
                ? card.subtitle
                : card.subtitle.replace(/\bUSD\b/gi, "BDT")
              ).slice(0, 120)
            : "",
        currency: isCashCard(card)
          ? String(card.currency || "BDT")
              .toUpperCase()
              .slice(0, 8)
          : !card.currency || String(card.currency).toUpperCase() === "USD"
            ? "BDT"
            : String(card.currency).slice(0, 8),
        type: isSavings
          ? "savings"
          : isCashCard(card)
            ? "cash"
            : card.type || "credit",
        network:
          isSavings || isCashCard(card) ? "none" : card.network || "visa",
        ...(isSavings ? { category: "savings" } : {}),
        ...(isCashCard(card) ? { category: "cash" } : {}),
        last4: rawLast4,
        number: storedNumber,
        expiry:
          isSavings || isMfs || isCashCard(card)
            ? ""
            : String(card.expiry || "").slice(0, 16),
        color: String(card.color || "#1e293b").slice(0, 32),
        gradient: String(card.gradient || "").slice(0, 160),
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
  if (
    Object.hasOwn(rawBalances, "cash") &&
    rawBalances.cash !== undefined &&
    rawBalances.cash !== null &&
    Number.isFinite(Number(rawBalances.cash))
  ) {
    initialBalances.cash = cleanBalance(rawBalances.cash);
  }
  for (const card of cards) {
    initialBalances[card.id] = cleanBalance(card.initialBalance);
    if (isCashCard(card)) {
      initialBalances.cash = cleanBalance(card.initialBalance);
    }
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

  const mapAcct = (id) => {
    if (!id || typeof id !== "string") return id;
    const trimmed = id.trim();
    return remappedAccountIds[trimmed] || trimmed;
  };

  const deletedTxTombstones = deletedRecords?.accountTransactions || {};

  const normalizedTransactions = Array.isArray(saved.transactions)
    ? saved.transactions
        .filter((item) => {
          if (!item || typeof item !== "object" || !item.id) return false;
          const tombstone = deletedTxTombstones[item.id];
          return tombstone?.deleted !== true;
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
        .map((item) => {
          const createdAt = parseTimestampMs(item.createdAt) || Date.now();
          const updatedAt = parseTimestampMs(item.updatedAt) || createdAt;
          return {
            ...item,
            id: String(item.id).trim().slice(0, 120),
            ...(item.account || item.accountId
              ? {
                  account: String(item.account || item.accountId)
                    .trim()
                    .slice(0, 120),
                }
              : {}),
            ...(item.fromAccount || item.from_account
              ? {
                  fromAccount: String(item.fromAccount || item.from_account)
                    .trim()
                    .slice(0, 120),
                }
              : {}),
            ...(item.toAccount || item.to_account
              ? {
                  toAccount: String(item.toAccount || item.to_account)
                    .trim()
                    .slice(0, 120),
                }
              : {}),
            type: item.type === "adjust" ? "adjustment" : item.type,
            direction:
              item.direction === "up"
                ? "increase"
                : item.direction === "down"
                  ? "decrease"
                  : item.direction,
            amount: roundMoney(Number(item.amount)),
            description:
              typeof item.description === "string"
                ? item.description.slice(0, 80)
                : typeof item.note === "string"
                  ? item.note.slice(0, 80)
                  : "",
            createdAt,
            updatedAt,
          };
        })
    : [];

  const expensesForBalance = Array.isArray(expenses)
    ? expenses
    : readStorage(STORAGE_KEYS.expenses, []);
  const computedLedger = computeAccountBalances(
    cards,
    initialBalances,
    expensesForBalance,
    normalizedTransactions,
  );

  const syncedCards = cards.map((c) => ({
    ...c,
    isPrimary: Boolean(resolvedPrimaryCardId && c.id === resolvedPrimaryCardId),
    initialBalance: initialBalances[c.id],
    currentBalance:
      computedLedger.currentBalances[c.id] ?? initialBalances[c.id],
  }));

  const enrichedTransactions = normalizedTransactions.map((tx) => {
    const ledgerEntry = computedLedger.ledgerById.get(tx.id);
    if (!ledgerEntry) return tx;
    return {
      ...tx,
      ...(ledgerEntry.balanceBefore !== null
        ? { balanceBefore: ledgerEntry.balanceBefore }
        : {}),
      ...(ledgerEntry.balanceAfter !== null
        ? { balanceAfter: ledgerEntry.balanceAfter }
        : {}),
      ...(ledgerEntry.fromBalanceAfter !== null
        ? { fromBalanceAfter: ledgerEntry.fromBalanceAfter }
        : {}),
      ...(ledgerEntry.toBalanceAfter !== null
        ? { toBalanceAfter: ledgerEntry.toBalanceAfter }
        : {}),
    };
  });

  return {
    settings: {
      startDate: isValidDateString(settings.startDate)
        ? settings.startDate
        : localDate(),
      balances: initialBalances,
      openingBalances: initialBalances,
      currentBalances: computedLedger.currentBalances,
      cards: syncedCards,
      ...(resolvedPrimaryCardId
        ? { primaryCardId: resolvedPrimaryCardId }
        : {}),
      configured: settings.configured === true || syncedCards.length > 0,
      cardsConfigured:
        settings.cardsConfigured === true || syncedCards.length > 0,
      updatedAt: parseTimestampMs(settings.updatedAt),
    },
    ...(Object.keys(remappedAccountIds).length > 0
      ? { remappedAccountIds }
      : {}),
    transactions: enrichedTransactions,
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
  const [year, month, day] = String(dateValue || "")
    .split("-")
    .map(Number);
  if (!year || !month || !day) return localDate();
  if (interval === "weekly") {
    const date = new Date(year, month - 1, day + 7);
    return localDate(date);
  }
  const anchorDay =
    dayOfMonth !== undefined &&
    dayOfMonth !== null &&
    Number.isFinite(Number(dayOfMonth)) &&
    Number(dayOfMonth) >= 1
      ? clampDayOfMonth(dayOfMonth)
      : clampDayOfMonth(day);
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
      Math.min(anchorDay, lastDay),
    ),
  );
}

export function getSavingsAccountId(cards = []) {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  const byCategoryOrType = cards.find((c) => isSavingsCard(c));
  if (byCategoryOrType) return byCategoryOrType.id;
  return "";
}
