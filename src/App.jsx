import { useEffect, useMemo, useRef, useState } from "react";
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
  syncBackgroundSchedules,
} from "./push.js";

import {
  CLOUD_SYNC_USER_KEY,
  deleteCloudData,
  loadCloudData,
  saveCloudData,
} from "./cloud-sync.js";

const CURRENCY_API = "https://api.frankfurter.dev/v2";
const LOCAL_DATA_OWNER_KEY = "spend-local-data-owner-v1";
const LOCAL_USER_SNAPSHOTS_KEY = "spend-local-user-snapshots-v1";

function AccountIcon({ name }) {
  const paths = {
    bkash: (
      <>
        <path d="M3 4.5 13.5 6 9.8 10.4 17 14 9.2 12.4 5.6 18 6.4 11.3 3 8.5l5.2.8Z" />
        <path d="m13.5 6 2.2 1.1-4.6 3.3" />
      </>
    ),
    bank: (
      <>
        <path d="m3 8 9-5 9 5" />
        <path d="M5 9v8M9 9v8M15 9v8M19 9v8M3 19h18M2 8h20" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h12" />
        <path d="M16 12h4M17 12a1 1 0 1 0 0 2" />
      </>
    ),
    transfer: (
      <>
        <path d="M3 8h15M14 4l4 4-4 4M21 16H6M10 12l-4 4 4 4" />
      </>
    ),
    history: (
      <>
        <path d="M4 8V3l-3 3 3 3" />
        <path d="M4 6a9 9 0 1 1-1 9" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    repeat: (
      <>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 11V9a3 3 0 0 1 3-3h15" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v2a3 3 0 0 1-3 3H3" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-13.7-5.7L4 7.5" />
        <path d="M4 3.5v4h4" />
        <path d="M4 13a8 8 0 0 0 13.7 5.7L20 16.5" />
        <path d="M20 20.5v-4h-4" />
      </>
    ),
  };
  return (
    name === "bkash" ? (
      <img
        className="account-icon account-icon-bkash"
        src={`${import.meta.env.BASE_URL}icons/bkash.svg`}
        alt=""
        aria-hidden="true"
      />
    ) : (
    <svg
      className={`account-icon account-icon-${name}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
    )
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

function shiftMonth(monthValue, offset) {
  const [year, month] = (monthValue || currentMonth()).split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return localDate(shifted).slice(0, 7);
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

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\t\r ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function mergeRecords(cloudRecords, localRecords) {
  const records = new Map(cloudRecords.map((record) => [record.id, record]));
  for (const record of localRecords) records.set(record.id, record);
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
    data.accountData.settings.balances.bank !== 0
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
  if (!preferLocal) {
    return {
      expenses: cloudExpenses,
      budgets: cloudBudgets,
      recurringSchedules: cloudSchedules,
      accountData: cloudAccounts,
      theme: cloud.theme === "dark" ? "dark" : "light",
      targetCurrency:
        typeof cloud.targetCurrency === "string" &&
        /^[A-Z]{3}$/.test(cloud.targetCurrency)
          ? cloud.targetCurrency
          : "USD",
    };
  }

  return {
    expenses: mergeRecords(cloudExpenses, local.expenses),
    budgets: { ...cloudBudgets, ...local.budgets },
    recurringSchedules: mergeRecords(cloudSchedules, local.recurringSchedules),
    accountData: {
      settings: hasMeaningfulLocalAccountSettings(local)
        ? local.accountData.settings
        : cloudAccounts.settings,
      transactions: mergeRecords(
        cloudAccounts.transactions,
        local.accountData.transactions,
      ),
    },
    theme: local.theme,
    targetCurrency: local.targetCurrency,
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
    theme: snapshot.theme === "dark" ? "dark" : "light",
    targetCurrency:
      typeof snapshot.targetCurrency === "string" &&
      /^[A-Z]{3}$/.test(snapshot.targetCurrency)
        ? snapshot.targetCurrency
        : "USD",
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
  const [theme, setTheme] = useState(loadTheme);
  const [targetCurrency, setTargetCurrency] = useState(loadCurrency);
  const [reminderTime, setReminderTime] = useState(loadReminderTime);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
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
  const [cloudSyncConflict, setCloudSyncConflict] = useState(false);
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
  const undoTimerRef = useRef(null);
  const authUserIdRef = useRef(null);
  const localDataOwnerRef = useRef(loadLocalDataOwner());
  cloudSnapshotRef.current = {
    expenses,
    budgets,
    recurringSchedules,
    accountData,
    theme,
    targetCurrency,
  };

  function resetDataForNewUser() {
    const empty = emptyAccountData();
    setExpenses([]);
    setBudgets({});
    setRecurringSchedules([]);
    setAccountData(empty);
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
    if (!owner) return;
    saveLocalUserSnapshot(owner, cloudSnapshotRef.current);
  }, [
    expenses,
    budgets,
    recurringSchedules,
    accountData,
    theme,
    targetCurrency,
  ]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.currency, targetCurrency);
    } catch {
      // The currency selection still applies until this page is closed.
    }
  }, [targetCurrency]);

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
          switchLocalUser(user.id);
        } else if (user && !localDataOwnerRef.current) {
          adoptLocalDataForUser(user.id);
        }
        authUserIdRef.current = user?.id ?? null;
        setPushUser(user);
        setCloudSyncReady(false);
        setCloudSyncEnabled(Boolean(user));
        setCloudSyncConflict(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user || null;
      setPushUser(user);
      if (authUserIdRef.current === user?.id) return;
      if (user && localDataOwnerRef.current !== user.id) {
        switchLocalUser(user.id);
      } else if (user && !localDataOwnerRef.current) {
        adoptLocalDataForUser(user.id);
      }
      authUserIdRef.current = user?.id ?? null;
      setBackgroundPushEnabled(false);
      setCloudSyncReady(false);
      cloudVersionRef.current = null;
      setCloudSyncEnabled(Boolean(user));
      setCloudSyncConflict(false);
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
        let firstSyncConfirmed = false;
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
          if (
            !remote &&
            !firstSyncConfirmed &&
            hasMeaningfulLocalData(local) &&
            !window.confirm(
              "Your local expenses and account data will be synced to this account. Continue?",
            )
          ) {
            setCloudSyncEnabled(false);
            setCloudSyncReady(false);
            setCloudSyncStatus(
              "Cloud sync paused. Your local data remains on this device.",
            );
            return;
          }
          firstSyncConfirmed = true;
          try {
            savedVersion = await saveCloudData(
              pushUser.id,
              merged,
              remote?.updated_at ?? null,
            );
          } catch (error) {
            if (error.code !== "23505" || remote) throw error;
          }
          if (savedVersion) break;
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
        setCloudSyncConflict(false);
        setCloudSyncStatus("Cloud sync is on. Your data is saved to Supabase.");
      } catch (error) {
        if (active) {
          setCloudSyncEnabled(false);
          setCloudSyncReady(false);
          setCloudSyncConflict(false);
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
    const snapshot = cloudSnapshotRef.current;
    const timeout = window.setTimeout(async () => {
      try {
        const savedVersion = await saveCloudData(
          pushUser.id,
          snapshot,
          cloudVersionRef.current,
        );
        if (!savedVersion) {
          cloudVersionRef.current = null;
          setCloudSyncReady(false);
          setCloudSyncConflict(true);
          setCloudSyncStatus(
            "Newer cloud data was found on another device. Refresh to load it before editing more.",
          );
          return;
        }
        cloudVersionRef.current = savedVersion;
        setCloudSyncStatus("Cloud sync is on. Your data is saved to Supabase.");
      } catch (error) {
        setCloudSyncConflict(false);
        setCloudSyncStatus(`Could not sync your data: ${error.message}`);
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
    targetCurrency,
    theme,
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
  const nextRecurring = useMemo(
    () =>
      recurringSchedules
        .filter((schedule) => schedule.active && schedule.nextDate >= localDate())
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0] || null,
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

  const monthBudget = Number(budgets[selectedMonth] || 0);
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
        const exists = nextExpenses.some(
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

  function handleExpenseSubmit(event) {
    event.preventDefault();
    const description = expenseForm.description.trim();
    const rawAmount = expenseForm.amount.trim();
    const amount = rawAmount === "" ? null : Number(rawAmount);
    if (
      !description ||
      !isValidDateString(expenseForm.date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (expenseForm.interval !== "none" && amount === null)
    ) {
      setExpenseMessage(
        expenseForm.interval !== "none" && amount === null
          ? "Recurring expenses need an amount."
          : "Check the description, amount, and date, then try again.",
      );
      return;
    }
    setExpenseMessage("");
    if (expenseForm.interval === "none") {
      setExpenses((current) => [
        ...current,
        {
          id: makeId(),
          description,
          amount: amount === null ? null : roundMoney(amount),
          category: expenseForm.category,
          date: expenseForm.date,
          account: expenseForm.account,
        },
      ]);
    } else {
      const scheduleId = makeId();
      let nextDate = expenseForm.date;
      const today = localDate();
      const generatedExpenses = [];
      let generated = 0;
      while (nextDate <= today && generated < 240) {
        generatedExpenses.push({
          id: makeId(),
          description,
          amount: roundMoney(amount),
          category: expenseForm.category,
          date: nextDate,
          account: expenseForm.account,
          recurringId: scheduleId,
        });
        nextDate = nextOccurrenceDate(
          nextDate,
          expenseForm.interval,
          Number(expenseForm.date.slice(-2)),
        );
        generated += 1;
      }
      setRecurringSchedules((current) => [
        ...current,
        {
          id: scheduleId,
          description,
          amount: roundMoney(amount),
          category: expenseForm.category,
          interval: expenseForm.interval,
          account: expenseForm.account,
          dayOfMonth: Number(expenseForm.date.slice(-2)),
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
    setSelectedMonth(expenseForm.date.slice(0, 7));
    setExpenseForm(makeExpenseForm());
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

  function removeAccountActivity(activity) {
    if (activity.type === "expense") {
      setExpenses((current) =>
        current.filter((item) => item.id !== activity.id),
      );
    } else {
      setAccountData((current) => ({
        ...current,
        transactions: current.transactions.filter(
          (item) => item.id !== activity.id,
        ),
      }));
    }
  }

  function saveBudget(event) {
    event.preventDefault();
    const amount = Number(budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBudgets((current) => ({
      ...current,
      [selectedMonth]: roundMoney(amount),
    }));
  }

  function clearBudget() {
    const previousBudget = budgets[selectedMonth];
    setBudgets((current) => {
      const next = { ...current };
      delete next[selectedMonth];
      return next;
    });
    if (previousBudget) offerUndo("Budget cleared", () =>
      setBudgets((current) => ({ ...current, [selectedMonth]: previousBudget })),
    );
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
        theme,
        targetCurrency,
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
        !/^[A-Z]{3}$/.test(data.targetCurrency)
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
      setTheme(data.theme);
      setTargetCurrency(data.targetCurrency);
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
    setTheme(snapshot.theme);
    setTargetCurrency(snapshot.targetCurrency);
  }

  function disableCloudSync() {
    try {
      localStorage.removeItem(CLOUD_SYNC_USER_KEY);
      setCloudSyncEnabled(false);
      setCloudSyncReady(false);
      setCloudSyncStatus(
        "Cloud sync is off. Your existing Supabase copy is kept; local data remains on this device.",
      );
    } catch (error) {
      setCloudSyncStatus(`Could not disable cloud sync: ${error.message}`);
    }

    function retryCloudSync() {
      setCloudSyncConflict(false);
      setCloudSyncReady(false);
      setCloudSyncEnabled(true);
      setCloudSyncRetry((retry) => retry + 1);
    }
  }

  async function refreshAccounts() {
      if (accountRefreshBusy) return;
      setAccountRefreshBusy(true);
      setAccountRefreshStatus("Refreshing account balances…");
      try {
        const localAccountData = loadAccountData();
        setAccountData(localAccountData);
        setStartingBalances({
          bkash: String(localAccountData.settings.balances.bkash),
          bank: String(localAccountData.settings.balances.bank),
          date: localAccountData.settings.startDate,
        });

        if (pushUser && cloudSyncEnabled && cloudSyncReady) {
          const remote = await loadCloudData(pushUser.id);
          if (remote?.data) {
            const refreshed = mergeCloudSnapshots(
              cloudSnapshotRef.current,
              remote.data,
              false,
            );
            applyCloudSnapshot(refreshed);
            setAccountData(refreshed.accountData);
            cloudVersionRef.current = remote.updated_at ?? cloudVersionRef.current;
            setCloudSyncStatus("Cloud data refreshed from Supabase.");
          }

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
        const remote = await loadCloudData(pushUser.id);
        if (!remote?.data) {
          throw new Error("No cloud data was returned.");
        }
        setRecurringSchedules(
          loadRecurringSchedules(remote.data.recurringSchedules ?? []),
        );
        cloudVersionRef.current = remote.updated_at ?? cloudVersionRef.current;
        setCloudSyncStatus("Cloud data refreshed from Supabase.");
        setRecurringRefreshStatus(
          "Recurring expenses refreshed from Supabase.",
        );
      } else {
        setRecurringSchedules(loadRecurringSchedules());
        setRecurringRefreshStatus(
          "Recurring expenses refreshed on this device.",
        );
      }
    } catch (error) {
      setRecurringRefreshStatus(
        `Could not refresh recurring expenses: ${error.message}`,
      );
    } finally {
      setRecurringRefreshBusy(false);
    }
  }

  async function removeCloudCopy() {
    if (!pushUser) return;
    if (
      !window.confirm(
        "Delete your synced expense data from Supabase? Local data on this device will remain.",
      )
    )
      return;

    setAuthBusy(true);
    try {
      localStorage.removeItem(CLOUD_SYNC_USER_KEY);
      setCloudSyncEnabled(false);
      setCloudSyncReady(false);
      cloudVersionRef.current = null;
      await deleteCloudData(pushUser.id);
      setCloudSyncStatus(
        "The Supabase copy was deleted. Local data on this device is unchanged.",
      );
    } catch (error) {
      setCloudSyncStatus(
        `Could not delete the Supabase copy: ${error.message}`,
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthStatus("");
    try {
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
        `Could not ${authMode === "sign-up" ? "create account" : "sign in"}: ${error.message}`,
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutOfPush() {
    if (!supabase || !pushUser) return;
    setAuthBusy(true);
    try {
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

  const countText =
    visibleExpenses.length === monthExpenses.length
      ? `${visibleExpenses.length} ${visibleExpenses.length === 1 ? "expense" : "expenses"}`
      : `${visibleExpenses.length} of ${monthExpenses.length} shown`;

  return (
    <main>
      <header>
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
            <span>
              {!pushUser
                ? "Local only"
                : !cloudSyncEnabled
                  ? "Cloud sync paused"
                  : cloudSyncReady
                    ? "Cloud sync on"
                    : "Syncing…"}
            </span>
          </div>
          <div
            className={`header-actions${pushUser ? " is-authenticated" : ""}`}
          >
            {pushBackendConfigured &&
              (pushUser ? (
                <div className="header-account">
                  <span className="header-avatar" aria-hidden="true">
                    {pushUser.email?.trim().slice(0, 1).toUpperCase() || "A"}
                  </span>
                  <span className="header-user" title={pushUser.email}>
                    {userDisplayName(pushUser)}
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
              ) : (
                <button
                  className="header-account-action"
                  type="button"
                  ref={authTriggerRef}
                  onClick={() => {
                    setAuthStatus("");
                    setAuthModalOpen(true);
                  }}
                >
                  Sign in
                </button>
              ))}
          </div>
        </div>
      </header>
      {authModalOpen && !pushUser && (
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
                    : "Sign in to Spend"}
                </h2>
                <p>Use your account for reminders and optional cloud sync.</p>
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
                <div>
                  <label htmlFor="push-password">Password</label>
                  <input
                    id="push-password"
                    type="password"
                    autoComplete={
                      authMode === "sign-up"
                        ? "new-password"
                        : "current-password"
                    }
                    minLength="6"
                    required
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                  />
                </div>
              </div>
              <div className="push-auth-actions">
                <button type="submit" disabled={authBusy}>
                  {authBusy
                    ? "Please wait…"
                    : authMode === "sign-up"
                      ? "Create account"
                      : "Sign in"}
                </button>
                <button
                  className="push-account-action"
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    setAuthMode((mode) =>
                      mode === "sign-up" ? "sign-in" : "sign-up",
                    );
                    setAuthStatus("");
                  }}
                >
                  {authMode === "sign-up"
                    ? "I already have an account"
                    : "Create an account"}
                </button>
              </div>
            </form>
            {authStatus && (
              <p className="auth-modal-status" role="status" aria-live="polite">
                {authStatus}
              </p>
            )}
          </section>
        </div>
      )}

      <section className="summary" aria-labelledby="summary-title">
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
                <span>{formatMonth(selectedMonth)}</span>
                <span className="month-calendar-icon" />
              </span>
              <input
                className="month-picker"
                type="month"
                aria-label="Choose month"
                title="Choose month"
                value={selectedMonth}
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

      <section className="panel" aria-labelledby="form-title">
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

      <section className="panel" aria-labelledby="accounts-title">
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

      <section className="panel" aria-labelledby="budget-title">
        <h2 id="budget-title">Monthly budget</h2>
        <p className="currency-hint">
          For {formatMonth(selectedMonth)}. All expenses in this month count
          toward the budget.
        </p>
        <form className="budget-form" onSubmit={saveBudget}>
          <div className="budget-field">
            <label htmlFor="monthly-budget">Budget (BDT)</label>
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
          <button type="submit">Save budget</button>
          {monthBudget > 0 && (
            <button
              className="clear-budget"
              type="button"
              onClick={clearBudget}
            >
              Clear
            </button>
          )}
        </form>
        {monthBudget > 0 ? (
          <div className="budget-meter">
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Monthly budget used"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(budgetProgress)}
              aria-valuetext={`${Math.round(budgetPercentage)} percent of budget used`}
            >
              <div
                className="progress-fill"
                style={{
                  width: `${budgetProgress}%`,
                  background:
                    budgetPercentage > 100 ? "var(--danger)" : "var(--green)",
                }}
              />
            </div>
            <div className="budget-summary">
              <span>{formatCurrency(monthlyTotal)} spent</span>
              <span>
                {monthlyTotal <= monthBudget
                  ? `${formatCurrency(monthBudget - monthlyTotal)} left`
                  : `${formatCurrency(monthlyTotal - monthBudget)} over budget`}
              </span>
            </div>
          </div>
        ) : (
          <p className="budget-empty">
            Add a budget to track your monthly spending.
          </p>
        )}
      </section>

      <section
        className="panel recurring-panel"
        aria-labelledby="recurring-title"
      >
        <h2 id="recurring-title" className="recurring-title">
          Recurring expenses
          <button
            className={`recurring-refresh-button${recurringRefreshBusy ? " is-busy" : ""}`}
            type="button"
            aria-label="Refresh recurring expenses"
            title="Refresh recurring expenses"
            onClick={refreshRecurringSchedules}
            disabled={recurringRefreshBusy}
          >
            <AccountIcon name="repeat" />
          </button>
        </h2>
        {recurringRefreshStatus && (
          <span className="recurring-refresh-status" role="status">
            {recurringRefreshStatus}
          </span>
        )}
        <div className="recurring-callout">
          <div className="recurring-callout-copy">
            <span className="recurring-callout-icon" aria-hidden="true">i</span>
            <p className="currency-hint">
              Weekly/monthly expenses are added when due. Sign in for reminders
              while closed.
            </p>
          </div>
        {recurringReminder && (
          <p className="recurring-reminder" role="status" aria-live="polite">
            {recurringReminder}
          </p>
        )}
        {pushBackendConfigured ? (
          <>
            <p className="push-setup-note">
              Reminder settings use Supabase. Expenses sync automatically when
              you are signed in.
            </p>
            {pushUser ? (
              <div className="cloud-sync-panel">
                <h3>Expense cloud sync</h3>
                <p className="push-setup-note">
                  Expenses, budgets, schedules, accounts and transactions sync
                  to Supabase automatically while you are signed in. A copy
                  stays on this device.
                </p>
                <div className="push-auth-actions">
                  <button
                    className="push-account-action"
                    type="button"
                    disabled={authBusy}
                    onClick={disableCloudSync}
                  >
                    Pause cloud sync
                  </button>
                  <button
                    className="push-account-action"
                    type="button"
                    disabled={authBusy}
                    onClick={removeCloudCopy}
                  >
                    Delete cloud copy
                  </button>
                </div>
                {cloudSyncStatus && (
                  <p className="backup-status" role="status" aria-live="polite">
                    {cloudSyncStatus}
                  </p>
                )}
                {cloudSyncConflict && (
                  <button
                    className="push-account-action"
                    type="button"
                    onClick={retryCloudSync}
                  >
                    Refresh cloud data
                  </button>
                )}
              </div>
            ) : (
              <p className="push-setup-note">
                Sign in for automatic cloud sync and background reminders.
              </p>
            )}
          </>
        ) : (
          <p className="push-setup-note">
            Background reminders are not configured. Notifications work while
            Spend is open.
          </p>
        )}
        {pushUser && authStatus && (
          <p
            className="notification-status push-auth-status"
            role="status"
            aria-live="polite"
          >
            {authStatus}
          </p>
        )}
          <div className="notification-controls">
          <button
            className="notification-button"
            type="button"
            disabled={
              !backgroundPushEnabled &&
              (notificationPermission === "denied" ||
                notificationPermission === "unsupported")
            }
            onClick={toggleNotifications}
          >
            {backgroundPushEnabled
              ? "Disable background reminders"
              : notificationPermission === "denied"
                ? "Notifications blocked"
                : notificationPermission === "unsupported"
                  ? "Notifications unavailable"
                  : pushBackendConfigured
                    ? "Enable background reminders"
                    : notificationPermission === "granted"
                      ? "Send test notification"
                      : "Enable system notifications"}
          </button>
          <p className="notification-status" role="status" aria-live="polite">
            {notificationStatus}
          </p>
          </div>
        </div>
        {pushBackendConfigured && pushUser && (
          <div className="reminder-time-setting">
            <label htmlFor="reminder-time">Reminder time</label>
            <input
              id="reminder-time"
              type="time"
              value={reminderTime}
              aria-describedby="reminder-time-help"
              onChange={(event) => updateReminderTime(event.target.value)}
            />
            <p className="notification-status" id="reminder-time-help">
              All background reminders on this device use local time.
            </p>
          </div>
        )}
        {recurringSchedules.length ? (
          <>
            <h3 className="recurring-list-title">Active recurring expenses</h3>
            <ul className="recurring-list">
            {recurringSchedules.map((schedule) => {
              const cadence =
                schedule.interval === "weekly" ? "Weekly" : "Monthly";
              return (
                <li className="recurring-row" key={schedule.id}>
                  <div className="recurring-info">
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
                        offerUndo("Recurring expense removed", () =>
                          setRecurringSchedules((current) => [
                            ...current,
                            schedule,
                          ]),
                        );
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
            Set a weekly or monthly schedule when adding an expense.
          </p>
        )}
      </section>

      <section className="list-panel" aria-labelledby="list-title">
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
                  ↗
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
                    onClick={() => {
                      setExpenses((current) =>
                        current.filter((item) => item.id !== expense.id),
                      );
                      offerUndo("Expense removed", () =>
                        setExpenses((current) => [...current, expense]),
                      );
                    }}
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

    </main>
  );
}
