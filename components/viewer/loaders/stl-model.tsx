"use client";

import { useEffect } from "react";
import { useLoader } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { BufferGeometry, Plane } from "three";
import { MaterializeMaterial } from "../materialize-material";

interface StlModelProps {
  url: string;
  color?: string;
  useCustomShader?: boolean;
  /**
   * Active cross-section planes. The custom shader doesn't implement clip
   * planes, so when a cross-section is on we fall back to the (clip-capable)
   * physical material and render double-sided so the exposed interior walls
   * are visible rather than back-face-culled.
   */
  clippingPlanes?: Plane[];
  /** Fires with the loaded geometry so callers can measure its bounds. */
  onGeometry?: (geometry: BufferGeometry) => void;
}

export function StlModel({
  url,
  color = "#a0a0a0",
  useCustomShader = true,
  clippingPlanes,
  onGeometry,
}: StlModelProps) {
  const geometry = useLoader(STLLoader, url);

  useEffect(() => {
    onGeometry?.(geometry);
  }, [geometry, onGeometry]);

  const clip = !!clippingPlanes && clippingPlanes.length > 0;

  return (
    <mesh geometry={geometry}>
      {useCustomShader || clip ? (
        // The custom shader is self-lit and (now) clipping-capable, so the
        // cross-section looks identical to the normal view — just cut — rather
        // than going black under a lit material with no environment map.
        <MaterializeMaterial
          baseColor={color}
          clippingPlanes={clip ? clippingPlanes : undefined}
        />
      ) : (
        <meshPhysicalMaterial
          color={color}
          metalness={0.35}
          roughness={0.38}
          clearcoat={0.4}
          clearcoatRoughness={0.25}
        />
      )}
    </mesh>
  );
}
