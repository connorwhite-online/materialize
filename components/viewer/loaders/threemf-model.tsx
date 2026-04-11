"use client";

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import * as THREE from "three";
import { MaterializeMaterial } from "../materialize-material";

interface ThreeMfModelProps {
  url: string;
  color?: string;
}

export function ThreeMfModel({ url, color = "#a0a0a0" }: ThreeMfModelProps) {
  const group = useLoader(ThreeMFLoader, url);

  const geometries = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        geos.push(child.geometry);
      }
    });
    return geos;
  }, [group]);

  return (
    <group>
      {geometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <MaterializeMaterial baseColor={color} />
        </mesh>
      ))}
    </group>
  );
}
