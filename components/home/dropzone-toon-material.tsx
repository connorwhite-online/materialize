"use client";

import { useEffect, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { DROPZONE_LOOKS, type DropzoneLookId } from "./dropzone-looks";
import {
  TOON_DEEP_EDGE,
  TOON_LIT_EDGE,
  TOON_MID_EDGE,
  TOON_RIM_EDGE,
} from "./dropzone-toon";

/**
 * Cartoon cel for the dropzone primitives.
 *
 * Half-Lambert wrap is quantized into four hard paint chips
 * (deep / shadow / mid / light) with a ~0.012 AA so the cuts stay
 * poster-flat. A low-power specular is itself stepped into a large
 * coin-shaped highlight, and a fresnel rim paints a comic edge-light
 * on the dark side.
 *
 * Uniforms are set on the instance (not the constructor) — drei's
 * factory class ignores constructor args, which left the viewer
 * material flat grey until that was fixed.
 */
const DropzoneToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color("#8a8a8a"),
    uDeep: new THREE.Color("#1a1848"),
    uShadow: new THREE.Color("#5f7388"),
    uHighlight: new THREE.Color("#e4eaf2"),
    uDeepEdge: TOON_DEEP_EDGE,
    uMidEdge: TOON_MID_EDGE,
    uLitEdge: TOON_LIT_EDGE,
    uRimEdge: TOON_RIM_EDGE,
  },
  /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mvPosition.xyz);
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uDeep;
    uniform vec3 uShadow;
    uniform vec3 uHighlight;
    uniform float uDeepEdge;
    uniform float uMidEdge;
    uniform float uLitEdge;
    uniform float uRimEdge;

    varying vec3 vNormal;
    varying vec3 vViewDir;

    float celstep(float edge, float x) {
      return smoothstep(edge - 0.01, edge + 0.01, x);
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewDir);
      vec3 L = normalize(vec3(0.42, 0.74, 0.52));

      float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
      float deepBand = celstep(uDeepEdge, wrap);
      float midBand = celstep(uMidEdge, wrap);
      float litBand = celstep(uLitEdge, wrap);

      vec3 shade = mix(uDeep, uShadow, deepBand);
      shade = mix(shade, uColor, midBand);
      shade = mix(shade, uHighlight, litBand);

      float fres = 1.0 - max(dot(N, V), 0.0);
      float rimBand = celstep(uRimEdge, fres) * (1.0 - midBand);
      vec3 rimColor = mix(uColor, vec3(1.0), 0.4);
      shade = mix(shade, rimColor, rimBand * 0.75);

      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 18.0);
      float specBlob = celstep(0.16, spec);
      vec3 specColor = mix(uHighlight, vec3(1.0), 0.78);
      shade = mix(shade, specColor, specBlob);

      gl_FragColor = vec4(shade, 1.0);
    }
  `
);

export function DropzoneToonMaterial({ lookId }: { lookId: DropzoneLookId }) {
  const look = DROPZONE_LOOKS[lookId];
  const material = useMemo(() => {
    const m = new DropzoneToonShaderMaterial();
    m.uColor = new THREE.Color(look.toonColor);
    m.uDeep = new THREE.Color(look.toonDeep);
    m.uShadow = new THREE.Color(look.toonShadow);
    m.uHighlight = new THREE.Color(look.toonHighlight);
    m.uDeepEdge = TOON_DEEP_EDGE;
    m.uMidEdge = TOON_MID_EDGE;
    m.uLitEdge = TOON_LIT_EDGE;
    m.uRimEdge = TOON_RIM_EDGE;
    m.toneMapped = false;
    return m;
  }, [look.toonColor, look.toonDeep, look.toonShadow, look.toonHighlight]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
