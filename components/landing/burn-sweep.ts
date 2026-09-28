import * as THREE from "three";
import {
  LANDING_MATERIALS,
  wrapIndex,
  type LandingMaterial,
} from "./landing-materials";

/**
 * The "burn" material change: a thin electric-blue band climbs the
 * enclosure bottom → top, and the new material is left behind it — like
 * a Jacob's ladder re-skinning the part.
 *
 * The edge isn't a straight cut: it's the line warped by animated fBm
 * noise, so it eats upward like burning paper, and the glow — a hot
 * white core, a blue halo and crawling filaments — rides that same edge.
 * The shell materials are ordinary MeshPhysicalMaterials with a small
 * fragment hook (onBeforeCompile), so resin's transmission and the baked
 * AO still work. Each shell is drawn as up to three layers sharing one
 * geometry:
 *
 *   a    — the current material, kept ABOVE the noisy edge
 *   b    — the incoming material, kept BELOW it
 *   band — additive glow around the edge
 *
 * Between sweeps only `a` draws, unclipped, so the effect costs nothing
 * while idle.
 */

/** Seconds for the band to climb the whole device. */
export const SWEEP_S = 0.9;
/** On the first step, a new sweep starts every CYCLE_S seconds. */
export const CYCLE_S = 2;
/** Every step except the first shows the plain white plastic. */
export const PLAIN = 0;

/**
 * What to sweep to next, or null to hold. Pure, so the schedule is
 * testable without a GPU.
 *
 * - Never interrupts a sweep in flight.
 * - Off the first step: one sweep back to the plain plastic, then hold.
 * - On the first step: advance through every family, one per CYCLE_S.
 */
export function nextSweep(
  step: number,
  current: number,
  sinceLastSweep: number,
  sweeping: boolean,
): number | null {
  if (sweeping) return null;
  if (step !== 0) return current === PLAIN ? null : PLAIN;
  if (sinceLastSweep >= CYCLE_S) return wrapIndex(current + 1);
  return null;
}

/** Smooth, slightly front-loaded climb: quick off the bottom, eases into the top. */
export function sweepEase(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 2.2);
}

// ─── three.js layers ──────────────────────────────────────────────────

/**
 * One set of sweep uniforms, shared by every shell material and band so
 * the burn edge and its glow can never drift apart. World-space, updated
 * once per frame by `setSweepLine`.
 */
export const sweepUniforms = {
  uMzActive: { value: 0 },
  uMzLine: { value: 0 }, // world y of the (un-warped) edge
  uMzSpan: { value: 1 }, // device height, scales the noise to the part
  uMzTime: { value: 0 },
  uMzGlow: { value: 0 },
};

/**
 * Compact 3D value noise + fBm. The edge is the line warped by low-freq
 * fBm that crawls over time; filaments use a high-freq octave of it.
 */
const NOISE_GLSL = /* glsl */ `
  float mzHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float mzNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mzHash(i + vec3(0,0,0)), mzHash(i + vec3(1,0,0)), f.x),
          mix(mzHash(i + vec3(0,1,0)), mzHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(mzHash(i + vec3(0,0,1)), mzHash(i + vec3(1,0,1)), f.x),
          mix(mzHash(i + vec3(0,1,1)), mzHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float mzFbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * mzNoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  // World-space height of the burn edge under this point.
  float mzEdge(vec3 w) {
    float f = 7.0 / uMzSpan;
    return uMzLine + (mzFbm(vec3(w.xz * f, uMzTime * 0.7)) - 0.5) * uMzSpan * 0.09;
  }
`;

const UNIFORMS_GLSL = /* glsl */ `
  uniform float uMzActive;
  uniform float uMzLine;
  uniform float uMzSpan;
  uniform float uMzTime;
  uniform float uMzGlow;
  varying vec3 vMzWorld;
`;

/**
 * Hook a physical material so, while a sweep runs, it only draws on one
 * side of the noisy edge: side +1 keeps above (outgoing), −1 below
 * (incoming). Everything else about the material — AO, transmission,
 * clearcoat — is untouched.
 */
function burnable(m: THREE.MeshPhysicalMaterial, side: 1 | -1) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sweepUniforms, { uMzSide: { value: side } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${UNIFORMS_GLSL}`)
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvMzWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${UNIFORMS_GLSL}\nuniform float uMzSide;\n${NOISE_GLSL}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
         if (uMzActive > 0.5 && uMzSide * (vMzWorld.y - mzEdge(vMzWorld)) < 0.0) discard;`,
      );
  };
  // Same GLSL for both sides (uMzSide is a uniform), so one program.
  m.customProgramCacheKey = () => "mz-burnable";
}

/** The glow: hot white core on the edge, blue halo, crawling filaments. */
function bandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: sweepUniforms,
    vertexShader: /* glsl */ `
      ${UNIFORMS_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vMzWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${UNIFORMS_GLSL}
      ${NOISE_GLSL}
      void main() {
        float width = uMzSpan * 0.006;
        float d = (vMzWorld.y - mzEdge(vMzWorld)) / width;
        float core = exp(-d * d * 3.0);          // hot line on the edge
        float halo = exp(-d * d * 0.05);          // wide electric-blue bloom
        // Arcs crawling up off the edge: high-freq fBm, thresholded, fast.
        // Stretched: fine across, coarse vertically → thin upright streaks
        // hugging the line, not clouds drifting away from it.
        float f = mzFbm(vec3(vMzWorld.xz * (70.0 / uMzSpan),
                             vMzWorld.y * (9.0 / uMzSpan) - uMzTime * 5.0));
        float fil = smoothstep(0.6, 0.72, f) * exp(-abs(d) * 0.28);
        // Normal (not additive) blending: additive blue on a white shell is
        // still white, so the glow vanished on plastic. Alpha-blended, it
        // tints light materials blue and lights dark ones alike.
        float a = clamp((core + halo * 0.55 + fil * 0.85) * uMzGlow, 0.0, 0.95);
        if (a < 0.01) discard;
        vec3 blue = vec3(0.22, 0.52, 1.0);
        vec3 hot = vec3(0.86, 0.95, 1.0);
        vec3 col = mix(blue, hot, clamp(core * 1.2 + fil * 0.3, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    // Sits exactly on the shell's own surface; win the depth tie.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}

export interface ShellLayers {
  a: THREE.Mesh;
  b: THREE.Mesh;
  band: THREE.Mesh;
  matA: THREE.MeshPhysicalMaterial;
  matB: THREE.MeshPhysicalMaterial;
}

function shellMaterial(
  ao: THREE.Texture,
  side: 1 | -1,
): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    clearcoatRoughness: 0.12,
    aoMap: ao,
    aoMapIntensity: 1.3,
  });
  burnable(m, side);
  return m;
}

/**
 * Turn a shell mesh into its three layers. `mesh` becomes layer `a`; the
 * other two are siblings sharing its geometry and transform.
 */
export function makeShellLayers(
  mesh: THREE.Mesh,
  ao: THREE.Texture,
): ShellLayers {
  const matA = shellMaterial(ao, 1);
  const matB = shellMaterial(ao, -1);
  mesh.material = matA;
  const b = new THREE.Mesh(mesh.geometry, matB);
  const band = new THREE.Mesh(mesh.geometry, bandMaterial());
  for (const layer of [b, band]) {
    layer.position.copy(mesh.position);
    layer.quaternion.copy(mesh.quaternion);
    layer.scale.copy(mesh.scale);
    layer.visible = false;
    mesh.parent?.add(layer);
  }
  band.renderOrder = 2;
  return { a: mesh, b, band, matA, matB };
}

export function applyLook(
  m: THREE.MeshPhysicalMaterial,
  look: LandingMaterial,
) {
  m.color.set(look.color);
  m.metalness = look.metalness;
  m.roughness = look.roughness;
  m.clearcoat = look.clearcoat ?? 0;
  // Exactly 0 when not glass: any transmission > 0 costs an extra pass.
  m.transmission = look.transmission ?? 0;
  m.ior = look.ior ?? 1.5;
  m.thickness = look.thickness ?? 0;
}

/** Begin a sweep on one shell: `b` takes the incoming look. */
export function startSweep(l: ShellLayers, to: number) {
  applyLook(l.matB, LANDING_MATERIALS[to]);
  l.b.visible = true;
  l.band.visible = true;
}

/**
 * Drive the shared sweep uniforms: the edge's world height `h`, the
 * device height `span` (noise scale), time, and the glow envelope.
 */
export function setSweepLine(
  h: number,
  span: number,
  time: number,
  glow: number,
) {
  sweepUniforms.uMzActive.value = 1;
  sweepUniforms.uMzLine.value = h;
  sweepUniforms.uMzSpan.value = span;
  sweepUniforms.uMzTime.value = time;
  sweepUniforms.uMzGlow.value = glow;
}

/** Finish: the incoming look becomes the resting one, extra layers hide. */
export function endSweep(l: ShellLayers, to: number) {
  applyLook(l.matA, LANDING_MATERIALS[to]);
  l.b.visible = false;
  l.band.visible = false;
  sweepUniforms.uMzActive.value = 0;
}
