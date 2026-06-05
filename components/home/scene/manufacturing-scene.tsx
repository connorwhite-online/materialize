"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";
import { type MaterialTarget } from "./device-model";
import { STAGE, stageWeight } from "./constants";

const GLOW = "#6fd2ff";
// Scaled-down "on the print bed" size.
const S = 0.7;
// Visible sinter layers across the build (SLS-style stepped reveal).
const LAYERS = 52;

/** Holographic ghost material — subtle fresnel-edge glow + scanlines,
 *  clipping-aware so it only shows above the sintering build line. */
function makeHologramMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(GLOW) },
      uOpacity: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vWorldY;
      void main() {
        vec3 transformed = position;
        vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
        vWorldY = worldPos.y;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        vec4 mvPosition = viewMatrix * worldPos;
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vWorldY;
      void main() {
        #include <clipping_planes_fragment>
        float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.8);
        float scan = 0.5 + 0.5 * sin(vWorldY * 90.0 - uTime * 2.5);
        float a = uOpacity * (0.16 + 0.84 * fres) * (0.55 + 0.45 * scan);
        vec3 col = uColor * (0.7 + fres * 1.4);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

/**
 * The manufacturing / supply-chain stage. The two outer enclosures sit
 * on a pedestal-like print bed lit dramatically from below and are
 * sintered into being layer-by-layer (SLS-style): above the build line
 * they're a subtle hologram; as the line sweeps up each layer "turns"
 * into the solid selected material. Driven by scroll into the section
 * via world-space clipping planes (localClippingEnabled is set on the
 * renderer in HomeScene).
 */
export function ManufacturingScene({ target }: { target: MaterialTarget }) {
  const { stageRef, reducedMotion } = useStage();
  const { front, back, size } = useDeviceGeometry();

  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const solidA = useRef<THREE.MeshPhysicalMaterial>(null);
  const solidB = useRef<THREE.MeshPhysicalMaterial>(null);
  const up1 = useRef<THREE.PointLight>(null);
  const up2 = useRef<THREE.PointLight>(null);

  const planeBelow = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const planeAbove = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const holoA = useMemo(makeHologramMaterial, []);
  const holoB = useMemo(makeHologramMaterial, []);
  useMemo(() => {
    holoA.clippingPlanes = [planeAbove];
    holoB.clippingPlanes = [planeAbove];
  }, [holoA, holoB, planeAbove]);

  const devBottom = (-S * size.y) / 2;
  const devHeight = S * size.y;
  const halfW = (S * size.x) / 2;

  const lerpSolid = (m: THREE.MeshPhysicalMaterial | null, dt: number) => {
    if (!m) return;
    const k = 1 - Math.exp(-dt * 4);
    m.color.lerp(target.color, k);
    m.metalness = THREE.MathUtils.lerp(m.metalness, target.metalness, k);
    m.roughness = THREE.MathUtils.lerp(m.roughness, target.roughness, k);
    m.clearcoat = THREE.MathUtils.lerp(m.clearcoat, target.clearcoat, k);
  };

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const stage = stageRef.current;
    const w = stageWeight(stage, STAGE.MATERIALS);
    g.visible = w > 0.01;

    // Build line sweeps up as you scroll into the section, quantized into
    // sinter layers so it reads as the SLS process building height.
    const raw = THREE.MathUtils.clamp((stage - 0.6) / 0.38, 0, 1);
    const build = Math.round(raw * LAYERS) / LAYERS;
    const buildY = devBottom + build * devHeight;
    planeBelow.constant = buildY;
    planeAbove.constant = -buildY;

    if (ringRef.current) {
      ringRef.current.position.y = buildY;
      ringRef.current.visible = build > 0.01 && build < 0.99;
    }

    lerpSolid(solidA.current, delta);
    lerpSolid(solidB.current, delta);

    const t = state.clock.elapsedTime;
    holoA.uniforms.uTime.value = t;
    holoB.uniforms.uTime.value = t;
    holoA.uniforms.uOpacity.value = w * 0.55;
    holoB.uniforms.uOpacity.value = w * 0.55;

    if (spinRef.current && !reducedMotion) spinRef.current.rotation.y += delta * 0.2;

    g.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as
        | (THREE.Material & { opacity: number; isShaderMaterial?: boolean })
        | undefined;
      if (!m || m.isShaderMaterial || typeof m.opacity !== "number") return;
      m.opacity = w;
    });
    if (up1.current) up1.current.intensity = w * 8;
    if (up2.current) up2.current.intensity = w * 5;
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Dramatic upward lights — the base of the platform is lost in glare. */}
      <pointLight ref={up1} position={[0.5, devBottom - 0.25, 0.5]} color="#bfe4ff" intensity={0} distance={4} />
      <pointLight ref={up2} position={[-0.5, devBottom - 0.25, 0.2]} color="#ffffff" intensity={0} distance={4} />

      {/* Print bed — a low, beveled platform tucked right under the
          device; only the top edge reads, the rest falls into dark. */}
      <group position={[0, devBottom - 0.015, 0]}>
        {/* Bed surface. */}
        <mesh position={[0, -0.035, 0]}>
          <cylinderGeometry args={[halfW * 1.5, halfW * 1.6, 0.07, 64]} />
          <meshStandardMaterial color="#15171c" metalness={0.75} roughness={0.32} />
        </mesh>
        {/* Beveled lip. */}
        <mesh position={[0, -0.085, 0]}>
          <cylinderGeometry args={[halfW * 1.62, halfW * 1.92, 0.05, 64]} />
          <meshStandardMaterial color="#0d0f12" metalness={0.6} roughness={0.45} />
        </mesh>
        {/* Glowing edge line. */}
        <mesh position={[0, -0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[halfW * 1.55, 0.005, 8, 90]} />
          <meshBasicMaterial color={GLOW} toneMapped={false} transparent opacity={0.55} />
        </mesh>
      </group>

      {/* Enclosures: solid below the build line, hologram above. */}
      <group ref={spinRef} scale={S}>
        <mesh geometry={front}>
          <meshPhysicalMaterial
            ref={solidA}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            clippingPlanes={[planeBelow]}
          />
        </mesh>
        <mesh geometry={back}>
          <meshPhysicalMaterial
            ref={solidB}
            color={target.color}
            metalness={target.metalness}
            roughness={target.roughness}
            clearcoat={target.clearcoat}
            clearcoatRoughness={0.15}
            transparent
            clippingPlanes={[planeBelow]}
          />
        </mesh>
        <mesh geometry={front} material={holoA} />
        <mesh geometry={back} material={holoB} />
      </group>

      {/* The sinter line — a bright laser/print-head ring. */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[halfW * 1.1, 0.006, 8, 64]} />
        <meshBasicMaterial color="#eaffff" toneMapped={false} />
      </mesh>
    </group>
  );
}
