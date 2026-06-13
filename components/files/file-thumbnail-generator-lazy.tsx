"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper for FileThumbnailGenerator.
 *
 * FileThumbnailGenerator → ThumbnailCapture statically imports
 * @react-three/fiber, @react-three/drei, and the STL/OBJ/3MF loaders.
 * This only renders for the file owner when no thumbnail exists — but
 * the static import still ships three.js in the /files/[slug] route
 * chunk for every visitor. (CON-139)
 *
 * Lazy-loading removes the chunk from the route until it is actually
 * needed. The loading state is null — the generator is offscreen /
 * hidden anyway and there's nothing meaningful to show while it loads.
 */
export const FileThumbnailGeneratorLazy = dynamic(
  () =>
    import("./file-thumbnail-generator").then(
      (m) => m.FileThumbnailGenerator
    ),
  { ssr: false, loading: () => null }
);
