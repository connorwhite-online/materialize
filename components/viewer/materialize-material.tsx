"use client";

import { useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Custom shader for Materialize — clean, modern look.
 * Combines smooth matcap-style lighting with a subtle fresnel edge glow.
 * No textures needed, fully procedural, GPU-friendly.
 */
const MaterializeShaderMaterial = shaderMaterial(
  {
    uBaseColor: new THREE.Color("#d4d4d8"),
    uAccentColor: new THREE.Color("#a1a1aa"),
    uFresnelColor: new THREE.Color("#e4e4e7"),
    uFresnelPower: 2.5,
    uFresnelIntensity: 0.4,
  },
  // Vertex shader — pass the raw view-space normal and viewDir through;
  // do all the lighting math in the fragment shader so interpolation
  // doesn't smear it.
  /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    #include <clipping_planes_pars_vertex>

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mvPosition.xyz);
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
    }
  `,
  // Fragment shader
  /* glsl */ `
    uniform vec3 uBaseColor;
    uniform vec3 uAccentColor;
    uniform vec3 uFresnelColor;
    uniform float uFresnelPower;
    uniform float uFresnelIntensity;

    varying vec3 vNormal;
    varying vec3 vViewDir;
    #include <clipping_planes_pars_fragment>

    void main() {
      // Discard fragments outside the active cross-section planes (no-op
      // when none are set).
      #include <clipping_planes_fragment>

      // Re-normalize after interpolation — the interpolated normal is
      // not unit length except at the vertices.
      vec3 N = normalize(vNormal);
      // Flip the normal on back faces so the exposed interior (rendered
      // double-sided under a cross-section) is lit correctly instead of black.
      if (!gl_FrontFacing) N = -N;
      vec3 V = normalize(vViewDir);

      // Hemisphere lighting — warm top, cool bottom
      float hemisphere = N.y * 0.5 + 0.5;
      vec3 baseLight = mix(uAccentColor, uBaseColor, hemisphere);

      // Subtle directional light from upper-right
      vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
      float diffuse = max(dot(N, lightDir), 0.0);
      baseLight += vec3(0.18) * diffuse;

      // Fresnel edge glow — single pow, computed in the fragment so the
      // falloff is correct across the surface.
      float fresnel =
          pow(1.0 - max(dot(N, V), 0.0), uFresnelPower) * uFresnelIntensity;
      vec3 color = mix(baseLight, uFresnelColor, fresnel);

      gl_FragColor = vec4(color, 1.0);
    }
  `
);

extend({ MaterializeShaderMaterial });

interface MaterializeMaterialProps {
  baseColor?: string;
  accentColor?: string;
  fresnelColor?: string;
  /** Active cross-section planes; renders double-sided so interiors show. */
  clippingPlanes?: THREE.Plane[];
}

export function MaterializeMaterial({
  baseColor = "#d4d4d8",
  accentColor = "#a1a1aa",
  fresnelColor = "#e4e4e7",
  clippingPlanes,
}: MaterializeMaterialProps) {
  // drei's shaderMaterial factory makes a class whose constructor takes
  // no arguments — uniforms are exposed as property setters on the
  // instance. Passing them via constructor (the previous pattern) made
  // ShaderMaterial warn and left every uniform at its default, which is
  // why every shaded mesh rendered as flat grey.
  const material = useMemo(() => {
    const m = new MaterializeShaderMaterial();
    m.uBaseColor = new THREE.Color(baseColor);
    m.uAccentColor = new THREE.Color(accentColor);
    m.uFresnelColor = new THREE.Color(fresnelColor);
    m.uFresnelPower = 2.5;
    m.uFresnelIntensity = 0.4;
    return m;
  }, [baseColor, accentColor, fresnelColor]);

  // Apply clipping imperatively each render: toggling the plane count changes
  // the shader's NUM_CLIPPING_PLANES define, so flip needsUpdate only on that
  // transition (recompile). Mutating plane.constant live needs no recompile.
  const clip = !!clippingPlanes && clippingPlanes.length > 0;
  if (material.clipping !== clip) {
    material.clipping = clip;
    material.needsUpdate = true;
  }
  material.clippingPlanes = clip ? clippingPlanes! : null;
  material.side = clip ? THREE.DoubleSide : THREE.FrontSide;

  return <primitive object={material} attach="material" />;
}
