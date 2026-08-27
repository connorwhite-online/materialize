/**
 * Formatters for the discovery inspector. Pure and separate from the
 * page so they're testable without rendering a server component —
 * same split as `prometheus/eval/page.tsx`'s exported helpers.
 */

/** Scores are small (~0-8); two decimals is the resolution that matters. */
export function fmtScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

/**
 * A rescoring multiplier. `1` renders as an em dash rather than
 * "1.00x": the column exists to show what was *discounted*, and a
 * column of "1.00x" down every undiscounted row buries the few that
 * weren't.
 */
export function fmtFactor(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - 1) < 0.0001) return "—";
  return `${n.toFixed(2)}×`;
}

/** Whole days since `date`, or null when there's no date to measure. */
export function ageInDays(date: Date | null, now: Date): number | null {
  if (!date) return null;
  const ms = now.getTime() - date.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function fmtAge(date: Date | null, now: Date): string {
  const days = ageInDays(date, now);
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Share of the base score contributed by one term, as a percent.
 * Guards the zero-total case: a row with no downloads and no freshness
 * left scores 0, and 0/0 must read as "—", not "NaN%" or "0%".
 */
export function fmtShare(term: number, total: number): string {
  if (!Number.isFinite(term) || !Number.isFinite(total) || total <= 0) return "—";
  return `${Math.round((term / total) * 100)}%`;
}
