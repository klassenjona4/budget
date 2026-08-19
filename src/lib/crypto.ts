/**
 * All cryptography for the app. Web Crypto only, no third party library.
 * Nothing outside this module may call crypto.subtle.
 *
 * Key hierarchy:
 *   DEK                 random 32 bytes, AES-GCM 256, created once at setup
 *    +- wrapped by KEK_pin   PBKDF2-SHA256(pin, salt_pin, 600000) -> 256 bit
 *    +- wrapped by KEK_bio   HKDF-SHA256(prfOutput, salt_bio, info) -> 256 bit
 */

/** Ciphertext plus the random 96 bit nonce it was produced with. */
export type Sealed = {
  iv: Uint8Array;
  ct: Uint8Array;
};

/** PBKDF2 work factor for the PIN and for backup passphrases. */
export const PBKDF2_ITERATIONS = 600_000;

/** HKDF info string, bumped if the wrapping scheme ever changes. */
const HKDF_INFO = "budget-dek-wrap-v1";

const IV_LENGTH = 12; // AES-GCM standard nonce length in bytes
const SALT_LENGTH = 16;
const DEK_LENGTH = 32; // 256 bit
export const PRF_SALT_LENGTH = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Cryptographically strong random bytes from the platform CSPRNG. */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Random 128 bit identifier, formatted as a UUID v4 string. */
export function newId(): string {
  return crypto.randomUUID();
}

export function newIv(): Uint8Array {
  return randomBytes(IV_LENGTH);
}

export function newSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

/** Overwrites a byte buffer in place. Best effort, the GC may still hold copies. */
export function zero(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** Constant time comparison, used for confirmation fields rather than secrets at rest. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/** Random 256 bit data encryption key, returned as raw bytes so it can be wrapped. */
export function generateDekBytes(): Uint8Array {
  return randomBytes(DEK_LENGTH);
}

/**
 * Imports raw DEK bytes as a non extractable AES-GCM 256 key.
 * The result can encrypt and decrypt but its bytes can never be read back.
 */
export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * PBKDF2-SHA256, 600000 iterations, 16 byte salt, 256 bit output.
 * Used to turn the 6 digit PIN into a key encryption key.
 */
export async function deriveKekFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    asBuffer(textEncoder.encode(pin)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    DEK_LENGTH * 8,
  );
  return importKek(new Uint8Array(bits));
}

/**
 * PBKDF2-SHA256, 600000 iterations, 16 byte salt, 256 bit output.
 * Used for encrypted backup files, which carry their own fresh salt.
 */
export async function deriveKekFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    asBuffer(textEncoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBuffer(salt), iterations, hash: "SHA-256" },
    material,
    DEK_LENGTH * 8,
  );
  return importKek(new Uint8Array(bits));
}

/**
 * HKDF-SHA256 over the WebAuthn PRF output, 16 byte salt,
 * info "budget-dek-wrap-v1", 256 bit output.
 */
export async function deriveKekFromPrf(
  prfOutput: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", asBuffer(prfOutput), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBuffer(salt),
      info: asBuffer(textEncoder.encode(HKDF_INFO)),
    },
    material,
    DEK_LENGTH * 8,
  );
  return importKek(new Uint8Array(bits));
}

/** Imports 32 raw bytes as a non extractable AES-GCM 256 key encryption key. */
export async function importKek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** AES-GCM 256 with a fresh random 12 byte IV. Wraps the raw DEK under a KEK. */
export async function wrapDek(kek: CryptoKey, dekRaw: Uint8Array): Promise<Sealed> {
  const iv = newIv();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, kek, asBuffer(dekRaw));
  return { iv, ct: new Uint8Array(ct) };
}

/**
 * AES-GCM 256 decrypt of a wrapped DEK. Throws if the KEK is wrong,
 * which is how a wrong PIN is detected: the GCM tag fails to verify.
 */
export async function unwrapDek(kek: CryptoKey, sealed: Sealed): Promise<Uint8Array> {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(sealed.iv) },
    kek,
    asBuffer(sealed.ct),
  );
  return new Uint8Array(raw);
}

/** AES-GCM 256 with a fresh random 12 byte IV over UTF-8 JSON. */
export async function encryptJson(dek: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = newIv();
  const plaintext = textEncoder.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    dek,
    asBuffer(plaintext),
  );
  zero(plaintext);
  return { iv, ct: new Uint8Array(ct) };
}

/** AES-GCM 256 decrypt, then UTF-8 JSON parse. Throws on a tag mismatch. */
export async function decryptJson<T>(dek: CryptoKey, sealed: Sealed): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(sealed.iv) },
    dek,
    asBuffer(sealed.ct),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as T;
}

/** AES-GCM 256 over an arbitrary UTF-8 string, used for backup files. */
export async function encryptText(key: CryptoKey, text: string): Promise<Sealed> {
  const iv = newIv();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(textEncoder.encode(text)),
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** AES-GCM 256 decrypt back to a UTF-8 string. Throws on a tag mismatch. */
export async function decryptText(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(sealed.iv) },
    key,
    asBuffer(sealed.ct),
  );
  return textDecoder.decode(plaintext);
}
