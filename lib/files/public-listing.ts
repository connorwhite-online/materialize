/**
 * Is this file open to anyone — published AND not set private by its
 * owner? The "owner or public" gate on model bytes and print/quote
 * routes uses this for the "anyone" half, matching the detail page
 * (`app/(app)/files/[slug]/page.tsx`), which 404s a private file for
 * non-writers even when it is published. Checking `status` alone
 * served a private listing's model to anyone holding an asset id.
 *
 * Both fields come off a left join, so either may be null; a null
 * visibility on a published row reads as the column default (public).
 */
export function isPublicListing(row: {
  fileStatus: string | null;
  fileVisibility?: string | null;
}): boolean {
  return row.fileStatus === "published" && row.fileVisibility !== "private";
}
