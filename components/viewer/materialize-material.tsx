"use client";

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
  // Vertex shader
  /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vFresnel;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec3 viewDir = normalize(-mvPosition.xyz);
      vec3 normal = normalize(normalMatrix * normal);

      // Fresnel — brighter at glancing angles
      vFresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.5);
      vNormal = normal;
      vViewDir = viewDir;

      gl_Position = projectionMatrix * mvPosition;
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
    varying float vFresnel;

    void main() {
      // Simple hemisphere lighting — warm top, cool bottom
      float hemisphere = dot(vNormal, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
      vec3 baseLight = mix(uAccentColor, uBaseColor, hemisphere);

      // Subtle directional light from upper-right
      vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
      float diffuse = max(dot(vNormal, lightDir), 0.0);
      baseLight += vec3(0.12) * diffuse;

      // Fresnel edge glow
      float fresnel = pow(vFresnel, uFresnelPower) * uFresnelIntensity;
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
}

export function MaterializeMaterial({
  baseColor = "#d4d4d8",
  accentColor = "#a1a1aa",
  fresnelColor = "#e4e4e7",
}: MaterializeMaterialProps) {
  return (
    <primitive
      object={new MaterializeShaderMaterial({
        uBaseColor: new THREE.Color(baseColor),
        uAccentColor: new THREE.Color(accentColor),
        uFresnelColor: new THREE.Color(fresnelColor),
        uFresnelPower: 2.5,
        uFresnelIntensity: 0.4,
      })}
      attach="material"
    />
  );
}
