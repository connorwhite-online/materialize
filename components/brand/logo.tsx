import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import {
  MARK_PATH,
  MARK_VIEWBOX,
  WORDMARK_GLYPHS,
  WORDMARK_MARK_WIDTH,
  WORDMARK_VIEWBOX,
} from "./logo-paths";

/**
 * The three brand logo surfaces. All of them draw from `logo-paths.ts`, so
 * re-exporting a new SVG from the design file updates every instance in the
 * app at once — see that file's header for the update procedure.
 *
 * Theming: every variant paints with `fill="currentColor"`, so the logo takes
 * the surrounding text color. Put it inside `text-foreground` (or any other
 * token) and it follows light/dark automatically — there is no hardcoded hex
 * anywhere in this file.
 *
 * Sizing: all variants are driven by a single `height` in px. Width is derived
 * from the artwork's aspect ratio, so a logo never distorts and never needs a
 * magic width alongside it.
 */

/** Intrinsic artwork dimensions, from the viewBoxes. */
const ART_HEIGHT = 251;
/** Kept in sync with the `--mz-h` default in globals.css. */
const DEFAULT_LOGO_HEIGHT = 20;
const MARK_ASPECT = WORDMARK_MARK_WIDTH / ART_HEIGHT; // ~1.65
const WORDMARK_ASPECT = 3479 / ART_HEIGHT; // ~13.86

type BaseProps = Omit<SVGProps<SVGSVGElement>, "height" | "viewBox"> & {
  /** Rendered height in px. Width follows the artwork's aspect ratio. */
  height?: number;
  /**
   * Accessible name. Omit for decorative instances sitting next to a text
   * label (the default), pass e.g. "Materialize" when the logo IS the label.
   */
  title?: string;
};

/** Shared a11y wiring: labelled `img` when titled, hidden when not. */
function a11yProps(title: string | undefined) {
  return title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
}

/**
 * The "M" alone. The compact mark — use it wherever there isn't horizontal
 * room for the full word (nav rail, avatars, badge tiles, favicons).
 */
export function Logomark({ height = 20, title, ...props }: BaseProps) {
  return (
    <svg
      height={height}
      width={height * MARK_ASPECT}
      viewBox={MARK_VIEWBOX}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...a11yProps(title)}
      {...props}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}

/**
 * The full "materialize" wordmark, static. Use where the brand needs to be
 * spelled out and there's no reason to animate (dense headers, print, email).
 */
export function Wordmark({ height = 20, title, ...props }: BaseProps) {
  return (
    <svg
      height={height}
      width={height * WORDMARK_ASPECT}
      viewBox={WORDMARK_VIEWBOX}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...a11yProps(title)}
      {...props}
    >
      {WORDMARK_GLYPHS.map((glyph, i) => (
        <path key={`${glyph.letter}-${i}`} d={glyph.d} />
      ))}
    </svg>
  );
}

export interface AnimatedWordmarkProps extends BaseProps {
  /**
   * `true` renders the full word, `false` crops to the "M" alone. Flipping it
   * plays the reveal in reverse — this is the prop to drive from hover, an
   * intersection observer, a route change, whatever.
   *
   * Expanding reveals letters left → right; collapsing peels them off
   * right → left, so the word always resolves toward the mark it started as.
   */
  expanded?: boolean;
  /**
   * Play the reveal once on first paint instead of tracking `expanded`. Pure
   * CSS keyframes — no JS, no hydration flash, and the wordmark still ends up
   * fully painted with scripting disabled. Ignored when `expanded` is set.
   */
  animateOnMount?: boolean;
}

/**
 * Height for the animated lockup can also come from CSS: it sizes itself from
 * a `--mz-h` custom property, and the widths are derived from it in
 * `globals.css`. So a consumer that needs a responsive lockup can skip the
 * `height` prop entirely and set the variable per breakpoint, e.g.
 * `className="[--mz-h:15px] sm:[--mz-h:20px]"`.
 */

/**
 * The animated lockup: the "M" is always solid, and the remaining letters
 * blow in left-to-right — each one blurred and lifted, then settling as a
 * bottom-to-top wipe fills it in, like snow drifting across the word and
 * sticking. It doubles as the transition between the two static variants:
 * collapsed it *is* the logomark, expanded it *is* the wordmark.
 *
 * Performance: no JS animation, no `requestAnimationFrame`, no motion
 * library. Everything is CSS transitions and keyframes declared once in
 * `app/globals.css` (`.mz-logo-*`), staggered by a `--mz-i` custom property
 * per letter. The animating layout properties are the wrapper's width and
 * height, on a single absolutely-sized element. `prefers-reduced-motion`
 * collapses the whole thing to an instant state change.
 *
 * Collapsing crops the wrapper to the mark and scales the SVG up slightly
 * (`--mz-mark-scale` in globals.css) so the "M" ends up taller than the
 * word was — it reads as absorbing the letters as they peel off. The SVG
 * itself is always the full wordmark at the requested height; scale and
 * crop are CSS on top of that.
 */
export function AnimatedWordmark({
  height,
  title,
  expanded,
  animateOnMount = false,
  className,
  style,
  ...props
}: AnimatedWordmarkProps) {
  // `height` is written to --mz-h as an inline style, and inline styles beat
  // stylesheet rules — so setting it unconditionally would silently defeat the
  // responsive `[--mz-h:…]` class escape hatch. Emit the variable only when a
  // caller actually asked for a fixed height; otherwise let the class (or the
  // default in globals.css) own it.
  const fallbackHeight = height ?? DEFAULT_LOGO_HEIGHT;
  // `expanded` wins when provided; otherwise the mount animation decides.
  // With neither, the component is just a static wordmark.
  const controlled = expanded !== undefined;
  const isExpanded = controlled ? expanded : true;
  const mode = controlled || !animateOnMount ? "toggle" : "mount";

  return (
    <span
      className={cn("mz-logo", className)}
      data-mz-mode={mode}
      data-mz-expanded={isExpanded ? "true" : "false"}
      style={{
        ...(height !== undefined
          ? { ["--mz-h" as string]: `${height}px` }
          : null),
        ...style,
      }}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      {/* The width/height attributes are the pre-CSS fallback; the real
          sizing comes from --mz-h in globals.css so it stays responsive. */}
      <svg
        height={fallbackHeight}
        width={fallbackHeight * WORDMARK_ASPECT}
        viewBox={WORDMARK_VIEWBOX}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {WORDMARK_GLYPHS.map((glyph, i) => {
          // Index 0 is the "M" — it is the persistent mark and never
          // animates, so it renders outside the staggered group.
          if (i === 0) return <path key="mark" d={glyph.d} />;
          // Two nested elements, deliberately: rendering order is
          // filter → clip, so the blur has to live on an ancestor of the
          // clipped path. Flattened onto one element, the clip would shave
          // the blur back to the letter's silhouette and the halo — the
          // part that reads as "drifting in" — would never be visible.
          return (
            <g
              key={`${glyph.letter}-${i}`}
              className="mz-logo-letter"
              style={{
                // Forward index paces the reveal (left → right); the
                // reverse index paces the collapse (right → left). Both
                // inherit down to the clipped path.
                ["--mz-i" as string]: i - 1,
                ["--mz-r" as string]: WORDMARK_GLYPHS.length - 1 - i,
              }}
            >
              <path className="mz-logo-letter-clip" d={glyph.d} />
            </g>
          );
        })}
      </svg>
    </span>
  );
}
