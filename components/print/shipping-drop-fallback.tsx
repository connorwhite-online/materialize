"use client";

/**
 * CSS stand-in for the WebGL chunky parachute box — lazy-load
 * placeholder and ErrorBoundary fallback. Matches the 3D: one fat
 * hemisphere, thick strings, very round cardboard box.
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
          <path
            d="M28 86 A52 52 0 0 1 132 86 Z"
            fill="#e24b4b"
          />
          <path
            d="M30 86 A50 8 0 0 0 130 86"
            fill="none"
            stroke="#f4efe6"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <line
            x1="48"
            y1="86"
            x2="64"
            y2="114"
            stroke="#8a7355"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="80"
            y1="86"
            x2="80"
            y2="114"
            stroke="#8a7355"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="112"
            y1="86"
            x2="96"
            y2="114"
            stroke="#8a7355"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="42"
            y="108"
            width="76"
            height="54"
            rx="18"
            fill="url(#mz-box-grad)"
            stroke="#9a7342"
            strokeWidth="1.2"
          />
          <rect
            x="70"
            y="108"
            width="20"
            height="54"
            rx="4"
            fill="#f0e2c0"
            fillOpacity="0.95"
          />
          <ellipse
            cx="80"
            cy="170"
            rx="42"
            ry="7"
            fill="#000"
            fillOpacity="0.12"
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
