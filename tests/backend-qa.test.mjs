import test from "node:test";
import assert from "node:assert/strict";

// Set up minimal browser-like globals for localStorage, sessionStorage & WebCrypto tests
class MemoryStorage {
  constructor() {
    this.store = new Map();
    this.quotaLimit = Infinity;
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(k) {
    return this.store.has(String(k)) ? this.store.get(String(k)) : null;
  }
  setItem(k, v) {
    if (this.store.size >= this.quotaLimit && !this.store.has(String(k))) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.store.set(String(k), String(v));
  }
  removeItem(k) {
    this.store.delete(String(k));
  }
  clear() {
    this.store.clear();
    this.quotaLimit = Infinity;
  }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = globalThis;

import {
  clampDayOfMonth,
  computeAccountBalances,
  fromPoisha,
  isValidUuid,
  MAX_TOMBSTONES_PER_COLLECTION,
  nextOccurrenceDate,
  normalizeDeletedRecords,
  STORAGE_KEYS,
  toPoisha,
} from "../src/data.js";

import {
  decryptBackup,
  encryptAllSensitiveData,
  encryptBackup,
  getPinLockoutRemainingSeconds,
  hasAppPin,
  removeAppPin,
  resetPinFailures,
  setAppPin,
  verifyAppPin,
} from "../src/security.js";

import {
  isJwtFresh,
  mergeAccountDataWithRawSnapshot,
  readSupabaseAccessTokenFromStorage,
  sanitizeCloudPayload,
  setLiveSupabaseSessionToken,
  subscribeToCloudChanges,
} from "../src/cloud-sync.js";

import {
  getWeeklySpendSummary,
  hashNotificationId,
  IMMEDIATE_NOTIF_ID_MAX,
  IMMEDIATE_NOTIF_ID_MIN,
  SCHEDULED_NOTIF_ID_MAX,
  SCHEDULED_NOTIF_ID_MIN,
} from "../src/notifications.js";

test("1. Integer Poisha Balance Engine: zero IEEE-754 floating-point drift & credit liability polarity", () => {
  assert.equal(toPoisha(0.1) + toPoisha(0.2), 30);
  assert.equal(fromPoisha(toPoisha(0.1) + toPoisha(0.2)), 0.3);
  assert.equal(
    fromPoisha(toPoisha(15327.1) + toPoisha(0.2) - toPoisha(5.55)),
    15321.75,
  );

  const cards = [
    { id: "cash", name: "Cash", type: "cash", initialBalance: 15327.1 },
    { id: "bkash", name: "bKash", type: "mfs", initialBalance: 500.1 },
    { id: "amex", name: "City AMEX", type: "credit", initialBalance: 1000 },
    { id: "sav", name: "Savings Vault", type: "savings", initialBalance: 2000 },
  ];
  const openingBalances = {
    cash: 15327.1,
    bkash: 500.1,
    amex: 1000,
    sav: 2000,
  };
  const expenses = [
    {
      id: "exp-1",
      date: "2026-11-10",
      createdAt: 1700000001000,
      updatedAt: 1700000099000, // Later edit to note must NOT reorder ledger sequence!
      amount: 5.55,
      category: "Food",
      description: "Tea",
      account: "cash",
    },
    {
      id: "exp-2",
      date: "2026-11-10",
      createdAt: 1700000002000,
      updatedAt: 1700000002000,
      amount: 250.25,
      category: "Shopping",
      description: "Online order on Credit Card",
      account: "amex",
    },
    {
      id: "exp-3",
      date: "2026-11-10",
      createdAt: 1700000003000,
      updatedAt: 1700000003000,
      amount: 100.05,
      category: "Savings",
      description: "Save from bKash",
      account: "bkash",
    },
  ];
  const transactions = [
    {
      id: "tx-1",
      type: "income",
      date: "2026-11-10",
      createdAt: 1700000000500,
      updatedAt: 1700000000500,
      amount: 0.2,
      account: "cash",
      description: "Rebate",
    },
  ];

  const state = computeAccountBalances(
    cards,
    openingBalances,
    expenses,
    transactions,
  );

  // Cash: 15327.10 + 0.20 - 5.55 = 15321.75
  assert.equal(state.currentBalances.cash, 15321.75);
  // bKash: 500.10 - 100.05 = 400.05
  assert.equal(state.currentBalances.bkash, 400.05);
  // Savings Vault: 2000 + 100.05 = 2100.05
  assert.equal(state.currentBalances.sav, 2100.05);
  // Credit Card (liability): 1000 + 250.25 = 1250.25 owed
  assert.equal(state.currentBalances.amex, 1250.25);
  // Reconciliation ok
  assert.equal(state.reconciliation.isBalanced, true);
  assert.equal(state.reconciliation.discrepancyCount, 0);
  assert.equal(state.reconciliation.totalDiscrepancy, 0);

  // Verify chronological ordering used createdAt (tx-1 at 0500 before exp-1 at 1000 despite exp-1 having updatedAt 99000)
  const txEntry = state.ledgerById.get("tx-1");
  const expEntry = state.ledgerById.get("exp-1");
  assert.equal(txEntry.balanceBefore, 15327.1);
  assert.equal(txEntry.balanceAfter, 15327.3);
  assert.equal(expEntry.balanceBefore, 15327.3);
  assert.equal(expEntry.balanceAfter, 15321.75);
});

test("2. Monthly Recurring Schedule: dayOfMonth=31 anchor preserved across short months without oscillation", () => {
  const anchorDay = 31;
  assert.equal(clampDayOfMonth(2026, 2, 31), 28);
  assert.equal(clampDayOfMonth(2024, 2, 31), 29);

  const feb = nextOccurrenceDate("2026-01-31", "monthly", anchorDay);
  assert.equal(feb, "2026-02-28");

  // Passing anchorDay=31 from 2026-02-28 must snap back to 2026-03-31 (not stay at 28)
  const mar = nextOccurrenceDate(feb, "monthly", anchorDay);
  assert.equal(mar, "2026-03-31");

  const apr = nextOccurrenceDate(mar, "monthly", anchorDay);
  assert.equal(apr, "2026-04-30");

  const may = nextOccurrenceDate(apr, "monthly", anchorDay);
  assert.equal(may, "2026-05-31");
});

test("3. Tombstone Pruning: legacy updatedAt=0 migration, 60-day TTL, and MAX_TOMBSTONES_PER_COLLECTION cap", () => {
  const now = 1760000000000;
  const expiredTime = now - 61 * 24 * 60 * 60 * 1000;
  const raw = {
    expenses: {
      "legacy-zero": { deleted: true, updatedAt: 0 },
      "expired-old": { deleted: true, updatedAt: expiredTime },
      "recent-item": { deleted: true, updatedAt: now - 1000 },
    },
  };

  const normalized = normalizeDeletedRecords(raw, now);
  assert.equal(Boolean(normalized.expenses["expired-old"]), false);
  assert.equal(Boolean(normalized.expenses["recent-item"]), true);
  assert.equal(Boolean(normalized.expenses["legacy-zero"]), true);
  // Legacy 0 timestamp is assigned a deterministic positive timestamp so it expires after 60 days
  assert.ok(normalized.expenses["legacy-zero"].updatedAt > 0);

  // Verify cap of MAX_TOMBSTONES_PER_COLLECTION (500)
  const many = {};
  for (let i = 0; i < 620; i += 1) {
    many[`exp-${i}`] = { deleted: true, updatedAt: now - (620 - i) * 1000 };
  }
  const capped = normalizeDeletedRecords({ expenses: many }, now);
  const keys = Object.keys(capped.expenses);
  assert.equal(keys.length, MAX_TOMBSTONES_PER_COLLECTION);
  // Oldest 120 items (exp-0 .. exp-119) evicted; newest (exp-619) retained
  assert.equal(Boolean(capped.expenses["exp-0"]), false);
  assert.equal(Boolean(capped.expenses["exp-619"]), true);
});

test("4. Cloud Payload Sanitization & Card Reorder Preservation", () => {
  const dirtyPayload = {
    expenses: [
      {
        id: "e1",
        description: "  Lunch ",
        amount: "120.556",
        category: "Food",
        date: "2026-11-12",
        account: "cash",
      },
      {
        id: "invalid-expense",
        description: "",
        amount: -50,
        category: "Food",
        date: "bad-date",
      },
    ],
    budgets: {
      "2026-11": 25000.456,
      "bad-month": -100,
    },
    recurringSchedules: [
      {
        id: "r1",
        description: "Netflix",
        amount: 650,
        category: "Entertainment",
        interval: "monthly",
        nextDate: "2026-12-15",
        dayOfMonth: 15,
      },
    ],
    accountData: {
      settings: {
        startDate: "2026-11-01",
        configured: true,
        cardsConfigured: true,
        balances: { cash: 5000 },
        cards: [
          {
            id: "card-1",
            name: "City Bank",
            type: "debit",
            last4: "1234",
            number: "4111222233331234",
            cvv: "999", // Must be stripped!
            initialBalance: 5000,
          },
        ],
      },
      transactions: [],
    },
  };

  const clean = sanitizeCloudPayload(dirtyPayload);
  assert.equal(clean.expenses.length, 1);
  assert.equal(clean.expenses[0].description, "Lunch");
  assert.equal(clean.expenses[0].amount, 120.56);
  assert.equal(clean.budgets["2026-11"], 25000.46);
  assert.equal(clean.budgets["bad-month"], undefined);
  assert.equal(clean.accountData.settings.cards[0].cvv, undefined);

  // Verify card deck reorder preservation when rawSnapshot has newer updatedAt than normalized
  const rawSnapshot = {
    accountData: {
      settings: {
        updatedAt: 2000,
        cardsConfigured: true,
        cards: [
          { id: "c2", name: "Second moved to First", updatedAt: 2000 },
          { id: "c1", name: "First moved to Second", updatedAt: 1000 },
        ],
      },
      transactions: [],
    },
  };
  const normAccountData = {
    settings: {
      updatedAt: 1000,
      cardsConfigured: true,
      cards: [
        { id: "c1", name: "First moved to Second", updatedAt: 1000 },
        { id: "c2", name: "Second moved to First", updatedAt: 1000 },
      ],
    },
    transactions: [],
  };
  const merged = mergeAccountDataWithRawSnapshot(normAccountData, rawSnapshot);
  assert.deepEqual(
    merged.settings.cards.map((c) => c.id),
    ["c2", "c1"],
  );
});

test("5. Realtime Filter Injection Guard & Keepalive JWT Freshness Validation", () => {
  assert.equal(isValidUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(
    isValidUuid("550e8400-e29b-41d4-a716-446655440000,id=neq.0"),
    false,
  );

  // Non-UUID userId must return a no-op unsubscribe without touching Supabase channel
  const unsub = subscribeToCloudChanges("malicious,user_id=neq.1", () => {});
  assert.equal(typeof unsub, "function");

  // Construct expired vs fresh JWT payloads
  const makeJwt = (expSec) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "550e8400-e29b-41d4-a716-446655440000", exp: expSec })).toString("base64url");
    return `${header}.${payload}.signature`;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = makeJwt(nowSec - 60);
  const freshJwt = makeJwt(nowSec + 3600);

  assert.equal(isJwtFresh(expiredJwt), false);
  assert.equal(isJwtFresh(freshJwt), true);

  globalThis.localStorage.clear();
  setLiveSupabaseSessionToken("");
  globalThis.localStorage.setItem(
    "sb-eipexdfsblfyegycbigd-auth-token",
    JSON.stringify({ access_token: expiredJwt }),
  );
  // Expired token in localStorage must NOT be returned for keepalive sync
  assert.equal(readSupabaseAccessTokenFromStorage(), "");

  // Live fresh token is returned
  setLiveSupabaseSessionToken(freshJwt);
  assert.equal(readSupabaseAccessTokenFromStorage(), freshJwt);
  setLiveSupabaseSessionToken("");
});

test("6. Notification ID Namespace Separation & FNV-1a+Avalanche Collision Resistance", () => {
  const seenScheduled = new Set();
  const seenImmediate = new Set();

  for (let i = 0; i < 1000; i += 1) {
    const schedId = hashNotificationId(
      `spend-sched-bill-${i}`,
      SCHEDULED_NOTIF_ID_MIN,
      SCHEDULED_NOTIF_ID_MAX,
    );
    const immId = hashNotificationId(
      `spend-immediate-alert-${i}`,
      IMMEDIATE_NOTIF_ID_MIN,
      IMMEDIATE_NOTIF_ID_MAX,
    );

    assert.ok(
      schedId >= SCHEDULED_NOTIF_ID_MIN && schedId <= SCHEDULED_NOTIF_ID_MAX,
    );
    assert.ok(
      immId >= IMMEDIATE_NOTIF_ID_MIN && immId <= IMMEDIATE_NOTIF_ID_MAX,
    );
    seenScheduled.add(schedId);
    seenImmediate.add(immId);
  }

  // Zero collisions across 1,000 sequential schedule keys and zero overlap between scheduled & immediate ranges
  assert.equal(seenScheduled.size, 1000);
  assert.equal(seenImmediate.size, 1000);

  // Weekly spend summary uses integer poisha without float drift
  const refNow = new Date(2026, 10, 15, 12, 0, 0);
  const summary = getWeeklySpendSummary(
    [
      { date: "2026-11-15", amount: 0.1, category: "Food" },
      { date: "2026-11-14", amount: 0.2, category: "Food" },
    ],
    refNow,
  );
  assert.equal(summary.total, 0.3);
  assert.equal(summary.count, 2);
});

test("7. Security: Tamper-Evident PIN Lockout, Two-Phase Atomic Encryption Rollback & Backup Crypto", async () => {
  globalThis.localStorage.clear();
  resetPinFailures();

  globalThis.localStorage.setItem(
    STORAGE_KEYS.expenses,
    JSON.stringify([{ id: "e1", amount: 150, description: "Coffee" }]),
  );

  // Set PIN and verify sensitive keys are encrypted at rest
  await setAppPin("4829");
  assert.equal(hasAppPin(), true);
  const encryptedRaw = JSON.parse(
    globalThis.localStorage.getItem(STORAGE_KEYS.expenses),
  );
  assert.equal(encryptedRaw.format, "spend-encrypted-v1");

  // Trigger 5 failed PIN attempts to engage 30s lockout
  for (let i = 0; i < 5; i += 1) {
    const res = await verifyAppPin("0000");
    assert.equal(res, false);
  }
  assert.ok(getPinLockoutRemainingSeconds() > 0);

  // Simulate attacker deleting `spend-security-pin-lockout-v1` and `spend-security-pin-fails-v1` from localStorage
  globalThis.localStorage.removeItem("spend-security-pin-lockout-v1");
  globalThis.localStorage.removeItem("spend-security-pin-fails-v1");

  // In-memory counter + tamper-evident signature must still block PIN verification even with the right PIN!
  const blockedAttempt = await verifyAppPin("4829");
  assert.equal(blockedAttempt, false);
  assert.ok(getPinLockoutRemainingSeconds() > 0);

  // Clear lockout for remaining tests
  resetPinFailures();
  const unlocked = await verifyAppPin("4829");
  assert.equal(unlocked, true);

  // Test two-phase atomic rollback on QuotaExceededError during encryptAllSensitiveData
  await removeAppPin();
  const plainSnapshot = globalThis.localStorage.getItem(STORAGE_KEYS.expenses);
  assert.ok(!plainSnapshot.includes("spend-encrypted-v1"));

  globalThis.localStorage.setItem(
    STORAGE_KEYS.budgets,
    JSON.stringify({ "2026-11": 10000 }),
  );
  const originalSetItem = globalThis.localStorage.setItem.bind(
    globalThis.localStorage,
  );
  let writeCount = 0;
  globalThis.localStorage.setItem = (k, v) => {
    writeCount += 1;
    if (writeCount === 2) {
      throw new Error("Simulated QuotaExceededError on second key write");
    }
    return originalSetItem(k, v);
  };

  const dummyKey = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  await assert.rejects(async () => {
    await encryptAllSensitiveData(dummyKey);
  }, /Simulated QuotaExceededError/);

  // Restore normal setItem and verify first key was rolled back to plaintext!
  globalThis.localStorage.setItem = originalSetItem;
  assert.equal(
    globalThis.localStorage.getItem(STORAGE_KEYS.expenses),
    plainSnapshot,
  );

  // Verify encrypted backup round-trip (210,000 PBKDF2 iterations)
  const backupPayload = await encryptBackup(
    { expenses: [{ id: "e1", amount: 500 }] },
    "correct-horse-battery-staple",
  );
  assert.equal(backupPayload.iterations, 210000);
  const restored = await decryptBackup(
    backupPayload,
    "correct-horse-battery-staple",
  );
  assert.deepEqual(restored, { expenses: [{ id: "e1", amount: 500 }] });
});
