import { DROPZONE_LOOKS, DROPZONE_PRIMITIVES } from "./dropzone-looks";

/**
 * CSS stand-in for the WebGL primitives — used as the lazy-load
 * placeholder and as the ErrorBoundary fallback so a missing WebGL
 * context still leaves the dropzone looking designed, not empty.
 *
 * Decorative only (`aria-hidden`); the file input remains the control.
 */
export function DropzonePrimitivesFallback() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {DROPZONE_PRIMITIVES.map((primitive) => {
        const look = DROPZONE_LOOKS[primitive.look];
        const transmissive = (look.transmission ?? 0) > 0.4;
        return (
          <span
            key={primitive.look}
            className={`absolute opacity-70 blur-[0.5px] ${primitive.fallbackClass}`}
            style={{
              background: transmissive
                ? `radial-gradient(circle at 35% 30%, #fff 0%, ${look.color} 55%, ${look.color}99 100%)`
                : look.metalness > 0.5
                  ? `linear-gradient(145deg, #fff6 0%, ${look.color} 42%, #0006 100%)`
                  : `linear-gradient(160deg, #fff4 0%, ${look.color} 60%, ${look.color}cc 100%)`,
              boxShadow: transmissive
                ? `0 8px 18px ${look.color}55`
                : `0 10px 20px rgba(0,0,0,0.35)`,
            }}
          />
        );
      })}
    </div>
  );
}
