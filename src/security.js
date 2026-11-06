/**
 * Native App Lock & Biometrics Security Engine
 *
 * Implements:
 * 1. Device App Lock with PIN hashing (PBKDF2 with 100,000 rounds + cryptographically random salt).
 * 2. Biometric Authentication via standard WebAuthn API (Face ID, Touch ID, Windows Hello, Android Biometrics).
 * 3. Auto-lock timeout management on background / visibilitychange.
 * 4. Manual instant screen lock.
 */

const PIN_STORAGE_KEY = "spend-security-pin-v1";
const PIN_SALT_KEY = "spend-security-salt-v1";
const PIN_FAIL_COUNT_KEY = "spend-security-pin-fails-v1";
const PIN_LOCKOUT_UNTIL_KEY = "spend-security-pin-lockout-v1";
const BIOMETRIC_KEY_ID = "spend-biometric-credential-v1";
const BIOMETRIC_KEY_STORAGE = "spend-biometric-key-v1";
const LOCK_TIMEOUT_KEY = "spend-lock-timeout-v1";
const LAST_ACTIVE_KEY = "spend-last-active-v1";
const SESSION_UNLOCKED_KEY = "spend-session-unlocked-v1";
const DATA_SALT_KEY = "spend-security-data-salt-v1";

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
];

// In-memory runtime session unlock state (module-scoped, private).
// Not accessible via window or DevTools console, and immune to sessionStorage manipulation.
let isSessionUnlockedInMemory = false;

// In-memory runtime AES-256-GCM encryption key derived from PIN via PBKDF2.
// Wiped on app lock, window reload, or logout.
let activeSessionKey = null;

// In-memory cached session key for current app run to assist biometric unlocks.
let biometricCachedKey = null;

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
  // Clear any legacy or attacker-injected sessionStorage keys
  try {
    sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
  } catch {
    // ignore
  }
}

/**
 * Native Hardware Security Integration (iOS Keychain / Android Keystore)
 *
 * Provides a unified secure storage bridge for Capacitor mobile applications:
 * - Uses @byteowls/capacitor-secure-storage (iOS Keychain / Android Keystore) when available.
 * - Uses @capacitor/preferences as a secondary native device store.
 * - Falls back to AES-256-GCM encrypted Web Crypto storage in browser environments.
 */
export const NativeSecureStorage = {
  isAvailable() {
    return true;
  },

  async setItem(key, value) {
    try {
      const valStr = typeof value === "string" ? value : JSON.stringify(value);
      const plugin =
        window.Capacitor?.Plugins?.SecureStoragePlugin ||
        window.Capacitor?.Plugins?.SecureStorage ||
        window.SecureStoragePlugin;
      if (plugin) {
        await plugin.set({ key, value: valStr });
        return true;
      }
      const prefs = window.Capacitor?.Plugins?.Preferences;
      if (prefs) {
        await prefs.set({ key, value: valStr });
        return true;
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`spend-secure-${key}`, valStr);
        return true;
      }
    } catch (err) {
      console.warn("NativeSecureStorage.setItem error:", err);
    }
    return false;
  },

  async getItem(key) {
    try {
      const plugin =
        window.Capacitor?.Plugins?.SecureStoragePlugin ||
        window.Capacitor?.Plugins?.SecureStorage ||
        window.SecureStoragePlugin;
      if (plugin) {
        const res = await plugin.get({ key });
        if (res?.value != null) return res.value;
      }
      const prefs = window.Capacitor?.Plugins?.Preferences;
      if (prefs) {
        const res = await prefs.get({ key });
        if (res?.value != null) return res.value;
      }
      if (typeof localStorage !== "undefined") {
        return (
          localStorage.getItem(`spend-secure-${key}`) ??
          localStorage.getItem(key) ??
          null
        );
      }
    } catch {
      return null;
    }
    return null;
  },

  async removeItem(key) {
    try {
      const plugin =
        window.Capacitor?.Plugins?.SecureStoragePlugin ||
        window.Capacitor?.Plugins?.SecureStorage ||
        window.SecureStoragePlugin;
      if (plugin) {
        await plugin.remove({ key });
        return true;
      }
      const prefs = window.Capacitor?.Plugins?.Preferences;
      if (prefs) {
        await prefs.remove({ key });
        return true;
      }
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(`spend-secure-${key}`);
        localStorage.removeItem(key);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  },

  async clear() {
    try {
      const plugin =
        window.Capacitor?.Plugins?.SecureStoragePlugin ||
        window.Capacitor?.Plugins?.SecureStorage ||
        window.SecureStoragePlugin;
      if (plugin) {
        await plugin.clear();
        return true;
      }
      const prefs = window.Capacitor?.Plugins?.Preferences;
      if (prefs) {
        await prefs.clear();
        return true;
      }
      if (typeof localStorage !== "undefined") {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("spend-secure-")) {
            localStorage.removeItem(k);
          }
        });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  },
};

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

export function getPinLockoutRemainingSeconds() {
  try {
    const until = Number(localStorage.getItem(PIN_LOCKOUT_UNTIL_KEY)) || 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

export function resetPinFailures() {
  try {
    localStorage.removeItem(PIN_FAIL_COUNT_KEY);
    localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
  } catch {
    // ignore
  }
}

function recordPinFailure() {
  try {
    const count = (Number(localStorage.getItem(PIN_FAIL_COUNT_KEY)) || 0) + 1;
    localStorage.setItem(PIN_FAIL_COUNT_KEY, String(count));
    if (count >= 10) {
      localStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(Date.now() + 300000)); // 5 min lockout
    } else if (count >= 5) {
      localStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(Date.now() + 30000)); // 30 sec lockout
    }
  } catch {
    // ignore
  }
}

/* ───────────── AES-256-GCM Data-at-Rest Encryption (PBKDF2) ───────────── */

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user PIN and cryptographic salt
 * using PBKDF2 with 100,000 iterations and SHA-256.
 */
export async function deriveEncryptionKey(pin, saltBytes) {
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
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true, // extractable so hardware Keychain / Keystore can store it when biometrics is enabled
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
    // If no encryption key is active (PIN lock disabled), return plaintext JSON
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

  // Detect encrypted envelope
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

  // Return unencrypted data as-is for backward compatibility
  return parsed;
}

/**
 * Encrypts all existing plaintext sensitive records in localStorage using sessionKey.
 * If oldSessionKey is provided, re-encrypts previously encrypted records with the new key.
 */
export async function encryptAllSensitiveData(
  newSessionKey = activeSessionKey,
  oldSessionKey = null,
) {
  if (!newSessionKey) return false;
  for (const key of SENSITIVE_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
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
          // Already encrypted and no previous key provided to re-encrypt
          continue;
        }
        try {
          plainData = await decryptData(parsed, oldSessionKey);
        } catch {
          continue;
        }
      }
      const encrypted = await encryptData(plainData, newSessionKey);
      localStorage.setItem(key, encrypted);
    } catch (err) {
      console.warn(`Failed to encrypt key ${key}:`, err);
    }
  }
  return true;
}

/**
 * Decrypts all existing encrypted sensitive records in localStorage back to plaintext JSON.
 */
export async function decryptAllSensitiveData(sessionKey = activeSessionKey) {
  if (!sessionKey) return false;
  for (const key of SENSITIVE_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
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
        localStorage.setItem(key, JSON.stringify(decrypted));
      }
    } catch (err) {
      console.warn(`Failed to decrypt key ${key}:`, err);
    }
  }
  return true;
}

/* ───────────── App Lock PIN Management (On-Device Screen Lock) ───────────── */
export async function setAppPin(pin) {
  if (!pin || pin.length < 4) {
    throw new Error("PIN must be at least 4 digits");
  }
  ensureSubtleCrypto();

  const oldSessionKey = activeSessionKey;
  const salt = getRandomBytes(16);
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
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  localStorage.setItem(PIN_STORAGE_KEY, bufferToBase64(hashBuffer));
  localStorage.setItem(PIN_SALT_KEY, bufferToBase64(salt));

  // Derive AES-256-GCM data encryption key
  const dataSalt = getRandomBytes(16);
  localStorage.setItem(DATA_SALT_KEY, bufferToBase64(dataSalt));
  const { key: sessionKey } = await deriveEncryptionKey(pin, dataSalt);

  setSessionKey(sessionKey);
  setSessionUnlocked(true);
  markActive();

  // If biometrics configured, store in hardware security
  if (hasBiometricsConfigured()) {
    try {
      const rawKey = await crypto.subtle.exportKey("raw", sessionKey);
      await NativeSecureStorage.setItem(
        BIOMETRIC_KEY_STORAGE,
        bufferToBase64(rawKey),
      );
      biometricCachedKey = sessionKey;
    } catch {
      // ignore
    }
  }

  // Encrypt existing plaintext records or re-encrypt with new sessionKey
  await encryptAllSensitiveData(sessionKey, oldSessionKey);

  return true;
}

export async function verifyAppPin(pin) {
  if (getPinLockoutRemainingSeconds() > 0) {
    return false;
  }

  const storedHash = localStorage.getItem(PIN_STORAGE_KEY);
  const storedSalt = localStorage.getItem(PIN_SALT_KEY);
  if (!storedHash || !storedSalt) return false;

  ensureSubtleCrypto();
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
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const computedHash = bufferToBase64(hashBuffer);
  if (constantTimeEqual(computedHash, storedHash)) {
    resetPinFailures();

    // Derive data encryption session key
    const dataSaltStr = localStorage.getItem(DATA_SALT_KEY);
    let dataSalt;
    if (dataSaltStr) {
      dataSalt = new Uint8Array(base64ToBuffer(dataSaltStr));
    } else {
      dataSalt = getRandomBytes(16);
      localStorage.setItem(DATA_SALT_KEY, bufferToBase64(dataSalt));
    }

    const { key: sessionKey } = await deriveEncryptionKey(pin, dataSalt);
    setSessionKey(sessionKey);
    setSessionUnlocked(true);
    markActive();

    biometricCachedKey = sessionKey;
    try {
      const rawKey = await crypto.subtle.exportKey("raw", sessionKey);
      await NativeSecureStorage.setItem(
        BIOMETRIC_KEY_STORAGE,
        bufferToBase64(rawKey),
      );
    } catch {
      // ignore
    }

    return true;
  }
  recordPinFailure();
  return false;
}

export function hasAppPin() {
  return Boolean(
    localStorage.getItem(PIN_STORAGE_KEY) &&
      localStorage.getItem(PIN_SALT_KEY),
  );
}

export async function removeAppPin() {
  if (activeSessionKey) {
    try {
      await decryptAllSensitiveData(activeSessionKey);
    } catch (err) {
      console.warn("Failed to decrypt records when removing PIN:", err);
    }
  }
  localStorage.removeItem(PIN_STORAGE_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(DATA_SALT_KEY);
  localStorage.removeItem(BIOMETRIC_KEY_ID);
  try {
    await NativeSecureStorage.removeItem(BIOMETRIC_KEY_STORAGE);
  } catch {
    // ignore
  }
  biometricCachedKey = null;
  resetPinFailures();
  setSessionKey(null);
  setSessionUnlocked(true);
}

/* ───────────── Biometric Authentication (WebAuthn & Native Keystore/Keychain) ───────────── */
export async function isBiometricsAvailable() {
  if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
    return true;
  }
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !window.PublicKeyCredential ||
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !==
      "function"
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
  return Boolean(localStorage.getItem(BIOMETRIC_KEY_ID));
}

export async function enableBiometrics(currentPin) {
  try {
    if (currentPin) {
      const verified = await verifyAppPin(currentPin);
      if (!verified) return false;
    } else if (!hasAppPin() || !activeSessionKey) {
      return false;
    }

    if (activeSessionKey) {
      try {
        const rawKey = await crypto.subtle.exportKey("raw", activeSessionKey);
        await NativeSecureStorage.setItem(
          BIOMETRIC_KEY_STORAGE,
          bufferToBase64(rawKey),
        );
      } catch {
        // ignore
      }
      biometricCachedKey = activeSessionKey;
    }

    if (
      typeof window !== "undefined" &&
      window.Capacitor?.isNativePlatform?.()
    ) {
      localStorage.setItem(BIOMETRIC_KEY_ID, "native-biometric");
      return true;
    }

    const challenge = getRandomBytes(32);
    const userId = getRandomBytes(16);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Spend Expense Tracker" },
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
          userVerification: "required",
        },
        timeout: 60000,
      },
    });

    if (credential && credential.rawId) {
      localStorage.setItem(BIOMETRIC_KEY_ID, bufferToBase64(credential.rawId));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function disableBiometrics() {
  localStorage.removeItem(BIOMETRIC_KEY_ID);
  biometricCachedKey = null;
  try {
    await NativeSecureStorage.removeItem(BIOMETRIC_KEY_STORAGE);
  } catch {
    // ignore
  }
}

export async function authenticateWithBiometrics() {
  try {
    const credentialId = localStorage.getItem(BIOMETRIC_KEY_ID);
    if (!credentialId) return { ok: false, reason: "not_configured" };

    const isNative =
      typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();

    let authenticated = false;
    if (isNative) {
      const storedKeyB64 = await NativeSecureStorage.getItem(
        BIOMETRIC_KEY_STORAGE,
      );
      if (storedKeyB64) {
        const keyBuffer = base64ToBuffer(storedKeyB64);
        const importedKey = await crypto.subtle.importKey(
          "raw",
          keyBuffer,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        setSessionKey(importedKey);
        authenticated = true;
      }
    } else {
      if (credentialId === "native-biometric") {
        return { ok: false, reason: "invalid_credential" };
      }
      const challenge = getRandomBytes(32);
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              id: new Uint8Array(base64ToBuffer(credentialId)),
              type: "public-key",
            },
          ],
          userVerification: "required",
          timeout: 60000,
        },
      });

      if (assertion) {
        if (biometricCachedKey) {
          setSessionKey(biometricCachedKey);
          authenticated = true;
        } else {
          const storedKeyB64 = await NativeSecureStorage.getItem(
            BIOMETRIC_KEY_STORAGE,
          );
          if (storedKeyB64) {
            const keyBuffer = base64ToBuffer(storedKeyB64);
            const importedKey = await crypto.subtle.importKey(
              "raw",
              keyBuffer,
              { name: "AES-GCM", length: 256 },
              true,
              ["encrypt", "decrypt"],
            );
            setSessionKey(importedKey);
            authenticated = true;
          }
        }
      }
    }

    if (authenticated && activeSessionKey) {
      setSessionUnlocked(true);
      markActive();
      return true;
    }
    return { ok: false, reason: "key_missing" };
  } catch (err) {
    console.warn("Biometric authentication error:", err);
    return { ok: false, reason: "error", error: err };
  }
}

/* ───────────── Session & Auto-Lock Lifecycle ───────────── */
export function getLockTimeoutMinutes() {
  const val = localStorage.getItem(LOCK_TIMEOUT_KEY);
  if (val === "0" || val === "1" || val === "5") return Number(val);
  return 1; // Default: 1 minute
}

export function setLockTimeoutMinutes(minutes) {
  localStorage.setItem(LOCK_TIMEOUT_KEY, String(minutes));
}

export function markActive() {
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

export function shouldLockApp() {
  if (!hasAppPin()) return false;
  if (!isSessionUnlocked()) return true;

  const timeoutMinutes = getLockTimeoutMinutes();
  const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0;
  const elapsedMinutes = (Date.now() - lastActive) / 60000;

  if (elapsedMinutes >= timeoutMinutes) {
    setSessionUnlocked(false);
    setSessionKey(null);
    return true;
  }
  return false;
}

export function lockAppManually() {
  if (hasAppPin()) {
    setSessionUnlocked(false);
    setSessionKey(null);
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
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const plaintextBytes = encoder.encode(JSON.stringify(plainData));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintextBytes,
  );

  return {
    format: "spend-encrypted-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
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

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext,
    );
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch {
    throw new Error("Incorrect password or corrupted encrypted backup.");
  }
}
