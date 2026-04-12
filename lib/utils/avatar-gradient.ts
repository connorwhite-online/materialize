/**
 * Deterministic gradient generator for empty-state avatars.
 * Same seed always produces the same gradient — feels like identity, not noise.
 * Uses neutral palette to fit our design system.
 */

// Pre-picked pairs of neutral shades from our oklch palette
// Each pair creates a subtle gradient that works in both light and dark
const GRADIENT_PAIRS: Array<[string, string]> = [
  ["oklch(0.97 0 0)", "oklch(0.82 0 0)"], // light silver
  ["oklch(0.92 0 0)", "oklch(0.75 0 0)"], // warm grey
  ["oklch(0.88 0 0)", "oklch(0.68 0 0)"], // mid grey
  ["oklch(0.85 0.01 60)", "oklch(0.65 0.01 60)"], // warm stone
  ["oklch(0.87 0.005 240)", "oklch(0.68 0.005 240)"], // cool slate
  ["oklch(0.9 0.008 100)", "oklch(0.72 0.008 100)"], // sand
  ["oklch(0.84 0.01 30)", "oklch(0.62 0.01 30)"], // terracotta neutral
  ["oklch(0.89 0.006 200)", "oklch(0.7 0.006 200)"], // ice
];

const GRADIENT_ANGLES = [135, 145, 155, 165, 175, 185, 195, 205];

/**
 * Hash a string to a positive integer.
 * djb2 — simple, fast, good distribution.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic gradient for a user.
 * Returns a CSS `linear-gradient(...)` string.
 */
export function getAvatarGradient(seed: string): string {
  const hash = hashString(seed);
  const pair = GRADIENT_PAIRS[hash % GRADIENT_PAIRS.length];
  const angle = GRADIENT_ANGLES[(hash >> 3) % GRADIENT_ANGLES.length];
  return `linear-gradient(${angle}deg, ${pair[0]}, ${pair[1]})`;
}
