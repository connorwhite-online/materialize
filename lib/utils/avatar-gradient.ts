/**
 * Deterministic gradient generator for empty-state avatars.
 * Same seed always produces the same gradient — feels like identity.
 *
 * Uses oklch for perceptually uniform colors. Each user gets a unique
 * hue across the full spectrum, but chroma stays low so colors are
 * muted and fit the neutral design system.
 */

/**
 * djb2 hash — fast, good distribution.
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
 * Returns a CSS `linear-gradient(...)` string using oklch.
 *
 * - Hue: 0-359° (main source of variation between users)
 * - Chroma: 0.04-0.08 (subtle tint, never loud)
 * - Two lightness stops create visible but soft gradient
 */
export function getAvatarGradient(seed: string): string {
  const hash = hashString(seed);

  const hue = hash % 360;
  const chroma = 0.04 + ((hash >> 3) % 5) * 0.01; // 0.04 – 0.08
  const lightStart = 0.82 + ((hash >> 6) % 9) * 0.01; // 0.82 – 0.90
  const lightEnd = 0.62 + ((hash >> 10) % 11) * 0.01; // 0.62 – 0.72

  const angles = [135, 145, 155, 165, 175, 185, 195, 205];
  const angle = angles[(hash >> 14) % angles.length];

  const start = `oklch(${lightStart.toFixed(3)} ${chroma.toFixed(3)} ${hue})`;
  const end = `oklch(${lightEnd.toFixed(3)} ${chroma.toFixed(3)} ${hue})`;

  return `linear-gradient(${angle}deg, ${start}, ${end})`;
}
