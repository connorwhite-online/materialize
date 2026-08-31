/**
 * Same-origin `/api/thumbnails/**` proxies are session-gated for
 * drafts and private projects (Clerk `auth()` on the route). The
 * built-in next/image optimizer fetches those srcs server-side
 * without the viewer's cookies, so the route returns the
 * transparent 1×1 PNG placeholder and cards look empty — while a
 * plain `<img>` (or `unoptimized`) on the same URL still shows the
 * real preview because the browser sends the session.
 *
 * Pass this into next/image's `unoptimized` prop for any src that
 * might be a thumbnail proxy. Remote signed R2 gallery URLs stay
 * optimized.
 *
 * CON-23.
 */
export function isSessionGatedImageSrc(src: string): boolean {
  return (
    src === "/api/thumbnails" ||
    src.startsWith("/api/thumbnails/") ||
    src.startsWith("/api/thumbnails?")
  );
}
