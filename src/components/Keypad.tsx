type KeypadProps = {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
  /** Optional key in the bottom left, for example a double zero. */
  extraKey?: { label: string; onPress: () => void } | undefined;
};

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Keypad({ onDigit, onBackspace, disabled = false, extraKey }: KeypadProps) {
  return (
    <div className="keypad">
      {DIGITS.map((digit) => (
        <button key={digit} type="button" disabled={disabled} onClick={() => onDigit(digit)}>
          {digit}
        </button>
      ))}
      {extraKey ? (
        <button type="button" disabled={disabled} onClick={extraKey.onPress}>
          {extraKey.label}
        </button>
      ) : (
        <span />
      )}
      <button type="button" disabled={disabled} onClick={() => onDigit("0")}>
        0
      </button>
      <button type="button" disabled={disabled} onClick={onBackspace} aria-label="Delete">
        Del
      </button>
    </div>
  );
}
