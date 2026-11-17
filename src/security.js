/**
 * Native App Lock & Biometrics Security Engine
 *
 * Implements:
 * 1. Device App Lock with PIN hashing (PBKDF2 with 210,000 rounds + cryptographically random salt, backward-compatible with 100,000 rounds).
 * 2. Tamper-evident lockout state in memory + storage MAC to prevent localStorage PIN brute-force bypass.
 * 3. Two-phase atomic re-encryption with rollback on failure to prevent partial encryption state.
 * 4. Biometric Authentication via standard WebAuthn API and Native Keystore/Keychain.
 */

const PIN_STORAGE_KEY = "spend-security-pin-v1";
const PIN_SALT_KEY = "spend-security-salt-v1";
const PIN_ITERATIONS_KEY = "spend-security-pin-iters-v1";
const PIN_FAIL_COUNT_KEY = "spend-security-pin-fails-v1";
const PIN_LOCKOUT_UNTIL_KEY = "spend-security-pin-lockout-v1";
const PIN_LOCKOUT_SIG_KEY = "spend-security-pin-lockout-sig-v1";
const BIOMETRIC_KEY_ID = "spend-biometric-credential-v1";
const BIOMETRIC_KEY_STORAGE = "spend-biometric-key-v1";
const LOCK_TIMEOUT_KEY = "spend-lock-timeout-v1";
const LAST_ACTIVE_KEY = "spend-last-active-v1";
const BACKGROUNDED_AT_KEY = "spend-backgrounded-at-v1";
const SESSION_UNLOCKED_KEY = "spend-session-unlocked-v1";
const DATA_SALT_KEY = "spend-security-data-salt-v1";

const DEFAULT_LEGACY_PBKDF2_ITERATIONS = 100000;
const HARDENED_PBKDF2_ITERATIONS = 210000;

const IDB_KEYSTORE_DB = "spend-security-keystore-v1";
const IDB_KEYSTORE_STORE = "crypto-keys";

export const ENCRYPTED_STORAGE_FORMAT = "spend-encrypted-v1";

/**
 * List of localStorage keys containing sensitive financial data that must be
 * encrypted at rest when App Lock PIN is enabled.
 */
export const SENSITIVE_STORAGE_KEYS = [
  "spend-expenses-v1",
  "spend-monthly-budgets-v1",
  "spend-budget-updated-at-v1",
  "spend-recurring-expenses-v1",
  "spend-account-balances-v1",
  "spend-deleted-records-v1",
  "spend-local-user-snapshots-v1",
  "spend-backup-checkpoints-v1",
  "spend-cloud-sync-outbox-v1",
];

// Purge any legacy plaintext biometric keys that may have been written to localStorage
try {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(BIOMETRIC_KEY_STORAGE);
    localStorage.removeItem(`spend-secure-${BIOMETRIC_KEY_STORAGE}`);
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("spend-secure-")) {
        localStorage.removeItem(k);
      }
    });
  }
} catch {
  // ignore when localStorage is inaccessible
}

// Module-scoped private runtime state (inaccessible from window/DevTools/localStorage tampering)
let isSessionUnlockedInMemory = false;
let activeSessionKey = null;
let biometricCachedKey = null;
let inMemoryPinFailCount = 0;
let inMemoryPinLockoutUntil = 0;

export function getSessionKey() {
  return activeSessionKey;
}

export function setSessionKey(key) {
  activeSessionKey = key;
}

export function isSessionUnlocked() {
  if (!hasAppPin()) return true;
  return isSessionUnlockedInMemory && Boolean(activeSessionKey);
}

function setSessionUnlocked(unlocked) {
  isSessionUnlockedInMemory = Boolean(unlocked);
  try {
    sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  } catch {
    // ignore
  }
}

function lockRuntimeSession() {
  setSessionUnlocked(false);
  setSessionKey(null);
  if (!hasBiometricsConfigured()) {
    biometricCachedKey = null;
  }
}

/* ───────────── IndexedDB Non-Extractable CryptoKey Store (Web / PWA) ───────────── */
function openKeystoreDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(IDB_KEYSTORE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_KEYSTORE_STORE)) {
        db.createObjectStore(IDB_KEYSTORE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveNonExtractableBiometricKey(sessionKey) {
  if (!sessionKey) return false;
  try {
    const rawKey = await crypto.subtle.exportKey("raw", sessionKey);
    const nonExtractableKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      false, // non-extractable: raw key material can never be exported from IndexedDB
      ["encrypt", "decrypt"],
    );
    const db = await openKeystoreDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_KEYSTORE_STORE, "readwrite");
      tx.objectStore(IDB_KEYSTORE_STORE).put(
        nonExtractableKey,
        BIOMETRIC_KEY_STORAGE,
      );
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function loadNonExtractableBiometricKey() {
  try {
    const db = await openKeystoreDb();
    const key = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_KEYSTORE_STORE, "readonly");
      const req = tx.objectStore(IDB_KEYSTORE_STORE).get(BIOMETRIC_KEY_STORAGE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return key instanceof CryptoKey ? key : null;
  } catch {
    return null;
  }
}

async function clearNonExtractableBiometricKey() {
  try {
    const db = await openKeystoreDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_KEYSTORE_STORE, "readwrite");
      tx.objectStore(IDB_KEYSTORE_STORE).delete(BIOMETRIC_KEY_STORAGE);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

function getHardwareSecurePlugin() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return (
    cap?.Plugins?.SecureStoragePlugin ||
    cap?.Plugins?.SecureStorage ||
    (typeof window !== "undefined" ? window.SecureStoragePlugin : null)
  );
}

export const NativeSecureStorage = {
  isAvailable() {
    return Boolean(getHardwareSecurePlugin());
  },

  async setItem(key, value) {
    try {
      const plugin = getHardwareSecurePlugin();
      if (!plugin) return false;
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      await plugin.set({ key, value: valStr });
      return true;
    } catch (err) {
      console.warn("NativeSecureStorage.setItem error:", err);
      return false;
    }
  },

  async getItem(key) {
    try {
      const plugin = getHardwareSecurePlugin();
      if (!plugin) return null;
      const res = await plugin.get({ key });
      return res?.value ?? null;
    } catch {
      return null;
    }
  },

  async removeItem(key) {
    try {
      const plugin = getHardwareSecurePlugin();
      if (plugin) {
        await plugin.remove({ key });
      }
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(`spend-secure-${key}`);
        localStorage.removeItem(key);
      }
      return true;
    } catch {
      return false;
    }
  },

  async clear() {
    try {
      const plugin = getHardwareSecurePlugin();
      if (plugin) {
        await plugin.clear();
      }
      if (typeof localStorage !== "undefined") {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("spend-secure-")) {
            localStorage.removeItem(k);
          }
        });
      }
      return true;
    } catch {
      return false;
    }
  },
};

async function persistBiometricSessionKey(sessionKey) {
  if (!sessionKey || !hasBiometricsConfigured()) return;
  biometricCachedKey = sessionKey;
  await saveNonExtractableBiometricKey(sessionKey);
  if (NativeSecureStorage.isAvailable()) {
    try {
      const rawKey = await crypto.subtle.exportKey("raw", sessionKey);
      await NativeSecureStorage.setItem(
        BIOMETRIC_KEY_STORAGE,
        bufferToBase64(rawKey),
      );
    } catch {
      // ignore if key is non-extractable
    }
  }
}

async function clearPersistedBiometricKey() {
  biometricCachedKey = null;
  await clearNonExtractableBiometricKey();
  await NativeSecureStorage.removeItem(BIOMETRIC_KEY_STORAGE);
}

function ensureSubtleCrypto() {
  if (
    typeof globalThis === "undefined" ||
    !globalThis.crypto ||
    !globalThis.crypto.subtle
  ) {
    throw new Error(
      "Web Cryptography API is unavailable. App Lock requires a secure context (HTTPS or localhost).",
    );
  }
}

/* ───────────── Helper ArrayBuffer / Base64 conversions ───────────── */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getRandomBytes(length = 16) {
  const array = new Uint8Array(length);
  globalThis.crypto.getRandomValues(array);
  return array;
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function computeLockoutSignature(fails, until) {
  const salt =
    (typeof localStorage !== "undefined" &&
      localStorage.getItem(PIN_SALT_KEY)) ||
    "spend-lockout-salt";
  const hash =
    (typeof localStorage !== "undefined" &&
      localStorage.getItem(PIN_STORAGE_KEY)) ||
    "spend-lockout-hash";
  const payload = `${salt}:${hash}:${fails}:${until}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < payload.length; i += 1) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function syncLockoutStateFromStorage() {
  try {
    if (typeof localStorage === "undefined") return;
    const rawFails = localStorage.getItem(PIN_FAIL_COUNT_KEY);
    const rawUntil = localStorage.getItem(PIN_LOCKOUT_UNTIL_KEY);
    const rawSig = localStorage.getItem(PIN_LOCKOUT_SIG_KEY);

    const storedFails = Number(rawFails) || 0;
    const storedUntil = Number(rawUntil) || 0;

    // Detect if localStorage keys were manually deleted or modified while in-memory lockout is active
    if (inMemoryPinFailCount > storedFails || inMemoryPinLockoutUntil > storedUntil) {
      const sig = computeLockoutSignature(
        inMemoryPinFailCount,
        inMemoryPinLockoutUntil,
      );
      localStorage.setItem(PIN_FAIL_COUNT_KEY, String(inMemoryPinFailCount));
      localStorage.setItem(
        PIN_LOCKOUT_UNTIL_KEY,
        String(inMemoryPinLockoutUntil),
      );
      localStorage.setItem(PIN_LOCKOUT_SIG_KEY, sig);
      return;
    }

    if (storedFails > 0 || storedUntil > 0) {
      const expectedSig = computeLockoutSignature(storedFails, storedUntil);
      if (rawSig && !constantTimeEqual(rawSig, expectedSig)) {
        // Tampered lockout record: enforce conservative 60s penalty cooldown
        inMemoryPinFailCount = Math.max(inMemoryPinFailCount, 5);
        inMemoryPinLockoutUntil = Math.max(
          inMemoryPinLockoutUntil,
          Date.now() + 60000,
        );
        const fixedSig = computeLockoutSignature(
          inMemoryPinFailCount,
          inMemoryPinLockoutUntil,
        );
        localStorage.setItem(PIN_FAIL_COUNT_KEY, String(inMemoryPinFailCount));
        localStorage.setItem(
          PIN_LOCKOUT_UNTIL_KEY,
          String(inMemoryPinLockoutUntil),
        );
        localStorage.setItem(PIN_LOCKOUT_SIG_KEY, fixedSig);
        return;
      }
      inMemoryPinFailCount = Math.max(inMemoryPinFailCount, storedFails);
      inMemoryPinLockoutUntil = Math.max(inMemoryPinLockoutUntil, storedUntil);
    }
  } catch {
    // ignore storage errors
  }
}

export function getPinLockoutRemainingSeconds() {
  syncLockoutStateFromStorage();
  const remaining = Math.ceil((inMemoryPinLockoutUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

export function resetPinFailures() {
  inMemoryPinFailCount = 0;
  inMemoryPinLockoutUntil = 0;
  try {
    localStorage.removeItem(PIN_FAIL_COUNT_KEY);
    localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
    localStorage.removeItem(PIN_LOCKOUT_SIG_KEY);
  } catch {
    // ignore
  }
}

function recordPinFailure() {
  syncLockoutStateFromStorage();
  const count = inMemoryPinFailCount + 1;
  inMemoryPinFailCount = count;
  if (count >= 10) {
    inMemoryPinLockoutUntil = Date.now() + 300000; // 5 min lockout
  } else if (count >= 8) {
    inMemoryPinLockoutUntil = Date.now() + 120000; // 2 min lockout
  } else if (count >= 5) {
    inMemoryPinLockoutUntil = Date.now() + 30000; // 30 sec lockout
  }
  try {
    const sig = computeLockoutSignature(
      inMemoryPinFailCount,
      inMemoryPinLockoutUntil,
    );
    localStorage.setItem(PIN_FAIL_COUNT_KEY, String(inMemoryPinFailCount));
    localStorage.setItem(
      PIN_LOCKOUT_UNTIL_KEY,
      String(inMemoryPinLockoutUntil),
    );
    localStorage.setItem(PIN_LOCKOUT_SIG_KEY, sig);
  } catch {
    // In-memory lockout still enforces rate limit if storage is full
  }
}

function getStoredPbkdf2Iterations() {
  try {
    const raw = Number(localStorage.getItem(PIN_ITERATIONS_KEY));
    if (Number.isInteger(raw) && raw >= DEFAULT_LEGACY_PBKDF2_ITERATIONS) {
      return raw;
    }
  } catch {
    // fallback
  }
  return DEFAULT_LEGACY_PBKDF2_ITERATIONS;
}

/* ───────────── AES-256-GCM Data-at-Rest Encryption (PBKDF2) ───────────── */

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user PIN and cryptographic salt
 * using PBKDF2 with SHA-256.
 */
export async function deriveEncryptionKey(
  pin,
  saltBytes,
  iterations = getStoredPbkdf2Iterations(),
) {
  if (!pin || typeof pin !== "string") {
    throw new Error("PIN is required to derive encryption key.");
  }
  ensureSubtleCrypto();

  const salt = saltBytes || getRandomBytes(16);
  const encoder = new TextEncoder();

  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );

  return { key: aesKey, salt };
}

/**
 * Encrypts an arbitrary object/value using AES-256-GCM into an encrypted envelope.
 * Returns a JSON string containing { format, version, iv, ciphertext }.
 */
export async function encryptData(plainData, key = activeSessionKey) {
  if (!key) {
    return JSON.stringify(plainData);
  }
  ensureSubtleCrypto();

  const iv = getRandomBytes(12); // Standard 96-bit IV for AES-GCM
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(plainData));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes,
  );

  const envelope = {
    format: ENCRYPTED_STORAGE_FORMAT,
    version: 1,
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertextBuffer),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypts an encrypted envelope using AES-256-GCM and the provided session key.
 * If the input is unencrypted JSON, returns the parsed data for backward compatibility.
 */
export async function decryptData(storedStringOrObj, key = activeSessionKey) {
  if (storedStringOrObj === null || storedStringOrObj === undefined) {
    return null;
  }

  let parsed = storedStringOrObj;
  if (typeof storedStringOrObj === "string") {
    try {
      parsed = JSON.parse(storedStringOrObj);
    } catch {
      return storedStringOrObj;
    }
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    parsed.format === ENCRYPTED_STORAGE_FORMAT &&
    parsed.iv &&
    parsed.ciphertext
  ) {
    if (!key) {
      throw new Error("Cannot decrypt data: session key is unavailable.");
    }
    ensureSubtleCrypto();
    const iv = new Uint8Array(base64ToBuffer(parsed.iv));
    const ciphertext = base64ToBuffer(parsed.ciphertext);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  }

  return parsed;
}

/**
 * Two-phase atomic encryption of all sensitive records in localStorage.
 * Phase 1: Decrypts (if oldSessionKey is provided) and encrypts all keys in memory.
 * Phase 2: Commits all encrypted values to localStorage, rolling back to the exact
 *          pre-operation snapshot if any key fails to write (e.g. QuotaExceededError).
 */
export async function encryptAllSensitiveData(
  newSessionKey = activeSessionKey,
  oldSessionKey = null,
) {
  if (!newSessionKey) return false;
  const originalRawSnapshot = new Map();
  const stagedEncryptedWrites = new Map();

  // Phase 1: Prepare all encrypted payloads in memory before mutating localStorage
  for (const key of SENSITIVE_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    originalRawSnapshot.set(key, raw);
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    let plainData = parsed;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.format === ENCRYPTED_STORAGE_FORMAT
    ) {
      if (!oldSessionKey) {
        // Already encrypted and no key rotation requested; verify it decrypts with newSessionKey
        try {
          await decryptData(parsed, newSessionKey);
          continue;
        } catch {
          throw new Error(
            `Cannot re-encrypt ${key}: existing encrypted record requires previous session key.`,
          );
        }
      }
      plainData = await decryptData(parsed, oldSessionKey);
    }

    const encrypted = await encryptData(plainData, newSessionKey);
    stagedEncryptedWrites.set(key, encrypted);
  }

  // Phase 2: Commit staged writes with automatic rollback on storage failure
  const committedKeys = [];
  try {
    for (const [key, encryptedValue] of stagedEncryptedWrites.entries()) {
      localStorage.setItem(key, encryptedValue);
      committedKeys.push(key);
    }
    return true;
  } catch (err) {
    for (const key of committedKeys) {
      try {
        const previousVal = originalRawSnapshot.get(key);
        if (previousVal === null || previousVal === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, previousVal);
        }
      } catch {
        // best-effort rollback
      }
    }
    throw new Error(
      `Failed to encrypt local storage atomically (${err?.message || err}). Rolled back changes.`,
    );
  }
}

/**
 * Two-phase atomic decryption of all encrypted sensitive records back to plaintext JSON.
 * Rolls back all keys if any decryption or localStorage write fails.
 */
export async function decryptAllSensitiveData(sessionKey = activeSessionKey) {
  if (!sessionKey) return false;
  const originalRawSnapshot = new Map();
  const stagedPlaintextWrites = new Map();

  for (const key of SENSITIVE_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    originalRawSnapshot.set(key, raw);
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.format === ENCRYPTED_STORAGE_FORMAT
    ) {
      const decrypted = await decryptData(parsed, sessionKey);
      stagedPlaintextWrites.set(key, JSON.stringify(decrypted));
    }
  }

  const committedKeys = [];
  try {
    for (const [key, plainJson] of stagedPlaintextWrites.entries()) {
      localStorage.setItem(key, plainJson);
      committedKeys.push(key);
    }
    return true;
  } catch (err) {
    for (const key of committedKeys) {
      try {
        const previousVal = originalRawSnapshot.get(key);
        if (previousVal === null || previousVal === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, previousVal);
        }
      } catch {
        // best-effort rollback
      }
    }
    throw new Error(
      `Failed to decrypt local storage atomically (${err?.message || err}). Rolled back changes.`,
    );
  }
}

/* ───────────── App Lock PIN Management (On-Device Screen Lock) ───────────── */
export async function setAppPin(pin) {
  if (!pin || typeof pin !== "string" || pin.length < 4) {
    throw new Error("PIN must be at least 4 digits");
  }
  ensureSubtleCrypto();

  const oldSessionKey = activeSessionKey;
  const iterations = HARDENED_PBKDF2_ITERATIONS;
  const salt = getRandomBytes(16);
  const dataSalt = getRandomBytes(16);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const { key: sessionKey } = await deriveEncryptionKey(
    pin,
    dataSalt,
    iterations,
  );

  // Encrypt all sensitive keys FIRST before overwriting PIN/salt metadata in localStorage
  // so a failure never leaves storage in a partial encryption state.
  await encryptAllSensitiveData(sessionKey, oldSessionKey);

  localStorage.setItem(PIN_STORAGE_KEY, bufferToBase64(hashBuffer));
  localStorage.setItem(PIN_SALT_KEY, bufferToBase64(salt));
  localStorage.setItem(PIN_ITERATIONS_KEY, String(iterations));
  localStorage.setItem(DATA_SALT_KEY, bufferToBase64(dataSalt));
  resetPinFailures();

  setSessionKey(sessionKey);
  setSessionUnlocked(true);
  markActive();

  if (hasBiometricsConfigured()) {
    await persistBiometricSessionKey(sessionKey);
  }

  return true;
}

export async function verifyAppPin(pin) {
  if (getPinLockoutRemainingSeconds() > 0) {
    return false;
  }
  if (!pin || typeof pin !== "string") {
    recordPinFailure();
    return false;
  }

  const storedHash = localStorage.getItem(PIN_STORAGE_KEY);
  const storedSalt = localStorage.getItem(PIN_SALT_KEY);
  if (!storedHash || !storedSalt) return false;

  ensureSubtleCrypto();
  const iterations = getStoredPbkdf2Iterations();
  const salt = new Uint8Array(base64ToBuffer(storedSalt));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const computedHash = bufferToBase64(hashBuffer);
  if (constantTimeEqual(computedHash, storedHash)) {
    resetPinFailures();

    const dataSaltStr = localStorage.getItem(DATA_SALT_KEY);
    let dataSalt;
    if (dataSaltStr) {
      dataSalt = new Uint8Array(base64ToBuffer(dataSaltStr));
    } else {
      dataSalt = getRandomBytes(16);
      localStorage.setItem(DATA_SALT_KEY, bufferToBase64(dataSalt));
    }

    const { key: sessionKey } = await deriveEncryptionKey(
      pin,
      dataSalt,
      iterations,
    );
    setSessionKey(sessionKey);
    setSessionUnlocked(true);
    markActive();

    if (hasBiometricsConfigured()) {
      await persistBiometricSessionKey(sessionKey);
    }

    return true;
  }
  recordPinFailure();
  return false;
}

export function hasAppPin() {
  try {
    return Boolean(
      localStorage.getItem(PIN_STORAGE_KEY) &&
        localStorage.getItem(PIN_SALT_KEY),
    );
  } catch {
    return false;
  }
}

/**
 * Removes App PIN when the user is already authenticated/unlocked (e.g. Settings -> Turn Off).
 * Atomically decrypts all encrypted records back to standard localStorage using the active session key.
 */
export async function removeAppPin() {
  if (!isSessionUnlocked() || !activeSessionKey) {
    throw new Error("App must be unlocked before turning off the PIN.");
  }

  await decryptAllSensitiveData(activeSessionKey);

  localStorage.removeItem(PIN_STORAGE_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(PIN_ITERATIONS_KEY);
  localStorage.removeItem(DATA_SALT_KEY);
  localStorage.removeItem(BIOMETRIC_KEY_ID);
  clearBackgroundedAt();
  await clearPersistedBiometricKey();
  resetPinFailures();
  setSessionKey(null);
  setSessionUnlocked(true);
}

/**
 * Resets a forgotten App PIN from the lock screen without knowing the PIN.
 * Never decrypts data: wipes locally encrypted sensitive records so an attacker
 * cannot bypass the lock screen to read encrypted financial data.
 */
export async function resetForgottenPin() {
  for (const key of SENSITIVE_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  localStorage.removeItem(PIN_STORAGE_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(PIN_ITERATIONS_KEY);
  localStorage.removeItem(DATA_SALT_KEY);
  localStorage.removeItem(BIOMETRIC_KEY_ID);
  clearBackgroundedAt();
  await clearPersistedBiometricKey();
  resetPinFailures();
  setSessionKey(null);
  setSessionUnlocked(true);
}

/* ───────────── Biometric Authentication (WebAuthn & Native Keystore/Keychain) ───────────── */
export async function isBiometricsAvailable() {
  if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
    const capPlugins = window.Capacitor?.Plugins;
    if (capPlugins?.NativeBiometric || capPlugins?.BiometricAuth) {
      return true;
    }
  }
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    typeof window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasBiometricsConfigured() {
  try {
    const raw = localStorage.getItem(BIOMETRIC_KEY_ID);
    if (!raw) return false;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.rpId &&
        typeof window !== "undefined" &&
        window.location?.hostname &&
        parsed.rpId !== window.location.hostname
      ) {
        return false;
      }
      return Boolean(parsed?.id);
    }
    return true;
  } catch {
    return false;
  }
}

export async function enableBiometrics(currentPin) {
  try {
    if (currentPin) {
      const verified = await verifyAppPin(currentPin);
      if (!verified) return false;
    } else if (!hasAppPin() || !activeSessionKey) {
      return false;
    }

    const capPlugins =
      typeof window !== "undefined" ? window.Capacitor?.Plugins : null;
    const isNativeBiometricAvailable =
      typeof window !== "undefined" &&
      window.Capacitor?.isNativePlatform?.() &&
      Boolean(capPlugins?.NativeBiometric || capPlugins?.BiometricAuth);

    if (isNativeBiometricAvailable) {
      localStorage.setItem(BIOMETRIC_KEY_ID, "native-biometric");
      await persistBiometricSessionKey(activeSessionKey);
      return true;
    }

    const challenge = getRandomBytes(32);
    const userId = getRandomBytes(16);
    const rpId =
      typeof window !== "undefined" && window.location?.hostname
        ? window.location.hostname
        : undefined;

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "Spend Expense Tracker",
          ...(rpId ? { id: rpId } : {}),
        },
        user: {
          id: userId,
          name: "spend_user",
          displayName: "Spend User",
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60000,
      },
    });

    if (credential && credential.rawId) {
      const storedMeta = JSON.stringify({
        id: bufferToBase64(credential.rawId),
        rpId: rpId || "",
      });
      localStorage.setItem(BIOMETRIC_KEY_ID, storedMeta);
      await persistBiometricSessionKey(activeSessionKey);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function disableBiometrics() {
  try {
    localStorage.removeItem(BIOMETRIC_KEY_ID);
  } catch {
    // ignore
  }
  await clearPersistedBiometricKey();
}

export async function authenticateWithBiometrics() {
  try {
    const rawStored = localStorage.getItem(BIOMETRIC_KEY_ID);
    if (!rawStored) return { ok: false, reason: "not_configured" };

    let credentialId = rawStored;
    let storedRpId = "";
    if (rawStored.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawStored);
        credentialId = parsed?.id || "";
        storedRpId = parsed?.rpId || "";
      } catch {
        credentialId = "";
      }
    }
    if (!credentialId) return { ok: false, reason: "not_configured" };

    const currentRpId =
      typeof window !== "undefined" && window.location?.hostname
        ? window.location.hostname
        : "";
    if (storedRpId && currentRpId && storedRpId !== currentRpId) {
      return { ok: false, reason: "origin_mismatch" };
    }

    const capPlugins =
      typeof window !== "undefined" ? window.Capacitor?.Plugins : null;
    const isNative =
      typeof window !== "undefined" &&
      window.Capacitor?.isNativePlatform?.() &&
      credentialId === "native-biometric";

    let restoredKey = biometricCachedKey;
    if (!restoredKey) {
      restoredKey = await loadNonExtractableBiometricKey();
    }
    if (!restoredKey && NativeSecureStorage.isAvailable()) {
      const storedKeyB64 = await NativeSecureStorage.getItem(
        BIOMETRIC_KEY_STORAGE,
      );
      if (storedKeyB64) {
        const keyBuffer = base64ToBuffer(storedKeyB64);
        restoredKey = await crypto.subtle.importKey(
          "raw",
          keyBuffer,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
      }
    }
    if (!restoredKey) {
      return { ok: false, reason: "key_missing" };
    }

    let verifiedByAuthenticator = false;

    if (isNative) {
      if (capPlugins?.NativeBiometric?.verifyIdentity) {
        await capPlugins.NativeBiometric.verifyIdentity({
          reason: "Unlock Spend",
          title: "Biometric Unlock",
        });
        verifiedByAuthenticator = true;
      } else if (capPlugins?.BiometricAuth?.authenticate) {
        await capPlugins.BiometricAuth.authenticate({
          reason: "Unlock Spend",
        });
        verifiedByAuthenticator = true;
      } else {
        return { ok: false, reason: "not_configured" };
      }
    } else {
      if (credentialId === "native-biometric") {
        return { ok: false, reason: "invalid_credential" };
      }
      const challenge = getRandomBytes(32);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          ...(currentRpId ? { rpId: currentRpId } : {}),
          allowCredentials: [
            {
              id: new Uint8Array(base64ToBuffer(credentialId)),
              type: "public-key",
              transports: ["internal"],
            },
          ],
          userVerification: "required",
          timeout: 60000,
        },
      });
      verifiedByAuthenticator = Boolean(assertion);
    }

    if (!verifiedByAuthenticator) {
      return { ok: false, reason: "auth_failed" };
    }

    biometricCachedKey = restoredKey;
    setSessionKey(restoredKey);
    setSessionUnlocked(true);
    markActive();
    return true;
  } catch (err) {
    const errName = err?.name || "";
    if (
      errName === "NotAllowedError" ||
      errName === "AbortError" ||
      errName === "SecurityError" ||
      errName === "InvalidStateError"
    ) {
      return { ok: false, reason: "not_allowed" };
    }
    return { ok: false, reason: "error", error: err };
  }
}

/* ───────────── Session & Auto-Lock Lifecycle ───────────── */
let inMemoryBackgroundedAt = null;

function setBackgroundedAt(timestamp) {
  inMemoryBackgroundedAt = timestamp;
  try {
    if (timestamp != null) {
      sessionStorage.setItem(BACKGROUNDED_AT_KEY, String(timestamp));
    } else {
      sessionStorage.removeItem(BACKGROUNDED_AT_KEY);
    }
  } catch {
    // ignore
  }
}

function getBackgroundedAt() {
  if (inMemoryBackgroundedAt != null) return inMemoryBackgroundedAt;
  try {
    const val = sessionStorage.getItem(BACKGROUNDED_AT_KEY);
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

function clearBackgroundedAt() {
  inMemoryBackgroundedAt = null;
  try {
    sessionStorage.removeItem(BACKGROUNDED_AT_KEY);
  } catch {
    // ignore
  }
}

export function getLockTimeoutMinutes() {
  try {
    const val = localStorage.getItem(LOCK_TIMEOUT_KEY);
    if (val === "0" || val === "1" || val === "5") return Number(val);
  } catch {
    // ignore
  }
  return 1; // Default: 1 minute
}

export function setLockTimeoutMinutes(minutes) {
  try {
    localStorage.setItem(LOCK_TIMEOUT_KEY, String(minutes));
  } catch {
    // ignore
  }
  markActive();
}

export function markActive() {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  clearBackgroundedAt();
}

export function markBackgrounded() {
  if (!hasAppPin() || !isSessionUnlocked()) return;
  const timeoutMinutes = getLockTimeoutMinutes();
  setBackgroundedAt(Date.now());
  if (timeoutMinutes === 0) {
    lockRuntimeSession();
  }
}

export function shouldLockApp() {
  if (!hasAppPin()) return false;
  if (!isSessionUnlocked()) return true;

  const timeoutMinutes = getLockTimeoutMinutes();
  const backgroundedAt = getBackgroundedAt();

  if (backgroundedAt != null) {
    const elapsedMinutes = (Date.now() - backgroundedAt) / 60000;
    if (timeoutMinutes === 0 || elapsedMinutes >= timeoutMinutes) {
      lockRuntimeSession();
      clearBackgroundedAt();
      return true;
    }
    clearBackgroundedAt();
    markActive();
    return false;
  }

  if (timeoutMinutes === 0) {
    return false;
  }

  let lastActive = 0;
  try {
    lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0;
  } catch {
    lastActive = 0;
  }
  const elapsedMinutes = (Date.now() - lastActive) / 60000;
  if (elapsedMinutes >= timeoutMinutes) {
    lockRuntimeSession();
    return true;
  }

  return false;
}

export function lockAppManually() {
  if (hasAppPin()) {
    lockRuntimeSession();
    clearBackgroundedAt();
  }
}

/* ───────────── AES-256-GCM Backup Encryption ───────────── */
export async function encryptBackup(plainData, password) {
  if (!password || typeof password !== "string") {
    throw new Error("A password is required to encrypt the backup.");
  }
  ensureSubtleCrypto();

  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12); // Standard 96-bit IV for AES-GCM
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: HARDENED_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const exportedAt = new Date().toISOString();
  const format = "spend-encrypted-backup";
  const version = 1;

  const additionalData = encoder.encode(
    JSON.stringify({ format, version, exportedAt }),
  );

  const plaintextBytes = encoder.encode(JSON.stringify(plainData));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    aesKey,
    plaintextBytes,
  );

  return {
    format,
    version,
    iterations: HARDENED_PBKDF2_ITERATIONS,
    exportedAt,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertextBuffer),
  };
}

export async function decryptBackup(encryptedPayload, password) {
  if (!password || typeof password !== "string") {
    throw new Error("Password is required to decrypt backup.");
  }
  if (
    !encryptedPayload ||
    encryptedPayload.format !== "spend-encrypted-backup" ||
    !encryptedPayload.salt ||
    !encryptedPayload.iv ||
    !encryptedPayload.ciphertext
  ) {
    throw new Error("Invalid encrypted backup format.");
  }

  ensureSubtleCrypto();
  const salt = new Uint8Array(base64ToBuffer(encryptedPayload.salt));
  const iv = new Uint8Array(base64ToBuffer(encryptedPayload.iv));
  const ciphertext = base64ToBuffer(encryptedPayload.ciphertext);
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const candidateIterations = Array.from(
    new Set(
      [
        Number(encryptedPayload.iterations),
        HARDENED_PBKDF2_ITERATIONS,
        DEFAULT_LEGACY_PBKDF2_ITERATIONS,
      ].filter((n) => Number.isInteger(n) && n >= 10000),
    ),
  );

  const additionalData = encoder.encode(
    JSON.stringify({
      format: encryptedPayload.format,
      version: encryptedPayload.version ?? 1,
      exportedAt: encryptedPayload.exportedAt,
    }),
  );

  for (const iterations of candidateIterations) {
    const aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData },
        aesKey,
        ciphertext,
      );
      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decryptedBuffer));
    } catch {
      try {
        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          aesKey,
          ciphertext,
        );
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(decryptedBuffer));
      } catch {
        // Try next iteration count if applicable
      }
    }
  }

  throw new Error("Incorrect password or corrupted encrypted backup.");
}
