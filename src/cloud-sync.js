import { getSupabase, supabase } from "./push.js";
import {
  emptyAccountData,
  isPhantomAutoReconstructedCard,
  isSavingsCard,
  loadAccountData,
} from "./data.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";

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
    rawSettings.balances && typeof rawSettings.balances === "object"
      ? rawSettings.balances
      : {};
  const normBalances =
    normSettings.balances && typeof normSettings.balances === "object"
      ? normSettings.balances
      : {};

  const mergedBalances = {};
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
    return {
      ...card,
      initialBalance: cleanBal,
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
    }
  }
  const deduplicatedCards = mergedCards.filter(
    (c) => !Object.hasOwn(remappedSavingsIds, c.id),
  );

  for (const [id, tombstone] of Object.entries(deletedCardTombstones)) {
    if (tombstone?.deleted && !cardMap.has(id)) {
      delete mergedBalances[id];
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
    const tombstone = deletedTxTombstones[tx.id];
    const txTime =
      parseRecordTime(tx.updatedAt) || parseRecordTime(tx.createdAt);
    if (tombstone?.deleted && tombstone.updatedAt >= txTime) return;
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
  );
}

async function loadLegacyCloudData(client, userId) {
  let settingsQuery = client
    .from("spend_account_settings")
    .select(
      "start_date, bkash_balance, bank_balance, savings_balance, configured, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const [snapshotResult, initialSettingsResult, transactionsResult] =
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
          "id, type, amount, transaction_date, description, account, direction, from_account, to_account, created_at, updated_at",
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
      settingsResult.error.message?.includes("savings_balance"))
  ) {
    settingsResult = await client
      .from("spend_account_settings")
      .select("start_date, bkash_balance, bank_balance, configured, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
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

  const rawCards = Array.isArray(legacyAccounts?.settings?.cards)
    ? legacyAccounts.settings.cards.filter(
        (c) => !isPhantomAutoReconstructedCard(c),
      )
    : [];
  const legacyBalances = legacyAccounts?.settings?.balances || {};
  const baseBalances = { ...legacyBalances };

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
        transactions: transactionsResult.data.map((transaction) => ({
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
  _includeNormalizedAccounts = false,
) {
  if (!supabase) return () => {};

  const channel = supabase.channel(`spend-live-${userId}`).on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "spend_user_data",
      filter: `user_id=eq.${userId}`,
    },
    (payload) => onChange?.(payload),
  );

  channel.subscribe(onStatus);

  return () => {
    void supabase.removeChannel(channel);
  };
}
