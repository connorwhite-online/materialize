"use client";

import { useMemo, useRef, useState, type MutableRefObject } from "react";
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
  const bedY = -size.y / 2 - 0.16;
  const bedR = size.x * 0.62;

  // Circular pedestal profile (revolved around Y): a flat outer rim that
  // dips down a beveled inner wall into a sunken well floor. The bevel
  // wall is the surface that emits the glow (a separate cone laid just
  // inside it). All Y values are relative to the platform group at bedY.
  const ped = useMemo(() => {
    const floorR = bedR * 0.55; // sunken well floor radius
    const openR = bedR * 1.05; // well opening (top of the bevel)
    const outerR = bedR * 1.7; // outer edge of the pad
    const rimY = 0.07; // top surface of the pad
    const floorY = -0.06; // sunken well floor
    const baseY = -0.09; // underside of the pad
    const pts = [
      new THREE.Vector2(0, floorY),
      new THREE.Vector2(floorR, floorY),
      new THREE.Vector2(openR, rimY), // beveled inner wall (glowing)
      new THREE.Vector2(outerR, rimY),
      new THREE.Vector2(outerR, baseY),
      new THREE.Vector2(0, baseY),
    ];
    return { pts, floorR, openR, rimY, floorY };
  }, [bedR]);

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

    // One persistent mesh across every stage (no cross-fade): scaled
    // down onto the print bed in materials, dropped into the tray in
    // packaging, and it stays fully assembled + rises into view for the
    // footer (rather than fading away).
    const baseScale = (1 + teardownW * 0.14) * (1 - matW * 0.28);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, baseScale, k));
    g.visible = baseScale > 0.02;

    // Print bed + uplights only in the materials stage — gated on a
    // SHARP weight so they pop in/out quickly (zero by ~half a stage).
    const pedW = Math.max(0, 1 - Math.abs(stage - STAGE.MATERIALS) * 2.4);
    if (bedRef.current) {
      bedRef.current.visible = pedW > 0.01;
      bedRef.current.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number };
        if (m && typeof m.opacity === "number") {
          m.transparent = true;
          m.opacity = pedW;
        }
      });
    }
    if (up1.current) up1.current.intensity = pedW * 7;
    if (up2.current) up2.current.intensity = pedW * 4.5;

    // Pull the assembly back slightly as it explodes so it stays framed.
    g.position.z = THREE.MathUtils.lerp(g.position.z, -teardownW * 0.4, k);

    // Drop into the molded tray (packaging), then rise into view (footer).
    const yFall = stage > 2.55 && stage < 3.5 ? (1 - commerceW) * 0.45 : 0;
    g.position.y = THREE.MathUtils.lerp(g.position.y, yFall + footerW * 0.55, k);

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

      {/* Print bed — a circular pedestal with a sunken well bored down
          into it; the beveled inner wall emits the glow that is the
          source of the floating hologram. Only shown (and quickly faded)
          in the materials stage. */}
      <group ref={bedRef} visible={false}>
        <pointLight ref={up1} position={[bedR * 0.8, bedY + 0.2, bedR * 1.0]} color="#bfe4ff" intensity={0} distance={2.6} />
        <pointLight ref={up2} position={[-bedR * 0.8, bedY + 0.2, bedR * 0.6]} color="#9fc6ff" intensity={0} distance={2.6} />
        <group position={[0, bedY, 0]}>
          {/* Revolved pedestal body: flat rim → beveled inner wall → well. */}
          <mesh>
            <latheGeometry args={[ped.pts, 96]} />
            <meshStandardMaterial color="#15181e" metalness={0.7} roughness={0.34} side={THREE.DoubleSide} />
          </mesh>
          {/* Glowing beveled wall — a cone laid just inside the bevel. */}
          <mesh position={[0, (ped.rimY + ped.floorY) / 2, 0]}>
            <cylinderGeometry args={[ped.openR * 0.985, ped.floorR * 0.985, ped.rimY - ped.floorY, 96, 1, true]} />
            <meshBasicMaterial color={PEDESTAL_GLOW} toneMapped={false} side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
          {/* Soft glow pooled on the well floor (hologram source). */}
          <mesh position={[0, ped.floorY + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[ped.floorR * 0.96, 64]} />
            <meshBasicMaterial color={PEDESTAL_GLOW} toneMapped={false} transparent opacity={0.32} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
