"use client";

/**
 * Home hero wordmark — "Materialize Anything" rendered as two
 * separate SVGs wrapped in a responsive flex container.
 *
 *   - On narrow viewports (< sm) the container is flex-col so
 *     the two words stack vertically. Each SVG has its own
 *     max-width that tightly bounds the rendered text.
 *
 *   - At sm+ the container becomes flex-row with items-baseline
 *     so the two words sit inline, baselines sharing, and the
 *     whole lockup renders at sm:h-[200px]. shrink-0 on each
 *     SVG prevents flex from compressing them into the parent
 *     max-w-5xl — they can bleed past the parent edges because
 *     nothing in the ancestor chain clips horizontally until
 *     the viewport boundary.
 *
 * Fonts are local OTF files — PP Fuji Bold for "Materialize"
 * (via --font-display) and PP Playground Light for "Anything"
 * (via --font-script), both loaded in app/layout.tsx.
 */
export function HeroWordmark({ className }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none select-none flex flex-col items-center gap-1 sm:flex-row sm:items-baseline sm:justify-center sm:gap-2 ${className ?? ""}`}
      aria-label="Materialize Anything"
    >
      {/* Materialize — PP Fuji Bold. viewBox is wide enough to
          contain the text at fontSize 180 so overflow="visible"
          isn't bleeding glyphs past the SVG element on mobile. */}
      <svg
        viewBox="0 0 1040 200"
        className="w-full max-w-[360px] shrink-0 sm:w-auto sm:h-[170px]"
        overflow="visible"
        textRendering="geometricPrecision"
        shapeRendering="geometricPrecision"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="wordmark-display-gradient"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="var(--foreground)" />
            <stop offset="100%" stopColor="var(--muted-foreground)" />
          </linearGradient>
        </defs>
        <text
          x="520"
          y="160"
          textAnchor="middle"
          fill="url(#wordmark-display-gradient)"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "180px",
            letterSpacing: "-0.02em",
          }}
        >
          Materialize
        </text>
      </svg>

      {/* Anything — PP Playground Light. */}
      <svg
        viewBox="0 0 840 200"
        className="w-full max-w-[280px] shrink-0 sm:w-auto sm:h-[170px]"
        overflow="visible"
        textRendering="geometricPrecision"
        shapeRendering="geometricPrecision"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id="wordmark-script-gradient"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--muted-foreground)" />
          </linearGradient>
        </defs>
        <text
          x="420"
          y="160"
          textAnchor="middle"
          fill="url(#wordmark-script-gradient)"
          style={{
            fontFamily: "var(--font-script), cursive",
            fontWeight: 300,
            fontSize: "190px",
          }}
        >
          Anything
        </text>
      </svg>
    </div>
  );
}
