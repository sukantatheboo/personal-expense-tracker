import { supabase } from "./push.js";
import { emptyAccountData, loadAccountData } from "./data.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";

const LEGACY_DB_ACCOUNTS = new Set(["bkash", "bank", "savings"]);

function isNormalizedAccountSchemaUnavailable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function isSnapshotRpcUnavailable(error) {
  return error?.code === "42883" || error?.code === "PGRST202";
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
  if (tx.type === "income" || tx.type === "adjustment") {
    return LEGACY_DB_ACCOUNTS.has(tx.account);
  }
  if (tx.type === "transfer") {
    return (
      LEGACY_DB_ACCOUNTS.has(tx.fromAccount) &&
      LEGACY_DB_ACCOUNTS.has(tx.toAccount) &&
      tx.fromAccount !== tx.toAccount
    );
  }
  return false;
}

function mergeAccountDataWithRawSnapshot(normalizedAccountData, rawSnapshotData) {
  const rawAccounts = rawSnapshotData?.accountData;
  const rawSettings = rawAccounts?.settings || {};
  const normSettings = normalizedAccountData?.settings || {};

  const mergedBalances = {
    ...(rawSettings.balances && typeof rawSettings.balances === "object"
      ? rawSettings.balances
      : {}),
    ...(normSettings.balances && typeof normSettings.balances === "object"
      ? normSettings.balances
      : {}),
  };

  const mergedCards = Array.isArray(rawSettings.cards)
    ? rawSettings.cards
    : Array.isArray(normSettings.cards)
      ? normSettings.cards
      : [];

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
    if (tx?.id) txMap.set(tx.id, tx);
  }
  for (const tx of extraTransactions) {
    if (tx?.id && !txMap.has(tx.id)) txMap.set(tx.id, tx);
  }
  for (const tx of rawTransactions) {
    if (tx?.id && !txMap.has(tx.id) && !isLegacyDbCompatibleTransaction(tx)) {
      txMap.set(tx.id, tx);
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

  return loadAccountData({
    settings: {
      ...rawSettings,
      ...normSettings,
      balances: mergedBalances,
      cards: mergedCards,
      cardsConfigured:
        rawSettings.cardsConfigured === true ||
        normSettings.cardsConfigured === true ||
        mergedCards.length > 0,
      updatedAt: Math.max(rawUpdatedAt, normUpdatedAt),
    },
    transactions: Array.from(txMap.values()),
  });
}

async function loadLegacyCloudData(userId) {
  let settingsQuery = supabase
    .from("spend_account_settings")
    .select(
      "start_date, bkash_balance, bank_balance, savings_balance, configured, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const [snapshotResult, initialSettingsResult, transactionsResult] =
    await Promise.all([
      supabase
        .from("spend_user_data")
        .select("data, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      settingsQuery,
      supabase
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
    settingsResult = await supabase
      .from("spend_account_settings")
      .select("start_date, bkash_balance, bank_balance, configured, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
  }

  if (snapshotResult.error) throw snapshotResult.error;

  const snapshot = snapshotResult.data;
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

  const legacyAccounts = snapshot.data?.accountData ?? emptyAccountData();
  if (normalizedSchemaUnavailable) {
    return {
      ...snapshot,
      normalizedAccountSync: false,
      data: {
        ...snapshot.data,
        accountData: mergeAccountDataWithRawSnapshot(
          legacyAccounts,
          snapshot.data,
        ),
      },
    };
  }
  if (settingsResult.error) throw settingsResult.error;
  if (transactionsResult.error) throw transactionsResult.error;

  const normalizedAccounts = settingsResult.data
    ? {
        settings: {
          startDate: settingsResult.data.start_date,
          balances: {
            ...(legacyAccounts?.settings?.balances || {}),
            bkash: settingsResult.data.bkash_balance,
            bank: settingsResult.data.bank_balance,
            savings:
              settingsResult.data.savings_balance ??
              legacyAccounts?.settings?.balances?.savings ??
              0,
          },
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
      ...snapshot.data,
      accountData: mergeAccountDataWithRawSnapshot(
        normalizedAccounts,
        snapshot.data,
      ),
    },
  };
}

export async function loadCloudData(userId) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const [rpcResult, rawSnapshotResult] = await Promise.all([
    supabase.rpc("load_spend_user_snapshot"),
    supabase
      .from("spend_user_data")
      .select("data, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!rpcResult.error) {
    const rpcData = rpcResult.data;
    const rawData = rawSnapshotResult.data?.data;
    if (rpcData?.data && rawData) {
      return {
        ...rpcData,
        data: {
          ...rawData,
          ...rpcData.data,
          accountData: mergeAccountDataWithRawSnapshot(
            rpcData.data.accountData,
            rawData,
          ),
        },
      };
    }
    return rpcData;
  }

  if (!isSnapshotRpcUnavailable(rpcResult.error)) throw rpcResult.error;
  return loadLegacyCloudData(userId);
}

async function executeSaveQuery(userId, payload, expectedUpdatedAt) {
  const query = supabase.from("spend_user_data");
  return expectedUpdatedAt
    ? await query
        .update({ data: payload })
        .eq("user_id", userId)
        .eq("updated_at", expectedUpdatedAt)
        .select("updated_at")
        .maybeSingle()
    : await query
        .insert({ user_id: userId, data: payload })
        .select("updated_at")
        .single();
}

export async function saveCloudData(userId, data, expectedUpdatedAt = null) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const { data: saved, error } = await executeSaveQuery(
    userId,
    data,
    expectedUpdatedAt,
  );
  if (!error) return saved?.updated_at ?? null;

  if (isLegacyAccountConstraintError(error) && data?.accountData) {
    const allTransactions = Array.isArray(data.accountData.transactions)
      ? data.accountData.transactions
      : [];
    const legacyCompatible = allTransactions.filter(
      isLegacyDbCompatibleTransaction,
    );
    const customOnly = allTransactions.filter(
      (tx) => !isLegacyDbCompatibleTransaction(tx),
    );
    const fallbackPayload = {
      ...data,
      customAccountTransactions: customOnly,
      accountData: {
        ...data.accountData,
        transactions: legacyCompatible,
      },
    };
    const { data: retrySaved, error: retryError } = await executeSaveQuery(
      userId,
      fallbackPayload,
      expectedUpdatedAt,
    );
    if (retryError) throw retryError;
    return retrySaved?.updated_at ?? null;
  }

  throw error;
}

export async function deleteCloudData(userId) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const { error } = await supabase
    .from("spend_user_data")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
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
