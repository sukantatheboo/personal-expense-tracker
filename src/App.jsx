import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MobilePrototype from "./MobilePrototype";
import {
  CATEGORIES,
  CURRENCIES,
  emptyAccountData,
  PRIMARY_CURRENCY,
  STORAGE_KEYS,
  calculateAccountBalance,
  currentMonth,
  formatCurrency,
  formatDate,
  formatMonth,
  isAccountId,
  isValidDateString,
  loadAccountData,
  loadBudgets,
  loadExpenses,
  loadRecurringSchedules,
  localDate,
  makeId,
  nextOccurrenceDate,
  roundMoney,
  writeStorage,
} from "./data.js";
import {
  disableBackgroundPush,
  enableBackgroundPush,
  pushBackendConfigured,
  supabase,
  supabaseConfigured,
  syncBackgroundSchedules,
} from "./push.js";

import {
  CLOUD_SYNC_USER_KEY,
  loadCloudData,
  saveCloudData,
  subscribeToCloudChanges,
} from "./cloud-sync.js";

const CURRENCY_API = "https://api.frankfurter.dev/v2";
const LOCAL_DATA_OWNER_KEY = "spend-local-data-owner-v1";
const LOCAL_USER_SNAPSHOTS_KEY = "spend-local-user-snapshots-v1";
const BUDGET_UPDATED_AT_KEY = STORAGE_KEYS.budgetUpdatedAt;
const LAST_BACKUP_AT_KEY = "spend-last-backup-at-v1";

function loadTheme() {
  try {
    return localStorage.getItem(STORAGE_KEYS.theme) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
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

function loadLastBackupAt() {
  try {
    const value = localStorage.getItem(LAST_BACKUP_AT_KEY);
    return value && Number.isFinite(Date.parse(value)) ? value : "";
  } catch {
    return "";
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

function capitalizeFirst(value) {
  const characters = Array.from(String(value ?? "").trim());
  if (!characters.length) return "";
  characters[0] = characters[0].toLocaleUpperCase();
  return characters.join("");
}

function accountName(accountId) {
  return accountId === "bkash" ? "bKash" : "Bank";
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

function formatCompactMonth(monthValue) {
  const [year, month] = (monthValue || currentMonth()).split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function makeExpenseForm() {
  return {
    description: "",
    amount: "",
    category: "Other",
    date: localDate(),
    interval: "none",
    account: "",
  };
}

function makeTransactionForm() {
  return {
    type: "income",
    amount: "",
    date: localDate(),
    note: "",
    account: "bkash",
    direction: "increase",
    fromAccount: "bkash",
    toAccount: "bank",
  };
}

function accountActivityLabel(activity) {
  if (activity.type === "expense")
    return `Expense · ${accountName(activity.account)}`;
  if (activity.type === "income")
    return `Income · ${accountName(activity.account)}`;
  if (activity.type === "adjustment")
    return `${activity.direction === "increase" ? "Balance increased" : "Balance decreased"} · ${accountName(activity.account)}`;
  return `Transfer · ${accountName(activity.fromAccount)} → ${accountName(activity.toAccount)}`;
}

function accountActivityPrefix(activity) {
  if (activity.type === "income") return "+";
  if (activity.type === "adjustment")
    return activity.direction === "increase" ? "+" : "−";
  return activity.type === "expense" ? "−" : "";
}

function emptyDeletedRecords() {
  return {
    expenses: {},
    budgets: {},
    recurringSchedules: {},
    accountTransactions: {},
  };
}

function normalizeDeletedRecords(value) {
  const cleanChanges = (changes) => {
    if (Array.isArray(changes))
      return Object.fromEntries(
        [...new Set(changes.filter((id) => typeof id === "string" && id))].map(
          (id) => [id, { deleted: true, updatedAt: 0 }],
        ),
      );
    if (!changes || typeof changes !== "object") return {};
    return Object.fromEntries(
      Object.entries(changes).flatMap(([id, change]) =>
        typeof id === "string" &&
        id &&
        change &&
        typeof change === "object" &&
        typeof change.deleted === "boolean"
          ? [
              [
                id,
                {
                  deleted: change.deleted,
                  updatedAt: Number.isFinite(Number(change.updatedAt))
                    ? Number(change.updatedAt)
                    : 0,
                },
              ],
            ]
          : [],
      ),
    );
  };
  return {
    expenses: cleanChanges(value?.expenses),
    budgets: cleanChanges(value?.budgets),
    recurringSchedules: cleanChanges(value?.recurringSchedules),
    accountTransactions: cleanChanges(value?.accountTransactions),
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
    data.accountData.settings.configured ||
    data.accountData.settings.balances.bkash !== 0 ||
    data.accountData.settings.balances.bank !== 0 ||
    Object.values(normalizeDeletedRecords(data.deletedRecords)).some(
      (changes) => Object.keys(changes).length > 0,
    ) ||
    (isValidReminderTime(data.reminderTime) && data.reminderTime !== "09:00")
  );
}

function hasMeaningfulAccountSettings(settings) {
  return (
    settings.configured ||
    settings.balances.bkash !== 0 ||
    settings.balances.bank !== 0
  );
}

function areAccountSettingsEqual(left, right) {
  return Boolean(
    left &&
    right &&
    left.startDate === right.startDate &&
    left.balances.bkash === right.balances.bkash &&
    left.balances.bank === right.balances.bank &&
    left.configured === right.configured,
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

function getCloudSyncLabels({
  signedIn,
  enabled,
  ready,
  normalized,
  realtimeStatus,
  activity,
}) {
  if (!signedIn) {
    return {
      long: "Local only",
      short: "Local",
      accessible: "Expense data stays on this device",
    };
  }
  if (!enabled) {
    return {
      long: "Cloud sync paused",
      short: "Paused",
      accessible: "Expense cloud sync is paused",
    };
  }
  if (activity === "error") {
    return {
      long: "Sync issue",
      short: "Issue",
      accessible: "Cloud sync needs attention",
    };
  }
  if (realtimeStatus === "offline" || activity === "offline") {
    return {
      long: "Offline",
      short: "Offline",
      accessible: "Cloud sync is offline",
    };
  }
  if (!ready || activity === "syncing") {
    return {
      long: "Syncing…",
      short: "Syncing",
      accessible: "Cloud data is syncing",
    };
  }
  if (!normalized) {
    return {
      long: "Setup needed",
      short: "Setup",
      accessible: "Apply the latest Supabase migration to enable live sync",
    };
  }
  if (realtimeStatus === "live") {
    return {
      long: "Live sync",
      short: "Live",
      accessible: "Live cloud sync is connected",
    };
  }
  if (realtimeStatus === "reconnecting") {
    return {
      long: "Reconnecting",
      short: "Connecting",
      accessible: "Cloud sync is reconnecting",
    };
  }
  return {
    long: "Cloud sync",
    short: "Cloud",
    accessible: "Cloud sync is on",
  };
}

function hasMeaningfulLocalAccountSettings(data) {
  return hasMeaningfulAccountSettings(data.accountData.settings);
}

function mergeCloudSnapshots(
  local,
  cloud,
  preferLocal,
  preferLocalAccountSettings = preferLocal,
) {
  if (!cloud) return local;

  const cloudExpenses = loadExpenses(cloud.expenses ?? []);
  const cloudBudgets = loadBudgets(cloud.budgets ?? {});
  const cloudSchedules = loadRecurringSchedules(cloud.recurringSchedules ?? []);
  const cloudAccounts = loadAccountData(
    cloud.accountData ?? emptyAccountData(),
  );
  const deletedRecords = mergeDeletedRecords(
    cloud.deletedRecords,
    local.deletedRecords,
  );
  const budgetData = mergeBudgetValues(
    cloudBudgets,
    preferLocal ? local.budgets : {},
    normalizeBudgetUpdatedAt(cloud.budgetUpdatedAt),
    normalizeBudgetUpdatedAt(preferLocal ? local.budgetUpdatedAt : {}),
    deletedRecords.budgets,
    Boolean(preferLocal),
  );
  if (!preferLocal) {
    return {
      expenses: mergeExpenseRecords(
        cloudExpenses,
        [],
        deletedRecords.expenses,
        false,
      ),
      budgets: budgetData.budgets,
      budgetUpdatedAt: budgetData.updatedAt,
      recurringSchedules: mergeRecords(
        cloudSchedules,
        [],
        deletedRecords.recurringSchedules,
        false,
      ),
      accountData: {
        ...cloudAccounts,
        transactions: mergeRecords(
          cloudAccounts.transactions,
          [],
          deletedRecords.accountTransactions,
          false,
        ),
      },
      deletedRecords,
      theme: cloud.theme === "dark" ? "dark" : "light",
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
    };
  }

  return {
    expenses: mergeExpenseRecords(
      cloudExpenses,
      local.expenses,
      deletedRecords.expenses,
    ),
    budgets: budgetData.budgets,
    budgetUpdatedAt: budgetData.updatedAt,
    recurringSchedules: mergeRecords(
      cloudSchedules,
      local.recurringSchedules,
      deletedRecords.recurringSchedules,
    ),
    accountData: {
      settings:
        preferLocalAccountSettings &&
        hasMeaningfulLocalAccountSettings(local) &&
        preferLocalRecord(
          local.accountData.settings,
          cloudAccounts.settings,
          true,
        )
          ? local.accountData.settings
          : cloudAccounts.settings,
      transactions: mergeRecords(
        cloudAccounts.transactions,
        local.accountData.transactions,
        deletedRecords.accountTransactions,
      ),
    },
    deletedRecords,
    theme: local.theme,
    targetCurrency: local.targetCurrency,
    reminderTime:
      isValidReminderTime(local.reminderTime) && local.reminderTime !== "09:00"
        ? local.reminderTime
        : isValidReminderTime(cloud.reminderTime)
          ? cloud.reminderTime
          : isValidReminderTime(local.reminderTime)
            ? local.reminderTime
            : "09:00",
  };
}

function loadBudgetUpdatedAt() {
  try {
    return normalizeBudgetUpdatedAt(
      JSON.parse(localStorage.getItem(BUDGET_UPDATED_AT_KEY) || "{}"),
    );
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

function clearSharedFinancialData() {
  for (const key of [
    STORAGE_KEYS.expenses,
    STORAGE_KEYS.budgets,
    BUDGET_UPDATED_AT_KEY,
    STORAGE_KEYS.recurring,
    STORAGE_KEYS.accounts,
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // The app state is still cleared for this visit.
    }
  }
}

function readLocalUserSnapshots() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(LOCAL_USER_SNAPSHOTS_KEY) || "{}",
    );
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};
  } catch {
    return {};
  }
}

function loadLocalUserSnapshot(userId) {
  const snapshot = readLocalUserSnapshots()[userId];
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    expenses: loadExpenses(snapshot.expenses ?? []),
    budgets: loadBudgets(snapshot.budgets ?? {}),
    budgetUpdatedAt: normalizeBudgetUpdatedAt(snapshot.budgetUpdatedAt),
    recurringSchedules: loadRecurringSchedules(
      snapshot.recurringSchedules ?? [],
    ),
    accountData: loadAccountData(snapshot.accountData ?? emptyAccountData()),
    deletedRecords: normalizeDeletedRecords(snapshot.deletedRecords),
    theme: snapshot.theme === "dark" ? "dark" : "light",
    targetCurrency:
      typeof snapshot.targetCurrency === "string" &&
      /^[A-Z]{3}$/.test(snapshot.targetCurrency)
        ? snapshot.targetCurrency
        : "USD",
    reminderTime: isValidReminderTime(snapshot.reminderTime)
      ? snapshot.reminderTime
      : "09:00",
  };
}

function saveLocalUserSnapshot(userId, snapshot) {
  try {
    const snapshots = readLocalUserSnapshots();
    snapshots[userId] = snapshot;
    localStorage.setItem(LOCAL_USER_SNAPSHOTS_KEY, JSON.stringify(snapshots));
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

  useEffect(
    () => () => window.clearTimeout(closeTimerRef.current),
    [],
  );

  return { isOpen, isClosing, open, close };
}

export default function App() {
  const [expenses, setExpenses] = useState(loadExpenses);
  const [budgets, setBudgets] = useState(loadBudgets);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState(loadBudgetUpdatedAt);
  const [recurringSchedules, setRecurringSchedules] = useState(
    loadRecurringSchedules,
  );
  const [accountData, setAccountData] = useState(loadAccountData);
  const [deletedRecords, setDeletedRecords] = useState(() => {
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return normalizeDeletedRecords(snapshot?.deletedRecords);
  });
  const [theme, setTheme] = useState(loadTheme);
  const [targetCurrency, setTargetCurrency] = useState(loadCurrency);
  const [reminderTime, setReminderTime] = useState(loadReminderTime);
  const [localProfileName] = useState(loadLocalProfileName);
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
  const [mobileView, setMobileView] = useState("home");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState(makeExpenseForm);
  const [expenseMessage, setExpenseMessage] = useState("");
  const [transactionForm, setTransactionForm] = useState(makeTransactionForm);
  const [startingBalances, setStartingBalances] = useState(() => {
    const { settings } = loadAccountData();
    return {
      bkash: String(settings.balances.bkash),
      bank: String(settings.balances.bank),
      date: settings.startDate,
    };
  });
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetEditingMonth, setBudgetEditingMonth] = useState(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [conversionOpen, setConversionOpen] = useState(false);
  const [currencyOptions, setCurrencyOptions] = useState(
    CURRENCIES.map(([iso_code, name]) => ({ iso_code, name })),
  );
  const [conversionRate, setConversionRate] = useState(null);
  const [conversionStatus, setConversionStatus] = useState(
    "Choose a currency to see an estimate.",
  );
  const [conversionFailed, setConversionFailed] = useState(false);
  const [recurringReminder, setRecurringReminder] = useState("");
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
  const [undoAction, setUndoAction] = useState(null);
  const [cloudSyncRetry, setCloudSyncRetry] = useState(0);
  const [accountRefreshBusy, setAccountRefreshBusy] = useState(false);
  const [accountRefreshStatus, setAccountRefreshStatus] = useState("");
  const [recurringRefreshBusy, setRecurringRefreshBusy] = useState(false);
  const [recurringRefreshStatus, setRecurringRefreshStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [lastBackupAt, setLastBackupAt] = useState(loadLastBackupAt);
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
  const undoTimerRef = useRef(null);
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
    setTheme("light");
    setTargetCurrency("USD");
    setReminderTime("09:00");
    setStartingBalances({
      bkash: "0",
      bank: "0",
      date: empty.settings.startDate,
    });
    setExpenseForm(makeExpenseForm());
    setTransactionForm(makeTransactionForm());
    setBudgetAmount("");
    setQuery("");
    setCategoryFilter("");
    setEditingExpenseId(null);
    setEditingAmount("");
    setRecurringReminder("");
    setCloudSyncStatus("");
    setAccountRefreshStatus("");
    setRecurringRefreshStatus("");
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
      applyCloudSnapshot(snapshot);
      setStartingBalances({
        bkash: String(snapshot.accountData.settings.balances.bkash),
        bank: String(snapshot.accountData.settings.balances.bank),
        date: snapshot.accountData.settings.startDate,
      });
    } else {
      resetDataForNewUser();
    }
  }

  function selectLocalDataForUser(userId) {
    const hasSavedSnapshot = Boolean(loadLocalUserSnapshot(userId));
    if (localDataOwnerRef.current || hasSavedSnapshot) {
      switchLocalUser(userId);
    } else {
      adoptLocalDataForUser(userId);
    }
  }

  function queueCloudSnapshotSave(userId) {
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
            savedVersion = await saveCloudData(
              userId,
              snapshot,
              cloudVersionRef.current,
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
    document.documentElement.dataset.theme = theme;
    const browserChromeColor = theme === "dark" ? "#0e1411" : "#f4f3ee";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", browserChromeColor));
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Keep the selected theme for this visit when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.expenses, expenses);
  }, [expenses]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.budgets, budgets);
  }, [budgets]);
  useEffect(() => {
    writeStorage(BUDGET_UPDATED_AT_KEY, budgetUpdatedAt);
  }, [budgetUpdatedAt]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.recurring, recurringSchedules);
  }, [recurringSchedules]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.accounts, accountData);
  }, [accountData]);
  useEffect(() => {
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
    pushUser?.id,
  ]);
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
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setAuthStatus(`Could not restore sign-in: ${error.message}`);
        return;
      }
      if (active) {
        const user = data.session?.user || null;
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
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      const previousUserId = authUserIdRef.current || localDataOwnerRef.current;
      setPushUser(user);
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
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !pushUser || !cloudSyncEnabled) {
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
          const localBelongsToUser =
            !localDataOwnerRef.current ||
            localDataOwnerRef.current === pushUser.id;
          const preferLocal =
            localBelongsToUser && hasMeaningfulLocalData(local);
          const cloudAccountSettings = loadAccountData(
            remote?.data?.accountData ?? emptyAccountData(),
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
            savedVersion = await saveCloudData(
              pushUser.id,
              merged,
              remote?.updated_at ?? null,
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
          setCloudSyncEnabled(false);
          setCloudSyncReady(false);
          setCloudSyncActivity("error");
          setCloudRealtimeStatus("disconnected");
          try {
            localStorage.removeItem(CLOUD_SYNC_USER_KEY);
          } catch {
            setCloudSyncStatus(
              `Could not start cloud sync: ${error.message}. This browser could not clear its sync preference.`,
            );
            return;
          }
          setCloudSyncStatus(`Could not start cloud sync: ${error.message}`);
        }
      }
    }

    initializeCloudSync();
    return () => {
      active = false;
    };
  }, [cloudSyncEnabled, pushUser?.id]);

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
      window.clearTimeout(liveChangeTimerRef.current);
      setCloudSyncActivity("syncing");
      liveChangeTimerRef.current = window.setTimeout(async () => {
        try {
          if (!active || authUserIdRef.current !== pushUser.id) return;
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
      if (document.visibilityState === "visible") handleCloudChange();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!navigator.onLine) handleOffline();

    return () => {
      active = false;
      window.clearTimeout(liveChangeTimerRef.current);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
    };
  }, [cloudSyncEnabled, cloudSyncReady, normalizedAccountSync, pushUser?.id]);

  useEffect(() => {
    if (!supabase || !pushUser || !cloudSyncEnabled || !cloudSyncReady)
      return undefined;
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
    if (!supabase || !pushUser || !backgroundPushEnabled) return undefined;
    let active = true;
    async function syncSchedules() {
      if (!active) return;
      try {
        await syncBackgroundSchedules(
          pushUser.id,
          recurringSchedules,
          reminderTime,
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
  }, [backgroundPushEnabled, pushUser, recurringSchedules, reminderTime]);

  useEffect(() => {
    if (!pushUser || !("serviceWorker" in navigator)) return undefined;
    let active = true;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) =>
        registration ? registration.pushManager.getSubscription() : null,
      )
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
  }, [pushUser]);

  useEffect(() => {
    const { settings } = accountData;
    setStartingBalances({
      bkash: String(settings.balances.bkash),
      bank: String(settings.balances.bank),
      date: settings.startDate,
    });
  }, [accountData.settings]);

  useEffect(() => {
    const budget = Number(budgets[selectedMonth] || 0);
    setBudgetAmount(budget > 0 ? String(budget) : "");
  }, [budgets, selectedMonth]);

  const monthExpenses = useMemo(
    () =>
      expenses.filter((expense) => expense.date.slice(0, 7) === selectedMonth),
    [expenses, selectedMonth],
  );
  const monthlyTotal = useMemo(
    () =>
      monthExpenses.reduce(
        (sum, expense) =>
          sum + (expense.amount === null ? 0 : Number(expense.amount)),
        0,
      ),
    [monthExpenses],
  );
  const previousMonth = useMemo(
    () => shiftMonth(selectedMonth, -1),
    [selectedMonth],
  );
  const previousMonthTotal = useMemo(
    () =>
      expenses
        .filter((expense) => expense.date.slice(0, 7) === previousMonth)
        .reduce(
          (sum, expense) =>
            sum + (expense.amount === null ? 0 : Number(expense.amount)),
          0,
        ),
    [expenses, previousMonth],
  );
  const topCategory = useMemo(() => {
    const totals = monthExpenses.reduce((map, expense) => {
      if (expense.amount !== null) {
        map[expense.category] =
          (map[expense.category] || 0) + Number(expense.amount);
      }
      return map;
    }, {});
    return Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || null;
  }, [monthExpenses]);
  const categoryBreakdown = useMemo(() => {
    const totals = monthExpenses.reduce((map, expense) => {
      if (expense.amount !== null) {
        map[expense.category] =
          (map[expense.category] || 0) + Number(expense.amount);
      }
      return map;
    }, {});
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [monthExpenses]);
  const nextRecurring = useMemo(
    () =>
      recurringSchedules
        .filter(
          (schedule) => schedule.active && schedule.nextDate >= localDate(),
        )
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0] || null,
    [recurringSchedules],
  );
  const activeRecurringCount = useMemo(
    () => recurringSchedules.filter((schedule) => schedule.active).length,
    [recurringSchedules],
  );
  const monthlyRecurringTotal = useMemo(
    () =>
      recurringSchedules
        .filter((schedule) => schedule.active)
        .reduce(
          (total, schedule) =>
            total +
            Number(schedule.amount) *
              (schedule.interval === "weekly" ? 52 / 12 : 1),
          0,
        ),
    [recurringSchedules],
  );
  const orderedRecurringSchedules = useMemo(
    () =>
      [...recurringSchedules].sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          a.nextDate.localeCompare(b.nextDate),
      ),
    [recurringSchedules],
  );
  const visibleExpenses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return monthExpenses
      .filter(
        (expense) => !categoryFilter || expense.category === categoryFilter,
      )
      .filter(
        (expense) =>
          !normalizedQuery ||
          `${expense.description} ${expense.category}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [monthExpenses, categoryFilter, query]);
  const recentExpenses = useMemo(
    () =>
      [...monthExpenses]
        .sort(
          (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
        )
        .slice(0, 3),
    [monthExpenses],
  );
  const accountBalances = useMemo(
    () => ({
      bkash: calculateAccountBalance("bkash", expenses, accountData),
      bank: calculateAccountBalance("bank", expenses, accountData),
    }),
    [expenses, accountData],
  );
  const accountActivity = useMemo(() => {
    const expenseActivity = expenses
      .filter(
        (expense) =>
          isAccountId(expense.account) &&
          expense.amount !== null &&
          expense.date >= accountData.settings.startDate,
      )
      .map((expense) => ({ ...expense, type: "expense" }));
    const trackedTransactions = accountData.transactions.filter(
      (transaction) => transaction.date >= accountData.settings.startDate,
    );
    return [...trackedTransactions, ...expenseActivity]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 8);
  }, [expenses, accountData]);

  const mobilePrototypeData = {
    m: selectedMonth,
    theme,
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
      desc: schedule.description,
      amt: schedule.amount,
      cat: schedule.category,
      iv: schedule.interval,
      next: schedule.nextDate,
      on: schedule.active ? 1 : 0,
      acct: schedule.account,
    })),
    start: {
      ...accountData.settings.balances,
      date: accountData.settings.startDate,
    },
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

  const monthBudget = Number(budgets[selectedMonth] || 0);
  const budgetEditorOpen =
    monthBudget <= 0 || budgetEditingMonth === selectedMonth;
  const budgetPercentage =
    monthBudget > 0 ? (monthlyTotal / monthBudget) * 100 : 0;
  const budgetProgress = Math.min(100, Math.max(0, budgetPercentage));
  const conversionReady = conversionOpen && conversionRate !== null;

  function notifyDueExpenses(dueExpenses) {
    if (!dueExpenses.length) return;
    pendingDueRef.current.push(...dueExpenses);
    const details = dueExpenses
      .map((expense) => `${expense.description} (${formatDate(expense.date)})`)
      .join(", ");
    setRecurringReminder(
      dueExpenses.length === 1
        ? dueExpenses[0].date === localDate()
          ? `${dueExpenses[0].description} is due today and was added to your expenses.`
          : `${dueExpenses[0].description} was overdue and was added to your expenses.`
        : `Recurring expenses due today or earlier were added: ${details}.`,
    );
    if (notificationPermission === "granted")
      sendSystemNotification(dueExpenses);
  }

  function sendSystemNotification(dueExpenses) {
    if (
      !("Notification" in window) ||
      window.Notification.permission !== "granted"
    )
      return;
    const details = dueExpenses
      .map((expense) => `${expense.description} (${formatDate(expense.date)})`)
      .join(", ");
    const title =
      dueExpenses.length === 1
        ? "Recurring expense due"
        : "Recurring expenses due";
    const options = { body: details };
    const displayNotification =
      "serviceWorker" in navigator
        ? navigator.serviceWorker
            .getRegistration()
            .then((registration) =>
              registration
                ? registration.showNotification(title, options)
                : new window.Notification(title, options),
            )
        : Promise.resolve(new window.Notification(title, options));
    displayNotification
      .then(() => {
        pendingDueRef.current = pendingDueRef.current.filter(
          (pending) => !dueExpenses.includes(pending),
        );
      })
      .catch((error) => {
        setNotificationStatus(
          `Could not show a system notification: ${error.message}`,
        );
      });
  }

  const processDueSchedules = useRef(null);
  processDueSchedules.current = () => {
    const today = localDate();
    if (lastRecurringCheckRef.current === today) return;
    lastRecurringCheckRef.current = today;
    const nextExpenses = [...expenses];
    let expensesChanged = false;
    let schedulesChanged = false;
    const dueExpenses = [];
    const nextSchedules = recurringSchedules.map((schedule) => {
      if (!schedule.active) return schedule;
      let nextDate = schedule.nextDate;
      let generated = 0;
      while (nextDate <= today && generated < 240) {
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
          nextExpenses.push({
            id: makeId(),
            createdAt,
            updatedAt: createdAt,
            description: schedule.description,
            amount: Number(schedule.amount),
            category: schedule.category,
            date: nextDate,
            account: isAccountId(schedule.account) ? schedule.account : "",
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
    processDueSchedules.current?.();
    const timer = window.setInterval(
      () => processDueSchedules.current?.(),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!conversionOpen) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    async function fetchRate() {
      setConversionStatus(
        `Getting the latest available ${targetCurrency} rate…`,
      );
      setConversionFailed(false);
      setConversionRate(null);
      try {
        const currenciesResponse = await fetch(`${CURRENCY_API}/currencies`, {
          signal: controller.signal,
        });
        if (currenciesResponse.ok) {
          const values = await currenciesResponse.json();
          if (Array.isArray(values)) {
            const cleanCurrencies = values
              .filter(
                (item) =>
                  item &&
                  /^[A-Z]{3}$/.test(item.iso_code) &&
                  item.iso_code !== PRIMARY_CURRENCY &&
                  typeof item.name === "string",
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            if (cleanCurrencies.length && !cancelled) {
              setCurrencyOptions(cleanCurrencies);
              if (
                !cleanCurrencies.some(
                  (item) => item.iso_code === targetCurrency,
                )
              )
                setTargetCurrency(
                  cleanCurrencies.some((item) => item.iso_code === "USD")
                    ? "USD"
                    : cleanCurrencies[0].iso_code,
                );
            }
          }
        }
        const response = await fetch(
          `${CURRENCY_API}/rate/${PRIMARY_CURRENCY.toLowerCase()}/${targetCurrency.toLowerCase()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Exchange rate request failed");
        const data = await response.json();
        const rate = Number(data.rate);
        if (
          cancelled ||
          data.base !== PRIMARY_CURRENCY ||
          data.quote !== targetCurrency ||
          !Number.isFinite(rate) ||
          rate <= 0 ||
          typeof data.date !== "string"
        )
          throw new Error("Exchange rate response was invalid");
        setConversionRate(rate);
        const rateText = new Intl.NumberFormat(undefined, {
          maximumSignificantDigits: 6,
        }).format(rate);
        setConversionStatus(
          `Rate: 1 BDT = ${rateText} ${targetCurrency}. Rate date: ${data.date}.`,
        );
      } catch (error) {
        if (cancelled || error.name === "AbortError") return;
        setConversionRate(null);
        setConversionFailed(true);
        setConversionStatus(
          `Could not load a ${targetCurrency} rate. Check your connection, then try again.`,
        );
      }
    }
    fetchRate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [conversionOpen, targetCurrency]);

  function saveExpenseData(form, { returnResult = false } = {}) {
    const description = form.description.trim();
    const rawAmount = String(form.amount ?? "").trim();
    const amount = rawAmount === "" ? null : Number(rawAmount);
    if (
      !description ||
      !isValidDateString(form.date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (form.interval !== "none" && amount === null)
    ) {
      setExpenseMessage(
        form.interval !== "none" && amount === null
          ? "Recurring expenses need an amount."
          : "Check the description, amount, and date, then try again.",
      );
      return false;
    }
    setExpenseMessage("");
    let createdExpenseId = null;
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
      setRecurringSchedules((current) => [
        ...current,
        {
          id: scheduleId,
          updatedAt: Date.now(),
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
    setSelectedMonth(form.date.slice(0, 7));
    setExpenseForm(makeExpenseForm());
    return returnResult ? { success: true, expenseId: createdExpenseId } : true;
  }

  function handleExpenseSubmit(event) {
    event.preventDefault();
    if (saveExpenseData(expenseForm)) navigateMobile("activity");
  }

  function saveMobileExpense(form) {
    return saveExpenseData(form, { returnResult: true });
  }

  function saveMobileExpenseUpdate(expenseId, form) {
    const rawAmount = String(form.amount ?? "").trim();
    const amount = rawAmount === "" ? null : Number(rawAmount);
    const existingExpense = expenses.find((expense) => expense.id === expenseId);
    const date = existingExpense?.recurringId ? existingExpense.date : form.date;
    if (
      !form.description.trim() ||
      !isValidDateString(date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0))
    ) return false;
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
    setSelectedMonth(date.slice(0, 7));
    return true;
  }

  function handleOpeningBalancesSubmit(event) {
    event.preventDefault();
    const bkash = Number(startingBalances.bkash);
    const bank = Number(startingBalances.bank);
    if (
      !Number.isFinite(bkash) ||
      bkash < 0 ||
      !Number.isFinite(bank) ||
      bank < 0 ||
      !isValidDateString(startingBalances.date)
    )
      return;
    setAccountData((current) => ({
      ...current,
      settings: {
        startDate: startingBalances.date,
        updatedAt: Date.now(),
        balances: { bkash: roundMoney(bkash), bank: roundMoney(bank) },
        configured: true,
      },
    }));
  }

  function handleAccountTransactionSubmit(event) {
    event.preventDefault();
    const amount = Number(transactionForm.amount);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !isValidDateString(transactionForm.date)
    )
      return;
    const createdAt = Date.now();
    const transaction = {
      id: makeId(),
      createdAt,
      updatedAt: createdAt,
      type: transactionForm.type,
      amount: roundMoney(amount),
      date: transactionForm.date,
      description: transactionForm.note.trim(),
    };
    if (transactionForm.type === "income") {
      transaction.account = transactionForm.account;
    } else if (transactionForm.type === "adjustment") {
      transaction.account = transactionForm.account;
      transaction.direction = transactionForm.direction;
    } else if (transactionForm.type === "transfer") {
      transaction.fromAccount = transactionForm.fromAccount;
      transaction.toAccount = transactionForm.toAccount;
      if (transaction.fromAccount === transaction.toAccount) return;
    } else {
      return;
    }
    setAccountData((current) => ({
      ...current,
      transactions: [...current.transactions, transaction],
    }));
    setTransactionForm(makeTransactionForm());
  }

  function changeTransferAccount(field, value) {
    setTransactionForm((current) => {
      const updated = { ...current, [field]: value };
      if (updated.fromAccount === updated.toAccount) {
        if (field === "fromAccount")
          updated.toAccount = value === "bkash" ? "bank" : "bkash";
        else updated.fromAccount = value === "bkash" ? "bank" : "bkash";
      }
      return updated;
    });
  }

  function saveMobileTransaction(form) {
    const amount = Number(form.amt);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const type = form.type === "adjust" ? "adjustment" : form.type;
    const createdAt = Date.now();
    const transaction = {
      id: makeId(),
      createdAt,
      updatedAt: createdAt,
      type,
      amount: roundMoney(amount),
      date: localDate(),
      description: String(form.note ?? "").trim(),
    };
    if (type === "income") {
      transaction.account = form.acct;
    } else if (type === "adjustment") {
      transaction.account = form.acct;
      transaction.direction = form.dir === "up" ? "increase" : "decrease";
    } else if (type === "transfer") {
      transaction.fromAccount = form.acct;
      transaction.toAccount = form.acct === "bank" ? "bkash" : "bank";
    } else {
      return false;
    }
    setAccountData((current) => ({
      ...current,
      transactions: [...current.transactions, transaction],
    }));
    setTransactionForm(makeTransactionForm());
    return { success: true, transactionId: transaction.id };
  }

  function toggleMobileRecurring(scheduleId) {
    setRecurringSchedules((current) =>
      current.map((schedule) => {
        if (schedule.id !== scheduleId) return schedule;
        if (schedule.active)
          return { ...schedule, active: false, updatedAt: Date.now() };
        let nextDate = schedule.nextDate;
        let skipped = 0;
        while (nextDate <= localDate() && skipped < 240) {
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

  function removeMobileRecurring(scheduleId) {
    const schedule = recurringSchedules.find((item) => item.id === scheduleId);
    if (!schedule) return undefined;
    setRecurringSchedules((current) =>
      current.filter((item) => item.id !== scheduleId),
    );
    setRecordDeleted("recurringSchedules", scheduleId, true);
    const restore = () => {
      setRecordDeleted("recurringSchedules", scheduleId, false);
      setRecurringSchedules((current) =>
        current.some((item) => item.id === scheduleId)
          ? current
          : [...current, schedule],
      );
    };
    offerUndo("Recurring expense removed", restore);
    return restore;
  }

  function saveMissingExpenseAmount(event, expense) {
    event.preventDefault();
    const amount = Number(editingAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setExpenses((current) =>
      current.map((item) =>
        item.id === expense.id
          ? { ...item, amount: roundMoney(amount), updatedAt: Date.now() }
          : item,
      ),
    );
    setEditingExpenseId(null);
    setEditingAmount("");
  }

  function setRecordDeleted(collection, id, isDeleted) {
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
    // MobilePrototype passes its display model (desc/amt/cat), while the
    // canonical expense record uses description/amount/category. Always retain
    // the canonical object so Undo cannot restore a display-only projection.
    const expenseId =
      typeof expenseOrId === "object" ? expenseOrId?.id : expenseOrId;
    const expense = expenses.find((item) => item.id === expenseId);
    if (!expense) return undefined;
    setExpenses((current) => current.filter((item) => item.id !== expense.id));
    setExpenseDeleted(expense, true);
    const restore = () => restoreExpense(expense);
    offerUndo("Expense removed", restore);
    return restore;
  }

  function removeAccountActivity(activity) {
    if (activity.type === "expense") {
      const expense = expenses.find((item) => item.id === activity.id);
      if (expense) removeExpense(expense);
    } else {
      setAccountData((current) => ({
        ...current,
        transactions: current.transactions.filter(
          (item) => item.id !== activity.id,
        ),
      }));
      setRecordDeleted("accountTransactions", activity.id, true);
      offerUndo("Account activity removed", () => {
        setRecordDeleted("accountTransactions", activity.id, false);
        setAccountData((current) =>
          current.transactions.some((item) => item.id === activity.id)
            ? current
            : { ...current, transactions: [...current.transactions, activity] },
        );
      });
    }
  }

  function saveBudget(event) {
    event.preventDefault();
    const amount = Number(budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setRecordDeleted("budgets", selectedMonth, false);
    setBudgetUpdatedAt((current) => ({
      ...current,
      [selectedMonth]: Date.now(),
    }));
    setBudgets((current) => ({
      ...current,
      [selectedMonth]: roundMoney(amount),
    }));
    setBudgetEditingMonth(null);
  }

  function clearBudget() {
    const previousBudget = budgets[selectedMonth];
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
      const restore = () => {
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
      offerUndo("Budget cleared", restore);
      return restore;
    }
  }

  function offerUndo(label, undo) {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    setUndoAction({ label, undo });
    undoTimerRef.current = window.setTimeout(() => setUndoAction(null), 6000);
  }

  function undoLastAction() {
    if (!undoAction) return;
    undoAction.undo();
    setUndoAction(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }

  function exportExpenses() {
    if (!visibleExpenses.length) return;
    const data = [
      [
        "Date",
        "Description",
        "Category",
        "Amount (BDT)",
        "Payment account",
        "Type",
      ],
      ...visibleExpenses.map((expense) => [
        expense.date,
        expense.description,
        expense.category,
        expense.amount === null ? "" : expense.amount,
        isAccountId(expense.account)
          ? accountName(expense.account)
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
    link.download = `spend-${selectedMonth}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    setLastBackupAt(exportedAt);
    try {
      localStorage.setItem(LAST_BACKUP_AT_KEY, exportedAt);
    } catch {
      // Keep the updated reminder for this visit if browser storage is unavailable.
    }
    setBackupStatus("Backup downloaded. Keep it somewhere safe.");
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
          isAccountId(expense.account)
            ? accountName(expense.account)
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
      const backup = JSON.parse(await file.text());
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
        !["light", "dark"].includes(data.theme) ||
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
      setExpenses(
        loadExpenses(data.expenses).map((expense) => ({
          ...expense,
          createdAt: expense.createdAt ?? restoreTimestamp,
          updatedAt: restoreTimestamp,
        })),
      );
      const restoredBudgets = loadBudgets(data.budgets);
      setBudgets(restoredBudgets);
      const restoredBudgetUpdatedAt = Object.fromEntries(
        Object.keys(restoredBudgets).map((month) => [month, restoreTimestamp]),
      );
      setBudgetUpdatedAt(restoredBudgetUpdatedAt);
      setRecurringSchedules(
        loadRecurringSchedules(data.recurringSchedules).map((schedule) => ({
          ...schedule,
          updatedAt: restoreTimestamp,
        })),
      );
      const restoredAccounts = loadAccountData(data.accountData);
      setAccountData({
        settings: { ...restoredAccounts.settings, updatedAt: restoreTimestamp },
        transactions: restoredAccounts.transactions.map((transaction) => ({
          ...transaction,
          createdAt: transaction.createdAt ?? restoreTimestamp,
          updatedAt: restoreTimestamp,
        })),
      });
      const restoredDeletedRecords = normalizeDeletedRecords(data.deletedRecords);
      for (const changes of Object.values(restoredDeletedRecords)) {
        for (const change of Object.values(changes)) {
          change.updatedAt = restoreTimestamp;
        }
      }
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
  }

  async function refreshAccounts() {
    if (accountRefreshBusy) return;
    setAccountRefreshBusy(true);
    setAccountRefreshStatus("Refreshing account balances…");
    try {
      if (pushUser && cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
        await queueCloudSnapshotRefresh(pushUser.id, "manual");
      } else {
        const localAccountData = loadAccountData();
        setAccountData(localAccountData);
        setStartingBalances({
          bkash: String(localAccountData.settings.balances.bkash),
          bank: String(localAccountData.settings.balances.bank),
          date: localAccountData.settings.startDate,
        });
      }
      setAccountRefreshStatus("Account balances updated.");
    } catch (error) {
      setAccountRefreshStatus(`Could not refresh accounts: ${error.message}`);
    } finally {
      setAccountRefreshBusy(false);
    }
  }

  async function refreshRecurringSchedules() {
    if (recurringRefreshBusy) return;
    setRecurringRefreshBusy(true);
    setRecurringRefreshStatus("Refreshing recurring expenses…");
    try {
      if (pushUser && cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
        const refreshed = await queueCloudSnapshotRefresh(
          pushUser.id,
          "manual",
        );
        if (!refreshed) {
          throw new Error("No cloud data was returned.");
        }
        setRecurringRefreshStatus("Schedules refreshed.");
      } else {
        setRecurringSchedules(loadRecurringSchedules());
        setRecurringRefreshStatus("Schedules refreshed on this device.");
      }
    } catch (error) {
      setRecurringRefreshStatus(
        `Could not refresh recurring expenses: ${error.message}`,
      );
    } finally {
      setRecurringRefreshBusy(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthStatus("");
    try {
      if (authMode === "forgot-password") {
        const { error } = await supabase.auth.resetPasswordForEmail(
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
        const { error } = await supabase.auth.updateUser({
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
          ? await supabase.auth.signUp({
              email: authEmail.trim(),
              password: authPassword,
              options: {
                emailRedirectTo: new URL(
                  import.meta.env.BASE_URL,
                  window.location.origin,
                ).href,
              },
            })
          : await supabase.auth.signInWithPassword({
              email: authEmail.trim(),
              password: authPassword,
            });
      if (result.error) throw result.error;
      if (authMode === "sign-up" && !result.data.session) {
        setAuthStatus(
          "Check your email to confirm your account, then sign in.",
        );
      } else {
        setAuthStatus(
          authMode === "sign-up"
            ? "Account created. You can now enable background reminders."
            : "Signed in. Your recurring reminder schedule is syncing.",
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
    if (!pushUser || !supabase) {
      openSignInModal();
      return;
    }
    profileEditorTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProfileDraft(userDisplayName(pushUser));
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
    if (!pushUser || !supabase) {
      setProfileStatus("Sign in to edit your profile.");
      return false;
    }

    setProfileSaving(true);
    setProfileStatus("");
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { full_name: name, name },
      });
      if (error) throw error;
      setPushUser(
        data.user ?? {
          ...pushUser,
          user_metadata: { ...pushUser.user_metadata, full_name: name, name },
        },
      );
      setProfileStatus("Profile updated.");
      return true;
    } catch (error) {
      setProfileStatus(`Could not update your profile: ${error.message}`);
      return false;
    } finally {
      setProfileSaving(false);
    }
  }

  async function signOutOfPush() {
    if (!supabase || !pushUser) return;
    setAuthBusy(true);
    try {
      if (cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
      }
      if (pushBackendConfigured) {
        await disableBackgroundPush(pushUser.id);
      }
      const { error } = await supabase.auth.signOut();
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
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification("Spend notifications enabled", {
            body: "Notifications can appear while this app is open. Background push needs backend setup.",
          });
        } else {
          new window.Notification("Spend notifications enabled", {
            body: "Notifications can appear while this app is open.",
          });
        }
        setNotificationStatus(
          "Notifications are allowed. Background reminders need backend setup.",
        );
      } catch (error) {
        setNotificationStatus(
          `Could not show a system notification: ${error.message}`,
        );
      }
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
      const { registration } = await enableBackgroundPush(pushUser.id);
      setBackgroundPushEnabled(true);
      setNotificationStatus(
        "Background reminders are enabled. You’ll get a push when a recurring expense is due.",
      );
      try {
        await registration.showNotification("Spend notifications enabled", {
          body: "Background reminders are working on this device.",
        });
      } catch (error) {
        setNotificationStatus(
          `Background reminders are enabled, but the test notification could not be shown: ${error.message}`,
        );
      }
    } catch (error) {
      setNotificationStatus(
        `Could not enable background reminders: ${error.message}`,
      );
    }
  }

  useEffect(() => {
    if (notificationPermission === "granted" && pendingDueRef.current.length) {
      sendSystemNotification([...pendingDueRef.current]);
    }
  }, [notificationPermission]);

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

  function toggleConversion() {
    setConversionOpen((open) => !open);
  }

  function updateReminderTime(value) {
    if (!isValidReminderTime(value)) {
      setNotificationStatus("Choose a valid reminder time.");
      return;
    }
    setReminderTime(value);
    try {
      localStorage.setItem(STORAGE_KEYS.reminderTime, value);
    } catch (error) {
      setNotificationStatus(
        `Could not save the reminder time on this device: ${error.message}`,
      );
    }
  }

  function retryConversion() {
    // Changing the target to itself triggers a fresh request through the effect.
    setConversionOpen(false);
    window.setTimeout(() => setConversionOpen(true), 0);
  }

  function addMonth(offset) {
    setSelectedMonth((month) => shiftMonth(month, offset));
  }

  function navigateMobile(view) {
    setIsMoreOpen(false);
    setMobileView(view);
    if (window.matchMedia("(max-width: 800px)").matches) window.scrollTo(0, 0);
  }

  const countText =
    visibleExpenses.length === monthExpenses.length
      ? `${visibleExpenses.length} ${visibleExpenses.length === 1 ? "expense" : "expenses"}`
      : `${visibleExpenses.length} of ${monthExpenses.length} shown`;
  const mobileSectionTitle = {
    activity: "Activity",
    add: "Add expense",
    budget: "Budget",
    accounts: "Accounts",
    more: "Appearance",
    profile: "Profile",
    recurring: "Recurring expenses",
  }[mobileView];
  const cloudSyncLabels = getCloudSyncLabels({
    signedIn: Boolean(pushUser),
    enabled: cloudSyncEnabled,
    ready: cloudSyncReady,
    normalized: normalizedAccountSync,
    realtimeStatus: cloudRealtimeStatus,
    activity: cloudSyncActivity,
  });

  return (
    <>
      <MobilePrototype
        S={mobilePrototypeData}
        onShift={addMonth}
        onExpenseSave={saveMobileExpense}
        onExpenseUpdate={saveMobileExpenseUpdate}
        onExpenseDelete={removeExpense}
        onBudgetSave={(amount) => {
          setRecordDeleted("budgets", selectedMonth, false);
          setBudgetUpdatedAt((current) => ({
            ...current,
            [selectedMonth]: Date.now(),
          }));
          setBudgets((current) => ({
            ...current,
            [selectedMonth]: roundMoney(amount),
          }));
          setBudgetEditingMonth(null);
          return true;
        }}
        onBudgetClear={clearBudget}
        onTransactionSave={saveMobileTransaction}
        onToggleRec={toggleMobileRecurring}
        onRemoveRec={removeMobileRecurring}
        onTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        onReminder={updateReminderTime}
        profile={{
          name: pushUser
            ? userDisplayName(pushUser)
            : localProfileName || "Local profile",
          email: pushUser?.email || "",
          initial: pushUser
            ? userInitial(pushUser)
            : profileInitial(localProfileName || "Local profile"),
          connected: Boolean(pushUser),
          hasName: Boolean(pushUser || localProfileName),
        }}
        onEditProfile={openProfileEditor}
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
        backupStatus={backupStatus}
        lastBackupAt={lastBackupAt}
        onBackupDownload={downloadBackup}
        onExpensesCsv={exportAllExpensesCsv}
        onBackupRestore={() => backupFileInputRef.current?.click()}
        onSignOut={signOutOfPush}
        accountStatus={authStatus}
        authBusy={authBusy}
        onSignIn={openSignInModal}
      />
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
              <div className="auth-modal-heading">
                <div>
                  <h2 id="auth-modal-title">
                    {authMode === "sign-up"
                      ? "Create your Spend account"
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
                          : "Use your account for automatic cloud sync. Background reminders are optional."}
                  </p>
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
                  ×
                </button>
              </div>
              {supabaseConfigured ? (
                <>
                  <form
                    className="push-auth-form auth-modal-form"
                    onSubmit={handleAuthSubmit}
                  >
                    <div className="push-auth-fields auth-modal-fields">
                      <div>
                        <label htmlFor="push-email">Email</label>
                        <input
                          id="push-email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          required
                          value={authEmail}
                          onChange={(event) => setAuthEmail(event.target.value)}
                        />
                      </div>
                      {authMode !== "forgot-password" && (
                        <div>
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
                    <div className="push-auth-actions">
                      <button type="submit" disabled={authBusy}>
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
                      {authMode !== "update-password" && (
                        <button
                          className="push-account-action"
                          type="button"
                          disabled={authBusy}
                          onClick={() => {
                            setAuthMode((mode) => {
                              if (mode === "forgot-password") return "sign-in";
                              return mode === "sign-up" ? "sign-in" : "sign-up";
                            });
                            setAuthStatus("");
                            setAuthPassword("");
                          }}
                        >
                          {authMode === "forgot-password"
                            ? "Back to sign in"
                            : authMode === "sign-up"
                              ? "I already have an account"
                              : "Create an account"}
                        </button>
                      )}
                    </div>
                  </form>
                  {authMode === "sign-in" && (
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
                      Forgot your password?
                    </button>
                  )}
                  {authStatus && (
                    <p
                      className="auth-modal-status"
                      role="status"
                      aria-live="polite"
                    >
                      {authStatus}
                    </p>
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
                  if (await saveProfileName(profileDraft))
                    hideProfileEditor();
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
