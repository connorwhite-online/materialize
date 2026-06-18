"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper for the shared ModelViewer, used by the text-to-CAD studio.
 *
 * ModelViewer statically pulls in @react-three/fiber, drei, three-stdlib,
 * and the STL/OBJ/3MF loaders (~hundreds of KB). next/dynamic with
 * `ssr: false` keeps that off the initial bundle and out of SSR (the
 * Canvas needs the browser). Same approach as
 * components/print/order-model-preview-lazy.tsx.
 */
export const CadModelViewerLazy = dynamic(
  () => import("@/components/viewer/model-viewer").then((m) => m.ModelViewer),
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
