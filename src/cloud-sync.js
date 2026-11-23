import { getSupabase, supabase } from "./push.js";
import {
  CATEGORIES,
  clampDayOfMonth,
  cleanEnv,
  computeAccountBalances,
  emptyAccountData,
  isCashCard,
  isMfsCard,
  isPhantomAutoReconstructedCard,
  isSavingsCard,
  isValidDateString,
  isValidUuid,
  loadAccountData,
  localDate,
  makeId,
  normalizeDeletedRecords,
  parseTimestampMs,
  roundMoney,
} from "./data.js";
import { hasAppPin, isSessionUnlocked } from "./security.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";
export const CLOUD_SYNC_OUTBOX_KEY = "spend-cloud-sync-outbox-v1";
export const LOCAL_CHECKPOINTS_KEY = "spend-backup-checkpoints-v1";
export const KEEPALIVE_AVATAR_SENTINEL = "__KEEP_EXISTING_AVATAR__";

const MAX_LOCAL_DAILY_CHECKPOINTS = 14;
const MAX_LOCAL_EVENT_CHECKPOINTS = 10;
const KEEPALIVE_MAX_BYTES = 58_000;
const JWT_EXPIRY_GRACE_SECONDS = 15;

let liveSessionAccessToken = "";
let liveSessionExpiresAtSec = 0;

function decodeJwtExpSeconds(token) {
  if (typeof token !== "string") return 0;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return 0;
  try {
    const base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp : 0;
  } catch {
    return 0;
  }
}

export function isJwtFresh(token, expiresAtHintSec = 0, nowMs = Date.now()) {
  if (typeof token !== "string" || !token.trim()) return false;
  const expSec = Number(expiresAtHintSec) || decodeJwtExpSeconds(token);
  if (!expSec) return true;
  const nowSec = Math.floor(nowMs / 1000);
  return expSec > nowSec + JWT_EXPIRY_GRACE_SECONDS;
}

export function setLiveSupabaseSessionToken(token = "", expiresAtSec = 0) {
  liveSessionAccessToken = typeof token === "string" ? token.trim() : "";
  liveSessionExpiresAtSec =
    Number(expiresAtSec) || decodeJwtExpSeconds(liveSessionAccessToken);
}

function getSupabaseRestConfig() {
  const url = cleanEnv(import.meta.env?.VITE_SUPABASE_URL).replace(/\/+$/, "");
  const anonKey = cleanEnv(import.meta.env?.VITE_SUPABASE_ANON_KEY);
  return { url, anonKey };
}

export function readSupabaseAccessTokenFromStorage(nowMs = Date.now()) {
  if (
    liveSessionAccessToken &&
    isJwtFresh(liveSessionAccessToken, liveSessionExpiresAtSec, nowMs)
  ) {
    return liveSessionAccessToken;
  }

  if (typeof window === "undefined") return "";
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const sessionObj =
        parsed?.currentSession || parsed?.session || parsed || {};
      const token = sessionObj?.access_token || parsed?.access_token || "";
      const expiresAt =
        Number(sessionObj?.expires_at ?? parsed?.expires_at) || 0;
      if (
        typeof token === "string" &&
        token.trim() &&
        isJwtFresh(token.trim(), expiresAt, nowMs)
      ) {
        return token.trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function readCloudSyncOutbox(userId = null) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_OUTBOX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (userId && parsed.userId && parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasPendingCloudOutbox(userId = null) {
  const outbox = readCloudSyncOutbox(userId);
  return Boolean(outbox && outbox.dirty === true);
}

export function persistCloudSyncOutbox({
  userId,
  snapshot = null,
  serializedSnapshot = "",
  expectedUpdatedAt = null,
  forceOverwrite = false,
} = {}) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const existing = readCloudSyncOutbox(userId);
    const now = Date.now();
    const pinProtected = hasAppPin();
    const entry = {
      userId,
      dirty: true,
      queuedAt: existing?.dirty ? existing.queuedAt || now : now,
      updatedAt: now,
      mutationCount: (Number(existing?.mutationCount) || 0) + 1,
      expectedUpdatedAt:
        expectedUpdatedAt ?? existing?.expectedUpdatedAt ?? null,
      forceOverwrite: Boolean(forceOverwrite || existing?.forceOverwrite),
      snapshotLength: serializedSnapshot
        ? serializedSnapshot.length
        : existing?.snapshotLength || 0,
      ...(!pinProtected && snapshot && typeof snapshot === "object"
        ? { snapshot: sanitizeCloudPayload(snapshot) }
        : {}),
    };
    localStorage.setItem(CLOUD_SYNC_OUTBOX_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function clearCloudSyncOutbox(
  userId = null,
  syncedUpdatedAt = null,
  syncedSnapshotLength = 0,
) {
  if (typeof window === "undefined") return false;
  try {
    const existing = readCloudSyncOutbox(userId);
    if (!existing) return true;
    if (userId && existing.userId && existing.userId !== userId) return false;
    const cleared = {
      userId: userId || existing.userId || "",
      dirty: false,
      queuedAt: 0,
      updatedAt: Date.now(),
      mutationCount: 0,
      expectedUpdatedAt: syncedUpdatedAt || existing.expectedUpdatedAt || null,
      lastSyncedUpdatedAt:
        syncedUpdatedAt ||
        existing.lastSyncedUpdatedAt ||
        new Date().toISOString(),
      lastSyncedLength: syncedSnapshotLength || existing.snapshotLength || 0,
      forceOverwrite: false,
    };
    localStorage.setItem(CLOUD_SYNC_OUTBOX_KEY, JSON.stringify(cleared));
    return true;
  } catch {
    return false;
  }
}

/**
 * Flushes pending cloud snapshot using fetch(..., { keepalive: true })
 * so mobile OS / browser swipe-close or pagehide does not abort in-flight syncs.
 * Validates JWT freshness before dispatching so expired localStorage tokens are never sent.
 */
export function flushCloudSyncKeepalive(
  userId,
  data,
  expectedUpdatedAt = null,
  { forceOverwrite = false, onSaved = null, onConflict = null } = {},
) {
  if (typeof window === "undefined" || typeof fetch !== "function" || !userId) {
    return false;
  }
  const snapshotToFlush =
    data && typeof data === "object"
      ? data
      : readCloudSyncOutbox(userId)?.snapshot || null;
  if (!snapshotToFlush) return false;

  // Always persist dirty outbox state before attempting network keepalive
  persistCloudSyncOutbox({
    userId,
    snapshot: snapshotToFlush,
    expectedUpdatedAt,
    forceOverwrite,
  });

  const { url, anonKey } = getSupabaseRestConfig();
  const accessToken = readSupabaseAccessTokenFromStorage();
  if (!url || !anonKey || !accessToken) {
    return false;
  }

  const sanitized = sanitizeCloudPayload(snapshotToFlush);
  let rpcPayload = {
    p_data: sanitized,
    p_expected_updated_at: expectedUpdatedAt || null,
    p_force_overwrite: Boolean(forceOverwrite),
  };
  let body = JSON.stringify(rpcPayload);

  if (
    body.length > KEEPALIVE_MAX_BYTES &&
    sanitized?.profileAvatar &&
    String(sanitized.profileAvatar).length > 4096
  ) {
    const compactData = {
      ...sanitized,
      profileAvatar: KEEPALIVE_AVATAR_SENTINEL,
    };
    rpcPayload = {
      p_data: compactData,
      p_expected_updated_at: expectedUpdatedAt || null,
      p_force_overwrite: Boolean(forceOverwrite),
    };
    body = JSON.stringify(rpcPayload);
  }

  if (body.length > KEEPALIVE_MAX_BYTES) {
    return false;
  }

  try {
    void fetch(`${url}/rest/v1/rpc/save_spend_user_snapshot`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
      keepalive: true,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const result = await res.json().catch(() => null);
        if (result && result.status === "saved") {
          clearCloudSyncOutbox(userId, result.updated_at || null, body.length);
          onSaved?.(result.updated_at || null, snapshotToFlush);
        } else if (result && result.status === "conflict") {
          onConflict?.(result);
        }
      })
      .catch(() => {
        // Outbox remains dirty for retry on next launch
      });
    return true;
  } catch {
    return false;
  }
}

export function summarizeCheckpointSnapshot(data) {
  if (!data || typeof data !== "object") {
    return {
      cardCount: 0,
      expenseCount: 0,
      txCount: 0,
      totalOpeningBalance: 0,
      totalCurrentBalance: 0,
      isBalanced: true,
    };
  }
  const settings = data?.accountData?.settings || {};
  const cards = Array.isArray(settings.cards) ? settings.cards : [];
  const opening = settings.openingBalances || settings.balances || {};
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  const txs = Array.isArray(data?.accountData?.transactions)
    ? data.accountData.transactions
    : Array.isArray(data?.accountTransactions)
      ? data.accountTransactions
      : [];

  const computed = computeAccountBalances(
    cards,
    opening,
    expenses,
    txs,
    settings.currentBalances || null,
  );

  return {
    cardCount: cards.length,
    expenseCount: expenses.length,
    txCount: txs.length,
    totalOpeningBalance: computed.reconciliation.totalOpening,
    totalCurrentBalance: computed.reconciliation.totalCurrentBalance,
    totalCredits: computed.reconciliation.totalCredits,
    totalDebits: computed.reconciliation.totalDebits,
    isBalanced: computed.reconciliation.isBalanced,
  };
}

function snapshotHasMeaningfulRecords(data) {
  const summary = summarizeCheckpointSnapshot(data);
  return (
    summary.cardCount > 0 || summary.expenseCount > 0 || summary.txCount > 0
  );
}

function readLocalCheckpointsRaw() {
  if (typeof window === "undefined") return [];
  try {
    if (hasAppPin() && !isSessionUnlocked()) return [];
    const raw = localStorage.getItem(LOCAL_CHECKPOINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCheckpointsRaw(items) {
  if (typeof window === "undefined") return false;
  if (hasAppPin() && !isSessionUnlocked()) return false;
  let current = Array.isArray(items) ? items : [];
  while (current.length > 0) {
    try {
      localStorage.setItem(LOCAL_CHECKPOINTS_KEY, JSON.stringify(current));
      return true;
    } catch {
      if (current.length === 1) return false;
      current = current.slice(0, Math.max(1, current.length - 2));
    }
  }
  return false;
}

export function captureLocalBackupCheckpoint(
  userId,
  data,
  {
    type = "daily",
    label = "",
    sourceUpdatedAt = null,
    id = "",
    createdAt = null,
  } = {},
) {
  if (!data || typeof data !== "object") return null;
  const normalizedType = [
    "daily",
    "pre_restore",
    "pre_overwrite",
    "manual",
  ].includes(type)
    ? type
    : "daily";
  if (hasAppPin() && !isSessionUnlocked() && normalizedType !== "manual") {
    return null;
  }
  if (normalizedType !== "manual" && !snapshotHasMeaningfulRecords(data)) {
    return null;
  }

  const sanitized = sanitizeCloudPayload(data);
  if (
    sanitized?.profile &&
    typeof sanitized.profile === "object" &&
    sanitized.profile.avatar
  ) {
    sanitized.profile = { ...sanitized.profile, avatar: "" };
  }
  const summary = summarizeCheckpointSnapshot(sanitized);
  const today = localDate();
  const nowIso = createdAt || new Date().toISOString();
  const effectiveUser = userId || "local";
  const all = readLocalCheckpointsRaw();

  if (normalizedType === "daily") {
    const existingDaily = all.find(
      (item) =>
        (item.userId || "local") === effectiveUser &&
        item.checkpointType === "daily" &&
        item.checkpointDate === today,
    );
    if (existingDaily) {
      return existingDaily;
    }
  }

  const resolvedLabel =
    (typeof label === "string" && label.trim()) ||
    (normalizedType === "daily"
      ? "Daily automatic snapshot"
      : normalizedType === "pre_restore"
        ? "Safety snapshot before restore"
        : normalizedType === "pre_overwrite"
          ? "Safety snapshot before overwrite"
          : "Manual backup checkpoint");

  const entry = {
    id: id || `local-${makeId()}`,
    userId: effectiveUser,
    checkpointType: normalizedType,
    checkpointDate: today,
    label: resolvedLabel,
    ledgerSummary: summary,
    cardCount: summary.cardCount,
    expenseCount: summary.expenseCount,
    txCount: summary.txCount,
    sourceUpdatedAt: sourceUpdatedAt || nowIso,
    createdAt: nowIso,
    isLocalOnly: !id || String(id).startsWith("local-"),
    data: sanitized,
  };

  const next = [entry, ...all.filter((item) => item?.id !== entry.id)];
  let dailyCount = 0;
  let eventCount = 0;
  const pruned = next.filter((item) => {
    if ((item?.userId || "local") !== effectiveUser) return true;
    if (item.checkpointType === "daily") {
      dailyCount += 1;
      return dailyCount <= MAX_LOCAL_DAILY_CHECKPOINTS;
    }
    eventCount += 1;
    return eventCount <= MAX_LOCAL_EVENT_CHECKPOINTS;
  });

  writeLocalCheckpointsRaw(pruned);
  return entry;
}

export function ensureDailyBackupCheckpoint(
  userId,
  data,
  sourceUpdatedAt = null,
) {
  return captureLocalBackupCheckpoint(userId, data, {
    type: "daily",
    label: "Daily automatic snapshot",
    sourceUpdatedAt,
  });
}

export async function listBackupCheckpoints(
  userId = null,
  { limit = 25 } = {},
) {
  const effectiveUser = userId || "local";
  const localItems = readLocalCheckpointsRaw()
    .filter(
      (item) =>
        item &&
        ((item.userId || "local") === effectiveUser || item.userId === "local"),
    )
    .map(({ data: _data, ...meta }) => ({
      ...meta,
      source: meta.isLocalOnly ? "device" : "cloud",
    }));

  if (!userId) {
    return localItems.slice(0, limit);
  }

  try {
    const client = await getSupabase();
    if (client) {
      const rpcRes = await client.rpc("list_spend_backup_checkpoints", {
        p_limit: limit,
      });
      if (!rpcRes.error && Array.isArray(rpcRes.data?.checkpoints)) {
        const cloudCheckpoints = rpcRes.data.checkpoints.map((cp) => ({
          ...cp,
          source: "cloud",
        }));
        const seenIds = new Set(cloudCheckpoints.map((cp) => String(cp.id)));
        const seenDailyDates = new Set(
          cloudCheckpoints
            .filter((cp) => cp.checkpointType === "daily")
            .map((cp) => String(cp.checkpointDate)),
        );
        const merged = [...cloudCheckpoints];
        for (const loc of localItems) {
          if (seenIds.has(String(loc.id))) continue;
          if (
            loc.checkpointType === "daily" &&
            seenDailyDates.has(String(loc.checkpointDate))
          ) {
            continue;
          }
          merged.push(loc);
        }
        merged.sort(
          (a, b) =>
            (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
        );
        return merged.slice(0, limit);
      }
    }
  } catch {
    // Fallback to local checkpoints when offline or before migration is applied
  }

  return localItems.slice(0, limit);
}

export async function createBackupCheckpoint(
  userId,
  { type = "manual", label = "", data = null } = {},
) {
  const sanitized = data ? sanitizeCloudPayload(data) : null;
  const localEntry = sanitized
    ? captureLocalBackupCheckpoint(userId, sanitized, { type, label })
    : null;

  if (!userId) {
    return localEntry;
  }

  try {
    const client = await getSupabase();
    if (client) {
      const rpcRes = await client.rpc("create_spend_backup_checkpoint", {
        p_checkpoint_type: type,
        p_label: label || null,
        p_data: sanitized,
      });
      if (!rpcRes.error && rpcRes.data?.checkpoint) {
        const cloudCheckpoint = {
          ...rpcRes.data.checkpoint,
          source: "cloud",
        };
        if (sanitized) {
          captureLocalBackupCheckpoint(userId, sanitized, {
            type: cloudCheckpoint.checkpointType || type,
            label: cloudCheckpoint.label || label,
            id: cloudCheckpoint.id,
            createdAt: cloudCheckpoint.createdAt,
            sourceUpdatedAt: cloudCheckpoint.sourceUpdatedAt,
          });
        }
        return cloudCheckpoint;
      }
    }
  } catch {
    // Return local checkpoint fallback if offline or RPC not yet deployed
  }

  return localEntry;
}

export async function restoreBackupCheckpoint(
  userId,
  checkpointId,
  currentData = null,
) {
  if (!checkpointId) {
    throw new Error("Please select a backup checkpoint to restore.");
  }

  if (currentData && snapshotHasMeaningfulRecords(currentData)) {
    captureLocalBackupCheckpoint(userId, currentData, {
      type: "pre_restore",
      label: "Safety snapshot before checkpoint rollback",
    });
  }

  const buildRollbackDeletedRecords = (baseDeleted, targetData, beforeData) => {
    const nowMs = Date.now();
    const normalizedBase = normalizeDeletedRecords(baseDeleted, nowMs);
    const mergedDel = {
      expenses: { ...(normalizedBase?.expenses || {}) },
      budgets: { ...(normalizedBase?.budgets || {}) },
      recurringSchedules: { ...(normalizedBase?.recurringSchedules || {}) },
      accountTransactions: { ...(normalizedBase?.accountTransactions || {}) },
      cards: { ...(normalizedBase?.cards || {}) },
    };
    if (!beforeData || typeof beforeData !== "object") {
      return normalizeDeletedRecords(mergedDel, nowMs);
    }

    const targetTxIds = new Set(
      (targetData?.accountData?.transactions || [])
        .map((t) => t?.id)
        .filter(Boolean),
    );
    for (const tx of beforeData?.accountData?.transactions || []) {
      if (tx?.id && !targetTxIds.has(tx.id)) {
        const txTime =
          parseTimestampMs(tx.updatedAt) || parseTimestampMs(tx.createdAt) || 0;
        mergedDel.accountTransactions[tx.id] = {
          deleted: true,
          updatedAt: Math.max(nowMs, txTime + 1),
        };
      }
    }

    const targetExpIds = new Set(
      (targetData?.expenses || []).map((e) => e?.id).filter(Boolean),
    );
    for (const exp of beforeData?.expenses || []) {
      if (exp?.id && !targetExpIds.has(exp.id)) {
        const expTime =
          parseTimestampMs(exp.updatedAt) ||
          parseTimestampMs(exp.createdAt) ||
          0;
        mergedDel.expenses[exp.id] = {
          deleted: true,
          updatedAt: Math.max(nowMs, expTime + 1),
        };
      }
    }

    const targetRecIds = new Set(
      (targetData?.recurringSchedules || []).map((r) => r?.id).filter(Boolean),
    );
    for (const rec of beforeData?.recurringSchedules || []) {
      if (rec?.id && !targetRecIds.has(rec.id)) {
        const recTime =
          parseTimestampMs(rec.updatedAt) ||
          parseTimestampMs(rec.createdAt) ||
          0;
        mergedDel.recurringSchedules[rec.id] = {
          deleted: true,
          updatedAt: Math.max(nowMs, recTime + 1),
        };
      }
    }

    const targetCardIds = new Set(
      (targetData?.accountData?.settings?.cards || [])
        .map((c) => c?.id)
        .filter(Boolean),
    );
    for (const card of beforeData?.accountData?.settings?.cards || []) {
      if (card?.id && !targetCardIds.has(card.id)) {
        const cardTime =
          parseTimestampMs(card.updatedAt) ||
          parseTimestampMs(card.createdAt) ||
          0;
        mergedDel.cards[card.id] = {
          deleted: true,
          updatedAt: Math.max(nowMs, cardTime + 1),
        };
      }
    }

    const targetBudgetMonths = new Set(
      Object.keys(targetData?.budgets || {}).filter(Boolean),
    );
    for (const month of Object.keys(beforeData?.budgets || {})) {
      if (month && !targetBudgetMonths.has(month)) {
        const bTime =
          parseTimestampMs(beforeData?.budgetUpdatedAt?.[month]) || 0;
        mergedDel.budgets[month] = {
          deleted: true,
          updatedAt: Math.max(nowMs, bTime + 1),
        };
      }
    }
    return normalizeDeletedRecords(mergedDel, nowMs);
  };

  const isLocalId = String(checkpointId).startsWith("local-");
  if (userId && !isLocalId) {
    const client = await getSupabase();
    if (client) {
      const rpcRes = await client.rpc("restore_spend_backup_checkpoint", {
        p_checkpoint_id: checkpointId,
      });
      if (!rpcRes.error && rpcRes.data?.data) {
        const restoredData = rpcRes.data.data;
        const effectiveDeleted = buildRollbackDeletedRecords(
          restoredData.deletedRecords,
          restoredData,
          currentData,
        );
        return {
          status: "restored",
          source: "cloud",
          updated_at: rpcRes.data.updated_at || new Date().toISOString(),
          reconciliation: rpcRes.data.reconciliation || null,
          data: {
            ...restoredData,
            deletedRecords: effectiveDeleted,
            accountData: loadAccountData(
              restoredData.accountData ?? emptyAccountData(),
              effectiveDeleted,
              restoredData.expenses,
            ),
          },
        };
      }
      if (
        rpcRes.error &&
        rpcRes.error.code !== "42883" &&
        rpcRes.error.code !== "PGRST202"
      ) {
        throw rpcRes.error;
      }
    }
  }

  const localMatch = readLocalCheckpointsRaw().find(
    (item) => String(item?.id) === String(checkpointId),
  );
  if (!localMatch || !localMatch.data) {
    throw new Error(
      "Checkpoint payload not found on this device. Connect to the internet to restore from cloud.",
    );
  }

  const effectiveLocalDeleted = buildRollbackDeletedRecords(
    localMatch.data.deletedRecords,
    localMatch.data,
    currentData,
  );
  const restoredLocal = {
    ...localMatch.data,
    deletedRecords: effectiveLocalDeleted,
    ...(localMatch.data.profile &&
    !localMatch.data.profile.avatar &&
    currentData?.profile?.avatar
      ? {
          profile: {
            ...localMatch.data.profile,
            avatar: currentData.profile.avatar,
          },
        }
      : {}),
    accountData: loadAccountData(
      localMatch.data.accountData ?? emptyAccountData(),
      effectiveLocalDeleted,
      localMatch.data.expenses,
    ),
  };

  let savedCloudResult = null;
  if (userId) {
    try {
      savedCloudResult = await saveCloudData(userId, restoredLocal, null, {
        forceOverwrite: true,
      });
    } catch {
      // Offline during local checkpoint restore: outbox will sync when back online
    }
  }

  return {
    status: "restored",
    source: "device",
    updated_at:
      (typeof savedCloudResult === "object"
        ? savedCloudResult?.updated_at
        : savedCloudResult) || new Date().toISOString(),
    data: restoredLocal,
  };
}

export async function checkSupabaseSqlHealth() {
  const client = await getSupabase();
  if (!client) {
    return {
      installed: false,
      allPassed: false,
      schemaVersion: null,
      checks: [],
      cloudReconciliation: null,
    };
  }
  try {
    const [installRes, reconcileRes] = await Promise.all([
      client.rpc("verify_spend_sql_installation"),
      client.rpc("verify_spend_ledger_reconciliation"),
    ]);
    const checks = Array.isArray(installRes?.data) ? installRes.data : [];
    const cloudReconciliation =
      !reconcileRes?.error && reconcileRes?.data ? reconcileRes.data : null;
    if (checks.length > 0) {
      const allPassed = checks.every((c) =>
        String(c?.status || "").includes("INSTALLED"),
      );
      return {
        installed: true,
        allPassed,
        schemaVersion: cloudReconciliation?.schemaVersion || "2026.11.18",
        checks,
        cloudReconciliation,
      };
    }
    if (cloudReconciliation) {
      const ver = String(cloudReconciliation.schemaVersion || "");
      return {
        installed: true,
        allPassed: Boolean(ver >= "2026.11.17"),
        schemaVersion: ver || "2026.11.16",
        checks: [],
        cloudReconciliation,
      };
    }
  } catch {
    // Fall through
  }
  return {
    installed: false,
    allPassed: false,
    schemaVersion: null,
    checks: [],
    cloudReconciliation: null,
  };
}

export function hasPotentialCloudSession() {
  if (typeof window === "undefined") return false;
  try {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    if (
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      hash.includes("type=recovery") ||
      hash.includes("error=") ||
      search.includes("code=")
    ) {
      return true;
    }
    if (localStorage.getItem(CLOUD_SYNC_USER_KEY)) {
      return true;
    }
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

const LEGACY_DB_ACCOUNTS = new Set(["bkash", "bank", "savings"]);

function isNormalizedAccountSchemaUnavailable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function isLegacyAccountConstraintError(error) {
  return (
    error?.code === "22023" ||
    error?.code === "23514" ||
    Boolean(error?.message?.includes("Invalid spend_account_transactions"))
  );
}

function isLegacyDbCompatibleTransaction(tx) {
  if (!tx || typeof tx !== "object") return false;
  const type = tx.type === "adjust" ? "adjustment" : tx.type;
  const account = tx.account ?? tx.acct;
  const fromAccount = tx.fromAccount ?? tx.acct;
  const toAccount = tx.toAccount ?? tx.to;
  if (type === "income" || type === "adjustment") {
    return LEGACY_DB_ACCOUNTS.has(account);
  }
  if (type === "transfer") {
    return (
      LEGACY_DB_ACCOUNTS.has(fromAccount) &&
      LEGACY_DB_ACCOUNTS.has(toAccount) &&
      fromAccount !== toAccount
    );
  }
  return false;
}

export function mergeAccountDataWithRawSnapshot(
  normalizedAccountData,
  rawSnapshotData,
) {
  const rawAccounts = rawSnapshotData?.accountData;
  const rawSettings = rawAccounts?.settings || {};
  const normSettings = normalizedAccountData?.settings || {};
  const deletedRecords = normalizeDeletedRecords(
    rawSnapshotData?.deletedRecords,
  );
  const deletedCardTombstones = deletedRecords.cards || {};
  const deletedTxTombstones = deletedRecords.accountTransactions || {};

  const rawUpdatedAt = parseTimestampMs(rawSettings.updatedAt);
  const normUpdatedAt = parseTimestampMs(normSettings.updatedAt);
  const preferRaw = rawUpdatedAt >= normUpdatedAt;

  const rawCards = Array.isArray(rawSettings.cards) ? rawSettings.cards : [];
  const normCards = Array.isArray(normSettings.cards) ? normSettings.cards : [];
  const primaryCards = preferRaw ? rawCards : normCards;
  const secondaryCards = preferRaw ? normCards : rawCards;

  // Seed cardMap in primaryCards order first so Map key insertion order matches the newer snapshot
  const cardMap = new Map();
  for (const c of primaryCards) {
    if (!c?.id || isPhantomAutoReconstructedCard(c)) continue;
    const tombstone = deletedCardTombstones[c.id];
    const cTime =
      parseTimestampMs(c.updatedAt) || parseTimestampMs(c.createdAt);
    if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
    cardMap.set(c.id, c);
  }
  for (const c of secondaryCards) {
    if (!c?.id || isPhantomAutoReconstructedCard(c)) continue;
    const tombstone = deletedCardTombstones[c.id];
    const cTime =
      parseTimestampMs(c.updatedAt) || parseTimestampMs(c.createdAt);
    if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
    const existing = cardMap.get(c.id);
    const exTime =
      parseTimestampMs(existing?.updatedAt) ||
      parseTimestampMs(existing?.createdAt);
    if (!existing || cTime > exTime) {
      cardMap.set(c.id, c);
    }
  }

  const orderedCardIds = [];
  const seenIds = new Set();
  for (const c of primaryCards) {
    if (c?.id && cardMap.has(c.id) && !seenIds.has(c.id)) {
      orderedCardIds.push(c.id);
      seenIds.add(c.id);
    }
  }
  for (const c of secondaryCards) {
    if (c?.id && cardMap.has(c.id) && !seenIds.has(c.id)) {
      orderedCardIds.push(c.id);
      seenIds.add(c.id);
    }
  }
  for (const id of cardMap.keys()) {
    if (!seenIds.has(id)) {
      orderedCardIds.push(id);
      seenIds.add(id);
    }
  }

  const rawBalances =
    rawSettings.openingBalances &&
    typeof rawSettings.openingBalances === "object" &&
    Object.keys(rawSettings.openingBalances).length > 0
      ? rawSettings.openingBalances
      : rawSettings.balances && typeof rawSettings.balances === "object"
        ? rawSettings.balances
        : {};
  const normBalances =
    normSettings.openingBalances &&
    typeof normSettings.openingBalances === "object" &&
    Object.keys(normSettings.openingBalances).length > 0
      ? normSettings.openingBalances
      : normSettings.balances && typeof normSettings.balances === "object"
        ? normSettings.balances
        : {};
  const rawCurrentBalances =
    rawSettings.currentBalances &&
    typeof rawSettings.currentBalances === "object"
      ? rawSettings.currentBalances
      : {};
  const normCurrentBalances =
    normSettings.currentBalances &&
    typeof normSettings.currentBalances === "object"
      ? normSettings.currentBalances
      : {};

  const mergedBalances = {};
  const mergedCurrentBalances = {
    ...normCurrentBalances,
    ...(preferRaw ? rawCurrentBalances : {}),
  };
  const mergedCards = orderedCardIds.map((id) => {
    const card = cardMap.get(id);
    const rawCard = rawCards.find((c) => c?.id === id);
    const normCard = normCards.find((c) => c?.id === id);
    const rawCardTime =
      parseTimestampMs(rawCard?.updatedAt) ||
      parseTimestampMs(rawCard?.createdAt) ||
      rawUpdatedAt;
    const normCardTime =
      parseTimestampMs(normCard?.updatedAt) ||
      parseTimestampMs(normCard?.createdAt) ||
      normUpdatedAt;
    const useRawForCard = rawCard && (!normCard || rawCardTime >= normCardTime);

    const hasRawBal =
      Object.hasOwn(rawBalances, id) &&
      rawBalances[id] !== undefined &&
      rawBalances[id] !== null &&
      Number.isFinite(Number(rawBalances[id]));
    const hasNormBal =
      Object.hasOwn(normBalances, id) &&
      normBalances[id] !== undefined &&
      normBalances[id] !== null &&
      Number.isFinite(Number(normBalances[id]));
    const hasCardInitBal =
      card?.initialBalance !== undefined &&
      card?.initialBalance !== null &&
      String(card.initialBalance).trim() !== "" &&
      Number.isFinite(Number(card.initialBalance));

    let resolvedBal = 0;
    if (useRawForCard) {
      if (hasRawBal) {
        resolvedBal = Number(rawBalances[id]);
      } else if (hasCardInitBal) {
        resolvedBal = Number(card.initialBalance);
      } else if (hasNormBal) {
        resolvedBal = Number(normBalances[id]);
      }
    } else if (hasNormBal) {
      resolvedBal = Number(normBalances[id]);
    } else if (hasCardInitBal) {
      resolvedBal = Number(card.initialBalance);
    } else if (hasRawBal) {
      resolvedBal = Number(rawBalances[id]);
    }

    if (
      hasCardInitBal &&
      Number(card.initialBalance) > 0 &&
      resolvedBal === 0 &&
      hasRawBal &&
      Number(rawBalances[id]) === Number(card.initialBalance)
    ) {
      resolvedBal = Number(card.initialBalance);
    }

    const cleanBal =
      Number.isFinite(resolvedBal) && resolvedBal >= 0
        ? roundMoney(resolvedBal)
        : 0;
    mergedBalances[id] = cleanBal;

    const currentBalCandidate = useRawForCard
      ? (rawCurrentBalances[id] ??
        card?.currentBalance ??
        normCurrentBalances[id])
      : (normCurrentBalances[id] ??
        card?.currentBalance ??
        rawCurrentBalances[id]);
    if (
      currentBalCandidate !== undefined &&
      currentBalCandidate !== null &&
      Number.isFinite(Number(currentBalCandidate))
    ) {
      mergedCurrentBalances[id] = roundMoney(Number(currentBalCandidate));
    }

    return {
      ...card,
      subtitle:
        typeof card?.subtitle === "string"
          ? card.subtitle.replace(/\bUSD\b/gi, "BDT")
          : card?.subtitle || "",
      currency:
        !card?.currency || String(card.currency).toUpperCase() === "USD"
          ? "BDT"
          : card.currency,
      initialBalance: cleanBal,
      ...(mergedCurrentBalances[id] !== undefined
        ? { currentBalance: mergedCurrentBalances[id] }
        : {}),
    };
  });

  const remappedSavingsIds = {};
  const savingsInMerged = mergedCards.filter(isSavingsCard);
  if (savingsInMerged.length > 1) {
    savingsInMerged.sort((a, b) => {
      const tDiff =
        (parseTimestampMs(b.updatedAt) || 0) -
        (parseTimestampMs(a.updatedAt) || 0);
      if (tDiff !== 0) return tDiff;
      return (Number(b.initialBalance) || 0) - (Number(a.initialBalance) || 0);
    });
    const winner = savingsInMerged[0];
    for (let i = 1; i < savingsInMerged.length; i += 1) {
      const loser = savingsInMerged[i];
      remappedSavingsIds[loser.id] = winner.id;
      delete mergedBalances[loser.id];
      delete mergedCurrentBalances[loser.id];
    }
  }
  const deduplicatedCards = mergedCards.filter(
    (c) => !Object.hasOwn(remappedSavingsIds, c.id),
  );

  for (const [id, tombstone] of Object.entries(deletedCardTombstones)) {
    if (tombstone?.deleted && !cardMap.has(id)) {
      delete mergedBalances[id];
      delete mergedCurrentBalances[id];
    }
  }

  const normTransactions = Array.isArray(normalizedAccountData?.transactions)
    ? normalizedAccountData.transactions
    : [];
  const extraTransactions = Array.isArray(
    rawSnapshotData?.customAccountTransactions,
  )
    ? rawSnapshotData.customAccountTransactions
    : [];
  const rawTransactions = Array.isArray(rawAccounts?.transactions)
    ? rawAccounts.transactions
    : [];

  const txMap = new Map();
  const upsertTx = (tx) => {
    if (!tx?.id) return;
    const txType = tx.type === "adjust" ? "adjustment" : tx.type;
    if (!["income", "adjustment", "transfer"].includes(txType)) return;
    const tombstone = deletedTxTombstones[tx.id];
    if (tombstone?.deleted === true) return;
    const txTime =
      parseTimestampMs(tx.updatedAt) || parseTimestampMs(tx.createdAt);
    const existing = txMap.get(tx.id);
    const exTime =
      parseTimestampMs(existing?.updatedAt) ||
      parseTimestampMs(existing?.createdAt);
    if (!existing || txTime >= exTime) {
      txMap.set(tx.id, tx);
    }
  };

  for (const tx of normTransactions) {
    upsertTx(tx);
  }
  for (const tx of extraTransactions) {
    upsertTx(tx);
  }
  for (const tx of rawTransactions) {
    upsertTx(tx);
  }

  const baseSettings = preferRaw
    ? { ...normSettings, ...rawSettings }
    : { ...rawSettings, ...normSettings };

  return loadAccountData(
    {
      settings: {
        ...baseSettings,
        balances: mergedBalances,
        openingBalances: mergedBalances,
        currentBalances: mergedCurrentBalances,
        cards: deduplicatedCards,
        cardsConfigured:
          rawSettings.cardsConfigured === true ||
          normSettings.cardsConfigured === true ||
          deduplicatedCards.length > 0,
        configured:
          rawSettings.configured === true ||
          normSettings.configured === true ||
          deduplicatedCards.length > 0,
        updatedAt: Math.max(rawUpdatedAt, normUpdatedAt),
      },
      transactions: Array.from(txMap.values()),
    },
    deletedRecords,
    rawSnapshotData?.expenses,
  );
}

async function loadLegacyCloudData(client, userId) {
  let settingsQuery = client
    .from("spend_account_settings")
    .select(
      "start_date, bkash_balance, bank_balance, savings_balance, cards, balances, opening_balances, current_balances, configured, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const [snapshotResult, initialSettingsResult, initialTransactionsResult] =
    await Promise.all([
      client
        .from("spend_user_data")
        .select("data, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      settingsQuery,
      client
        .from("spend_account_transactions")
        .select(
          "id, type, amount, transaction_date, description, category, recurring_id, account, direction, from_account, to_account, balance_before, balance_after, from_balance_after, to_balance_after, created_at, updated_at",
        )
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
    ]);

  let settingsResult = initialSettingsResult;
  if (
    settingsResult.error &&
    (settingsResult.error.code === "PGRST204" ||
      settingsResult.error.code === "42703" ||
      settingsResult.error.message?.includes("opening_balances") ||
      settingsResult.error.message?.includes("cards") ||
      settingsResult.error.message?.includes("savings_balance"))
  ) {
    settingsResult = await client
      .from("spend_account_settings")
      .select("start_date, bkash_balance, bank_balance, configured, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
  }

  let transactionsResult = initialTransactionsResult;
  if (
    transactionsResult.error &&
    (transactionsResult.error.code === "PGRST204" ||
      transactionsResult.error.code === "42703" ||
      transactionsResult.error.message?.includes("balance_after") ||
      transactionsResult.error.message?.includes("category"))
  ) {
    transactionsResult = await client
      .from("spend_account_transactions")
      .select(
        "id, type, amount, transaction_date, description, account, direction, from_account, to_account, created_at, updated_at",
      )
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
  }

  if (snapshotResult.error) throw snapshotResult.error;

  const snapshot = snapshotResult.data;
  const snapshotData = snapshot?.data ?? null;

  const normalizedSchemaUnavailable =
    isNormalizedAccountSchemaUnavailable(settingsResult.error) ||
    isNormalizedAccountSchemaUnavailable(transactionsResult.error);
  if (!snapshot) {
    if (!normalizedSchemaUnavailable) {
      if (settingsResult.error) throw settingsResult.error;
      if (transactionsResult.error) throw transactionsResult.error;
    }
    return {
      data: null,
      updated_at: null,
      normalizedAccountSync: !normalizedSchemaUnavailable,
    };
  }

  const legacyAccounts = snapshotData?.accountData ?? emptyAccountData();
  if (normalizedSchemaUnavailable) {
    return {
      ...snapshot,
      normalizedAccountSync: false,
      data: {
        ...snapshotData,
        accountData: mergeAccountDataWithRawSnapshot(
          legacyAccounts,
          snapshotData,
        ),
      },
    };
  }
  if (settingsResult.error) throw settingsResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const tableCards = Array.isArray(settingsResult.data?.cards)
    ? settingsResult.data.cards.filter(
        (c) => !isPhantomAutoReconstructedCard(c),
      )
    : [];
  const rawCards =
    tableCards.length > 0
      ? tableCards
      : Array.isArray(legacyAccounts?.settings?.cards)
        ? legacyAccounts.settings.cards.filter(
            (c) => !isPhantomAutoReconstructedCard(c),
          )
        : [];
  const legacyBalances =
    legacyAccounts?.settings?.openingBalances ||
    legacyAccounts?.settings?.balances ||
    {};
  const tableOpeningBalances =
    settingsResult.data?.opening_balances &&
    typeof settingsResult.data.opening_balances === "object" &&
    Object.keys(settingsResult.data.opening_balances).length > 0
      ? settingsResult.data.opening_balances
      : settingsResult.data?.balances &&
          typeof settingsResult.data.balances === "object"
        ? settingsResult.data.balances
        : {};
  const baseBalances = { ...legacyBalances, ...tableOpeningBalances };
  const baseCurrentBalances = {
    ...(legacyAccounts?.settings?.currentBalances || {}),
    ...(settingsResult.data?.current_balances &&
    typeof settingsResult.data.current_balances === "object"
      ? settingsResult.data.current_balances
      : {}),
  };

  if (settingsResult.data) {
    if (
      rawCards.some((c) => c?.id === "bkash") &&
      baseBalances.bkash === undefined &&
      Number(settingsResult.data.bkash_balance) > 0
    ) {
      baseBalances.bkash = settingsResult.data.bkash_balance;
    }
    if (
      rawCards.some((c) => c?.id === "bank") &&
      baseBalances.bank === undefined &&
      Number(settingsResult.data.bank_balance) > 0
    ) {
      baseBalances.bank = settingsResult.data.bank_balance;
    }
    if (
      rawCards.some((c) => c?.id === "savings") &&
      baseBalances.savings === undefined &&
      Number(settingsResult.data.savings_balance) > 0
    ) {
      baseBalances.savings = settingsResult.data.savings_balance;
    }
  }

  const normalizedAccounts = settingsResult.data
    ? {
        settings: {
          startDate: settingsResult.data.start_date,
          balances: baseBalances,
          openingBalances: baseBalances,
          currentBalances: baseCurrentBalances,
          cards: rawCards,
          cardsConfigured:
            legacyAccounts?.settings?.cardsConfigured === true ||
            rawCards.length > 0,
          configured: settingsResult.data.configured,
          updatedAt: Math.max(
            Date.parse(settingsResult.data.updated_at) || 0,
            Number(legacyAccounts?.settings?.updatedAt) || 0,
          ),
        },
        transactions: transactionsResult.data
          .filter((transaction) =>
            ["income", "adjustment", "transfer"].includes(transaction.type),
          )
          .map((transaction) => ({
            id: transaction.id,
            createdAt: Date.parse(transaction.created_at) || 0,
            updatedAt: Date.parse(transaction.updated_at) || 0,
            type: transaction.type,
            amount: transaction.amount,
            date: transaction.transaction_date,
            description: transaction.description,
            ...(transaction.account ? { account: transaction.account } : {}),
            ...(transaction.direction
              ? { direction: transaction.direction }
              : {}),
            ...(transaction.from_account
              ? { fromAccount: transaction.from_account }
              : {}),
            ...(transaction.to_account
              ? { toAccount: transaction.to_account }
              : {}),
            ...(transaction.balance_before != null
              ? { balanceBefore: Number(transaction.balance_before) }
              : {}),
            ...(transaction.balance_after != null
              ? { balanceAfter: Number(transaction.balance_after) }
              : {}),
            ...(transaction.from_balance_after != null
              ? { fromBalanceAfter: Number(transaction.from_balance_after) }
              : {}),
            ...(transaction.to_balance_after != null
              ? { toBalanceAfter: Number(transaction.to_balance_after) }
              : {}),
          })),
      }
    : legacyAccounts;

  return {
    ...snapshot,
    normalizedAccountSync: true,
    data: {
      ...snapshotData,
      accountData: mergeAccountDataWithRawSnapshot(
        normalizedAccounts,
        snapshotData,
      ),
    },
  };
}

export async function loadCloudData(userId) {
  const client = await getSupabase();
  if (!client) throw new Error("Cloud sync is not configured.");

  try {
    const rpcResult = await client.rpc("load_spend_user_snapshot");

    if (!rpcResult.error && rpcResult.data) {
      const rpcData = rpcResult.data;
      const effectiveRpcData = rpcData.data ?? null;
      const effectiveUpdatedAt = rpcData.updated_at ?? null;
      if (effectiveRpcData) {
        const normalizedDeleted = normalizeDeletedRecords(
          effectiveRpcData.deletedRecords,
        );
        return {
          ...rpcData,
          updated_at: effectiveUpdatedAt,
          data: {
            ...effectiveRpcData,
            deletedRecords: normalizedDeleted,
            accountData: loadAccountData(
              effectiveRpcData.accountData ?? emptyAccountData(),
              normalizedDeleted,
              effectiveRpcData.expenses,
            ),
          },
        };
      }
      return {
        ...rpcData,
        updated_at: effectiveUpdatedAt,
        data: null,
      };
    }
  } catch {
    // Fallback to legacy table queries if RPC is unavailable
  }

  return loadLegacyCloudData(client, userId);
}

/**
 * Sanitizes all top-level collections (expenses, budgets, recurringSchedules,
 * accountData.settings.cards, accountData.transactions, deletedRecords) before
 * persisting to Supabase or local backup checkpoints.
 */
export function sanitizeCloudPayload(data) {
  if (!data || typeof data !== "object") return data;

  const sanitizedExpenses = Array.isArray(data.expenses)
    ? data.expenses.flatMap((exp) => {
        if (!exp || typeof exp !== "object") return [];
        const id =
          typeof exp.id === "string" ? exp.id.trim().slice(0, 120) : "";
        const date =
          typeof exp.date === "string" && isValidDateString(exp.date)
            ? exp.date
            : "";
        const rawDesc =
          typeof exp.description === "string"
            ? exp.description.trim().slice(0, 160)
            : "";
        if (!id || !date || !rawDesc) return [];

        let cleanAmount = null;
        if (
          exp.amount !== null &&
          exp.amount !== undefined &&
          exp.amount !== ""
        ) {
          const num = Number(exp.amount);
          if (!Number.isFinite(num) || num <= 0) return [];
          cleanAmount = roundMoney(num);
        }

        const category = CATEGORIES.includes(exp.category)
          ? exp.category
          : "Other";
        const account =
          typeof exp.account === "string"
            ? exp.account.trim().slice(0, 120)
            : "";
        const recurringId =
          typeof exp.recurringId === "string" && exp.recurringId.trim()
            ? exp.recurringId.trim().slice(0, 120)
            : undefined;
        const createdAt = parseTimestampMs(exp.createdAt);
        const updatedAt = parseTimestampMs(exp.updatedAt) || createdAt;

        return [
          {
            ...exp,
            id,
            description: rawDesc,
            amount: cleanAmount,
            category,
            date,
            account,
            ...(recurringId ? { recurringId } : {}),
            ...(createdAt > 0 ? { createdAt } : {}),
            ...(updatedAt > 0 ? { updatedAt } : {}),
          },
        ];
      })
    : undefined;

  const sanitizedBudgets =
    data.budgets &&
    typeof data.budgets === "object" &&
    !Array.isArray(data.budgets)
      ? Object.fromEntries(
          Object.entries(data.budgets).flatMap(([month, amt]) => {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
            const num = Number(amt);
            if (!Number.isFinite(num) || num <= 0) return [];
            return [[month, roundMoney(num)]];
          }),
        )
      : undefined;

  const sanitizedRecurring = Array.isArray(data.recurringSchedules)
    ? data.recurringSchedules.flatMap((rec) => {
        if (!rec || typeof rec !== "object") return [];
        const id =
          typeof rec.id === "string" ? rec.id.trim().slice(0, 120) : "";
        const description =
          typeof rec.description === "string"
            ? rec.description.trim().slice(0, 160)
            : "";
        const numAmt = Number(rec.amount);
        const nextDate =
          typeof rec.nextDate === "string" && isValidDateString(rec.nextDate)
            ? rec.nextDate
            : "";
        if (
          !id ||
          !description ||
          !Number.isFinite(numAmt) ||
          numAmt <= 0 ||
          !nextDate
        ) {
          return [];
        }
        const category = CATEGORIES.includes(rec.category)
          ? rec.category
          : "Other";
        const interval = rec.interval === "weekly" ? "weekly" : "monthly";
        const dayOfMonth = clampDayOfMonth(
          rec.dayOfMonth || Number(nextDate.slice(-2)),
        );
        const account =
          typeof rec.account === "string"
            ? rec.account.trim().slice(0, 120)
            : "";
        const createdAt = parseTimestampMs(rec.createdAt);
        const updatedAt = parseTimestampMs(rec.updatedAt) || createdAt;
        return [
          {
            ...rec,
            id,
            description,
            amount: roundMoney(numAmt),
            category,
            interval,
            dayOfMonth,
            nextDate,
            account,
            active: Boolean(rec.active),
            ...(createdAt > 0 ? { createdAt } : {}),
            ...(updatedAt > 0 ? { updatedAt } : {}),
          },
        ];
      })
    : undefined;

  const sanitizedDeleted = data.deletedRecords
    ? normalizeDeletedRecords(data.deletedRecords)
    : undefined;

  if (!data.accountData || typeof data.accountData !== "object") {
    return {
      ...data,
      ...(sanitizedExpenses !== undefined
        ? { expenses: sanitizedExpenses }
        : {}),
      ...(sanitizedBudgets !== undefined ? { budgets: sanitizedBudgets } : {}),
      ...(sanitizedRecurring !== undefined
        ? { recurringSchedules: sanitizedRecurring }
        : {}),
      ...(sanitizedDeleted !== undefined
        ? { deletedRecords: sanitizedDeleted }
        : {}),
    };
  }

  const rawTx = Array.isArray(data.accountData.transactions)
    ? data.accountData.transactions
    : [];

  const sanitizedTx = [];
  for (const tx of rawTx) {
    if (!tx || typeof tx !== "object") continue;
    const id = typeof tx.id === "string" ? tx.id.trim().slice(0, 120) : "";
    const amount = roundMoney(Number(tx.amount));
    const date =
      typeof tx.date === "string" && isValidDateString(tx.date) ? tx.date : "";
    if (!id || !Number.isFinite(amount) || amount <= 0 || !date) continue;

    let type = tx.type;
    if (type === "adjust") type = "adjustment";
    if (!["income", "adjustment", "transfer"].includes(type)) continue;

    let direction = tx.direction || tx.dir;
    if (direction === "up" || direction === "increase") direction = "increase";
    else if (direction === "down" || direction === "decrease")
      direction = "decrease";

    const account =
      typeof tx.account === "string"
        ? tx.account.trim().slice(0, 120)
        : typeof tx.acct === "string"
          ? tx.acct.trim().slice(0, 120)
          : null;
    const fromAccount =
      typeof tx.fromAccount === "string"
        ? tx.fromAccount.trim().slice(0, 120)
        : typeof tx.acct === "string"
          ? tx.acct.trim().slice(0, 120)
          : null;
    const toAccount =
      typeof tx.toAccount === "string"
        ? tx.toAccount.trim().slice(0, 120)
        : typeof tx.to === "string"
          ? tx.to.trim().slice(0, 120)
          : null;

    if (type === "income" && !account) continue;
    if (
      type === "adjustment" &&
      (!account || !["increase", "decrease"].includes(direction))
    )
      continue;
    if (
      type === "transfer" &&
      (!fromAccount || !toAccount || fromAccount === toAccount)
    )
      continue;

    sanitizedTx.push({
      ...tx,
      id,
      type,
      amount,
      date,
      description:
        typeof tx.description === "string" ? tx.description.slice(0, 80) : "",
      ...(account ? { account } : {}),
      ...(type === "adjustment" && direction ? { direction } : {}),
      ...(fromAccount ? { fromAccount } : {}),
      ...(toAccount ? { toAccount } : {}),
    });
  }

  const rawSettings = data.accountData.settings;
  let sanitizedSettings = rawSettings;
  if (rawSettings && typeof rawSettings === "object") {
    const rawCards = Array.isArray(rawSettings.cards) ? rawSettings.cards : [];
    const sanitizedCards = rawCards.flatMap((c) => {
      if (
        !c ||
        typeof c !== "object" ||
        typeof c.id !== "string" ||
        !c.id.trim()
      ) {
        return [];
      }
      const {
        cvv: _cvv,
        cvc: _cvc,
        securityCode: _securityCode,
        security_code: _securityCodeSnake,
        pin: _pin,
        ...restCard
      } = c;
      const rawNumberStr = typeof c.number === "string" ? c.number.trim() : "";
      const rawDigits = rawNumberStr.replace(/\D/g, "");
      const rawLast4 = String(
        c.last4 || (rawDigits ? rawDigits.slice(-4) : ""),
      ).slice(0, 8);
      const isSavings = isSavingsCard(c);
      const isCash = isCashCard(c);
      const isMfs = isMfsCard(c);
      let safeNumber = rawNumberStr;
      if (rawDigits.length >= 13 || (!isSavings && !isCash && !isMfs && rawNumberStr)) {
        safeNumber = rawLast4 ? `•••• •••• •••• ${rawLast4}` : "";
      }
      const initBal = Number(c.initialBalance);
      const currBal = Number(c.currentBalance);
      return [
        {
          ...restCard,
          id: c.id.trim().slice(0, 120),
          name: String(c.name || c.id).slice(0, 80),
          ...(rawLast4 ? { last4: rawLast4 } : {}),
          ...(c.number !== undefined ? { number: safeNumber.slice(0, 32) } : {}),
          initialBalance:
            Number.isFinite(initBal) && initBal >= 0 ? roundMoney(initBal) : 0,
          ...(Number.isFinite(currBal)
            ? { currentBalance: roundMoney(currBal) }
            : {}),
        },
      ];
    });
    sanitizedSettings = {
      ...rawSettings,
      cards: sanitizedCards,
    };
  }

  return {
    ...data,
    ...(sanitizedExpenses !== undefined ? { expenses: sanitizedExpenses } : {}),
    ...(sanitizedBudgets !== undefined ? { budgets: sanitizedBudgets } : {}),
    ...(sanitizedRecurring !== undefined
      ? { recurringSchedules: sanitizedRecurring }
      : {}),
    ...(sanitizedDeleted !== undefined
      ? { deletedRecords: sanitizedDeleted }
      : {}),
    accountData: {
      ...data.accountData,
      ...(sanitizedSettings ? { settings: sanitizedSettings } : {}),
      transactions: sanitizedTx,
    },
  };
}

async function executeSaveQuery(client, userId, payload, expectedUpdatedAt) {
  if (expectedUpdatedAt) {
    const updateResult = await client
      .from("spend_user_data")
      .update({ data: payload })
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("updated_at")
      .maybeSingle();

    if (updateResult.error) return updateResult;
    if (updateResult.data) return updateResult;

    const { data: existing, error: checkError } = await client
      .from("spend_user_data")
      .select("updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (checkError) return { data: null, error: checkError };
    if (!existing) {
      // Use strict insert (not upsert) so a concurrent initial insert fails with 23505 rather than clobbering
      return await client
        .from("spend_user_data")
        .insert({ user_id: userId, data: payload })
        .select("updated_at")
        .single();
    }

    return { data: null, error: null };
  }

  return await client
    .from("spend_user_data")
    .upsert({ user_id: userId, data: payload }, { onConflict: "user_id" })
    .select("updated_at")
    .single();
}

export async function saveCloudData(
  userId,
  data,
  expectedUpdatedAt = null,
  { forceOverwrite = false } = {},
) {
  const client = await getSupabase();
  if (!client) throw new Error("Cloud sync is not configured.");

  const sanitized = sanitizeCloudPayload(data);

  let rpcRes = await client.rpc("save_spend_user_snapshot", {
    p_data: sanitized,
    p_expected_updated_at: expectedUpdatedAt || null,
    p_force_overwrite: Boolean(forceOverwrite),
  });

  if (
    rpcRes.error &&
    (rpcRes.error.code === "PGRST202" ||
      rpcRes.error.message?.includes("p_force_overwrite"))
  ) {
    rpcRes = await client.rpc("save_spend_user_snapshot", {
      p_data: sanitized,
      p_expected_updated_at: expectedUpdatedAt || null,
    });
  }

  if (!rpcRes.error) {
    if (rpcRes.data && typeof rpcRes.data === "object") {
      if (rpcRes.data.status === "conflict") {
        return null;
      }
      const updatedAt = rpcRes.data.updated_at ?? null;
      if (!updatedAt) return null;
      const mergedData = rpcRes.data.data
        ? {
            ...rpcRes.data.data,
            deletedRecords: normalizeDeletedRecords(
              rpcRes.data.data.deletedRecords,
            ),
            accountData: loadAccountData(
              rpcRes.data.data.accountData ?? emptyAccountData(),
              normalizeDeletedRecords(rpcRes.data.data.deletedRecords),
              rpcRes.data.data.expenses,
            ),
          }
        : null;
      return {
        updated_at: updatedAt,
        data: mergedData,
        reconciliation: rpcRes.data.reconciliation ?? null,
        toString() {
          return String(updatedAt);
        },
        valueOf() {
          return String(updatedAt);
        },
      };
    }
    return rpcRes.data ?? null;
  }

  const isRpcMissing =
    rpcRes.error.code === "42883" || rpcRes.error.code === "PGRST202";
  if (!isRpcMissing) {
    throw rpcRes.error;
  }

  const { data: saved, error } = await executeSaveQuery(
    client,
    userId,
    sanitized,
    expectedUpdatedAt,
  );
  if (!error) return saved?.updated_at ?? null;

  if (isLegacyAccountConstraintError(error) && sanitized?.accountData) {
    const allTransactions = Array.isArray(sanitized.accountData.transactions)
      ? sanitized.accountData.transactions
      : [];
    const legacyCompatible = allTransactions
      .filter(isLegacyDbCompatibleTransaction)
      .map((tx) => ({
        ...tx,
        type: tx.type === "adjust" ? "adjustment" : tx.type,
        direction:
          tx.direction === "up"
            ? "increase"
            : tx.direction === "down"
              ? "decrease"
              : tx.direction,
      }));
    const customOnly = allTransactions.filter(
      (tx) => !isLegacyDbCompatibleTransaction(tx),
    );
    const fallbackPayload = {
      ...sanitized,
      customAccountTransactions: customOnly,
      accountData: {
        ...sanitized.accountData,
        transactions: legacyCompatible,
      },
    };
    const { data: retrySaved, error: retryError } = await executeSaveQuery(
      client,
      userId,
      fallbackPayload,
      expectedUpdatedAt,
    );
    if (!retryError) return retrySaved?.updated_at ?? null;
    throw retryError;
  }

  throw error;
}

export function subscribeToCloudChanges(
  userId,
  onChange,
  onStatus,
  includeNormalizedAccounts = false,
) {
  if (!supabase || !isValidUuid(userId)) return () => {};
  const safeUserId = userId.trim();

  let channel = supabase.channel(`spend-live-${safeUserId}`).on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "spend_user_data",
      filter: `user_id=eq.${safeUserId}`,
    },
    (payload) => onChange?.(payload),
  );

  if (includeNormalizedAccounts) {
    channel = channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spend_account_settings",
          filter: `user_id=eq.${safeUserId}`,
        },
        (payload) => onChange?.(payload),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spend_account_transactions",
          filter: `user_id=eq.${safeUserId}`,
        },
        (payload) => onChange?.(payload),
      );
  }

  channel.subscribe(onStatus);

  return () => {
    void supabase.removeChannel(channel);
  };
}
