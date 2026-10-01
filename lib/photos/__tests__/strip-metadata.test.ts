import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const mockGetObjectBytes = vi.fn();
const mockPutObject = vi.fn();
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (...args: unknown[]) => mockGetObjectBytes(...args),
  putObject: (...args: unknown[]) => mockPutObject(...args),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { removeImageMetadata, stripPhotoMetadata } from "../strip-metadata";

/** A 40×20 JPEG shot "sideways" (orientation 6) with GPS in its EXIF. */
async function phoneJpeg(): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "#c33" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "TestPhone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "45/1 31/1 0/1" },
    })
    .toBuffer();
  return new Uint8Array(buf);
}

describe("removeImageMetadata", () => {
  it("drops EXIF (including GPS) and bakes the orientation into the pixels", async () => {
    const input = await phoneJpeg();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const out = await removeImageMetadata(input);
    expect(out?.contentType).toBe("image/jpeg");
    const after = await sharp(out!.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Orientation 6 = rotate 90°, so a 40×20 capture displays 20×40.
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(Buffer.from(out!.bytes).includes("TestPhone")).toBe(false);
  });

  it("returns null for an image with nothing to strip, so it isn't re-encoded", async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(await removeImageMetadata(new Uint8Array(png))).toBeNull();
  });

  it("throws on bytes that aren't an image", async () => {
    await expect(
      removeImageMetadata(new TextEncoder().encode("<html>nope</html>"))
    ).rejects.toThrow();
  });
});

describe("stripPhotoMetadata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("overwrites the object under the same key with the stripped bytes", async () => {
    mockGetObjectBytes.mockResolvedValue(await phoneJpeg());
    const key = "photos/user-1/abc/IMG_0001.jpg";

    expect(await stripPhotoMetadata(key)).toEqual({ ok: true });
    expect(mockPutObject).toHaveBeenCalledTimes(1);
    const [putKey, bytes, contentType] = mockPutObject.mock.calls[0];
    expect(putKey).toBe(key);
    expect(contentType).toBe("image/jpeg");
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
  });

  it("fails closed when the object can't be decoded", async () => {
    mockGetObjectBytes.mockResolvedValue(new TextEncoder().encode("not an image"));

    const result = await stripPhotoMetadata("photos/user-1/abc/x.jpg");
    expect(result).toHaveProperty("error");
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});
