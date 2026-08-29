"use client";

/**
 * CSS stand-in for the WebGL chunky toy house — lazy-load placeholder
 * and ErrorBoundary fallback. Matches the 3D composition: fat white
 * body, pyramid roof, red door, chimney, two windows.
 */

export function addressHomeAriaLabel(): string {
  return "Cartoon house with a red front door";
}

export function AddressHomeFallback() {
  return (
    <div aria-hidden="true" className="mz-addr-home">
      <div className="mz-addr-home-scene">
        <svg
          viewBox="0 0 160 160"
          width="100%"
          height="100%"
          className="mz-addr-home-svg"
          data-testid="address-home-fallback-svg"
        >
          <ellipse
            cx="80"
            cy="144"
            rx="48"
            ry="8"
            fill="#000"
            fillOpacity="0.12"
          />
          <path
            d="M22 86 L80 24 L138 86 Z"
            fill="#6b4a3a"
            stroke="#4a3226"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <rect
            x="104"
            y="34"
            width="20"
            height="34"
            rx="6"
            fill="#8a5a48"
            stroke="#5c3b2e"
            strokeWidth="1"
            data-testid="address-home-chimney"
          />
          <rect
            x="34"
            y="82"
            width="92"
            height="58"
            rx="16"
            fill="url(#mz-home-wall)"
            stroke="#e4dfd4"
            strokeWidth="1.2"
          />
          <rect
            x="64"
            y="96"
            width="32"
            height="44"
            rx="9"
            fill="#d62828"
            stroke="#9e1b1b"
            strokeWidth="1.1"
            data-testid="address-home-door"
          />
          <circle cx="88" cy="120" r="3.5" fill="#f0d78c" />
          <rect
            x="42"
            y="94"
            width="18"
            height="18"
            rx="6"
            fill="#b8d4e8"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <rect
            x="100"
            y="94"
            width="18"
            height="18"
            rx="6"
            fill="#b8d4e8"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <defs>
            <linearGradient id="mz-home-wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#fff4e8" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}
