"use client";

import { useEffect } from "react";
import { useLoader } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { DoubleSide, type BufferGeometry, type Plane } from "three";
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
      {clip ? (
        // Matte, non-metallic + double-sided so the exposed interior is fully
        // lit by the scene's lights. A metallic material would render black
        // here because there's no environment map to reflect.
        <meshStandardMaterial
          color={color}
          metalness={0}
          roughness={0.6}
          side={DoubleSide}
          clippingPlanes={clippingPlanes}
          clipShadows
        />
      ) : useCustomShader ? (
        <MaterializeMaterial baseColor={color} />
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
