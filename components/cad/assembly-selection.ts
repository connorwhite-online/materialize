/**
 * Assembly part-tab selection helpers (MTR-174 / MTR-188).
 *
 * `selectedPartId === null` means "All parts". A revision mints new
 * fileAssetIds, so a selection held over from the previous turn can point at
 * nothing — left unguarded that blanks the canvas (every part gets
 * `visible=false`). Resolve against the CURRENT parts list and treat a
 * non-match as "All parts".
 */

/** Resolve a raw tab selection against the parts currently on screen. */
export function resolveEffectiveSelectedPartId(
  parts: { fileAssetId: string }[],
  selectedPartId: string | null
): string | null {
  if (selectedPartId == null) return null;
  return parts.find((p) => p.fileAssetId === selectedPartId)?.fileAssetId ?? null;
}

/**
 * True when the viewer should render the full assembly (shared frame +
 * explode). False when a single part tab is active — that part is framed
 * alone so it fills the viewport instead of sitting tiny in the union box.
 */
export function isAssemblyOverview(
  partCount: number,
  effectiveSelectedPartId: string | null
): boolean {
  return partCount > 1 && effectiveSelectedPartId == null;
}
