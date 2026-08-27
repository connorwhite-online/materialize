import { DROPZONE_LOOKS, DROPZONE_PRIMITIVES } from "./dropzone-looks";
import { TOON_INK } from "./dropzone-toon";

/**
 * CSS stand-in for the WebGL primitives — used as the lazy-load
 * placeholder and as the ErrorBoundary fallback so a missing WebGL
 * context still leaves the dropzone looking designed, not empty.
 *
 * Decorative only (`aria-hidden`); the file input remains the control.
 * Flat fill + ink ring is the no-WebGL stand-in; the canvas shades
 * a colored cel ramp. The CSS gradient uses the same tints as hard
 * stops so the stand-in still reads as cartoon paint.
 */
export function DropzonePrimitivesFallback() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {DROPZONE_PRIMITIVES.map((primitive) => {
        const look = DROPZONE_LOOKS[primitive.look];
        return (
          <span
            key={primitive.look}
            className={`absolute ${primitive.fallbackClass}`}
            style={{
              background: `linear-gradient(145deg, ${look.toonHighlight} 0%, ${look.toonHighlight} 28%, ${look.toonColor} 28%, ${look.toonColor} 60%, ${look.toonShadow} 60%, ${look.toonShadow} 100%)`,
              boxShadow: `0 0 0 2px ${TOON_INK}`,
            }}
          />
        );
      })}
    </div>
  );
}
