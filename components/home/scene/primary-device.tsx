"use client";

import { useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { DeviceModel, type MaterialTarget, type HoverTarget } from "./device-model";
import { STAGE, stageWeight, smoothstep, COMMERCE_YAW, COMMERCE_PITCH, TEARDOWN_PARTS } from "./constants";

function GithubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

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

  // World-space label anchors written by DeviceModel.useFrame; read here to
  // position Html groups that live OUTSIDE spinRef (so labels don't rotate
  // with the assembly when the hover-lean fires).
  const labelWorldPositions = useRef<THREE.Vector3[]>(
    TEARDOWN_PARTS.map(() => new THREE.Vector3())
  );
  const labelAnchorGroupsRef = useRef<(THREE.Group | null)[]>(
    Array(TEARDOWN_PARTS.length).fill(null)
  );

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

    // Settle down into the tray cavity as the commerce scene comes in, then
    // rise back out for the footer. The negative Y sinks the device into
    // the molded pocket; footerW lifts it above the fold.
    const settleY = -commerceW * 0.18;
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

    // Copy world positions from DeviceModel (written its useFrame, one
    // frame behind — imperceptible at 60fps) to the Html anchor groups
    // that live outside spinRef.
    if (labelsOnRef.current) {
      for (let i = 0; i < TEARDOWN_PARTS.length; i++) {
        const ag = labelAnchorGroupsRef.current[i];
        if (ag) ag.position.copy(labelWorldPositions.current[i]);
      }
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
          labelWorldPositions={labelWorldPositions}
        />
      </group>
      {/* Html labels live OUTSIDE spinRef so hover-lean rotation doesn't
          move them on screen — only the 3D geometry (lines + dots) rotates. */}
      {labelsOn && TEARDOWN_PARTS.map((part, i) => {
        const dir = part.labelSide === "right" ? 1 : -1;
        const lean: HoverTarget = { yaw: dir * 0.24, pitch: part.labelY * 0.32 };
        return (
          <group
            key={part.id}
            ref={(el) => { labelAnchorGroupsRef.current[i] = el; }}
          >
            <Html distanceFactor={5} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
              <div
                style={{
                  transform:
                    dir > 0 ? "translateX(0.3rem)" : "translateX(-100%) translateX(-0.3rem)",
                }}
              >
                <div
                  onPointerOver={() => { hoverRef.current = lean; }}
                  onPointerOut={() => { hoverRef.current = { yaw: 0, pitch: 0 }; }}
                  className="teardown-label-fade pointer-events-auto flex origin-center items-center gap-2 whitespace-nowrap rounded-md border border-border/60 bg-background/85 px-2.5 py-1.5 text-foreground shadow-sm backdrop-blur transition-[transform,border-color,background-color] duration-200 ease-out hover:scale-[1.22] hover:border-primary/60 hover:bg-background hover:shadow-md"
                >
                  {part.github && <GithubMark />}
                  <span className="flex flex-col leading-tight">
                    <span className="text-[13px] font-semibold tracking-tight">{part.label}</span>
                    {part.sub && (
                      <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
                        {part.sub}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
