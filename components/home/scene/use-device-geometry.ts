"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MODEL_URL = "/models/device.gltf";
// Target on-screen height (scene units) for the device's long axis.
const TARGET_HEIGHT = 1.5;

export interface DeviceGeometry {
  /** Front cover half (triangles with centroid z ≥ 0). */
  front: THREE.BufferGeometry;
  /** Back half. */
  back: THREE.BufferGeometry;
  /** Whole shell. */
  full: THREE.BufferGeometry;
  /** Size in scene units: x = width, y = height, z = thickness. */
  size: THREE.Vector3;
}

// Split a non-indexed geometry into two halves at z = 0 by triangle
// centroid. Returns real sub-meshes (no clipping planes), so the halves
// move cleanly with the rotating device in the teardown.
function splitByZ(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position.array as ArrayLike<number>;
  const nor = geo.attributes.normal?.array as ArrayLike<number> | undefined;
  const fp: number[] = [];
  const fn: number[] = [];
  const bp: number[] = [];
  const bn: number[] = [];
  for (let t = 0; t < pos.length; t += 9) {
    const cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
    const p = cz >= 0 ? fp : bp;
    const n = cz >= 0 ? fn : bn;
    for (let k = 0; k < 9; k++) p.push(pos[t + k]);
    if (nor) for (let k = 0; k < 9; k++) n.push(nor[t + k]);
  }
  const make = (p: number[], n: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    if (n.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    return g;
  };
  return { front: make(fp, fn), back: make(bp, bn) };
}

/**
 * Loads the device hardbody (glTF — smooth normals, single embedded
 * mesh) and prepares it for the scene: node transforms baked in,
 * centred, rotated so its largest face points at the camera (local
 * X = width, Y = height, Z = thickness), scaled to a consistent
 * on-screen height, and split into front/back halves for the teardown.
 * Must be used under a <Suspense> boundary (useGLTF suspends).
 */
export function useDeviceGeometry(): DeviceGeometry {
  const { scene } = useGLTF(MODEL_URL);
  return useMemo(() => {
    scene.updateWorldMatrix(true, true);
    let src: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    if (!src) throw new Error("device gltf: no mesh found");

    let geo = (src as THREE.Mesh).geometry.clone();
    geo.applyMatrix4((src as THREE.Mesh).matrixWorld); // bake node rotation
    geo = geo.toNonIndexed();
    geo.deleteAttribute("uv");

    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox!.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);
    // Big face faces ±X (thickness axis) after baking; rotate it to face
    // the camera: X = width, Y = height, Z = thickness.
    geo.rotateY(-Math.PI / 2);
    geo.computeBoundingBox();
    const rawSize = new THREE.Vector3();
    geo.boundingBox!.getSize(rawSize);
    const s = TARGET_HEIGHT / rawSize.y;
    geo.scale(s, s, s);
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);

    const { front, back } = splitByZ(geo);
    return { front, back, full: geo, size };
  }, [scene]);
}

useGLTF.preload(MODEL_URL);
