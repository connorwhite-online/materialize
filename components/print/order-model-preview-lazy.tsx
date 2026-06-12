"use client";

import dynamic from "next/dynamic";

// OrderModelPreview pulls in @react-three/fiber, @react-three/drei,
// three-stdlib, and the STL/OBJ/3MF loaders — hundreds of KB of JS
// that is irrelevant to visitors who never scroll to the 3D viewer.
// Lazy-loading via next/dynamic + ssr:false defers the chunk so the
// rest of the file detail page (metadata, photos, comments) paints
// before the canvas bundle arrives.
//
// The skeleton is sized to the 4:3 slot the viewer occupies (the
// container is aspect-[4/3] in the page) so there's no layout shift
// when the chunk loads. (CON-139)

export const OrderModelPreviewLazy = dynamic(
  () =>
    import("./order-model-preview").then((m) => ({
      default: m.OrderModelPreview,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-2xl bg-muted/40" />
    ),
  }
);
