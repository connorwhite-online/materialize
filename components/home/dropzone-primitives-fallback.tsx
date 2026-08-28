import { DROPZONE_LOOKS, DROPZONE_PRIMITIVES } from "./dropzone-looks";

/**
 * CSS stand-in for the WebGL primitives — used as the lazy-load
 * placeholder and as the ErrorBoundary fallback so a missing WebGL
 * context still leaves the dropzone looking designed, not empty.
 *
 * Decorative only (`aria-hidden`); the file input remains the control.
 * Soft material-colored gradients stand in for stainless / resin / nylon.
 */
export function DropzonePrimitivesFallback() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {DROPZONE_PRIMITIVES.map((primitive) => {
        const look = DROPZONE_LOOKS[primitive.look];
        // Soft material stand-ins: metal flash, cream resin, sand nylon.
        const highlight =
          look.metalness > 0.5
            ? "#d8d8d8"
            : look.transmission
              ? "#f4f0e6"
              : "#e8dfd0";
        const shadow =
          look.metalness > 0.5
            ? "#5a5a5a"
            : look.transmission
              ? "#b8ad96"
              : "#8a7a62";
        return (
          <span
            key={primitive.look}
            className={`absolute ${primitive.fallbackClass}`}
            style={{
              background: `linear-gradient(145deg, ${highlight} 0%, ${look.color} 45%, ${shadow} 100%)`,
            }}
          />
        );
      })}
    </div>
  );
}
