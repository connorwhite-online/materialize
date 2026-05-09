import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${b64}`;
  } catch {
    return null;
  }
}

type CardProps = {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  imageShape?: "square" | "circle";
};

export async function renderOgCard(props: CardProps): Promise<ImageResponse> {
  const [brandFont, imgSrc] = await Promise.all([
    loadBrandFont(),
    props.imageUrl ? fetchImageDataUrl(props.imageUrl) : Promise.resolve(null),
  ]);

  const radius = props.imageShape === "circle" ? 9999 : 32;

  const truncate = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0a0a0a",
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
