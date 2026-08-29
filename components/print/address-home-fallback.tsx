"use client";

/**
 * CSS stand-in for the WebGL cartoon home — lazy-load placeholder
 * and ErrorBoundary fallback so a missing WebGL context still shows
 * white walls, a red front door, chimney smoke, and a mailbox. The
 * 3D scene paints over this once the canvas is ready.
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
            rx="52"
            ry="8"
            fill="#000"
            fillOpacity="0.1"
          />
          <ellipse
            cx="80"
            cy="140"
            rx="50"
            ry="10"
            fill="#7cb07a"
            data-testid="address-home-lawn"
          />
          <path
            d="M28 78 L80 28 L132 78 Z"
            fill="#6b4a3a"
            stroke="#4a3226"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <rect
            x="104"
            y="36"
            width="16"
            height="28"
            rx="3"
            fill="#8a5a48"
            stroke="#5c3b2e"
            strokeWidth="1"
            data-testid="address-home-chimney"
          />
          <rect x="102" y="32" width="20" height="8" rx="2" fill="#5c3b2e" />
          <circle cx="116" cy="28" r="4.5" fill="#f4f1ea" fillOpacity="0.7" />
          <circle cx="120" cy="20" r="5.5" fill="#f4f1ea" fillOpacity="0.5" />
          <circle cx="124" cy="12" r="6.5" fill="#f4f1ea" fillOpacity="0.32" />
          <circle
            cx="80"
            cy="52"
            r="6"
            fill="#b8d4e8"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <rect
            x="40"
            y="78"
            width="80"
            height="56"
            rx="10"
            fill="url(#mz-home-wall)"
            stroke="#e4dfd4"
            strokeWidth="1.2"
          />
          <rect
            x="62"
            y="92"
            width="36"
            height="42"
            rx="6"
            fill="#efe8dc"
          />
          <rect
            x="66"
            y="96"
            width="28"
            height="38"
            rx="5"
            fill="#d62828"
            stroke="#9e1b1b"
            strokeWidth="1.1"
            data-testid="address-home-door"
          />
          <rect x="70" y="100" width="20" height="12" rx="2" fill="#c41e1e" />
          <rect x="70" y="116" width="20" height="12" rx="2" fill="#c41e1e" />
          <circle cx="88" cy="116" r="2.2" fill="#f0d78c" />
          <rect x="58" y="132" width="44" height="6" rx="2" fill="#e8e2d6" />
          <rect x="52" y="136" width="56" height="5" rx="2" fill="#ddd6c8" />
          <rect
            x="48"
            y="92"
            width="14"
            height="14"
            rx="3"
            fill="#b8d4e8"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <rect
            x="98"
            y="92"
            width="14"
            height="14"
            rx="3"
            fill="#b8d4e8"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <rect x="46" y="106" width="18" height="6" rx="1.5" fill="#c9a06a" />
          <rect x="96" y="106" width="18" height="6" rx="1.5" fill="#c9a06a" />
          <circle cx="50" cy="105" r="2.2" fill="#e24b4b" />
          <circle cx="55" cy="104" r="2.2" fill="#f4d35e" />
          <circle cx="60" cy="105" r="2.2" fill="#e24b4b" />
          <circle cx="100" cy="105" r="2.2" fill="#e24b4b" />
          <circle cx="105" cy="104" r="2.2" fill="#f4d35e" />
          <circle cx="110" cy="105" r="2.2" fill="#e24b4b" />
          <line
            x1="55"
            y1="92"
            x2="55"
            y2="106"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <line
            x1="48"
            y1="99"
            x2="62"
            y2="99"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <line
            x1="105"
            y1="92"
            x2="105"
            y2="106"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <line
            x1="98"
            y1="99"
            x2="112"
            y2="99"
            stroke="#8aa8bc"
            strokeWidth="1"
          />
          <rect x="22" y="118" width="3" height="18" rx="1" fill="#c4b8a0" />
          <rect
            x="16"
            y="110"
            width="15"
            height="10"
            rx="3"
            fill="#3d6b9a"
            data-testid="address-home-mailbox"
          />
          <rect x="19" y="107" width="6" height="2" rx="0.5" fill="#d62828" />
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
