"use client";

import { useLoader } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { MaterializeMaterial } from "../materialize-material";

interface StlModelProps {
  url: string;
  color?: string;
  useCustomShader?: boolean;
}

export function StlModel({ url, color = "#a0a0a0", useCustomShader = true }: StlModelProps) {
  const geometry = useLoader(STLLoader, url);

  return (
    <mesh geometry={geometry}>
      {useCustomShader ? (
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
