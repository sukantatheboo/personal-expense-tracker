import { getSupabase, supabase } from "./push.js";
import { emptyAccountData, loadAccountData } from "./data.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";

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

  const cardMap = new Map();
  if (Array.isArray(normSettings.cards)) {
    for (const c of normSettings.cards) {
      if (!c?.id) continue;
      const tombstone = deletedCardTombstones[c.id];
      const cTime =
        typeof c.updatedAt === "number"
          ? c.updatedAt
          : Date.parse(c.updatedAt) || 0;
      if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
      cardMap.set(c.id, c);
    }
  }
  if (Array.isArray(rawSettings.cards)) {
    for (const c of rawSettings.cards) {
      if (!c?.id) continue;
      const tombstone = deletedCardTombstones[c.id];
      const cTime =
        typeof c.updatedAt === "number"
          ? c.updatedAt
          : Date.parse(c.updatedAt) || 0;
      if (tombstone?.deleted && tombstone.updatedAt >= cTime) continue;
      const existing = cardMap.get(c.id);
      const exTime =
        typeof existing?.updatedAt === "number"
          ? existing.updatedAt
          : Date.parse(existing?.updatedAt) || 0;
      if (!existing || cTime >= exTime) {
        cardMap.set(c.id, c);
      }
    }
  }
  const rawUpdatedAt =
    typeof rawSettings.updatedAt === "number"
      ? rawSettings.updatedAt
      : Date.parse(rawSettings.updatedAt) || 0;
  const normUpdatedAt =
    typeof normSettings.updatedAt === "number"
      ? normSettings.updatedAt
      : Date.parse(normSettings.updatedAt) || 0;

  const preferRaw = rawUpdatedAt >= normUpdatedAt;
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
  const mergedCards = orderedCardIds.map((id) => cardMap.get(id));

  const mergedBalances = {
    ...(rawSettings.balances && typeof rawSettings.balances === "object"
      ? rawSettings.balances
      : {}),
    ...(normSettings.balances && typeof normSettings.balances === "object"
      ? normSettings.balances
      : {}),
  };

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
  for (const tx of normTransactions) {
    if (!tx?.id) continue;
    const tombstone = deletedTxTombstones[tx.id];
    const txTime =
      typeof tx.updatedAt === "number"
        ? tx.updatedAt
        : Date.parse(tx.updatedAt) || 0;
    if (tombstone?.deleted && tombstone.updatedAt >= txTime) continue;
    txMap.set(tx.id, tx);
  }
  for (const tx of extraTransactions) {
    if (!tx?.id || txMap.has(tx.id)) continue;
    const tombstone = deletedTxTombstones[tx.id];
    const txTime =
      typeof tx.updatedAt === "number"
        ? tx.updatedAt
        : Date.parse(tx.updatedAt) || 0;
    if (tombstone?.deleted && tombstone.updatedAt >= txTime) continue;
    txMap.set(tx.id, tx);
  }
  if (normTransactions.length === 0 && !normalizedAccountData) {
    for (const tx of rawTransactions) {
      if (!tx?.id) continue;
      const tombstone = deletedTxTombstones[tx.id];
      const txTime =
        typeof tx.updatedAt === "number"
          ? tx.updatedAt
          : Date.parse(tx.updatedAt) || 0;
      if (tombstone?.deleted && tombstone.updatedAt >= txTime) continue;
      const existing = txMap.get(tx.id);
      const exTime =
        typeof existing?.updatedAt === "number"
          ? existing.updatedAt
          : Date.parse(existing?.updatedAt) || 0;
      if (!existing || txTime > exTime) {
        txMap.set(tx.id, tx);
      }
    }
  }

  return loadAccountData(
    {
      settings: {
        ...rawSettings,
        ...normSettings,
        balances: mergedBalances,
        cards: mergedCards,
        cardsConfigured:
          rawSettings.cardsConfigured === true ||
          normSettings.cardsConfigured === true ||
          mergedCards.length > 0,
        configured:
          rawSettings.configured === true || normSettings.configured === true,
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

  const hasCards =
    Array.isArray(legacyAccounts?.settings?.cards) &&
    legacyAccounts.settings.cards.length > 0;
  const legacyBalances = legacyAccounts?.settings?.balances || {};
  const baseBalances = { ...legacyBalances };
  if (!hasCards && !legacyAccounts?.settings?.cardsConfigured && settingsResult.data) {
    if (Number(settingsResult.data.bkash_balance) > 0)
      baseBalances.bkash = settingsResult.data.bkash_balance;
    if (Number(settingsResult.data.bank_balance) > 0)
      baseBalances.bank = settingsResult.data.bank_balance;
    if (Number(settingsResult.data.savings_balance) > 0)
      baseBalances.savings = settingsResult.data.savings_balance;
  }

  const normalizedAccounts = settingsResult.data
    ? {
        settings: {
          startDate: settingsResult.data.start_date,
          balances: baseBalances,
          cards: Array.isArray(legacyAccounts?.settings?.cards)
            ? legacyAccounts.settings.cards
            : [],
          cardsConfigured:
            legacyAccounts?.settings?.cardsConfigured === true ||
            (Array.isArray(legacyAccounts?.settings?.cards) &&
              legacyAccounts.settings.cards.length > 0),
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
      if (effectiveRpcData) {
        return {
          ...rpcData,
          updated_at: rpcData.updated_at ?? null,
          data: {
            ...effectiveRpcData,
            accountData: mergeAccountDataWithRawSnapshot(
              effectiveRpcData.accountData,
              effectiveRpcData,
            ),
          },
        };
      }
      return {
        ...rpcData,
        updated_at: rpcData.updated_at ?? null,
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

export async function saveCloudData(userId, data, expectedUpdatedAt = null) {
  const client = await getSupabase();
  if (!client) throw new Error("Cloud sync is not configured.");

  const sanitized = sanitizeCloudPayload(data);
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
  includeNormalizedAccounts = true,
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
    onChange,
  );

  if (includeNormalizedAccounts) {
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spend_account_settings",
          filter: `user_id=eq.${userId}`,
        },
        onChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spend_account_transactions",
          filter: `user_id=eq.${userId}`,
        },
        onChange,
      );
  }

  channel.subscribe(onStatus);

  return () => {
    void supabase.removeChannel(channel);
  };
}
