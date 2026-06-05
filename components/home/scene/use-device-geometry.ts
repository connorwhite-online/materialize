"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const MODEL_URL = "/models/device.gltf";
// Target on-screen height (scene units) for the device's long axis.
const TARGET_HEIGHT = 1.5;

export interface CapPlane {
  /** A point on the drafted end face (scene units). */
  point: THREE.Vector3;
  /** Outward normal of the drafted end face. */
  normal: THREE.Vector3;
}

export interface DeviceGeometry {
  /** Front cover body (has the camera/LED/mic holes), faces the camera. */
  front: THREE.BufferGeometry;
  /** Back cover body. */
  back: THREE.BufferGeometry;
  /** Size in scene units: x = width, y = height, z = thickness. */
  size: THREE.Vector3;
  /** Drafted top end face (camera/LED/mic holes). */
  topCap: CapPlane;
  /** Drafted bottom end face (USB-C hole). */
  bottomCap: CapPlane;
}

// Measure the drafted end face (top: sign +1, bottom: sign -1): average
// the position + normal of the triangles near that end whose normal
// points along ±Y. Captures the real 10° draft so seated components can
// match it instead of facing straight up/down.
function computeCap(geos: THREE.BufferGeometry[], box: THREE.Box3, sign: 1 | -1): CapPlane {
  const hgt = box.max.y - box.min.y;
  const yThresh = sign > 0 ? box.max.y - hgt * 0.14 : box.min.y + hgt * 0.14;
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  let count = 0;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  for (const g of geos) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    if (!nor) continue;
    const idx = g.index;
    const tris = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(pos, i0);
      vb.fromBufferAttribute(pos, i1);
      vc.fromBufferAttribute(pos, i2);
      const cy = (va.y + vb.y + vc.y) / 3;
      if (sign > 0 ? cy < yThresh : cy > yThresh) continue;
      na.fromBufferAttribute(nor, i0);
      nb.fromBufferAttribute(nor, i1);
      nc.fromBufferAttribute(nor, i2);
      const ny = (na.y + nb.y + nc.y) / 3;
      if (sign > 0 ? ny < 0.5 : ny > -0.5) continue;
      n.x += (na.x + nb.x + nc.x) / 3;
      n.y += ny;
      n.z += (na.z + nb.z + nc.z) / 3;
      p.x += (va.x + vb.x + vc.x) / 3;
      p.y += cy;
      p.z += (va.z + vb.z + vc.z) / 3;
      count++;
    }
  }
  if (count === 0) {
    return {
      point: new THREE.Vector3(0, (sign * (box.max.y - box.min.y)) / 2, 0),
      normal: new THREE.Vector3(0, sign, 0),
    };
  }
  return { point: p.multiplyScalar(1 / count), normal: n.normalize() };
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

    const finalBox = union();
    const size = finalBox.getSize(new THREE.Vector3());
    const topCap = computeCap(all, finalBox, 1);
    const bottomCap = computeCap(all, finalBox, -1);
    return { front, back, size, topCap, bottomCap };
  }, [scene, nodes]);
}

useGLTF.preload(MODEL_URL);
