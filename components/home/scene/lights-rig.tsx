"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { StudioEnvironment } from "@/components/viewer/studio-environment";
import { useStage } from "./stage-context";
import { STAGE, stageWeight } from "./constants";

// Key light's home position (top-front studio) and its Materials-stage
// target — lerped toward the camera so the swatches are lit head-on.
const KEY_HOME = new THREE.Vector3(4, 5, 5);
const KEY_CAMERA = new THREE.Vector3(0, 0.5, 5);

/**
 * Lighting for the persistent scene. Procedural studio IBL plus a key
 * directional light that lerps from a three-quarter studio angle toward
 * the camera as the reader enters the Materials stage — so the fanned
 * swatches get lit "from where you're looking", per the brief.
 */
export function LightsRig() {
  const { stageRef } = useStage();
  const keyRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const key = keyRef.current;
    if (!key) return;
    const w = stageWeight(stageRef.current, STAGE.MATERIALS);
    key.position.lerpVectors(KEY_HOME, KEY_CAMERA, w);
    key.intensity = 2.0 + w * 0.8;
  });

  return (
    <>
      {/* Low ambient + a strong key for a dramatic, high-contrast look;
          the IBL is dimmed (less wrap-around fill) but still gives metals
          their reflections. */}
      <ambientLight intensity={0.12} />
      <directionalLight ref={keyRef} position={KEY_HOME.toArray()} intensity={2.0} />
      <directionalLight position={[-5, -3, -5]} intensity={0.18} />
      <directionalLight position={[0, -5, 2]} intensity={0.12} />
      <StudioEnvironment intensity={0.5} keyBias={1.3} />
    </>
  );
}
