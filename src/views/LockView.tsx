import { useCallback, useEffect, useRef, useState } from "react";
import { PIN_LENGTH, PinEntry } from "../components/PinEntry.tsx";
import { useActions, useStoreState } from "../state/store.tsx";
import {
  DataWipedError,
  FREE_ATTEMPTS,
  getFailureState,
  remainingLockMs,
  VaultLockedOutError,
  WrongPinError,
} from "../lib/vault.ts";

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

export function LockView() {
  const store = useStoreState();
  const actions = useActions();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWaitMs] = useState(0);
  const [wiped, setWiped] = useState(false);
  const [showPin, setShowPin] = useState(store.biometric === null);
  const biometricTried = useRef(false);
  const attempting = useRef(false);

  const refreshLock = useCallback(async () => {
    const state = await getFailureState();
    setWaitMs(remainingLockMs(state));
  }, []);

  useEffect(() => {
    void refreshLock();
    const interval = window.setInterval(() => {
      setWaitMs((current) => (current <= 1000 ? 0 : current - 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [refreshLock]);

  const unlockBiometric = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.unlockBiometric();
    } catch (cause) {
      setShowPin(true);
      setError(
        cause instanceof Error
          ? `Biometric unlock did not complete. ${cause.message}`
          : "Biometric unlock did not complete.",
      );
    } finally {
      setBusy(false);
    }
  }, [actions]);

  // The biometric prompt is offered once automatically on mount.
  useEffect(() => {
    if (biometricTried.current) return;
    if (store.biometric === null || !store.biometricAvailable) return;
    biometricTried.current = true;
    void unlockBiometric();
  }, [store.biometric, store.biometricAvailable, unlockBiometric]);

  // One attempt at a time, guarded by a ref so a re render cannot start a second.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || attempting.current) return;
    attempting.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await actions.unlockPin(pin);
      } catch (cause) {
        setPin("");
        if (cause instanceof WrongPinError) {
          await refreshLock();
          const left = Math.max(0, FREE_ATTEMPTS - cause.failures);
          if (cause.retryAt > Date.now()) setError("Wrong PIN.");
          else if (left > 0) {
            setError(
              `Wrong PIN. ${left} more ${left === 1 ? "attempt" : "attempts"} before the keypad locks.`,
            );
          } else setError("Wrong PIN. The next failed attempt locks the keypad.");
        } else if (cause instanceof VaultLockedOutError) {
          await refreshLock();
          setError("The keypad is locked after repeated failures.");
        } else if (cause instanceof DataWipedError) {
          setWiped(true);
          setError("All data was deleted after 10 failed attempts. Restore from a backup.");
        } else {
          setError(cause instanceof Error ? cause.message : "Unlock failed.");
        }
      } finally {
        attempting.current = false;
        setBusy(false);
      }
    })();
  }, [actions, pin, refreshLock]);

  const lockedOut = waitMs > 0;

  return (
    <main className="screen screen--plain">
      <div className="centre">
        <h1 className="title text-centre">Budget</h1>

        {error ? <p className="notice notice--error">{error}</p> : null}
        {lockedOut ? (
          <p className="notice">
            Too many failed attempts. Try again in {formatWait(waitMs)}.
          </p>
        ) : null}

        {wiped ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={actions.resetToSetup}
          >
            Set the app up again
          </button>
        ) : null}

        {!wiped && store.biometric !== null && store.biometricAvailable ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => void unlockBiometric()}
          >
            Unlock with biometric
          </button>
        ) : null}

        {showPin && !wiped ? (
          <PinEntry
            pin={pin}
            onChange={setPin}
            disabled={busy || lockedOut}
            label="Enter your 6 digit PIN"
          />
        ) : wiped ? null : (
          <button type="button" className="btn btn--quiet" onClick={() => setShowPin(true)}>
            Enter the PIN instead
          </button>
        )}
      </div>
    </main>
  );
}
