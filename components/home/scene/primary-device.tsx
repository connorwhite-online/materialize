"use client";

import { useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { DeviceModel, type MaterialTarget } from "./device-model";
import { STAGE, stageWeight, smoothstep, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

// Fixed teardown pose — turned ~45° off the camera so the single
// explode axis (device-local +Z) is fully legible.
const TEARDOWN_YAW = -Math.PI / 4;
const TEARDOWN_PITCH = -0.34;

interface PrimaryDeviceProps {
  /** Shell material driven by the hero carousel selection. */
  target: MaterialTarget;
  /** Live drag tension (-1..1) from the hero swipe gesture. */
  dragVelocityRef: MutableRefObject<number>;
}

/**
 * The lone, persistent device. It is one object across the whole
 * scroll: idle in the hero, it dissolves as the swatches multiply out
 * (Materials), re-melds and sits sealed in the box (Commerce), then
 * scales up and explodes into a labelled teardown (Teardown), and
 * recedes for the footer. Owns the single `explode` number the
 * DeviceModel reads.
 */
export function PrimaryDevice({ target, dragVelocityRef }: PrimaryDeviceProps) {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const explodeRef = useRef(0);

  // Labels mount only around the teardown stage; a CSS fade smooths it.
  const [labelsOn, setLabelsOn] = useState(false);
  const labelsOnRef = useRef(false);

  useFrame((_, delta) => {
    const g = groupRef.current;
    const spin = spinRef.current;
    if (!g || !spin) return;
    const stage = stageRef.current;

    const matW = stageWeight(stage, STAGE.MATERIALS);
    const commerceW = stageWeight(stage, STAGE.COMMERCE);
    const teardownW = stageWeight(stage, STAGE.TEARDOWN);
    const footerW = stageWeight(stage, STAGE.FOOTER);

    // Explode only AFTER the box stage is gone — the boxed device stays
    // assembled. Ramps up entering the teardown and back down leaving it.
    explodeRef.current =
      smoothstep(2.55, 3, stage) * (1 - smoothstep(3, 3.45, stage));

    const present = (1 - matW) * (1 - footerW * 0.9);
    const baseScale = 1 + teardownW * 0.14;
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    const targetScale = baseScale * present;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, targetScale, k));
    g.visible = targetScale > 0.02;

    // Pull the assembly back slightly as it explodes so it stays framed.
    g.position.z = THREE.MathUtils.lerp(g.position.z, -teardownW * 0.4, k);

    // Idle turntable spin in the hero; settles to a fixed pose in the
    // commerce stage (angled to match the box) and the teardown (turned
    // ~45° so the single explode axis reads).
    const still = Math.min(1, teardownW + commerceW);
    if (!reducedMotion) {
      spin.rotation.y += delta * 0.3 * (1 - still);
    }
    const settleYaw = commerceW * COMMERCE_YAW + teardownW * TEARDOWN_YAW;
    spin.rotation.y = THREE.MathUtils.lerp(spin.rotation.y, settleYaw, k * still);
    const pitch =
      -0.28 + commerceW * (COMMERCE_PITCH + 0.28) + teardownW * (TEARDOWN_PITCH + 0.28);
    spin.rotation.x = THREE.MathUtils.lerp(spin.rotation.x, pitch, k);

    // Live drag feedback: sway with the hero swipe tension (hero only).
    const heroW = (1 - still) * (1 - matW);
    const tension = dragVelocityRef.current * heroW;
    const ks = 1 - Math.exp(-delta * 18);
    spin.rotation.z = THREE.MathUtils.lerp(spin.rotation.z, tension * 0.32, ks);
    g.position.x = THREE.MathUtils.lerp(g.position.x, tension * 0.28, ks);

    const want = stage > 2.4 && stage < 3.6;
    if (want !== labelsOnRef.current) {
      labelsOnRef.current = want;
      setLabelsOn(want);
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={spinRef}>
        <DeviceModel
          target={target}
          explodeRef={explodeRef}
          showInternals
          showLabels={labelsOn}
        />
      </group>
    </group>
  );
}
