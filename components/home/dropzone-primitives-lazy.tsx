"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper for the featured dropzone's backdrop: isometric drawings
 * of machine parts (`dropzone-parts.tsx`), baked to images by the shared
 * renderer in `lib/isometric`.
 *
 * That path pulls in three.js, so `next/dynamic` with `ssr: false`
 * keeps it off the critical path — the dashed well and copy paint
 * immediately and the drawings arrive after hydrate. The backdrop is
 * absolutely positioned, so there's no CLS when it lands. See
 * node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md —
 * `ssr: false` is only legal in a Client Component.
 */
export const DropzonePrimitives = dynamic(
  () => import("./dropzone-parts").then((m) => m.DropzoneParts),
  {
    ssr: false,
    // Line drawings in the page's own ink: an empty well while the
    // chunk loads reads better than a coloured stand-in swapping out.
    loading: () => null,
  }
);
