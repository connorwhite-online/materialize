"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper for MaterialPreview on the /print quote configurator.
 *
 * MaterialPreview → ModelViewer statically imports three,
 * @react-three/fiber, @react-three/drei and the STL/OBJ/3MF loaders.
 * quote-configurator.tsx imported it directly, so all of that sat in
 * the /print route's initial bundle — the hot path every quote goes
 * through — even though the price request doesn't need the viewer.
 *
 * Same pattern as order-model-preview-lazy.tsx: `ssr: false` moves
 * the chunk off the critical path. The caller's `aspect-[4/3]` slot
 * already reserves the height, so the placeholder just fills it and
 * there is no layout shift when the viewer mounts.
 */
export const MaterialPreviewLazy = dynamic(
  () =>
    import("@/components/viewer/material-preview").then(
      (m) => m.MaterialPreview
    ),
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
