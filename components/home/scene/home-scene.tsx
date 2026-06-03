"use client";

import { useMemo, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { MaterialMetadata } from "@/lib/materials/preset-library";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SceneController, useStage } from "./stage-context";
import { LightsRig } from "./lights-rig";
import { PrimaryDevice } from "./primary-device";
import { MaterialSwatches } from "./material-swatches";
import { FigureBox } from "./figure-box";
import { MaterialBurst } from "./material-burst";
import { type MaterialTarget } from "./device-model";
import { STAGE, stageWeight } from "./constants";

interface HomeSceneProps {
  progressRef: MutableRefObject<number>;
  /** Material the hero carousel has selected, for the lone device. */
  material: MaterialMetadata;
  /** Bumped on each carousel selection to fire the particle spray. */
  burstKey: number;
  reducedMotion: boolean;
}

/**
 * Dolly the camera to frame each stage. Pulls back + up for the
 * teardown, and extra-back in portrait (narrow horizontal FOV) so the
 * exploded parts and their side labels stay on-screen.
 */
function CameraRig() {
  const { stageRef } = useStage();
  useFrame(({ camera, viewport }) => {
    const t = stageWeight(stageRef.current, STAGE.TEARDOWN);
    const portrait = viewport.aspect < 1 ? (1 - viewport.aspect) * 2.2 : 0;
    const targetZ = THREE.MathUtils.lerp(4.5 + portrait, 5.7 + portrait * 1.4, t);
    const targetY = t * 0.25;
    camera.position.z += (targetZ - camera.position.z) * 0.1;
    camera.position.y += (targetY - camera.position.y) * 0.1;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function SceneContents({
  material,
  burstKey,
}: {
  material: MaterialMetadata;
  burstKey: number;
}) {
  const target = useMemo<MaterialTarget>(
    () => ({
      color: new THREE.Color(material.color),
      metalness: material.pbr.metalness,
      roughness: material.pbr.roughness,
      clearcoat: material.pbr.clearcoat ?? 0,
      transmission: material.pbr.transmission ?? 0,
      ior: material.pbr.ior ?? 1.5,
      thickness: material.pbr.thickness ?? 0,
    }),
    [material]
  );

  return (
    <>
      <CameraRig />
      <LightsRig />
      <PrimaryDevice target={target} />
      <MaterialBurst burstKey={burstKey} color={target.color} />
      <MaterialSwatches />
      <FigureBox />
      <ContactShadows
        position={[0, -1.05, 0]}
        opacity={0.35}
        scale={9}
        blur={2.4}
        far={3}
        resolution={256}
        frames={1}
      />
    </>
  );
}

/**
 * The persistent, full-viewport scene that sits pinned behind the
 * scrolling anon-home sections. A single SceneController eases scroll
 * progress into the stage value every child reads.
 */
export function HomeScene({
  progressRef,
  material,
  burstKey,
  reducedMotion,
}: HomeSceneProps) {
  return (
    <ErrorBoundary fallback={null}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ pointerEvents: "none" }}
      >
        <SceneController progressRef={progressRef} reducedMotion={reducedMotion}>
          <SceneContents material={material} burstKey={burstKey} />
        </SceneController>
      </Canvas>
    </ErrorBoundary>
  );
}
