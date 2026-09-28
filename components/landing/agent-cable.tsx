"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";

/**
 * The agents step: a braided cable runs from a small glowing "agent
 * spark" into the device's USB-C port and pulses power into it — the
 * agent fuelling the hardware, in the same electric blue as the burn
 * sweep. No mascot: the spark is deliberately abstract.
 *
 * The cable is a tube rebuilt in place every frame (fixed vertex count,
 * positions only) from the device's live pose, so it stays plugged in
 * through the idle sway and drag-orbit. It draws itself in from the
 * spark toward the port on arrival, the plug seats, then pulses travel
 * down it on a loop.
 */

/**
 * USB-C mouth, model space (metres). From the Q/S handoff: the mouth sits
 * at 58.8mm along the long axis, centre 6.46mm up the stack — NOT the
 * shell's 62.5mm tip, which left the plug floating clear of the device.
 */
const PORT = new THREE.Vector3(0, 0.00646, 0.0588);
/** Out of the port, model space. */
const OUT = new THREE.Vector3(0, 0, 1);

const SEGMENTS = 96;
const RADIAL = 10;
const REVEAL_S = 1.1; // cable draws in
const PULSE_EVERY_S = 1.6;

const pulseUniforms = {
  uMzReveal: { value: 0 },
  uMzPulse: { value: -1 },
  uMzFade: { value: 0 },
};

function cableMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: "#1b1c20",
    roughness: 0.55,
    metalness: 0.15,
    transparent: true,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pulseUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vMzU;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMzU = uv.x;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vMzU;
         uniform float uMzReveal;
         uniform float uMzPulse;
         uniform float uMzFade;`,
      )
      // u runs spark (0) → port (1); only the drawn-in part exists.
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (vMzU > uMzReveal) discard;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float pd = (vMzU - uMzPulse) * 18.0;
         float pulse = exp(-pd * pd);
         // A faint charge near the spark end, always.
         float source = exp(-vMzU * 9.0) * 0.6;
         totalEmissiveRadiance += vec3(0.3, 0.58, 1.0) * (pulse * 2.4 + source);`,
      )
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.a *= uMzFade;",
      );
  };
  m.customProgramCacheKey = () => "mz-cable";
  return m;
}

/** A soft round glow for the spark's halo. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(220,235,255,1)");
  grad.addColorStop(0.18, "rgba(120,170,255,0.75)");
  grad.addColorStop(0.5, "rgba(60,110,255,0.18)");
  grad.addColorStop(1, "rgba(40,80,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/** Rewrite a tube's vertices along `curve` (fixed topology, from TubeGeometry). */
function writeTube(
  geo: THREE.BufferGeometry,
  curve: THREE.Curve<THREE.Vector3>,
  radius: number,
) {
  const frames = curve.computeFrenetFrames(SEGMENTS, false);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  let k = 0;
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = curve.getPointAt(i / SEGMENTS, tmpA);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= RADIAL; j++) {
      const v = (j / RADIAL) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      tmpN
        .set(
          cos * N.x + sin * B.x,
          cos * N.y + sin * B.y,
          cos * N.z + sin * B.z,
        )
        .normalize();
      nor.setXYZ(k, tmpN.x, tmpN.y, tmpN.z);
      pos.setXYZ(
        k,
        p.x + radius * tmpN.x,
        p.y + radius * tmpN.y,
        p.z + radius * tmpN.z,
      );
      k++;
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geo.computeBoundingSphere();
}

export function AgentCable({
  frameRef,
  device,
}: {
  frameRef: MutableRefObject<Frame | null>;
  /** Model-space → world for the device (the rear shell's wrapper group). */
  device: THREE.Object3D;
}) {
  const cableRef = useRef<THREE.Mesh>(null);
  const plugRef = useRef<THREE.Mesh>(null);
  const sparkRef = useRef<THREE.Group>(null);
  const clock = useRef({ t: 0, active: false });

  const { geometry, material, glow } = useMemo(() => {
    // Seed topology (and uvs: u along the length) from a real TubeGeometry.
    const seed = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
    ]);
    return {
      geometry: new THREE.TubeGeometry(seed, SEGMENTS, 1, RADIAL, false),
      material: cableMaterial(),
      glow: glowTexture(),
    };
  }, []);

  useFrame((_, delta) => {
    const f = frameRef.current;
    const cable = cableRef.current;
    const plug = plugRef.current;
    const spark = sparkRef.current;
    if (!f || !cable || !plug || !spark) return;
    const w = f.agent;
    const on = w > 0.01;
    cable.visible = plug.visible = spark.visible = on;
    if (!on) {
      clock.current = { t: 0, active: false };
      return;
    }
    // Start the draw-in once we've mostly arrived on the step.
    const c = clock.current;
    if (w > 0.6) c.active = true;
    if (c.active) c.t += delta;

    device.updateMatrixWorld(true);
    const port = tmpA.copy(PORT).applyMatrix4(device.matrixWorld);
    const out = tmpB
      .copy(OUT)
      .transformDirection(device.matrixWorld)
      .normalize();
    const scale = device.matrixWorld.getMaxScaleOnAxis();
    const plugLen = 0.02 * scale;
    const s = f.spark;
    // Spark → a gentle bow → straight out of the port for the plug's
    // length. The bow scales with the span, so the cable never dives off
    // screen however far apart the two ends sit.
    const tail = port.clone().addScaledVector(out, plugLen * 2.2);
    const span = s.distanceTo(tail);
    const mid = s
      .clone()
      .lerp(tail, 0.5)
      .add(new THREE.Vector3(0, -0.28 * span, 0.12 * span));
    const curve = new THREE.CatmullRomCurve3(
      [
        s.clone(),
        mid,
        tail,
        port.clone().addScaledVector(out, plugLen * 1.2),
        port.clone().addScaledVector(out, plugLen * 0.55),
      ],
      false,
      "centripetal",
    );
    writeTube(cable.geometry, curve, 0.0022 * scale);

    const reveal = THREE.MathUtils.smoothstep(c.t, 0, REVEAL_S);
    pulseUniforms.uMzReveal.value = reveal;
    pulseUniforms.uMzFade.value = w;
    const since = c.t - REVEAL_S;
    pulseUniforms.uMzPulse.value =
      since > 0 ? (since % PULSE_EVERY_S) / (PULSE_EVERY_S * 0.8) : -1;

    // Plug overmold seats as the cable arrives.
    // Seated ~4mm into the mouth so the overmold meets the shell.
    plug.position.copy(port).addScaledVector(out, plugLen * 0.3);
    plug.lookAt(port.clone().addScaledVector(out, plugLen));
    plug.scale.setScalar(scale);
    (plug.material as THREE.MeshStandardMaterial).opacity =
      w * THREE.MathUtils.smoothstep(reveal, 0.92, 1);

    // The spark breathes.
    spark.position.copy(s);
    const breathe = 1 + Math.sin(c.t * 3.1) * 0.08;
    spark.scale.setScalar((0.6 + 0.4 * w) * breathe);
    spark.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.opacity = w;
    });
  });

  return (
    <>
      <mesh
        ref={cableRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
      />
      <mesh ref={plugRef}>
        {/* USB-C overmold, model units (m): ~12.4 × 6.5 × 20mm. */}
        <boxGeometry args={[0.0124, 0.0065, 0.02]} />
        <meshStandardMaterial
          color="#2a2b30"
          roughness={0.45}
          metalness={0.3}
          transparent
        />
      </mesh>
      <group ref={sparkRef}>
        <mesh>
          <icosahedronGeometry args={[0.035, 2]} />
          <meshBasicMaterial color="#eaf2ff" transparent toneMapped={false} />
        </mesh>
        <sprite scale={[0.42, 0.42, 1]}>
          <spriteMaterial
            map={glow}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      </group>
    </>
  );
}
