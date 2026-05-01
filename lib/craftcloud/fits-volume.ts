/**
 * Rotation-aware bounding box vs build-volume fit test.
 *
 * Vendors will rotate the part to fit on the print bed, so the right
 * test is "does some axis permutation of the model bbox fit inside
 * the build volume", not "does the model bbox fit oriented as-is".
 *
 * Sorting both triples ascending and comparing element-wise picks the
 * single permutation that gives the model the most room — the model's
 * shortest dimension matches the volume's shortest, etc. This is the
 * standard rotated-bbox containment test.
 *
 * Both inputs are in the same units (mm). `volume` of `null` returns
 * `false` — we don't know the build envelope, so we can't claim it
 * fits.
 */
export function modelFitsInVolume(
  model: readonly [number, number, number],
  volume: readonly [number, number, number] | null | undefined
): boolean {
  if (!volume) return false;
  const m = [...model].sort((a, b) => a - b);
  const v = [...volume].sort((a, b) => a - b);
  return m[0] <= v[0] && m[1] <= v[1] && m[2] <= v[2];
}
