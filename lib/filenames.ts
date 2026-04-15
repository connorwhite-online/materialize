/**
 * Generic filename utilities shared by upload flows.
 * Pure functions — no IO, no dependencies, safe to import from
 * either the client or the server.
 */

/**
 * Turn an uploaded filename into a human-readable listing title.
 *
 *   carabiner.stl           → "Carabiner"
 *   left_bracket_v3.obj     → "Left Bracket V3"
 *   cool-part--final.3mf    → "Cool Part Final"
 *
 * Strips the extension, converts underscores/dashes to spaces,
 * title-cases each word, and returns a safe fallback if nothing
 * meaningful survives.
 */
export function deriveListingName(originalFilename: string): string {
  const withoutExt = originalFilename.replace(/\.[^.]+$/, "");
  const spaced = withoutExt.replace(/[_-]+/g, " ").trim();
  const titled = spaced
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return titled || "Untitled Print";
}

/**
 * Build a URL-safe slug from a listing name. Suffixes with a short
 * id to avoid collisions across users with the same title.
 */
export function buildListingSlug(name: string, idSuffix: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "print"}-${idSuffix}`;
}
