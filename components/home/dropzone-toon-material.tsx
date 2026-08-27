"use client";

import { useEffect, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";
import { DROPZONE_LOOKS, type DropzoneLookId } from "./dropzone-looks";
import { TOON_PENCIL_STRENGTH } from "./dropzone-toon";

/**
 * Flat sketch fill for the dropzone primitives.
 *
 * Almost flat pastel, with a soft pencil shade on the dark side and
 * a whisper of paper grain — reads like a sticker doodle, not a
 * cel-shaded render. The ink silhouette is drawn separately by
 * `<Outlines>`.
 *
 * Uniforms are set on the instance (not the constructor) — drei's
 * factory class ignores constructor args.
 */
const DropzoneToonShaderMaterial = shaderMaterial(
  {
    uColor: new THREE.Color("#8a8a8a"),
    uShadow: new THREE.Color("#5f7388"),
    uPencil: TOON_PENCIL_STRENGTH,
  },
  /* glsl */ `
    varying vec3 vNormal;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uShadow;
    uniform float uPencil;

    varying vec3 vNormal;

    float paperGrain(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = normalize(vec3(0.35, 0.82, 0.45));
      float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);

      // Soft pencil on the underside only — keeps the face flat.
      float shadeAmt = (1.0 - wrap) * uPencil;
      vec3 shade = mix(uColor, uShadow, shadeAmt);

      float grain = paperGrain(gl_FragCoord.xy) * 0.035;
      shade *= 1.0 - grain;

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
    m.uPencil = TOON_PENCIL_STRENGTH;
    m.toneMapped = false;
    return m;
  }, [look.toonColor, look.toonShadow]);

  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={material} attach="material" />;
}
