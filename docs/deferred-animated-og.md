# Deferred: animated OG share cards

Static OG cards already ship via `app/(app)/{files,projects,u,materials}/[slug]/opengraph-image.tsx`, each calling `lib/og/render-card.tsx` to produce a 1200×630 PNG through `next/og`'s `ImageResponse`. The wishlist add is an **animated** version (GIF/WebP) — for files, a slow 360° rotation of the captured 3D model; for everything else, a subtle Ken-Burns zoom over the thumbnail or a shimmer pass.

## Why this didn't ship in the Q2-2026 polish sweep

The honest answer: it's a project, not a chore.

1. **`next/og` only emits single static PNGs.** `ImageResponse` is a thin wrapper over Satori → resvg, neither of which encode animation. There's no flag to flip; the rendering pipeline has to change.
2. **The platforms are inconsistent.** Twitter strips animated OGs to the first frame. LinkedIn ignores them. Discord renders inline. Slack varies. The "best case" payoff is iMessage + Discord — meaningful but not life-changing.
3. **Server-side animation has no Vercel-friendly path.** Each candidate has a real cost:
   - **headless WebGL + ffmpeg encode.** Pixel-perfect but needs a worker (Modal / Fly / Render). Vercel's default runtime has neither WebGL nor ffmpeg. ~1 day to stand up the worker + auth + cache.
   - **WebGPU in a Cloudflare Worker.** Edge-rendered, no separate infra, but the model viewer is Three.js with WebGL paths that don't translate 1:1.
   - **Pre-render at upload time and store the GIF in R2.** Simplest from the request-time perspective — we already capture the thumbnail at upload, just extend that to also capture 60 frames and encode. Adds noticeable cost to every uploaded file. Lots of GIFs we'll never serve.
4. **Spec smell.** Even when we do render an animated card, we'd need a static fallback alongside it (`og:image` for the GIF, `og:image:url` for the PNG). Lots of meta-tag plumbing for a feature with patchy client support.

## Concrete approach when we do it

- **At file upload time**, alongside the existing thumbnail capture, also capture a 60-frame, 2-second rotation as a WebP animation. Store in R2 at `og/animated/{fileId}.webp`. WebP > GIF: ~1/3 the size, better color, native browser support.
- **For projects**, the OG card animation is a Ken-Burns over the cover image. No model required. Encode with ffmpeg in a Vercel function (60MB binary in the runtime — works, with some setup).
- **For profiles and materials**, skip animation; the static card is already strong.
- **Meta tags**: emit `og:image` pointing at the animated WebP and `og:image:url` pointing at the static PNG. Twitter's first-frame strip falls back gracefully because WebP's first frame is the static cover.

## Twitter Player Card alternative

A different unfurl path: register a Twitter Player Card pointing at `/player/files/{slug}` which renders just the `<OrderModelPreview>` 3D viewer. Twitter unfurls the URL with an inline play button → click runs the actual 3D model. Caveats:

- Requires whitelisting via the Twitter card validator + (depending on era) Twitter Approval.
- Other platforms (Slack, iMessage, LinkedIn) ignore player cards entirely.
- The iframe size is fixed; the model viewer has to fit cleanly.

This is potentially a half-day win for Twitter-heavy creators but won't move the needle for Slack / iMessage / Discord sharing. The animated OG path is the better long-term answer.

## Estimate

Roughly two full days: one day to stand up an out-of-band worker (or extend the thumbnail capture pipeline at upload), one day for tuning the rendered cards (timing, ease, color grading) and updating the four `opengraph-image.tsx` files to point at the animated assets.
