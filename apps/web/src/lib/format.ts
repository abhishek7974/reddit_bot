/** "HOLD_FOR_REVIEW" -> "Hold for review" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

/** 0..1 -> "42%" */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 0..1 score -> "0.82" */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  return score.toFixed(2);
}

export function formatUsd(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

/** Only real Reddit https permalinks are rendered as links; anything else is shown as text. */
export function safeRedditUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'https://www.reddit.com');
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'reddit.com' && !u.hostname.endsWith('.reddit.com')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
