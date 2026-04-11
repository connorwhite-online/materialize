"use client";

import { useLoader } from "@react-three/fiber";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import * as THREE from "three";

interface ThreeMfModelProps {
  url: string;
  color?: string;
}

export function ThreeMfModel({ url, color = "#a0a0a0" }: ThreeMfModelProps) {
  const group = useLoader(ThreeMFLoader, url);

  // Apply color as fallback if no materials are embedded
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (
        !child.material ||
        (child.material instanceof THREE.MeshPhongMaterial &&
          child.material.color.getHex() === 0xffffff)
      ) {
        child.material = new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
        });
      }
    }
  });

  return <primitive object={group.clone()} />;
}
