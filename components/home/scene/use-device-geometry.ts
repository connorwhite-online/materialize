"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MODEL_URL = "/models/device.gltf";
// Target on-screen height (scene units) for the device's long axis.
const TARGET_HEIGHT = 1.5;

export interface DeviceGeometry {
  /** Front cover body (has the camera/LED/mic holes), faces the camera. */
  front: THREE.BufferGeometry;
  /** Back cover body. */
  back: THREE.BufferGeometry;
  /** Size in scene units: x = width, y = height, z = thickness. */
  size: THREE.Vector3;
}

/**
 * Loads the two-body device shell (glTF: `v6-front` + `v6-back`, split
 * along the assembly access line) and prepares it for the scene. Node
 * transforms are baked in; the assembly is centred, rotated so the big
 * face (and the front cover's holes) points at the camera — local
 * X = width, Y = height, Z = thickness — and scaled to a consistent
 * height. The two bodies share one transform so they stay aligned, and
 * are returned separately so the case opens along Z in the teardown.
 * Must be used under a <Suspense> boundary (useGLTF suspends).
 */
export function useDeviceGeometry(): DeviceGeometry {
  const { scene, nodes } = useGLTF(MODEL_URL);
  return useMemo(() => {
    scene.updateWorldMatrix(true, true);

    const bake = (name: string): THREE.BufferGeometry => {
      const mesh = nodes[name] as THREE.Mesh | undefined;
      if (!mesh?.geometry) throw new Error(`device gltf: missing body ${name}`);
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld); // bake node rotation + translation
      if (g.getAttribute("uv")) g.deleteAttribute("uv");
      return g;
    };

    const front = bake("v6-front");
    const back = bake("v6-back");
    const all = [front, back];

    const union = () => {
      const box = new THREE.Box3();
      for (const g of all) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      }
      return box;
    };

    // Centre the whole assembly.
    const center = union().getCenter(new THREE.Vector3());
    for (const g of all) g.translate(-center.x, -center.y, -center.z);

    // Big face normal is ±X after baking; rotate so the front cover
    // (−X side) faces the camera (+Z). X = width, Y = height, Z = thickness.
    for (const g of all) g.rotateY(Math.PI / 2);

    const rawSize = union().getSize(new THREE.Vector3());
    const s = TARGET_HEIGHT / rawSize.y;
    for (const g of all) g.scale(s, s, s);

    const size = union().getSize(new THREE.Vector3());
    return { front, back, size };
  }, [scene, nodes]);
}

useGLTF.preload(MODEL_URL);
