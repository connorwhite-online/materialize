import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { renderOgCard } from "../render-card";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: () => "materialize.cc" }),
}));

/**
 * Set OG_SMOKE_OUT to a directory to also dump the rendered cards as
 * PNGs for eyeballing. Unset (the CI default) the test still runs and
 * asserts the render succeeds — it just writes nothing.
 */
const OUT = process.env.OG_SMOKE_OUT;

// A 4:3-ish photo stand-in (opaque) and a square transparent capture
// stand-in, drawn as raw SVG data URLs so the render exercises the
// real objectFit paths.
const photo =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">
      <rect width="1000" height="1000" fill="#f2f2f2"/>
      <rect x="180" y="240" width="640" height="520" rx="40" fill="#1b1b1b"/>
      <circle cx="500" cy="500" r="120" fill="#f2f2f2"/>
      <text x="500" y="930" font-size="56" text-anchor="middle" fill="#555">product photo</text>
    </svg>`
  ).toString("base64");

const capture =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <polygon points="256,60 452,450 60,450" fill="#b9b9b9"/>
      <polygon points="256,60 452,450 256,450" fill="#8f8f8f"/>
    </svg>`
  ).toString("base64");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function save(name: string, res: Awaited<ReturnType<typeof renderOgCard>>) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${name}.png`, buf);
  }
  return buf;
}

function expectPng(buf: Buffer) {
  expect(buf.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  expect(buf.length).toBeGreaterThan(1000);
}

/**
 * Satori is strict about which CSS it honours, and silently ignores
 * what it does not support rather than erroring — an unsupported
 * `objectFit` would ship a card that renders but looks wrong. These
 * exercise both full-bleed fits and the no-image fallback end to end,
 * so a layout change that satori cannot render fails here rather than
 * in somebody's iMessage thread.
 */
describe("OG card rendering", () => {
  it("renders a full-bleed material card", async () => {
    const buf = await save(
      "material-full-bleed",
      await renderOgCard({
        title: "SLS Nylon PA12",
        subtitle: "Nylons · 3D printing material",
        layout: "full",
        fit: "cover",
        imageUrl: photo,
      })
    );
    expectPng(buf);
  }, 30000);

  it("renders a full-bleed file card", async () => {
    const buf = await save(
      "file-full-bleed",
      await renderOgCard({
        title: "Caribiner Hook",
        subtitle: "by connor",
        layout: "full",
        fit: "contain",
        imageUrl: capture,
      })
    );
    expectPng(buf);
  }, 30000);

  it("falls back to the split card when a full layout has no image", async () => {
    const buf = await save(
      "fallback-split",
      await renderOgCard({
        title: "Caribiner Hook",
        subtitle: "by connor",
        layout: "full",
        imageUrl: null,
      })
    );
    expectPng(buf);
  }, 30000);
});

/**
 * Regression: satori cannot decode WebP, and every file thumbnail this
 * product captures IS WebP (`toDataURL("image/webp")` in
 * `components/viewer/thumbnail-capture.tsx`). Handed the raw bytes it
 * throws `u2 is not iterable` from deep inside the renderer, and the
 * OG route 500s — a broken link preview rather than a plain one.
 *
 * This was invisible until the relative-URL bug was fixed: the fetch
 * had never once succeeded, so satori had never been handed a
 * thumbnail. Fixing that bug is what exposed this.
 */
describe("source formats satori cannot decode", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function swatch(format: "webp" | "png" | "avif") {
    const base = sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 150, g: 150, b: 150, alpha: 1 },
      },
    });
    if (format === "webp") return base.webp().toBuffer();
    if (format === "avif") return base.avif().toBuffer();
    return base.png().toBuffer();
  }

  function mockFetchReturning(buf: Buffer, contentType: string) {
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array(buf), {
        status: 200,
        headers: { "content-type": contentType },
      })
    ) as unknown as typeof fetch;
  }

  it("renders a WebP thumbnail instead of throwing", async () => {
    mockFetchReturning(await swatch("webp"), "image/webp");
    const res = await renderOgCard({
      title: "Caribiner Hook",
      subtitle: "by connor",
      layout: "full",
      fit: "contain",
      imageUrl: "/api/thumbnails/file_123",
    });
    const buf = Buffer.from(await res.arrayBuffer());
    expectPng(buf);
  }, 30000);

  it("renders an AVIF source instead of throwing", async () => {
    // Cloudinary's f_auto can return AVIF, so material cards are
    // exposed to the same failure as file cards.
    mockFetchReturning(await swatch("avif"), "image/avif");
    const res = await renderOgCard({
      title: "SLS Nylon PA12",
      subtitle: "Nylons · 3D printing material",
      layout: "full",
      fit: "cover",
      imageUrl: "https://res.cloudinary.com/all3dp/image/upload/x.jpg",
    });
    expectPng(Buffer.from(await res.arrayBuffer()));
  }, 30000);

  it("degrades to the no-image card when the response is not an image", async () => {
    // A Vercel preview's SSO gate, or any error page, answers 200 with
    // HTML. Encoding that as a data: URL and handing it to satori is
    // the other way this route reaches a 500.
    mockFetchReturning(
      Buffer.from("<!doctype html><title>Login</title>", "utf8"),
      "text/html"
    );
    const res = await renderOgCard({
      title: "Caribiner Hook",
      subtitle: "by connor",
      layout: "full",
      fit: "contain",
      imageUrl: "/api/thumbnails/file_123",
    });
    expectPng(Buffer.from(await res.arrayBuffer()));
  }, 30000);

  it("still renders a PNG source unchanged", async () => {
    mockFetchReturning(await swatch("png"), "image/png");
    const res = await renderOgCard({
      title: "Plain PNG",
      subtitle: null,
      layout: "full",
      fit: "contain",
      imageUrl: "/api/thumbnails/file_123",
    });
    expectPng(Buffer.from(await res.arrayBuffer()));
  }, 30000);
});
