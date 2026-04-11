"use client";

import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";

interface ObjModelProps {
  url: string;
  color?: string;
}

export function ObjModel({ url, color = "#a0a0a0" }: ObjModelProps) {
  const obj = useLoader(OBJLoader, url);

  // Apply color to all meshes in the group
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
      });
    }
  });

  return <primitive object={obj.clone()} />;
}
