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
    key.intensity = 1.7 + w * 0.6;
  });

  return (
    <>
      {/* Cinematic three-point-ish rig with warm/cool colour contrast:
          a strong WARM key, a dim COOL fill (so shadows read blue, not
          black), and a bright COOL rim from behind to pop the silhouette
          off the dark background. Faint cool ambient + a dimmed IBL keep
          metals reflective without washing the whole thing flat. */}
      <ambientLight intensity={0.05} color="#aebbd6" />
      <directionalLight ref={keyRef} position={KEY_HOME.toArray()} intensity={1.7} color="#fff2e2" />
      <directionalLight position={[-5, -1, -3]} intensity={0.22} color="#9fb6e6" />
      <directionalLight position={[-1.5, 3.5, -5]} intensity={1.5} color="#dce8ff" />
      <StudioEnvironment intensity={0.3} keyBias={1.5} />
    </>
  );
}
