import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaArrowsRotate,
  FaBolt,
  FaBookOpen,
  FaBuildingColumns,
  FaCalendarDays,
  FaCar,
  FaCartShopping,
  FaCirclePlus,
  FaClockRotateLeft,
  FaEllipsis,
  FaHeartPulse,
  FaHouse,
  FaMusic,
  FaPalette,
  FaPenToSquare,
  FaRepeat,
  FaRightLeft,
  FaTag,
  FaUtensils,
  FaUser,
  FaWallet,
} from "react-icons/fa6";
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
} from "./cloud-sync.js";

const CURRENCY_API = "https://api.frankfurter.dev/v2";
const LOCAL_DATA_OWNER_KEY = "spend-local-data-owner-v1";
const LOCAL_USER_SNAPSHOTS_KEY = "spend-local-user-snapshots-v1";

const CATEGORY_ICONS = {
  Food: FaUtensils,
  Transport: FaCar,
  Bills: FaBolt,
  Home: FaHouse,
  Shopping: FaCartShopping,
  Health: FaHeartPulse,
  Entertainment: FaMusic,
  Education: FaBookOpen,
  Savings: FaWallet,
  Other: FaTag,
};

function CategoryIcon({ category }) {
  const Icon = CATEGORY_ICONS[category] ?? FaEllipsis;
  return (
    <Icon
      className="category-icon-glyph"
      aria-hidden="true"
      focusable="false"
    />
  );
}

const ACCOUNT_ICONS = {
  bank: FaBuildingColumns,
  wallet: FaWallet,
  transfer: FaRightLeft,
  history: FaClockRotateLeft,
  repeat: FaRepeat,
  refresh: FaArrowsRotate,
};

function AccountIcon({ name }) {
  if (name === "bkash") {
    return (
      <img
        className="account-icon account-icon-bkash"
        src={`${import.meta.env.BASE_URL}icons/bkash.svg`}
        alt=""
        aria-hidden="true"
      />
    );
  }

  const Icon = ACCOUNT_ICONS[name];
  if (!Icon) return null;

  return (
    <Icon
      className={`account-icon account-icon-${name}`}
      aria-hidden="true"
      focusable="false"
    />
  );
}
function CategoryBreakdown({ items, total, titleId, className }) {
  return (
    <div className={className} aria-labelledby={titleId}>
      <div className="category-breakdown-heading">
        <h3 id={titleId}>Where your money goes</h3>
        <span>{items.length} categories</span>
      </div>
      {items.length ? (
        <div className="category-breakdown-list">
          {items.map(([category, amount]) => {
            const percentage = total
              ? Math.round((amount / total) * 100)
              : 0;
            return (
              <div className="category-breakdown-row" key={category}>
                <div className="category-breakdown-label">
                  <span>{category}</span>
                  <strong>{formatCurrency(amount)}</strong>
                </div>
                <div
                  className="category-breakdown-track"
                  role="progressbar"
                  aria-label={`${category} spending`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={percentage}
                  aria-valuetext={`${formatCurrency(amount)}, ${percentage}% of monthly spending`}
                >
                  <span style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="category-breakdown-empty">
          No spending recorded for this month yet.
        </p>
      )}
    </div>
  );
}

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

function accountName(accountId) {
  return accountId === "bkash" ? "bKash" : "Bank";
}

function userDisplayName(user) {
  const metadata = user?.user_metadata ?? {};
  const name = metadata.full_name || metadata.name || metadata.username;
  if (typeof name === "string" && name.trim()) return name.trim();
  return user?.email?.split("@")[0] || "Account";
}

function userInitial(user) {
  const metadata = user?.user_metadata ?? {};
  const firstName =
    metadata.first_name ||
    metadata.given_name ||
    userDisplayName(user).trim().split(/\s+/)[0] ||
    user?.email?.trim().split("@")[0] ||
    "A";
  return Array.from(String(firstName).trim())[0]?.toLocaleUpperCase() || "A";
}

function formatLastSynced(value) {
  if (!value) return "";
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60000) return "Synced just now";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Synced ${hours}h ago`;
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
          ? [[
              id,
              {
                deleted: change.deleted,
                updatedAt: Number.isFinite(Number(change.updatedAt))
                  ? Number(change.updatedAt)
                  : 0,
              },
            ]]
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
        if (
          !merged[key][id] ||
          change.updatedAt >= merged[key][id].updatedAt
        )
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

function mergeRecords(cloudRecords, localRecords, deletedChanges = {}) {
  const records = new Map(cloudRecords.map((record) => [record.id, record]));
  for (const record of localRecords) records.set(record.id, record);
  for (const id of records.keys())
    if (isRecordDeleted(deletedChanges, id)) records.delete(id);
  return [...records.values()];
}

function expenseOccurrenceKey(expense) {
  return expense.recurringId
    ? `recurring:${expense.recurringId}:${expense.date}`
    : null;
}

function mergeExpenseRecords(cloudExpenses, localExpenses, deletedChanges) {
  const byId = new Map(cloudExpenses.map((expense) => [expense.id, expense]));
  for (const expense of localExpenses) byId.set(expense.id, expense);
  const records = new Map();
  for (const expense of byId.values()) {
    const occurrenceKey = expenseOccurrenceKey(expense);
    if (
      isRecordDeleted(deletedChanges, expense.id) ||
      (occurrenceKey && isRecordDeleted(deletedChanges, occurrenceKey))
    )
      continue;
    records.set(occurrenceKey ?? `expense:${expense.id}`, expense);
  }
  return [...records.values()];
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

function hasMeaningfulLocalAccountSettings(data) {
  return (
    data.accountData.settings.configured ||
    data.accountData.settings.balances.bkash !== 0 ||
    data.accountData.settings.balances.bank !== 0
  );
}

function mergeCloudSnapshots(local, cloud, preferLocal) {
  if (!cloud) return local;

  const cloudExpenses = loadExpenses(cloud.expenses ?? []);
  const cloudBudgets = loadBudgets(cloud.budgets ?? {});
  const cloudSchedules = loadRecurringSchedules(cloud.recurringSchedules ?? []);
  const cloudAccounts = loadAccountData(cloud.accountData ?? emptyAccountData());
  const deletedRecords = mergeDeletedRecords(
    cloud.deletedRecords,
    local.deletedRecords,
  );
  const withoutDeleted = (records, collection) => {
    return records.filter(
      (record) => !isRecordDeleted(deletedRecords[collection], record.id),
    );
  };
  const withoutDeletedBudgets = (budgets) => {
    return Object.fromEntries(
      Object.entries(budgets).filter(
        ([month]) => !isRecordDeleted(deletedRecords.budgets, month),
      ),
    );
  };
  if (!preferLocal) {
    return {
      expenses: mergeExpenseRecords(
        cloudExpenses,
        [],
        deletedRecords.expenses,
      ),
      budgets: withoutDeletedBudgets(cloudBudgets),
      recurringSchedules: withoutDeleted(
        cloudSchedules,
        "recurringSchedules",
      ),
      accountData: {
        ...cloudAccounts,
        transactions: withoutDeleted(
          cloudAccounts.transactions,
          "accountTransactions",
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
    budgets: withoutDeletedBudgets({ ...cloudBudgets, ...local.budgets }),
    recurringSchedules: mergeRecords(
      cloudSchedules,
      local.recurringSchedules,
      deletedRecords.recurringSchedules,
    ),
    accountData: {
      settings: hasMeaningfulLocalAccountSettings(local)
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

export default function App() {
  const [expenses, setExpenses] = useState(loadExpenses);
  const [budgets, setBudgets] = useState(loadBudgets);
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
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [backgroundPushEnabled, setBackgroundPushEnabled] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [cloudSyncRetry, setCloudSyncRetry] = useState(0);
  const [accountRefreshBusy, setAccountRefreshBusy] = useState(false);
  const [accountRefreshStatus, setAccountRefreshStatus] = useState("");
  const [recurringRefreshBusy, setRecurringRefreshBusy] = useState(false);
  const [recurringRefreshStatus, setRecurringRefreshStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const authModalRef = useRef(null);
  const authTriggerRef = useRef(null);
  const backupFileInputRef = useRef(null);
  const pendingDueRef = useRef([]);
  const lastRecurringCheckRef = useRef("");
  const pushScheduleSyncRef = useRef(Promise.resolve());
  const cloudSnapshotRef = useRef(null);
  const cloudVersionRef = useRef(null);
  const cloudSaveQueueRef = useRef(Promise.resolve());
  const undoTimerRef = useRef(null);
  const authUserIdRef = useRef(null);
  const localDataOwnerRef = useRef(loadLocalDataOwner());
  cloudSnapshotRef.current = useMemo(
    () => ({
      expenses,
      budgets,
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
              setLastSyncedAt(Date.now());
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
            snapshot = mergeCloudSnapshots(snapshot, remote.data, true);
            applyCloudSnapshot(snapshot);
          }
          cloudVersionRef.current = remote?.updated_at ?? null;
        }

        throw new Error("Cloud data changed repeatedly; please try again.");
      });
    cloudSaveQueueRef.current = saveTask;
    return saveTask;
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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
          setAuthModalOpen(true);
        }
        setCloudSyncReady(false);
        setLastSyncedAt(null);
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
        setAuthModalOpen(true);
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
      setLastSyncedAt(null);
      cloudVersionRef.current = null;
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
      try {
        let remote = await loadCloudData(pushUser.id);
        let merged;
        let savedVersion = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!active) return;
          const local = cloudSnapshotRef.current;
          merged = mergeCloudSnapshots(
            local,
            remote?.data,
            !localDataOwnerRef.current ||
              localDataOwnerRef.current === pushUser.id
              ? hasMeaningfulLocalData(local)
              : false,
          );
          try {
            savedVersion = await saveCloudData(
              pushUser.id,
              merged,
              remote?.updated_at ?? null,
            );
          } catch (error) {
            if (error.code !== "23505" || remote) throw error;
          }
          if (savedVersion) {
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
            );
            break;
          }
          remote = await loadCloudData(pushUser.id);
        }
        if (!savedVersion || !merged) {
          throw new Error("Cloud data changed repeatedly; please try again.");
        }
        if (!active) return;
        cloudVersionRef.current = savedVersion;
        adoptLocalDataForUser(pushUser.id);
        applyCloudSnapshot(merged);
        setCloudSyncReady(true);
        setLastSyncedAt(Date.now());
        setCloudSyncStatus("Cloud sync is on. Your data is saved to Supabase.");
      } catch (error) {
        if (active) {
          setCloudSyncEnabled(false);
          setCloudSyncReady(false);
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
    if (!authModalOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !authBusy) setAuthModalOpen(false);
    };
    const previousFocus = document.activeElement;
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (pushUser) return;
      if (authTriggerRef.current?.isConnected) authTriggerRef.current.focus();
      else if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [authBusy, authModalOpen, pushUser]);

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
  const previousMonth = useMemo(() => shiftMonth(selectedMonth, -1), [selectedMonth]);
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
        map[expense.category] = (map[expense.category] || 0) + Number(expense.amount);
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
        .filter((schedule) => schedule.active && schedule.nextDate >= localDate())
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
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
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
          nextExpenses.push({
            id: makeId(),
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
        ? { ...schedule, nextDate }
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

  function saveExpenseData(form) {
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
    if (form.interval === "none") {
      setExpenses((current) => [
        ...current,
        {
          id: makeId(),
          description,
          amount: amount === null ? null : roundMoney(amount),
          category: form.category,
          date: form.date,
          account: form.account,
        },
      ]);
    } else {
      const scheduleId = makeId();
      let nextDate = form.date;
      const today = localDate();
      const generatedExpenses = [];
      let generated = 0;
      while (nextDate <= today && generated < 240) {
        generatedExpenses.push({
          id: makeId(),
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
    return true;
  }

  function handleExpenseSubmit(event) {
    event.preventDefault();
    if (saveExpenseData(expenseForm)) navigateMobile("activity");
  }

  function saveMobileExpense(form) {
    return saveExpenseData(form);
  }

  function saveMobileAmount(expenseId, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    setExpenses((current) =>
      current.map((expense) =>
        expense.id === expenseId
          ? { ...expense, amount: roundMoney(amount) }
          : expense,
      ),
    );
    setEditingExpenseId(null);
    setEditingAmount("");
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
    const transaction = {
      id: makeId(),
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
    const transaction = {
      id: makeId(),
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
    return true;
  }

  function toggleMobileRecurring(scheduleId) {
    setRecurringSchedules((current) =>
      current.map((schedule) => {
        if (schedule.id !== scheduleId) return schedule;
        if (schedule.active) return { ...schedule, active: false };
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
        return { ...schedule, active: true, nextDate };
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
        item.id === expense.id ? { ...item, amount: roundMoney(amount) } : item,
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

  function removeExpense(expense) {
    setExpenses((current) =>
      current.filter((item) => item.id !== expense.id),
    );
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
      setRecordDeleted("budgets", selectedMonth, true);
      const restore = () => {
        setRecordDeleted("budgets", selectedMonth, false);
        setBudgets((current) => ({ ...current, [selectedMonth]: previousBudget }));
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
    const backup = {
      format: "spend-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        expenses,
        budgets,
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
    setBackupStatus("Backup downloaded. Keep it somewhere safe.");
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
      setExpenses(loadExpenses(data.expenses));
      setBudgets(loadBudgets(data.budgets));
      setRecurringSchedules(loadRecurringSchedules(data.recurringSchedules));
      setAccountData(loadAccountData(data.accountData));
      setDeletedRecords(normalizeDeletedRecords(data.deletedRecords));
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
    setRecurringSchedules(snapshot.recurringSchedules);
    setAccountData(snapshot.accountData);
    setDeletedRecords(normalizeDeletedRecords(snapshot.deletedRecords));
    setTheme(snapshot.theme);
    setTargetCurrency(snapshot.targetCurrency);
    setReminderTime(
      isValidReminderTime(snapshot.reminderTime) ? snapshot.reminderTime : "09:00",
    );
  }

  async function refreshAccounts() {
    if (accountRefreshBusy) return;
    setAccountRefreshBusy(true);
    setAccountRefreshStatus("Refreshing account balances…");
    try {
      if (pushUser && cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
        const remote = await loadCloudData(pushUser.id);
        if (remote?.data) {
          const refreshed = mergeCloudSnapshots(
            cloudSnapshotRef.current,
            remote.data,
            false,
          );
          applyCloudSnapshot(refreshed);
          cloudVersionRef.current = remote.updated_at ?? cloudVersionRef.current;
          setLastSyncedAt(Date.now());
          setCloudSyncStatus("Cloud data refreshed from Supabase.");
        }
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
        const remote = await loadCloudData(pushUser.id);
        if (!remote?.data) {
          throw new Error("No cloud data was returned.");
        }
        setRecurringSchedules(
          loadRecurringSchedules(remote.data.recurringSchedules ?? []),
        );
        cloudVersionRef.current = remote.updated_at ?? cloudVersionRef.current;
        setLastSyncedAt(Date.now());
        setCloudSyncStatus("Cloud data refreshed from Supabase.");
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
        setAuthModalOpen(false);
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

  async function signOutOfPush() {
    if (!supabase || !pushUser) return;
    setAuthBusy(true);
    try {
      if (cloudSyncEnabled && cloudSyncReady) {
        await queueCloudSnapshotSave(pushUser.id);
      }
      await disableBackgroundPush(pushUser.id);
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
      setAuthModalOpen(true);
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
    if (window.matchMedia("(max-width: 800px)").matches)
      window.scrollTo(0, 0);
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

  return (
    <>
    <MobilePrototype
      S={mobilePrototypeData}
      legacyView={mobileView === "more" || mobileView === "profile"}
      onShift={addMonth}
      onExpenseSave={saveMobileExpense}
      onAmountSave={saveMobileAmount}
      onExpenseDelete={removeExpense}
      onBudgetSave={(amount) => {
        setRecordDeleted("budgets", selectedMonth, false);
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
      profile={pushUser ? {
        name: userDisplayName(pushUser),
        email: pushUser.email,
        initial: userInitial(pushUser),
      } : null}
      cloudSyncEnabled={cloudSyncEnabled}
      cloudSyncReady={cloudSyncReady}
      pushBackendConfigured={pushBackendConfigured}
      notificationPermission={notificationPermission}
      notificationStatus={notificationStatus}
      backgroundPushEnabled={backgroundPushEnabled}
      onToggleNotifications={toggleNotifications}
      backupStatus={backupStatus}
      onBackupDownload={downloadBackup}
      onBackupRestore={() => backupFileInputRef.current?.click()}
      onSignOut={signOutOfPush}
      accountStatus={authStatus}
      authBusy={authBusy}
      onSignIn={() => {
        authTriggerRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        setAuthMode("sign-in");
        setAuthStatus("");
        setAuthPassword("");
        setAuthModalOpen(true);
      }}
    />
    <main
      className="full-app"
      data-mobile-view={mobileView}
      data-more-open={isMoreOpen ? "true" : undefined}
    >
      <header>
        <span className="mobile-section-title" aria-live="polite">
          {mobileSectionTitle}
        </span>
        <div className="header-topline">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
            <span>Spend</span>
          </div>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <span className="theme-label">
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </button>
        </div>
        <div className="header-bottomline">
          <div
            className={`local-note${cloudSyncEnabled ? " is-sync-enabled" : " is-local-only"}`}
            role="status"
            aria-live="polite"
            aria-label={
              cloudSyncEnabled
                ? "Expense cloud sync is on"
                : "Expense data stays on this device"
            }
          >
            <span className="sync-status-dot" aria-hidden="true" />
            <span className="local-note-long">
              {!pushUser
                ? "Local only"
                : !cloudSyncEnabled
                  ? "Cloud sync paused"
                  : cloudSyncReady
                    ? "Cloud sync on"
                    : "Syncing…"}
            </span>
            <span className="local-note-mobile">
              {!pushUser
                ? "Local"
                : !cloudSyncEnabled
                  ? "Paused"
                  : cloudSyncReady
                    ? "Synced"
                    : "Syncing"}
            </span>
            {pushUser && cloudSyncReady && lastSyncedAt && (
              <span className="sync-last-saved">
                {formatLastSynced(lastSyncedAt)}
              </span>
            )}
          </div>
          <div
            className={`header-actions${pushUser ? " is-authenticated" : ""}`}
          >
            {pushUser ? (
              <>
                <div className="header-account header-account-full">
                  <span className="header-avatar" aria-hidden="true">
                    {userInitial(pushUser)}
                  </span>
                  <span className="header-user" title={pushUser.email}>
                    <span>{userDisplayName(pushUser)}</span>
                    <small>{pushUser.email}</small>
                  </span>
                  <button
                    className="header-account-action"
                    type="button"
                    disabled={authBusy}
                    onClick={signOutOfPush}
                  >
                    Sign out
                  </button>
                </div>
                <details className="header-account-mobile">
                  <summary aria-label={`Account menu for ${userDisplayName(pushUser)}`}>
                    <span className="header-avatar" aria-hidden="true">
                      {userInitial(pushUser)}
                    </span>
                  </summary>
                  <div className="header-account-popover">
                    <span className="header-user" title={pushUser.email}>
                      <span>{userDisplayName(pushUser)}</span>
                      <small>{pushUser.email}</small>
                    </span>
                    <button
                      className="header-account-action"
                      type="button"
                      disabled={authBusy}
                      onClick={signOutOfPush}
                    >
                      Sign out
                    </button>
                  </div>
                </details>
              </>
            ) : (
                <button
                  className="header-account-action"
                  type="button"
                  ref={authTriggerRef}
                  aria-label="Sign in to Spend"
                  onClick={() => {
                    setAuthStatus("");
                    setAuthModalOpen(true);
                  }}
                >
                  <span className="header-signin-icon" aria-hidden="true">
                    <FaUser focusable="false" />
                  </span>
                  <span className="header-signin-label">Sign in</span>
                </button>
            )}
          </div>
        </div>
      </header>
      {authModalOpen && (!pushUser || authMode === "update-password") && createPortal(
        <div
          className="auth-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !authBusy)
              setAuthModalOpen(false);
          }}
        >
          <section
            className="auth-modal"
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
                onClick={() => setAuthModalOpen(false)}
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
                    <input
                      id="push-password"
                      type="password"
                      autoComplete={
                        authMode === "sign-up" || authMode === "update-password"
                          ? "new-password"
                          : "current-password"
                      }
                      minLength="6"
                      required
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                    />
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
              <p className="auth-modal-status" role="status" aria-live="polite">
                {authStatus}
              </p>
            )}
              </>
            ) : (
              <p className="auth-unavailable" role="status">
                You can keep using Spend locally. Connect an account service to enable sign-in and cloud sync.
              </p>
            )}
          </section>
        </div>,
        document.body,
      )}

      <section className="summary" data-mobile-page="home" aria-labelledby="summary-title">
        <div className="summary-topline">
          <p className="eyebrow" id="summary-title">
            <span className="summary-label-prefix">Month total</span>
            <span className="summary-currency">BDT</span>
          </p>
          <div
            className="month-navigation"
            aria-label="Monthly total navigation"
          >
            <button
              className="month-step"
              type="button"
              aria-label="Previous month"
              title="Previous month"
              onClick={() => addMonth(-1)}
            >
              ‹
            </button>
            <label className="month-select">
              <span className="month-display" aria-hidden="true">
                <span className="month-display-full">
                  {formatMonth(selectedMonth)}
                </span>
                <span className="month-display-compact">
                  {formatCompactMonth(selectedMonth)}
                </span>
                <span className="month-calendar-icon" />
              </span>
              <input
                className="month-picker"
                type="month"
                aria-label="Choose month"
                title="Choose month"
                value={selectedMonth}
                onPointerDown={(event) => {
                  const picker = event.currentTarget;
                  if (typeof picker.showPicker === "function") {
                    event.preventDefault();
                    picker.showPicker();
                  }
                }}
                onChange={(event) =>
                  setSelectedMonth(event.target.value || currentMonth())
                }
              />
            </label>
            <button
              className="month-step"
              type="button"
              aria-label="Next month"
              title="Next month"
              onClick={() => addMonth(1)}
            >
              ›
            </button>
          </div>
        </div>
        <div className="summary-total-line">
          <p className="total" aria-live="polite">
            {formatCurrency(monthlyTotal)}
          </p>
          <p className="summary-caption">
            Across all expenses
            <span className="summary-caption-month">
              {" "}
              in {formatMonth(selectedMonth)}
            </span>
          </p>
        </div>
        <div className="summary-insights" aria-label="Spending insights">
          <div>
            <span>vs previous month</span>
            <strong>
              {previousMonthTotal
                ? `${monthlyTotal >= previousMonthTotal ? "+" : ""}${formatCurrency(monthlyTotal - previousMonthTotal)}`
                : "No prior data"}
            </strong>
          </div>
          <div>
            <span>Top category</span>
            <strong>
              {topCategory
                ? `${topCategory[0]} · ${formatCurrency(topCategory[1])}`
                : "No spending yet"}
            </strong>
          </div>
          <div>
            <span>Next recurring</span>
            <strong>
              {nextRecurring
                ? `${nextRecurring.description} · ${formatDate(nextRecurring.nextDate)}`
                : "Nothing scheduled"}
            </strong>
          </div>
        </div>
        <CategoryBreakdown
          items={categoryBreakdown}
          total={monthlyTotal}
          titleId="category-breakdown-title"
          className="category-breakdown summary-category-breakdown"
        />
        <button
          className="conversion-toggle"
          type="button"
          aria-expanded={conversionOpen}
          onClick={toggleConversion}
        >
          <span>{conversionOpen ? "Hide conversion" : "Show conversion"}</span>
          <span id="conversion-toggle-icon" aria-hidden="true">
            {conversionOpen ? "⌃" : "⌄"}
          </span>
        </button>
        {conversionOpen && (
          <div className="conversion-details">
            <div className="conversion-picker">
              <label htmlFor="conversion-currency">Convert BDT to</label>
              <select
                id="conversion-currency"
                value={targetCurrency}
                onChange={(event) => setTargetCurrency(event.target.value)}
              >
                {currencyOptions.map((currency) => (
                  <option key={currency.iso_code} value={currency.iso_code}>
                    {currency.iso_code} — {currency.name}
                  </option>
                ))}
              </select>
            </div>
            {conversionReady && (
              <div className="converted-total-block">
                <p className="converted-total-label">
                  Estimated total in {targetCurrency}
                </p>
                <p className="converted-total" aria-live="polite">
                  {formatCurrency(
                    monthlyTotal * conversionRate,
                    targetCurrency,
                  )}
                </p>
              </div>
            )}
            <p className="conversion-status" role="status" aria-live="polite">
              {conversionStatus}
            </p>
            <p className="conversion-disclaimer">
              Indicative daily mid-market rate. Your bank or card provider may
              use a different rate. Source:{" "}
              <a
                href="https://frankfurter.dev/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Frankfurter
              </a>
              .
            </p>
            {conversionFailed && (
              <button
                className="retry-rate"
                type="button"
                onClick={retryConversion}
              >
                Try again
              </button>
            )}
          </div>
        )}
      </section>

      <section
        className="home-transactions"
        data-mobile-page="home"
        aria-labelledby="home-transactions-title"
      >
        <div className="home-transactions-heading">
          <h2 id="home-transactions-title">Recent Transactions</h2>
          <button
            className="home-transactions-see-all"
            type="button"
            onClick={() => {
              setQuery("");
              setCategoryFilter("");
              navigateMobile("activity");
            }}
          >
            See all
          </button>
        </div>
        {recentExpenses.length ? (
          <ul className="home-transaction-list">
            {recentExpenses.map((expense) => (
              <li className="home-transaction-row" key={expense.id}>
                <span className="home-transaction-icon" aria-hidden="true">
                  <CategoryIcon category={expense.category} />
                </span>
                <span className="home-transaction-copy">
                  <strong title={expense.description}>{expense.description}</strong>
                  <span>
                    {expense.category} · {formatDate(expense.date)}
                  </span>
                </span>
                <strong className="home-transaction-amount">
                  {expense.amount === null
                    ? "Add amount"
                    : formatCurrency(expense.amount)}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <div className="home-transactions-empty">
            <span className="home-transactions-empty-icon" aria-hidden="true">
              <FaWallet focusable="false" />
            </span>
            <strong>No transactions yet</strong>
            <p>Start tracking your expenses to see them here.</p>
          </div>
        )}
      </section>

      <section
        className="home-category-breakdown"
        data-mobile-page="home"
        aria-labelledby="home-category-breakdown-title"
      >
        <CategoryBreakdown
          items={categoryBreakdown}
          total={monthlyTotal}
          titleId="home-category-breakdown-title"
          className="category-breakdown home-category-breakdown-card"
        />
      </section>

      <section className="panel" data-mobile-page="add" aria-labelledby="form-title">
        <h2 id="form-title" className="expense-form-title">
          <span className="expense-form-plus" aria-hidden="true">
            +
          </span>
          Add an expense
        </h2>
        <form
          id="expense-form"
          onSubmit={handleExpenseSubmit}
          onChange={() => expenseMessage && setExpenseMessage("")}
        >
          <div className="form-grid">
            <div className="description-field">
              <label htmlFor="description">What was it for?</label>
              <input
                id="description"
                type="text"
                placeholder="e.g. Lunch"
                maxLength="80"
                required
                autoComplete="off"
                value={expenseForm.description}
                onChange={(event) =>
                  setExpenseForm({
                    ...expenseForm,
                    description: event.target.value,
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="amount">Amount (BDT)</label>
              <input
                id="amount"
                type="number"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                required={expenseForm.interval !== "none"}
                value={expenseForm.amount}
                onChange={(event) =>
                  setExpenseForm({ ...expenseForm, amount: event.target.value })
                }
              />
            </div>
            <div>
              <label htmlFor="expense-category">Category</label>
              <select
                id="expense-category"
                value={expenseForm.category}
                onChange={(event) =>
                  setExpenseForm({
                    ...expenseForm,
                    category: event.target.value,
                  })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="expense-date">Date</label>
              <input
                id="expense-date"
                type="date"
                required
                value={expenseForm.date}
                onChange={(event) =>
                  setExpenseForm({ ...expenseForm, date: event.target.value })
                }
              />
            </div>
            <div>
              <label htmlFor="expense-repeat">Repeat</label>
              <select
                id="expense-repeat"
                value={expenseForm.interval}
                onChange={(event) =>
                  setExpenseForm({
                    ...expenseForm,
                    interval: event.target.value,
                  })
                }
              >
                <option value="none">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label htmlFor="expense-account">Paid from</label>
              <select
                id="expense-account"
                value={expenseForm.account}
                onChange={(event) =>
                  setExpenseForm({
                    ...expenseForm,
                    account: event.target.value,
                  })
                }
              >
                <option value="">Cash / Other (not tracked)</option>
                <option value="bkash">bKash</option>
                <option value="bank">Bank</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <span className="currency-hint">
              {expenseForm.interval === "none"
                ? "Enter amounts in BDT. You can add a missing amount later from Recent expenses."
                : "Recurring expenses need an amount and are added when due."}
            </span>
            <button className="expense-submit" type="submit">
              Add expense
            </button>
          </div>
          {expenseMessage && (
            <p className="form-message" role="alert">
              {expenseMessage}
            </p>
          )}
        </form>
      </section>

      <section className="panel" data-mobile-page="accounts" aria-labelledby="accounts-title">
        <div className="account-panel-header">
          <div>
            <h2 id="accounts-title">Account balances</h2>
            <p className="account-intro">
              Updated as you log expenses and account activity.
            </p>
          </div>
          <button
            className={`account-refresh-button${accountRefreshBusy ? " is-busy" : ""}`}
            type="button"
            aria-label="Refresh account balances"
            title="Refresh account balances"
            onClick={refreshAccounts}
            disabled={accountRefreshBusy}
          >
            <AccountIcon name="refresh" />
            <span className="account-refresh-label">Refresh</span>
          </button>
          {accountRefreshStatus && (
            <span className="account-refresh-status" role="status">
              {accountRefreshStatus}
            </span>
          )}
        </div>
        <div className="account-cards">
          {[
            ["bkash", "bKash"],
            ["bank", "Bank"],
          ].map(([id, label]) => (
            <article className="account-card" key={id}>
              <div className="account-card-copy">
                <h3 className="account-card-heading">
                  <AccountIcon name={id} />
                  {label}
                </h3>
                <p className="account-meta">
                  {accountData.settings.configured
                    ? `Since ${formatDate(accountData.settings.startDate)}`
                    : "Starting amount needed"}
                </p>
              </div>
              <p className="account-balance" aria-live="polite">
                {formatCurrency(accountBalances[id])}
              </p>
            </article>
          ))}
        </div>

        <details className="account-details">
          <summary>
            <span className="account-summary-label">
              <AccountIcon name="wallet" />
            Set starting balances
            </span>
          </summary>
          <form onSubmit={handleOpeningBalancesSubmit}>
            <div className="account-form-grid">
              <div>
                <label htmlFor="starting-bkash">bKash (BDT)</label>
                <input
                  id="starting-bkash"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={startingBalances.bkash}
                  onChange={(event) =>
                    setStartingBalances({
                      ...startingBalances,
                      bkash: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor="starting-bank">Bank (BDT)</label>
                <input
                  id="starting-bank"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={startingBalances.bank}
                  onChange={(event) =>
                    setStartingBalances({
                      ...startingBalances,
                      bank: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor="starting-date">Balances as of</label>
                <input
                  id="starting-date"
                  type="date"
                  required
                  value={startingBalances.date}
                  onChange={(event) =>
                    setStartingBalances({
                      ...startingBalances,
                      date: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="account-form-actions">
              <button type="submit">Save starting balances</button>
            </div>
            <p className="account-form-note">
              Earlier expenses stay in history and won’t change these starting
              balances.
            </p>
          </form>
        </details>

        <details className="account-details account-transaction-details">
          <summary>
            <span className="account-summary-label">
              <AccountIcon name="transfer" />
            Record income, adjustment, or transfer
            </span>
          </summary>
          <form onSubmit={handleAccountTransactionSubmit}>
            <div className="account-form-grid account-transaction-grid">
              <div>
                <label htmlFor="transaction-type">Activity</label>
                <select
                  id="transaction-type"
                  value={transactionForm.type}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      type: event.target.value,
                    })
                  }
                >
                  <option value="income">Income</option>
                  <option value="adjustment">Balance adjustment</option>
                  <option value="transfer">Transfer between accounts</option>
                </select>
              </div>
              <div>
                <label htmlFor="transaction-amount">Amount (BDT)</label>
                <input
                  id="transaction-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={transactionForm.amount}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      amount: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor="transaction-date">Date</label>
                <input
                  id="transaction-date"
                  type="date"
                  required
                  value={transactionForm.date}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      date: event.target.value,
                    })
                  }
                />
              </div>
              <div className="account-note-field">
                <label htmlFor="transaction-note">Note</label>
                <input
                  id="transaction-note"
                  type="text"
                  maxLength="80"
                  placeholder="e.g. Salary, cash deposit"
                  autoComplete="off"
                  value={transactionForm.note}
                  onChange={(event) =>
                    setTransactionForm({
                      ...transactionForm,
                      note: event.target.value,
                    })
                  }
                />
              </div>
              {transactionForm.type !== "transfer" && (
                <div>
                  <label htmlFor="transaction-account">Account</label>
                  <select
                    id="transaction-account"
                    value={transactionForm.account}
                    onChange={(event) =>
                      setTransactionForm({
                        ...transactionForm,
                        account: event.target.value,
                      })
                    }
                  >
                    <option value="bkash">bKash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              )}
              {transactionForm.type === "adjustment" && (
                <div>
                  <label htmlFor="adjustment-direction">Correction</label>
                  <select
                    id="adjustment-direction"
                    value={transactionForm.direction}
                    onChange={(event) =>
                      setTransactionForm({
                        ...transactionForm,
                        direction: event.target.value,
                      })
                    }
                  >
                    <option value="increase">Increase balance</option>
                    <option value="decrease">Decrease balance</option>
                  </select>
                </div>
              )}
              {transactionForm.type === "transfer" && (
                <>
                  <div>
                    <label htmlFor="transfer-from">From</label>
                    <select
                      id="transfer-from"
                      value={transactionForm.fromAccount}
                      onChange={(event) =>
                        changeTransferAccount("fromAccount", event.target.value)
                      }
                    >
                      <option value="bkash">bKash</option>
                      <option value="bank">Bank</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="transfer-to">To</label>
                    <select
                      id="transfer-to"
                      value={transactionForm.toAccount}
                      onChange={(event) =>
                        changeTransferAccount("toAccount", event.target.value)
                      }
                    >
                      <option value="bank">Bank</option>
                      <option value="bkash">bKash</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="account-form-actions">
              <button type="submit">Save activity</button>
            </div>
          </form>
        </details>

        <details className="account-details">
          <summary>
            <span className="account-summary-label">
              <AccountIcon name="history" />
            Recent account activity
            </span>
          </summary>
          {accountActivity.length ? (
            <ul className="account-activity-list">
              {accountActivity.map((activity) => {
                const label = accountActivityLabel(activity);
                return (
                  <li className="account-activity-row" key={activity.id}>
                    <div className="account-activity-info">
                      <div className="account-activity-title">
                        {activity.description
                          ? `${label} · ${activity.description}`
                          : label}
                      </div>
                      <div className="account-activity-date">
                        {formatDate(activity.date)}
                      </div>
                    </div>
                    <span className="account-activity-amount">
                      {accountActivityPrefix(activity)}
                      {formatCurrency(activity.amount)}
                    </span>
                    <button
                      className="remove"
                      type="button"
                      title="Remove account activity"
                      aria-label={`Remove ${label}${activity.description ? ` ${activity.description}` : ""}`}
                      onClick={() => removeAccountActivity(activity)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="account-activity-empty">
              Your recent expenses and account activity will appear here.
            </p>
          )}
        </details>
      </section>

      <section
        className="panel budget-panel"
        data-mobile-page="budget"
        aria-labelledby="budget-title"
      >
        <div className="budget-heading">
          <div>
            <h2 id="budget-title">Monthly budget</h2>
            <span className="budget-month">
              <FaCalendarDays aria-hidden="true" focusable="false" />
              {formatMonth(selectedMonth)}
            </span>
          </div>
          {monthBudget > 0 && (
            <button
              className="budget-edit-toggle"
              type="button"
              aria-controls="budget-editor"
              aria-expanded={budgetEditorOpen}
              aria-label={budgetEditorOpen ? "Done editing budget" : "Edit budget"}
              onClick={() =>
                setBudgetEditingMonth(
                  budgetEditorOpen ? null : selectedMonth,
                )
              }
            >
              <FaPenToSquare aria-hidden="true" focusable="false" />
              <span className="budget-edit-label-full">
                {budgetEditorOpen ? "Done" : "Edit budget"}
              </span>
              <span className="budget-edit-label-compact">
                {budgetEditorOpen ? "Done" : "Edit"}
              </span>
            </button>
          )}
        </div>

        {monthBudget > 0 ? (
          <div className="budget-overview">
            <div className="budget-values">
              <div className="budget-spent-block">
                <span className="budget-caption">Spent this month</span>
                <strong className="budget-spent-value">
                  {formatCurrency(monthlyTotal)}
                </strong>
              </div>
              <div className="budget-limit-block">
                <span className="budget-caption">Monthly limit</span>
                <strong className="budget-limit-value">
                  {formatCurrency(monthBudget)}
                </strong>
              </div>
              <span
                className={`budget-percent${budgetPercentage > 100 ? " is-over" : ""}`}
              >
                {Math.round(budgetPercentage)}% used
              </span>
            </div>

            <div
              className={`budget-progress-track${budgetPercentage > 100 ? " is-over" : ""}`}
              role="progressbar"
              aria-label="Monthly budget used"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(budgetProgress)}
              aria-valuetext={`${Math.round(budgetPercentage)} percent of budget used`}
            >
              <div
                className="budget-progress-fill"
                style={{ width: `${budgetProgress}%` }}
              />
            </div>

            <div className="budget-footer">
              <strong
                className={`budget-balance${budgetPercentage > 100 ? " is-over" : ""}`}
              >
                {monthlyTotal <= monthBudget
                  ? `${formatCurrency(monthBudget - monthlyTotal)} left`
                  : `${formatCurrency(monthlyTotal - monthBudget)} over budget`}
              </strong>
              <span className="budget-status">
                {budgetPercentage > 100
                  ? "Spending is above your limit"
                  : "You’re within your limit"}
              </span>
            </div>
          </div>
        ) : (
          <p className="budget-empty">
            Set a monthly limit to keep spending on track.
          </p>
        )}

        <form
          className={`budget-form${monthBudget > 0 ? " has-budget" : " is-new"}`}
          id="budget-editor"
          hidden={!budgetEditorOpen}
          onSubmit={saveBudget}
        >
          <div className="budget-field">
            <label htmlFor="monthly-budget">Monthly limit (BDT)</label>
            <input
              id="monthly-budget"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 20000"
              required
              value={budgetAmount}
              onChange={(event) => setBudgetAmount(event.target.value)}
            />
          </div>
          <div className="budget-form-actions">
            <button type="submit">Save budget</button>
            {monthBudget > 0 && (
              <>
                <button
                  className="clear-budget"
                  type="button"
                  onClick={clearBudget}
                >
                  Clear
                </button>
                <button
                  className="budget-cancel"
                  type="button"
                  onClick={() => setBudgetEditingMonth(null)}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </form>
      </section>

      <section
        className="panel mobile-appearance-panel"
        data-mobile-page="more"
        aria-labelledby="appearance-title"
      >
        <div className="mobile-appearance-heading">
          <h2 id="appearance-title">Appearance</h2>
          <p>Choose the look that feels right.</p>
        </div>
        <button
          className="mobile-appearance-setting"
          type="button"
          role="switch"
          aria-checked={theme === "dark"}
          onClick={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
        >
          <span className="mobile-appearance-icon" aria-hidden="true">
            {theme === "dark" ? "☾" : "☀"}
          </span>
          <span className="mobile-appearance-copy">
            <strong>Dark mode</strong>
            <span>{theme === "dark" ? "On" : "Off"}</span>
          </span>
          <span className="mobile-appearance-switch" aria-hidden="true">
            <span />
          </span>
        </button>
      </section>

      <section
        className="panel mobile-profile-panel"
        data-mobile-page="profile"
        aria-labelledby="profile-title"
      >
        <div className="mobile-profile-hero">
          <span className="mobile-profile-avatar" aria-hidden="true">
            {pushUser ? userInitial(pushUser) : "L"}
          </span>
          <div className="mobile-profile-copy">
            <span className="mobile-profile-eyebrow">
              {pushUser ? "Spend account" : "Local profile"}
            </span>
            <h2 id="profile-title">
              {pushUser ? userDisplayName(pushUser) : "Local profile"}
            </h2>
            <p>
              {pushUser?.email || "Sign in to add your email and sync your account."}
            </p>
          </div>
        </div>
        <div className="mobile-profile-status">
          <span>Account status</span>
          <strong>{pushUser ? "Connected" : "Local only"}</strong>
        </div>
        {pushUser ? (
          <button
            className="mobile-profile-action"
            type="button"
            disabled={authBusy}
            onClick={signOutOfPush}
          >
            Sign out
          </button>
        ) : (
          <button
            className="mobile-profile-action"
            type="button"
            onClick={() => {
              setAuthStatus("");
              setAuthModalOpen(true);
            }}
          >
            Sign in to sync
          </button>
        )}
      </section>

      <section
        className="panel recurring-panel"
        data-mobile-page="recurring"
        aria-labelledby="recurring-title"
      >
        <div className="recurring-heading">
          <h2 id="recurring-title" className="recurring-title">
            Recurring expenses
          </h2>
          <div className="recurring-heading-actions">
            <a
              className="recurring-add-button"
              href="#expense-repeat"
              aria-label="Add a recurring expense"
              onClick={(event) => {
                if (window.matchMedia("(max-width: 800px)").matches) {
                  event.preventDefault();
                  navigateMobile("add");
                }
              }}
            >
              <span aria-hidden="true">＋</span>
              <span className="recurring-add-label">Add recurring</span>
            </a>
            <button
              className={
                "recurring-refresh-button" +
                (recurringRefreshBusy ? " is-busy" : "")
              }
              type="button"
              aria-label="Refresh recurring expenses"
              title="Refresh recurring expenses"
              onClick={refreshRecurringSchedules}
              disabled={recurringRefreshBusy}
            >
              <AccountIcon name="repeat" />
            </button>
          </div>
        </div>
        {recurringRefreshStatus && (
          <span className="recurring-refresh-status" role="status">
            {recurringRefreshStatus}
          </span>
        )}

        <div className="recurring-overview">
          <div
            className="recurring-overview-item recurring-overview-count"
            role="group"
            aria-label={activeRecurringCount + " active schedules"}
          >
            <strong className="recurring-overview-count-value">
              {activeRecurringCount}
            </strong>
            <span>active</span>
          </div>
          <div className="recurring-overview-item recurring-overview-total">
            <strong>{formatCurrency(monthlyRecurringTotal)}</strong>
            <span>monthly est.</span>
          </div>
          <div className="recurring-overview-item recurring-overview-next">
            <span className="recurring-overview-label">Next due</span>
            {nextRecurring ? (
              <>
                <strong>{nextRecurring.description}</strong>
                <span className="recurring-overview-date">
                  {formatDate(nextRecurring.nextDate)}
                </span>
              </>
            ) : (
              <strong className="recurring-overview-empty">
                No upcoming expenses
              </strong>
            )}
          </div>
        </div>

        {recurringSchedules.length ? (
          <>
            <h3 className="recurring-list-title">Your schedules</h3>
            <ul className="recurring-list">
            {orderedRecurringSchedules.map((schedule) => {
              const cadence =
                schedule.interval === "weekly" ? "Weekly" : "Monthly";
              return (
                <li className="recurring-row" key={schedule.id}>
                  <div className="recurring-info">
                    <span className="recurring-category-icon" aria-hidden="true">
                      <CategoryIcon category={schedule.category} />
                    </span>
                    <div className="recurring-text">
                      <div className="recurring-name">{schedule.description}</div>
                      <div className="recurring-tags">
                        <span>{schedule.active ? cadence : "Paused"}</span>
                        <span>{schedule.category}</span>
                        {isAccountId(schedule.account) && (
                          <span>{accountName(schedule.account)}</span>
                        )}
                      </div>
                      <div className="recurring-meta">
                        Next: {formatDate(schedule.nextDate)}
                      </div>
                    </div>
                  </div>
                  <span className="recurring-amount">
                    {formatCurrency(schedule.amount)}
                  </span>
                  <div className="recurring-actions">
                    <button
                      className="recurring-action"
                      type="button"
                      aria-label={`${schedule.active ? "Pause" : "Resume"} ${schedule.description}`}
                      onClick={() => {
                        setRecurringSchedules((current) =>
                          current.map((item) => {
                            if (item.id !== schedule.id) return item;
                            if (item.active) return { ...item, active: false };
                            let nextDate = item.nextDate;
                            let skipped = 0;
                            while (nextDate <= localDate() && skipped < 240) {
                              nextDate = nextOccurrenceDate(
                                nextDate,
                                item.interval,
                                item.dayOfMonth,
                              );
                              skipped += 1;
                            }
                            return { ...item, active: true, nextDate };
                          }),
                        );
                      }}
                    >
                      {schedule.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="recurring-action"
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove the schedule for “${schedule.description}”? Existing expenses will stay in your list.`,
                          )
                        )
                          return;
                        setRecurringSchedules((current) =>
                          current.filter((item) => item.id !== schedule.id),
                        );
                        setRecordDeleted(
                          "recurringSchedules",
                          schedule.id,
                          true,
                        );
                        offerUndo("Recurring expense removed", () => {
                          setRecordDeleted(
                            "recurringSchedules",
                            schedule.id,
                            false,
                          );
                          setRecurringSchedules((current) =>
                            current.some((item) => item.id === schedule.id)
                              ? current
                              : [...current, schedule],
                          );
                        });
                      }}
                    >
                      <span>Remove</span>
                    </button>
                  </div>
                </li>
              );
            })}
            </ul>
          </>
        ) : (
          <p className="recurring-empty">
            No recurring expenses yet. Add one from the expense form above.
          </p>
        )}
        <div className="recurring-settings">
          <div className="recurring-reminder-leading">
            <span className="recurring-reminder-icon" aria-hidden="true">
              <FaClockRotateLeft focusable="false" />
            </span>
            <div className="recurring-reminder-copy">
              <strong>Payment reminders</strong>
              <span>
                {backgroundPushEnabled
                  ? "On"
                  : pushBackendConfigured && !pushUser
                    ? "Sign in required"
                    : notificationPermission === "denied"
                      ? "Blocked"
                      : notificationPermission === "unsupported"
                        ? "Unavailable"
                        : notificationPermission === "granted"
                          ? "Allowed"
                          : "Off"}
              </span>
            </div>
          </div>
          <div className="recurring-settings-controls">
            {pushBackendConfigured && pushUser && (
              <div className="reminder-time-setting">
                <label className="sr-only" htmlFor="reminder-time">
                  Reminder time
                </label>
                <input
                  id="reminder-time"
                  type="time"
                  value={reminderTime}
                  onChange={(event) => updateReminderTime(event.target.value)}
                />
              </div>
            )}
            <div className="notification-controls">
              <label
                className="notification-toggle-label"
                title={
                  notificationPermission === "denied"
                    ? "Notifications are blocked in browser settings"
                    : notificationPermission === "unsupported"
                      ? "Notifications are unavailable in this browser"
                      : undefined
                }
              >
                <span className="sr-only">Background payment reminders</span>
                <input
                  className="notification-toggle"
                  type="checkbox"
                  role="switch"
                  checked={backgroundPushEnabled}
                  disabled={
                    !backgroundPushEnabled &&
                    (notificationPermission === "denied" ||
                      notificationPermission === "unsupported")
                  }
                  aria-label={
                    backgroundPushEnabled
                      ? "Disable background reminders"
                      : notificationPermission === "denied"
                        ? "Notifications blocked"
                        : notificationPermission === "unsupported"
                          ? "Notifications unavailable"
                          : pushBackendConfigured
                            ? "Enable background reminders"
                            : notificationPermission === "granted"
                              ? "Send a test notification"
                              : "Enable system notifications"
                  }
                  onChange={toggleNotifications}
                />
              </label>
            </div>
          </div>
        </div>
        {notificationStatus && (
          <p
            className="recurring-notification-status"
            role="status"
            aria-live="polite"
          >
            {notificationStatus}
          </p>
        )}
        {recurringReminder && (
          <p className="recurring-reminder" role="status" aria-live="polite">
            {recurringReminder}
          </p>
        )}
        {cloudSyncStatus &&
          (cloudSyncStatus.startsWith("Could not") ||
            cloudSyncStatus.startsWith("Newer cloud") ||
            cloudSyncStatus.includes("could not clear")) && (
            <p
              className="recurring-sync-warning"
              role="status"
              aria-live="polite"
            >
              {cloudSyncStatus}
            </p>
          )}
      </section>

      <section className="list-panel" data-mobile-page="activity" aria-labelledby="list-title">
        <div className="list-heading">
          <div className="list-heading-title">
            <h2 id="list-title">Expenses</h2>
            <span className="count">{countText}</span>
          </div>
          <button
            className="export-button"
            type="button"
            disabled={!visibleExpenses.length}
            title="Export the selected month and current filters as a CSV file"
            onClick={exportExpenses}
          >
            Export CSV
          </button>
        </div>
        <div className="filters">
          <input
            type="search"
            placeholder="Search expenses"
            aria-label="Search expenses"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </div>
        {visibleExpenses.length ? (
          <ul id="expense-list" aria-live="polite">
            {visibleExpenses.map((expense) => (
              <li
                className={`expense-row${expense.amount === null && editingExpenseId === expense.id ? " editing-amount" : ""}`}
                key={expense.id}
              >
                <span className="expense-icon" aria-hidden="true">
                  <CategoryIcon category={expense.category} />
                </span>
                <div className="expense-info">
                  <div className="expense-name">{expense.description}</div>
                  <div className="expense-date">
                    {expense.category} · {formatDate(expense.date)}
                    {isAccountId(expense.account)
                      ? ` · ${accountName(expense.account)}`
                      : ""}
                    {expense.recurringId ? " · Recurring" : ""}
                  </div>
                </div>
                <div className="expense-end">
                  {expense.amount === null ? (
                    editingExpenseId === expense.id ? (
                      <form
                        className="inline-amount-form"
                        aria-label={`Add amount for ${expense.description}`}
                        onSubmit={(event) =>
                          saveMissingExpenseAmount(event, expense)
                        }
                      >
                        <input
                          className="inline-amount-input"
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label="Amount"
                          required
                          autoFocus
                          value={editingAmount}
                          onChange={(event) =>
                            setEditingAmount(event.target.value)
                          }
                        />
                        <button className="inline-save" type="submit">
                          Save
                        </button>
                        <button
                          className="inline-cancel"
                          type="button"
                          onClick={() => {
                            setEditingExpenseId(null);
                            setEditingAmount("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="missing-amount">No amount</span>
                        <button
                          className="add-amount-button"
                          type="button"
                          aria-label={`Add amount for ${expense.description}`}
                          onClick={() => {
                            setEditingExpenseId(expense.id);
                            setEditingAmount("");
                          }}
                        >
                          Add amount
                        </button>
                      </>
                    )
                  ) : (
                    <div className="expense-amounts">
                      <span className="expense-amount">
                        {formatCurrency(expense.amount)}
                      </span>
                      {conversionReady && (
                        <span className="converted-row">
                          ≈{" "}
                          {formatCurrency(
                            Number(expense.amount) * conversionRate,
                            targetCurrency,
                          )}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    className="remove"
                    type="button"
                    aria-label={`Remove ${expense.description}`}
                    title="Remove expense"
                    onClick={() => removeExpense(expense)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            {monthExpenses.length === 0
              ? `No expenses recorded in ${formatMonth(selectedMonth)}. Add your first expense above to start your monthly summary.`
              : "No expenses match your search and category filter."}
          </div>
        )}
      </section>
      {undoAction && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{undoAction.label}</span>
          <button type="button" onClick={undoLastAction}>
            Undo
          </button>
        </div>
      )}

      <button
        className={`mobile-dock-backdrop${isMoreOpen ? " is-visible" : ""}`}
        type="button"
        aria-label="Close more menu"
        aria-hidden={!isMoreOpen}
        disabled={!isMoreOpen}
        tabIndex={isMoreOpen ? 0 : -1}
        onClick={() => setIsMoreOpen(false)}
      />
      <nav
        className={`mobile-dock${isMoreOpen ? " is-more-open" : ""}`}
        aria-label="Main navigation"
      >
        <div
          className="mobile-dock-menu"
          id="mobile-more-menu"
          role="menu"
          aria-label="More sections"
          aria-hidden={!isMoreOpen}
          inert={!isMoreOpen}
        >
          <div className="mobile-dock-menu-content">
            <div className="mobile-dock-menu-heading">
              <span>Options</span>
              <button
                type="button"
                aria-label="Close more menu"
                onClick={() => setIsMoreOpen(false)}
              >
                <FaCirclePlus aria-hidden="true" focusable="false" />
              </button>
            </div>
            <button
              className="mobile-dock-profile"
              type="button"
              role="menuitem"
              onClick={() => navigateMobile("profile")}
            >
              <span className="mobile-dock-profile-avatar" aria-hidden="true">
                {pushUser ? userInitial(pushUser) : "L"}
              </span>
              <span className="mobile-dock-profile-copy">
                <strong>
                  {pushUser ? userDisplayName(pushUser) : "Local profile"}
                </strong>
                <small>
                  {pushUser?.email || "Sign in to sync your account"}
                </small>
              </span>
              <span className="mobile-dock-profile-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => navigateMobile("budget")}
            >
              <FaCalendarDays aria-hidden="true" focusable="false" />
              <span>Budget</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => navigateMobile("recurring")}
            >
              <FaRepeat aria-hidden="true" focusable="false" />
              <span>Recurring expenses</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => navigateMobile("more")}
            >
              <FaPalette aria-hidden="true" focusable="false" />
              <span>Appearance</span>
            </button>
          </div>
        </div>
        <div className="mobile-dock-row">
          {[
            { id: "home", label: "Home", Icon: FaHouse },
            { id: "activity", label: "Activity", Icon: FaClockRotateLeft },
            { id: "add", label: "Add", Icon: FaCirclePlus },
            { id: "accounts", label: "Accounts", Icon: FaBuildingColumns },
          ].map(({ id, label, Icon }) => (
            <button
              className={`mobile-dock-item${id === "add" ? " mobile-dock-add" : ""}`}
              type="button"
              key={id}
              aria-current={mobileView === id ? "page" : undefined}
              onClick={() => navigateMobile(id)}
            >
              <Icon
                className="mobile-dock-icon"
                aria-hidden="true"
                focusable="false"
              />
              <span className="mobile-dock-label">{label}</span>
            </button>
          ))}
          <button
            className="mobile-dock-item"
            type="button"
            aria-expanded={isMoreOpen}
            aria-controls="mobile-more-menu"
            aria-current={
              ["budget", "more", "profile", "recurring"].includes(mobileView)
                ? "page"
                : undefined
            }
            onClick={() => setIsMoreOpen((open) => !open)}
          >
            <FaEllipsis
              className="mobile-dock-icon"
              aria-hidden="true"
              focusable="false"
            />
            <span className="mobile-dock-label">More</span>
          </button>
        </div>
      </nav>

    </main>
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
