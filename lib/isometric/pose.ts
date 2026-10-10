import * as THREE from "three";

/**
 * True isometric pose: yaw the part, then turn the world 45° about Y
 * and tip it 35.26° toward the camera so all three axes foreshorten
 * equally. The renderer's camera looks straight down −Z, so after this
 * pose object space *is* view space — which is what lets the tone
 * shader read view-facing directly off the normal.
 */
export function isometricMatrix(yaw = 0) {
  return new THREE.Matrix4()
    .makeRotationX(Math.atan(1 / Math.SQRT2))
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 4 + yaw));
}
