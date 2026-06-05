"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * Self-contained studio lighting for the 3D surfaces.
 *
 * Replaces drei's `Environment preset="studio"`, which fetches an HDR
 * (studio_small_03_1k.hdr) from raw.githack.com at runtime — an external
 * dependency that is CORS-blocked in some environments (Vercel preview/CI)
 * and a single point of failure for the marketing hero.
 *
 * These Lightformers are rendered to an in-memory cubemap on the GPU (PMREM)
 * — no network request — so metallic / clearcoat PBR materials still get
 * realistic softbox reflections everywhere, offline included.
 *
 * Note: intensities/positions are tuned by eye against the old studio preset;
 * adjust here (one place) if the look needs nudging.
 *
 * `intensity` scales all formers — pass < 1 for a darker, more dramatic
 * IBL (less wrap-around fill, deeper shadows) while keeping reflections.
 * `keyBias` extra-boosts just the key softbox to raise contrast.
 */
export function StudioEnvironment({
  intensity = 1,
  keyBias = 1,
}: {
  intensity?: number;
  keyBias?: number;
}) {
  return (
    <Environment resolution={256}>
      {/* Key softbox — broad, bright, front-and-above */}
      <Lightformer
        form="rect"
        intensity={3 * intensity * keyBias}
        position={[0, 2.5, 4]}
        scale={[8, 8, 1]}
      />
      {/* Side fills — wrap reflections around the silhouette */}
      <Lightformer form="rect" intensity={1.2 * intensity} position={[-5, 0, 1]} scale={[3, 8, 1]} />
      <Lightformer form="rect" intensity={1.2 * intensity} position={[5, 0, 1]} scale={[3, 8, 1]} />
      {/* Back rim — defines the edge on metals */}
      <Lightformer form="rect" intensity={1 * intensity} position={[0, 1, -5]} scale={[8, 6, 1]} />
      {/* Soft ground bounce */}
      <Lightformer form="ring" intensity={0.5 * intensity} position={[0, -4, 0]} scale={[10, 10, 1]} />
    </Environment>
  );
}
