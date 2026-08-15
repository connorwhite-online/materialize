import { getImageProps } from "next/image";

/**
 * Full-viewport anon-landing hero backgrounds.
 *
 * Four art-directed masters in /public/home:
 *   home-v1-{light,dark}-{mobile,desktop}.png
 *
 * Theme follows the `next-themes` `.dark` class on `<html>` (not
 * `prefers-color-scheme` alone) so a forced light/dark setting still
 * picks the right frame. Breakpoint art-direction uses `<picture>` +
 * `getImageProps` so the browser only downloads the matching width.
 *
 * Images go through the built-in optimizer (`/_next/image`) — AVIF/WebP
 * negotiation, responsive srcset from deviceSizes (up to 3840), and
 * `sizes="100vw"` so a phone never pulls the 4K desktop master.
 *
 * `fetchPriority="high"` (not `preload`) on both theme candidates:
 * Next.js docs warn that `preload`/`loading="eager"` would force both
 * theme variants to download. Default lazy + high fetch priority lets
 * the CSS-hidden twin stay off the wire in supporting browsers.
 */

const COMMON = {
  alt: "",
  sizes: "100vw",
  // Next 16 qualities default is [75]; stay on that unless next.config
  // expands the allow-list. 75 is plenty once the optimizer serves a
  // viewport-sized derivative of a 4K master.
  quality: 75 as const,
};

// Intrinsic sizes of the masters in /public/home (home-v1-*).
// getImageProps needs them to build a correct srcset; the rendered
// size is CSS `object-cover` over the hero box.
const MOBILE = { width: 3072, height: 5504 };
const DESKTOP = { width: 4096, height: 1744 };

const IMG = {
  mobileLight: "/home/home-v1-light-mobile.png",
  mobileDark: "/home/home-v1-dark-mobile.png",
  desktopLight: "/home/home-v1-light-desktop.png",
  desktopDark: "/home/home-v1-dark-desktop.png",
} as const;

/** md (768px) — flip from portrait mobile masters to landscape desktop. */
const DESKTOP_MQ = "(min-width: 768px)";

function ThemePicture({
  mobileSrc,
  desktopSrc,
}: {
  mobileSrc: string;
  desktopSrc: string;
}) {
  const {
    props: { srcSet: desktop },
  } = getImageProps({ ...COMMON, ...DESKTOP, src: desktopSrc });
  const {
    props: { srcSet: mobile, ...img },
  } = getImageProps({ ...COMMON, ...MOBILE, src: mobileSrc });

  return (
    <picture className="absolute inset-0 block size-full">
      <source media={DESKTOP_MQ} srcSet={desktop} sizes={COMMON.sizes} />
      <source
        media="(max-width: 767px)"
        srcSet={mobile}
        sizes={COMMON.sizes}
      />
      {/* getImageProps already produced the optimised src/srcSet; we
          deliberately render a raw <img> inside <picture> for art
          direction (Next docs pattern). */}
      <img
        {...img}
        alt=""
        // High priority for LCP without forcing the hidden theme twin
        // to download (see module doc).
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
    </picture>
  );
}

export function HeroBackground() {
  return (
    <div
      aria-hidden
      // No negative z-index — `z-index: -10` paints behind the opaque
      // `bg-background` on <html>/<body> (and the fixed body gradient),
      // so the art was loading but invisible. DOM order + a raised
      // `z-10` on the hero <main> keeps copy above the absolute fill.
      //
      // Plain inset-0, no `env(safe-area-inset-*)` bleed: the hero
      // <section> is `overflow-hidden`, so the negative offsets this
      // used to carry were clipped away and never bought a pixel. In
      // Safari the unsafe areas aren't ours to paint into at all (see
      // HeroChromeTint); in a home-screen app `viewport-fit: cover`
      // already stretches the layout viewport over them.
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Light — hidden when <html class="dark"> */}
      <div className="absolute inset-0 dark:hidden">
        <ThemePicture
          mobileSrc={IMG.mobileLight}
          desktopSrc={IMG.desktopLight}
        />
      </div>
      {/* Dark — only when .dark is set */}
      <div className="absolute inset-0 hidden dark:block">
        <ThemePicture
          mobileSrc={IMG.mobileDark}
          desktopSrc={IMG.desktopDark}
        />
      </div>
      {/* The hero extends to 110dvh; dissolve its last 20dvh into the
          page token so the transition to HomeMarketing has no hard
          image edge in either theme. Keep this inside the art layer,
          below the z-10 copy. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[20dvh] bg-gradient-to-b from-transparent via-background/55 to-background" />
    </div>
  );
}

/**
 * Colours the iOS 26 browser chrome to match the top of the hero art.
 *
 * Safari 26 samples the `background-color` of a fixed/sticky element
 * near a viewport edge to tint its own chrome, and falls back to
 * <body> when there is none — which is why the status bar sat above
 * the photo as a cream `--background` strip. Content can't be painted
 * into that band from a browser tab, so the fix is to give Safari a
 * strip of the right colour to sample. `--hero-chrome-tint` carries
 * the measured edge colour of the four masters above (app/globals.css).
 *
 * Three details are load-bearing:
 *
 * - **sticky, not fixed.** The strip stops sticking when the hero
 *   scrolls past, so Safari falls back to <body> exactly when the
 *   cream marketing sections take the screen. A fixed strip would
 *   hold the photo's colour over the whole page.
 * - **6px tall, full width.** Safari ignores candidates under ~3px
 *   high or much narrower than the viewport; 6px clears the bar with
 *   room to spare. It renders above the photo (rather than hiding
 *   behind it) so the sampler can't be optimised out of the render
 *   tree — and since it wears the photo's own edge colour, it reads
 *   as part of the status bar, not as a line across the art.
 * - **`-mb-1.5` cancels its own height** so it costs the hero no
 *   layout, and no `opacity` / `backdrop-filter` / pseudo-element,
 *   each of which disqualifies an element from being sampled.
 */
export function HeroChromeTint() {
  return (
    <div
      aria-hidden
      className="pointer-events-none sticky top-0 z-20 -mb-1.5 h-1.5 w-full bg-[var(--hero-chrome-tint)]"
    />
  );
}
