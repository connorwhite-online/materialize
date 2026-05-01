/**
 * Compact integer formatter for counts shown in tight UI (card chips,
 * badges). Below 1000 we render the raw number; from 1000 up we use
 * "k" / "m" / "b" with a single decimal trimmed to whole when integer.
 *
 *   formatCompactCount(0)        // "0"
 *   formatCompactCount(999)      // "999"
 *   formatCompactCount(1000)     // "1k"
 *   formatCompactCount(1500)     // "1.5k"
 *   formatCompactCount(12345)    // "12.3k"
 *   formatCompactCount(2500000)  // "2.5m"
 *
 * Negative inputs and non-finite values fall back to "0" — the
 * downstream UI never wants "-3 downloads" or "NaN downloads".
 */
export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const abs = Math.floor(n);
  if (abs < 1000) return String(abs);
  const TIERS: Array<{ threshold: number; suffix: string }> = [
    { threshold: 1_000_000_000, suffix: "b" },
    { threshold: 1_000_000, suffix: "m" },
    { threshold: 1_000, suffix: "k" },
  ];
  for (const tier of TIERS) {
    if (abs < tier.threshold) continue;
    const value = abs / tier.threshold;
    // 1 decimal max, but drop the trailing .0 so "2k" beats "2.0k".
    const rounded = Math.floor(value * 10) / 10;
    const display = rounded === Math.floor(rounded)
      ? String(Math.floor(rounded))
      : rounded.toFixed(1);
    return `${display}${tier.suffix}`;
  }
  return String(abs);
}
