"use client";

import { Suspense, useMemo, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { MaterialMetadata } from "@/lib/materials/preset-library";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SceneController, useStage } from "./stage-context";
import { LightsRig } from "./lights-rig";
import { PrimaryDevice } from "./primary-device";
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
  /** Spray direction (-1/+1) of the last selection. */
  burstDirection: number;
  /** Spray intensity (0.3–1.5) of the last selection. */
  burstIntensity: number;
  /** Live hero swipe tension (-1..1). */
  dragVelocityRef: MutableRefObject<number>;
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
    const stage = stageRef.current;
    const t = stageWeight(stage, STAGE.TEARDOWN);
    const m = stageWeight(stage, STAGE.MATERIALS);
    const portrait = viewport.aspect < 1 ? (1 - viewport.aspect) * 2.2 : 0;
    // Zoom in for the manufacturing stage; pull back for the teardown.
    const baseZ = 4.5 + portrait - m * 1.5;
    const targetZ = THREE.MathUtils.lerp(baseZ, 6.3 + portrait * 1.4, t);
    // Slightly raised viewpoint (looking a touch down at the device),
    // rising a bit more for the teardown.
    const targetY = 0.5 + t * 0.25 - m * 0.12;
    camera.position.z += (targetZ - camera.position.z) * 0.1;
    camera.position.y += (targetY - camera.position.y) * 0.1;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function SceneContents({
  material,
  burstKey,
  burstDirection,
  burstIntensity,
  dragVelocityRef,
}: {
  material: MaterialMetadata;
  burstKey: number;
  burstDirection: number;
  burstIntensity: number;
  dragVelocityRef: MutableRefObject<number>;
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
      <PrimaryDevice target={target} dragVelocityRef={dragVelocityRef} />
      <MaterialBurst
        burstKey={burstKey}
        direction={burstDirection}
        intensity={burstIntensity}
        color={target.color}
      />
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
  burstDirection,
  burstIntensity,
  dragVelocityRef,
  reducedMotion,
}: HomeSceneProps) {
  return (
    <ErrorBoundary fallback={null}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          // The manufacturing "print" reveal uses material clipping planes.
          gl.localClippingEnabled = true;
        }}
        style={{ pointerEvents: "none" }}
      >
        <SceneController progressRef={progressRef} reducedMotion={reducedMotion}>
          {/* useLoader (device STL) suspends — keep it inside the canvas. */}
          <Suspense fallback={null}>
            <SceneContents
              material={material}
              burstKey={burstKey}
              burstDirection={burstDirection}
              burstIntensity={burstIntensity}
              dragVelocityRef={dragVelocityRef}
            />
          </Suspense>
        </SceneController>
      </Canvas>
    </ErrorBoundary>
  );
}
