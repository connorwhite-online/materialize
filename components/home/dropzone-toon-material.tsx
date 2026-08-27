"use client";

import { useEffect, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { DROPZONE_LOOKS, type DropzoneLookId } from "./dropzone-looks";

/**
 * Soft colored toon for the dropzone primitives.
 *
 * Half-Lambert wrap so the dark side stays a tint, not a hole. Two
 * wide smoothsteps mix the look's toon mid → shadow and mid →
 * highlight so the shade reads as a quiet color blend, not a comic
 * cutout. A cheap hemisphere and rim add a little extra chroma as
 * the shape turns.
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

    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewDir);
      vec3 L = normalize(vec3(0.42, 0.74, 0.52));

      float wrap = dot(N, L) * 0.5 + 0.5;
      vec3 shade = mix(uShadow, uColor, smoothstep(0.18, 0.58, wrap));
      shade = mix(shade, uHighlight, smoothstep(0.62, 0.94, wrap));

      float hemi = N.y * 0.5 + 0.5;
      shade = mix(shade, mix(uShadow, uHighlight, hemi), 0.16);

      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 40.0);
      shade += uHighlight * spec * 0.28;

      float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
      shade += uHighlight * rim * 0.2;

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
    m.toneMapped = false;
    return m;
  }, [look.toonColor, look.toonShadow, look.toonHighlight]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
