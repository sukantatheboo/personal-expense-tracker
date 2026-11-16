import {
  Component,
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
import WelcomeFlow from "./components/WelcomeFlow.jsx";
import {
  computeAccountBalances,
  emptyAccountData,
  STORAGE_KEYS,
  currentMonth,
  formatDate,
  getSavingsAccountId,
  isAccountId,
  isPhantomAutoReconstructedCard,
  isSavingsCard,
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
  checkSupabaseSqlHealth,
  clearCloudSyncOutbox,
  createBackupCheckpoint,
  ensureDailyBackupCheckpoint,
  flushCloudSyncKeepalive,
  hasPendingCloudOutbox,
  hasPotentialCloudSession,
  listBackupCheckpoints,
  loadCloudData,
  persistCloudSyncOutbox,
  readCloudSyncOutbox,
  restoreBackupCheckpoint,
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

import "./MobilePrototype.css";
import MobilePrototype from "./MobilePrototype.jsx";

const resolvedMobilePrototype = MobilePrototype;
const loadMobilePrototype = () => Promise.resolve(MobilePrototype);

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            fontFamily: "Manrope, system-ui, sans-serif",
            color: "var(--ink, #18201b)",
            background: "var(--bg, #f4f3ee)",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: "18px" }}>
            Unable to open Spend
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: "13px", opacity: 0.75, maxWidth: "320px" }}>
            {this.state.error?.message || "A startup error occurred."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 18px",
              borderRadius: "12px",
              border: "none",
              background: "#161d2b",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
const WELCOME_SEEN_STORAGE_KEY = "spend:welcome-seen";
let welcomeSeenInMemory = false;

function readWelcomeSeen() {
  if (welcomeSeenInMemory) return true;
  try {
    if (localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) === "1") {
      welcomeSeenInMemory = true;
      return true;
    }
  } catch {
    // Fall back to in-memory state when localStorage is unavailable.
  }
  return false;
}

function markWelcomeSeen() {
  welcomeSeenInMemory = true;
  try {
    localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
  } catch {
    // In-memory fallback keeps the welcome flow from looping in this session.
  }
}

function isDevForcedWelcome() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("welcome") === "1";
  } catch {
    return false;
  }
}

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
    const winningTime = chooseLocal ? localTime : cloudTime;
    const tombstone = deletedChanges?.[month];
    if (tombstone?.deleted) {
      const tombstoneTime = Number(tombstone.updatedAt) || 0;
      if (winningTime === 0 || tombstoneTime >= winningTime) {
        continue;
      }
    }
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
    if (!cloudRecord) {
      if (preferLocalOnTie) {
        records.set(record.id, record);
      }
    } else if (preferLocalRecord(record, cloudRecord, preferLocalOnTie)) {
      records.set(record.id, record);
    }
  }
  return [...records.values()].filter(
    (record) => !isRecordDeleted(deletedChanges, record.id),
  );
}

function stripCloudRemovedRecordsFromLocal(local, previousCloud, remoteData) {
  if (!local || !previousCloud || !remoteData) return local;
  const prevTxMap = new Map(
    (previousCloud?.accountData?.transactions || [])
      .filter((t) => t?.id)
      .map((t) => [t.id, t]),
  );
  const remoteTxIds = new Set(
    (remoteData?.accountData?.transactions || [])
      .map((t) => t?.id)
      .filter(Boolean),
  );
  const prevExpMap = new Map(
    (previousCloud?.expenses || [])
      .filter((e) => e?.id)
      .map((e) => [e.id, e]),
  );
  const remoteExpIds = new Set(
    (remoteData?.expenses || []).map((e) => e?.id).filter(Boolean),
  );
  const filteredLocalTx = (local?.accountData?.transactions || []).filter(
    (tx) => {
      if (!tx?.id || remoteTxIds.has(tx.id)) return true;
      const prevTx = prevTxMap.get(tx.id);
      if (!prevTx) return true;
      return recordUpdatedAt(tx) > recordUpdatedAt(prevTx);
    },
  );
  const filteredLocalExp = (local?.expenses || []).filter((exp) => {
    if (!exp?.id || remoteExpIds.has(exp.id)) return true;
    const prevExp = prevExpMap.get(exp.id);
    if (!prevExp) return true;
    return recordUpdatedAt(exp) > recordUpdatedAt(prevExp);
  });
  return {
    ...local,
    expenses: filteredLocalExp,
    accountData: {
      ...local.accountData,
      transactions: filteredLocalTx,
    },
  };
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
    (left.primaryCardId || "") === (right.primaryCardId || "") &&
    JSON.stringify(
      stableSnapshotValue(left.openingBalances || left.balances || {}),
    ) ===
      JSON.stringify(
        stableSnapshotValue(right.openingBalances || right.balances || {}),
      ) &&
    JSON.stringify(stableSnapshotValue(left.currentBalances || {})) ===
      JSON.stringify(stableSnapshotValue(right.currentBalances || {})) &&
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
    ? localSettings.cards.filter((c) => !isPhantomAutoReconstructedCard(c))
    : [];
  const cloudCards = Array.isArray(cloudSettings.cards)
    ? cloudSettings.cards.filter((c) => !isPhantomAutoReconstructedCard(c))
    : [];
  const deletedCardTombstones = deletedRecords.cards || {};
  const cloudHasConfiguredCards = Boolean(
    cloudSettings.cardsConfigured || cloudCards.length > 0,
  );

  // Reconcile singleton Savings Vault across local and cloud if they have different IDs
  const remappedAccountIds = {};
  const localSavingsCard = localCards.find(isSavingsCard);
  const cloudSavingsCard = cloudCards.find(isSavingsCard);
  let winningSavingsId = null;
  if (
    localSavingsCard &&
    cloudSavingsCard &&
    localSavingsCard.id !== cloudSavingsCard.id
  ) {
    const localWinsSavings = preferLocal
      ? preferLocalRecord(localSavingsCard, cloudSavingsCard, true)
      : recordUpdatedAt(localSavingsCard) > recordUpdatedAt(cloudSavingsCard);
    if (localWinsSavings) {
      winningSavingsId = localSavingsCard.id;
      remappedAccountIds[cloudSavingsCard.id] = localSavingsCard.id;
    } else {
      winningSavingsId = cloudSavingsCard.id;
      remappedAccountIds[localSavingsCard.id] = cloudSavingsCard.id;
    }
  }

  const cardMap = new Map();
  for (const card of cloudCards) {
    if (!card?.id) continue;
    if (remappedAccountIds[card.id]) continue;
    const tombstone = deletedCardTombstones[card.id];
    const cardTime = recordUpdatedAt(card);
    if (tombstone?.deleted && tombstone.updatedAt >= cardTime) continue;
    cardMap.set(card.id, card);
  }
  const cloudSettingsTime = recordUpdatedAt(cloudSettings);
  for (const card of localCards) {
    if (!card?.id) continue;
    if (remappedAccountIds[card.id]) continue;
    const tombstone = deletedCardTombstones[card.id];
    const cardTime = recordUpdatedAt(card);
    if (tombstone?.deleted && tombstone.updatedAt >= cardTime) continue;
    const cloudCard = cardMap.get(card.id);
    if (!cloudCard) {
      // Keep local-only cards when local changes are preferred, cloud has no cards yet, or card was created newer than cloud settings
      if (
        preferLocal ||
        !cloudHasConfiguredCards ||
        (cardTime > 0 && cardTime > cloudSettingsTime)
      ) {
        cardMap.set(card.id, card);
      }
    } else if (preferLocalRecord(card, cloudCard, preferLocal)) {
      cardMap.set(card.id, card);
    }
  }

  const localBalances =
    localSettings.openingBalances &&
    typeof localSettings.openingBalances === "object" &&
    Object.keys(localSettings.openingBalances).length > 0
      ? localSettings.openingBalances
      : localSettings.balances && typeof localSettings.balances === "object"
        ? localSettings.balances
        : {};
  const cloudBalances =
    cloudSettings.openingBalances &&
    typeof cloudSettings.openingBalances === "object" &&
    Object.keys(cloudSettings.openingBalances).length > 0
      ? cloudSettings.openingBalances
      : cloudSettings.balances && typeof cloudSettings.balances === "object"
        ? cloudSettings.balances
        : {};

  const resolveCardBalance = (cardId, cardObj, balancesObj) => {
    const hasBalKey =
      Object.hasOwn(balancesObj, cardId) &&
      balancesObj[cardId] !== undefined &&
      balancesObj[cardId] !== null &&
      Number.isFinite(Number(balancesObj[cardId]));
    const hasCardInit =
      cardObj?.initialBalance !== undefined &&
      cardObj?.initialBalance !== null &&
      String(cardObj.initialBalance).trim() !== "" &&
      Number.isFinite(Number(cardObj.initialBalance));
    if (hasBalKey && hasCardInit) {
      const bVal = roundMoney(Math.max(0, Number(balancesObj[cardId])));
      const cVal = roundMoney(Math.max(0, Number(cardObj.initialBalance)));
      if (bVal === 0 && cVal > 0) return cVal;
      return bVal;
    }
    if (hasBalKey) return roundMoney(Math.max(0, Number(balancesObj[cardId])));
    if (hasCardInit) return roundMoney(Math.max(0, Number(cardObj.initialBalance)));
    return 0;
  };

  const mergedBalances = {};
  for (const [id, winningCard] of cardMap.entries()) {
    const localCard =
      localCards.find((c) => c?.id === id) ||
      (winningSavingsId === id ? localSavingsCard : null);
    const cloudCard =
      cloudCards.find((c) => c?.id === id) ||
      (winningSavingsId === id ? cloudSavingsCard : null);

    const localBalKey =
      localCard && Object.hasOwn(localBalances, localCard.id)
        ? localCard.id
        : id;
    const cloudBalKey =
      cloudCard && Object.hasOwn(cloudBalances, cloudCard.id)
        ? cloudCard.id
        : id;

    if (localCard && cloudCard) {
      const useLocal = preferLocalRecord(localCard, cloudCard, preferLocal);
      mergedBalances[id] = useLocal
        ? resolveCardBalance(localBalKey, localCard, localBalances)
        : resolveCardBalance(cloudBalKey, cloudCard, cloudBalances);
    } else if (cloudCard) {
      mergedBalances[id] = resolveCardBalance(
        cloudBalKey,
        cloudCard,
        cloudBalances,
      );
    } else if (localCard) {
      mergedBalances[id] = resolveCardBalance(
        localBalKey,
        localCard,
        localBalances,
      );
    } else {
      mergedBalances[id] = roundMoney(
        Math.max(0, Number(winningCard?.initialBalance) || 0),
      );
    }
  }

  const localTime = recordUpdatedAt(localSettings);
  const cloudTime = recordUpdatedAt(cloudSettings);
  const preferLocalCards = preferLocal
    ? localTime >= cloudTime || !cloudHasConfiguredCards
    : false;
  const primaryCards = preferLocalCards ? localCards : cloudCards;
  const secondaryCards = preferLocalCards ? cloudCards : localCards;

  const orderedCardIds = [];
  const seenIds = new Set();
  for (const card of primaryCards) {
    const mappedId = remappedAccountIds[card?.id] || card?.id;
    if (mappedId && cardMap.has(mappedId) && !seenIds.has(mappedId)) {
      orderedCardIds.push(mappedId);
      seenIds.add(mappedId);
    }
  }
  for (const card of secondaryCards) {
    const mappedId = remappedAccountIds[card?.id] || card?.id;
    if (mappedId && cardMap.has(mappedId) && !seenIds.has(mappedId)) {
      orderedCardIds.push(mappedId);
      seenIds.add(mappedId);
    }
  }
  for (const id of cardMap.keys()) {
    if (!seenIds.has(id)) {
      orderedCardIds.push(id);
      seenIds.add(id);
    }
  }
  const rawMergedCards = orderedCardIds.map((id) => {
    const card = cardMap.get(id);
    return {
      ...card,
      initialBalance: mergedBalances[id] ?? roundMoney(Number(card?.initialBalance) || 0),
    };
  });
  const preferredPrimaryId = preferLocalCards
    ? localSettings.primaryCardId || cloudSettings.primaryCardId
    : cloudSettings.primaryCardId || localSettings.primaryCardId;
  const mappedPreferredPrimaryId =
    (preferredPrimaryId && remappedAccountIds[preferredPrimaryId]) ||
    preferredPrimaryId;
  const resolvedPrimaryCardId =
    (typeof mappedPreferredPrimaryId === "string" &&
      cardMap.has(mappedPreferredPrimaryId) &&
      !isSavingsCard(cardMap.get(mappedPreferredPrimaryId)) &&
      mappedPreferredPrimaryId) ||
    rawMergedCards.find((c) => c?.isPrimary && !isSavingsCard(c))?.id ||
    "";

  const mergedCards = rawMergedCards.map((card) => ({
    ...card,
    isPrimary: Boolean(
      resolvedPrimaryCardId && card.id === resolvedPrimaryCardId,
    ),
    initialBalance: mergedBalances[card.id] ?? 0,
  }));

  return {
    startDate:
      localSettings.startDate && cloudSettings.startDate
        ? localSettings.startDate < cloudSettings.startDate
          ? localSettings.startDate
          : cloudSettings.startDate
        : localSettings.startDate || cloudSettings.startDate || localDate(),
    balances: mergedBalances,
    openingBalances: mergedBalances,
    cards: mergedCards,
    ...(resolvedPrimaryCardId ? { primaryCardId: resolvedPrimaryCardId } : {}),
    configured: Boolean(
      localSettings.configured ||
        cloudSettings.configured ||
        mergedCards.length > 0,
    ),
    cardsConfigured: Boolean(
      localSettings.cardsConfigured ||
        cloudSettings.cardsConfigured ||
        mergedCards.length > 0,
    ),
    updatedAt: Math.max(localTime, cloudTime),
    ...(Object.keys(remappedAccountIds).length > 0
      ? { remappedAccountIds }
      : {}),
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

function remapSnapshotAccountReferences(
  expensesList,
  schedulesList,
  transactionsList,
  remappedIds = {},
) {
  if (!remappedIds || Object.keys(remappedIds).length === 0) {
    return {
      expenses: expensesList,
      recurringSchedules: schedulesList,
      transactions: transactionsList,
    };
  }
  const mapId = (id) => (id && remappedIds[id] ? remappedIds[id] : id);
  return {
    expenses: expensesList.map((e) =>
      e?.account && remappedIds[e.account]
        ? { ...e, account: mapId(e.account) }
        : e,
    ),
    recurringSchedules: schedulesList.map((s) =>
      s?.account && remappedIds[s.account]
        ? { ...s, account: mapId(s.account) }
        : s,
    ),
    transactions: transactionsList
      .map((t) => {
        if (!t) return t;
        const nextAcct = mapId(t.account);
        const nextFrom = mapId(t.fromAccount);
        const nextTo = mapId(t.toAccount);
        return {
          ...t,
          ...(nextAcct ? { account: nextAcct } : {}),
          ...(nextFrom ? { fromAccount: nextFrom } : {}),
          ...(nextTo ? { toAccount: nextTo } : {}),
        };
      })
      .filter(
        (t) =>
          t.type !== "transfer" ||
          (t.fromAccount && t.toAccount && t.fromAccount !== t.toAccount),
      ),
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
    cloud.expenses,
  );
  const rawMergedSettings = mergeAccountSettings(
    local.accountData.settings,
    cloudAccounts.settings,
    deletedRecords,
    preferLocal ? preferLocalAccountSettings : false,
  );
  const {
    remappedAccountIds: settingsRemappedIds,
    ...mergedAccountSettingsResult
  } = rawMergedSettings;
  const combinedRemappedIds = {
    ...(cloudAccounts.remappedAccountIds || {}),
    ...(local.accountData?.remappedAccountIds || {}),
    ...(settingsRemappedIds || {}),
  };
  const mergedAccountsContext = {
    settings: mergedAccountSettingsResult,
    remappedAccountIds: combinedRemappedIds,
  };
  const cloudExpenses = loadExpenses(
    cloud.expenses ?? [],
    mergedAccountsContext,
    deletedRecords,
  );
  const localExpensesLoaded = loadExpenses(
    local.expenses ?? [],
    mergedAccountsContext,
    deletedRecords,
  );
  const cloudBudgets = loadBudgets(cloud.budgets ?? {});
  const cloudSchedules = loadRecurringSchedules(
    cloud.recurringSchedules ?? [],
    mergedAccountsContext,
  );
  const localSchedulesLoaded = loadRecurringSchedules(
    local.recurringSchedules ?? [],
    mergedAccountsContext,
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
  const rawMergedTransactions = mergeRecords(
    cloudAccounts.transactions,
    local.accountData.transactions,
    deletedRecords.accountTransactions,
    Boolean(preferLocal),
  );
  const remappedRecords = remapSnapshotAccountReferences(
    mergeExpenseRecords(
      cloudExpenses,
      localExpensesLoaded,
      deletedRecords.expenses,
      Boolean(preferLocal),
    ),
    mergeRecords(
      cloudSchedules,
      localSchedulesLoaded,
      deletedRecords.recurringSchedules,
      Boolean(preferLocal),
    ),
    rawMergedTransactions,
    combinedRemappedIds,
  );

  const computedMergedLedger = computeAccountBalances(
    mergedAccountSettingsResult.cards,
    mergedAccountSettingsResult.openingBalances ||
      mergedAccountSettingsResult.balances,
    remappedRecords.expenses,
    remappedRecords.transactions,
  );
  const enrichedMergedCards = (mergedAccountSettingsResult.cards || []).map(
    (c) => ({
      ...c,
      initialBalance:
        computedMergedLedger.openingBalances[c.id] ??
        roundMoney(Number(c.initialBalance) || 0),
      currentBalance:
        computedMergedLedger.currentBalances[c.id] ??
        computedMergedLedger.openingBalances[c.id] ??
        0,
    }),
  );
  const enrichedMergedSettings = {
    ...mergedAccountSettingsResult,
    balances: computedMergedLedger.openingBalances,
    openingBalances: computedMergedLedger.openingBalances,
    currentBalances: computedMergedLedger.currentBalances,
    cards: enrichedMergedCards,
  };
  const enrichedMergedTransactions = remappedRecords.transactions.map((tx) => {
    const ledgerEntry = computedMergedLedger.ledgerById.get(tx.id);
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

  if (!preferLocal) {
    return {
      expenses: remappedRecords.expenses,
      budgets: budgetData.budgets,
      budgetUpdatedAt: budgetData.updatedAt,
      recurringSchedules: remappedRecords.recurringSchedules,
      accountData: {
        settings: enrichedMergedSettings,
        transactions: enrichedMergedTransactions,
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
    expenses: remappedRecords.expenses,
    budgets: budgetData.budgets,
    budgetUpdatedAt: budgetData.updatedAt,
    recurringSchedules: remappedRecords.recurringSchedules,
    accountData: {
      settings: enrichedMergedSettings,
      transactions: enrichedMergedTransactions,
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
    snapshot.expenses,
  );
  return {
    expenses: loadExpenses(
      snapshot.expenses ?? [],
      loadedAccounts,
      deletedRecords,
    ),
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
  const [sessionResolving, setSessionResolving] = useState(() =>
    Boolean(
      supabaseConfigured && (hasPotentialCloudSession() || loadLocalDataOwner()),
    ),
  );
  const [sessionUser, setSessionUser] = useState(null);
  const [welcomeSeen, setWelcomeSeen] = useState(readWelcomeSeen);
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  const [devForceWelcome, setDevForceWelcome] = useState(isDevForcedWelcome);
  const [prototypeMounted, setPrototypeMounted] = useState(false);
  const handlePrototypeMounted = useCallback(() => {
    setPrototypeMounted(true);
  }, []);
  useEffect(() => {
    void loadMobilePrototype();
    void import("./AccountsCardDeck.jsx");
    void import("./cardAssets.jsx");
  }, []);
  const [deletedRecords, setDeletedRecords] = useState(() => {
    const saved = readStorage(STORAGE_KEYS.deletedRecords, null);
    if (saved) return normalizeDeletedRecords(saved);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return normalizeDeletedRecords(snapshot?.deletedRecords);
  });
  const [accountData, setAccountData] = useState(() => {
    const savedDeleted = readStorage(STORAGE_KEYS.deletedRecords, null);
    const savedAccounts = readStorage(STORAGE_KEYS.accounts, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    const effectiveDeleted = normalizeDeletedRecords(
      savedDeleted || snapshot?.deletedRecords,
    );
    return loadAccountData(
      savedAccounts ?? snapshot?.accountData ?? undefined,
      effectiveDeleted,
    );
  });
  const [expenses, setExpenses] = useState(() => {
    const savedExpenses = readStorage(STORAGE_KEYS.expenses, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return loadExpenses(
      savedExpenses ?? snapshot?.expenses ?? [],
      accountData,
      deletedRecords,
    );
  });
  const [budgets, setBudgets] = useState(() => {
    const savedBudgets = readStorage(STORAGE_KEYS.budgets, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return loadBudgets(savedBudgets ?? snapshot?.budgets ?? {});
  });
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState(() => {
    const savedUpdatedAt = readStorage(BUDGET_UPDATED_AT_KEY, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return normalizeBudgetUpdatedAt(
      savedUpdatedAt ?? snapshot?.budgetUpdatedAt ?? {},
    );
  });
  const [recurringSchedules, setRecurringSchedules] = useState(() => {
    const savedSchedules = readStorage(STORAGE_KEYS.recurring, null);
    const owner = loadLocalDataOwner();
    const snapshot = owner ? readLocalUserSnapshots()[owner] : null;
    return loadRecurringSchedules(
      savedSchedules ?? snapshot?.recurringSchedules ?? [],
      accountData,
    );
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
  const [backupCheckpoints, setBackupCheckpoints] = useState([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointBusyId, setCheckpointBusyId] = useState("");
  const authModalRef = useRef(null);
  const authTriggerRef = useRef(null);
  const authReturnFocusRef = useRef(null);
  const profileEditorTriggerRef = useRef(null);
  const backupFileInputRef = useRef(null);
  const {
    isOpen: updateModalOpen,
    isClosing: updateModalClosing,
    open: showUpdateModal,
    close: hideUpdateModal,
  } = usePopupPresence();
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState("");
  const dismissedBuildIdRef = useRef("");
  const updateModalRef = useRef(null);

  const canPresentUpdateModal =
    !sessionResolving &&
    ready &&
    isHydrated &&
    (!hasAppPin() || isSessionUnlocked()) &&
    !(
      (!Boolean(sessionUser || pushUser) && (!welcomeSeen || devForceWelcome)) ||
      welcomeExiting
    );
  const canPresentUpdateModalRef = useRef(canPresentUpdateModal);
  canPresentUpdateModalRef.current = canPresentUpdateModal;

  const dismissUpdateModal = useCallback(() => {
    const candidateId = updateInfo?.buildId || "sw-pending-update";
    dismissedBuildIdRef.current = candidateId;
    if (typeof window !== "undefined") {
      window.__spendAcknowledgeUpdate?.(candidateId);
    }
    hideUpdateModal();
  }, [hideUpdateModal, updateInfo?.buildId]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleUpdateEvent = (event) => {
      const detail = event?.detail || window.__spendPendingUpdate || {};
      const candidateId = detail.buildId || "sw-pending-update";
      setUpdateInfo(detail);
      setUpdateCheckStatus(
        detail.version
          ? `Update available: Spend v${detail.version} is ready to install.`
          : "A new update is ready to install.",
      );
      if (detail.manual) {
        dismissedBuildIdRef.current = "";
        showUpdateModal();
        return;
      }
      if (
        dismissedBuildIdRef.current &&
        dismissedBuildIdRef.current === candidateId
      ) {
        return;
      }
      if (canPresentUpdateModalRef.current) {
        showUpdateModal();
      }
    };
    window.addEventListener("spend:update-available", handleUpdateEvent);
    if (window.__spendPendingUpdate) {
      handleUpdateEvent({ detail: window.__spendPendingUpdate });
    }
    return () => {
      window.removeEventListener("spend:update-available", handleUpdateEvent);
    };
  }, [showUpdateModal]);

  useEffect(() => {
    if (!canPresentUpdateModal || !updateInfo) return;
    const candidateId = updateInfo.buildId || "sw-pending-update";
    if (
      dismissedBuildIdRef.current &&
      dismissedBuildIdRef.current === candidateId
    ) {
      return;
    }
    showUpdateModal();
  }, [canPresentUpdateModal, showUpdateModal, updateInfo]);

  const handleCheckForUpdates = useCallback(
    async ({ silent = false } = {}) => {
      if (typeof window === "undefined") return false;
      dismissedBuildIdRef.current = "";
      setCheckingForUpdate(true);
      if (!silent) {
        setUpdateCheckStatus("Checking for updates…");
      }
      try {
        const checkPromise =
          typeof window.__spendCheckForUpdates === "function"
            ? window.__spendCheckForUpdates({ force: true, manual: !silent })
            : Promise.resolve(false);
        const [found] = await Promise.all([
          checkPromise,
          new Promise((resolve) =>
            window.setTimeout(resolve, silent ? 0 : 420),
          ),
        ]);
        const pending = window.__spendPendingUpdate || updateInfo;
        if (found || pending) {
          if (pending) setUpdateInfo(pending);
          setUpdateCheckStatus(
            pending?.version
              ? `Update available: Spend v${pending.version} is ready to install.`
              : "A new update is ready to install.",
          );
          showUpdateModal();
          return true;
        }
        if (!navigator.onLine) {
          setUpdateCheckStatus(
            "You appear to be offline. Connect to the internet to check for updates.",
          );
          return false;
        }
        const currentVer =
          typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2.0.0";
        setUpdateCheckStatus(
          `You’re up to date · Spend v${currentVer} is the latest version.`,
        );
        return false;
      } catch {
        setUpdateCheckStatus(
          "Could not check for updates right now. Please try again.",
        );
        return false;
      } finally {
        setCheckingForUpdate(false);
      }
    },
    [showUpdateModal, updateInfo],
  );
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
  const localDataWasUnownedRef = useRef(!loadLocalDataOwner());

  const liveBalanceState = useMemo(
    () =>
      computeAccountBalances(
        accountData.settings?.cards,
        accountData.settings?.openingBalances || accountData.settings?.balances,
        expenses,
        accountData.transactions,
      ),
    [
      accountData.settings?.cards,
      accountData.settings?.openingBalances,
      accountData.settings?.balances,
      expenses,
      accountData.transactions,
    ],
  );

  const syncedAccountData = useMemo(() => {
    const rawCards = Array.isArray(accountData.settings?.cards)
      ? accountData.settings.cards
      : [];
    const enrichedCards = rawCards.map((card) => ({
      ...card,
      initialBalance:
        liveBalanceState.openingBalances[card.id] ??
        roundMoney(Number(card.initialBalance) || 0),
      currentBalance:
        liveBalanceState.currentBalances[card.id] ??
        liveBalanceState.openingBalances[card.id] ??
        0,
    }));
    const enrichedTransactions = (accountData.transactions || []).map((tx) => {
      const entry = liveBalanceState.ledgerById.get(tx.id);
      if (!entry) return tx;
      return {
        ...tx,
        ...(entry.balanceBefore !== null
          ? { balanceBefore: entry.balanceBefore }
          : {}),
        ...(entry.balanceAfter !== null
          ? { balanceAfter: entry.balanceAfter }
          : {}),
        ...(entry.fromBalanceAfter !== null
          ? { fromBalanceAfter: entry.fromBalanceAfter }
          : {}),
        ...(entry.toBalanceAfter !== null
          ? { toBalanceAfter: entry.toBalanceAfter }
          : {}),
      };
    });
    return {
      ...accountData,
      settings: {
        ...accountData.settings,
        balances: liveBalanceState.openingBalances,
        openingBalances: liveBalanceState.openingBalances,
        currentBalances: liveBalanceState.currentBalances,
        cards: enrichedCards,
      },
      transactions: enrichedTransactions,
    };
  }, [accountData, liveBalanceState]);

  cloudSnapshotRef.current = useMemo(
    () => ({
      expenses,
      budgets,
      budgetUpdatedAt,
      recurringSchedules,
      accountData: syncedAccountData,
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
      syncedAccountData,
      deletedRecords,
      theme,
      targetCurrency,
      reminderTime,
      localProfileName,
      profileAvatar,
      profileUpdatedAt,
    ],
  );

  function createEmptyCloudSnapshot(base = cloudSnapshotRef.current) {
    return {
      expenses: [],
      budgets: {},
      budgetUpdatedAt: {},
      recurringSchedules: [],
      accountData: emptyAccountData(),
      deletedRecords: emptyDeletedRecords(),
      theme: base?.theme || "auto",
      targetCurrency: base?.targetCurrency || "USD",
      reminderTime: base?.reminderTime || "09:00",
      profileName: "",
      profileAvatar: "",
      profileUpdatedAt: 0,
    };
  }

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
    const isSameOwner = previousUserId === userId;
    const isSwitchingDifferentUser =
      Boolean(previousUserId) && previousUserId !== userId;
    if (isSwitchingDifferentUser) {
      saveLocalUserSnapshot(previousUserId, cloudSnapshotRef.current);
      clearSharedFinancialData();
    } else if (!previousUserId) {
      clearSharedFinancialData();
    }
    const snapshot = loadLocalUserSnapshot(userId);
    localDataWasUnownedRef.current = !previousUserId && !snapshot;
    adoptLocalDataForUser(userId);
    if (snapshot) {
      if (
        isSameOwner &&
        hasMeaningfulLocalData(cloudSnapshotRef.current)
      ) {
        const merged = mergeCloudSnapshots(
          cloudSnapshotRef.current,
          snapshot,
          true,
        );
        applyCloudSnapshot(merged);
      } else {
        applyCloudSnapshot(snapshot);
      }
    } else if (
      isSwitchingDifferentUser ||
      !hasMeaningfulLocalData(cloudSnapshotRef.current)
    ) {
      resetDataForNewUser();
    }
  }

  function selectLocalDataForUser(userId) {
    if (hasAppPin() && !getSessionKey()) {
      return;
    }
    const previousOwner = localDataOwnerRef.current;
    const hasSavedSnapshot = Boolean(loadLocalUserSnapshot(userId));
    if (previousOwner || hasSavedSnapshot) {
      switchLocalUser(userId);
    } else {
      localDataWasUnownedRef.current = true;
      adoptLocalDataForUser(userId);
    }
  }

  const lastLocalSaveTimeRef = useRef(0);

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
        let bypassVersionMismatch = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let savedVersion = null;
          const attemptedVersion = bypassVersionMismatch
            ? null
            : cloudVersionRef.current;
          try {
            savedVersion = await saveCloudData(
              userId,
              snapshot,
              attemptedVersion,
              { forceOverwrite: forceOverwrite || bypassVersionMismatch },
            );
          } catch (error) {
            if (error.code !== "23505") throw error;
          }

          if (savedVersion) {
            if (
              authUserIdRef.current === userId &&
              localDataOwnerRef.current === userId
            ) {
              lastLocalSaveTimeRef.current = Date.now();
              cloudVersionRef.current = savedVersion;
              cloudAccountSettingsRef.current = snapshot.accountData.settings;
              lastSyncedSnapshotRef.current = snapshot;
              ensureDailyBackupCheckpoint(userId, snapshot, savedVersion);
              if (!areCloudSnapshotsEqual(cloudSnapshotRef.current, snapshot)) {
                snapshot = cloudSnapshotRef.current;
                bypassVersionMismatch = false;
                continue;
              }
              clearCloudSyncOutbox(userId, savedVersion);
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
            bypassVersionMismatch = true;
            continue;
          }
          const previousCloud = lastSyncedSnapshotRef.current;
          snapshot = stripCloudRemovedRecordsFromLocal(
            cloudSnapshotRef.current,
            previousCloud,
            remote?.data,
          );
          if (remote?.data) {
            const remoteSnapshot = mergeCloudSnapshots(
              createEmptyCloudSnapshot(snapshot),
              remote.data,
              false,
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
          if (
            attemptedVersion &&
            remote?.updated_at &&
            remote.updated_at === attemptedVersion
          ) {
            // Heal legacy DB updated_at mismatch where load_spend_user_snapshot returned GREATEST(...)
            bypassVersionMismatch = true;
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
          Boolean(cloudVersionRef.current) &&
          remote.updated_at === cloudVersionRef.current;

        if (
          source === "live" &&
          lastSyncedSnapshotRef.current &&
          isSameVersion &&
          areCloudSnapshotsEqual(remote.data, lastSyncedSnapshotRef.current)
        ) {
          if (remote.updated_at) cloudVersionRef.current = remote.updated_at;
          setCloudSyncActivity("synced");
          return lastSyncedSnapshotRef.current;
        }

        const rawLocal = cloudSnapshotRef.current;
        const previousCloud = lastSyncedSnapshotRef.current;
        const hasPendingChanges =
          previousCloud && !areCloudSnapshotsEqual(rawLocal, previousCloud);
        const local = hasPendingChanges
          ? stripCloudRemovedRecordsFromLocal(
              rawLocal,
              previousCloud,
              remote.data,
            )
          : rawLocal;
        const accountSettingsChanged =
          previousCloud &&
          !areAccountSettingsEqual(
            local.accountData.settings,
            previousCloud.accountData.settings,
          );
        const remoteSnapshot = mergeCloudSnapshots(
          createEmptyCloudSnapshot(local),
          remote.data,
          false,
          false,
        );
        const refreshed = hasPendingChanges
          ? mergeCloudSnapshots(
              local,
              remote.data,
              true,
              Boolean(accountSettingsChanged),
            )
          : remoteSnapshot;

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
    const browserChromeColor =
      resolvedTheme === "dark" ? "#08080c" : "#f4f3ee";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", browserChromeColor));
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Keep the selected theme for this visit when storage is unavailable.
    }
  }, [theme, resolvedTheme]);

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
    writeStorage(STORAGE_KEYS.accounts, syncedAccountData);
  }, [syncedAccountData]);
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
    syncedAccountData,
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
    clearCloudSyncOutbox();
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

      const owner = localDataOwnerRef.current;
      const ownerSnapshot =
        owner && decryptedSnapshots && typeof decryptedSnapshots === "object"
          ? decryptedSnapshots[owner]
          : null;
      const effectiveDeleted = normalizeDeletedRecords(
        decryptedDeleted || ownerSnapshot?.deletedRecords,
      );
      const loadedAccounts = loadAccountData(
        decryptedAccounts ?? ownerSnapshot?.accountData ?? emptyAccountData(),
        effectiveDeleted,
      );

      setDeletedRecords(effectiveDeleted);
      setAccountData(loadedAccounts);
      setExpenses(
        loadExpenses(
          decryptedExpenses?.length
            ? decryptedExpenses
            : (ownerSnapshot?.expenses ?? []),
          loadedAccounts,
          effectiveDeleted,
        ),
      );
      setBudgets(
        loadBudgets(
          decryptedBudgets && Object.keys(decryptedBudgets).length
            ? decryptedBudgets
            : (ownerSnapshot?.budgets ?? {}),
        ),
      );
      setBudgetUpdatedAt(
        normalizeBudgetUpdatedAt(
          decryptedBudgetUpdatedAt &&
            Object.keys(decryptedBudgetUpdatedAt).length
            ? decryptedBudgetUpdatedAt
            : (ownerSnapshot?.budgetUpdatedAt ?? {}),
        ),
      );
      setRecurringSchedules(
        loadRecurringSchedules(
          decryptedRecurring?.length
            ? decryptedRecurring
            : (ownerSnapshot?.recurringSchedules ?? []),
          loadedAccounts,
        ),
      );

      isHydratedRef.current = true;
      setIsHydrated(true);
      if (
        typeof window !== "undefined" &&
        window.__spendPendingUpdate &&
        dismissedBuildIdRef.current !==
          (window.__spendPendingUpdate.buildId || "sw-pending-update")
      ) {
        showUpdateModal();
      }

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
          clearCloudSyncOutbox(previousUserId);
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
    if (!supabaseConfigured) {
      setSessionResolving(false);
      return undefined;
    }
    let active = true;
    let sessionSubscription = null;
    const resolveTimeout = window.setTimeout(() => {
      if (active) setSessionResolving(false);
    }, 1800);
    (supabase ? Promise.resolve(supabase) : getSupabase())
      .then((client) => {
        if (!active) return;
        if (!client) {
          window.clearTimeout(resolveTimeout);
          setSessionResolving(false);
          return;
        }
        client.auth
          .getSession()
          .then(({ data }) => {
            if (!active) return;
            window.clearTimeout(resolveTimeout);
            const user = data?.session?.user || null;
            setSessionUser(user);
            if (user) {
              markWelcomeSeen();
              setWelcomeSeen(true);
              initSupabaseAuth();
            }
            setSessionResolving(false);
          })
          .catch(() => {
            if (!active) return;
            window.clearTimeout(resolveTimeout);
            setSessionResolving(false);
          });
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          window.clearTimeout(resolveTimeout);
          const user = session?.user || null;
          setSessionUser(user);
          if (user) {
            markWelcomeSeen();
            setWelcomeSeen(true);
          }
          setSessionResolving(false);
        });
        sessionSubscription = subscription;
      })
      .catch(() => {
        if (!active) return;
        window.clearTimeout(resolveTimeout);
        setSessionResolving(false);
      });
    return () => {
      active = false;
      window.clearTimeout(resolveTimeout);
      sessionSubscription?.unsubscribe();
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
        const pendingOutbox = readCloudSyncOutbox(pushUser.id);
        const hasPendingOutboxMutations = Boolean(pendingOutbox?.dirty);
        let merged;
        let savedVersion = null;
        let lastSuccessfulSnapshot = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!active) return;
          const rawLocal = cloudSnapshotRef.current;
          const wasUnownedLocal = Boolean(localDataWasUnownedRef.current);
          const localBelongsToUser =
            (localDataOwnerRef.current === pushUser.id ||
              hasPendingOutboxMutations) &&
            !wasUnownedLocal;
          const hasSavedUserSnapshot = Boolean(
            loadLocalUserSnapshot(pushUser.id),
          );
          const hasCloudData = Boolean(
            remote?.data &&
            (hasMeaningfulLocalData(remote.data) ||
              (Array.isArray(remote.data.accountData?.settings?.cards) &&
                remote.data.accountData.settings.cards.length > 0)),
          );
          // Never pollute an existing cloud account with unowned pre-login local device data
          let local =
            hasCloudData && wasUnownedLocal
              ? createEmptyCloudSnapshot(rawLocal)
              : rawLocal;
          if (
            hasPendingOutboxMutations &&
            pendingOutbox?.snapshot &&
            localBelongsToUser
          ) {
            local = mergeCloudSnapshots(
              local,
              pendingOutbox.snapshot,
              true,
              true,
            );
          }
          const cloudAccountSettings = loadAccountData(
            remote?.data?.accountData ?? emptyAccountData(),
            remote?.data?.deletedRecords,
            remote?.data?.expenses,
          ).settings;
          const localSettingsNewer =
            localBelongsToUser &&
            recordUpdatedAt(local.accountData?.settings) >
              recordUpdatedAt(cloudAccountSettings);
          const preferLocal =
            Boolean(localBelongsToUser && hasPendingOutboxMutations) ||
            (!hasCloudData &&
              (localBelongsToUser || !hasSavedUserSnapshot) &&
              hasMeaningfulLocalData(local)) ||
            Boolean(localBelongsToUser && localSettingsNewer);
          const preferLocalAccountSettings =
            preferLocal &&
            hasMeaningfulLocalAccountSettings(local) &&
            (hasPendingOutboxMutations ||
              !hasMeaningfulAccountSettings(cloudAccountSettings) ||
              localSettingsNewer);
          merged = mergeCloudSnapshots(
            local,
            remote?.data,
            preferLocal,
            preferLocalAccountSettings,
          );
          if (active && hasCloudData) {
            applyCloudSnapshot(merged);
          }
          const attemptedVersion = remote?.updated_at ?? null;
          try {
            savedVersion = await saveCloudData(
              pushUser.id,
              merged,
              attempt >= 1 && remote?._bypassVersionMismatch
                ? null
                : attemptedVersion,
              {
                forceOverwrite: Boolean(
                  attempt >= 1 && remote?._bypassVersionMismatch,
                ),
              },
            );
          } catch (error) {
            if (error.code !== "23505" || remote?.data) throw error;
          }
          if (savedVersion) {
            lastSuccessfulSnapshot = merged;
            if (cloudSnapshotRef.current === rawLocal) break;
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
          const nextRemote = await loadCloudData(pushUser.id);
          if (
            attemptedVersion &&
            nextRemote?.updated_at &&
            nextRemote.updated_at === attemptedVersion
          ) {
            nextRemote._bypassVersionMismatch = true;
          }
          remote = nextRemote;
          setNormalizedAccountSync(remote?.normalizedAccountSync !== false);
        }
        if (!savedVersion || !merged) {
          throw new Error("Cloud data changed repeatedly; please try again.");
        }
        if (!active) return;
        localDataWasUnownedRef.current = false;
        cloudVersionRef.current = savedVersion;
        lastSyncedSnapshotRef.current = lastSuccessfulSnapshot ?? merged;
        cloudAccountSettingsRef.current =
          lastSyncedSnapshotRef.current.accountData.settings;
        clearCloudSyncOutbox(pushUser.id, savedVersion);
        ensureDailyBackupCheckpoint(pushUser.id, merged, savedVersion);
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

    const handleCloudChange = (payload) => {
      if (!active || authUserIdRef.current !== pushUser.id) return;
      if (hasAppPin() && !isSessionUnlocked()) return;
      const incomingUpdatedAt = payload?.new?.updated_at;
      if (
        payload?.table === "spend_user_data" &&
        incomingUpdatedAt &&
        cloudVersionRef.current &&
        incomingUpdatedAt === cloudVersionRef.current
      ) {
        return;
      }
      if (
        (payload?.table === "spend_account_settings" ||
          payload?.table === "spend_account_transactions") &&
        Date.now() - lastLocalSaveTimeRef.current < 2500
      ) {
        return;
      }
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
    const flushOutboxOnClose = () => {
      if (hasAppPin() && !isSessionUnlocked()) return;
      const currentSnap = cloudSnapshotRef.current;
      const hasUnsynced =
        !lastSyncedSnapshotRef.current ||
        !areCloudSnapshotsEqual(currentSnap, lastSyncedSnapshotRef.current) ||
        hasPendingCloudOutbox(pushUser.id);
      if (hasUnsynced && currentSnap) {
        const sentKeepalive = flushCloudSyncKeepalive(
          pushUser.id,
          currentSnap,
          cloudVersionRef.current,
          {
            onSaved: (savedVer, flushedSnap) => {
              if (
                authUserIdRef.current === pushUser.id &&
                localDataOwnerRef.current === pushUser.id
              ) {
                lastLocalSaveTimeRef.current = Date.now();
                if (savedVer) cloudVersionRef.current = savedVer;
                cloudAccountSettingsRef.current =
                  flushedSnap.accountData.settings;
                lastSyncedSnapshotRef.current = flushedSnap;
                setCloudSyncActivity("synced");
              }
            },
            onConflict: () => {
              void queueCloudSnapshotSave(pushUser.id).catch(() => {});
            },
          },
        );
        if (!sentKeepalive) {
          void queueCloudSnapshotSave(pushUser.id).catch(() => {});
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushOutboxOnClose();
      } else if (document.visibilityState === "visible") {
        if (hasPendingCloudOutbox(pushUser.id)) {
          void queueCloudSnapshotSave(pushUser.id).catch(() => {});
        }
        handleCloudChange();
      }
    };
    const handlePageHide = () => {
      flushOutboxOnClose();
    };
    let capAppListener = null;
    if (window.Capacitor?.Plugins?.App?.addListener) {
      try {
        capAppListener = window.Capacitor.Plugins.App.addListener(
          "appStateChange",
          ({ isActive }) => {
            if (!isActive) {
              flushOutboxOnClose();
            } else if (hasPendingCloudOutbox(pushUser.id)) {
              void queueCloudSnapshotSave(pushUser.id).catch(() => {});
            }
          },
        );
      } catch {
        // Ignore Capacitor listener setup errors
      }
    }
    const handleWindowFocus = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        if (hasPendingCloudOutbox(pushUser.id)) {
          void queueCloudSnapshotSave(pushUser.id).catch(() => {});
        }
        handleCloudChange();
      }
    };
    const periodicSyncTimer = window.setInterval(() => {
      if (
        active &&
        document.visibilityState === "visible" &&
        navigator.onLine &&
        Date.now() - lastLocalSaveTimeRef.current >= 4000
      ) {
        void queueCloudSnapshotRefresh(pushUser.id, "live").catch(() => {});
      }
    }, 10000);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!navigator.onLine) handleOffline();

    return () => {
      active = false;
      window.clearTimeout(liveChangeTimerRef.current);
      window.clearInterval(periodicSyncTimer);
      capAppListener?.then?.((h) => h?.remove?.())?.catch?.(() => {});
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
    };
  }, [cloudSyncEnabled, cloudSyncReady, normalizedAccountSync, pushUser?.id]);

  useEffect(() => {
    if (!isHydratedRef.current) return undefined;
    if (hasAppPin() && !isSessionUnlocked()) return undefined;
    // Always ensure daily local checkpoint exists when records are present
    ensureDailyBackupCheckpoint(
      pushUser?.id || localDataOwnerRef.current,
      cloudSnapshotRef.current,
      cloudVersionRef.current,
    );
    if (!supabase || !pushUser || !cloudSyncEnabled) return undefined;
    const isDirty =
      !lastSyncedSnapshotRef.current ||
      !areCloudSnapshotsEqual(
        cloudSnapshotRef.current,
        lastSyncedSnapshotRef.current,
      );
    if (isDirty) {
      // #3 Immediately persist pending sync state to localStorage outbox
      // BEFORE the 150ms debounce so swipe-closing the app never loses mutations.
      persistCloudSyncOutbox({
        userId: pushUser.id,
        snapshot: cloudSnapshotRef.current,
        expectedUpdatedAt: cloudVersionRef.current,
      });
    }
    if (!cloudSyncReady) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        await queueCloudSnapshotSave(pushUser.id);
      } catch (error) {
        if (authUserIdRef.current === pushUser.id) {
          setCloudSyncStatus(`Could not sync your data: ${error.message}`);
        }
      }
    }, 150);
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
    const modalEl = authModalRef.current;
    if (modalEl && !modalEl.contains(document.activeElement)) {
      const preferredInput =
        modalEl.querySelector("#push-email:not([disabled])") ||
        modalEl.querySelector("input:not([disabled]), button:not([disabled])");
      preferredInput?.focus();
    }
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !authBusy) {
        hideAuthModal();
        setShowAuthPassword(false);
      }
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
      ...syncedAccountData.settings.openingBalances,
      date: syncedAccountData.settings.startDate,
    },
    currentBalances: syncedAccountData.settings.currentBalances,
    reconciliation: liveBalanceState.reconciliation,
    outboxPending: Boolean(
      pushUser?.id && hasPendingCloudOutbox(pushUser.id),
    ),
    cards: Array.isArray(syncedAccountData.settings.cards)
      ? syncedAccountData.settings.cards
      : [],
    deletedCards: deletedRecords?.cards || {},
    tx: syncedAccountData.transactions.map((transaction) => ({
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
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
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
    const cards = Array.isArray(accountData?.settings?.cards)
      ? accountData.settings.cards
      : [];
    const targetCard = form.account
      ? cards.find((c) => c.id === form.account)
      : null;
    if (targetCard?.frozen) return false;
    if (form.category === "Savings") {
      const savingsId = getSavingsAccountId(cards);
      const savingsCard = savingsId
        ? cards.find((c) => c.id === savingsId)
        : null;
      if (savingsCard?.frozen) return false;
      if (savingsId && (!form.account || form.account === "cash")) return false;
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
        account: isAccountId(form.account, accountData) ? form.account : "",
      };
      createdExpenseId = newExpense.id;
      setExpenses((current) => [...current, newExpense]);
    } else {
      const scheduleId = makeId();
      let nextDate = form.date;
      const today = localDate();
      const generatedExpenses = [];
      let generated = 0;
      const resolvedAccount = isAccountId(form.account, accountData)
        ? form.account
        : "";
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
          account: resolvedAccount,
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
          account: resolvedAccount,
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
    const isSavings = form.category === "Savings";
    if (
      !form.description.trim() ||
      !isValidDateString(date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (isSavings && (amount === null || !Number.isFinite(amount) || amount <= 0))
    )
      return false;
    const cards = Array.isArray(accountData?.settings?.cards)
      ? accountData.settings.cards
      : [];
    const targetCard = form.account
      ? cards.find((c) => c.id === form.account)
      : null;
    if (targetCard?.frozen) return false;
    if (isSavings) {
      const savingsId = getSavingsAccountId(cards);
      const savingsCard = savingsId
        ? cards.find((c) => c.id === savingsId)
        : null;
      if (savingsCard?.frozen) return false;
      if (savingsId && (!form.account || form.account === "cash")) return false;
    }
    setExpenses((current) =>
      current.map((expense) =>
        expense.id === expenseId
          ? {
              ...expense,
              description: form.description.trim(),
              amount: amount === null ? null : roundMoney(amount),
              category: form.category,
              date: expense.recurringId ? expense.date : form.date,
              account: isAccountId(form.account, accountData)
                ? form.account
                : "",
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
      settings: {
        ...current.settings,
        updatedAt: createdAt,
      },
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
    const now = Date.now();
    setAccountData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        updatedAt: now,
      },
      transactions: current.transactions.map((tx) => {
        if (tx.id !== txId) return tx;
        const updated = {
          id: tx.id,
          createdAt: tx.createdAt ?? now,
          updatedAt: now,
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
      settings: {
        ...current.settings,
        updatedAt: Date.now(),
      },
      transactions: current.transactions.filter((item) => item.id !== txId),
    }));
    setRecordDeleted("accountTransactions", txId, true, {
      minUpdatedAt: recordUpdatedAt(existingTx),
    });
    return () => {
      setRecordDeleted("accountTransactions", txId, false);
      setAccountData((current) =>
        current.transactions.some((item) => item.id === txId)
          ? current
          : {
              ...current,
              settings: {
                ...current.settings,
                updatedAt: Date.now(),
              },
              transactions: [...current.transactions, existingTx],
            },
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
        initialBalance,
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
          updatedAt: now,
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
      initialBalance,
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
      minUpdatedAt: recordUpdatedAt(existingCard),
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
            const nextInitialBalance = hasInitialBalanceUpdate
              ? roundMoney(rawInitialBal)
              : roundMoney(
                  Number(
                    current.settings.balances?.[updatedCard.id] ??
                      c.initialBalance,
                  ) || 0,
                );
            return {
              ...c,
              ...safeCard,
              initialBalance: nextInitialBalance,
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
              initialBalance: hasInitialBalanceUpdate
                ? roundMoney(rawInitialBal)
                : 0,
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
    setRecordDeleted("recurringSchedules", scheduleId, true, {
      minUpdatedAt: recordUpdatedAt(schedule),
    });
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
    const { minUpdatedAt = 0, ...restMetadata } = metadata || {};
    setDeletedRecords((current) => {
      const normalized = normalizeDeletedRecords(current);
      const existing = normalized[collection][id];
      if (!isDeleted && !existing?.deleted && collection !== "budgets")
        return current;
      const previous = existing?.updatedAt ?? 0;
      const minFloor = Number.isFinite(Number(minUpdatedAt))
        ? Number(minUpdatedAt) + 1
        : 0;
      return {
        ...normalized,
        [collection]: {
          ...normalized[collection],
          [id]: {
            deleted: isDeleted,
            updatedAt: Math.max(Date.now(), previous + 1, minFloor),
            ...restMetadata,
          },
        },
      };
    });
  }

  function setExpenseDeleted(expense, isDeleted) {
    const minUpdatedAt = recordUpdatedAt(expense);
    setRecordDeleted("expenses", expense.id, isDeleted, { minUpdatedAt });
    if (expense.recurringId)
      setRecordDeleted(
        "expenses",
        `recurring:${expense.recurringId}:${expense.date}`,
        isDeleted,
        { minUpdatedAt },
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
        accountData: syncedAccountData,
        ledgerSummary: {
          computedAt: exportedAt,
          openingBalances: liveBalanceState.openingBalances,
          currentBalances: liveBalanceState.currentBalances,
          ...liveBalanceState.summary,
        },
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
        accountData: syncedAccountData,
        ledgerSummary: {
          computedAt: exportedAt,
          openingBalances: liveBalanceState.openingBalances,
          currentBalances: liveBalanceState.currentBalances,
          ...liveBalanceState.summary,
        },
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
    const cardsList = syncedAccountData.settings.cards || [];
    const ledgerRows = [...liveBalanceState.ledgerEvents]
      .reverse()
      .map((entry) => {
        const acctLabel =
          entry.type === "transfer" || entry.type === "savings"
            ? `${accountName(entry.fromAccount || entry.account, cardsList)} -> ${accountName(entry.toAccount, cardsList)}`
            : isAccountId(entry.account, syncedAccountData)
              ? accountName(entry.account, cardsList)
              : "Cash / Other";
        const typeLabel =
          entry.type === "expense"
            ? entry.recurringId
              ? "Recurring Expense"
              : "Expense"
            : entry.type === "savings"
              ? "Savings Transfer"
              : entry.type === "income"
                ? "Income"
                : entry.type === "transfer"
                  ? "Account Transfer"
                  : `Balance Adjustment (${entry.direction || "adjust"})`;
        return [
          entry.date,
          entry.description,
          entry.category,
          entry.amount ?? "",
          acctLabel,
          typeLabel,
          entry.balanceBefore ?? "",
          entry.balanceAfter ?? "",
        ];
      });
    const data = [
      [
        "Date",
        "Description",
        "Category",
        "Amount (BDT)",
        "Payment account",
        "Type",
        "Balance Before (BDT)",
        "Balance After (BDT)",
      ],
      ...ledgerRows,
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
    setBackupStatus("Unified ledger & expenses exported as CSV.");
  }

  const [sqlHealth, setSqlHealth] = useState(null);
  const [sqlHealthChecking, setSqlHealthChecking] = useState(false);

  const handleVerifySqlAndSync = useCallback(async () => {
    setSqlHealthChecking(true);
    try {
      if (pushUser?.id && cloudSyncEnabled) {
        await queueCloudSnapshotSave(pushUser.id).catch(() => {});
        await queueCloudSnapshotRefresh(pushUser.id, "manual").catch(() => {});
      }
      const health = await checkSupabaseSqlHealth();
      setSqlHealth(health);
      return health;
    } catch {
      return null;
    } finally {
      setSqlHealthChecking(false);
    }
  }, [pushUser?.id, cloudSyncEnabled]);

  const refreshBackupCheckpoints = useCallback(
    async (uid = pushUser?.id) => {
      setCheckpointsLoading(true);
      try {
        const items = await listBackupCheckpoints(
          uid || localDataOwnerRef.current || null,
          { limit: 25 },
        );
        setBackupCheckpoints(Array.isArray(items) ? items : []);
      } catch {
        // Keep existing list on transient error
      } finally {
        setCheckpointsLoading(false);
      }
    },
    [pushUser?.id],
  );

  useEffect(() => {
    if (!isHydrated) return;
    void refreshBackupCheckpoints(pushUser?.id);
    if (pushUser?.id && cloudSyncReady) {
      void checkSupabaseSqlHealth().then(setSqlHealth).catch(() => {});
    }
  }, [isHydrated, pushUser?.id, cloudSyncReady, refreshBackupCheckpoints]);

  const handleCreateBackupCheckpoint = useCallback(async () => {
    setCheckpointBusyId("creating");
    try {
      const created = await createBackupCheckpoint(
        pushUser?.id || localDataOwnerRef.current,
        {
          type: "manual",
          label: "Manual backup checkpoint",
          data: cloudSnapshotRef.current,
        },
      );
      await refreshBackupCheckpoints(pushUser?.id);
      if (created) {
        setBackupStatus(
          pushUser
            ? "Cloud checkpoint saved. You can roll back to this exact state in one tap."
            : "Checkpoint saved on this device.",
        );
      } else {
        setBackupStatus("Could not create checkpoint right now.");
      }
    } catch (error) {
      setBackupStatus(`Could not create checkpoint: ${error.message}`);
    } finally {
      setCheckpointBusyId("");
    }
  }, [pushUser, refreshBackupCheckpoints]);

  const handleRestoreBackupCheckpoint = useCallback(
    async (checkpoint) => {
      if (!checkpoint?.id) return;
      const dateText = checkpoint.createdAt
        ? new Date(checkpoint.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : checkpoint.checkpointDate || "this date";
      if (
        !window.confirm(
          `Roll back to checkpoint from ${dateText}? Your current balances and transactions will be automatically snapshotted first so you can undo if needed.`,
        )
      ) {
        return;
      }
      setCheckpointBusyId(String(checkpoint.id));
      try {
        const restored = await restoreBackupCheckpoint(
          pushUser?.id || localDataOwnerRef.current,
          checkpoint.id,
          cloudSnapshotRef.current,
        );
        if (restored?.data) {
          applyCloudSnapshot(restored.data);
          cloudSnapshotRef.current = restored.data;
          if (restored.updated_at) {
            cloudVersionRef.current = restored.updated_at;
            lastSyncedSnapshotRef.current = restored.data;
            if (pushUser?.id) {
              clearCloudSyncOutbox(pushUser.id, restored.updated_at);
            }
          }
          await refreshBackupCheckpoints(pushUser?.id);
          setBackupStatus(`Restored checkpoint from ${dateText}.`);
        }
      } catch (error) {
        setBackupStatus(`Could not restore checkpoint: ${error.message}`);
      } finally {
        setCheckpointBusyId("");
      }
    },
    [pushUser?.id, refreshBackupCheckpoints],
  );

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
          "Restoring this backup will replace all current app data. A safety checkpoint of your current data will be saved automatically first. Continue?",
        )
      ) {
        setBackupStatus("Restore canceled.");
        return;
      }

      // #1 Automatically snapshot current state before restoring a backup file
      try {
        await createBackupCheckpoint(
          pushUser?.id || localDataOwnerRef.current,
          {
            type: "pre_restore",
            label: "Safety snapshot before file restore",
            data: cloudSnapshotRef.current,
          },
        );
      } catch {
        // Continue restore even if offline
      }

      const restoreTimestamp = Date.now();
      const restoredDeletedRecords = normalizeDeletedRecords(
        data.deletedRecords,
      );
      const restoredAccounts = loadAccountData(
        data.accountData,
        restoredDeletedRecords,
        data.expenses,
      );
      const restoredExpenses = loadExpenses(
        data.expenses,
        restoredAccounts,
        restoredDeletedRecords,
      ).map((expense) => ({
        ...expense,
        createdAt: expense.createdAt ?? restoreTimestamp,
        updatedAt: expense.updatedAt ?? restoreTimestamp,
      }));
      const recomputedRestoredAccounts = loadAccountData(
        restoredAccounts,
        restoredDeletedRecords,
        restoredExpenses,
      );
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
        recomputedRestoredAccounts,
      ).map((schedule) => ({
        ...schedule,
        createdAt: schedule.createdAt ?? restoreTimestamp,
        updatedAt: schedule.updatedAt ?? restoreTimestamp,
      }));
      setRecurringSchedules(restoredSchedules);
      const restoredAccountData = {
        settings: {
          ...recomputedRestoredAccounts.settings,
          updatedAt:
            recomputedRestoredAccounts.settings.updatedAt || restoreTimestamp,
        },
        transactions: recomputedRestoredAccounts.transactions.map(
          (transaction) => ({
            ...transaction,
            createdAt: transaction.createdAt ?? restoreTimestamp,
            updatedAt: transaction.updatedAt ?? restoreTimestamp,
          }),
        ),
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
        persistCloudSyncOutbox({
          userId: pushUser.id,
          snapshot: restoredSnapshot,
          expectedUpdatedAt: cloudVersionRef.current,
          forceOverwrite: true,
        });
        void queueCloudSnapshotSave(pushUser.id, { forceOverwrite: true });
      }
      void refreshBackupCheckpoints(pushUser?.id);
      setBackupStatus("Backup restored (previous state saved to checkpoints).");
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
        setShowAuthPassword(false);
        setAuthMode("sign-in");
        hideAuthModal();
        return;
      }

      let result;
      let effectiveMode = authMode;

      if (authMode === "sign-up") {
        result = await client.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo: new URL(
              import.meta.env.BASE_URL,
              window.location.origin,
            ).href,
          },
        });

        const existingEmailError =
          result.error &&
          /already registered|already exists|user_already_exists/i.test(
            result.error.message || "",
          );
        const existingObfuscatedUser =
          !result.error &&
          !result.data?.session &&
          Array.isArray(result.data?.user?.identities) &&
          result.data.user.identities.length === 0;

        if (
          existingEmailError ||
          existingObfuscatedUser ||
          (!result.error && !result.data?.session)
        ) {
          const signInAttempt = await client.auth.signInWithPassword({
            email: authEmail.trim(),
            password: authPassword,
          });
          if (!signInAttempt.error && signInAttempt.data?.session) {
            result = signInAttempt;
            effectiveMode = "sign-in";
          } else if (existingEmailError || existingObfuscatedUser) {
            setAuthMode("sign-in");
            setAuthPassword("");
            setAuthStatus(
              "An account with this email already exists. Please enter your password to sign in.",
            );
            return;
          }
        }
      } else {
        result = await client.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
      }

      if (result.error) throw result.error;
      if (effectiveMode === "sign-up" && !result.data.session) {
        setAuthMode("sign-in");
        setAuthStatus(
          "Check your email to confirm your account, then sign in.",
        );
      } else {
        const signedInUser = result.data?.session?.user || result.data?.user;
        if (signedInUser) {
          initSupabaseAuth();
          if (localDataOwnerRef.current !== signedInUser.id) {
            selectLocalDataForUser(signedInUser.id);
          }
          authUserIdRef.current = signedInUser.id;
          setSessionUser(signedInUser);
          setPushUser(signedInUser);
          setCloudSyncEnabled(true);
          markWelcomeSeen();
          setWelcomeSeen(true);
          notifyNewUserSignedIn(signedInUser);
        }
        setAuthStatus(
          effectiveMode === "sign-up"
            ? "Account created. You can now enable background reminders."
            : backgroundPushEnabled
              ? "Signed in. Your recurring reminder schedule is syncing."
              : "Signed in.",
        );
        hideAuthModal();
        if (typeof window !== "undefined") {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}${window.location.hash}`,
          );
          window.dispatchEvent(
            new CustomEvent("spend:navigate-tab", { detail: { tab: "home" } }),
          );
        }
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
    initSupabaseAuth();
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

  function openSignInModal(preferredMode) {
    initSupabaseAuth();
    authTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    authReturnFocusRef.current = authTriggerRef.current;
    const nextMode =
      preferredMode === "sign-up" || preferredMode === "sign-in"
        ? preferredMode
        : "sign-in";
    setAuthMode(nextMode);
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
      openSignInModal("sign-in");
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

  const hasActiveSession = Boolean(sessionUser || pushUser);
  const shouldShowWelcome =
    !sessionResolving && !hasActiveSession && (!welcomeSeen || devForceWelcome);
  const showWelcomeOverlay = shouldShowWelcome || welcomeExiting;

  function handleWelcomeDone(preferredAuthMode = "sign-in") {
    markWelcomeSeen();
    if (import.meta.env.DEV && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("welcome")) {
        url.searchParams.delete("welcome");
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
      setDevForceWelcome(false);
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    setWelcomeSeen(true);
    setReady(true);
    if (preferredAuthMode !== "skip") {
      openSignInModal(
        preferredAuthMode === "sign-up" ? "sign-up" : "sign-in",
      );
    }
    if (!reducedMotion) {
      setWelcomeExiting(true);
      window.setTimeout(() => {
        setWelcomeExiting(false);
      }, 180);
    }
  }

  const ActivePrototype = resolvedMobilePrototype || MobilePrototype;

  return (
    <>
      {(sessionResolving || (!ready && !showWelcomeOverlay)) && (
        <SpendSplash
          canExit={!sessionResolving && prototypeMounted}
          onDone={() => setReady(true)}
        />
      )}
      {!sessionResolving && showWelcomeOverlay && (
        <WelcomeFlow
          theme={resolvedTheme}
          exiting={welcomeExiting}
          onDone={handleWelcomeDone}
        />
      )}
      <AppErrorBoundary>
        <Suspense fallback={null}>
          <PrototypeMountSignal onMounted={handlePrototypeMounted} />
          <ActivePrototype
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
          backupCheckpoints={backupCheckpoints}
          checkpointsLoading={checkpointsLoading}
          checkpointBusyId={checkpointBusyId}
          onCreateCheckpoint={handleCreateBackupCheckpoint}
          onRestoreCheckpoint={handleRestoreBackupCheckpoint}
          onRefreshCheckpoints={() => refreshBackupCheckpoints(pushUser?.id)}
          sqlHealth={sqlHealth}
          sqlHealthChecking={sqlHealthChecking}
          onVerifySqlAndSync={handleVerifySqlAndSync}
          onSignOut={signOutOfPush}
          onResumeSync={handleResumeSync}
          accountStatus={cloudSyncStatus || authStatus}
          authBusy={authBusy}
          onSignIn={openSignInModal}
          updateAvailable={Boolean(updateInfo)}
          updateInfo={updateInfo}
          checkingForUpdate={checkingForUpdate}
          updateCheckStatus={updateCheckStatus}
          onCheckForUpdates={handleCheckForUpdates}
          onOpenUpdateModal={() => {
            dismissedBuildIdRef.current = "";
            showUpdateModal();
          }}
        />
        </Suspense>
      </AppErrorBoundary>
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
                  <svg viewBox="0 0 64 64" width="44" height="44" fill="none">
                    <rect width="64" height="64" rx="16" fill="#d5f45b" />
                    <path
                      d="M22 43 43 22M28 22h15v15"
                      fill="none"
                      stroke="#161d2b"
                      strokeWidth="4.5"
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
                      className={`auth-modal-status${
                        authStatus.startsWith("Could not") ||
                        authStatus.startsWith("An account with this email")
                          ? " is-error"
                          : ""
                      }`}
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
      {updateModalOpen &&
        createPortal(
          <div
            className={`update-modal-backdrop${updateModalClosing ? " is-closing" : ""}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !updateApplying) {
                dismissUpdateModal();
              }
            }}
          >
            <section
              className={`update-modal${updateModalClosing ? " is-closing" : ""}`}
              ref={updateModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="update-modal-title"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !updateApplying) {
                  dismissUpdateModal();
                  return;
                }
                if (event.key !== "Tab") return;
                const focusable = event.currentTarget.querySelectorAll(
                  "button:not([disabled])",
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
              <div className="update-modal-icon-badge" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 16V8" />
                  <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </div>
              <h2 id="update-modal-title" className="update-modal-title">
                Update available
              </h2>
              <p className="update-modal-desc">
                {updateInfo?.version
                  ? `Spend v${updateInfo.version} is ready with the latest improvements.`
                  : "A new version of Spend is ready with the latest improvements."}
              </p>
              <div className="update-modal-actions">
                <button
                  type="button"
                  className="update-modal-btn is-later"
                  disabled={updateApplying}
                  onClick={dismissUpdateModal}
                >
                  Later
                </button>
                <button
                  type="button"
                  className="update-modal-btn is-primary"
                  disabled={updateApplying}
                  onClick={async () => {
                    if (updateApplying) return;
                    setUpdateApplying(true);
                    try {
                      if (pushUser && cloudSyncEnabled && cloudSyncReady) {
                        await Promise.race([
                          queueCloudSnapshotSave(pushUser.id).catch(() => {}),
                          new Promise((resolve) => window.setTimeout(resolve, 1200)),
                        ]);
                      }
                    } catch {}
                    if (typeof window.__spendApplyUpdate === "function") {
                      await window.__spendApplyUpdate();
                    } else {
                      window.location.reload();
                    }
                  }}
                >
                  {updateApplying ? "Updating…" : "Update now"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="Restore backup file"
        hidden
        onChange={restoreBackup}
      />
    </>
  );
}
