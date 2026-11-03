/**
 * Zero-Knowledge Client-Side Encryption & Native App Lock Engine
 *
 * Implements:
 * 1. AES-GCM-256 authenticated encryption with PBKDF2 (100,000 rounds, SHA-256) key derivation.
 * 2. Device App Lock with PIN hashing (PBKDF2 + cryptographically random salt).
 * 3. Biometric Authentication via standard WebAuthn API (Face ID, Touch ID, Windows Hello, Android Biometrics).
 * 4. Auto-lock timeout management on background / visibilitychange.
 * 5. Dedicated End-to-End Cloud Encryption (decoupled from device-level 4-digit PIN).
 */

const PIN_STORAGE_KEY = "spend-security-pin-v1";
const PIN_SALT_KEY = "spend-security-salt-v1";
const BIOMETRIC_KEY_ID = "spend-biometric-credential-v1";
const LOCK_TIMEOUT_KEY = "spend-lock-timeout-v1";
const LAST_ACTIVE_KEY = "spend-last-active-v1";

// Dedicated End-to-End Cloud Encryption keys (distinct from 4-digit screen lock PIN)
const CLOUD_E2E_VERIFIER_KEY = "spend-cloud-e2e-verifier-v1";
const CLOUD_E2E_SALT_KEY = "spend-cloud-e2e-salt-v1";
const CLOUD_E2E_ENABLED_KEY = "spend-cloud-e2e-enabled-v1";

// In-memory runtime state
let cloudEncryptionPassphrase = null;
let isAppUnlockedInSession = false;

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

/* ───────────── PBKDF2 Key Derivation ───────────── */
export async function deriveKeyFromPassphrase(passphrase, saltBuffer) {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"],
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ───────────── AES-GCM-256 Encryption & Decryption ───────────── */
export async function encryptDataWithPassphrase(data, passphrase) {
  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12);
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  return {
    _encrypted: true,
    v: 1,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}

export async function decryptDataWithPassphrase(encryptedPayload, passphrase) {
  if (!encryptedPayload || !encryptedPayload._encrypted) {
    return encryptedPayload;
  }

  const salt = new Uint8Array(base64ToBuffer(encryptedPayload.salt));
  const iv = new Uint8Array(base64ToBuffer(encryptedPayload.iv));
  const ciphertext = base64ToBuffer(encryptedPayload.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const decoded = new TextDecoder().decode(decrypted);
  return JSON.parse(decoded);
}

/* ───────────── App Lock PIN Management (On-Device Screen Lock) ───────────── */
export async function setAppPin(pin) {
  if (!pin || pin.length < 4) {
    throw new Error("PIN must be at least 4 digits");
  }
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

  isAppUnlockedInSession = true;
  markActive();
  return true;
}

export async function verifyAppPin(pin) {
  const storedHash = localStorage.getItem(PIN_STORAGE_KEY);
  const storedSalt = localStorage.getItem(PIN_SALT_KEY);
  if (!storedHash || !storedSalt) return false;

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
  if (computedHash === storedHash) {
    isAppUnlockedInSession = true;
    markActive();
    return true;
  }
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
  isAppUnlockedInSession = true;
}

/* ───────────── End-to-End Cloud Sync Encryption (Optional) ───────────── */
export async function setCloudPassphrase(passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters");
  }
  const salt = getRandomBytes(16);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
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

  localStorage.setItem(CLOUD_E2E_VERIFIER_KEY, bufferToBase64(hashBuffer));
  localStorage.setItem(CLOUD_E2E_SALT_KEY, bufferToBase64(salt));
  localStorage.setItem(CLOUD_E2E_ENABLED_KEY, "true");
  cloudEncryptionPassphrase = passphrase;
  return true;
}

export async function verifyCloudPassphrase(passphrase) {
  const storedVerifier = localStorage.getItem(CLOUD_E2E_VERIFIER_KEY);
  const storedSalt = localStorage.getItem(CLOUD_E2E_SALT_KEY);
  if (!storedVerifier || !storedSalt) return false;

  const salt = new Uint8Array(base64ToBuffer(storedSalt));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
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

  const computed = bufferToBase64(hashBuffer);
  if (computed === storedVerifier) {
    cloudEncryptionPassphrase = passphrase;
    return true;
  }
  return false;
}

export function isCloudEncryptionEnabled() {
  return Boolean(
    localStorage.getItem(CLOUD_E2E_VERIFIER_KEY) &&
      localStorage.getItem(CLOUD_E2E_SALT_KEY) &&
      localStorage.getItem(CLOUD_E2E_ENABLED_KEY) === "true",
  );
}

export function getCloudEncryptionKey() {
  return cloudEncryptionPassphrase;
}

export function clearCloudEncryptionKey() {
  cloudEncryptionPassphrase = null;
}

export function disableCloudEncryption() {
  localStorage.removeItem(CLOUD_E2E_VERIFIER_KEY);
  localStorage.removeItem(CLOUD_E2E_SALT_KEY);
  localStorage.removeItem(CLOUD_E2E_ENABLED_KEY);
  cloudEncryptionPassphrase = null;
}

// Backward-compatible alias
export function getSessionKey() {
  return cloudEncryptionPassphrase;
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
      isAppUnlockedInSession = true;
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
  if (!isAppUnlockedInSession) return true;

  const timeoutMinutes = getLockTimeoutMinutes();
  const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0;
  const elapsedMinutes = (Date.now() - lastActive) / 60000;

  if (elapsedMinutes >= timeoutMinutes) {
    isAppUnlockedInSession = false;
    return true;
  }
  return false;
}

export function lockAppManually() {
  if (hasAppPin()) {
    isAppUnlockedInSession = false;
  }
}
