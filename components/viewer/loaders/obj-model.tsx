"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";
import { MaterializeMaterial } from "../materialize-material";

interface ObjModelProps {
  url: string;
  color?: string;
  useCustomShader?: boolean;
}

export function ObjModel({ url, color = "#a0a0a0", useCustomShader = true }: ObjModelProps) {
  const obj = useLoader(OBJLoader, url);

  // Extract all geometries from the OBJ group
  const geometries = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        geos.push(child.geometry);
      }
    });
    return geos;
  }, [obj]);

  return (
    <group>
      {geometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
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
      ))}
    </group>
  );
}
