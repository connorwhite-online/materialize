"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import {
  TEARDOWN_PARTS,
  type TeardownPart,
  ORDER_CENTER,
  EXPLODE_SPACING,
  PCB_ORDER,
  STAGE,
  stageWeight,
} from "./constants";
import { useStage } from "./stage-context";
import { useDeviceGeometry } from "./use-device-geometry";

const HOLO = "#6fd2ff";
// Visible sinter layers across the print build (SLS-style stepped reveal).
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
      uColor: { value: new THREE.Color(HOLO) },
      uOpacity: { value: 0.0 },
      uBuildY: { value: 0 },
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
      uniform float uBuildY;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vWorldY;
      void main() {
        #include <clipping_planes_fragment>
        float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.8);
        float scan = 0.5 + 0.5 * sin(vWorldY * 90.0 - uTime * 2.5);
        float a = uOpacity * (0.16 + 0.84 * fres) * (0.55 + 0.45 * scan);
        vec3 col = uColor * (0.7 + fres * 1.4);
        // Sintering heat at the active build line: a bright tight core
        // that bleeds softly UP into the not-yet-printed hologram above,
        // like heat diffusing off the fresh layer — rather than a hard,
        // symmetric line sitting at the boundary.
        float d = vWorldY - uBuildY;
        float core = exp(-pow(d * 24.0, 2.0));
        float bleed = exp(-max(d, 0.0) * 6.0) * step(0.0, d);
        float band = max(core, bleed * (0.45 + 0.2 * scan));
        col += vec3(0.75, 0.95, 1.0) * band * 2.0;
        a = max(a, band * (0.35 + uOpacity * 1.4));
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

export interface MaterialTarget {
  color: THREE.Color;
  metalness: number;
  roughness: number;
  clearcoat: number;
  transmission: number;
  ior: number;
  thickness: number;
}

interface DeviceModelProps {
  /** Shell material the hardbody lerps toward. */
  target: MaterialTarget;
  /** 0 = assembled, 1 = fully exploded teardown. */
  explodeRef: MutableRefObject<number>;
  /** Render the internal components (PCB, chips, battery, …). */
  showInternals?: boolean;
  /** Mount the leader-line teardown labels (primary device only). */
  showLabels?: boolean;
  castShadow?: boolean;
}

// --- internal component palette (fixed; only the shell takes `target`) ---
const PCB_COLOR = "#163a2b";
const CHIP_COLOR = "#0e1013";
const METAL_COLOR = "#b9bdc4";
const LENS_COLOR = "#05070a";

/**
 * Internal component geometry, sized in real millimetres against the
 * shell (the device is 85mm long → size.y). Dimensions + parts are from
 * the pneuma BOM.
 */
function PartGeometry({ id, size }: { id: string; size: THREE.Vector3 }) {
  const MM = size.y / 85;
  switch (id) {
    case "soc": // Rockchip RV1106G3 — QFN, ~10×10×1.2mm
      return (
        <group>
          <RoundedBox args={[10 * MM, 10 * MM, 1.2 * MM]} radius={0.4 * MM} smoothness={3}>
            <meshStandardMaterial color={CHIP_COLOR} metalness={0.35} roughness={0.5} />
          </RoundedBox>
          <mesh position={[0, 0, 0.7 * MM]}>
            <planeGeometry args={[7.5 * MM, 7.5 * MM]} />
            <meshStandardMaterial color="#1b1e22" roughness={0.75} />
          </mesh>
          <mesh position={[-3 * MM, -3 * MM, 0.75 * MM]}>
            <circleGeometry args={[0.7 * MM, 16]} />
            <meshStandardMaterial color="#3a3d42" />
          </mesh>
        </group>
      );
    case "mcu": // Raytac MDBT50Q (nRF52840) — module 10.5×15.5×2.05mm, metal shield
      return (
        <group>
          <RoundedBox args={[10.5 * MM, 15.5 * MM, 2.05 * MM]} radius={0.3 * MM} smoothness={3}>
            <meshStandardMaterial color="#15171a" metalness={0.3} roughness={0.6} />
          </RoundedBox>
          <RoundedBox args={[9 * MM, 11.5 * MM, 0.5 * MM]} radius={0.2 * MM} smoothness={3} position={[0, -1.4 * MM, 1.15 * MM]}>
            <meshStandardMaterial color="#c7ccd2" metalness={0.85} roughness={0.3} />
          </RoundedBox>
        </group>
      );
    case "modem": // Quectel EG915U — LGA, 23.6×19.9×2.4mm
      return (
        <group>
          <RoundedBox args={[19.9 * MM, 23.6 * MM, 2.4 * MM]} radius={0.5 * MM} smoothness={3}>
            <meshStandardMaterial color="#1a1c1f" metalness={0.5} roughness={0.45} />
          </RoundedBox>
          <mesh position={[0, 4 * MM, 1.3 * MM]}>
            <planeGeometry args={[14 * MM, 9 * MM]} />
            <meshStandardMaterial color="#2a2d31" roughness={0.7} />
          </mesh>
        </group>
      );
    case "camera": // SC3336 3MP module — lens up (+Y) to the top hole
      return (
        <group>
          <RoundedBox args={[8.5 * MM, 5 * MM, 8.5 * MM]} radius={0.4 * MM} smoothness={3}>
            <meshStandardMaterial color="#16181c" metalness={0.5} roughness={0.4} />
          </RoundedBox>
          <mesh position={[0, 4 * MM, 0]}>
            <cylinderGeometry args={[3 * MM, 3.3 * MM, 3.2 * MM, 32]} />
            <meshStandardMaterial color="#0c0d10" metalness={0.5} roughness={0.35} />
          </mesh>
          <mesh position={[0, 5.6 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[2.6 * MM, 32]} />
            <meshPhysicalMaterial color={LENS_COLOR} metalness={0.1} roughness={0.05} clearcoat={1} />
          </mesh>
        </group>
      );
    case "battery": // PKCell LP803860 — 60×36×8mm, 2000mAh
      return (
        <RoundedBox args={[36 * MM, 60 * MM, 8 * MM]} radius={1.6 * MM} smoothness={4}>
          <meshStandardMaterial color={METAL_COLOR} metalness={0.5} roughness={0.45} />
        </RoundedBox>
      );
    case "speaker": // PUI AS01808MR — 18mm dia
      return (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[9 * MM, 9 * MM, 4 * MM, 44]} />
            <meshStandardMaterial color="#26282c" metalness={0.45} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0, 2.1 * MM]}>
            <circleGeometry args={[6.5 * MM, 44]} />
            <meshStandardMaterial color="#17191c" roughness={0.85} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** Female USB-C port: a recessed pill cavity with a tongue. Opening
 *  faces +Y (mapped onto the drafted bottom face by the parent group). */
function UsbCPort({ w }: { w: number }) {
  return (
    <group>
      <RoundedBox args={[w * 0.24, 0.04, w * 0.1]} radius={0.012} smoothness={4}>
        <meshStandardMaterial color="#3a3d42" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[w * 0.2, 0.05, w * 0.07]} radius={w * 0.035} smoothness={5} position={[0, -0.008, 0]}>
        <meshStandardMaterial color="#050608" roughness={0.9} metalness={0.1} />
      </RoundedBox>
      <RoundedBox args={[w * 0.15, 0.016, w * 0.03]} radius={0.006} smoothness={4} position={[0, -0.006, 0]}>
        <meshStandardMaterial color="#2a2c30" metalness={0.4} roughness={0.6} />
      </RoundedBox>
    </group>
  );
}

/** Inline GitHub mark — lucide-react v1 dropped brand icons. */
function GithubMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function TeardownLabel({ part, size }: { part: TeardownPart; size: THREE.Vector3 }) {
  const dir = part.labelSide === "right" ? 1 : -1;
  const end: [number, number, number] = [dir * 0.5, part.labelY * size.y, 0.12];
  return (
    <group>
      <Line points={[[0, 0, 0], end]} color="#8a8f98" lineWidth={1} transparent opacity={0.7} />
      <mesh position={end}>
        <sphereGeometry args={[0.016, 12, 12]} />
        <meshBasicMaterial color="#8a8f98" />
      </mesh>
      <Html position={end} distanceFactor={3.4} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
        <a
          href={part.href}
          target="_blank"
          rel="noreferrer"
          className="teardown-label-fade pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border/60 bg-background/85 px-1.5 py-1 text-foreground no-underline shadow-sm backdrop-blur transition-colors hover:border-primary/50 hover:bg-background"
          style={{
            transform: dir > 0 ? "translateX(0.3rem)" : "translateX(-100%) translateX(-0.3rem)",
          }}
        >
          {part.github && <GithubMark />}
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] font-semibold tracking-tight">{part.label}</span>
            {part.sub && (
              <span className="text-[8px] font-medium tracking-tight text-muted-foreground">
                {part.sub}
              </span>
            )}
          </span>
        </a>
      </Html>
    </group>
  );
}

/**
 * The Pneuma device, built on the real two-body hardbody (glTF). The
 * front/back covers part along the assembly access line (thickness) in
 * the teardown while the BOM components — battery, speaker, modem, wake
 * MCU, Linux SoC, camera — slide out along the same axis by layer
 * order. Small parts (LED, mic, USB-C) sit on the front cover behind
 * the real holes so they read through them.
 */
export function DeviceModel({
  target,
  explodeRef,
  showInternals = true,
  showLabels = false,
  castShadow = true,
}: DeviceModelProps) {
  const { front, back, size, topCap, bottomCap } = useDeviceGeometry();
  const { stageRef } = useStage();
  const rootRef = useRef<THREE.Group>(null);
  const frontRef = useRef<THREE.Group>(null);
  const backRef = useRef<THREE.Group>(null);
  const internalsRef = useRef<THREE.Group>(null);
  const tmpV = useMemo(() => new THREE.Vector3(), []);
  const topFeatRef = useRef<THREE.Group>(null);
  const botFeatRef = useRef<THREE.Group>(null);
  const frontMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const backMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const partRefs = useRef<Record<string, THREE.Group | null>>({});

  // SLS print reveal: the covers are clipped at a build line that sweeps
  // up in the manufacturing stage (below = solid material, above =
  // hologram). The clip planes follow the device's own transform so it
  // works while it's scaled/spun. Single mesh, no cross-fade.
  const holoA = useMemo(makeHologramMaterial, []);
  const holoB = useMemo(makeHologramMaterial, []);
  const worldBelow = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3), []);
  const worldAbove = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e3), []);
  const localBelow = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const localAbove = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  useMemo(() => {
    holoA.clippingPlanes = [worldAbove];
    holoB.clippingPlanes = [worldAbove];
  }, [holoA, holoB, worldAbove]);

  const w = size.x;
  const h = size.y;
  const MM = size.y / 85;

  // Quaternions that lay the seated components flat onto the drafted
  // end faces (their local +Y aligns with each face's measured normal).
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const topQ = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, topCap.normal),
    [UP, topCap]
  );
  const bottomQ = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, bottomCap.normal),
    [UP, bottomCap]
  );

  const lerpShell = (mat: THREE.MeshPhysicalMaterial | null, dt: number) => {
    if (!mat) return;
    const k = 1 - Math.exp(-dt * 4);
    mat.color.lerp(target.color, k);
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, target.metalness, k);
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, target.roughness, k);
    mat.clearcoat = THREE.MathUtils.lerp(mat.clearcoat, target.clearcoat, k);
    mat.transmission = THREE.MathUtils.lerp(mat.transmission, target.transmission, k);
    mat.ior = THREE.MathUtils.lerp(mat.ior, target.ior, k);
    mat.thickness = THREE.MathUtils.lerp(mat.thickness, target.thickness, k);
    // Only genuinely transmissive materials (resin) are transparent —
    // otherwise the shell stays a solid opaque body that hides the
    // internals until the teardown opens it. A glassy Steel shell let
    // the guts show through, reading as "everything's on the outside".
    const wantTransparent = mat.transmission > 0.02;
    if (mat.transparent !== wantTransparent) {
      mat.transparent = wantTransparent;
      mat.needsUpdate = true;
    }
  };

  useFrame((state, delta) => {
    const e = explodeRef.current;
    lerpShell(frontMat.current, delta);
    lerpShell(backMat.current, delta);

    // Covers part along the thickness (Z); front toward the camera.
    if (frontRef.current) frontRef.current.position.z = e * 0.5;
    if (backRef.current) backRef.current.position.z = -e * 0.35;

    // Internals only appear once the case starts opening.
    if (internalsRef.current) internalsRef.current.visible = e > 0.015;

    // --- Manufacturing print reveal (same mesh, no cross-fade) ---
    const stage = stageRef.current;
    const matW = stageWeight(stage, STAGE.MATERIALS);
    // Solid (hero) → dematerialise on entry → slow sinter print → solid.
    let build = 1;
    if (stage > 0.6 && stage <= 0.74) build = 1 - (stage - 0.6) / 0.14;
    else if (stage > 0.74 && stage <= 1.2) build = (stage - 0.74) / 0.46;
    else if (stage > 0.6) build = 1;
    build = THREE.MathUtils.clamp(build, 0, 1);
    const q = Math.round(build * LAYERS) / LAYERS;
    const localBuildY = -size.y / 2 + q * size.y * 1.04;
    localBelow.constant = localBuildY;
    localAbove.constant = -localBuildY;
    let worldBuildY = 0;
    if (rootRef.current) {
      worldBelow.copy(localBelow).applyMatrix4(rootRef.current.matrixWorld);
      worldAbove.copy(localAbove).applyMatrix4(rootRef.current.matrixWorld);
      worldBuildY = tmpV.set(0, localBuildY, 0).applyMatrix4(rootRef.current.matrixWorld).y;
    }
    const t = state.clock.elapsedTime;
    const holoOp = matW * 0.55;
    const showBand = matW > 0.02 && q > 0.01 && q < 0.99 ? 1 : 0;
    for (const m of [holoA, holoB]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uOpacity.value = holoOp;
      m.uniforms.uBuildY.value = showBand ? worldBuildY : 1e3;
    }

    for (const part of TEARDOWN_PARTS) {
      const g = partRefs.current[part.id];
      if (!g) continue;
      g.position.set(
        part.rest[0] * size.x,
        // Spread vertically outward too (top parts up, bottom parts down).
        part.rest[1] * size.y * (1 + 0.55 * e),
        part.rest[2] * size.z + (part.order - ORDER_CENTER) * EXPLODE_SPACING * e
      );
    }
    // End-face components ride out vertically as well: camera up, USB-C down.
    if (topFeatRef.current) topFeatRef.current.position.y = topCap.point.y + e * 0.3;
    if (botFeatRef.current) botFeatRef.current.position.y = bottomCap.point.y - e * 0.3;
    const pcb = partRefs.current["pcb"];
    if (pcb) pcb.position.z = (PCB_ORDER - ORDER_CENTER) * EXPLODE_SPACING * e;
  });

  const shellMaterial = (ref: MutableRefObject<THREE.MeshPhysicalMaterial | null>) => (
    <meshPhysicalMaterial
      ref={ref}
      color={target.color}
      metalness={target.metalness}
      roughness={target.roughness}
      clearcoat={target.clearcoat}
      clearcoatRoughness={0.15}
      transmission={target.transmission}
      ior={target.ior}
      thickness={target.thickness}
      transparent={target.transmission > 0.02}
      clippingPlanes={[worldBelow]}
    />
  );

  return (
    <group ref={rootRef}>
      {/* Hologram ghost of the whole shell — visible above the sintering
          build line; the bright sinter band rides the surface at the
          build height (see the shader), not as a floating halo. */}
      <mesh geometry={front} material={holoA} />
      <mesh geometry={back} material={holoB} />

      {/* --- Front cover (faces camera; carries the hole-aligned bits) --- */}
      <group ref={frontRef}>
        <mesh geometry={front} castShadow={castShadow} receiveShadow>
          {shellMaterial(frontMat)}
        </mesh>

        {/* Components seated in the real end-face holes, laid flat onto
            the 10° drafted faces (local +Y = the measured face normal).
            Top: camera + LED + mic; bottom: female USB-C. */}
        {showInternals && (
          <>
            <group ref={topFeatRef} position={topCap.point.toArray()} quaternion={topQ}>
              {/* Camera (10mm hole), centered. */}
              <mesh position={[0, -0.012, 0]}>
                <cylinderGeometry args={[w * 0.11, w * 0.11, 0.04, 40]} />
                <meshStandardMaterial color="#16181c" metalness={0.6} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[w * 0.085, 40]} />
                <meshPhysicalMaterial color={LENS_COLOR} metalness={0.1} roughness={0.05} clearcoat={1} />
              </mesh>
              {/* Status LED (2mm hole). */}
              <mesh position={[w * 0.24, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[w * 0.025, 24]} />
                <meshStandardMaterial color="#7dd3a0" emissive="#3fae6e" emissiveIntensity={1.6} />
              </mesh>
              {/* Mic (2×8mm slot). */}
              <mesh position={[-w * 0.24, 0.002, 0]}>
                <boxGeometry args={[w * 0.16, 0.012, w * 0.05]} />
                <meshStandardMaterial color="#202226" metalness={0.3} roughness={0.7} />
              </mesh>
            </group>

            <group ref={botFeatRef} position={bottomCap.point.toArray()} quaternion={bottomQ}>
              <UsbCPort w={w} />
            </group>
          </>
        )}
      </group>

      {/* --- Back cover --- */}
      <group ref={backRef}>
        <mesh geometry={back} castShadow={castShadow} receiveShadow>
          {shellMaterial(backMat)}
        </mesh>
      </group>

      {/* --- Internals — only shown once the teardown opens the shell;
          in the hero / box stages the device reads as a clean solid. --- */}
      {showInternals && (
        <group ref={internalsRef} visible={false}>
          <group
            ref={(el) => {
              partRefs.current["pcb"] = el;
            }}
            position={[0, h * 0.04, 0]}
          >
            {/* Mainboard — green soldermask, ~40×78×1.2mm. */}
            <RoundedBox args={[40 * MM, 78 * MM, 1.2 * MM]} radius={1.8 * MM} smoothness={5}>
              <meshStandardMaterial color={PCB_COLOR} metalness={0.2} roughness={0.6} />
            </RoundedBox>
            {/* Corner mounting holes. */}
            {[
              [-15, 35],
              [15, 35],
              [-15, -35],
              [15, -35],
            ].map(([mx, my], i) => (
              <mesh key={i} position={[mx * MM, my * MM, 0]}>
                <cylinderGeometry args={[1.4 * MM, 1.4 * MM, 2 * MM, 16]} />
                <meshStandardMaterial color="#0a0c0a" metalness={0.3} roughness={0.7} />
              </mesh>
            ))}
            {/* Camera FFC connector (top) + battery JST connector (side). */}
            <RoundedBox args={[16 * MM, 3.5 * MM, 1.5 * MM]} radius={0.4 * MM} smoothness={3} position={[0, 33 * MM, 1 * MM]}>
              <meshStandardMaterial color="#e8e3d0" roughness={0.6} />
            </RoundedBox>
            <RoundedBox args={[6 * MM, 4 * MM, 2 * MM]} radius={0.4 * MM} smoothness={3} position={[-16 * MM, -20 * MM, 1 * MM]}>
              <meshStandardMaterial color="#e8e3d0" roughness={0.6} />
            </RoundedBox>
            {/* A few silkscreen pads. */}
            <mesh position={[10 * MM, -10 * MM, 0.65 * MM]}>
              <planeGeometry args={[8 * MM, 6 * MM]} />
              <meshStandardMaterial color="#0c3a26" roughness={0.7} />
            </mesh>
          </group>

          {TEARDOWN_PARTS.map((part) => (
            <group
              key={part.id}
              ref={(el) => {
                partRefs.current[part.id] = el;
              }}
            >
              <PartGeometry id={part.id} size={size} />
              {showLabels && <TeardownLabel part={part} size={size} />}
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
