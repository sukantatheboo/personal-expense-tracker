import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(index) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(String(k), String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.dispatchEvent ??= () => true;
globalThis.window = globalThis;

const ROOT = process.cwd();
const dataMod = await import("../src/data.js");
const cloudSyncMod = await import("../src/cloud-sync.js");

const {
  emptyAccountData,
  isCashCard,
  loadAccountData,
} = dataMod;

const {
  mergeAccountDataWithRawSnapshot,
  sanitizeCloudPayload,
  loadCloudData,
  saveCloudData,
} = cloudSyncMod;

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("Cash wallets preserve non-BDT currencies across loadAccountData & mergeAccountDataWithRawSnapshot while bank accounts stay BDT", () => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  const rawAccountData = {
    settings: {
      cards: [
        {
          id: "cash_usd",
          name: "USD Cash Wallet",
          category: "cash",
          cardType: "Cash",
          currency: "USD",
          subtitle: "Travel reserve",
          updatedAt: 1_760_000_000_000,
        },
        {
          id: "cash_eur",
          name: "Euro Wallet",
          category: "cash",
          cardType: "Cash",
          currency: "EUR",
          subtitle: "Trip EUR",
          updatedAt: 1_760_000_000_000,
        },
        {
          id: "card_city_1",
          name: "City Debit",
          category: "debit",
          cardType: "Bank",
          bankId: "city",
          currency: "USD",
          last4: "4321",
          updatedAt: 1_760_000_000_000,
        },
      ],
      balances: {
        cash_usd: 250,
        cash_eur: 120,
        card_city_1: 5000,
      },
    },
    openingBalances: {
      cash_usd: 250,
      cash_eur: 120,
      card_city_1: 5000,
    },
    transactions: [],
  };

  const normalized = loadAccountData(rawAccountData);
  const merged = mergeAccountDataWithRawSnapshot(normalized, rawAccountData);
  const cards = merged?.settings?.cards || [];

  const usdCash = cards.find((c) => c.id === "cash_usd");
  const eurCash = cards.find((c) => c.id === "cash_eur");
  const bankCard = cards.find((c) => c.id === "card_city_1");

  assert.ok(usdCash, "USD cash card should survive normalization and raw snapshot merge");
  assert.ok(eurCash, "EUR cash card should survive normalization and raw snapshot merge");
  assert.ok(bankCard, "Bank card should survive normalization and raw snapshot merge");

  assert.equal(isCashCard(usdCash), true);
  assert.equal(isCashCard(eurCash), true);
  assert.equal(usdCash.currency, "USD");
  assert.equal(usdCash.subtitle, "Travel reserve");
  assert.equal(eurCash.currency, "EUR");
  assert.equal(bankCard.currency, "BDT");
});

test("sanitizeCloudPayload strips CVV/CVC/PIN/securityCode and masks 16-digit PANs while preserving MFS phones, CASH IDs, and encrypted envelopes", () => {
  const payload = {
    expenses: [
      { id: "exp_1", amount: 500, category: "Food", date: "2026-11-24", account: "bkash", desc: "Dinner" },
    ],
    budgets: { Food: 5000 },
    recurringSchedules: [],
    accountData: {
      ...emptyAccountData(),
      settings: {
        cards: [
          {
            id: "card_1",
            name: "BRAC Visa",
            category: "credit",
            cardType: "Credit Card",
            bankId: "brac",
            number: "4532123456789012",
            last4: "9012",
            cvv: "987",
            cvc: "654",
            pin: "4321",
            securityCode: "111",
          },
          {
            id: "bkash",
            name: "bKash Personal",
            category: "mfs",
            cardType: "MFS",
            mfsId: "bkash",
            number: "01712345678",
          },
          {
            id: "cash_usd",
            name: "USD Wallet",
            category: "cash",
            cardType: "Cash",
            currency: "USD",
            number: "CASH-USD-01",
          },
        ],
      },
    },
  };

  const clean = sanitizeCloudPayload(payload);
  const cleanCards = clean.accountData.settings.cards;
  const credit = cleanCards.find((c) => c.id === "card_1");
  const mfs = cleanCards.find((c) => c.id === "bkash");
  const cash = cleanCards.find((c) => c.id === "cash_usd");

  assert.equal("cvv" in credit, false);
  assert.equal("cvc" in credit, false);
  assert.equal("pin" in credit, false);
  assert.equal("securityCode" in credit, false);
  assert.equal(credit.number, "•••• •••• •••• 9012");
  assert.equal(credit.last4, "9012");
  assert.equal(mfs.number, "01712345678");
  assert.equal(cash.number, "CASH-USD-01");
  assert.equal(cash.currency, "USD");

  const encryptedEnvelope = {
    format: "spend-encrypted-v1",
    version: 1,
    _encrypted: true,
    salt: "abc",
    iv: "def",
    ciphertext: "ghi",
  };
  const cleanEncrypted = sanitizeCloudPayload(encryptedEnvelope);
  assert.equal(cleanEncrypted._encrypted, true);
  assert.equal(cleanEncrypted.format, "spend-encrypted-v1");
  assert.equal(cleanEncrypted.ciphertext, "ghi");
});

test("cloud sync client helpers fail safely when Supabase is unconfigured and guard legacy encrypted blobs", async () => {
  await assert.rejects(
    loadCloudData("00000000-0000-4000-8000-000000000001"),
    /Cloud sync is not configured/i
  );

  await assert.rejects(
    saveCloudData("00000000-0000-4000-8000-000000000001", { expenses: [] }, null),
    /Cloud sync is not configured/i
  );

  const cloudSyncSource = readRepoFile("src/cloud-sync.js");
  assert.match(cloudSyncSource, /loadLegacyCloudData/);
  assert.match(cloudSyncSource, /spend-encrypted-v1/);
  assert.match(cloudSyncSource, /512 KB/);
});

test("SQL migration 20261125000000 enforces P0 security, least-privilege grants, strict OCC, and MFS/currency invariants", () => {
  const sql = readRepoFile(
    "supabase/migrations/20261125000000_p0_p1_security_occ_and_ledger_hardening.sql"
  );

  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /notify pgrst, 'reload schema';/);

  // P0-1 & P0-2: RLS SELECT-only + write revokes on spend_user_data & spend_backup_checkpoints
  assert.match(sql, /revoke insert, update, delete on public\.spend_user_data from anon, authenticated;/);
  assert.match(sql, /revoke insert, update, delete on public\.spend_backup_checkpoints from anon, authenticated;/);

  // P0-1: Strict SECURITY DEFINER caller guards and explicit REVOKE from PUBLIC, anon, authenticated
  assert.match(sql, /revoke all on function public\.verify_spend_ledger_reconciliation\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.verify_spend_ledger_reconciliation\(uuid\) to authenticated, service_role;/);
  assert.match(sql, /revoke all on function public\.capture_spend_backup_checkpoint_internal\(uuid, jsonb, text, text, timestamptz\) from public, anon, authenticated;/);
  assert.match(sql, /request\.jwt\.claim\.role/);
  assert.match(sql, /session_user in \('postgres', 'supabase_admin'\)/);

  // P0-3: Legacy checkpoint & audit history PAN/CVV scrub
  assert.match(sql, /update public\.spend_backup_checkpoints cp/);
  assert.match(sql, /update public\.spend_account_change_history h/);

  // P0-4: Numeric guards, trigger recursion/partial guards, duplicate reminder trigger removal
  assert.match(sql, /if v_amount::text in \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(sql, /if abs\(v_amount\) >= 100000000000000/);
  assert.match(sql, /drop trigger if exists preserve_push_reminder_progress on public\.push_reminders;/);

  // P1-1: Drop old timestamptz signature before recreating jsonb RPC (avoid 42P13), enforce 2ms OCC + encrypted payload awareness
  assert.match(
    sql,
    /drop function if exists public\.save_spend_user_snapshot\(jsonb, text\);\s*drop function if exists public\.save_spend_user_snapshot\(jsonb, text, boolean\);\s*create or replace function public\.save_spend_user_snapshot\(/
  );
  assert.match(
    sql,
    /drop function if exists public\.verify_spend_sql_installation\(\);\s*create or replace function public\.verify_spend_sql_installation\(\)/
  );
  assert.match(sql, /abs\(extract\(epoch from \(v_existing_updated_at - v_expected_parsed\)\)\) >= 0\.002/);
  assert.match(sql, /v_incoming_is_encrypted/);

  // P1-2: Multi-currency ledger column & NOT VALID integrity constraints
  assert.match(sql, /add column if not exists currency text not null default 'BDT';/);
  assert.match(sql, /spend_account_transactions_mfs_amount_check[\s\S]*check \(amount > 0\) not valid/);
  assert.match(sql, /spend_account_transactions_mfs_shape_check/);
  assert.match(sql, /spend_backup_checkpoints_max_size[\s\S]*pg_column_size\(data\) <= 524288\) not valid/);

  // P1-3: Joined push claim RPC + 90-day audit retention cron
  assert.match(sql, /create or replace function public\.claim_due_push_reminders_with_devices\(/);
  assert.match(sql, /for update of r skip locked/);
  assert.match(sql, /grant execute on function public\.claim_due_push_reminders_with_devices\(integer, integer\) to service_role;/);
  assert.match(sql, /prune_spend_account_change_history/);
  assert.match(sql, /spend-prune-audit-history/);
});

test("Edge Functions, cron schedule SQL, and CI workflow include P0/P1 reliability & security hardening", () => {
  const dueWorker = readRepoFile("supabase/functions/send-due-reminders/index.ts");
  assert.match(dueWorker, /claim_due_push_reminders_with_devices/);
  assert.match(dueWorker, /claim_due_push_reminders/);
  assert.match(dueWorker, /\.eq\("claim_until", r\.claim_until\)/);
  assert.match(dueWorker, /MAX_DRAIN_BATCHES\s*=\s*5/);
  assert.match(dueWorker, /CRON_SECRET/);
  assert.match(dueWorker, /VAPID_SUBJECT/);

  const activityWorker = readRepoFile("supabase/functions/send-activity-push/index.ts");
  assert.match(activityWorker, /ALLOWED_ORIGIN/);
  assert.match(activityWorker, /excludeDeviceId/);
  assert.match(activityWorker, /isValidSubscription/);
  assert.match(activityWorker, /VAPID_SUBJECT/);

  const cronSql = readRepoFile("supabase/schedule-cron.sql");
  assert.match(cronSql, /drop trigger if exists preserve_push_reminder_progress on public\.push_reminders;/);
  assert.match(cronSql, /drop trigger if exists preserve_push_reminder_progress_trigger on public\.push_reminders;/);

  const deployYml = readRepoFile(".github/workflows/deploy.yml");
  const testIdx = deployYml.indexOf("npm test");
  const buildIdx = deployYml.indexOf("npm run build");
  assert.ok(testIdx !== -1, "CI workflow must execute npm test");
  assert.ok(buildIdx !== -1, "CI workflow must execute npm run build");
  assert.ok(testIdx < buildIdx, "CI workflow must run npm test before npm run build");
});
