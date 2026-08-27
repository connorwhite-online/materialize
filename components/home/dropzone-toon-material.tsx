"use client";

import { useEffect, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { DROPZONE_LOOKS, type DropzoneLookId } from "./dropzone-looks";
import { TOON_PENCIL_SPEC } from "./dropzone-toon";

/**
 * Colored-pencil fill for the dropzone primitives.
 *
 * Half-Lambert wrap blends through a same-family gradient
 * (shadow → mid → highlight) with wide smoothsteps — soft form,
 * no cel cuts. A quiet specular tip and denser paper grain read as
 * pencil tooth. Ink silhouette is drawn separately by `<Outlines>`.
 *
 * Uniforms are set on the instance (not the constructor) — drei's
 * factory class ignores constructor args.
 */
const DropzoneToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color("#8a8a8a"),
    uShadow: new THREE.Color("#5f7388"),
    uHighlight: new THREE.Color("#e4eaf2"),
    uSpec: TOON_PENCIL_SPEC,
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
    uniform float uSpec;

    varying vec3 vNormal;
    varying vec3 vViewDir;

    float paperGrain(vec2 p) {
      float a = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      float b = fract(sin(dot(p * 1.7, vec2(39.346, 11.135))) * 24634.6345);
      return mix(a, b, 0.45);
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewDir);
      vec3 L = normalize(vec3(0.4, 0.78, 0.48));

      float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);

      // Soft same-family ramp — colored pencil, not flat, not cel.
      vec3 shade = mix(uShadow, uColor, smoothstep(0.1, 0.58, wrap));
      shade = mix(shade, uHighlight, smoothstep(0.52, 0.96, wrap));

      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 26.0);
      shade = mix(shade, uHighlight, spec * uSpec);

      float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
      shade = mix(shade, mix(uColor, uHighlight, 0.65), rim * 0.18);

      float grain = paperGrain(gl_FragCoord.xy);
      shade *= 1.0 - grain * 0.08;
      shade = mix(shade, uShadow, grain * 0.05);

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
    m.uSpec = TOON_PENCIL_SPEC;
    m.toneMapped = false;
    return m;
  }, [look.toonColor, look.toonShadow, look.toonHighlight]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
