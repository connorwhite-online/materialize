"use client";

import { useEffect, useState } from "react";

interface MetaballLoaderProps {
  size?: number;
  count?: number;
  spin?: number;
  breath?: number;
}

/**
 * Gooey metaball SVG loader for page transitions.
 *
 * A filled dot buds outward into smaller balls via a gooey filter,
 * while the whole cluster rotates. Then it collapses back. Pure SMIL
 * animation off the main thread; respects prefers-reduced-motion.
 *
 * Color inherits from currentColor (foreground ink in light/dark).
 */
export function MetaballLoader({
  size = 64,
  count = 5,
  spin = 4.5,
  breath = 1.8,
}: MetaballLoaderProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (prefersReducedMotion) {
    // Static pulsing dot for reduced motion
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        role="img"
        aria-label="Loading"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <style>{`
          @keyframes pulse-dot {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
        `}</style>
        <circle cx="60" cy="60" r="20" fill="currentColor" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
      </svg>
    );
  }

  // Build the animated metaball
  const cx = 60;
  const cy = 60;
  const uid = Math.random().toString(36).slice(2, 9);
  const filterId = `goo-${uid}`;

  // Spline for smooth easing (cubic-bezier ease-in-out)
  const ease = "0.45 0 0.55 1;0.45 0 0.55 1";

  // Satellites: positioned radially, animate outward (cx) and grow (r)
  let satellites = "";
  for (let i = 0; i < count; i++) {
    const angle = (360 / count) * i;
    satellites += `
      <g transform="rotate(${angle} ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="3" fill="currentColor">
          <animate attributeName="cx" dur="${breath}s" repeatCount="indefinite"
            values="${cx};${cx + 34};${cx}" keyTimes="0;0.5;1"
            calcMode="spline" keySplines="${ease}"/>
          <animate attributeName="r" dur="${breath}s" repeatCount="indefinite"
            values="2.5;10;2.5" keyTimes="0;0.5;1"
            calcMode="spline" keySplines="${ease}"/>
        </circle>
      </g>`;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Loading"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="b" />
          <feColorMatrix
            in="b"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
          />
        </filter>
      </defs>
      <g>
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur={`${spin}s`}
          repeatCount="indefinite"
        />
        <g filter={`url(#${filterId})`}>
          <circle cx={cx} cy={cy} r="20" fill="currentColor">
            <animate
              attributeName="r"
              dur={`${breath}s`}
              repeatCount="indefinite"
              values="22;13;22"
              keyTimes="0;0.5;1"
              calcMode="spline"
              keySplines={ease}
            />
          </circle>
          {/* Render satellites as HTML to avoid dangerouslySetInnerHTML */}
          {Array.from({ length: count }).map((_, i) => {
            const angle = (360 / count) * i;
            return (
              <g key={i} transform={`rotate(${angle} ${cx} ${cy})`}>
                <circle cx={cx} cy={cy} r="3" fill="currentColor">
                  <animate
                    attributeName="cx"
                    dur={`${breath}s`}
                    repeatCount="indefinite"
                    values={`${cx};${cx + 34};${cx}`}
                    keyTimes="0;0.5;1"
                    calcMode="spline"
                    keySplines={ease}
                  />
                  <animate
                    attributeName="r"
                    dur={`${breath}s`}
                    repeatCount="indefinite"
                    values="2.5;10;2.5"
                    keyTimes="0;0.5;1"
                    calcMode="spline"
                    keySplines={ease}
                  />
                </circle>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
