"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Quaternion, Vector3, type Group } from "three";

/**
 * Rotation that carries the product-preview light rig around with the
 * camera. Authored for the head-on shot (key up-right, fill behind-left,
 * rim from behind) — leave it pinned to world axes and an off-axis
 * angle reads as a silhouette. Shared by ThumbnailCapture and the
 * file-detail Stage path so listing thumbs and the live viewer shade
 * the same way (CON-35).
 */
export function previewLightRigQuaternion(
  cameraOffset: [number, number, number]
): Quaternion {
  const from = new Vector3(0, 0, 1);
  const to = new Vector3(...cameraOffset);
  if (to.lengthSq() === 0) return new Quaternion();
  return new Quaternion().setFromUnitVectors(from, to.normalize());
}

/**
 * Three-point product lights that track the orbit camera. Mounted with
 * Stage `intensity={0}` so Stage's world-fixed rembrandt rig does not
 * compete — otherwise a restored preview angle is lit from the side
 * and looks like a different rotation than the thumbnail.
 */
export function CameraRelativeLightRig() {
  const groupRef = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const offset = useRef(new Vector3());
  const target = useRef(new Vector3());

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    if (
      controls &&
      typeof controls === "object" &&
      "target" in controls &&
      controls.target instanceof Vector3
    ) {
      target.current.copy(controls.target);
    } else {
      target.current.set(0, 0, 0);
    }

    offset.current.copy(camera.position).sub(target.current);
    if (offset.current.lengthSq() === 0) return;
    group.quaternion.copy(
      previewLightRigQuaternion([
        offset.current.x,
        offset.current.y,
        offset.current.z,
      ])
    );
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.16} color="#fff3e3" />
      <directionalLight
        position={[5, 6, 5]}
        intensity={1.4}
        color="#ffeed6"
      />
      <directionalLight
        position={[-6, -1, -3]}
        intensity={0.35}
        color="#fff2e0"
      />
      <directionalLight
        position={[0, 2, -6]}
        intensity={0.75}
        color="#ffefd8"
      />
    </group>
  );
}
