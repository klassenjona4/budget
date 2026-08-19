import type { Dispatch, SetStateAction } from "react";
import { Keypad } from "./Keypad.tsx";

export const PIN_LENGTH = 6;

type PinEntryProps = {
  pin: string;
  /** A state setter, so rapid taps cannot drop a digit. */
  onChange: Dispatch<SetStateAction<string>>;
  disabled?: boolean;
  label: string;
};

export function PinEntry({ pin, onChange, disabled = false, label }: PinEntryProps) {
  return (
    <div className="stack">
      <p className="label text-centre">{label}</p>
      <div className="pin-dots" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            className={index < pin.length ? "pin-dot pin-dot--filled" : "pin-dot"}
          />
        ))}
      </div>
      <Keypad
        disabled={disabled}
        onDigit={(digit) =>
          onChange((current) => (current.length < PIN_LENGTH ? current + digit : current))
        }
        onBackspace={() => onChange((current) => current.slice(0, -1))}
      />
    </div>
  );
}
