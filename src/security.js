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
const LOCK_TIMEOUT_KEY = "spend-lock-timeout-v1";
const LAST_ACTIVE_KEY = "spend-last-active-v1";
const SESSION_UNLOCKED_KEY = "spend-session-unlocked-v1";

function isSessionUnlocked() {
  try {
    return sessionStorage.getItem(SESSION_UNLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

function setSessionUnlocked(unlocked) {
  try {
    if (unlocked) {
      sessionStorage.setItem(SESSION_UNLOCKED_KEY, "1");
    } else {
      sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
    }
  } catch {
    // ignore
  }
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

/* ───────────── App Lock PIN Management (On-Device Screen Lock) ───────────── */
export async function setAppPin(pin) {
  if (!pin || pin.length < 4) {
    throw new Error("PIN must be at least 4 digits");
  }
  ensureSubtleCrypto();
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

  setSessionUnlocked(true);
  markActive();
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
    setSessionUnlocked(true);
    markActive();
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

export function removeAppPin() {
  localStorage.removeItem(PIN_STORAGE_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(BIOMETRIC_KEY_ID);
  resetPinFailures();
  setSessionUnlocked(true);
}

/* ───────────── Biometric Authentication (WebAuthn) ───────────── */
export async function isBiometricsAvailable() {
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
    } else if (!hasAppPin()) {
      return false;
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

export function disableBiometrics() {
  localStorage.removeItem(BIOMETRIC_KEY_ID);
}

export async function authenticateWithBiometrics() {
  try {
    const credentialId = localStorage.getItem(BIOMETRIC_KEY_ID);
    if (!credentialId) return false;

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
      setSessionUnlocked(true);
      markActive();
      return true;
    }
    return false;
  } catch {
    return false;
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
    return true;
  }
  return false;
}

export function lockAppManually() {
  if (hasAppPin()) {
    setSessionUnlocked(false);
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
