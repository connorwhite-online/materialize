/**
 * Studio resume slot — the sessionStorage handshake other pages use to open
 * the studio ON a specific build (exemplar gallery → "Build in studio").
 * The studio itself reads/writes the same key for its own reattach flow
 * (readRecentResume / persistResume in text-to-cad-studio.tsx).
 *
 * Kept as a tiny standalone module so a page can deep-link into the studio
 * without importing the studio's (three.js-heavy) client bundle.
 */

export const RESUME_STORAGE_KEY = "prometheus:last-session";

/**
 * Point the studio at a build, then navigate to /prometheus — within the
 * studio's resume grace window it opens that thread directly. Best-effort:
 * sessionStorage can throw (private mode / quota); the studio then just
 * opens normally.
 */
export function stashStudioResume(rootId: string, viewTurnId?: string) {
  try {
    window.sessionStorage.setItem(
      RESUME_STORAGE_KEY,
      JSON.stringify({
        rootId,
        viewTurnId: viewTurnId ?? rootId,
        ts: Date.now(),
      })
    );
  } catch {
    /* best-effort */
  }
}
