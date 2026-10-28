import { supabase } from "./push.js";
import { emptyAccountData, loadAccountData } from "./data.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";

function isNormalizedAccountSchemaUnavailable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function isSnapshotRpcUnavailable(error) {
  return error?.code === "42883" || error?.code === "PGRST202";
}

async function loadLegacyCloudData(userId) {
  const [snapshotResult, settingsResult, transactionsResult] =
    await Promise.all([
      supabase
        .from("spend_user_data")
        .select("data, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("spend_account_settings")
        .select("start_date, bkash_balance, bank_balance, configured, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("spend_account_transactions")
        .select(
          "id, type, amount, transaction_date, description, account, direction, from_account, to_account, created_at, updated_at",
        )
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
    ]);

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
        accountData: loadAccountData(legacyAccounts),
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
            bkash: settingsResult.data.bkash_balance,
            bank: settingsResult.data.bank_balance,
          },
          configured: settingsResult.data.configured,
          updatedAt: Date.parse(settingsResult.data.updated_at) || 0,
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
      accountData: loadAccountData(normalizedAccounts),
    },
  };
}

export async function loadCloudData(userId) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const { data, error } = await supabase.rpc("load_spend_user_snapshot");
  if (!error) return data;
  if (!isSnapshotRpcUnavailable(error)) throw error;
  return loadLegacyCloudData(userId);
}

export async function saveCloudData(userId, data, expectedUpdatedAt = null) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const query = supabase.from("spend_user_data");
  const { data: saved, error } = expectedUpdatedAt
    ? await query
        .update({ data })
        .eq("user_id", userId)
        .eq("updated_at", expectedUpdatedAt)
        .select("updated_at")
        .maybeSingle()
    : await query
        .insert({ user_id: userId, data })
        .select("updated_at")
        .single();
  if (error) throw error;
  return saved?.updated_at ?? null;
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
