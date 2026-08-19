type ProgressBarProps = {
  /** Spent amount in cents, negative values are treated as zero. */
  spentCents: number;
  plannedCents: number;
};

export function ProgressBar({ spentCents, plannedCents }: ProgressBarProps) {
  const spent = Math.max(0, spentCents);
  const over = plannedCents > 0 && spent > plannedCents;
  const percent =
    plannedCents <= 0 ? (spent > 0 ? 100 : 0) : Math.min(100, Math.round((spent * 100) / plannedCents));
  return (
    <div
      className={over ? "progress progress--over" : "progress"}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
