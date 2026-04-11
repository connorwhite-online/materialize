/**
 * Generate a human-readable order number from a UUID.
 * Format: MZ-XXXXXX (e.g., MZ-3A7F2B)
 * Deterministic — same UUID always produces the same order number.
 */
export function formatOrderNumber(uuid: string): string {
  const clean = uuid.replace(/-/g, "").toUpperCase();
  const segment = clean.slice(0, 6);
  return `MZ-${segment}`;
}
