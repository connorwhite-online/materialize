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
      // used to carry were clipped away and never bought a pixel. In a
      // Safari tab the unsafe areas aren't ours to paint into at all —
      // the status-bar band is chrome, and the only lever is the colour
      // Safari fills it with (`--hero-chrome-tint`, app/globals.css).
      // In a home-screen app `viewport-fit: cover` already stretches
      // the layout viewport over them, so inset-0 covers both.
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
    </div>
  );
}
