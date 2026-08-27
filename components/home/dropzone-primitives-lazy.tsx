"use client";

import dynamic from "next/dynamic";
import { DropzonePrimitivesFallback } from "./dropzone-primitives-fallback";

/**
 * Lazy wrapper for the authed-home dropzone's WebGL primitives.
 *
 * DropzonePrimitives pulls in three.js, @react-three/fiber, and the
 * studio IBL (~the same chunk as the unmounted marketing hero). The
 * authed home used to ship none of that. `next/dynamic` with
 * `ssr: false` keeps it off the critical path — the dashed dropzone
 * and copy paint immediately; the canvas arrives after hydrate.
 *
 * The CSS fallback reserves no extra height (it's absolutely
 * positioned inside the dropzone) so there's no CLS when the chunk
 * lands. See node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md
 * — `ssr: false` is only legal in a Client Component.
 */
export const DropzonePrimitives = dynamic(
  () => import("./dropzone-primitives").then((m) => m.DropzonePrimitives),
  {
    ssr: false,
    loading: () => <DropzonePrimitivesFallback />,
  }
);
