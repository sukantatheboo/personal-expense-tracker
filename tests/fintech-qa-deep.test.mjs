import test from "node:test";
import assert from "node:assert/strict";

// Setup browser-like mock storage and window globals
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
  computeAccountBalances,
  fromPoisha,
  toPoisha,
  roundMoney,
  normalizeDeletedRecords,
  mergeDeletedRecords,
  loadExpenses,
  loadAccountData,
  loadRecurringSchedules,
  loadBudgets,
  emptyAccountData,
  isCreditCard,
  isSavingsCard,
  isMfsCard,
  isCashCard,
  isValidUuid,
  STORAGE_KEYS,
} from "../src/data.js";

import {
  sanitizeCloudPayload,
  mergeAccountDataWithRawSnapshot,
  captureLocalBackupCheckpoint,
  restoreBackupCheckpoint,
  summarizeCheckpointSnapshot,
  isJwtFresh,
} from "../src/cloud-sync.js";

import {
  encryptBackup,
  decryptBackup,
  setAppPin,
  verifyAppPin,
  removeAppPin,
  resetPinFailures,
  getPinLockoutRemainingSeconds,
} from "../src/security.js";

import {
  buildTransactionNotification,
  buildExpenseNotification,
  buildCardAddedNotification,
} from "../src/notifications.js";

test("FINTECH QA 1: Multi-Card Ledger Integrity & Currency Drift Resistance", () => {
  // Test adding all types of cards: Cash, Bank Debit, Credit Card (liability), MFS Wallet, Savings Vault
  const cards = [
    { id: "cash", name: "Cash", type: "cash", initialBalance: 10000.0 },
    { id: "brac-debit", name: "BRAC Bank", type: "debit", initialBalance: 25000.5 },
    { id: "city-amex", name: "City AMEX", type: "credit", initialBalance: 0.0 },
    { id: "bkash-wallet", name: "bKash", type: "mfs", initialBalance: 3500.25 },
    { id: "sav-vault", name: "Savings Vault", type: "savings", initialBalance: 50000.0 },
  ];

  const openingBalances = {
    cash: 10000.0,
    "brac-debit": 25000.5,
    "city-amex": 0.0,
    "bkash-wallet": 3500.25,
    "sav-vault": 50000.0,
  };

  // Complex multi-transaction timeline
  const expenses = [
    // 1. Regular Cash expense
    {
      id: "exp-cash-1",
      date: "2026-11-20",
      createdAt: 1763600001000,
      updatedAt: 1763600001000,
      amount: 1250.75,
      category: "Food",
      description: "Family Dinner",
      account: "cash",
    },
    // 2. Credit Card purchase (increases liability owed)
    {
      id: "exp-credit-1",
      date: "2026-11-21",
      createdAt: 1763600002000,
      updatedAt: 1763600002000,
      amount: 4500.0,
      category: "Shopping",
      description: "Flight Booking",
      account: "city-amex",
    },
    // 3. Savings transfer expense (deducts from debit, adds to savings)
    {
      id: "exp-sav-1",
      date: "2026-11-22",
      createdAt: 1763600003000,
      updatedAt: 1763600003000,
      amount: 5000.0,
      category: "Savings",
      description: "Monthly DPS",
      account: "brac-debit",
    },
  ];

  const transactions = [
    // 4. Income into bKash
    {
      id: "tx-inc-1",
      type: "income",
      date: "2026-11-20",
      createdAt: 1763600000500,
      updatedAt: 1763600000500,
      amount: 15000.0,
      account: "bkash-wallet",
      description: "Freelance Payment",
    },
    // 5. Account-to-Account transfer: bKash to Cash
    {
      id: "tx-trans-1",
      type: "transfer",
      date: "2026-11-21",
      createdAt: 1763600002500,
      updatedAt: 1763600002500,
      amount: 2000.0,
      fromAccount: "bkash-wallet",
      toAccount: "cash",
      description: "Cash out",
    },
    // 6. Credit card bill payment from Bank Debit
    {
      id: "tx-trans-2",
      type: "transfer",
      date: "2026-11-22",
      createdAt: 1763600004000,
      updatedAt: 1763600004000,
      amount: 4500.0,
      fromAccount: "brac-debit",
      toAccount: "city-amex",
      description: "Pay AMEX bill",
    },
    // 7. Balance adjustment on Cash (+0.05 poisha interest/rounding correction)
    {
      id: "tx-adj-1",
      type: "adjustment",
      direction: "increase",
      date: "2026-11-22",
      createdAt: 1763600005000,
      updatedAt: 1763600005000,
      amount: 0.05,
      account: "cash",
      description: "Rounding correction",
    },
  ];

  const state = computeAccountBalances(cards, openingBalances, expenses, transactions);

  // Expected balances calculation:
  // Cash: 10000.00 - 1250.75 (Dinner) + 2000.00 (Transfer in) + 0.05 (Adjustment) = 10749.30
  assert.equal(state.currentBalances.cash, 10749.3);

  // BRAC Bank: 25000.50 - 5000.00 (Savings) - 4500.00 (Pay AMEX) = 15500.50
  assert.equal(state.currentBalances["brac-debit"], 15500.5);

  // City AMEX: 0.00 + 4500.00 (Flight) - 4500.00 (Paid off) = 0.00
  assert.equal(state.currentBalances["city-amex"], 0.0);

  // bKash: 3500.25 + 15000.00 (Income) - 2000.00 (Transferred out) = 16500.25
  assert.equal(state.currentBalances["bkash-wallet"], 16500.25);

  // Savings Vault: 50000.00 + 5000.00 (Savings deposit) = 55000.00
  assert.equal(state.currentBalances["sav-vault"], 55000.0);

  // Strict double-entry reconciliation check
  assert.equal(state.reconciliation.isBalanced, true);
  assert.equal(state.reconciliation.discrepancyCount, 0);
  assert.equal(state.reconciliation.totalDiscrepancy, 0);

  // Check running balance sequence on BRAC Bank (5000 savings then 4500 card payment)
  const savTx = state.ledgerById.get("exp-sav-1");
  const cardPayTx = state.ledgerById.get("tx-trans-2");
  assert.equal(savTx.fromBalanceBefore, 25000.5);
  assert.equal(savTx.fromBalanceAfter, 20000.5);
  assert.equal(cardPayTx.fromBalanceBefore, 20000.5);
  assert.equal(cardPayTx.fromBalanceAfter, 15500.5);
});

test("FINTECH QA 2: Added Cards Security (CVV Strip, Number Masking & Deck Reorder)", () => {
  const sensitiveRawPayload = {
    expenses: [],
    budgets: {},
    recurringSchedules: [],
    accountData: {
      settings: {
        startDate: "2026-11-01",
        configured: true,
        cardsConfigured: true,
        balances: { "c-1": 5000 },
        cards: [
          {
            id: "c-1",
            name: "Standard Chartered",
            type: "credit",
            last4: "8899",
            number: "4111222233338899", // Sensitive full PAN
            cvv: "321",                  // Strict PCI-DSS violation if synced!
            cvc: "654",
            initialBalance: 5000.456,    // Needs 2-decimal money rounding
          },
          {
            id: "bkash-1",
            name: "bKash",
            type: "mfs",
            provider: "bkash",
            isPhone: true,
            number: "01712345678",
            initialBalance: 1200,
          },
          {
            id: "sav-1",
            name: "Savings Vault",
            type: "savings",
            number: "SAV-9012",
            initialBalance: 25000,
          },
        ],
      },
      transactions: [],
    },
  };

  const sanitized = sanitizeCloudPayload(sensitiveRawPayload);
  const syncedCard = sanitized.accountData.settings.cards[0];
  const syncedMfs = sanitized.accountData.settings.cards[1];
  const syncedSavings = sanitized.accountData.settings.cards[2];

  // CVV/CVC MUST NOT exist anywhere in sanitized payload
  assert.equal(syncedCard.cvv, undefined);
  assert.equal("cvv" in syncedCard, false);
  assert.equal(syncedCard.cvc, undefined);
  assert.equal("cvc" in syncedCard, false);
  // Full 16-digit PAN MUST be masked to last 4 digits only
  assert.equal(syncedCard.number, "•••• •••• •••• 8899");
  assert.equal(JSON.stringify(sanitized).includes("4111222233338899"), false);
  // MFS phone number and Savings synthetic label are preserved
  assert.equal(syncedMfs.number, "01712345678");
  assert.equal(syncedSavings.number, "SAV-9012");
  // Initial balance is properly rounded
  assert.equal(syncedCard.initialBalance, 5000.46);

  // Test card reordering preservation across sync merges
  const cloudAccountSnapshot = {
    settings: {
      updatedAt: 1000,
      cardsConfigured: true,
      cards: [
        { id: "c-1", name: "Card 1", updatedAt: 1000 },
        { id: "c-2", name: "Card 2", updatedAt: 1000 },
      ],
    },
    transactions: [],
  };

  const localReorderedSnapshot = {
    accountData: {
      settings: {
        updatedAt: 2000, // User dragged Card 2 to the top at time 2000
        cardsConfigured: true,
        cards: [
          { id: "c-2", name: "Card 2", updatedAt: 2000 },
          { id: "c-1", name: "Card 1", updatedAt: 1000 },
        ],
      },
      transactions: [],
    },
  };

  const merged = mergeAccountDataWithRawSnapshot(cloudAccountSnapshot, localReorderedSnapshot);
  assert.deepEqual(
    merged.settings.cards.map((c) => c.id),
    ["c-2", "c-1"],
  );
});

test("FINTECH QA 3: Activity Feed & Cross-Device Notification Payload Generation", () => {
  const cards = [
    { id: "cash", name: "Cash", type: "cash" },
    { id: "bkash", name: "bKash", type: "mfs" },
    { id: "amex", name: "City AMEX", type: "credit" },
  ];

  // 1. Expense activity
  const expNotif = buildExpenseNotification(
    {
      id: "exp-99",
      amount: 850,
      description: "Supermarket",
      category: "Food",
      account: "cash",
      date: "2026-11-23",
    },
    cards,
  );
  assert.equal(expNotif.title, "Expense · ৳850");
  assert.equal(expNotif.body, "Supermarket · Food · Paid from Cash");
  assert.equal(expNotif.tab, "activity");

  // 2. Transfer activity
  const txNotif = buildTransactionNotification(
    {
      id: "tx-99",
      type: "transfer",
      amount: 1500,
      fromAccount: "bkash",
      toAccount: "cash",
      description: "ATM Cashout",
      date: "2026-11-23",
    },
    cards,
  );
  assert.equal(txNotif.title, "Transfer · ৳1,500");
  assert.ok(txNotif.body.includes("bKash → Cash"));
  assert.equal(txNotif.tab, "activity");

  // 3. Card Added activity
  const cardNotif = buildCardAddedNotification(cards[1]);
  assert.equal(cardNotif.title, "Wallet Added");
  assert.equal(cardNotif.body, "Your bKash wallet has been added to Accounts.");
  assert.equal(cardNotif.tab, "accounts");
});

test("FINTECH QA 4: Complete Backup Lifecycle (Unencrypted & AES-256 Encrypted Roundtrip)", async () => {
  const fullFintechDataset = {
    expenses: [
      { id: "exp-1", amount: 1200, category: "Food", description: "Lunch", date: "2026-11-20", account: "cash" },
    ],
    budgets: { "2026-11": 30000 },
    recurringSchedules: [
      { id: "rec-1", amount: 1500, description: "Fiber Internet", interval: "monthly", nextDate: "2026-12-01" },
    ],
    accountData: {
      settings: {
        startDate: "2026-11-01",
        configured: true,
        cards: [
          { id: "cash", name: "Cash", type: "cash", initialBalance: 5000 },
        ],
        balances: { cash: 5000 },
      },
      transactions: [
        { id: "tx-1", type: "income", amount: 25000, account: "cash", date: "2026-11-20", description: "Salary" },
      ],
    },
    deletedRecords: {
      expenses: {},
      cards: {},
      accountTransactions: {},
      budgets: {},
      recurringSchedules: {},
    },
    theme: "dark",
    targetCurrency: "BDT",
    reminderTime: "10:00",
  };

  // Test AES-256 PBKDF2 encryption (210,000 iterations)
  const passphrase = "ultra-secure-fintech-passphrase-2026!";
  const encryptedFile = await encryptBackup(fullFintechDataset, passphrase);
  assert.equal(encryptedFile.format, "spend-encrypted-backup");
  assert.equal(encryptedFile.version, 1);
  assert.equal(encryptedFile.iterations, 210000);
  assert.ok(encryptedFile.ciphertext.length > 50);

  // Decrypt with correct passphrase
  const restoredDataset = await decryptBackup(encryptedFile, passphrase);
  assert.deepEqual(restoredDataset.expenses, fullFintechDataset.expenses);
  assert.deepEqual(restoredDataset.accountData.transactions, fullFintechDataset.accountData.transactions);
  assert.deepEqual(restoredDataset.accountData.settings.cards, fullFintechDataset.accountData.settings.cards);

  // Decrypt with incorrect passphrase MUST fail
  await assert.rejects(async () => {
    await decryptBackup(encryptedFile, "wrong-password");
  });
});

test("FINTECH QA 5: Backup Checkpoints & Rollback Tombstones Generation", async () => {
  globalThis.localStorage.clear();
  const userId = "550e8400-e29b-41d4-a716-446655440000";

  const checkpointData = {
    expenses: [{ id: "e1", amount: 100, description: "Old Coffee", date: "2026-11-10", account: "cash" }],
    accountData: {
      settings: {
        cards: [{ id: "cash", name: "Cash", initialBalance: 1000 }],
        balances: { cash: 1000 },
      },
      transactions: [{ id: "t1", type: "income", amount: 500, account: "cash", date: "2026-11-10" }],
    },
  };

  // Capture checkpoint
  const cp = captureLocalBackupCheckpoint(userId, checkpointData, {
    type: "manual",
    label: "Snapshot Before Risky Action",
    id: "cp-test-01",
  });
  assert.ok(cp);
  assert.equal(cp.cardCount, 1);
  assert.equal(cp.expenseCount, 1);
  assert.equal(cp.txCount, 1);

  // Current data has newly added items that weren't in the checkpoint
  const currentDataWithNewItems = {
    expenses: [
      { id: "e1", amount: 100, description: "Old Coffee", date: "2026-11-10", account: "cash" },
      { id: "e2-new", amount: 999, description: "Unwanted Item", date: "2026-11-22", account: "cash" },
    ],
    accountData: {
      settings: {
        cards: [
          { id: "cash", name: "Cash", initialBalance: 1000 },
          { id: "card-unwanted", name: "Unwanted Card", initialBalance: 200 },
        ],
        balances: { cash: 1000, "card-unwanted": 200 },
      },
      transactions: [
        { id: "t1", type: "income", amount: 500, account: "cash", date: "2026-11-10" },
        { id: "t2-new", type: "income", amount: 5000, account: "cash", date: "2026-11-22" },
      ],
    },
  };

  // Restore the checkpoint: must generate rollback tombstones for e2-new, card-unwanted, and t2-new!
  const restored = await restoreBackupCheckpoint(userId, "cp-test-01", currentDataWithNewItems);
  assert.ok(restored);
  assert.equal(restored.data.expenses.length, 1);
  assert.equal(restored.data.expenses[0].id, "e1");

  // Verify rollback tombstones
  const deletedRecords = restored.data.deletedRecords;
  assert.equal(deletedRecords.expenses["e2-new"]?.deleted, true);
  assert.equal(deletedRecords.accountTransactions["t2-new"]?.deleted, true);
  assert.equal(deletedRecords.cards["card-unwanted"]?.deleted, true);
});

test("FINTECH QA 6: 10,000 Micro-Transactions IEEE-754 Precision Stress Test", () => {
  // Simulate 10,000 micro-transactions of 0.07 BDT each
  let runningPoisha = 0;
  let naiveFloat = 0;

  for (let i = 0; i < 10000; i += 1) {
    runningPoisha += toPoisha(0.07);
    naiveFloat += 0.07;
  }

  const exactPoishaResult = fromPoisha(runningPoisha);

  // Exact math: 10,000 * 0.07 = 700.00
  assert.equal(exactPoishaResult, 700.0);

  // Standard float arithmetic drifts (e.g. 700.0000000001402)
  assert.notEqual(naiveFloat, exactPoishaResult);
  assert.equal(Number(naiveFloat.toFixed(2)), exactPoishaResult);
});
