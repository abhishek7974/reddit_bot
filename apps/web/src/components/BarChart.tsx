import type { MetricPoint } from '@careerconnect/shared';
import { useId } from 'react';

/**
 * Lightweight accessible SVG bar chart with a data-table fallback.
 * The SVG is labelled with a text summary; the table carries the exact values.
 */
export function BarChart({ title, points, color = '#4338ca' }: { title: string; points: MetricPoint[]; color?: string }) {
  const id = useId();
  const total = points.reduce((s, p) => s + p.value, 0);
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 600;
  const height = 160;
  const pad = { top: 8, bottom: 22, left: 28, right: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = points.length ? innerW / points.length : innerW;
  const barW = Math.max(1, slot * 0.7);
  const peak = points.reduce<MetricPoint | null>((best, p) => (best === null || p.value > best.value ? p : best), null);
  const summary = points.length
    ? `${title}: ${total.toLocaleString()} total over ${points.length} days${peak ? `, peak ${peak.value} on ${peak.date}` : ''}.`
    : `${title}: no data.`;

  return (
    <figure className="min-w-0">
      <figcaption id={`${id}-cap`} className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="text-xs text-slate-600">Total {total.toLocaleString()}</span>
      </figcaption>
      {points.length === 0 ? (
        <p className="text-sm text-slate-600">No data in this window.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label={summary} preserveAspectRatio="none">
          <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#cbd5e1" />
          <text x={pad.left - 4} y={pad.top + 8} textAnchor="end" fontSize="10" fill="#475569">
            {max}
          </text>
          <text x={pad.left - 4} y={pad.top + innerH} textAnchor="end" fontSize="10" fill="#475569">
            0
          </text>
          {points.map((p, i) => {
            const h = (p.value / max) * innerH;
            return (
              <rect
                key={p.date}
                x={pad.left + i * slot + (slot - barW) / 2}
                y={pad.top + innerH - h}
                width={barW}
                height={h}
                fill={color}
                rx={1}
              >
                <title>{`${p.date}: ${p.value}`}</title>
              </rect>
            );
          })}
          {points.length > 0 ? (
            <>
              <text x={pad.left} y={height - 6} fontSize="10" fill="#475569">
                {points[0]?.date}
              </text>
              <text x={width - pad.right} y={height - 6} fontSize="10" fill="#475569" textAnchor="end">
                {points[points.length - 1]?.date}
              </text>
            </>
          ) : null}
        </svg>
      )}
      {points.length > 0 ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-indigo-700">View data as table</summary>
          <div className="mt-2 max-h-56 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{title} by day</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 pr-4 font-semibold text-slate-700">
                    Date
                  </th>
                  <th scope="col" className="py-1 font-semibold text-slate-700">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date} className="border-t border-slate-100">
                    <td className="py-1 pr-4">{p.date}</td>
                    <td className="py-1">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
