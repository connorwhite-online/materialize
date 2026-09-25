"use client";

import dynamic from "next/dynamic";

// three.js + R3F + drei only serve the anon landing. `ssr: false` keeps
// them off the critical path — the copy paints first and the enclosure
// arrives behind it. Must live in a client component (server components
// can't disable SSR). The stage is fixed and out of flow, so there's no
// footprint to reserve and nothing shifts when it lands.
export const EnclosureStage = dynamic(
  () => import("./enclosure-stage").then((m) => m.EnclosureStage),
  { ssr: false, loading: () => null },
);
