"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper for OrderModelPreview.
 *
 * OrderModelPreview → MaterialPreview → ModelViewer statically imports
 * @react-three/fiber, @react-three/drei, three-stdlib, and the STL/OBJ/
 * 3MF loaders (~200-400 KB gzipped). Visitors to /files/[slug] who
 * never interact with the 3D viewer would still download all of that.
 *
 * next/dynamic with `ssr: false` moves the chunk off the critical path:
 * the initial HTML renders the skeleton immediately; three.js arrives
 * only after the page hydrates and the dynamic import fires. (CON-139)
 *
 * The skeleton is sized to the `aspect-[4/3]` preview slot so there
 * is no CLS when the viewer mounts.
 */
export const OrderModelPreviewLazy = dynamic(
  () =>
    import("./order-model-preview").then((m) => m.OrderModelPreview),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full w-full items-center justify-center"
        aria-hidden
      >
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground/40" />
      </div>
    ),
  }
);
