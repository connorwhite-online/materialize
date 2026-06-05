"use client";

import { useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { DeviceModel, type MaterialTarget } from "./device-model";
import { useDeviceGeometry } from "./use-device-geometry";
import { STAGE, stageWeight, smoothstep, COMMERCE_YAW, COMMERCE_PITCH } from "./constants";

const PEDESTAL_GLOW = "#6fd2ff";

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
  const { size } = useDeviceGeometry();
  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const explodeRef = useRef(0);
  const bedRef = useRef<THREE.Group>(null);
  const up1 = useRef<THREE.PointLight>(null);
  const up2 = useRef<THREE.PointLight>(null);
  const bedY = -size.y / 2 - 0.02;
  const bedR = size.x * 0.62;

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

    // Explode only AROUND the teardown stage (2); solid + assembled
    // everywhere else (including the packaging stage that follows it).
    explodeRef.current =
      smoothstep(1.55, 2, stage) * (1 - smoothstep(2, 2.45, stage));

    // One persistent mesh across every stage (no cross-fade): it stays
    // present in the materials stage — just scaled down onto the print
    // bed where it sinters — and only recedes for the footer.
    const present = 1 - footerW * 0.9;
    const baseScale = (1 + teardownW * 0.14) * (1 - matW * 0.28);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    const targetScale = baseScale * present;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, targetScale, k));
    g.visible = targetScale > 0.02;

    // Print bed + dramatic uplights, only in the materials stage.
    if (bedRef.current) bedRef.current.visible = matW > 0.01;
    if (up1.current) up1.current.intensity = matW * 7;
    if (up2.current) up2.current.intensity = matW * 4.5;

    // Pull the assembly back slightly as it explodes so it stays framed.
    g.position.z = THREE.MathUtils.lerp(g.position.z, -teardownW * 0.4, k);

    // Drop into the molded tray as the packaging stage settles.
    const yFall = stage > 2.55 ? (1 - commerceW) * 0.45 : 0;
    g.position.y = THREE.MathUtils.lerp(g.position.y, yFall, k);

    // Idle turntable spin in the hero; settles to a fixed pose in the
    // commerce stage (angled to match the box) and the teardown (turned
    // ~45° so the single explode axis reads).
    const still = Math.min(1, teardownW + commerceW);
    if (!reducedMotion) {
      spin.rotation.y += delta * 0.3 * (1 - still);
    }
    const settleYaw = commerceW * COMMERCE_YAW + teardownW * TEARDOWN_YAW;
    // Settle to the NEAREST equivalent of the target angle, so the
    // accumulated idle spin doesn't unwind through several full turns
    // when the device locks into the commerce/teardown pose.
    const twoPi = Math.PI * 2;
    const nearYaw = settleYaw + twoPi * Math.round((spin.rotation.y - settleYaw) / twoPi);
    spin.rotation.y = THREE.MathUtils.lerp(spin.rotation.y, nearYaw, k * still);
    // Upright in the materials stage (print build line stays horizontal).
    const pitch =
      -0.28 * (1 - matW) +
      commerceW * (COMMERCE_PITCH + 0.28) +
      teardownW * (TEARDOWN_PITCH + 0.28);
    spin.rotation.x = THREE.MathUtils.lerp(spin.rotation.x, pitch, k);

    // Live drag feedback: sway with the hero swipe tension (hero only).
    const heroW = (1 - still) * (1 - matW);
    const tension = dragVelocityRef.current * heroW;
    const ks = 1 - Math.exp(-delta * 18);
    spin.rotation.z = THREE.MathUtils.lerp(spin.rotation.z, tension * 0.32, ks);
    g.position.x = THREE.MathUtils.lerp(g.position.x, tension * 0.28, ks);

    const want = stage > 1.4 && stage < 2.6;
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

      {/* Print bed — a low, beveled platform tucked under the device,
          lit from below; only shown in the materials stage. */}
      <group ref={bedRef} visible={false}>
        <pointLight ref={up1} position={[bedR * 0.6, bedY - 0.25, bedR * 0.6]} color="#bfe4ff" intensity={0} distance={3.5} />
        <pointLight ref={up2} position={[-bedR * 0.6, bedY - 0.25, bedR * 0.3]} color="#ffffff" intensity={0} distance={3.5} />
        <mesh position={[0, bedY - 0.05, 0]}>
          <cylinderGeometry args={[bedR * 1.5, bedR * 1.6, 0.07, 64]} />
          <meshStandardMaterial color="#15171c" metalness={0.75} roughness={0.32} />
        </mesh>
        <mesh position={[0, bedY - 0.1, 0]}>
          <cylinderGeometry args={[bedR * 1.62, bedR * 1.92, 0.05, 64]} />
          <meshStandardMaterial color="#0d0f12" metalness={0.6} roughness={0.45} />
        </mesh>
        <mesh position={[0, bedY - 0.014, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[bedR * 1.55, 0.005, 8, 90]} />
          <meshBasicMaterial color={PEDESTAL_GLOW} toneMapped={false} transparent opacity={0.55} />
        </mesh>
      </group>
    </group>
  );
}
