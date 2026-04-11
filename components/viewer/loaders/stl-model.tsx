"use client";

import { useLoader } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

interface StlModelProps {
  url: string;
  color?: string;
}

export function StlModel({ url, color = "#a0a0a0" }: StlModelProps) {
  const geometry = useLoader(STLLoader, url);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}
