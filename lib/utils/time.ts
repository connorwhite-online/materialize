/**
 * Compact relative-time formatter, e.g. `1m ago`, `3h ago`, `2d ago`.
 *
 * Computed at render time on the server (the file detail page is
 * dynamic per request). The buckets max out at minute precision so
 * client/server hydration produces identical strings within the same
 * render — no flicker, no `dangerouslySetInnerHTML` workaround needed.
 *
 * Falls through to year buckets at the top end; the listing pages this
 * powers (file activity, comments, makes) don't display content older
 * than a few months in practice, but the upper bound keeps it sane.
 */
export function timeAgo(date: Date | string): string {
  const t = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
