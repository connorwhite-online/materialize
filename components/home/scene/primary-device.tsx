"use client";

import { useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { DeviceModel, type MaterialTarget, type HoverTarget } from "./device-model";
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
 * scroll: idle in the hero, it dissolves into a hologram as the SLS
 * print sweeps up the surface (Materials), re-melds and sits sealed in
 * the box (Commerce), then scales up and explodes into a labelled
 * teardown (Teardown), and rises for the footer. Owns the single
 * `explode` number the DeviceModel reads.
 */
export function PrimaryDevice({ target, dragVelocityRef }: PrimaryDeviceProps) {
  const { stageRef, reducedMotion } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const explodeRef = useRef(0);
  // Lean offset set when a teardown tag is hovered, plus a critically
  // damped spring that eases the scene into (and out of) the lean.
  const hoverRef = useRef<HoverTarget>({ yaw: 0, pitch: 0 });
  const leanCur = useRef<HoverTarget>({ yaw: 0, pitch: 0 });
  const leanVel = useRef<HoverTarget>({ yaw: 0, pitch: 0 });

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
    // down as it prints in materials, dropped into the tray in
    // packaging, and it stays fully assembled + rises into view for the
    // footer (rather than fading away).
    const baseScale = (1 + teardownW * 0.14) * (1 - matW * 0.28);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 6);

    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, baseScale, k));
    g.visible = baseScale > 0.02;

    // Pull the assembly back slightly as it explodes so it stays framed.
    g.position.z = THREE.MathUtils.lerp(g.position.z, -teardownW * 0.4, k);

    // Lay the device down INTO the tray (packaging) via a small settle +
    // the lay-back rotation below, rather than sliding straight down
    // through the pulp mesh. Then rise higher for the footer.
    const settleY = stage > 2.55 && stage < 3.5 ? (1 - commerceW) * 0.1 : 0;
    g.position.y = THREE.MathUtils.lerp(g.position.y, settleY + footerW * 0.7, k);

    // Idle turntable spin in the hero; settles to a fixed pose in the
    // commerce stage (angled to match the box) and the teardown (turned
    // ~45° so the single explode axis reads).
    const still = Math.min(1, teardownW + commerceW);
    if (!reducedMotion) {
      spin.rotation.y += delta * 0.3 * (1 - still);
    }
    // Spring the hover-lean toward its target so the scene eases IN
    // (accelerates) and OUT (decelerates) — a plain lerp only eases out.
    const hov = hoverRef.current;
    const stiff = 45;
    const damp = 2 * Math.sqrt(stiff); // ~critically damped: smooth, no overshoot
    const dt = Math.min(delta, 1 / 30);
    for (const ax of ["yaw", "pitch"] as const) {
      const accel = (hov[ax] - leanCur.current[ax]) * stiff - leanVel.current[ax] * damp;
      leanVel.current[ax] += accel * dt;
      leanCur.current[ax] += leanVel.current[ax] * dt;
    }
    const lean = leanCur.current;

    // Lean toward the hovered teardown tag (only meaningful while the
    // assembly is exploded, so scale the offset by the teardown weight).
    const settleYaw =
      commerceW * COMMERCE_YAW + teardownW * (TEARDOWN_YAW + lean.yaw);
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
      teardownW * (TEARDOWN_PITCH + 0.28) +
      teardownW * lean.pitch;
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
          hoverRef={hoverRef}
        />
      </group>
    </group>
  );
}
