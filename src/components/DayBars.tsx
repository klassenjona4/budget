import { formatCentsAbs } from "../lib/money.ts";
import { formatShortDate } from "../lib/period.ts";
import type { DayBar } from "../lib/insights.ts";
import type { Locale } from "../lib/types.ts";

type DayBarsProps = {
  days: DayBar[];
  locale: Locale;
};

/** One column per day of the period, height relative to the heaviest day. */
export function DayBars({ days, locale }: DayBarsProps) {
  const peak = days.reduce((highest, day) => Math.max(highest, day.spentCents), 0);
  if (peak === 0) return <p className="faint">No spending in this period.</p>;

  return (
    <div
      className="day-bars"
      role="img"
      aria-label={`Daily spending, highest day ${formatCentsAbs(peak, locale)}`}
    >
      {days.map((day) => (
        <span
          key={day.date}
          className="day-bars__col"
          title={`${formatShortDate(day.date, locale)}: ${formatCentsAbs(day.spentCents, locale)}`}
        >
          <span
            className="day-bars__fill"
            style={{ height: `${Math.round((day.spentCents / peak) * 100)}%` }}
          />
        </span>
      ))}
    </div>
  );
}
