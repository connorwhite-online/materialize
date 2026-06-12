"use client";

import dynamic from "next/dynamic";

// FileThumbnailGenerator renders a hidden ThumbnailCapture canvas to
// auto-generate a thumbnail for the file owner. It statically imports
// the full three/R3F stack. Only owners of thumbnail-less files ever
// see this, but every visitor to /files/[slug] was previously paying
// for the chunk. Lazy-loading removes it from the route's critical JS.
// (CON-139)

export const FileThumbnailGeneratorLazy = dynamic(
  () =>
    import("./file-thumbnail-generator").then((m) => ({
      default: m.FileThumbnailGenerator,
    })),
  {
    ssr: false,
    loading: () => null,
  }
);
