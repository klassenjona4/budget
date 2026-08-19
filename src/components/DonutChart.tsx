import { formatCentsAbs } from "../lib/money.ts";
import type { CategorySlice } from "../lib/insights.ts";
import type { Locale } from "../lib/types.ts";

type DonutChartProps = {
  slices: CategorySlice[];
  totalCents: number;
  locale: Locale;
};

const SIZE = 120;
const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Spending split as a ring. Each slice is one circle with a dash pattern,
 * rotated to start where the previous one ended.
 */
export function DonutChart({ slices, totalCents, locale }: DonutChartProps) {
  if (totalCents <= 0 || slices.length === 0) {
    return <p className="faint">No spending in this period.</p>;
  }

  let offset = 0;
  const arcs = slices.map((slice) => {
    const fraction = slice.amountCents / totalCents;
    const length = CIRCUMFERENCE * fraction;
    const arc = (
      <circle
        key={slice.categoryId}
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke={slice.colour}
        strokeWidth="16"
        strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    );
    offset += length;
    return arc;
  });

  const label = slices
    .map((slice) => `${slice.name} ${formatCentsAbs(slice.amountCents, locale)}`)
    .join(", ");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="donut"
      role="img"
      aria-label={`Spending by category: ${label}`}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--colour-track)"
        strokeWidth="16"
      />
      {arcs}
    </svg>
  );
}
