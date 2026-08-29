"use client";

/**
 * CSS stand-in for the WebGL parachute-box — lazy-load placeholder
 * and ErrorBoundary fallback so a missing WebGL context still shows
 * the same composition: canopy above, strings, chubby cardboard box.
 * The 3D scene paints over this once the canvas is ready.
 */

export function shippingDropAriaLabel(): string {
  return "Cardboard package descending on a parachute";
}

export function ShippingDropFallback() {
  return (
    <div aria-hidden="true" className="mz-ship-drop">
      <div className="mz-ship-drop-scene">
        <svg
          viewBox="0 0 160 180"
          width="100%"
          height="100%"
          className="mz-ship-drop-svg"
          data-testid="shipping-drop-fallback-svg"
        >
          {/* Canopy gores */}
          <path
            d="M40 62 C48 28, 72 18, 80 18 C78 34, 62 52, 52 62 Z"
            fill="#e24b4b"
          />
          <path
            d="M52 62 C62 40, 74 24, 80 18 C86 24, 98 40, 108 62 Z"
            fill="#f4efe6"
          />
          <path
            d="M108 62 C98 52, 82 34, 80 18 C88 18, 112 28, 120 62 Z"
            fill="#3d6b9a"
          />
          {/* Canopy rim */}
          <ellipse
            cx="80"
            cy="62"
            rx="40"
            ry="8"
            fill="#c9a06a"
            fillOpacity="0.55"
          />
          {/* Strings */}
          <g
            stroke="#8a7355"
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          >
            <line x1="48" y1="64" x2="62" y2="108" />
            <line x1="68" y1="64" x2="72" y2="108" />
            <line x1="92" y1="64" x2="88" y2="108" />
            <line x1="112" y1="64" x2="98" y2="108" />
          </g>
          {/* Chubby box */}
          <rect
            x="48"
            y="104"
            width="64"
            height="52"
            rx="12"
            fill="url(#mz-box-grad)"
            stroke="#9a7342"
            strokeWidth="1.2"
          />
          {/* Tape */}
          <rect
            x="74"
            y="104"
            width="12"
            height="52"
            fill="#f0e2c0"
            fillOpacity="0.9"
          />
          {/* Flap crease */}
          <line
            x1="52"
            y1="118"
            x2="108"
            y2="118"
            stroke="#9a7342"
            strokeOpacity="0.45"
            strokeWidth="1.2"
          />
          <defs>
            <linearGradient id="mz-box-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e2bf86" />
              <stop offset="0.45" stopColor="#c89655" />
              <stop offset="1" stopColor="#9a6a35" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}
