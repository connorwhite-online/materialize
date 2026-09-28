"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Frame } from "./choreography";

/**
 * A sparse drift of the hologram's warm motes through the background of
 * the print and build steps — texture, not a feature. Each mote rises
 * slowly on its own clock, swaying, fading in and out, spread across the
 * whole view behind the device. Hands over to the hologram's own motes on
 * the agents step (fades out as frame.agent rises).
 */

const COUNT = 46;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform vec2 uView;
  uniform float uDpr;
  attribute float aSeed;
  varying float vA;
  void main() {
    float life = fract(uTime * (0.018 + 0.02 * aSeed) + aSeed * 5.31);
    vec3 p = position;
    p.x *= uView.x;
    p.y = (position.y - 0.5 + life * 1.1) * uView.y;
    p.x += sin(uTime * 0.25 + aSeed * 40.0) * 0.02 * uView.x;
    vA = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.6, 1.0, life))
       * (0.35 + 0.65 * aSeed) * uFade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.0 + 2.5 * aSeed) * uDpr;
  }
`;
const FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA * 0.7;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
  }
`;

const uniforms = {
  uTime: { value: 0 },
  uFade: { value: 1 },
  uView: { value: new THREE.Vector2(1, 1) },
  uDpr: { value: 1 },
};

export function AmbientMotes({
  frameRef,
}: {
  frameRef: MutableRefObject<Frame | null>;
}) {
  const ref = useRef<THREE.Points>(null);
  const viewport = useThree((s) => s.viewport);
  const dpr = useThree((s) => s.viewport.dpr);

  const g = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const h = (n: number) => {
        const s = Math.sin(n * 12.9898 + i * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      pos[i * 3] = h(1) - 0.5; // × view width in the shader
      pos[i * 3 + 1] = h(2); // start height, 0..1 of the view
      pos[i * 3 + 2] = -0.6 - h(3) * 1.6; // behind the device
      seed[i] = h(4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { geo, mat };
  }, []);

  useFrame((_, delta) => {
    const f = frameRef.current;
    const pts = ref.current;
    if (!f || !pts) return;
    const fade = 1 - THREE.MathUtils.smoothstep(f.agent, 0, 0.6);
    pts.visible = fade > 0.01;
    uniforms.uTime.value += Math.min(delta, 1 / 20);
    uniforms.uFade.value = fade;
    // A little wider/taller than the view so motes enter from off-screen.
    uniforms.uView.value.set(viewport.width * 1.3, viewport.height * 1.3);
    // Sizes are CSS pixels: scale by the canvas's pixel ratio.
    uniforms.uDpr.value = dpr;
  });

  return (
    <points ref={ref} geometry={g.geo} material={g.mat} frustumCulled={false} />
  );
}
