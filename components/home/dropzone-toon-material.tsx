"use client";

import { useEffect, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { DROPZONE_LOOKS, type DropzoneLookId } from "./dropzone-looks";
import { TOON_LIT_EDGE, TOON_MID_EDGE } from "./dropzone-toon";

/**
 * Cartoon cel for the dropzone primitives.
 *
 * Half-Lambert wrap is quantized into three hard paint chips
 * (shadow / mid / light) with a ~0.05 AA so the cuts stay crisp
 * without stair-stepping. A high-power specular is itself stepped
 * into a coin-shaped highlight — the anime blob, not a glossy lobe.
 *
 * Uniforms are set on the instance (not the constructor) — drei's
 * factory class ignores constructor args, which left the viewer
 * material flat grey until that was fixed.
 */
const DropzoneToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color("#8a8a8a"),
    uShadow: new THREE.Color("#5f7388"),
    uHighlight: new THREE.Color("#e4eaf2"),
    uMidEdge: TOON_MID_EDGE,
    uLitEdge: TOON_LIT_EDGE,
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
    uniform vec3 uShadow;
    uniform vec3 uHighlight;
    uniform float uMidEdge;
    uniform float uLitEdge;

    varying vec3 vNormal;
    varying vec3 vViewDir;

    float celstep(float edge, float x) {
      return smoothstep(edge - 0.025, edge + 0.025, x);
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewDir);
      vec3 L = normalize(vec3(0.42, 0.74, 0.52));

      float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
      float midBand = celstep(uMidEdge, wrap);
      float litBand = celstep(uLitEdge, wrap);

      vec3 shade = mix(uShadow, uColor, midBand);
      shade = mix(shade, uHighlight, litBand);

      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 56.0);
      float specBlob = celstep(0.32, spec);
      vec3 specColor = mix(uHighlight, vec3(1.0), 0.62);
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
    m.uShadow = new THREE.Color(look.toonShadow);
    m.uHighlight = new THREE.Color(look.toonHighlight);
    m.uMidEdge = TOON_MID_EDGE;
    m.uLitEdge = TOON_LIT_EDGE;
    m.toneMapped = false;
    return m;
  }, [look.toonColor, look.toonShadow, look.toonHighlight]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
