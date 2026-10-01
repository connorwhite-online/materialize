/**
 * Removes EXIF / XMP / IPTC metadata (GPS location, camera serial,
 * capture time) from a photo the user uploaded straight to R2, before
 * the photo is attached to anything a visitor can see.
 *
 * Photos reach R2 through a presigned PUT from the browser (or an
 * agent), so the server never touches the bytes on the way in. Phone
 * cameras write GPS into EXIF by default, and a published file or
 * project photo is served to anyone, so the cleanup runs at
 * registration: read the object back, re-encode it without metadata,
 * and overwrite it under the same key.
 *
 * `.rotate()` with no argument applies the EXIF orientation to the
 * pixels first. Dropping the orientation tag without doing that would
 * turn every portrait phone photo on its side.
 */
import sharp from "sharp";
import { getObjectBytes, putObject } from "@/lib/storage";
import { logError } from "@/lib/logger";

type CleanFormat = "jpeg" | "png" | "webp";

const CONTENT_TYPE: Record<CleanFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isCleanFormat(format: string | undefined): format is CleanFormat {
  return format === "jpeg" || format === "png" || format === "webp";
}

/**
 * Pure half: given image bytes, returns metadata-free bytes, or null
 * when there is nothing to remove (so a clean upload isn't re-encoded
 * and doesn't lose quality for nothing). Throws when the bytes aren't
 * a JPEG, PNG or WebP image.
 */
export async function removeImageMetadata(
  bytes: Uint8Array
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const meta = await sharp(bytes).metadata();
  if (!isCleanFormat(meta.format)) {
    throw new Error(`Unsupported photo format: ${meta.format ?? "unknown"}`);
  }
  const hasMetadata = !!(
    meta.exif ||
    meta.xmp ||
    meta.iptc ||
    meta.comments?.length ||
    (meta.orientation && meta.orientation !== 1)
  );
  if (!hasMetadata) return null;

  // sharp writes no EXIF/XMP/IPTC on output unless asked to
  // (withMetadata / keepExif), so a plain re-encode is the strip.
  const animated = (meta.pages ?? 1) > 1;
  let pipeline = sharp(bytes, { animated }).rotate();
  if (meta.format === "jpeg") pipeline = pipeline.jpeg({ quality: 90 });
  else if (meta.format === "webp") pipeline = pipeline.webp({ quality: 90 });
  else pipeline = pipeline.png();

  const out = await pipeline.toBuffer();
  return { bytes: new Uint8Array(out), contentType: CONTENT_TYPE[meta.format] };
}

/**
 * Strips the R2 object at `storageKey` in place. Fails closed: if the
 * object can't be read or decoded, the caller gets an error and must
 * not attach the photo, because attaching it unprocessed is exactly
 * the leak this exists to stop.
 */
export async function stripPhotoMetadata(
  storageKey: string
): Promise<{ ok: true } | { error: string }> {
  try {
    const bytes = await getObjectBytes(storageKey);
    const cleaned = await removeImageMetadata(bytes);
    if (cleaned) await putObject(storageKey, cleaned.bytes, cleaned.contentType);
    return { ok: true };
  } catch (error) {
    logError("stripPhotoMetadata", { storageKey, error });
    return { error: "Couldn't process that photo. Try a JPG, PNG or WebP." };
  }
}
