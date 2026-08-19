/**
 * Unlock logic: PIN path, biometric path, failure backoff, key rotation.
 * UI components go through this module, never through crypto.ts or db.ts
 * for anything to do with keys.
 */
import {
  deriveKekFromPin,
  deriveKekFromPrf,
  generateDekBytes,
  importDek,
  importKek,
  newSalt,
  PBKDF2_ITERATIONS,
  PRF_SALT_LENGTH,
  randomBytes,
  unwrapDek,
  wrapDek,
  zero,
} from "./crypto.ts";
import {
  NO_FAILURES,
  readFailureState,
  readVaultMeta,
  wipeDatabase,
  writeFailureState,
  writeVaultMeta,
  type BioKeyMaterial,
  type FailureState,
  type VaultMeta,
} from "./db.ts";

export type BiometricMode = "prf" | "gate";

export type VaultStatus = {
  initialised: boolean;
  biometric: BiometricMode | null;
};

export type Session = {
  dek: CryptoKey;
};

/** Attempts 1 to 4 are free, every further failure locks the keypad for longer. */
const BACKOFF_SECONDS = [5, 15, 60, 300] as const;
export const FREE_ATTEMPTS = 4;
const WIPE_THRESHOLD = 10;
const MAX_LOCK_MS = 300_000;

export class VaultLockedOutError extends Error {
  readonly retryAt: number;
  constructor(retryAt: number) {
    super("Too many failed attempts.");
    this.name = "VaultLockedOutError";
    this.retryAt = retryAt;
  }
}

export class WrongPinError extends Error {
  readonly failures: number;
  readonly retryAt: number;
  constructor(failures: number, retryAt: number) {
    super("Wrong PIN.");
    this.name = "WrongPinError";
    this.failures = failures;
    this.retryAt = retryAt;
  }
}

export class DataWipedError extends Error {
  constructor() {
    super("All data was deleted after 10 failed attempts.");
    this.name = "DataWipedError";
  }
}

export class NotInitialisedError extends Error {
  constructor() {
    super("No vault on this device.");
    this.name = "NotInitialisedError";
  }
}

export class BiometricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiometricError";
  }
}

function lockDurationMs(failureCount: number): number {
  if (failureCount <= FREE_ATTEMPTS) return 0;
  const index = Math.min(failureCount - FREE_ATTEMPTS - 1, BACKOFF_SECONDS.length - 1);
  return (BACKOFF_SECONDS[index] ?? 0) * 1000;
}

/** Milliseconds left on the current lockout, clamped against clock changes. */
export function remainingLockMs(state: FailureState, now: number = Date.now()): number {
  if (state.lockedUntil <= 0) return 0;
  return Math.max(0, Math.min(state.lockedUntil - now, MAX_LOCK_MS));
}

export async function getFailureState(): Promise<FailureState> {
  return readFailureState();
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const meta = await readVaultMeta();
  if (!meta) return { initialised: false, biometric: null };
  return { initialised: true, biometric: meta.bio?.mode ?? null };
}

async function requireMeta(): Promise<VaultMeta> {
  const meta = await readVaultMeta();
  if (!meta) throw new NotInitialisedError();
  return meta;
}

/**
 * Creates the vault: a random 256 bit DEK wrapped with a PBKDF2 key
 * derived from the PIN. Overwrites any existing vault.
 */
export async function setupWithPin(pin: string): Promise<Session> {
  const dekRaw = generateDekBytes();
  try {
    const saltPin = newSalt();
    const kek = await deriveKekFromPin(pin, saltPin);
    const sealed = await wrapDek(kek, dekRaw);
    await writeVaultMeta({
      version: 1,
      pin: {
        saltPin,
        iterations: PBKDF2_ITERATIONS,
        iv: sealed.iv,
        wrapped: sealed.ct,
      },
      bio: null,
      userHandle: randomBytes(16),
      wipeAfterFailures: false,
    });
    await writeFailureState(NO_FAILURES);
    return { dek: await importDek(dekRaw) };
  } finally {
    zero(dekRaw);
  }
}

/**
 * Unwraps the DEK with the PIN and returns the raw bytes.
 * Applies the failure counter, the backoff and the optional wipe.
 * Callers must zero the result.
 */
async function unwrapWithPin(pin: string): Promise<Uint8Array> {
  const failures = await readFailureState();
  const remaining = remainingLockMs(failures);
  if (remaining > 0) throw new VaultLockedOutError(Date.now() + remaining);

  const meta = await requireMeta();
  const kek = await deriveKekFromPin(pin, meta.pin.saltPin);
  try {
    const dekRaw = await unwrapDek(kek, { iv: meta.pin.iv, ct: meta.pin.wrapped });
    await writeFailureState(NO_FAILURES);
    return dekRaw;
  } catch {
    const count = failures.count + 1;
    const wait = lockDurationMs(count);
    const next: FailureState = { count, lockedUntil: wait > 0 ? Date.now() + wait : 0 };
    await writeFailureState(next);
    if (meta.wipeAfterFailures && count >= WIPE_THRESHOLD) {
      await wipeDatabase();
      throw new DataWipedError();
    }
    throw new WrongPinError(count, next.lockedUntil);
  }
}

export async function unlockWithPin(pin: string): Promise<Session> {
  const dekRaw = await unwrapWithPin(pin);
  try {
    return { dek: await importDek(dekRaw) };
  } finally {
    zero(dekRaw);
  }
}

/** True when the device has a built in authenticator that can verify the user. */
export async function isBiometricAvailable(): Promise<boolean> {
  const api = window.PublicKeyCredential;
  if (!api?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await api.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** The PRF extension is not in every DOM type set yet, so it is described here. */
type PrfInputs = {
  prf?: { eval?: { first: BufferSource } };
};
type PrfOutputs = {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};

function extensions(input: PrfInputs): AuthenticationExtensionsClientInputs {
  return input as AuthenticationExtensionsClientInputs;
}

function prfResult(credential: PublicKeyCredential): Uint8Array | null {
  const results = credential.getClientExtensionResults() as PrfOutputs;
  const first = results.prf?.results?.first;
  if (!first || first.byteLength === 0) return null;
  return new Uint8Array(first);
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function createCredential(userHandle: Uint8Array): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: toBuffer(randomBytes(32)),
      rp: { name: "Budget", id: location.hostname },
      user: { id: toBuffer(userHandle), name: "local", displayName: "local" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
      },
      timeout: 60_000,
      attestation: "none",
      extensions: extensions({ prf: {} }),
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new BiometricError("The device did not return a credential.");
  }
  return credential;
}

async function assertCredential(
  credentialId: Uint8Array,
  prfSalt: Uint8Array | null,
): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: toBuffer(randomBytes(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: toBuffer(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
      ...(prfSalt ? { extensions: extensions({ prf: { eval: { first: toBuffer(prfSalt) } } }) } : {}),
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new BiometricError("The device did not confirm the check.");
  }
  return credential;
}

/**
 * Enrols the platform authenticator. The PIN is required because the DEK has
 * to be unwrapped before it can be wrapped again for the biometric path.
 *
 * Returns "prf" when the authenticator produced a stable secret, in which case
 * the biometric is genuinely part of the key. Returns "gate" when it did not,
 * in which case the wrapping key sits on the device.
 */
export async function enrolBiometric(pin: string): Promise<BiometricMode> {
  const dekRaw = await unwrapWithPin(pin);
  try {
    const meta = await requireMeta();
    const credential = await createCredential(meta.userHandle);
    const credentialId = new Uint8Array(credential.rawId);
    const prfSalt = randomBytes(PRF_SALT_LENGTH);

    // The PRF output is only readable from an assertion, so ask for one now.
    let prfOutput: Uint8Array | null = null;
    try {
      const assertion = await assertCredential(credentialId, prfSalt);
      prfOutput = prfResult(assertion);
    } catch {
      prfOutput = null;
    }

    let bio: BioKeyMaterial;
    if (prfOutput) {
      const saltBio = newSalt();
      const kek = await deriveKekFromPrf(prfOutput, saltBio);
      zero(prfOutput);
      const sealed = await wrapDek(kek, dekRaw);
      bio = {
        mode: "prf",
        credentialId,
        prfSalt,
        saltBio,
        iv: sealed.iv,
        wrapped: sealed.ct,
      };
    } else {
      const deviceKey = randomBytes(32);
      const kek = await importKek(deviceKey);
      const sealed = await wrapDek(kek, dekRaw);
      bio = {
        mode: "gate",
        credentialId,
        deviceKey,
        iv: sealed.iv,
        wrapped: sealed.ct,
      };
    }

    await writeVaultMeta({ ...meta, bio });
    return bio.mode;
  } finally {
    zero(dekRaw);
  }
}

export async function removeBiometric(): Promise<void> {
  const meta = await requireMeta();
  await writeVaultMeta({ ...meta, bio: null });
}

/**
 * Unlocks with the platform authenticator.
 * In "prf" mode the assertion output is run through HKDF to rebuild the
 * key encryption key. In "gate" mode a successful assertion with user
 * verification is required before the device key is used.
 */
export async function unlockWithBiometric(): Promise<Session> {
  const meta = await requireMeta();
  const bio = meta.bio;
  if (!bio) throw new BiometricError("No biometric credential is enrolled.");

  if (bio.mode === "prf") {
    const assertion = await assertCredential(bio.credentialId, bio.prfSalt);
    const prfOutput = prfResult(assertion);
    if (!prfOutput) {
      throw new BiometricError("The device did not return the key material. Use the PIN.");
    }
    const kek = await deriveKekFromPrf(prfOutput, bio.saltBio);
    zero(prfOutput);
    const dekRaw = await unwrapDek(kek, { iv: bio.iv, ct: bio.wrapped });
    try {
      return { dek: await importDek(dekRaw) };
    } finally {
      zero(dekRaw);
    }
  }

  await assertCredential(bio.credentialId, null);
  const kek = await importKek(bio.deviceKey);
  const dekRaw = await unwrapDek(kek, { iv: bio.iv, ct: bio.wrapped });
  try {
    return { dek: await importDek(dekRaw) };
  } finally {
    zero(dekRaw);
  }
}

/**
 * Rewraps the DEK under a key derived from the new PIN.
 * The records themselves are untouched, the DEK does not change.
 */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  const dekRaw = await unwrapWithPin(oldPin);
  try {
    const meta = await requireMeta();
    const saltPin = newSalt();
    const kek = await deriveKekFromPin(newPin, saltPin);
    const sealed = await wrapDek(kek, dekRaw);
    await writeVaultMeta({
      ...meta,
      pin: { saltPin, iterations: PBKDF2_ITERATIONS, iv: sealed.iv, wrapped: sealed.ct },
    });
    await writeFailureState(NO_FAILURES);
  } finally {
    zero(dekRaw);
  }
}

/** Keeps the lock screen copy of the wipe flag in step with the settings record. */
export async function setWipeAfterFailures(enabled: boolean): Promise<void> {
  const meta = await readVaultMeta();
  if (!meta) return;
  if (meta.wipeAfterFailures === enabled) return;
  await writeVaultMeta({ ...meta, wipeAfterFailures: enabled });
}

/** Deletes every record and all key material. */
export async function wipeAll(): Promise<void> {
  await wipeDatabase();
}
