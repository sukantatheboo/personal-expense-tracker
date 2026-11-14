import { getSupabase, supabase } from "./push.js";
import {
  computeAccountBalances,
  emptyAccountData,
  isPhantomAutoReconstructedCard,
  isSavingsCard,
  loadAccountData,
  localDate,
  makeId,
} from "./data.js";
import { hasAppPin, isSessionUnlocked } from "./security.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";
export const CLOUD_SYNC_OUTBOX_KEY = "spend-cloud-sync-outbox-v1";
export const LOCAL_CHECKPOINTS_KEY = "spend-backup-checkpoints-v1";

const MAX_LOCAL_DAILY_CHECKPOINTS = 14;
const MAX_LOCAL_EVENT_CHECKPOINTS = 10;
const KEEPALIVE_MAX_BYTES = 58_000;

function cleanEnvValue(value) {
  return typeof value === "string"
    ? value.trim().replace(/^['"]|['"]$/g, "")
    : "";
}

function getSupabaseRestConfig() {
  const url = cleanEnvValue(import.meta.env.VITE_SUPABASE_URL).replace(
    /\/+$/,
    "",
  );
  const anonKey = cleanEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);
  return { url, anonKey };
}

function readSupabaseAccessTokenFromStorage() {
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
      const token =
        parsed?.access_token ||
        parsed?.currentSession?.access_token ||
        parsed?.session?.access_token ||
        "";
      if (typeof token === "string" && token.trim()) {
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
      // Store full snapshot in outbox only when PIN encryption is not active
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
 * #3 — Flushes pending cloud snapshot using fetch(..., { keepalive: true })
 * so mobile OS / browser swipe-close or pagehide does not abort in-flight syncs.
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

  // Ensure outbox is marked dirty before firing keepalive request
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

  // Browser keepalive requests have a 64 KiB body limit.
  // Use sentinel token __KEEP_EXISTING_AVATAR__ so the server preserves the existing cloud avatar
  // instead of wiping it if an inline base64 photo pushes the payload over 58 KB.
  if (
    body.length > KEEPALIVE_MAX_BYTES &&
    sanitized?.profileAvatar &&
    String(sanitized.profileAvatar).length > 4096
  ) {
    const compactData = {
      ...sanitized,
      profileAvatar: "__KEEP_EXISTING_AVATAR__",
    };
    rpcPayload = {
      p_data: compactData,
      p_expected_updated_at: expectedUpdatedAt || null,
      p_force_overwrite: Boolean(forceOverwrite),
    };
    body = JSON.stringify(rpcPayload);
  }

  if (body.length > KEEPALIVE_MAX_BYTES) {
    // Payload exceeds browser keepalive limit; outbox remains dirty in localStorage
    // and will be drained automatically by standard fetch or on next app open.
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
        // Keep outbox dirty so next launch retries cleanly
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
  const normalizedType = ["daily", "pre_restore", "pre_overwrite", "manual"].includes(
    type,
  )
    ? type
    : "daily";
  if (hasAppPin() && !isSessionUnlocked() && normalizedType !== "manual") {
    // Do not write automatic local snapshots while the PIN session is locked
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
        ((item.userId || "local") === effectiveUser ||
          item.userId === "local"),
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

  // Always preserve a pre_restore checkpoint of the current state before rolling back
  if (currentData && snapshotHasMeaningfulRecords(currentData)) {
    captureLocalBackupCheckpoint(userId, currentData, {
      type: "pre_restore",
      label: "Safety snapshot before checkpoint rollback",
    });
  }

  // Build rollback tombstones for any records present in currentData but absent in target checkpoint
  // so other connected devices immediately drop rolled-back transactions/expenses instead of resurrecting them.
  const buildRollbackDeletedRecords = (baseDeleted, targetData, beforeData) => {
    const nowMs = Date.now();
    const mergedDel = {
      expenses: { ...(baseDeleted?.expenses || {}) },
      budgets: { ...(baseDeleted?.budgets || {}) },
      recurringSchedules: { ...(baseDeleted?.recurringSchedules || {}) },
      accountTransactions: { ...(baseDeleted?.accountTransactions || {}) },
      cards: { ...(baseDeleted?.cards || {}) },
    };
    if (!beforeData || typeof beforeData !== "object") return mergedDel;

    const targetTxIds = new Set(
      (targetData?.accountData?.transactions || [])
        .map((t) => t?.id)
        .filter(Boolean),
    );
    for (const tx of beforeData?.accountData?.transactions || []) {
      if (tx?.id && !targetTxIds.has(tx.id)) {
        const txTime =
          parseRecordTime(tx.updatedAt) || parseRecordTime(tx.createdAt) || 0;
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
          parseRecordTime(exp.updatedAt) || parseRecordTime(exp.createdAt) || 0;
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
          parseRecordTime(rec.updatedAt) || parseRecordTime(rec.createdAt) || 0;
        mergedDel.recurringSchedules[rec.id] = {
          deleted: true,
          updatedAt: Math.max(nowMs, recTime + 1),
        };
      }
    }
    return mergedDel;
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
      if (rpcRes.error && rpcRes.error.code !== "42883" && rpcRes.error.code !== "PGRST202") {
        throw rpcRes.error;
      }
    }
  }

  // Fallback to local checkpoint store
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

export async function verifyCloudLedgerReconciliation() {
  const client = await getSupabase();
  if (!client) return null;
  try {
    const rpcRes = await client.rpc("verify_spend_ledger_reconciliation");
    if (!rpcRes.error && rpcRes.data) {
      return rpcRes.data;
    }
  } catch {
    return null;
  }
  return null;
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
        schemaVersion: cloudReconciliation?.schemaVersion || "2026.11.17",
        checks,
        cloudReconciliation,
      };
    }
    if (cloudReconciliation) {
      return {
        installed: true,
        allPassed: Boolean(cloudReconciliation.schemaVersion === "2026.11.17"),
        schemaVersion: cloudReconciliation.schemaVersion || "2026.11.16",
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

function parseRecordTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function mergeAccountDataWithRawSnapshot(
  normalizedAccountData,
  rawSnapshotData,
) {
  const rawAccounts = rawSnapshotData?.accountData;
  const rawSettings = rawAccounts?.settings || {};
  const normSettings = normalizedAccountData?.settings || {};
  const deletedRecords = rawSnapshotData?.deletedRecords || {};
  const deletedCardTombstones = deletedRecords.cards || {};
  const deletedTxTombstones = deletedRecords.accountTransactions || {};

  const rawUpdatedAt = parseRecordTime(rawSettings.updatedAt);
  const normUpdatedAt = parseRecordTime(normSettings.updatedAt);
  const preferRaw = rawUpdatedAt >= normUpdatedAt;

  const cardMap = new Map();
  if (Array.isArray(normSettings.cards)) {
    for (const c of normSettings.cards) {
      if (!c?.id || isPhantomAutoReconstructedCard(c)) continue;
      const tombstone = deletedCardTombstones[c.id];
      const cTime = parseRecordTime(c.updatedAt) || parseRecordTime(c.createdAt);
      if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
      cardMap.set(c.id, c);
    }
  }
  if (Array.isArray(rawSettings.cards)) {
    for (const c of rawSettings.cards) {
      if (!c?.id || isPhantomAutoReconstructedCard(c)) continue;
      const tombstone = deletedCardTombstones[c.id];
      const cTime = parseRecordTime(c.updatedAt) || parseRecordTime(c.createdAt);
      if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
      const existing = cardMap.get(c.id);
      const exTime =
        parseRecordTime(existing?.updatedAt) ||
        parseRecordTime(existing?.createdAt);
      if (!existing || cTime >= exTime) {
        cardMap.set(c.id, c);
      }
    }
  }

  const rawCards = Array.isArray(rawSettings.cards) ? rawSettings.cards : [];
  const normCards = Array.isArray(normSettings.cards) ? normSettings.cards : [];
  const primaryCards = preferRaw ? rawCards : normCards;
  const secondaryCards = preferRaw ? normCards : rawCards;

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
    rawSettings.currentBalances && typeof rawSettings.currentBalances === "object"
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
      parseRecordTime(rawCard?.updatedAt) ||
      parseRecordTime(rawCard?.createdAt) ||
      rawUpdatedAt;
    const normCardTime =
      parseRecordTime(normCard?.updatedAt) ||
      parseRecordTime(normCard?.createdAt) ||
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
        ? Math.round(resolvedBal * 100) / 100
        : 0;
    mergedBalances[id] = cleanBal;

    const currentBalCandidate = useRawForCard
      ? rawCurrentBalances[id] ?? card?.currentBalance ?? normCurrentBalances[id]
      : normCurrentBalances[id] ?? card?.currentBalance ?? rawCurrentBalances[id];
    if (
      currentBalCandidate !== undefined &&
      currentBalCandidate !== null &&
      Number.isFinite(Number(currentBalCandidate))
    ) {
      mergedCurrentBalances[id] =
        Math.round(Number(currentBalCandidate) * 100) / 100;
    }

    return {
      ...card,
      initialBalance: cleanBal,
      ...(mergedCurrentBalances[id] !== undefined
        ? { currentBalance: mergedCurrentBalances[id] }
        : {}),
    };
  });

  // Deduplicate singleton Savings Vault across normalized and raw snapshots
  const remappedSavingsIds = {};
  const savingsInMerged = mergedCards.filter(isSavingsCard);
  if (savingsInMerged.length > 1) {
    savingsInMerged.sort((a, b) => {
      const tDiff =
        (parseRecordTime(b.updatedAt) || 0) -
        (parseRecordTime(a.updatedAt) || 0);
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
      parseRecordTime(tx.updatedAt) || parseRecordTime(tx.createdAt);
    const existing = txMap.get(tx.id);
    const exTime =
      parseRecordTime(existing?.updatedAt) ||
      parseRecordTime(existing?.createdAt);
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
    ? settingsResult.data.cards.filter((c) => !isPhantomAutoReconstructedCard(c))
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

  // Only map legacy table columns onto cards that explicitly use those legacy IDs
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
        return {
          ...rpcData,
          updated_at: effectiveUpdatedAt,
          data: {
            ...effectiveRpcData,
            accountData: loadAccountData(
              effectiveRpcData.accountData ?? emptyAccountData(),
              effectiveRpcData.deletedRecords,
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

function sanitizeCloudPayload(data) {
  if (!data || typeof data !== "object") return data;
  if (!data.accountData || typeof data.accountData !== "object") return data;

  const rawTx = Array.isArray(data.accountData.transactions)
    ? data.accountData.transactions
    : [];

  const sanitizedTx = [];
  for (const tx of rawTx) {
    if (!tx || typeof tx !== "object") continue;
    const id = typeof tx.id === "string" ? tx.id.trim().slice(0, 120) : "";
    const amount = Math.round(Number(tx.amount) * 100) / 100;
    const date =
      typeof tx.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)
        ? tx.date
        : "";
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

  return {
    ...data,
    accountData: {
      ...data.accountData,
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
      return await client
        .from("spend_user_data")
        .upsert({ user_id: userId, data: payload }, { onConflict: "user_id" })
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
      return rpcRes.data.updated_at ?? null;
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
  if (!supabase) return () => {};

  let channel = supabase.channel(`spend-live-${userId}`).on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "spend_user_data",
      filter: `user_id=eq.${userId}`,
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
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onChange?.(payload),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spend_account_transactions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onChange?.(payload),
      );
  }

  channel.subscribe(onStatus);

  return () => {
    void supabase.removeChannel(channel);
  };
}
