/**
 * Text relevance for search results.
 *
 * Search currently orders every section by `createdAt` desc (see
 * `app/api/search/route.ts` and the active-search path in
 * `app/(app)/files/page.tsx`), which means the SQL decides *what*
 * matches and recency alone decides *what wins* — an exact title match
 * ranks below any newer listing that happens to contain the string.
 * This function is the missing half: it scores how well a row matches,
 * so ranking can be about the match.
 *
 * It scores rows already returned by the ILIKE scan, so it never has to
 * be a retrieval engine — no stemming, no index, no ranking of things
 * the database didn't hand us. If we ever move to Postgres full-text or
 * trigram search, this is the layer that gets replaced by `ts_rank` and
 * the callers stay as they are.
 */

/** Fields a search hit can match on, in descending order of authority. */
export interface RelevanceFields {
  name: string;
  tags?: readonly string[] | null;
  /** `designTags` — "strong", "flexible", … Same weight as tags. */
  designTags?: readonly string[] | null;
  /**
   * True when the row was pulled in by the category-keyword bridge
   * (`categoryIdsMatchingQuery`) rather than by matching text. Real,
   * but the weakest evidence we have: "drone" surfacing the whole
   * Hobby & RC shelf is a fallback, not a match.
   */
  matchedCategory?: boolean;
}

const NAME_EXACT = 1;
const NAME_PREFIX = 0.75;
const NAME_WORD_START = 0.55;
const NAME_SUBSTRING = 0.4;
/** Ceiling of the token-coverage term, for word-order-insensitive hits. */
const NAME_TOKEN_COVERAGE = 0.5;
const TAG_EXACT = 0.35;
const TAG_SUBSTRING = 0.2;
const CATEGORY_BRIDGE = 0.1;
/**
 * Added once when a *second* field also matched. Small — it separates
 * "matches the name and is tagged that way" from "matches the name",
 * without letting a pile of weak tag hits beat a strong name hit.
 */
const CORROBORATION = 0.05;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Highest-scoring way `needle` appears in `haystack`, or 0. */
function scoreName(haystack: string, needle: string): number {
  const name = normalize(haystack);
  if (!name || !needle) return 0;
  if (name === needle) return NAME_EXACT;
  if (name.startsWith(needle)) return NAME_PREFIX;

  const substringAt = name.indexOf(needle);
  const direct =
    substringAt < 0
      ? 0
      : // Preceded by a non-alphanumeric → the match starts a word
        // ("hook" in "wall hook"), which reads as a much better hit
        // than one buried mid-word ("hook" in "bookhooks").
        /[^a-z0-9]/.test(name[substringAt - 1] ?? " ")
        ? NAME_WORD_START
        : NAME_SUBSTRING;

  // Multi-word queries whose words are all present but reordered or
  // separated ("stand phone" against "Phone Stand v2") score by the
  // fraction of query tokens found. Single-token queries are already
  // fully covered by the checks above, so this can only help longer
  // ones.
  const queryTokens = tokenize(needle);
  let coverage = 0;
  if (queryTokens.length > 1) {
    const nameTokens = new Set(tokenize(haystack));
    const hits = queryTokens.filter((token) => nameTokens.has(token)).length;
    coverage = (hits / queryTokens.length) * NAME_TOKEN_COVERAGE;
  }

  return Math.max(direct, coverage);
}

function scoreTags(
  tags: readonly string[] | null | undefined,
  needle: string
): number {
  if (!tags?.length || !needle) return 0;
  let best = 0;
  for (const tag of tags) {
    const normalized = normalize(tag);
    if (!normalized) continue;
    if (normalized === needle) return TAG_EXACT;
    if (normalized.includes(needle)) best = Math.max(best, TAG_SUBSTRING);
  }
  return best;
}

/**
 * Score in roughly 0..1.05. The strongest single piece of evidence
 * wins, plus a small bump when a second field corroborates it — rather
 * than a sum, which would let three weak tag matches outrank an exact
 * title.
 */
export function relevanceScore(query: string, fields: RelevanceFields): number {
  const needle = normalize(query);
  if (!needle) return 0;

  const name = scoreName(fields.name ?? "", needle);
  const tags = Math.max(
    scoreTags(fields.tags, needle),
    scoreTags(fields.designTags, needle)
  );
  const category = fields.matchedCategory ? CATEGORY_BRIDGE : 0;

  const best = Math.max(name, tags, category);
  if (best === 0) return 0;

  const corroborated =
    [name, tags, category].filter((score) => score > 0).length > 1;
  return corroborated ? best + CORROBORATION : best;
}
