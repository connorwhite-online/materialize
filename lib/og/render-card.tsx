import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveImageUrl, shouldFullBleed } from "./card-image";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

// Brand font for the wordmark + entity title. Cached at module level
// so concurrent OG renders share one read.
let brandFontPromise: Promise<Buffer> | null = null;
function loadBrandFont() {
  if (!brandFontPromise) {
    brandFontPromise = readFile(join(process.cwd(), "public/PPFuji-Bold.otf"));
  }
  return brandFontPromise;
}

// Best-effort fetch of a remote image as a base64 data URL. Satori
// can sometimes fetch URLs itself, but inlining avoids egress flakiness
// during OG render. Returns null on any failure so the caller can
// render a graceful no-image variant.
async function fetchImageDataUrl(url: string): Promise<string | null> {
  try {
    const absolute = await resolveImageUrl(url);
    if (!absolute) return null;
    if (absolute.startsWith("data:")) return absolute;
    const res = await fetch(absolute, { cache: "force-cache" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

const BRAND_BG = "#0a0a0a";

type CardProps = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  imageShape?: "square" | "circle";
  /**
   * `"full"` gives the artwork the whole 1200×630 frame. Chat clients
   * and social cards already print the title and domain beneath the
   * image, so the split card's in-image text is duplicated chrome —
   * and it shrinks the artwork to a third of the frame to show it.
   *
   * `"split"` (the default) keeps the image tile + text column, which
   * is still the right call for profiles (a circular avatar has no
   * business being cropped to a 1.9:1 banner) and is the automatic
   * fallback whenever no image resolved.
   */
  layout?: "split" | "full";
  /**
   * How a full-bleed image fills the frame.
   *
   * `"cover"` for photography — catalog product shots, project photos.
   *
   * `"contain"` for our own canvas captures. File thumbnails are
   * transparent-background WebP renders of a model normalized to fill
   * a square viewport (`components/viewer/thumbnail-capture.tsx`), so
   * cropping them to 1.9:1 lops off the top and bottom of the part.
   * Contained at full height on the brand background it still reads as
   * full-bleed, because the transparent background and the card
   * background are the same colour.
   */
  fit?: "cover" | "contain";
};

export async function renderOgCard(props: CardProps): Promise<ImageResponse> {
  const [brandFont, imgSrc] = await Promise.all([
    loadBrandFont(),
    props.imageUrl ? fetchImageDataUrl(props.imageUrl) : Promise.resolve(null),
  ]);

  const radius = props.imageShape === "circle" ? 9999 : 32;

  const truncate = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

  // The `imgSrc` re-test is what narrows it to a string for the <img>
  // below — `shouldFullBleed` returns an opaque boolean, so TypeScript
  // cannot carry the null check across the call on its own.
  if (shouldFullBleed(props.layout, !!imgSrc) && imgSrc) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: BRAND_BG,
            fontFamily: "Materialize",
          }}
        >
          <img
            src={imgSrc}
            width={OG_SIZE.width}
            height={OG_SIZE.height}
            style={{
              width: "100%",
              height: "100%",
              objectFit: props.fit ?? "cover",
            }}
          />
        </div>
      ),
      {
        ...OG_SIZE,
        fonts: [
          {
            name: "Materialize",
            data: brandFont,
            style: "normal",
            weight: 700,
          },
        ],
      }
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BRAND_BG,
          color: "#fafafa",
          fontFamily: "Materialize",
          padding: 72,
          alignItems: "center",
        }}
      >
        {imgSrc ? (
          <div
            style={{
              width: 460,
              height: 460,
              borderRadius: radius,
              overflow: "hidden",
              display: "flex",
              flexShrink: 0,
              background: "#171717",
              border: "1px solid #262626",
            }}
          >
            <img
              src={imgSrc}
              width={460}
              height={460}
              style={{ objectFit: "cover", width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          <div
            style={{
              width: 460,
              height: 460,
              borderRadius: radius,
              flexShrink: 0,
              background:
                "linear-gradient(135deg, #1f1f1f 0%, #0a0a0a 100%)",
              border: "1px solid #262626",
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 56,
            flex: 1,
            justifyContent: "space-between",
            height: 460,
            paddingTop: 16,
            paddingBottom: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 64,
                lineHeight: 1.05,
                letterSpacing: -1.5,
                fontWeight: 700,
                color: "#fafafa",
              }}
            >
              {truncate(props.title, 60)}
            </div>
            {props.subtitle ? (
              <div
                style={{
                  marginTop: 20,
                  fontSize: 30,
                  color: "#a3a3a3",
                  letterSpacing: -0.3,
                }}
              >
                {truncate(props.subtitle, 70)}
              </div>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#737373",
              letterSpacing: -0.3,
              fontWeight: 700,
            }}
          >
            Materialize
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        {
          name: "Materialize",
          data: brandFont,
          style: "normal",
          weight: 700,
        },
      ],
    }
  );
}
