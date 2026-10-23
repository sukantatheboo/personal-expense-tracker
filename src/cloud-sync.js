import { supabase } from "./push.js";

export const CLOUD_SYNC_USER_KEY = "spend-cloud-sync-user-v1";

export async function loadCloudData(userId) {
  if (!supabase) throw new Error("Cloud sync is not configured.");

  const { data, error } = await supabase
    .from("spend_user_data")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
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
