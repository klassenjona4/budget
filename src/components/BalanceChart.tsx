import { formatCents } from "../lib/money.ts";
import { formatShortDate } from "../lib/period.ts";
import type { BalancePoint } from "../lib/balance.ts";
import type { Locale } from "../lib/types.ts";

type BalanceChartProps = {
  points: BalancePoint[];
  locale: Locale;
};

const WIDTH = 320;
const HEIGHT = 120;
const PAD_TOP = 8;
const PAD_BOTTOM = 16;

/**
 * Balance over time as a filled line. Drawn by hand into a fixed viewBox and
 * scaled with CSS, so there is no chart library and no layout measurement.
 */
export function BalanceChart({ points, locale }: BalanceChartProps) {
  if (points.length < 2) {
    return <p className="faint">Not enough history yet to draw a line.</p>;
  }

  const values = points.map((point) => point.balanceCents);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  // A flat line still needs a band to sit in.
  const pad = span === 0 ? Math.max(100, Math.abs(rawMax) || 100) : Math.ceil(span / 10);
  const min = rawMin - pad;
  const max = rawMax + pad;

  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (index: number) => (index / (points.length - 1)) * WIDTH;
  const y = (value: number) => PAD_TOP + plotHeight - ((value - min) / (max - min)) * plotHeight;

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.balanceCents).toFixed(2)}`).join(" ");
  const area = `${line} L${WIDTH},${HEIGHT - PAD_BOTTOM} L0,${HEIGHT - PAD_BOTTOM} Z`;

  const first = points[0];
  const last = points[points.length - 1];
  const zeroInRange = min < 0 && max > 0;
  const falling = (last?.balanceCents ?? 0) < (first?.balanceCents ?? 0);
  const stroke = falling ? "var(--colour-negative)" : "var(--colour-accent)";

  const label = `Balance from ${formatShortDate(first?.date ?? "", locale)} to ${formatShortDate(
    last?.date ?? "",
    locale,
  )}, ${formatCents(first?.balanceCents ?? 0, locale)} to ${formatCents(last?.balanceCents ?? 0, locale)}`;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {zeroInRange ? (
          <line
            x1="0"
            x2={WIDTH}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--colour-negative)"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path d={area} fill="url(#balance-fill)" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(points.length - 1)} cy={y(last?.balanceCents ?? 0)} r="3" fill={stroke} />
      </svg>
      <figcaption className="chart-axis">
        <span className="num">{formatShortDate(first?.date ?? "", locale)}</span>
        <span className="num">{formatShortDate(last?.date ?? "", locale)}</span>
      </figcaption>
    </figure>
  );
}
