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
  computeAccountBalances,
  emptyAccountData,
  isCashCard,
  loadAccountData,
} = dataMod;

const {
  clearCloudSyncOutbox,
  hasPendingCloudOutbox,
  mergeAccountDataWithRawSnapshot,
  persistCloudSyncOutbox,
  readCachedSupabaseUserFromStorage,
  readCloudSyncOutbox,
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
  assert.doesNotMatch(
    sql,
    /not\s*\(\s*jsonb_typeof\(v_deleted_(?:cards|tx|exp)\s*->/,
    "NOT (jsonb_typeof(v_deleted_... -> key) ...) evaluates to NULL under SQL 3-valued logic when missing and drops active records"
  );
  assert.match(sql, /coalesce\(v_deleted_tx #>> array\[id, 'deleted'\], ''\) = 'true'/);
  assert.match(sql, /coalesce\(v_deleted_exp #>> array\[id, 'deleted'\], ''\) = 'true'/);

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
  assert.match(dueWorker, /isValidSubscription/);
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
  assert.match(deployYml, /deno check supabase\/functions\/send-due-reminders\/index\.ts supabase\/functions\/send-activity-push\/index\.ts/);
  const testIdx = deployYml.indexOf("npm test");
  const buildIdx = deployYml.indexOf("npm run build");
  assert.ok(testIdx !== -1, "CI workflow must execute npm test");
  assert.ok(buildIdx !== -1, "CI workflow must execute npm run build");
  assert.ok(testIdx < buildIdx, "CI workflow must run npm test before npm run build");

  const loaderSql = readRepoFile(
    "supabase/migrations/20261125010000_p2_loader_currency_and_constraint_validation.sql"
  );
  assert.match(loaderSql, /'currency',\s*coalesce\(nullif\(upper\(btrim\(t\.currency\)\), ''\), 'BDT'\)/);
  assert.match(loaderSql, /'schemaVersion',\s*'2026\.11\.25'/);
  assert.match(loaderSql, /validate constraint %I/);
  assert.match(loaderSql, /revoke all on function public\.load_spend_user_snapshot\(\) from public, anon, authenticated;/);

  const verifySql = readRepoFile("supabase/verify-backend.sql");
  assert.match(verifySql, /^begin;/m);
  assert.match(verifySql, /^rollback;/m);
  assert.match(verifySql, /set local role authenticated/);
  assert.match(verifySql, /verify_spend_ledger_reconciliation/);
});

test("mergeAccountDataWithRawSnapshot preserves undone transaction when tx updatedAt exceeds tombstone updatedAt", () => {
  const baseNow = Date.now();
  const localNorm = {
    settings: { cards: [], balances: {}, openingBalances: {} },
    transactions: [
      {
        id: "tx_undone",
        type: "income",
        amount: 400,
        currency: "USD",
        date: "2026-11-25",
        account: "cash",
        description: "Undone income",
        createdAt: baseNow - 4000,
        updatedAt: baseNow,
      },
      {
        id: "tx_removed",
        type: "income",
        amount: 200,
        date: "2026-11-25",
        account: "cash",
        description: "Actually deleted",
        createdAt: baseNow - 4000,
        updatedAt: baseNow - 3000,
      },
    ],
  };
  const rawSnap = {
    deletedRecords: {
      accountTransactions: {
        tx_undone: { deleted: true, updatedAt: baseNow - 2000 },
        tx_removed: { deleted: true, updatedAt: baseNow - 1000 },
      },
    },
    accountData: localNorm,
  };
  const merged = mergeAccountDataWithRawSnapshot(localNorm, rawSnap);
  assert.ok(merged.transactions.some((t) => t.id === "tx_undone"));
  assert.equal(merged.transactions.find((t) => t.id === "tx_undone")?.currency, "USD");
  assert.equal(merged.transactions.some((t) => t.id === "tx_removed"), false);
});

test("Offline cached session lookup validates UUIDs and offline outbox persists/clears safely", () => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();

  const validUid = "11111111-2222-4333-8444-555555555555";
  globalThis.localStorage.setItem(
    "sb-bad-auth-token",
    JSON.stringify({ session: { user: { id: "not-a-uuid", email: "bad@example.com" } } })
  );
  assert.equal(readCachedSupabaseUserFromStorage(), null);

  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(
    "sb-spend-auth-token",
    JSON.stringify({
      currentSession: {
        user: { id: ` ${validUid} `, email: "user@example.com" },
      },
    })
  );
  const cached = readCachedSupabaseUserFromStorage();
  assert.equal(cached?.id, validUid);
  assert.equal(cached?.email, "user@example.com");

  const snap = { expenses: [{ id: "e1", amount: 125.5, category: "Food", date: "2026-11-25", description: "Lunch" }] };
  assert.equal(persistCloudSyncOutbox({ userId: validUid, snapshot: snap, expectedUpdatedAt: "2026-11-25T00:00:00.000Z" }), true);
  assert.equal(hasPendingCloudOutbox(validUid), true);
  assert.equal(hasPendingCloudOutbox("99999999-2222-4333-8444-555555555555"), false);

  const outbox = readCloudSyncOutbox(validUid);
  assert.equal(outbox?.dirty, true);
  assert.equal(outbox?.mutationCount, 1);
  assert.equal(outbox?.snapshot?.expenses?.length, 1);

  assert.equal(clearCloudSyncOutbox(validUid, "2026-11-25T00:01:00.000Z"), true);
  assert.equal(hasPendingCloudOutbox(validUid), false);
  assert.equal(readCloudSyncOutbox(validUid)?.dirty, false);

  globalThis.localStorage.clear();
});

test("Multi-card ledger engine reconciles Credit Card liability, Savings Vault, and Cash USD wallet with zero drift", () => {
  const cards = [
    { id: "bkash", name: "bKash", category: "mfs", type: "mfs", provider: "bkash", initialBalance: 1000 },
    { id: "cash_usd", name: "USD Wallet", category: "cash", type: "cash", currency: "USD", initialBalance: 200 },
    { id: "card_cc", name: "City Amex", category: "credit", type: "credit", bankId: "city", initialBalance: 500 },
    { id: "savings", name: "Vault", category: "savings", type: "savings", number: "SAV-001", initialBalance: 300 },
  ];
  const openingBalances = { bkash: 1000, cash_usd: 200, card_cc: 500, savings: 300 };
  const expenses = [
    { id: "e1", amount: 150.25, category: "Food", date: "2026-11-24", account: "card_cc", description: "Dinner" },
    { id: "e2", amount: 25.5, category: "Transport", date: "2026-11-24", account: "cash_usd", description: "Cab" },
    { id: "e3", amount: 200, category: "Savings", date: "2026-11-24", account: "bkash", description: "Monthly Save" },
  ];
  const transactions = [
    { id: "t1", type: "income", amount: 100.25, date: "2026-11-25", account: "card_cc", description: "CC Payment" },
  ];

  const res = computeAccountBalances(cards, openingBalances, expenses, transactions);
  assert.equal(res.reconciliation.isBalanced, true);
  assert.equal(res.reconciliation.discrepancyCount, 0);
  // Credit card: 500 + 150.25 (spend increases liability) - 100.25 (income payment reduces liability) = 550
  assert.equal(res.currentBalances.card_cc, 550);
  assert.equal(res.currentBalances.cash_usd, 174.5);
  assert.equal(res.currentBalances.bkash, 800);
  assert.equal(res.currentBalances.savings, 500);
});

test("All 22 SQL migrations have balanced dollar-quoting, clean transactions, and DROP guards for 42P13 safety", () => {
  const migrationsDir = path.join(ROOT, "supabase/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length >= 22);

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const dollarTags = content.match(/\$\$/g) || [];
    assert.equal(
      dollarTags.length % 2,
      0,
      `${file} has unbalanced $$ dollar quotes (${dollarTags.length})`
    );
    const hasBegin = /^\s*begin\s*;/im.test(content);
    const hasCommit = /^\s*commit\s*;/im.test(content);
    assert.equal(hasBegin, hasCommit, `${file} has mismatched BEGIN/COMMIT`);
  }

  const hardeningSql = readRepoFile(
    "supabase/migrations/20261125000000_p0_p1_security_occ_and_ledger_hardening.sql"
  );
  const fnRe = /(^|\n)([\s\S]{0,220}?)create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\)\s*returns\s+([^\n]+)/gi;
  let match;
  let checkedCount = 0;
  while ((match = fnRe.exec(hardeningSql)) !== null) {
    const prefix = match[2];
    const fnName = match[3];
    const retType = match[4].trim().toLowerCase();
    checkedCount += 1;
    if (!retType.startsWith("trigger")) {
      assert.ok(
        prefix.includes(`drop function if exists public.${fnName}`),
        `Expected DROP FUNCTION IF EXISTS before ${fnName} to prevent 42P13`
      );
    }
  }
  assert.ok(checkedCount >= 20, `Expected at least 20 functions in 20261125000000, found ${checkedCount}`);
});
