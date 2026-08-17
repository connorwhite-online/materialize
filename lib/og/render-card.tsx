import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveImageUrl,
  shouldFullBleed,
  toSatoriSafeDataUrl,
} from "./card-image";

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
    // Data URLs go through the same normalization as fetched bytes —
    // an inline WebP breaks satori exactly like a fetched one.
    if (absolute.startsWith("data:")) {
      const comma = absolute.indexOf(",");
      if (comma === -1) return null;
      const isBase64 = absolute.slice(0, comma).includes(";base64");
      const payload = absolute.slice(comma + 1);
      return await toSatoriSafeDataUrl(
        Buffer.from(
          isBase64 ? payload : decodeURIComponent(payload),
          isBase64 ? "base64" : "utf8"
        )
      );
    }
    const res = await fetch(absolute, { cache: "force-cache" });
    if (!res.ok) return null;
    // Never trust the response's own content-type, and never hand the
    // bytes straight to satori — see `toSatoriSafeDataUrl`.
    return await toSatoriSafeDataUrl(Buffer.from(await res.arrayBuffer()));
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
  layout?: "split" | "full" | "stack";
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
  /**
   * Artwork for `layout: "stack"` — a project's bundled file previews,
   * fanned across the frame. Ignored by the other layouts.
   */
  images?: string[] | null;
};

/**
 * Fan geometry for the stack layout.
 *
 * The tile size is DERIVED from the count rather than fixed: a fixed
 * size overflows the frame as soon as there are more than three tiles,
 * and the outermost previews get clipped by the card edge — which is
 * exactly the art a stack exists to show. Solve for the largest tile
 * whose fanned width still fits inside the padding instead.
 *
 * Rotation expands a square's bounding box (a side-T square at angle θ
 * spans T·(cosθ + sinθ), ~1.15T at 9°), so the padding has to absorb
 * that on top of the laid-out width — hence the generous PAD.
 *
 * Satori supports `transform`, but composes it far more literally than
 * a browser does, so tiles are laid out by flexbox and only *rotated*
 * by transform; the overlap comes from negative margins, which satori
 * handles predictably.
 */
const STACK_PAD = 70;
const STACK_MAX_TILE = 420;
/** Overlap as a fraction of tile width. */
const STACK_OVERLAP_RATIO = 0.18;
const STACK_MAX_ANGLE = 9;

export interface StackGeometry {
  tile: number;
  /** Negative margin between adjacent tiles. */
  overlap: number;
}

export function stackGeometry(count: number): StackGeometry {
  const n = Math.max(count, 1);
  const available = OG_SIZE.width - STACK_PAD * 2;
  // width = n·T − (n−1)·(ratio·T)  ⇒  T = width / (n − ratio·(n−1))
  const denominator = n - STACK_OVERLAP_RATIO * (n - 1);
  const tile = Math.min(STACK_MAX_TILE, Math.floor(available / denominator));
  return { tile, overlap: -Math.round(tile * STACK_OVERLAP_RATIO) };
}

/** Rotation for tile `i` of `count`, fanned symmetrically about the centre. */
export function stackTileAngle(i: number, count: number): number {
  if (count <= 1) return 0;
  const mid = (count - 1) / 2;
  const step = STACK_MAX_ANGLE / mid;
  return Number(((i - mid) * step).toFixed(2));
}

export async function renderOgCard(props: CardProps): Promise<ImageResponse> {
  const [brandFont, imgSrc, stackResolved] = await Promise.all([
    loadBrandFont(),
    props.imageUrl ? fetchImageDataUrl(props.imageUrl) : Promise.resolve(null),
    props.layout === "stack" && props.images?.length
      ? Promise.all(props.images.map((u) => fetchImageDataUrl(u)))
      : Promise.resolve([] as (string | null)[]),
  ]);

  // Drop tiles whose art failed to resolve rather than rendering a
  // hole in the fan; if none survive, the layouts below fall through
  // to the split card.
  const stackSrcs = stackResolved.filter((v): v is string => !!v);

  const radius = props.imageShape === "circle" ? 9999 : 32;

  const truncate = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

  if (props.layout === "stack" && stackSrcs.length > 0) {
    const { tile, overlap } = stackGeometry(stackSrcs.length);
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: BRAND_BG,
            fontFamily: "Materialize",
          }}
        >
          {stackSrcs.map((src, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: tile,
                height: tile,
                marginLeft: i === 0 ? 0 : overlap,
                borderRadius: Math.round(tile * 0.1),
                overflow: "hidden",
                background: "#141414",
                border: "1px solid #2a2a2a",
                transform: `rotate(${stackTileAngle(i, stackSrcs.length)}deg)`,
              }}
            >
              <img
                src={src}
                width={tile}
                height={tile}
                style={{
                  width: "100%",
                  height: "100%",
                  // Contained: these are the same square, transparent
                  // model captures the file cards use, and cropping
                  // them to a tile would clip the part.
                  objectFit: "contain",
                }}
              />
            </div>
          ))}
        </div>
      ),
      {
        ...OG_SIZE,
        fonts: [
          { name: "Materialize", data: brandFont, style: "normal", weight: 700 },
        ],
      }
    );
  }

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
