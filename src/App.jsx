import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import SpendSplash from "./components/SpendSplash.jsx";
import {
  emptyAccountData,
  STORAGE_KEYS,
  currentMonth,
  formatDate,
  getSavingsAccountId,
  isAccountId,
  isValidDateString,
  loadAccountData,
  loadBudgets,
  loadExpenses,
  loadRecurringSchedules,
  localDate,
  makeId,
  nextOccurrenceDate,
  parseAmount,
  readStorage,
  readStorageAsync,
  roundMoney,
  writeStorage,
  writeStorageAsync,
} from "./data.js";
import {
  disableBackgroundPush,
  enableBackgroundPush,
  getSupabase,
  PUSH_DISABLED_BY_USER_KEY,
  pushBackendConfigured,
  supabase,
  supabaseConfigured,
  syncBackgroundSchedules,
} from "./push.js";
import {
  CLOUD_SYNC_USER_KEY,
  hasPotentialCloudSession,
  loadCloudData,
  saveCloudData,
  subscribeToCloudChanges,
} from "./cloud-sync.js";
import {
  encryptBackup,
  decryptBackup,
  getSessionKey,
  hasAppPin,
  isSessionUnlocked,
} from "./security.js";
import {
  checkAndNotifyNewMonth,
  checkAndNotifyUpcomingBills,
  checkAndNotifyWeeklySummary,
  checkNotificationPermission,
  notifyNewUserSignedIn,
  requestNotificationPermission,
  sendNativeBuiltinNotification,
  setupNativeNotificationChannels,
  setupNotificationListeners,
  syncNativeScheduledNotifications,
} from "./notifications.js";

const loadMobilePrototype = () => import("./MobilePrototype");
const MobilePrototype = lazy(loadMobilePrototype);

function PrototypeMountSignal({ onMounted }) {
  useLayoutEffect(() => {
    onMounted?.();
  }, [onMounted]);
  return null;
}

const LOCAL_DATA_OWNER_KEY = "spend-local-data-owner-v1";
const LOCAL_USER_SNAPSHOTS_KEY = "spend-local-user-snapshots-v1";
const BUDGET_UPDATED_AT_KEY = STORAGE_KEYS.budgetUpdatedAt;
const LAST_BACKUP_AT_KEY = "spend-last-backup-at-v1";

function loadTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    if (saved === "dark" || saved === "light" || saved === "auto") return saved;
    return "auto";
  } catch {
    return "auto";
  }
}

function getSystemDarkPreference() {
  try {
    return (
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)
    );
  } catch {
    return false;
  }
}

function loadCurrency() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.currency);
    return saved && /^[A-Z]{3}$/.test(saved) ? saved : "USD";
  } catch {
    return "USD";
  }
}

function isValidReminderTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function loadReminderTime() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.reminderTime);
    return isValidReminderTime(saved) ? saved : "09:00";
  } catch {
    return "09:00";
  }
}

function loadLocalProfileName() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.profileName);
    return typeof saved === "string" ? capitalizeFirst(saved) : "";
  } catch {
    return "";
  }
}

function isValidAvatarValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    (trimmed.startsWith("data:image/") || trimmed.startsWith("https://")) &&
    trimmed.length < 350000
  );
}

function loadProfileAvatar() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.profileAvatar);
    return isValidAvatarValue(saved) ? saved.trim() : "";
  } catch {
    return "";
  }
}

function loadProfileUpdatedAt() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEYS.profileUpdatedAt));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  } catch {
    return 0;
  }
}

function userAvatarUrl(user) {
  const metadata = user?.user_metadata ?? {};
  const raw = metadata.avatar_url || metadata.picture || "";
  return isValidAvatarValue(raw) ? raw.trim() : "";
}

function capitalizeFirst(value) {
  const characters = Array.from(String(value ?? "").trim());
  if (!characters.length) return "";
  characters[0] = characters[0].toLocaleUpperCase();
  return characters.join("");
}

function accountName(accountId, cards = []) {
  if (!accountId || accountId === "cash") return "Cash";
  const customCard = Array.isArray(cards)
    ? cards.find((c) => c?.id === accountId)
    : null;
  if (customCard?.name) return customCard.name;
  return accountId || "Account";
}

function userDisplayName(user) {
  const metadata = user?.user_metadata ?? {};
  const profileName = [
    metadata.first_name || metadata.given_name,
    metadata.last_name || metadata.family_name,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  const name =
    metadata.full_name || metadata.name || profileName || metadata.username;
  if (typeof name === "string" && name.trim()) return capitalizeFirst(name);
  return capitalizeFirst(user?.email?.split("@")[0] || "Account");
}

function profileInitial(name) {
  return (
    Array.from(
      String(name || "")
        .trim()
        .split(/\s+/)[0] || "A",
    )[0]?.toLocaleUpperCase() || "A"
  );
}

function PasswordVisibilityIcon({ visible }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="auth-password-icon"
    >
      {visible ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.5 0 9.5 7 9.5 7a15 15 0 0 1-3.2 3.8" />
          <path d="M6.2 6.2A15 15 0 0 0 2.5 12s4 7 9.5 7a10.7 10.7 0 0 0 3.5-.6" />
        </>
      ) : (
        <>
          <path d="M2.5 12s4-7 9.5-7 9.5 7 9.5 7-4 7-9.5 7-9.5-7-9.5-7Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
    </svg>
  );
}

function userInitial(user) {
  return profileInitial(userDisplayName(user));
}

function shiftMonth(monthValue, offset) {
  const [year, month] = (monthValue || currentMonth()).split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return localDate(shifted).slice(0, 7);
}

function emptyDeletedRecords() {
  return {
    expenses: {},
    budgets: {},
    recurringSchedules: {},
    accountTransactions: {},
    cards: {},
  };
}

const TOMBSTONE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function normalizeDeletedRecords(value, now = Date.now()) {
  const cutoff = now - TOMBSTONE_MAX_AGE_MS;
  const cleanChanges = (changes) => {
    if (Array.isArray(changes))
      return Object.fromEntries(
        [...new Set(changes.filter((id) => typeof id === "string" && id))].map(
          (id) => [id, { deleted: true, updatedAt: 0 }],
        ),
      );
    if (!changes || typeof changes !== "object") return {};
    return Object.fromEntries(
      Object.entries(changes).flatMap(([id, change]) => {
        if (
          typeof id === "string" &&
          id &&
          change &&
          typeof change === "object" &&
          typeof change.deleted === "boolean"
        ) {
          const updatedAt = Number.isFinite(Number(change.updatedAt))
            ? Number(change.updatedAt)
            : 0;
          if (updatedAt > 0 && updatedAt < cutoff) return [];
          return [
            [
              id,
              {
                deleted: change.deleted,
                updatedAt,
                ...(typeof change.name === "string"
                  ? { name: change.name }
                  : {}),
                ...(typeof change.color === "string"
                  ? { color: change.color }
                  : {}),
              },
            ],
          ];
        }
        return [];
      }),
    );
  };
  return {
    expenses: cleanChanges(value?.expenses),
    budgets: cleanChanges(value?.budgets),
    recurringSchedules: cleanChanges(value?.recurringSchedules),
    accountTransactions: cleanChanges(value?.accountTransactions),
    cards: cleanChanges(value?.cards),
  };
}

function mergeDeletedRecords(...values) {
  const merged = emptyDeletedRecords();
  for (const value of values) {
    const normalized = normalizeDeletedRecords(value);
    for (const key of Object.keys(merged)) {
      for (const [id, change] of Object.entries(normalized[key])) {
        if (!merged[key][id] || change.updatedAt >= merged[key][id].updatedAt)
          merged[key][id] = change;
      }
    }
  }
  return merged;
}

function isRecordDeleted(changes, id) {
  return changes?.[id]?.deleted === true;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\t\r ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function recordUpdatedAt(record) {
  const value = record?.updatedAt ?? record?.updated_at;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function preferLocalRecord(local, cloud, preferLocalOnTie = true) {
  const localUpdatedAt = recordUpdatedAt(local);
  const cloudUpdatedAt = recordUpdatedAt(cloud);
  return (
    localUpdatedAt > cloudUpdatedAt ||
    (localUpdatedAt === cloudUpdatedAt && preferLocalOnTie)
  );
}

function normalizeBudgetUpdatedAt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([month, updatedAt]) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
      const timestamp = recordUpdatedAt({ updatedAt });
      return [[month, timestamp]];
    }),
  );
}

function mergeBudgetValues(
  cloudBudgets,
  localBudgets,
  cloudUpdatedAt,
  localUpdatedAt,
  deletedChanges,
  preferLocalOnTie,
) {
  const budgets = {};
  const updatedAt = {};
  const months = new Set([
    ...Object.keys(cloudBudgets),
    ...Object.keys(localBudgets),
  ]);
  for (const month of months) {
    const hasCloud = Object.hasOwn(cloudBudgets, month);
    const hasLocal = Object.hasOwn(localBudgets, month);
    const cloudTime = cloudUpdatedAt[month] ?? 0;
    const localTime = localUpdatedAt[month] ?? 0;
    const chooseLocal =
      hasLocal &&
      (!hasCloud ||
        localTime > cloudTime ||
        (localTime === cloudTime && preferLocalOnTie));
    if (isRecordDeleted(deletedChanges, month)) continue;
    if (chooseLocal) {
      budgets[month] = localBudgets[month];
      updatedAt[month] = localTime;
    } else if (hasCloud) {
      budgets[month] = cloudBudgets[month];
      updatedAt[month] = cloudTime;
    }
  }
  return { budgets, updatedAt };
}

function mergeRecords(
  cloudRecords,
  localRecords,
  deletedChanges = {},
  preferLocalOnTie = true,
) {
  const records = new Map(cloudRecords.map((record) => [record.id, record]));
  for (const record of localRecords) {
    const cloudRecord = records.get(record.id);
    if (
      !cloudRecord ||
      preferLocalRecord(record, cloudRecord, preferLocalOnTie)
    ) {
      records.set(record.id, record);
    }
  }
  return [...records.values()].filter(
    (record) => !isRecordDeleted(deletedChanges, record.id),
  );
}

function expenseOccurrenceKey(expense) {
  return expense.recurringId
    ? `recurring:${expense.recurringId}:${expense.date}`
    : null;
}

function mergeExpenseRecords(
  cloudExpenses,
  localExpenses,
  deletedChanges,
  preferLocalOnTie = true,
) {
  const localIds = new Set(localExpenses.map((expense) => expense.id));
  const byId = mergeRecords(cloudExpenses, localExpenses, {}, preferLocalOnTie);
  const records = new Map();
  for (const expense of byId) {
    const occurrenceKey = expenseOccurrenceKey(expense);
    if (
      isRecordDeleted(deletedChanges, expense.id) ||
      (occurrenceKey && isRecordDeleted(deletedChanges, occurrenceKey))
    )
      continue;
    const key = occurrenceKey ?? `expense:${expense.id}`;
    const current = records.get(key);
    const isLocal = localIds.has(expense.id);
    if (
      !current ||
      recordUpdatedAt(expense) > recordUpdatedAt(current.expense) ||
      (recordUpdatedAt(expense) === recordUpdatedAt(current.expense) &&
        preferLocalOnTie &&
        isLocal &&
        !current.isLocal)
    ) {
      records.set(key, { expense, isLocal });
    }
  }
  return [...records.values()].map(({ expense }) => expense);
}

function hasMeaningfulLocalData(data) {
  return (
    data.expenses.length > 0 ||
    Object.keys(data.budgets).length > 0 ||
    data.recurringSchedules.length > 0 ||
    data.accountData.transactions.length > 0 ||
    hasMeaningfulAccountSettings(data.accountData.settings) ||
    Object.values(normalizeDeletedRecords(data.deletedRecords)).some(
      (changes) => Object.keys(changes).length > 0,
    ) ||
    (isValidReminderTime(data.reminderTime) && data.reminderTime !== "09:00") ||
    Boolean(typeof data.profileName === "string" && data.profileName.trim()) ||
    isValidAvatarValue(data.profileAvatar)
  );
}

function hasMeaningfulAccountSettings(settings) {
  if (!settings) return false;
  const cards = Array.isArray(settings.cards) ? settings.cards : [];
  const balances = settings.balances || {};
  return (
    settings.configured === true ||
    settings.cardsConfigured === true ||
    cards.length > 0 ||
    Object.values(balances).some((val) => Number(val) !== 0)
  );
}

function areAccountSettingsEqual(left, right) {
  if (!left || !right) return false;
  return (
    left.startDate === right.startDate &&
    Boolean(left.configured) === Boolean(right.configured) &&
    Boolean(left.cardsConfigured) === Boolean(right.cardsConfigured) &&
    JSON.stringify(stableSnapshotValue(left.balances || {})) ===
      JSON.stringify(stableSnapshotValue(right.balances || {})) &&
    JSON.stringify(stableSnapshotValue(left.cards || [])) ===
      JSON.stringify(stableSnapshotValue(right.cards || []))
  );
}

function stableSnapshotValue(value) {
  if (Array.isArray(value)) return value.map(stableSnapshotValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableSnapshotValue(value[key])]),
  );
}

function areCloudSnapshotsEqual(left, right) {
  if (!left || !right) return false;
  return (
    JSON.stringify(stableSnapshotValue(left)) ===
    JSON.stringify(stableSnapshotValue(right))
  );
}

function hasMeaningfulLocalAccountSettings(data) {
  return hasMeaningfulAccountSettings(data.accountData.settings);
}

function mergeAccountSettings(
  localSettings = {},
  cloudSettings = {},
  deletedRecords = {},
  preferLocal = true,
) {
  const localCards = Array.isArray(localSettings.cards)
    ? localSettings.cards
    : [];
  const cloudCards = Array.isArray(cloudSettings.cards)
    ? cloudSettings.cards
    : [];
  const deletedCardTombstones = deletedRecords.cards || {};

  const cardMap = new Map();
  for (const card of cloudCards) {
    if (!card?.id) continue;
    const tombstone = deletedCardTombstones[card.id];
    const cardTime = recordUpdatedAt(card);
    if (tombstone?.deleted && tombstone.updatedAt >= cardTime) continue;
    cardMap.set(card.id, card);
  }
  for (const card of localCards) {
    if (!card?.id) continue;
    const tombstone = deletedCardTombstones[card.id];
    const cardTime = recordUpdatedAt(card);
    if (tombstone?.deleted && tombstone.updatedAt >= cardTime) continue;
    const cloudCard = cardMap.get(card.id);
    if (!cloudCard || preferLocalRecord(card, cloudCard, preferLocal)) {
      cardMap.set(card.id, card);
    }
  }

  const localBalances =
    localSettings.balances && typeof localSettings.balances === "object"
      ? localSettings.balances
      : {};
  const cloudBalances =
    cloudSettings.balances && typeof cloudSettings.balances === "object"
      ? cloudSettings.balances
      : {};

  const mergedBalances = { ...cloudBalances };
  for (const [id, val] of Object.entries(localBalances)) {
    if (deletedCardTombstones[id]?.deleted && !cardMap.has(id)) {
      continue;
    }
    if (mergedBalances[id] === undefined) {
      mergedBalances[id] = val;
    } else {
      const localCard = (localSettings.cards || []).find((c) => c?.id === id);
      const cloudCard = (cloudSettings.cards || []).find((c) => c?.id === id);
      if (localCard && cloudCard) {
        if (preferLocalRecord(localCard, cloudCard, preferLocal)) {
          mergedBalances[id] = val;
        }
      } else {
        const localTime = recordUpdatedAt(localSettings);
        const cloudTime = recordUpdatedAt(cloudSettings);
        if (
          (preferLocal &&
            (localTime >= cloudTime || mergedBalances[id] === 0)) ||
          localTime > cloudTime
        ) {
          mergedBalances[id] = val;
        }
      }
    }
  }

  for (const [id, tombstone] of Object.entries(deletedCardTombstones)) {
    if (tombstone?.deleted && !cardMap.has(id)) {
      delete mergedBalances[id];
    }
  }

  for (const card of cardMap.values()) {
    if (mergedBalances[card.id] === undefined) {
      mergedBalances[card.id] = card.initialBalance ?? 0;
    }
  }

  const localTime = recordUpdatedAt(localSettings);
  const cloudTime = recordUpdatedAt(cloudSettings);
  const preferLocalCards =
    preferLocal ||
    localTime > cloudTime ||
    (localTime === cloudTime && preferLocal);
  const primaryCards = preferLocalCards ? localCards : cloudCards;
  const secondaryCards = preferLocalCards ? cloudCards : localCards;

  const orderedCardIds = [];
  const seenIds = new Set();
  for (const card of primaryCards) {
    if (card?.id && cardMap.has(card.id) && !seenIds.has(card.id)) {
      orderedCardIds.push(card.id);
      seenIds.add(card.id);
    }
  }
  for (const card of secondaryCards) {
    if (card?.id && cardMap.has(card.id) && !seenIds.has(card.id)) {
      orderedCardIds.push(card.id);
      seenIds.add(card.id);
    }
  }
  for (const id of cardMap.keys()) {
    if (!seenIds.has(id)) {
      orderedCardIds.push(id);
      seenIds.add(id);
    }
  }
  const mergedCards = orderedCardIds.map((id) => cardMap.get(id));

  return {
    startDate:
      localSettings.startDate && cloudSettings.startDate
        ? localSettings.startDate < cloudSettings.startDate
          ? localSettings.startDate
          : cloudSettings.startDate
        : localSettings.startDate || cloudSettings.startDate || localDate(),
    balances: mergedBalances,
    cards: mergedCards,
    configured: Boolean(localSettings.configured || cloudSettings.configured),
    cardsConfigured: Boolean(
      localSettings.cardsConfigured ||
      cloudSettings.cardsConfigured ||
      mergedCards.length > 0,
    ),
    updatedAt: Math.max(localTime, cloudTime),
  };
}

function mergeProfileFields(local = {}, cloud = {}, preferLocal = true) {
  const localTime = Number(local?.profileUpdatedAt) || 0;
  const cloudTime = Number(cloud?.profileUpdatedAt) || 0;
  const localHasAvatar = isValidAvatarValue(local?.profileAvatar);
  const cloudHasAvatar = isValidAvatarValue(cloud?.profileAvatar);
  const localHasName =
    typeof local?.profileName === "string" && Boolean(local.profileName.trim());
  const cloudHasName =
    typeof cloud?.profileName === "string" && Boolean(cloud.profileName.trim());

  const chooseLocal =
    localTime !== cloudTime ? localTime > cloudTime : Boolean(preferLocal);

  const profileName = chooseLocal
    ? localHasName
      ? capitalizeFirst(local.profileName)
      : cloudHasName
        ? capitalizeFirst(cloud.profileName)
        : ""
    : cloudHasName
      ? capitalizeFirst(cloud.profileName)
      : localHasName
        ? capitalizeFirst(local.profileName)
        : "";

  let profileAvatar = "";
  if (localTime !== cloudTime) {
    if (chooseLocal) {
      profileAvatar = localHasAvatar
        ? local.profileAvatar.trim()
        : local?.profileAvatar === ""
          ? ""
          : cloudHasAvatar
            ? cloud.profileAvatar.trim()
            : "";
    } else {
      profileAvatar = cloudHasAvatar
        ? cloud.profileAvatar.trim()
        : cloud?.profileAvatar === ""
          ? ""
          : localHasAvatar
            ? local.profileAvatar.trim()
            : "";
    }
  } else if (localTime > 0) {
    profileAvatar = chooseLocal
      ? localHasAvatar
        ? local.profileAvatar.trim()
        : ""
      : cloudHasAvatar
        ? cloud.profileAvatar.trim()
        : "";
  } else {
    profileAvatar = chooseLocal
      ? localHasAvatar
        ? local.profileAvatar.trim()
        : cloudHasAvatar
          ? cloud.profileAvatar.trim()
          : ""
      : cloudHasAvatar
        ? cloud.profileAvatar.trim()
        : localHasAvatar
          ? local.profileAvatar.trim()
          : "";
  }

  return {
    profileName,
    profileAvatar,
    profileUpdatedAt: Math.max(localTime, cloudTime),
  };
}

function mergeCloudSnapshots(
  local,
  cloud,
  preferLocal,
  preferLocalAccountSettings = preferLocal,
) {
  if (!cloud) return local;

  const deletedRecords = mergeDeletedRecords(
    cloud.deletedRecords,
    local.deletedRecords,
  );
  const cloudAccounts = loadAccountData(
    cloud.accountData ?? emptyAccountData(),
    deletedRecords,
  );
  const cloudExpenses = loadExpenses(cloud.expenses ?? [], cloudAccounts);
  const cloudBudgets = loadBudgets(cloud.budgets ?? {});
  const cloudSchedules = loadRecurringSchedules(
    cloud.recurringSchedules ?? [],
    cloudAccounts,
  );
  const budgetData = mergeBudgetValues(
    cloudBudgets,
    local.budgets,
    normalizeBudgetUpdatedAt(cloud.budgetUpdatedAt),
    normalizeBudgetUpdatedAt(local.budgetUpdatedAt),
    deletedRecords.budgets,
    Boolean(preferLocal),
  );
  const mergedProfile = mergeProfileFields(local, cloud, preferLocal);
  if (!preferLocal) {
    return {
      expenses: mergeExpenseRecords(
        cloudExpenses,
        local.expenses,
        deletedRecords.expenses,
        false,
      ),
      budgets: budgetData.budgets,
      budgetUpdatedAt: budgetData.updatedAt,
      recurringSchedules: mergeRecords(
        cloudSchedules,
        local.recurringSchedules,
        deletedRecords.recurringSchedules,
        false,
      ),
      accountData: {
        settings: mergeAccountSettings(
          local.accountData.settings,
          cloudAccounts.settings,
          deletedRecords,
          false,
        ),
        transactions: mergeRecords(
          cloudAccounts.transactions,
          local.accountData.transactions,
          deletedRecords.accountTransactions,
          false,
        ),
      },
      deletedRecords,
      theme:
        cloud.theme === "dark" ||
        cloud.theme === "light" ||
        cloud.theme === "auto"
          ? cloud.theme
          : local.theme,
      targetCurrency:
        typeof cloud.targetCurrency === "string" &&
        /^[A-Z]{3}$/.test(cloud.targetCurrency)
          ? cloud.targetCurrency
          : "USD",
      reminderTime: isValidReminderTime(cloud.reminderTime)
        ? cloud.reminderTime
        : isValidReminderTime(local.reminderTime)
          ? local.reminderTime
          : "09:00",
      ...mergedProfile,
    };
  }

  return {
    expenses: mergeExpenseRecords(
      cloudExpenses,
      local.expenses,
      deletedRecords.expenses,
      true,
    ),
    budgets: budgetData.budgets,
    budgetUpdatedAt: budgetData.updatedAt,
    recurringSchedules: mergeRecords(
      cloudSchedules,
      local.recurringSchedules,
      deletedRecords.recurringSchedules,
      true,
    ),
    accountData: {
      settings: mergeAccountSettings(
        local.accountData.settings,
        cloudAccounts.settings,
        deletedRecords,
        preferLocalAccountSettings,
      ),
      transactions: mergeRecords(
        cloudAccounts.transactions,
        local.accountData.transactions,
        deletedRecords.accountTransactions,
        true,
      ),
    },
    deletedRecords,
    theme: local.theme,
    targetCurrency: local.targetCurrency,
    reminderTime: isValidReminderTime(local.reminderTime)
      ? local.reminderTime
      : isValidReminderTime(cloud.reminderTime)
        ? cloud.reminderTime
        : "09:00",
    ...mergedProfile,
  };
}

function loadBudgetUpdatedAt() {
  try {
    return normalizeBudgetUpdatedAt(readStorage(BUDGET_UPDATED_AT_KEY, {}));
  } catch {
    return {};
  }
}

function loadLocalDataOwner() {
  try {
    return localStorage.getItem(LOCAL_DATA_OWNER_KEY);
  } catch {
    return null;
  }
}

function saveLocalDataOwner(userId) {
  try {
    localStorage.setItem(LOCAL_DATA_OWNER_KEY, userId);
  } catch {
    // In-memory ownership still protects this session when storage is unavailable.
  }
}

function clearLocalDataOwner() {
  try {
    localStorage.removeItem(LOCAL_DATA_OWNER_KEY);
  } catch {
    // The in-memory owner is still cleared for this visit.
  }
}

let localUserSnapshotsCache = null;

function clearSharedFinancialData({ clearUserSnapshots = false } = {}) {
  const keys = [
    STORAGE_KEYS.expenses,
    STORAGE_KEYS.budgets,
    BUDGET_UPDATED_AT_KEY,
    STORAGE_KEYS.recurring,
    STORAGE_KEYS.accounts,
    STORAGE_KEYS.deletedRecords,
    STORAGE_KEYS.profileName,
    STORAGE_KEYS.profileAvatar,
    STORAGE_KEYS.profileUpdatedAt,
  ];
  if (clearUserSnapshots) {
    keys.push(LOCAL_USER_SNAPSHOTS_KEY);
    localUserSnapshotsCache = null;
  }
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // The app state is still cleared for this visit.
    }
  }
}

function readLocalUserSnapshots() {
  if (localUserSnapshotsCache && typeof localUserSnapshotsCache === "object") {
    return localUserSnapshotsCache;
  }
  try {
    const saved = readStorage(LOCAL_USER_SNAPSHOTS_KEY, {});
    const parsed =
      saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    if (Object.keys(parsed).length > 0) {
      localUserSnapshotsCache = parsed;
    }
    return parsed;
  } catch {
    return {};
  }
}

function loadLocalUserSnapshot(userId) {
  const snapshot = readLocalUserSnapshots()[userId];
  if (!snapshot || typeof snapshot !== "object") return null;
  const deletedRecords = normalizeDeletedRecords(snapshot.deletedRecords);
  const loadedAccounts = loadAccountData(
    snapshot.accountData ?? emptyAccountData(),
    deletedRecords,
  );
  return {
    expenses: loadExpenses(snapshot.expenses ?? [], loadedAccounts),
    budgets: loadBudgets(snapshot.budgets ?? {}),
    budgetUpdatedAt: normalizeBudgetUpdatedAt(snapshot.budgetUpdatedAt),
    recurringSchedules: loadRecurringSchedules(
      snapshot.recurringSchedules ?? [],
      loadedAccounts,
    ),
    accountData: loadedAccounts,
    deletedRecords,
    theme:
      snapshot.theme === "dark" ||
      snapshot.theme === "light" ||
      snapshot.theme === "auto"
        ? snapshot.theme
        : "auto",
    targetCurrency:
      typeof snapshot.targetCurrency === "string" &&
      /^[A-Z]{3}$/.test(snapshot.targetCurrency)
        ? snapshot.targetCurrency
        : "USD",
    reminderTime: isValidReminderTime(snapshot.reminderTime)
      ? snapshot.reminderTime
      : "09:00",
    profileName:
      typeof snapshot.profileName === "string"
        ? capitalizeFirst(snapshot.profileName)
        : "",
    profileAvatar: isValidAvatarValue(snapshot.profileAvatar)
      ? snapshot.profileAvatar.trim()
      : "",
    profileUpdatedAt: Number(snapshot.profileUpdatedAt) || 0,
  };
}

function saveLocalUserSnapshot(userId, snapshot) {
  try {
    const snapshots = { ...readLocalUserSnapshots(), [userId]: snapshot };
    localUserSnapshotsCache = snapshots;
    writeStorage(LOCAL_USER_SNAPSHOTS_KEY, snapshots);
  } catch {
    // Shared local storage remains as a compatibility fallback.
  }
}

function usePopupPresence() {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const openRef = useRef(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef(null);

  const open = useCallback(() => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    openRef.current = true;
    closingRef.current = false;
    setIsClosing(false);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    if (!openRef.current || closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const duration = prefersReducedMotion ? 160 : 240;
    closeTimerRef.current = window.setTimeout(() => {
      openRef.current = false;
      closingRef.current = false;
      closeTimerRef.current = null;
      setIsOpen(false);
      setIsClosing(false);
    }, duration);
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  return { isOpen, isClosing, open, close };
}

export default function App() {
  const [isHydrated, setIsHydrated] = useState(!hasAppPin());
  const isHydratedRef = useRef(!hasAppPin());
  const [ready, setReady] = useState(false);
  const [prototypeMounted, setPrototypeMounted] = useState(false);
  const handlePrototypeMounted = useCallback(() => {
    setPrototypeMounted(true);
  }, []);
  useEffect(() => {
    void loadMobilePrototype();
    void import("./AccountsCardDeck.jsx");
    void import("./cardAssets.jsx");
  }, []);
  const [expenses, setExpenses] = useState(loadExpenses);
  const [budgets, setBudgets] = useState(loadBudgets);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState(loadBudgetUpdatedAt);
  const [recurringSchedules, setRecurringSchedules] = useState(
    loadRecurringSchedules,
  );
  const [deletedRecords, setDeletedRecords] = useState(() => {
    const saved = readStorage(STORAGE_KEYS.deletedRecords, null);
    if (saved) return normalizeDeletedRecords(saved);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return normalizeDeletedRecords(snapshot?.deletedRecords);
  });
  const [accountData, setAccountData] = useState(() => {
    const savedDeleted = readStorage(STORAGE_KEYS.deletedRecords, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    const effectiveDeleted = normalizeDeletedRecords(
      savedDeleted || snapshot?.deletedRecords,
    );
    return loadAccountData(undefined, effectiveDeleted);
  });
  const [theme, setTheme] = useState(loadTheme);
  const [systemDark, setSystemDark] = useState(getSystemDarkPreference);
  const resolvedTheme =
    theme === "auto"
      ? systemDark
        ? "dark"
        : "light"
      : theme === "dark"
        ? "dark"
        : "light";
  const [targetCurrency, setTargetCurrency] = useState(loadCurrency);
  const [reminderTime, setReminderTime] = useState(loadReminderTime);
  const [localProfileName, setLocalProfileName] =
    useState(loadLocalProfileName);
  const [profileAvatar, setProfileAvatar] = useState(loadProfileAvatar);
  const [profileUpdatedAt, setProfileUpdatedAt] =
    useState(loadProfileUpdatedAt);
  const {
    isOpen: profileEditorOpen,
    isClosing: profileEditorClosing,
    open: showProfileEditor,
    close: hideProfileEditor,
  } = usePopupPresence();
  const [profileDraft, setProfileDraft] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported",
  );
  const [notificationStatus, setNotificationStatus] = useState("");
  const [pushUser, setPushUser] = useState(null);
  const [authMode, setAuthMode] = useState("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const {
    isOpen: authModalOpen,
    isClosing: authModalClosing,
    open: showAuthModal,
    close: hideAuthModal,
  } = usePopupPresence();
  const [backgroundPushEnabled, setBackgroundPushEnabled] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("");
  const [cloudRealtimeStatus, setCloudRealtimeStatus] =
    useState("disconnected");
  const [cloudSyncActivity, setCloudSyncActivity] = useState("idle");
  const [normalizedAccountSync, setNormalizedAccountSync] = useState(false);
  const [cloudSyncRetry, setCloudSyncRetry] = useState(0);
  const [backupStatus, setBackupStatus] = useState("");
  const authModalRef = useRef(null);
  const authTriggerRef = useRef(null);
  const authReturnFocusRef = useRef(null);
  const profileEditorTriggerRef = useRef(null);
  const backupFileInputRef = useRef(null);
  const pendingDueRef = useRef([]);
  const lastRecurringCheckRef = useRef("");
  const pushScheduleSyncRef = useRef(Promise.resolve());
  const cloudSnapshotRef = useRef(null);
  const cloudVersionRef = useRef(null);
  const cloudAccountSettingsRef = useRef(null);
  const lastSyncedSnapshotRef = useRef(null);
  const cloudSaveQueueRef = useRef(Promise.resolve());
  const liveChangeTimerRef = useRef(null);
  const authUserIdRef = useRef(null);
  const localDataOwnerRef = useRef(loadLocalDataOwner());
  cloudSnapshotRef.current = useMemo(
    () => ({
      expenses,
      budgets,
      budgetUpdatedAt,
      recurringSchedules,
      accountData,
      deletedRecords,
      theme,
      targetCurrency,
      reminderTime,
      profileName: localProfileName,
      profileAvatar,
      profileUpdatedAt,
    }),
    [
      expenses,
      budgets,
      budgetUpdatedAt,
      recurringSchedules,
      accountData,
      deletedRecords,
      theme,
      targetCurrency,
      reminderTime,
      localProfileName,
      profileAvatar,
      profileUpdatedAt,
    ],
  );

  function resetDataForNewUser() {
    const empty = emptyAccountData();
    setExpenses([]);
    setBudgets({});
    setBudgetUpdatedAt({});
    setRecurringSchedules([]);
    setAccountData(empty);
    setDeletedRecords(emptyDeletedRecords());
    setTheme("auto");
    setTargetCurrency("USD");
    setReminderTime("09:00");
    setLocalProfileName("");
    setProfileAvatar("");
    setProfileUpdatedAt(0);
    setCloudSyncStatus("");
  }

  function adoptLocalDataForUser(userId) {
    localDataOwnerRef.current = userId;
    saveLocalDataOwner(userId);
  }

  function switchLocalUser(userId) {
    const previousUserId = localDataOwnerRef.current;
    if (previousUserId && previousUserId !== userId) {
      saveLocalUserSnapshot(previousUserId, cloudSnapshotRef.current);
    }
    const snapshot = loadLocalUserSnapshot(userId);
    adoptLocalDataForUser(userId);
    if (snapshot) {
      if (hasMeaningfulLocalData(cloudSnapshotRef.current)) {
        const merged = mergeCloudSnapshots(
          cloudSnapshotRef.current,
          snapshot,
          true,
        );
        applyCloudSnapshot(merged);
      } else {
        applyCloudSnapshot(snapshot);
      }
    } else if (!hasMeaningfulLocalData(cloudSnapshotRef.current)) {
      resetDataForNewUser();
    }
  }

  function selectLocalDataForUser(userId) {
    if (hasAppPin() && !getSessionKey()) {
      return;
    }
    const hasSavedSnapshot = Boolean(loadLocalUserSnapshot(userId));
    if (localDataOwnerRef.current || hasSavedSnapshot) {
      switchLocalUser(userId);
    } else {
      adoptLocalDataForUser(userId);
    }
  }

  function queueCloudSnapshotSave(userId, { forceOverwrite = false } = {}) {
    const saveTask = cloudSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (
          authUserIdRef.current !== userId ||
          localDataOwnerRef.current !== userId
        ) {
          return;
        }

        let snapshot = cloudSnapshotRef.current;
        if (
          !forceOverwrite &&
          lastSyncedSnapshotRef.current &&
          areCloudSnapshotsEqual(snapshot, lastSyncedSnapshotRef.current)
        ) {
          setCloudSyncActivity("synced");
          return;
        }
        setCloudSyncActivity("syncing");
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let savedVersion = null;
          try {
            const expectedVersion = forceOverwrite
              ? null
              : cloudVersionRef.current;
            savedVersion = await saveCloudData(
              userId,
              snapshot,
              expectedVersion,
            );
          } catch (error) {
            if (error.code !== "23505") throw error;
          }

          if (savedVersion) {
            if (
              authUserIdRef.current === userId &&
              localDataOwnerRef.current === userId
            ) {
              cloudVersionRef.current = savedVersion;
              cloudAccountSettingsRef.current = snapshot.accountData.settings;
              lastSyncedSnapshotRef.current = snapshot;
              setCloudSyncActivity("synced");
              setCloudSyncStatus(
                "Cloud sync is on. Your data is saved to Supabase.",
              );
            }
            return;
          }

          const remote = await loadCloudData(userId);
          if (
            authUserIdRef.current !== userId ||
            localDataOwnerRef.current !== userId
          ) {
            return;
          }
          if (forceOverwrite) {
            cloudVersionRef.current = remote?.updated_at ?? null;
            continue;
          }
          snapshot = cloudSnapshotRef.current;
          if (remote?.data) {
            const remoteSnapshot = mergeCloudSnapshots(
              snapshot,
              remote.data,
              false,
            );
            const localAccountSettingsChanged = !areAccountSettingsEqual(
              snapshot.accountData.settings,
              cloudAccountSettingsRef.current,
            );
            snapshot = mergeCloudSnapshots(
              snapshot,
              remote.data,
              true,
              localAccountSettingsChanged,
            );
            lastSyncedSnapshotRef.current = remoteSnapshot;
            cloudAccountSettingsRef.current =
              remoteSnapshot.accountData.settings;
            applyCloudSnapshot(snapshot);
          }
          cloudVersionRef.current = remote?.updated_at ?? null;
        }

        throw new Error("Cloud data changed repeatedly; please try again.");
      })
      .catch((error) => {
        if (authUserIdRef.current === userId) {
          setCloudSyncActivity(navigator.onLine ? "error" : "offline");
        }
        throw error;
      });
    cloudSaveQueueRef.current = saveTask;
    return saveTask;
  }

  function queueCloudSnapshotRefresh(userId, source = "live") {
    const refreshTask = cloudSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (
          authUserIdRef.current !== userId ||
          localDataOwnerRef.current !== userId
        ) {
          return null;
        }

        const remote = await loadCloudData(userId);
        if (!remote?.data) return null;

        const isSameVersion =
          cloudVersionRef.current &&
          (remote.updated_at === cloudVersionRef.current ||
            Math.abs(
              (Date.parse(remote.updated_at) || 0) -
                (Date.parse(cloudVersionRef.current) || 0),
            ) < 1000);

        if (
          source === "live" &&
          lastSyncedSnapshotRef.current &&
          (areCloudSnapshotsEqual(remote.data, lastSyncedSnapshotRef.current) ||
            isSameVersion)
        ) {
          if (remote.updated_at) cloudVersionRef.current = remote.updated_at;
          setCloudSyncActivity("synced");
          return lastSyncedSnapshotRef.current;
        }

        const local = cloudSnapshotRef.current;
        const previousCloud = lastSyncedSnapshotRef.current;
        const hasPendingChanges =
          previousCloud && !areCloudSnapshotsEqual(local, previousCloud);
        const accountSettingsChanged =
          previousCloud &&
          !areAccountSettingsEqual(
            local.accountData.settings,
            previousCloud.accountData.settings,
          );
        const remoteSnapshot = mergeCloudSnapshots(local, remote.data, false);
        const refreshed = mergeCloudSnapshots(
          local,
          remote.data,
          Boolean(hasPendingChanges),
          Boolean(accountSettingsChanged),
        );

        setNormalizedAccountSync(remote.normalizedAccountSync !== false);
        cloudVersionRef.current = remote.updated_at ?? cloudVersionRef.current;
        cloudAccountSettingsRef.current = remoteSnapshot.accountData.settings;
        lastSyncedSnapshotRef.current = remoteSnapshot;
        setCloudSyncStatus(
          source === "live"
            ? "Cloud data updated live."
            : "Cloud data refreshed from Supabase.",
        );
        if (!areCloudSnapshotsEqual(local, refreshed)) {
          applyCloudSnapshot(refreshed);
        }
        setCloudSyncActivity(
          areCloudSnapshotsEqual(refreshed, remoteSnapshot)
            ? "synced"
            : "syncing",
        );
        return refreshed;
      });

    cloudSaveQueueRef.current = refreshTask;
    return refreshTask;
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => setSystemDark(Boolean(e.matches));
    setSystemDark(Boolean(mq.matches));
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    }
    if (typeof mq.addListener === "function") {
      mq.addListener(handleChange);
      return () => mq.removeListener(handleChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = theme;
    if (ready) {
      const browserChromeColor =
        resolvedTheme === "dark" ? "#08080c" : "#f4f3ee";
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute("content", browserChromeColor));
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Keep the selected theme for this visit when storage is unavailable.
    }
  }, [theme, resolvedTheme, ready]);

  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(STORAGE_KEYS.expenses, expenses);
  }, [expenses]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(STORAGE_KEYS.budgets, budgets);
  }, [budgets]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(BUDGET_UPDATED_AT_KEY, budgetUpdatedAt);
  }, [budgetUpdatedAt]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(STORAGE_KEYS.recurring, recurringSchedules);
  }, [recurringSchedules]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(STORAGE_KEYS.accounts, accountData);
  }, [accountData]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    writeStorage(STORAGE_KEYS.deletedRecords, deletedRecords);
  }, [deletedRecords]);
  useEffect(() => {
    if (!isHydratedRef.current) return;
    const owner = localDataOwnerRef.current;
    if (!owner || owner !== pushUser?.id) return;
    saveLocalUserSnapshot(owner, cloudSnapshotRef.current);
  }, [
    expenses,
    budgets,
    budgetUpdatedAt,
    recurringSchedules,
    accountData,
    deletedRecords,
    theme,
    targetCurrency,
    reminderTime,
    localProfileName,
    profileAvatar,
    profileUpdatedAt,
    pushUser?.id,
  ]);

  const handleResetForgottenPin = useCallback(() => {
    clearSharedFinancialData({ clearUserSnapshots: true });
    localDataOwnerRef.current = null;
    clearLocalDataOwner();
    resetDataForNewUser();
    isHydratedRef.current = true;
    setIsHydrated(true);
  }, []);

  const handleAppUnlock = useCallback(async () => {
    const sessionKey = getSessionKey();
    if (!sessionKey && hasAppPin()) return;

    try {
      const [
        decryptedExpenses,
        decryptedBudgets,
        decryptedBudgetUpdatedAt,
        decryptedRecurring,
        decryptedAccounts,
        decryptedDeleted,
        decryptedSnapshots,
      ] = await Promise.all([
        readStorageAsync(STORAGE_KEYS.expenses, [], sessionKey),
        readStorageAsync(STORAGE_KEYS.budgets, {}, sessionKey),
        readStorageAsync(BUDGET_UPDATED_AT_KEY, {}, sessionKey),
        readStorageAsync(STORAGE_KEYS.recurring, [], sessionKey),
        readStorageAsync(STORAGE_KEYS.accounts, null, sessionKey),
        readStorageAsync(STORAGE_KEYS.deletedRecords, null, sessionKey),
        readStorageAsync(LOCAL_USER_SNAPSHOTS_KEY, {}, sessionKey),
      ]);

      if (
        decryptedSnapshots &&
        typeof decryptedSnapshots === "object" &&
        !Array.isArray(decryptedSnapshots)
      ) {
        localUserSnapshotsCache = decryptedSnapshots;
      }

      const effectiveDeleted = normalizeDeletedRecords(decryptedDeleted);
      const loadedAccounts = loadAccountData(
        decryptedAccounts ?? emptyAccountData(),
        effectiveDeleted,
      );

      setDeletedRecords(effectiveDeleted);
      setAccountData(loadedAccounts);
      setExpenses(loadExpenses(decryptedExpenses, loadedAccounts));
      setBudgets(loadBudgets(decryptedBudgets));
      setBudgetUpdatedAt(normalizeBudgetUpdatedAt(decryptedBudgetUpdatedAt));
      setRecurringSchedules(
        loadRecurringSchedules(decryptedRecurring, loadedAccounts),
      );

      isHydratedRef.current = true;
      setIsHydrated(true);

      // If any record in localStorage was still plaintext from an older version, encrypt it now
      if (sessionKey) {
        const isEncryptedAtRest = (key) => {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) return true;
            const parsed = JSON.parse(raw);
            return Boolean(parsed?.format === "spend-encrypted-v1");
          } catch {
            return false;
          }
        };

        const migrateTasks = [];
        if (!isEncryptedAtRest(STORAGE_KEYS.expenses)) {
          migrateTasks.push(
            writeStorageAsync(
              STORAGE_KEYS.expenses,
              decryptedExpenses,
              sessionKey,
            ),
          );
        }
        if (!isEncryptedAtRest(STORAGE_KEYS.budgets)) {
          migrateTasks.push(
            writeStorageAsync(
              STORAGE_KEYS.budgets,
              decryptedBudgets,
              sessionKey,
            ),
          );
        }
        if (!isEncryptedAtRest(BUDGET_UPDATED_AT_KEY)) {
          migrateTasks.push(
            writeStorageAsync(
              BUDGET_UPDATED_AT_KEY,
              decryptedBudgetUpdatedAt,
              sessionKey,
            ),
          );
        }
        if (!isEncryptedAtRest(STORAGE_KEYS.recurring)) {
          migrateTasks.push(
            writeStorageAsync(
              STORAGE_KEYS.recurring,
              decryptedRecurring,
              sessionKey,
            ),
          );
        }
        if (!isEncryptedAtRest(STORAGE_KEYS.accounts)) {
          migrateTasks.push(
            writeStorageAsync(
              STORAGE_KEYS.accounts,
              loadedAccounts,
              sessionKey,
            ),
          );
        }
        if (!isEncryptedAtRest(STORAGE_KEYS.deletedRecords)) {
          migrateTasks.push(
            writeStorageAsync(
              STORAGE_KEYS.deletedRecords,
              effectiveDeleted,
              sessionKey,
            ),
          );
        }
        if (
          !isEncryptedAtRest(LOCAL_USER_SNAPSHOTS_KEY) &&
          decryptedSnapshots &&
          typeof decryptedSnapshots === "object"
        ) {
          migrateTasks.push(
            writeStorageAsync(
              LOCAL_USER_SNAPSHOTS_KEY,
              decryptedSnapshots,
              sessionKey,
            ),
          );
        }
        if (migrateTasks.length > 0) {
          await Promise.all(migrateTasks);
        }
      }

      if (pushUser && localDataOwnerRef.current !== pushUser.id) {
        selectLocalDataForUser(pushUser.id);
      }
    } catch (err) {
      console.error("Failed to decrypt and hydrate app data on unlock:", err);
    }
  }, [pushUser]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.currency, targetCurrency);
    } catch {
      // The currency selection still applies until this page is closed.
    }
  }, [targetCurrency]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.reminderTime, reminderTime);
    } catch {
      // Keep the selected reminder time for this visit.
    }
  }, [reminderTime]);

  useEffect(() => {
    setupNativeNotificationChannels();
    checkNotificationPermission().then((perm) => {
      setNotificationPermission(perm);
    });
    const cleanup = setupNotificationListeners((tab) => {
      if (tab && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("spend:navigate-tab", { detail: { tab } }),
        );
      }
    });
    return cleanup;
  }, []);

  const supabaseAuthInitRef = useRef(false);
  const authSubscriptionRef = useRef(null);

  const initSupabaseAuth = useCallback(() => {
    if (!supabaseConfigured || supabaseAuthInitRef.current) return;
    supabaseAuthInitRef.current = true;
    getSupabase().then((client) => {
      if (!client) {
        supabaseAuthInitRef.current = false;
        return;
      }
      client.auth.getSession().then(({ data, error }) => {
        if (error) {
          setAuthStatus(`Could not restore sign-in: ${error.message}`);
          return;
        }
        const user = data.session?.user || null;
        if (user) {
          notifyNewUserSignedIn(user);
        }
        if (user && localDataOwnerRef.current !== user.id) {
          selectLocalDataForUser(user.id);
        }
        authUserIdRef.current = user?.id ?? null;
        setPushUser(user);
        if (window.location.hash.includes("type=recovery")) {
          setAuthMode("update-password");
          showAuthDialog();
        }
        setCloudSyncReady(false);
        setCloudRealtimeStatus(user ? "connecting" : "disconnected");
        setCloudSyncActivity(user ? "syncing" : "idle");
        setNormalizedAccountSync(false);
        lastSyncedSnapshotRef.current = null;
        setCloudSyncEnabled(Boolean(user));
      });
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        const user = session?.user || null;
        const previousUserId =
          authUserIdRef.current || localDataOwnerRef.current;
        setPushUser(user);
        if (user && event === "SIGNED_IN") {
          notifyNewUserSignedIn(user);
        }
        if (event === "PASSWORD_RECOVERY") {
          setAuthMode("update-password");
          setAuthStatus("");
          showAuthDialog();
        }
        if (
          authUserIdRef.current === user?.id &&
          (user || !localDataOwnerRef.current)
        ) {
          return;
        }
        if (user && localDataOwnerRef.current !== user.id) {
          selectLocalDataForUser(user.id);
        }
        if (!user && previousUserId) {
          saveLocalUserSnapshot(previousUserId, cloudSnapshotRef.current);
          clearSharedFinancialData();
          localDataOwnerRef.current = null;
          clearLocalDataOwner();
          resetDataForNewUser();
        }
        authUserIdRef.current = user?.id ?? null;
        setBackgroundPushEnabled(false);
        setCloudSyncReady(false);
        cloudVersionRef.current = null;
        cloudAccountSettingsRef.current = null;
        lastSyncedSnapshotRef.current = null;
        setCloudRealtimeStatus(user ? "connecting" : "disconnected");
        setCloudSyncActivity(user ? "syncing" : "idle");
        setNormalizedAccountSync(false);
        setCloudSyncEnabled(Boolean(user));
        setAuthStatus("");
        if (!user) {
          try {
            localStorage.removeItem(CLOUD_SYNC_USER_KEY);
          } catch {
            setCloudSyncStatus(
              "Cloud sync is off, but this browser could not clear its sync preference.",
            );
          }
        }
      });
      authSubscriptionRef.current = subscription;
    });
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    if (!hasPotentialCloudSession() && !localDataOwnerRef.current) {
      return undefined;
    }
    const startAuth = () => initSupabaseAuth();
    let idleId;
    let timerId;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(startAuth, { timeout: 1500 });
    } else {
      timerId = window.setTimeout(startAuth, 350);
    }
    return () => {
      if (
        idleId &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId) window.clearTimeout(timerId);
      authSubscriptionRef.current?.unsubscribe();
      authSubscriptionRef.current = null;
      supabaseAuthInitRef.current = false;
    };
  }, [initSupabaseAuth]);

  useEffect(() => {
    if (!supabase || !pushUser || !cloudSyncEnabled || !isHydrated) {
      setCloudSyncReady(false);
      return undefined;
    }
    let active = true;

    async function initializeCloudSync() {
      setCloudSyncStatus("Preparing your cloud data…");
      setCloudSyncActivity("syncing");
      try {
        let remote = await loadCloudData(pushUser.id);
        setNormalizedAccountSync(remote?.normalizedAccountSync !== false);
        let merged;
        let savedVersion = null;
        let lastSuccessfulSnapshot = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!active) return;
          const local = cloudSnapshotRef.current;
          const localBelongsToUser = localDataOwnerRef.current === pushUser.id;
          const hasSavedUserSnapshot = Boolean(
            loadLocalUserSnapshot(pushUser.id),
          );
          const hasCloudData = Boolean(
            remote?.data &&
            (hasMeaningfulLocalData(remote.data) ||
              (Array.isArray(remote.data.accountData?.settings?.cards) &&
                remote.data.accountData.settings.cards.length > 0)),
          );
          const preferLocal =
            !hasCloudData &&
            (localBelongsToUser || !hasSavedUserSnapshot) &&
            hasMeaningfulLocalData(local);
          const cloudAccountSettings = loadAccountData(
            remote?.data?.accountData ?? emptyAccountData(),
            remote?.data?.deletedRecords,
          ).settings;
          const preferLocalAccountSettings =
            preferLocal &&
            hasMeaningfulLocalAccountSettings(local) &&
            !hasMeaningfulAccountSettings(cloudAccountSettings);
          merged = mergeCloudSnapshots(
            local,
            remote?.data,
            preferLocal,
            preferLocalAccountSettings,
          );
          try {
            const expectedVersion = remote?.updated_at ?? null;
            savedVersion = await saveCloudData(
              pushUser.id,
              merged,
              expectedVersion,
            );
          } catch (error) {
            if (error.code !== "23505" || remote?.data) throw error;
          }
          if (savedVersion) {
            lastSuccessfulSnapshot = merged;
            if (cloudSnapshotRef.current === local) break;
            remote = { data: merged, updated_at: savedVersion };
            if (attempt < 2) {
              savedVersion = null;
              continue;
            }
            merged = mergeCloudSnapshots(
              cloudSnapshotRef.current,
              merged,
              true,
              !areAccountSettingsEqual(
                cloudSnapshotRef.current.accountData.settings,
                local.accountData.settings,
              ),
            );
            break;
          }
          remote = await loadCloudData(pushUser.id);
          setNormalizedAccountSync(remote?.normalizedAccountSync !== false);
        }
        if (!savedVersion || !merged) {
          throw new Error("Cloud data changed repeatedly; please try again.");
        }
        if (!active) return;
        cloudVersionRef.current = savedVersion;
        lastSyncedSnapshotRef.current = lastSuccessfulSnapshot ?? merged;
        cloudAccountSettingsRef.current =
          lastSyncedSnapshotRef.current.accountData.settings;
        adoptLocalDataForUser(pushUser.id);
        applyCloudSnapshot(merged);
        setCloudSyncReady(true);
        setCloudSyncActivity(
          areCloudSnapshotsEqual(merged, lastSyncedSnapshotRef.current)
            ? "synced"
            : "syncing",
        );
        setCloudSyncStatus("Cloud sync is on. Your data is saved to Supabase.");
      } catch (error) {
        if (active) {
          setCloudSyncReady(false);
          const isOffline =
            !navigator.onLine ||
            error?.message?.includes("Failed to fetch") ||
            error?.message?.includes("NetworkError");
          setCloudSyncActivity(isOffline ? "offline" : "error");
          setCloudRealtimeStatus(isOffline ? "offline" : "disconnected");
          const errorMsg = error?.message || "Sync failed";
          setCloudSyncStatus(
            isOffline
              ? "You are offline. Cloud sync will automatically resume when connected."
              : `Could not start cloud sync: ${errorMsg}. Tap Resume sync to retry.`,
          );
        }
      }
    }

    initializeCloudSync();
    return () => {
      active = false;
    };
  }, [cloudSyncEnabled, pushUser?.id, cloudSyncRetry, isHydrated]);

  useEffect(() => {
    if (!supabase || !pushUser || !cloudSyncEnabled || !cloudSyncReady) {
      setCloudRealtimeStatus(
        pushUser && cloudSyncEnabled ? "connecting" : "disconnected",
      );
      return undefined;
    }

    let active = true;
    setCloudRealtimeStatus("connecting");

    const handleCloudChange = () => {
      if (!active || authUserIdRef.current !== pushUser.id) return;
      if (hasAppPin() && !isSessionUnlocked()) return;
      window.clearTimeout(liveChangeTimerRef.current);
      setCloudSyncActivity("syncing");
      liveChangeTimerRef.current = window.setTimeout(async () => {
        try {
          if (!active || authUserIdRef.current !== pushUser.id) return;
          if (hasAppPin() && !isSessionUnlocked()) return;
          await queueCloudSnapshotRefresh(pushUser.id);
        } catch (error) {
          if (active && authUserIdRef.current === pushUser.id) {
            setCloudSyncActivity(navigator.onLine ? "error" : "offline");
            setCloudSyncStatus(`Could not refresh live data: ${error.message}`);
          }
        }
      }, 180);
    };

    const unsubscribe = subscribeToCloudChanges(
      pushUser.id,
      handleCloudChange,
      (status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setCloudRealtimeStatus("live");
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setCloudRealtimeStatus("reconnecting");
          return;
        }
        if (status === "CLOSED") setCloudRealtimeStatus("reconnecting");
      },
      normalizedAccountSync,
    );

    const handleOffline = () => {
      setCloudRealtimeStatus("offline");
      setCloudSyncActivity("offline");
    };
    const handleOnline = () => {
      setCloudRealtimeStatus("connecting");
      handleCloudChange();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void queueCloudSnapshotSave(pushUser.id).catch(() => {});
      } else if (document.visibilityState === "visible") {
        handleCloudChange();
      }
    };
    const handlePageHide = () => {
      void queueCloudSnapshotSave(pushUser.id).catch(() => {});
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!navigator.onLine) handleOffline();

    return () => {
      active = false;
      window.clearTimeout(liveChangeTimerRef.current);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
    };
  }, [cloudSyncEnabled, cloudSyncReady, normalizedAccountSync, pushUser?.id]);

  useEffect(() => {
    if (!supabase || !pushUser || !cloudSyncEnabled || !cloudSyncReady)
      return undefined;
    if (hasAppPin() && !isSessionUnlocked()) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await queueCloudSnapshotSave(pushUser.id);
      } catch (error) {
        if (authUserIdRef.current === pushUser.id) {
          setCloudSyncStatus(`Could not sync your data: ${error.message}`);
        }
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [
    accountData,
    budgets,
    budgetUpdatedAt,
    cloudSyncEnabled,
    cloudSyncReady,
    expenses,
    pushUser?.id,
    recurringSchedules,
    deletedRecords,
    targetCurrency,
    theme,
    reminderTime,
    localProfileName,
    profileAvatar,
    profileUpdatedAt,
    cloudSyncRetry,
  ]);

  useEffect(() => {
    const retryCloudSync = () => setCloudSyncRetry((retry) => retry + 1);
    window.addEventListener("online", retryCloudSync);
    return () => window.removeEventListener("online", retryCloudSync);
  }, []);

  useEffect(() => {
    if (!authModalOpen || authModalClosing) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !authBusy) hideAuthModal();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [authBusy, authModalClosing, authModalOpen, hideAuthModal]);

  useEffect(() => {
    if (authModalOpen || pushUser) return;
    const returnFocus =
      (authTriggerRef.current?.isConnected && authTriggerRef.current) ||
      (authReturnFocusRef.current?.isConnected && authReturnFocusRef.current);
    if (returnFocus) returnFocus.focus();
    authTriggerRef.current = null;
    authReturnFocusRef.current = null;
  }, [authModalOpen, pushUser]);

  useEffect(() => {
    if (profileEditorOpen) return undefined;
    if (profileEditorTriggerRef.current?.isConnected)
      profileEditorTriggerRef.current.focus();
    profileEditorTriggerRef.current = null;
    return undefined;
  }, [profileEditorOpen]);

  function trapAuthModalFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = authModalRef.current?.querySelectorAll(
      "button:not([disabled]), input:not([disabled])",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!isHydrated) return undefined;
    void syncNativeScheduledNotifications({
      recurringSchedules,
      expenses,
      reminderTime,
    });
    return undefined;
  }, [
    expenses,
    isHydrated,
    notificationPermission,
    recurringSchedules,
    reminderTime,
  ]);

  useEffect(() => {
    if (!supabase || !pushUser || !backgroundPushEnabled || !isHydrated)
      return undefined;
    let active = true;
    async function syncSchedules() {
      if (!active) return;
      try {
        await syncBackgroundSchedules(
          pushUser.id,
          recurringSchedules,
          reminderTime,
          { expenses },
        );
        if (active) setAuthStatus("");
      } catch (error) {
        if (active)
          setAuthStatus(`Could not sync reminder schedules: ${error.message}`);
      }
    }
    pushScheduleSyncRef.current = pushScheduleSyncRef.current.then(
      syncSchedules,
      syncSchedules,
    );
    return () => {
      active = false;
    };
  }, [
    backgroundPushEnabled,
    expenses,
    isHydrated,
    pushUser,
    recurringSchedules,
    reminderTime,
  ]);

  useEffect(() => {
    if (!pushUser || !("serviceWorker" in navigator)) return undefined;
    let active = true;
    let explicitlyDisabled = false;
    try {
      explicitlyDisabled =
        localStorage.getItem(PUSH_DISABLED_BY_USER_KEY) === "true";
    } catch {}

    navigator.serviceWorker
      .getRegistration()
      .then(async (registration) => {
        const sub = registration
          ? await registration.pushManager.getSubscription()
          : null;
        if (sub) return sub;
        if (
          !explicitlyDisabled &&
          pushBackendConfigured &&
          typeof window !== "undefined" &&
          window.Notification?.permission === "granted"
        ) {
          const enabled = await enableBackgroundPush(pushUser.id);
          return enabled?.subscription || null;
        }
        return null;
      })
      .then((subscription) => {
        if (active) setBackgroundPushEnabled(Boolean(subscription));
      })
      .catch((error) => {
        if (active)
          setNotificationStatus(
            `Could not check push subscription: ${error.message}`,
          );
      });
    return () => {
      active = false;
    };
  }, [pushUser, notificationPermission]);

  const monthExpenses = useMemo(
    () =>
      expenses.filter((expense) => expense.date.slice(0, 7) === selectedMonth),
    [expenses, selectedMonth],
  );
  const monthlyTotal = useMemo(
    () =>
      roundMoney(
        monthExpenses
          .filter((expense) => expense.category !== "Savings")
          .reduce(
            (sum, expense) =>
              sum + (expense.amount === null ? 0 : Number(expense.amount)),
            0,
          ),
      ),
    [monthExpenses],
  );

  const mobilePrototypeData = {
    m: selectedMonth,
    theme: resolvedTheme,
    themeMode: theme,
    rt: reminderTime,
    bud: budgets,
    exp: expenses.map((expense) => ({
      id: expense.id,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      desc: expense.description,
      amt: expense.amount,
      cat: expense.category,
      date: expense.date,
      acct: expense.account,
      rec: Boolean(expense.recurringId),
    })),
    rec: recurringSchedules.map((schedule) => ({
      id: schedule.id,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      desc: schedule.description,
      amt: schedule.amount,
      cat: schedule.category,
      iv: schedule.interval,
      next: schedule.nextDate,
      dayOfMonth: schedule.dayOfMonth,
      on: schedule.active ? 1 : 0,
      acct: schedule.account,
    })),
    start: {
      ...accountData.settings.balances,
      date: accountData.settings.startDate,
    },
    cards: Array.isArray(accountData.settings.cards)
      ? accountData.settings.cards
      : [],
    deletedCards: deletedRecords?.cards || {},
    tx: accountData.transactions.map((transaction) => ({
      id: transaction.id,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      type: transaction.type === "adjustment" ? "adjust" : transaction.type,
      acct: transaction.account ?? transaction.fromAccount,
      to: transaction.toAccount,
      dir: transaction.direction === "increase" ? "up" : "down",
      amt: transaction.amount,
      note: transaction.description,
      date: transaction.date,
    })),
  };

  const NOTIFIED_RECURRING_KEY = "spend-notified-recurring-v1";
  const LAST_DAILY_REMINDER_KEY = "spend-last-daily-reminder-date-v1";
  const BUDGET_ALERT_KEY_PREFIX = "spend-budget-alert-";

  function getNotifiedRecurringSet() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(NOTIFIED_RECURRING_KEY) || "[]",
      );
      return new Set(Array.isArray(saved) ? saved : []);
    } catch {
      return new Set();
    }
  }

  function saveNotifiedRecurringKey(key) {
    try {
      const current = getNotifiedRecurringSet();
      current.add(key);
      const trimmed = [...current].slice(-100);
      localStorage.setItem(NOTIFIED_RECURRING_KEY, JSON.stringify(trimmed));
    } catch {
      // Storage unavailable fallback
    }
  }

  async function notifyDueExpenses(dueExpenses) {
    if (!dueExpenses.length) return;
    pendingDueRef.current.push(...dueExpenses);

    const notifiedSet = getNotifiedRecurringSet();
    const unnotified = dueExpenses.filter(
      (expense) => !notifiedSet.has(`${expense.description}:${expense.date}`),
    );
    if (!unnotified.length) return;

    unnotified.forEach((expense) =>
      saveNotifiedRecurringKey(`${expense.description}:${expense.date}`),
    );

    const details = unnotified
      .map((expense) => `${expense.description} (${formatDate(expense.date)})`)
      .join(", ");
    const title =
      unnotified.length === 1
        ? `${unnotified[0].description} recorded`
        : `${unnotified.length} recurring expenses recorded`;
    const body =
      unnotified.length === 1
        ? unnotified[0].date === localDate()
          ? `Due today and recorded in Activity.`
          : `Was overdue and recorded in Activity.`
        : `Recorded in Activity: ${details}.`;

    await sendNativeBuiltinNotification({
      title,
      body,
      tag: `spend-recurring-${localDate()}`,
      tab: "activity",
      tone: "reminder",
    });
  }

  const checkDailyReminder = useCallback(async () => {
    const today = localDate();
    const dailyStamp = `${today}:${reminderTime}`;
    try {
      if (localStorage.getItem(LAST_DAILY_REMINDER_KEY) === dailyStamp) return;
    } catch {}

    const now = new Date();
    const currentHours = String(now.getHours()).padStart(2, "0");
    const currentMinutes = String(now.getMinutes()).padStart(2, "0");
    const currentTimeStr = `${currentHours}:${currentMinutes}`;

    if (currentTimeStr < reminderTime) return;

    try {
      localStorage.setItem(LAST_DAILY_REMINDER_KEY, dailyStamp);
    } catch {}

    const title = "Daily expense reminder";
    const body =
      "Don’t forget to track today's expenses to keep your budget on target.";

    await sendNativeBuiltinNotification({
      title,
      body,
      tag: `spend-daily-${today}`,
      tab: "home",
      tone: "reminder",
    });
  }, [reminderTime]);

  const checkBudgetMilestones = useCallback(async () => {
    const alertKey = BUDGET_ALERT_KEY_PREFIX + selectedMonth;
    const b = Number(budgets[selectedMonth] || 0);
    if (b <= 0) {
      try {
        localStorage.removeItem(alertKey);
      } catch {}
      return;
    }
    const pct = (monthlyTotal / b) * 100;
    let alertedMilestone = 0;
    try {
      alertedMilestone = Number(localStorage.getItem(alertKey) || "0");
    } catch {}

    if (pct < 80 && alertedMilestone > 0) {
      try {
        localStorage.removeItem(alertKey);
      } catch {}
      return;
    }
    if (pct < 100 && alertedMilestone >= 100) {
      try {
        localStorage.setItem(alertKey, "80");
      } catch {}
      alertedMilestone = 80;
    }

    if (pct >= 100 && alertedMilestone < 100) {
      try {
        localStorage.setItem(alertKey, "100");
      } catch {}
      const title = "Budget limit reached";
      const body = `You've spent ৳${monthlyTotal.toLocaleString("en-IN")} of your ৳${b.toLocaleString("en-IN")} monthly budget.`;
      await sendNativeBuiltinNotification({
        title,
        body,
        tag: `spend-budget-${selectedMonth}-100`,
        tab: "plans",
        tone: "reminder",
      });
    } else if (pct >= 80 && alertedMilestone < 80) {
      try {
        localStorage.setItem(alertKey, "80");
      } catch {}
      const title = "Budget alert: 80% used";
      const body = `You've used ${Math.round(pct)}% of your ৳${b.toLocaleString("en-IN")} monthly limit.`;
      await sendNativeBuiltinNotification({
        title,
        body,
        tag: `spend-budget-${selectedMonth}-80`,
        tab: "plans",
        tone: "reminder",
      });
    }
  }, [budgets, monthlyTotal, selectedMonth]);

  const processDueSchedules = useRef(null);
  processDueSchedules.current = () => {
    if (!isHydratedRef.current || (hasAppPin() && !isSessionUnlocked())) return;
    const today = localDate();
    const now = new Date();
    const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const canProcessToday = currentTimeStr >= reminderTime;
    const checkKey = `${today}:${canProcessToday ? reminderTime : "pre"}`;
    const cards = Array.isArray(accountData?.settings?.cards)
      ? accountData.settings.cards
      : [];
    const savingsId = getSavingsAccountId(cards);
    const savingsCard = savingsId
      ? cards.find((c) => c.id === savingsId)
      : null;
    const isScheduleBlockedByFrozenCard = (schedule) => {
      const targetCard = schedule.account
        ? cards.find((c) => c.id === schedule.account)
        : null;
      if (targetCard?.frozen) return true;
      if (schedule.category === "Savings" && savingsCard?.frozen) return true;
      return false;
    };
    const hasDueSchedule = recurringSchedules.some(
      (schedule) =>
        schedule.active &&
        !isScheduleBlockedByFrozenCard(schedule) &&
        (schedule.nextDate < today ||
          (schedule.nextDate === today && canProcessToday)),
    );
    if (lastRecurringCheckRef.current === checkKey && !hasDueSchedule) return;
    lastRecurringCheckRef.current = checkKey;
    const nextExpenses = [...expenses];
    let expensesChanged = false;
    let schedulesChanged = false;
    const dueExpenses = [];
    const nextSchedules = recurringSchedules.map((schedule) => {
      if (!schedule.active || isScheduleBlockedByFrozenCard(schedule))
        return schedule;
      let nextDate = schedule.nextDate;
      let generated = 0;
      while (
        (nextDate < today || (nextDate === today && canProcessToday)) &&
        generated < 240
      ) {
        const exists =
          isRecordDeleted(
            deletedRecords.expenses,
            `recurring:${schedule.id}:${nextDate}`,
          ) ||
          nextExpenses.some(
            (expense) =>
              expense.recurringId === schedule.id && expense.date === nextDate,
          );
        if (!exists) {
          const createdAt = Date.now();
          const targetCard = schedule.account
            ? cards.find((c) => c.id === schedule.account)
            : null;
          nextExpenses.push({
            id: makeId(),
            createdAt,
            updatedAt: createdAt,
            description: schedule.description,
            amount: Number(schedule.amount),
            category: schedule.category,
            date: nextDate,
            account:
              isAccountId(schedule.account, accountData) && !targetCard?.frozen
                ? schedule.account
                : "",
            recurringId: schedule.id,
          });
          dueExpenses.push({
            description: schedule.description,
            date: nextDate,
          });
          expensesChanged = true;
        }
        nextDate = nextOccurrenceDate(
          nextDate,
          schedule.interval,
          schedule.dayOfMonth,
        );
        generated += 1;
        schedulesChanged = true;
      }
      return schedulesChanged && nextDate !== schedule.nextDate
        ? { ...schedule, nextDate, updatedAt: Date.now() }
        : schedule;
    });
    if (expensesChanged) setExpenses(nextExpenses);
    if (schedulesChanged) setRecurringSchedules(nextSchedules);
    notifyDueExpenses(dueExpenses);
  };

  useEffect(() => {
    if (!isHydratedRef.current || (hasAppPin() && !isSessionUnlocked())) return;
    lastRecurringCheckRef.current = "";
    processDueSchedules.current?.();
  }, [recurringSchedules, accountData, reminderTime, isHydrated]);

  useEffect(() => {
    const runChecks = () => {
      if (!isHydratedRef.current || (hasAppPin() && !isSessionUnlocked()))
        return;
      processDueSchedules.current?.();
      checkDailyReminder();
      checkBudgetMilestones();
      checkAndNotifyNewMonth();
      checkAndNotifyUpcomingBills(recurringSchedules, reminderTime);
      checkAndNotifyWeeklySummary(expenses, reminderTime);
    };

    const initialTimer = window.setTimeout(runChecks, 800);
    const intervalTimer = window.setInterval(runChecks, 30_000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        runChecks();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [
    checkDailyReminder,
    checkBudgetMilestones,
    expenses,
    recurringSchedules,
    reminderTime,
    selectedMonth,
  ]);

  function saveMobileExpense(form) {
    const description = form.description.trim();
    const amount = parseAmount(form.amount);
    const requiresAmount =
      form.interval !== "none" || form.category === "Savings";
    if (
      !description ||
      !isValidDateString(form.date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (requiresAmount && (amount === null || !Number.isFinite(amount) || amount <= 0))
    ) {
      return false;
    }
    let createdExpenseId = null;
    let didGenerateExpenses = false;
    if (form.interval === "none") {
      const createdAt = Date.now();
      const newExpense = {
        id: makeId(),
        createdAt,
        updatedAt: createdAt,
        description,
        amount: amount === null ? null : roundMoney(amount),
        category: form.category,
        date: form.date,
        account: form.account,
      };
      createdExpenseId = newExpense.id;
      setExpenses((current) => [...current, newExpense]);
    } else {
      const scheduleId = makeId();
      let nextDate = form.date;
      const today = localDate();
      const generatedExpenses = [];
      let generated = 0;
      while (nextDate <= today && generated < 240) {
        const createdAt = Date.now();
        generatedExpenses.push({
          id: makeId(),
          createdAt,
          updatedAt: createdAt,
          description,
          amount: roundMoney(amount),
          category: form.category,
          date: nextDate,
          account: form.account,
          recurringId: scheduleId,
        });
        nextDate = nextOccurrenceDate(
          nextDate,
          form.interval,
          Number(form.date.slice(-2)),
        );
        generated += 1;
      }
      const now = Date.now();
      setRecurringSchedules((current) => [
        ...current,
        {
          id: scheduleId,
          createdAt: now,
          updatedAt: now,
          description,
          amount: roundMoney(amount),
          category: form.category,
          interval: form.interval,
          account: form.account,
          dayOfMonth: Number(form.date.slice(-2)),
          nextDate,
          active: true,
        },
      ]);
      if (generatedExpenses.length) {
        didGenerateExpenses = true;
        createdExpenseId = generatedExpenses[generatedExpenses.length - 1].id;
        setExpenses((current) => [...current, ...generatedExpenses]);
        notifyDueExpenses(
          generatedExpenses.map((expense) => ({
            description: expense.description,
            date: expense.date,
          })),
        );
      }
    }
    if (form.interval === "none" || didGenerateExpenses) {
      const targetMonth = form.date.slice(0, 7);
      const currMonth = currentMonth();
      setSelectedMonth(targetMonth > currMonth ? currMonth : targetMonth);
    }
    return { success: true, expenseId: createdExpenseId };
  }

  function saveMobileExpenseUpdate(expenseId, form) {
    const amount = parseAmount(form.amount);
    const existingExpense = expenses.find(
      (expense) => expense.id === expenseId,
    );
    const date = existingExpense?.recurringId
      ? existingExpense.date
      : form.date;
    if (
      !form.description.trim() ||
      !isValidDateString(date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0))
    )
      return false;
    setExpenses((current) =>
      current.map((expense) =>
        expense.id === expenseId
          ? {
              ...expense,
              description: form.description.trim(),
              amount: amount === null ? null : roundMoney(amount),
              category: form.category,
              date: expense.recurringId ? expense.date : form.date,
              account: form.account,
              updatedAt: Date.now(),
            }
          : expense,
      ),
    );
    const targetMonth = date.slice(0, 7);
    const currMonth = currentMonth();
    setSelectedMonth(targetMonth > currMonth ? currMonth : targetMonth);
    return true;
  }

  function saveMobileTransaction(form) {
    const amount = parseAmount(form.amt);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const txDate =
      form.date && isValidDateString(form.date) ? form.date : localDate();
    const type = form.type === "adjust" ? "adjustment" : form.type;
    const createdAt = Date.now();
    const transaction = {
      id: makeId(),
      createdAt,
      updatedAt: createdAt,
      type,
      amount: roundMoney(amount),
      date: txDate,
      description: capitalizeFirst(form.note ?? ""),
    };
    if (type === "income") {
      if (!isAccountId(form.acct, accountData)) return false;
      transaction.account = form.acct;
    } else if (type === "adjustment") {
      if (!isAccountId(form.acct, accountData)) return false;
      transaction.account = form.acct;
      transaction.direction = form.dir === "up" ? "increase" : "decrease";
    } else if (type === "transfer") {
      const from = form.fromAccount || form.acct;
      const to = form.toAccount || form.to;
      transaction.fromAccount = from;
      transaction.toAccount = to;
      if (
        !isAccountId(from, accountData) ||
        !isAccountId(to, accountData) ||
        from === to
      )
        return false;
    } else {
      return false;
    }
    setAccountData((current) => ({
      ...current,
      transactions: [...current.transactions, transaction],
    }));
    if (txDate && isValidDateString(txDate)) {
      const targetMonth = txDate.slice(0, 7);
      const currMonth = currentMonth();
      setSelectedMonth(targetMonth > currMonth ? currMonth : targetMonth);
    }
    return { success: true, transactionId: transaction.id };
  }

  function saveMobileTransactionUpdate(txId, form) {
    const amount = parseAmount(form.amt);
    if (!txId || !Number.isFinite(amount) || amount <= 0) return false;
    const txDate =
      form.date && isValidDateString(form.date) ? form.date : localDate();
    const type = form.type === "adjust" ? "adjustment" : form.type;
    if (type === "income" || type === "adjustment") {
      if (!isAccountId(form.acct, accountData)) return false;
    } else if (type === "transfer") {
      const from = form.fromAccount || form.acct;
      const to = form.toAccount || form.to;
      if (
        !isAccountId(from, accountData) ||
        !isAccountId(to, accountData) ||
        from === to
      )
        return false;
    } else {
      return false;
    }
    setAccountData((current) => ({
      ...current,
      transactions: current.transactions.map((tx) => {
        if (tx.id !== txId) return tx;
        const updated = {
          id: tx.id,
          createdAt: tx.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          type,
          amount: roundMoney(amount),
          date: txDate,
          description: capitalizeFirst(form.note ?? ""),
        };
        if (type === "income") {
          updated.account = form.acct;
        } else if (type === "adjustment") {
          updated.account = form.acct;
          updated.direction = form.dir === "up" ? "increase" : "decrease";
        } else if (type === "transfer") {
          updated.fromAccount = form.fromAccount || form.acct;
          updated.toAccount = form.toAccount || form.to;
        }
        return updated;
      }),
    }));
    if (txDate && isValidDateString(txDate)) {
      const targetMonth = txDate.slice(0, 7);
      const currMonth = currentMonth();
      setSelectedMonth(targetMonth > currMonth ? currMonth : targetMonth);
    }
    return true;
  }

  function removeMobileTransaction(txOrId) {
    const txId = typeof txOrId === "object" ? txOrId?.id : txOrId;
    const existingTx = accountData.transactions.find(
      (item) => item.id === txId,
    );
    if (!existingTx) return undefined;
    setAccountData((current) => ({
      ...current,
      transactions: current.transactions.filter((item) => item.id !== txId),
    }));
    setRecordDeleted("accountTransactions", txId, true);
    return () => {
      setRecordDeleted("accountTransactions", txId, false);
      setAccountData((current) =>
        current.transactions.some((item) => item.id === txId)
          ? current
          : { ...current, transactions: [...current.transactions, existingTx] },
      );
    };
  }

  function handleAddCard(newCard) {
    const cardId = newCard?.id || makeId();
    const now = Date.now();
    const isMfs = Boolean(
      newCard?.isPhone ||
      newCard?.category === "mfs" ||
      newCard?.type === "mfs" ||
      newCard?.network === "mfs",
    );
    const isSavings = Boolean(
      newCard?.category === "savings" ||
      newCard?.type === "savings" ||
      newCard?.provider === "savings" ||
      String(newCard?.number || "").startsWith("SAV-") ||
      String(newCard?.number || "").startsWith("VAULT-") ||
      String(newCard?.number || "").startsWith("DPS-"),
    );

    const rawNumber = String(newCard?.number || "").replace(/\D/g, "");
    const last4 = newCard?.last4 || (rawNumber ? rawNumber.slice(-4) : "");

    const { cvv: _cvv, number: _number, ...safeCard } = newCard || {};

    const rawBal = Number(newCard?.initialBalance);
    const initialBalance =
      Number.isFinite(rawBal) && rawBal >= 0 ? roundMoney(rawBal) : 0;

    let storedNumber = "";
    if (isSavings) {
      storedNumber =
        String(newCard?.number || "").trim() || (last4 ? `SAV-${last4}` : "");
    } else if (isMfs && rawNumber.length < 15) {
      storedNumber =
        String(newCard?.number || "").trim() ||
        (last4 ? `01••• •••${last4}` : "");
    } else {
      storedNumber = last4 ? `•••• •••• •••• ${last4}` : "";
    }

    setRecordDeleted("cards", cardId, false);
    setAccountData((current) => {
      const currentCards = Array.isArray(current.settings.cards)
        ? current.settings.cards
        : [];
      const isCardSavings = (c) =>
        Boolean(
          c?.category === "savings" ||
            c?.type === "savings" ||
            c?.provider === "savings" ||
            String(c?.number || "").startsWith("SAV-") ||
            String(c?.number || "").startsWith("VAULT-") ||
            String(c?.number || "").startsWith("DPS-"),
        );
      const isFirstNonSavings =
        !isSavings && !currentCards.some((c) => !isCardSavings(c));
      const isPrimary = isSavings
        ? false
        : Boolean(newCard?.isPrimary ?? isFirstNonSavings);
      const card = {
        ...safeCard,
        id: cardId,
        last4,
        number: storedNumber,
        isPrimary,
        createdAt: now,
        updatedAt: now,
      };
      const exists = currentCards.some((c) => c.id === cardId);
      const nextCards = exists
        ? currentCards.map((c) => (c.id === cardId ? { ...c, ...card } : c))
        : [...currentCards, card];
      return {
        ...current,
        settings: {
          ...current.settings,
          updatedAt: Date.now(),
          cardsConfigured: true,
          configured: true,
          ...(isPrimary ? { primaryCardId: cardId } : {}),
          cards: nextCards,
          balances: {
            ...current.settings.balances,
            [cardId]: initialBalance,
          },
        },
      };
    });
    return {
      ...safeCard,
      id: cardId,
      last4,
      number: storedNumber,
    };
  }

  function handleDeleteCard(cardId) {
    if (!cardId) return undefined;
    const existingCard = (
      Array.isArray(accountData.settings.cards)
        ? accountData.settings.cards
        : []
    ).find((c) => c.id === cardId);
    const existingBalance = accountData.settings.balances?.[cardId];
    const now = Date.now();

    setAccountData((current) => {
      const currentCards = Array.isArray(current.settings.cards)
        ? current.settings.cards
        : [];
      const remainingCards = currentCards.filter((c) => c.id !== cardId);
      const wasPrimary =
        existingCard?.isPrimary || current.settings.primaryCardId === cardId;
      const isCardSavings = (c) =>
        Boolean(
          c?.category === "savings" ||
            c?.type === "savings" ||
            c?.provider === "savings" ||
            String(c?.number || "").startsWith("SAV-") ||
            String(c?.number || "").startsWith("VAULT-") ||
            String(c?.number || "").startsWith("DPS-"),
        );
      const promoteCandidate =
        remainingCards.find((c) => !isCardSavings(c) && !c.frozen) ||
        remainingCards.find((c) => !isCardSavings(c)) ||
        null;
      const nextCards = remainingCards.map((c) =>
        wasPrimary && promoteCandidate && c.id === promoteCandidate.id
          ? { ...c, isPrimary: true, updatedAt: now }
          : c,
      );
      const nextBalances = { ...current.settings.balances };
      delete nextBalances[cardId];
      return {
        ...current,
        settings: {
          ...current.settings,
          updatedAt: now,
          cardsConfigured: true,
          primaryCardId:
            nextCards.find((c) => c.isPrimary)?.id ||
            promoteCandidate?.id ||
            "",
          cards: nextCards,
          balances: nextBalances,
        },
      };
    });

    setRecordDeleted("cards", cardId, true, {
      name: existingCard?.name,
      color: existingCard?.color,
    });

    if (existingCard) {
      const wasPrimaryOnDelete = Boolean(
        existingCard?.isPrimary ||
          accountData.settings.primaryCardId === cardId,
      );
      return () => {
        const restoreTime = Date.now();
        setRecordDeleted("cards", cardId, false);
        setAccountData((current) => {
          const currentCards = Array.isArray(current.settings.cards)
            ? current.settings.cards
            : [];
          if (currentCards.some((c) => c.id === existingCard.id))
            return current;
          const baseCards = wasPrimaryOnDelete
            ? currentCards.map((c) =>
                c.isPrimary ? { ...c, isPrimary: false, updatedAt: restoreTime } : c,
              )
            : currentCards;
          const restoredCards = [
            ...baseCards,
            {
              ...existingCard,
              isPrimary: wasPrimaryOnDelete ? true : Boolean(existingCard.isPrimary),
              updatedAt: restoreTime,
            },
          ];
          return {
            ...current,
            settings: {
              ...current.settings,
              updatedAt: restoreTime,
              cardsConfigured: true,
              primaryCardId: wasPrimaryOnDelete
                ? existingCard.id
                : current.settings.primaryCardId || "",
              cards: restoredCards,
              balances: {
                ...current.settings.balances,
                ...(existingBalance !== undefined
                  ? { [existingCard.id]: existingBalance }
                  : {}),
              },
            },
          };
        });
      };
    }
    return undefined;
  }

  function handleUpdateCard(updatedCard) {
    if (!updatedCard?.id) return updatedCard;
    const now = Date.now();
    const isMfs = Boolean(
      updatedCard?.isPhone ||
      updatedCard?.category === "mfs" ||
      updatedCard?.type === "mfs" ||
      updatedCard?.network === "mfs",
    );
    const isSavings = Boolean(
      updatedCard?.category === "savings" ||
      updatedCard?.type === "savings" ||
      updatedCard?.provider === "savings" ||
      String(updatedCard?.number || "").startsWith("SAV-") ||
      String(updatedCard?.number || "").startsWith("VAULT-") ||
      String(updatedCard?.number || "").startsWith("DPS-"),
    );

    const rawNumber = String(updatedCard?.number || "").replace(/\D/g, "");
    const last4 = isSavings
      ? rawNumber
        ? rawNumber.slice(-4)
        : updatedCard?.last4 || ""
      : updatedCard?.last4 || (rawNumber ? rawNumber.slice(-4) : "");

    const { cvv: _cvv, number: _number, ...safeCard } = updatedCard || {};

    const hasNumberUpdate =
      updatedCard?.last4 !== undefined || updatedCard?.number !== undefined;

    let targetNumber = undefined;
    if (hasNumberUpdate) {
      if (isSavings) {
        targetNumber =
          String(updatedCard?.number || "").trim() ||
          (last4 ? `SAV-${last4}` : "");
      } else if (isMfs && rawNumber.length < 15) {
        targetNumber =
          String(updatedCard?.number || "").trim() ||
          (last4 ? `01••• •••${last4}` : "");
      } else {
        targetNumber = last4 ? `•••• •••• •••• ${last4}` : "";
      }
    }

    const rawInitialBal =
      typeof updatedCard?.initialBalance === "string"
        ? updatedCard.initialBalance.trim() === ""
          ? NaN
          : Number(updatedCard.initialBalance)
        : Number(updatedCard?.initialBalance);
    const hasInitialBalanceUpdate =
      updatedCard?.initialBalance !== undefined &&
      updatedCard?.initialBalance !== null &&
      Number.isFinite(rawInitialBal) &&
      rawInitialBal >= 0;

    let resolvedLast4 = last4;
    let resolvedNumber = targetNumber;

    lastRecurringCheckRef.current = "";
    setRecordDeleted("cards", updatedCard.id, false);
    setAccountData((current) => {
      const currentCards = Array.isArray(current.settings.cards)
        ? current.settings.cards
        : [];
      const exists = currentCards.some((c) => c.id === updatedCard.id);
      const newCards = exists
        ? currentCards.map((c) => {
            if (c.id !== updatedCard.id) return c;
            const effectiveLast4 = hasNumberUpdate
              ? last4
              : c.last4 ||
                String(c.number || "")
                  .replace(/\D/g, "")
                  .slice(-4);
            const effectiveNumber = hasNumberUpdate
              ? targetNumber
              : c.number ||
                (isSavings
                  ? effectiveLast4
                    ? `SAV-${effectiveLast4}`
                    : ""
                  : effectiveLast4
                    ? `•••• •••• •••• ${effectiveLast4}`
                    : "");
            resolvedLast4 = effectiveLast4;
            resolvedNumber = effectiveNumber;
            return {
              ...c,
              ...safeCard,
              last4: effectiveLast4,
              number: effectiveNumber,
              updatedAt: now,
            };
          })
        : [
            ...currentCards,
            {
              ...safeCard,
              id: updatedCard.id,
              last4,
              number: targetNumber ?? (last4 ? `•••• •••• •••• ${last4}` : ""),
              createdAt: now,
              updatedAt: now,
            },
          ];
      return {
        ...current,
        settings: {
          ...current.settings,
          updatedAt: now,
          cardsConfigured: true,
          cards: newCards,
          ...(hasInitialBalanceUpdate
            ? {
                balances: {
                  ...current.settings.balances,
                  [updatedCard.id]: roundMoney(rawInitialBal),
                },
              }
            : {}),
        },
      };
    });
    return {
      ...safeCard,
      id: updatedCard.id,
      last4: resolvedLast4,
      number:
        resolvedNumber ??
        (resolvedLast4 ? `•••• •••• •••• ${resolvedLast4}` : ""),
    };
  }

  function handleSetPrimaryCard(cardId) {
    if (!cardId) return undefined;
    const now = Date.now();
    const currentCards = Array.isArray(accountData.settings.cards)
      ? accountData.settings.cards
      : [];
    const previousPrimaryId =
      accountData.settings.primaryCardId ||
      currentCards.find((c) => c.isPrimary)?.id ||
      null;

    const isCurrentlyPrimary =
      currentCards.find((c) => c.id === cardId)?.isPrimary ||
      previousPrimaryId === cardId;

    const nextPrimaryId = isCurrentlyPrimary ? null : cardId;

    setAccountData((current) => {
      const cardsList = Array.isArray(current.settings.cards)
        ? current.settings.cards
        : [];
      const nextCards = cardsList.map((c) => ({
        ...c,
        isPrimary: c.id === nextPrimaryId,
        updatedAt:
          c.id === cardId || c.id === previousPrimaryId ? now : c.updatedAt,
      }));
      return {
        ...current,
        settings: {
          ...current.settings,
          updatedAt: now,
          cardsConfigured: true,
          primaryCardId: nextPrimaryId || "",
          cards: nextCards,
        },
      };
    });

    const restore = () => {
      const restoreTime = Date.now();
      setAccountData((current) => {
        const cardsList = Array.isArray(current.settings.cards)
          ? current.settings.cards
          : [];
        const nextCards = cardsList.map((c) => ({
          ...c,
          isPrimary: c.id === previousPrimaryId,
          updatedAt:
            c.id === cardId || c.id === previousPrimaryId
              ? restoreTime
              : c.updatedAt,
        }));
        return {
          ...current,
          settings: {
            ...current.settings,
            updatedAt: restoreTime,
            cardsConfigured: true,
            primaryCardId: previousPrimaryId || "",
            cards: nextCards,
          },
        };
      });
    };

    return {
      isPrimary: !isCurrentlyPrimary,
      undo: restore,
    };
  }

  function handleMoveCardToFront(cardId) {
    if (!cardId) return;
    const now = Date.now();
    setAccountData((current) => {
      const currentCards = Array.isArray(current.settings.cards)
        ? current.settings.cards
        : [];
      const target = currentCards.find((c) => c.id === cardId);
      if (!target) return current;
      const rest = currentCards.filter((c) => c.id !== cardId);
      const nextCards = [{ ...target, updatedAt: now }, ...rest];
      return {
        ...current,
        settings: {
          ...current.settings,
          updatedAt: now,
          cardsConfigured: true,
          cards: nextCards,
        },
      };
    });
  }

  function toggleMobileRecurring(scheduleId) {
    lastRecurringCheckRef.current = "";
    setRecurringSchedules((current) =>
      current.map((schedule) => {
        if (schedule.id !== scheduleId) return schedule;
        if (schedule.active)
          return { ...schedule, active: false, updatedAt: Date.now() };
        let nextDate = schedule.nextDate;
        let skipped = 0;
        while (nextDate < localDate() && skipped < 240) {
          nextDate = nextOccurrenceDate(
            nextDate,
            schedule.interval,
            schedule.dayOfMonth,
          );
          skipped += 1;
        }
        return { ...schedule, active: true, nextDate, updatedAt: Date.now() };
      }),
    );
  }

  function saveMobileRecurringUpdate(scheduleId, form) {
    const description = String(form.description ?? form.desc ?? "").trim();
    const amount = parseAmount(form.amount ?? form.amt);
    const category = [
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
    ].includes(form.category ?? form.cat)
      ? (form.category ?? form.cat)
      : "Other";
    const interval = ["weekly", "monthly"].includes(form.interval ?? form.iv)
      ? (form.interval ?? form.iv)
      : "monthly";
    const nextDate = form.nextDate ?? form.next;
    const account = form.account ?? form.acct ?? "";
    if (
      !scheduleId ||
      !description ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !isValidDateString(nextDate)
    ) {
      return false;
    }
    const existing = recurringSchedules.find((item) => item.id === scheduleId);
    if (!existing) return false;
    const cards = Array.isArray(accountData?.settings?.cards)
      ? accountData.settings.cards
      : [];
    const targetCard = account ? cards.find((c) => c.id === account) : null;
    if (targetCard?.frozen) return false;
    if (category === "Savings") {
      const savingsId = getSavingsAccountId(cards);
      const savingsCard = savingsId
        ? cards.find((c) => c.id === savingsId)
        : null;
      if (savingsCard?.frozen) return false;
      if (savingsId && (!account || account === "cash")) return false;
    }
    lastRecurringCheckRef.current = "";
    setRecurringSchedules((current) =>
      current.map((schedule) => {
        if (schedule.id !== scheduleId) return schedule;
        const nextActive =
          typeof form.active === "boolean"
            ? form.active
            : form.on !== undefined
              ? Boolean(form.on)
              : schedule.active;
        const nextDateChanged = nextDate !== schedule.nextDate;
        const dayOfMonth = nextDateChanged
          ? Number(nextDate.slice(-2))
          : schedule.dayOfMonth || Number(nextDate.slice(-2));
        let resolvedNextDate = nextDate;
        if (!schedule.active && nextActive && !nextDateChanged) {
          let skipped = 0;
          while (resolvedNextDate < localDate() && skipped < 240) {
            resolvedNextDate = nextOccurrenceDate(
              resolvedNextDate,
              interval,
              dayOfMonth,
            );
            skipped += 1;
          }
        }
        return {
          ...schedule,
          description,
          amount: roundMoney(amount),
          category,
          interval,
          nextDate: resolvedNextDate,
          dayOfMonth,
          account: isAccountId(account, accountData) ? account : "",
          active: nextActive,
          updatedAt: Date.now(),
        };
      }),
    );
    return true;
  }

  function removeMobileRecurring(scheduleId) {
    const index = recurringSchedules.findIndex(
      (item) => item.id === scheduleId,
    );
    if (index === -1) return undefined;
    const schedule = recurringSchedules[index];
    setRecurringSchedules((current) =>
      current.filter((item) => item.id !== scheduleId),
    );
    setRecordDeleted("recurringSchedules", scheduleId, true);
    return () => {
      lastRecurringCheckRef.current = "";
      setRecordDeleted("recurringSchedules", scheduleId, false);
      setRecurringSchedules((current) => {
        if (current.some((item) => item.id === scheduleId)) return current;
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, schedule);
        return next;
      });
    };
  }

  function setRecordDeleted(collection, id, isDeleted, metadata = {}) {
    setDeletedRecords((current) => {
      const normalized = normalizeDeletedRecords(current);
      const existing = normalized[collection][id];
      if (!isDeleted && !existing?.deleted) return current;
      const previous = existing?.updatedAt ?? 0;
      return {
        ...normalized,
        [collection]: {
          ...normalized[collection],
          [id]: {
            deleted: isDeleted,
            updatedAt: Math.max(Date.now(), previous + 1),
            ...metadata,
          },
        },
      };
    });
  }

  function setExpenseDeleted(expense, isDeleted) {
    setRecordDeleted("expenses", expense.id, isDeleted);
    if (expense.recurringId)
      setRecordDeleted(
        "expenses",
        `recurring:${expense.recurringId}:${expense.date}`,
        isDeleted,
      );
  }

  function restoreExpense(expense) {
    setExpenseDeleted(expense, false);
    setExpenses((current) =>
      current.some((item) => item.id === expense.id)
        ? current
        : [...current, expense],
    );
  }

  function removeExpense(expenseOrId) {
    const expenseId =
      typeof expenseOrId === "object" ? expenseOrId?.id : expenseOrId;
    const expense = expenses.find((item) => item.id === expenseId);
    if (!expense) return undefined;
    setExpenses((current) => current.filter((item) => item.id !== expense.id));
    setExpenseDeleted(expense, true);
    return () => restoreExpense(expense);
  }

  function clearBudget() {
    const previousBudget = budgets[selectedMonth];
    try {
      localStorage.removeItem(BUDGET_ALERT_KEY_PREFIX + selectedMonth);
    } catch {}
    setBudgets((current) => {
      const next = { ...current };
      delete next[selectedMonth];
      return next;
    });
    if (previousBudget) {
      setBudgetUpdatedAt((current) => ({
        ...current,
        [selectedMonth]: Date.now(),
      }));
      setRecordDeleted("budgets", selectedMonth, true);
      return () => {
        setRecordDeleted("budgets", selectedMonth, false);
        setBudgetUpdatedAt((current) => ({
          ...current,
          [selectedMonth]: Date.now(),
        }));
        setBudgets((current) => ({
          ...current,
          [selectedMonth]: previousBudget,
        }));
      };
    }
    return undefined;
  }

  function downloadBackup() {
    const exportedAt = new Date().toISOString();
    const backup = {
      format: "spend-backup",
      version: 1,
      exportedAt,
      data: {
        expenses,
        budgets,
        budgetUpdatedAt,
        recurringSchedules,
        accountData,
        deletedRecords,
        theme,
        targetCurrency,
        reminderTime,
        profileName: localProfileName,
        profileAvatar,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-backup-${localDate()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    try {
      localStorage.setItem(LAST_BACKUP_AT_KEY, exportedAt);
    } catch {
      // Keep the updated reminder for this visit if browser storage is unavailable.
    }
    setBackupStatus("Backup downloaded. Keep it somewhere safe.");
  }

  async function downloadEncryptedBackup() {
    const password = window.prompt(
      "Enter a password or PIN to encrypt your backup (AES-256):",
    );
    if (!password) {
      setBackupStatus("Encrypted backup canceled.");
      return;
    }
    try {
      const exportedAt = new Date().toISOString();
      const backupData = {
        expenses,
        budgets,
        budgetUpdatedAt,
        recurringSchedules,
        accountData,
        deletedRecords,
        theme,
        targetCurrency,
        reminderTime,
        profileName: localProfileName,
        profileAvatar,
      };
      const encryptedPayload = await encryptBackup(backupData, password);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(encryptedPayload, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `spend-encrypted-backup-${localDate()}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      try {
        localStorage.setItem(LAST_BACKUP_AT_KEY, exportedAt);
      } catch {}
      setBackupStatus("Encrypted backup (AES-256) downloaded securely.");
    } catch (e) {
      alert("Failed to encrypt backup: " + (e?.message || e));
      setBackupStatus("Encryption failed.");
    }
  }

  function exportAllExpensesCsv() {
    const data = [
      [
        "Date",
        "Description",
        "Category",
        "Amount (BDT)",
        "Payment account",
        "Type",
      ],
      ...[...expenses]
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((expense) => [
          expense.date,
          expense.description,
          expense.category,
          expense.amount === null ? "" : expense.amount,
          isAccountId(expense.account, accountData)
            ? accountName(expense.account, accountData.settings.cards)
            : "Cash / Other",
          expense.recurringId ? "Recurring" : "One-time",
        ]),
    ];
    const csv = `\uFEFF${data
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-expenses-${localDate()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupStatus("Expenses exported as CSV.");
  }

  async function restoreBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      let backup = JSON.parse(await file.text());
      if (backup?.format === "spend-encrypted-backup") {
        const password = window.prompt(
          "This backup is protected with AES-256 encryption. Enter password or PIN to decrypt:",
        );
        if (!password) {
          setBackupStatus("Restore canceled (password required).");
          input.value = "";
          return;
        }
        try {
          const decryptedData = await decryptBackup(backup, password);
          backup = {
            format: "spend-backup",
            version: 1,
            exportedAt: backup.exportedAt,
            data: decryptedData,
          };
        } catch {
          alert(
            "Decryption failed: Incorrect password or corrupted backup file.",
          );
          setBackupStatus("Decryption failed. Incorrect password.");
          input.value = "";
          return;
        }
      }
      const data = backup?.data;
      if (
        backup?.format !== "spend-backup" ||
        backup?.version !== 1 ||
        !Array.isArray(data?.expenses) ||
        !data.budgets ||
        typeof data.budgets !== "object" ||
        Array.isArray(data.budgets) ||
        !Array.isArray(data?.recurringSchedules) ||
        !data.accountData ||
        typeof data.accountData !== "object" ||
        !data.accountData.settings ||
        !data.accountData.settings.balances ||
        !Array.isArray(data.accountData.transactions) ||
        !["light", "dark", "auto"].includes(data.theme) ||
        typeof data.targetCurrency !== "string" ||
        !/^[A-Z]{3}$/.test(data.targetCurrency) ||
        (data.reminderTime !== undefined &&
          !isValidReminderTime(data.reminderTime))
      ) {
        throw new Error("This file is not a valid Spend backup.");
      }
      if (
        !window.confirm(
          "Restoring this backup will replace all current app data. Continue?",
        )
      ) {
        setBackupStatus("Restore canceled.");
        return;
      }
      const restoreTimestamp = Date.now();
      const restoredDeletedRecords = normalizeDeletedRecords(
        data.deletedRecords,
      );
      const restoredAccounts = loadAccountData(
        data.accountData,
        restoredDeletedRecords,
      );
      const restoredExpenses = loadExpenses(
        data.expenses,
        restoredAccounts,
      ).map((expense) => ({
        ...expense,
        createdAt: expense.createdAt ?? restoreTimestamp,
        updatedAt: expense.updatedAt ?? restoreTimestamp,
      }));
      setExpenses(restoredExpenses);
      const restoredBudgets = loadBudgets(data.budgets);
      setBudgets(restoredBudgets);
      const restoredBudgetUpdatedAt = Object.fromEntries(
        Object.keys(restoredBudgets).map((month) => [
          month,
          data.budgetUpdatedAt?.[month] ?? restoreTimestamp,
        ]),
      );
      setBudgetUpdatedAt(restoredBudgetUpdatedAt);
      const restoredSchedules = loadRecurringSchedules(
        data.recurringSchedules,
        restoredAccounts,
      ).map((schedule) => ({
        ...schedule,
        createdAt: schedule.createdAt ?? restoreTimestamp,
        updatedAt: schedule.updatedAt ?? restoreTimestamp,
      }));
      setRecurringSchedules(restoredSchedules);
      const restoredAccountData = {
        settings: {
          ...restoredAccounts.settings,
          updatedAt: restoredAccounts.settings.updatedAt || restoreTimestamp,
        },
        transactions: restoredAccounts.transactions.map((transaction) => ({
          ...transaction,
          createdAt: transaction.createdAt ?? restoreTimestamp,
          updatedAt: transaction.updatedAt ?? restoreTimestamp,
        })),
      };
      setAccountData(restoredAccountData);
      setDeletedRecords(restoredDeletedRecords);
      setTheme(data.theme);
      setTargetCurrency(data.targetCurrency);
      if (isValidReminderTime(data.reminderTime)) {
        setReminderTime(data.reminderTime);
        try {
          localStorage.setItem(STORAGE_KEYS.reminderTime, data.reminderTime);
        } catch {
          // Keep the restored reminder time for this visit.
        }
      }
      if (typeof data.profileName === "string" && data.profileName.trim()) {
        const restoredName = capitalizeFirst(data.profileName);
        setLocalProfileName(restoredName);
        try {
          localStorage.setItem(STORAGE_KEYS.profileName, restoredName);
        } catch {}
      }
      if (isValidAvatarValue(data.profileAvatar)) {
        const restoredAvatar = data.profileAvatar.trim();
        setProfileAvatar(restoredAvatar);
        try {
          localStorage.setItem(STORAGE_KEYS.profileAvatar, restoredAvatar);
        } catch {}
      }

      if (pushUser && cloudSyncEnabled) {
        const restoredSnapshot = {
          expenses: restoredExpenses,
          budgets: restoredBudgets,
          budgetUpdatedAt: restoredBudgetUpdatedAt,
          recurringSchedules: restoredSchedules,
          accountData: restoredAccountData,
          deletedRecords: restoredDeletedRecords,
          theme: data.theme,
          targetCurrency: data.targetCurrency,
          reminderTime: isValidReminderTime(data.reminderTime)
            ? data.reminderTime
            : "09:00",
          profileName:
            typeof data.profileName === "string" && data.profileName.trim()
              ? capitalizeFirst(data.profileName)
              : localProfileName,
          profileAvatar: isValidAvatarValue(data.profileAvatar)
            ? data.profileAvatar.trim()
            : profileAvatar,
        };
        cloudSnapshotRef.current = restoredSnapshot;
        void queueCloudSnapshotSave(pushUser.id, { forceOverwrite: true });
      }

      setBackupStatus("Backup restored.");
    } catch (error) {
      setBackupStatus(`Could not restore backup: ${error.message}`);
    } finally {
      input.value = "";
    }
  }

  function applyCloudSnapshot(snapshot) {
    setExpenses(snapshot.expenses);
    setBudgets(snapshot.budgets);
    setBudgetUpdatedAt(normalizeBudgetUpdatedAt(snapshot.budgetUpdatedAt));
    setRecurringSchedules(snapshot.recurringSchedules);
    setAccountData(snapshot.accountData);
    setDeletedRecords(normalizeDeletedRecords(snapshot.deletedRecords));
    setTheme(snapshot.theme);
    setTargetCurrency(snapshot.targetCurrency);
    setReminderTime(
      isValidReminderTime(snapshot.reminderTime)
        ? snapshot.reminderTime
        : "09:00",
    );
    if (typeof snapshot.profileName === "string") {
      const nextName = snapshot.profileName.trim()
        ? capitalizeFirst(snapshot.profileName)
        : "";
      setLocalProfileName(nextName);
      try {
        if (nextName) {
          localStorage.setItem(STORAGE_KEYS.profileName, nextName);
        } else {
          localStorage.removeItem(STORAGE_KEYS.profileName);
        }
      } catch {}
    }
    if (isValidAvatarValue(snapshot.profileAvatar)) {
      const nextAvatar = snapshot.profileAvatar.trim();
      setProfileAvatar(nextAvatar);
      try {
        localStorage.setItem(STORAGE_KEYS.profileAvatar, nextAvatar);
      } catch {}
    } else if (snapshot.profileAvatar === "") {
      setProfileAvatar("");
      try {
        localStorage.removeItem(STORAGE_KEYS.profileAvatar);
      } catch {}
    }
    if (typeof snapshot.profileUpdatedAt === "number") {
      const nextUpdatedAt = Number.isFinite(snapshot.profileUpdatedAt)
        ? snapshot.profileUpdatedAt
        : 0;
      setProfileUpdatedAt(nextUpdatedAt);
      try {
        if (nextUpdatedAt > 0) {
          localStorage.setItem(
            STORAGE_KEYS.profileUpdatedAt,
            String(nextUpdatedAt),
          );
        } else {
          localStorage.removeItem(STORAGE_KEYS.profileUpdatedAt);
        }
      } catch {}
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const client = supabase || (await getSupabase());
    if (!client) return;
    setAuthBusy(true);
    setAuthStatus("");
    try {
      if (authMode === "forgot-password") {
        const { error } = await client.auth.resetPasswordForEmail(
          authEmail.trim(),
          {
            redirectTo: new URL(
              import.meta.env.BASE_URL,
              window.location.origin,
            ).href,
          },
        );
        if (error) throw error;
        setAuthStatus(
          "If an account exists for this email, a password reset link is on its way.",
        );
        setAuthPassword("");
        return;
      }

      if (authMode === "update-password") {
        const { error } = await client.auth.updateUser({
          password: authPassword,
        });
        if (error) throw error;
        setAuthStatus("Password updated. You can continue using Spend.");
        setAuthPassword("");
        setAuthMode("sign-in");
        return;
      }

      const result =
        authMode === "sign-up"
          ? await client.auth.signUp({
              email: authEmail.trim(),
              password: authPassword,
              options: {
                emailRedirectTo: new URL(
                  import.meta.env.BASE_URL,
                  window.location.origin,
                ).href,
              },
            })
          : await client.auth.signInWithPassword({
              email: authEmail.trim(),
              password: authPassword,
            });
      if (result.error) throw result.error;
      if (authMode === "sign-up" && !result.data.session) {
        setAuthStatus(
          "Check your email to confirm your account, then sign in.",
        );
      } else {
        const signedInUser = result.data?.session?.user || result.data?.user;
        if (signedInUser) {
          notifyNewUserSignedIn(signedInUser);
        }
        setAuthStatus(
          authMode === "sign-up"
            ? "Account created. You can now enable background reminders."
            : backgroundPushEnabled
              ? "Signed in. Your recurring reminder schedule is syncing."
              : "Signed in.",
        );
        hideAuthModal();
      }
      setAuthPassword("");
    } catch (error) {
      setAuthStatus(
        `Could not ${
          authMode === "sign-up"
            ? "create account"
            : authMode === "forgot-password"
              ? "send the reset email"
              : authMode === "update-password"
                ? "update your password"
                : "sign in"
        }: ${error.message}`,
      );
    } finally {
      setAuthBusy(false);
    }
  }

  function openProfileEditor() {
    profileEditorTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProfileDraft(
      pushUser
        ? localProfileName || userDisplayName(pushUser) || ""
        : localProfileName || "",
    );
    setProfileStatus("");
    showProfileEditor();
  }

  function showAuthDialog() {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      !activeElement.closest('[role="dialog"]')
    ) {
      authReturnFocusRef.current = activeElement;
    }
    showAuthModal();
  }

  function openSignInModal() {
    initSupabaseAuth();
    authTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    authReturnFocusRef.current = authTriggerRef.current;
    setAuthMode("sign-in");
    setAuthStatus("");
    setAuthPassword("");
    setShowAuthPassword(false);
    showAuthDialog();
  }

  async function saveProfileName(value) {
    const name = capitalizeFirst(value);
    if (!name || name.length > 48) {
      setProfileStatus("Enter a name with 1 to 48 characters.");
      return false;
    }
    const now = Date.now();
    setLocalProfileName(name);
    setProfileUpdatedAt(now);
    try {
      localStorage.setItem(STORAGE_KEYS.profileName, name);
      localStorage.setItem(STORAGE_KEYS.profileUpdatedAt, String(now));
    } catch {}

    const client =
      supabase || (supabaseConfigured ? await getSupabase() : null);
    if (!pushUser || !client) {
      setProfileStatus("Display name saved.");
      return true;
    }

    setProfileSaving(true);
    setProfileStatus("");
    try {
      const { data, error } = await client.auth.updateUser({
        data: { full_name: name, name },
      });
      if (error) throw error;
      setPushUser(
        data.user ?? {
          ...pushUser,
          user_metadata: { ...pushUser.user_metadata, full_name: name, name },
        },
      );
      setProfileStatus("Profile synced.");
      return true;
    } catch (error) {
      setProfileStatus(`Saved locally (sync pending): ${error.message}`);
      return true;
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveProfileAvatar(dataUrl) {
    const nextAvatar = isValidAvatarValue(dataUrl) ? dataUrl.trim() : "";
    const now = Date.now();
    setProfileAvatar(nextAvatar);
    setProfileUpdatedAt(now);
    try {
      localStorage.setItem(STORAGE_KEYS.profileUpdatedAt, String(now));
      if (nextAvatar) {
        localStorage.setItem(STORAGE_KEYS.profileAvatar, nextAvatar);
      } else {
        localStorage.removeItem(STORAGE_KEYS.profileAvatar);
      }
    } catch {}

    const client =
      supabase || (supabaseConfigured ? await getSupabase() : null);
    if (!pushUser || !client) {
      setProfileStatus(
        nextAvatar
          ? "Profile photo saved on this device."
          : "Profile photo removed.",
      );
      return true;
    }

    // Base64 data URLs sync via spend_user_data (cloudSnapshotRef) to avoid bloating Supabase Auth JWT headers.
    // Only write avatar_url to user_metadata if it is a compact https:// URL or if clearing an existing metadata URL.
    const shouldUpdateAuthMetadata =
      nextAvatar.startsWith("https://") ||
      (!nextAvatar && Boolean(pushUser?.user_metadata?.avatar_url));

    if (shouldUpdateAuthMetadata) {
      setProfileSaving(true);
      try {
        const { data, error } = await client.auth.updateUser({
          data: { avatar_url: nextAvatar || null },
        });
        if (!error && data?.user) {
          setPushUser(data.user);
        }
      } catch {
        // Ignore metadata error; spend_user_data snapshot syncs the photo.
      } finally {
        setProfileSaving(false);
      }
    }

    setProfileStatus(
      nextAvatar
        ? "Profile photo updated and synced."
        : "Profile photo removed.",
    );
    return true;
  }

  function handleResumeSync() {
    if (!pushUser) return;
    setCloudSyncStatus("Starting cloud sync…");
    setCloudSyncActivity("syncing");
    setCloudSyncEnabled(true);
    setCloudSyncRetry((r) => r + 1);
  }

  async function signOutOfPush() {
    const client = supabase || (await getSupabase());
    if (!client || !pushUser) return;
    setAuthBusy(true);
    try {
      if (cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
      }
      if (pushBackendConfigured) {
        await disableBackgroundPush(pushUser.id);
      }
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setBackgroundPushEnabled(false);
      setNotificationStatus(
        "Signed out. Background reminders are disabled on this device.",
      );
    } catch (error) {
      setAuthStatus(`Could not sign out: ${error.message}`);
    } finally {
      setAuthBusy(false);
    }
  }

  async function toggleNotifications() {
    if (
      typeof window !== "undefined" &&
      Boolean(window.Capacitor?.isNativePlatform?.())
    ) {
      const granted = await requestNotificationPermission();
      const perm = await checkNotificationPermission();
      setNotificationPermission(perm);
      if (granted) {
        await syncNativeScheduledNotifications({
          recurringSchedules,
          expenses,
          reminderTime,
        });
        setNotificationStatus(
          "Native background reminders are active for daily tracking, upcoming bills, weekly recaps, and monthly overviews.",
        );
        await sendNativeBuiltinNotification({
          title: "Spend notifications enabled",
          body: "Closed-app reminders are active for daily tracking, bills, and summaries.",
          tag: "spend-test-confirmation",
          tone: "reminder",
        });
      } else {
        setNotificationStatus(
          "Allow notifications in device settings, then reload Spend.",
        );
      }
      return;
    }

    if (!pushBackendConfigured) {
      if (!("Notification" in window)) {
        setNotificationPermission("unsupported");
        setNotificationStatus(
          "System notifications are not supported by this browser.",
        );
        return;
      }
      let permission = window.Notification.permission;
      if (permission === "default") {
        try {
          permission = await window.Notification.requestPermission();
        } catch (error) {
          setNotificationStatus(
            `Could not request notification permission: ${error.message}`,
          );
          return;
        }
      }
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setNotificationStatus(
          permission === "denied"
            ? "Allow notifications for this site in your browser settings."
            : "Notification permission was not granted.",
        );
        return;
      }
      setNotificationStatus("Notifications are allowed.");
      await sendNativeBuiltinNotification({
        title: "Spend notifications enabled",
        body: "Built-in notifications are active on this device.",
        tag: "spend-test-confirmation",
        tone: "reminder",
      });
      return;
    }
    if (!pushUser) {
      setNotificationStatus("Sign in first to enable background reminders.");
      showAuthDialog();
      return;
    }
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (isIos && !installed) {
      setNotificationStatus(
        "On iPhone or iPad, add Spend to your Home Screen and open it there before enabling notifications.",
      );
      return;
    }
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setNotificationStatus(
        "System notifications are not supported by this browser.",
      );
      return;
    }
    if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
      setNotificationStatus(
        "Background push is not supported by this browser.",
      );
      return;
    }
    if (backgroundPushEnabled) {
      try {
        await disableBackgroundPush(pushUser.id);
        setBackgroundPushEnabled(false);
        setNotificationStatus(
          "Background reminders are disabled on this device.",
        );
      } catch (error) {
        setNotificationStatus(
          `Could not disable background reminders: ${error.message}`,
        );
      }
      return;
    }
    let permission = window.Notification.permission;
    if (permission === "default") {
      try {
        permission = await window.Notification.requestPermission();
      } catch (error) {
        setNotificationStatus(
          `Could not request notification permission: ${error.message}`,
        );
        return;
      }
    }
    setNotificationPermission(permission);
    if (permission === "denied") {
      setNotificationStatus(
        "Allow notifications for this site in your browser settings, then reload the app.",
      );
      return;
    }
    try {
      await enableBackgroundPush(pushUser.id);
      setBackgroundPushEnabled(true);
      setNotificationStatus(
        "Background reminders are enabled for daily tracking, upcoming & due bills, weekly summaries, and monthly overviews.",
      );
      await sendNativeBuiltinNotification({
        title: "Spend notifications enabled",
        body: "Closed-app reminders are active for daily tracking, bills, and summaries.",
        tag: "spend-test-confirmation",
        tone: "reminder",
      });
    } catch (error) {
      setNotificationStatus(
        `Could not enable background reminders: ${error.message}`,
      );
    }
  }

  async function handleTestNotification() {
    setNotificationStatus(
      "Test scheduled! Minimize or lock Spend now — your notification will arrive in 4 seconds…",
    );
    const delayMs = 4000;
    const isNative =
      typeof window !== "undefined" &&
      Boolean(window.Capacitor?.isNativePlatform?.());

    if (isNative) {
      try {
        const sent = await sendNativeBuiltinNotification({
          title: "Spend background test reminder",
          body: "Closed-app notifications are working while Spend is inactive!",
          tag: `spend-manual-test-${Date.now()}`,
          tone: "reminder",
          scheduleAt: new Date(Date.now() + delayMs),
        });
        if (sent) {
          window.setTimeout(() => {
            setNotificationStatus("Background test notification delivered.");
          }, delayMs + 300);
        } else {
          setNotificationStatus(
            "Could not trigger test notification. Check permissions.",
          );
        }
      } catch (error) {
        setNotificationStatus(
          `Could not trigger test notification: ${error.message}`,
        );
      }
      return;
    }

    if ("serviceWorker" in navigator && window.Notification?.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sw = reg?.active || navigator.serviceWorker.controller;
        if (sw) {
          sw.postMessage({
            type: "SCHEDULE_TEST_NOTIFICATION",
            delayMs,
            title: "Spend background test reminder",
            body: "Background notifications are working while Spend is inactive!",
          });
          window.setTimeout(() => {
            setNotificationStatus("Background test notification delivered.");
          }, delayMs + 300);
          return;
        }
      } catch {}
    }

    window.setTimeout(async () => {
      try {
        const sent = await sendNativeBuiltinNotification({
          title: "Spend test reminder",
          body: "Built-in notifications with custom tones are working properly!",
          tag: "spend-manual-test",
          tone: "reminder",
        });
        if (sent) {
          setNotificationStatus("Test notification sent successfully.");
        } else {
          setNotificationStatus(
            "Could not trigger test notification. Check permissions.",
          );
        }
      } catch (error) {
        setNotificationStatus(
          `Could not trigger test notification: ${error.message}`,
        );
      }
    }, delayMs);
  }

  useEffect(() => {
    if (pendingDueRef.current.length && !backgroundPushEnabled) {
      const due = [...pendingDueRef.current];
      pendingDueRef.current = [];
      const details = due
        .map(
          (expense) => `${expense.description} (${formatDate(expense.date)})`,
        )
        .join(", ");
      void sendNativeBuiltinNotification({
        title:
          due.length === 1 ? "Recurring expense due" : "Recurring expenses due",
        body: details,
        tag: `spend-recurring-${localDate()}`,
        tab: "activity",
        tone: "reminder",
      });
    }
  }, [notificationPermission, backgroundPushEnabled]);

  useEffect(() => {
    if (notificationPermission === "unsupported") {
      setNotificationStatus(
        "System notifications are not supported by this browser.",
      );
    } else if (notificationPermission === "denied") {
      setNotificationStatus(
        "Allow notifications for this site in your browser settings, then reload the app.",
      );
    } else if (notificationPermission === "default") {
      setNotificationStatus(
        "Allow notifications to get reminders while this app is open.",
      );
    }
  }, [notificationPermission]);

  function updateReminderTime(value) {
    if (!isValidReminderTime(value)) {
      setNotificationStatus("Choose a valid reminder time.");
      return;
    }
    lastRecurringCheckRef.current = "";
    setReminderTime(value);
    try {
      localStorage.setItem(STORAGE_KEYS.reminderTime, value);
      localStorage.removeItem(LAST_DAILY_REMINDER_KEY);
    } catch (error) {
      setNotificationStatus(
        `Could not save the reminder time on this device: ${error.message}`,
      );
    }
    void syncNativeScheduledNotifications({
      recurringSchedules,
      expenses,
      reminderTime: value,
    });
    if (pushUser && backgroundPushEnabled) {
      pushScheduleSyncRef.current = pushScheduleSyncRef.current.then(
        () =>
          syncBackgroundSchedules(pushUser.id, recurringSchedules, value, {
            expenses,
          }).catch(() => {}),
        () =>
          syncBackgroundSchedules(pushUser.id, recurringSchedules, value, {
            expenses,
          }).catch(() => {}),
      );
    }
  }

  function addMonth(offset) {
    setSelectedMonth((month) => shiftMonth(month, offset));
  }

  return (
    <>
      {!ready && (
        <SpendSplash canExit={prototypeMounted} onDone={() => setReady(true)} />
      )}
      <Suspense fallback={null}>
        <PrototypeMountSignal onMounted={handlePrototypeMounted} />
        <MobilePrototype
          S={mobilePrototypeData}
          onUnlock={handleAppUnlock}
          onResetPin={handleResetForgottenPin}
          onShift={addMonth}
          onExpenseSave={saveMobileExpense}
          onExpenseUpdate={saveMobileExpenseUpdate}
          onExpenseDelete={removeExpense}
          onBudgetSave={(amount) => {
            const nextBudget = roundMoney(amount);
            const prevBudget = Number(budgets[selectedMonth] || 0);
            if (nextBudget !== prevBudget) {
              try {
                localStorage.removeItem(BUDGET_ALERT_KEY_PREFIX + selectedMonth);
              } catch {}
            }
            setRecordDeleted("budgets", selectedMonth, false);
            setBudgetUpdatedAt((current) => ({
              ...current,
              [selectedMonth]: Date.now(),
            }));
            setBudgets((current) => ({
              ...current,
              [selectedMonth]: nextBudget,
            }));
            return true;
          }}
          onBudgetClear={clearBudget}
          onTransactionSave={saveMobileTransaction}
          onTransactionUpdate={saveMobileTransactionUpdate}
          onTransactionDelete={removeMobileTransaction}
          onAddCard={handleAddCard}
          onUpdateCard={handleUpdateCard}
          onDeleteCard={handleDeleteCard}
          onSetPrimaryCard={handleSetPrimaryCard}
          onMoveCardToFront={handleMoveCardToFront}
          onToggleRec={toggleMobileRecurring}
          onUpdateRec={saveMobileRecurringUpdate}
          onRemoveRec={removeMobileRecurring}
          onTheme={(nextMode) =>
            setTheme((current) =>
              typeof nextMode === "string" &&
              ["auto", "light", "dark"].includes(nextMode)
                ? nextMode
                : current === "dark"
                  ? "light"
                  : "dark",
            )
          }
          onReminder={updateReminderTime}
          profile={{
            name: pushUser
              ? localProfileName || userDisplayName(pushUser)
              : localProfileName || "Local profile",
            email: pushUser?.email || "",
            initial: pushUser
              ? profileInitial(localProfileName || userDisplayName(pushUser))
              : profileInitial(localProfileName || "Local profile"),
            avatar: profileAvatar || userAvatarUrl(pushUser) || "",
            connected: Boolean(pushUser),
            hasName: Boolean(pushUser || localProfileName),
          }}
          onEditProfile={openProfileEditor}
          onAvatarChange={saveProfileAvatar}
          profileStatus={profileStatus}
          cloudSyncEnabled={cloudSyncEnabled}
          cloudSyncReady={cloudSyncReady}
          normalizedAccountSync={normalizedAccountSync}
          cloudRealtimeStatus={cloudRealtimeStatus}
          cloudSyncActivity={cloudSyncActivity}
          pushBackendConfigured={pushBackendConfigured}
          notificationPermission={notificationPermission}
          notificationStatus={notificationStatus}
          backgroundPushEnabled={backgroundPushEnabled}
          onToggleNotifications={toggleNotifications}
          onTestNotification={handleTestNotification}
          backupStatus={backupStatus}
          onBackupDownload={downloadBackup}
          onEncryptedBackupDownload={downloadEncryptedBackup}
          onExpensesCsv={exportAllExpensesCsv}
          onBackupRestore={() => backupFileInputRef.current?.click()}
          onSignOut={signOutOfPush}
          onResumeSync={handleResumeSync}
          accountStatus={cloudSyncStatus || authStatus}
          authBusy={authBusy}
          onSignIn={openSignInModal}
        />
      </Suspense>
      {authModalOpen &&
        (!pushUser || authMode === "update-password" || authModalClosing) &&
        createPortal(
          <div
            className={`auth-modal-backdrop${authModalClosing ? " is-closing" : ""}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !authBusy) {
                hideAuthModal();
                setShowAuthPassword(false);
              }
            }}
          >
            <section
              className={`auth-modal${authModalClosing ? " is-closing" : ""}`}
              ref={authModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-modal-title"
              onKeyDown={trapAuthModalFocus}
            >
              <div className="auth-modal-top">
                <div className="auth-modal-logo" aria-hidden="true">
                  <svg viewBox="0 0 44 44" width="44" height="44" fill="none">
                    <rect width="44" height="44" rx="12" fill="#2D6B50" />
                    <path
                      d="M15 29 29 15M19 15h10v10"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <button
                  className="auth-modal-close"
                  type="button"
                  aria-label="Close sign-in dialog"
                  disabled={authBusy}
                  onClick={() => {
                    hideAuthModal();
                    setShowAuthPassword(false);
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="auth-modal-heading">
                <h2 id="auth-modal-title">
                  {authMode === "sign-up"
                    ? "Create your account"
                    : authMode === "forgot-password"
                      ? "Reset your password"
                      : authMode === "update-password"
                        ? "Choose a new password"
                        : "Sign in to Spend"}
                </h2>
                <p>
                  {!supabaseConfigured
                    ? "Sign-in is not configured in this version. Your expenses remain available on this device."
                    : authMode === "forgot-password"
                      ? "We’ll email you a secure password reset link."
                      : authMode === "update-password"
                        ? "Choose a new password for your Spend account."
                        : "Use your account for automatic cloud sync."}
                </p>
              </div>

              {supabaseConfigured ? (
                <>
                  <form className="auth-modal-form" onSubmit={handleAuthSubmit}>
                    <div className="auth-modal-fields">
                      <div className="auth-input-group">
                        <label htmlFor="push-email">Email</label>
                        <input
                          id="push-email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          required
                          placeholder="you@example.com"
                          value={authEmail}
                          onChange={(event) => setAuthEmail(event.target.value)}
                        />
                      </div>
                      {authMode !== "forgot-password" && (
                        <div className="auth-input-group">
                          <label htmlFor="push-password">
                            {authMode === "update-password"
                              ? "New password"
                              : "Password"}
                          </label>
                          <div className="auth-password-control">
                            <input
                              id="push-password"
                              type={showAuthPassword ? "text" : "password"}
                              autoComplete={
                                authMode === "sign-up" ||
                                authMode === "update-password"
                                  ? "new-password"
                                  : "current-password"
                              }
                              minLength="6"
                              required
                              placeholder="Password"
                              value={authPassword}
                              onChange={(event) =>
                                setAuthPassword(event.target.value)
                              }
                            />
                            <button
                              className="auth-password-toggle"
                              type="button"
                              aria-label={
                                showAuthPassword
                                  ? "Hide password"
                                  : "Show password"
                              }
                              aria-pressed={showAuthPassword}
                              aria-controls="push-password"
                              onClick={() =>
                                setShowAuthPassword((visible) => !visible)
                              }
                            >
                              <PasswordVisibilityIcon
                                visible={showAuthPassword}
                              />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {authMode === "sign-in" && (
                      <div className="auth-forgot-row">
                        <button
                          className="auth-forgot-password"
                          type="button"
                          disabled={authBusy}
                          onClick={() => {
                            setAuthMode("forgot-password");
                            setAuthStatus("");
                            setAuthPassword("");
                          }}
                        >
                          Forgot password?
                        </button>
                      </div>
                    )}

                    <div className="auth-modal-submit-wrap">
                      <button
                        type="submit"
                        className="auth-modal-submit-btn"
                        disabled={authBusy}
                      >
                        {authBusy
                          ? "Please wait…"
                          : authMode === "forgot-password"
                            ? "Send reset link"
                            : authMode === "update-password"
                              ? "Update password"
                              : authMode === "sign-up"
                                ? "Create account"
                                : "Sign in"}
                      </button>
                    </div>
                  </form>

                  {authStatus && (
                    <p
                      className="auth-modal-status"
                      role="status"
                      aria-live="polite"
                    >
                      {authStatus}
                    </p>
                  )}

                  {authMode !== "update-password" && (
                    <div className="auth-modal-footer">
                      {authMode === "sign-in" ? (
                        <>
                          <span>New here? </span>
                          <button
                            className="auth-switch-mode-btn"
                            type="button"
                            disabled={authBusy}
                            onClick={() => {
                              setAuthMode("sign-up");
                              setAuthStatus("");
                              setAuthPassword("");
                            }}
                          >
                            Create an account
                          </button>
                        </>
                      ) : authMode === "sign-up" ? (
                        <>
                          <span>Already have an account? </span>
                          <button
                            className="auth-switch-mode-btn"
                            type="button"
                            disabled={authBusy}
                            onClick={() => {
                              setAuthMode("sign-in");
                              setAuthStatus("");
                              setAuthPassword("");
                            }}
                          >
                            Sign in
                          </button>
                        </>
                      ) : (
                        <>
                          <span>Remember your password? </span>
                          <button
                            className="auth-switch-mode-btn"
                            type="button"
                            disabled={authBusy}
                            onClick={() => {
                              setAuthMode("sign-in");
                              setAuthStatus("");
                              setAuthPassword("");
                            }}
                          >
                            Sign in
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="auth-unavailable" role="status">
                  You can keep using Spend locally. Connect an account service
                  to enable sign-in and cloud sync.
                </p>
              )}
            </section>
          </div>,
          document.body,
        )}
      {profileEditorOpen &&
        createPortal(
          <div
            className={`profile-editor-backdrop${profileEditorClosing ? " is-closing" : ""}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !profileSaving)
                hideProfileEditor();
            }}
          >
            <section
              className={`profile-editor${profileEditorClosing ? " is-closing" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-editor-title"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !profileSaving) {
                  hideProfileEditor();
                  return;
                }
                if (event.key !== "Tab") return;
                const focusable = event.currentTarget.querySelectorAll(
                  "button:not([disabled]), input:not([disabled])",
                );
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              <div className="profile-editor-heading">
                <div>
                  <span>PROFILE</span>
                  <h2 id="profile-editor-title">Edit your profile</h2>
                </div>
                <button
                  className="profile-editor-close"
                  type="button"
                  aria-label="Close profile editor"
                  disabled={profileSaving}
                  onClick={hideProfileEditor}
                >
                  ×
                </button>
              </div>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (await saveProfileName(profileDraft)) hideProfileEditor();
                }}
              >
                <label htmlFor="profile-display-name">Display name</label>
                <input
                  id="profile-display-name"
                  type="text"
                  autoComplete="name"
                  autoFocus
                  maxLength={48}
                  required
                  placeholder="Your name"
                  value={profileDraft}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => setProfileDraft(event.target.value)}
                />
                <p className="profile-editor-hint">
                  This name appears in your greeting and profile avatar.
                </p>
                {profileStatus && (
                  <p
                    className={`profile-editor-status${
                      profileStatus.startsWith("Could not") ||
                      profileStatus.startsWith("Enter ")
                        ? " is-error"
                        : ""
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {profileStatus}
                  </p>
                )}
                <div className="profile-editor-actions">
                  <button
                    className="profile-editor-cancel"
                    type="button"
                    disabled={profileSaving}
                    onClick={hideProfileEditor}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={profileSaving}>
                    {profileSaving ? "Saving…" : "Save name"}
                  </button>
                </div>
              </form>
            </section>
          </div>,
          document.body,
        )}
      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={restoreBackup}
      />
    </>
  );
}
