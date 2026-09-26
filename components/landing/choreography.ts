import { MathUtils, Matrix4, Quaternion, Vector3 } from "three";

/**
 * Scroll choreography for the anon landing's enclosure backdrop.
 *
 * Pure: given scroll progress (0 → 3, one unit per full-screen section)
 * and the visible viewport size at z = 0, return a world pose for every
 * part of the Pneuma Q enclosure. The scene only applies what this
 * returns, so every pose is testable without a GPU.
 *
 *   0  hero   — assembled, shells only, material carousel
 *   1  share  — front + rear shells split apart and shrink, file labels
 *   2  BOM    — horizontal exploded view, electronics revealed, leaders
 *   3  FAQ    — reassembled, zoomed into a front three-quarter backdrop
 *
 * Model space is the GLB's own: metres, Y is the stack axis (rear shell
 * at -Y, front shell at +Y), Z is the long axis.
 */

export type PartId =
  | "rear"
  | "carrier"
  | "ffc"
  | "battery"
  | "main"
  | "pwr"
  | "speaker"
  | "lra"
  | "camera"
  | "front";

export interface PartSpec {
  id: PartId;
  /** Node name in /home/pneuma-q.glb. */
  node: string;
  label: string;
  /** Position along the stack axis in the exploded view, in slots. */
  slot: number;
  shell?: boolean;
  /** Where its BOM leader label sits in the exploded view, if labelled. */
  bom?: { side: "top" | "bottom"; lane: 0 | 1 };
}

export const PARTS: readonly PartSpec[] = [
  {
    id: "rear",
    node: "01_Rear_soft_shell",
    label: "Rear shell",
    slot: 0,
    shell: true,
    bom: { side: "bottom", lane: 0 },
  },
  {
    id: "carrier",
    node: "Rigid_carrier-FIT_STAGE",
    label: "Rigid carrier",
    slot: 1,
    bom: { side: "top", lane: 0 },
  },
  { id: "ffc", node: "ffc", label: "Flex cable", slot: 1.7 },
  {
    id: "battery",
    node: "battery",
    label: "Battery",
    slot: 2.4,
    bom: { side: "bottom", lane: 1 },
  },
  {
    id: "main",
    node: "pneuma-main",
    label: "Main board",
    slot: 2.4,
    bom: { side: "top", lane: 1 },
  },
  { id: "pwr", node: "pneuma-pwr", label: "Power board", slot: 2.4 },
  {
    id: "speaker",
    node: "speaker",
    label: "Speaker",
    slot: 3.4,
    bom: { side: "bottom", lane: 0 },
  },
  {
    id: "lra",
    node: "lra",
    label: "Haptic motor",
    slot: 3.4,
    bom: { side: "top", lane: 0 },
  },
  {
    id: "camera",
    node: "camera-PROVISIONAL",
    label: "Camera",
    slot: 4.2,
    bom: { side: "top", lane: 1 },
  },
  {
    id: "front",
    node: "02_Front_soft_shell",
    label: "Front shell",
    slot: 5.4,
    shell: true,
    bom: { side: "bottom", lane: 1 },
  },
];

/** Assembled envelope, metres. */
export const DEVICE_LONG = 0.121;
export const DEVICE_WIDE = 0.06;
const SLOT_SPACING = 0.027;
const MAX_SLOT = 5.4;
/** Horizontal footprint of the exploded view before scaling. */
const EXPLODE_WIDE = 0.16;

export interface View {
  /** Visible width / height of the z = 0 plane, world units. */
  w: number;
  h: number;
}

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
  opacity: number;
}

export interface Frame {
  poses: Record<PartId, Pose>;
  /** 1 in the hero, 0 once it scrolls away — gates spin, drag and particles. */
  hero: number;
  /** Opacity of the file-name labels under the split shells. */
  fileLabels: number;
  /** Opacity of the BOM leader labels. */
  bomLabels: number;
  /** Anchors the labels hang off, world space. */
  labelRows: { top: number; bottom: number; lane: number };
  /** Hero centre — the pivot the swipe deformation scales around. */
  heroCenter: Vector3;
  /**
   * Where each part sits before any drag-orbit. BOM labels hang off these
   * so they hold still while the scene turns under them (orbitFrame).
   */
  anchors?: Record<PartId, Vector3>;
}

const axis = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
};

/** Model → world for the standing device: front face to camera, long axis vertical. */
const STANDING = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(
    new Vector3(1, 0, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, -1, 0),
  ),
);
/**
 * Model → world for the exploded view: the stack runs front shell (left)
 * → rear shell (right), matching the split screen before it, so the
 * shells slide straight into place instead of crossing over.
 * The long axis (model Z) must point the same way it does in STANDING
 * (world −Y); flip it and every transition into/out of the BOM slerps
 * through a 180° roll.
 */
const LAID_OUT = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(
    new Vector3(0, 0, 1),
    new Vector3(-1, 0, 0),
    new Vector3(0, -1, 0),
  ),
);

function turn(base: Quaternion, yaw: number, pitch = 0): Quaternion {
  const q = new Quaternion().setFromAxisAngle(axis.y, yaw);
  q.multiply(new Quaternion().setFromAxisAngle(axis.x, pitch));
  return q.multiply(base);
}

export const HERO_QUAT = turn(STANDING, -0.35, 0.12);
const FRONT_SPLIT_QUAT = turn(STANDING, 0.45, 0.1);
const REAR_SPLIT_QUAT = turn(STANDING, -0.45, 0.1);
export const EXPLODE_QUAT = turn(LAID_OUT, 0.6, 0.08);
const ZOOM_QUAT = turn(STANDING, -0.4, 0.22);

export function easeInOut(t: number): number {
  const c = MathUtils.clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function bump(p: number, centre: number, half: number): number {
  return MathUtils.clamp(1 - Math.abs(p - centre) / half, 0, 1);
}

export interface Layout {
  portrait: boolean;
  s0: number;
  t0: Vector3;
  s1: number;
  splitX: number;
  splitDx: number;
  splitY: number;
  s2: number;
  t2: Vector3;
  s3: number;
  t3: Vector3;
}

export function layoutFor(view: View): Layout {
  const portrait = view.w < view.h;
  const s0 = Math.min(
    ((portrait ? 0.44 : 0.5) * view.h) / DEVICE_LONG,
    ((portrait ? 0.7 : 0.4) * view.w) / DEVICE_WIDE,
  );
  // One centred axis on every viewport: model, then copy, then stepper,
  // stacked. Every step sits in the upper ~two-thirds so the centred copy
  // and stepper below it never collide with the stage.
  const s1 = s0 * (portrait ? 0.6 : 0.6);
  const s2 = Math.min(
    ((portrait ? 0.28 : 0.4) * view.h) / DEVICE_LONG,
    ((portrait ? 0.86 : 0.62) * view.w) / EXPLODE_WIDE,
  );
  return {
    portrait,
    s0,
    t0: portrait
      ? new Vector3(0, view.h * 0.17, 0)
      : new Vector3(0, view.h * 0.12, 0),
    s1,
    splitX: 0,
    splitDx: portrait
      ? view.w * 0.22
      : Math.min(view.w * 0.13, s1 * DEVICE_WIDE * 1.25),
    splitY: view.h * (portrait ? 0.2 : 0.14),
    s2,
    t2: portrait
      ? new Vector3(0, view.h * 0.2, 0)
      : new Vector3(0, view.h * 0.07, 0),
    s3: (1.05 * view.h) / DEVICE_LONG,
    t3: portrait
      ? new Vector3(view.w * 0.1, -view.h * 0.05, 0)
      : new Vector3(view.w * 0.22, -view.h * 0.1, 0),
  };
}

export interface Geometry {
  /** Each part's bounding-box centre, model space. */
  centers: Record<PartId, Vector3>;
  /** Assembled envelope centre, model space. */
  modelCenter: Vector3;
}

function place(
  center: Vector3,
  origin: Vector3,
  q: Quaternion,
  s: number,
  at: Vector3,
): Vector3 {
  return center
    .clone()
    .sub(origin)
    .multiplyScalar(s)
    .applyQuaternion(q)
    .add(at);
}

function explodedCenter(part: PartSpec, geo: Geometry): Vector3 {
  const c = geo.centers[part.id];
  return new Vector3(c.x, part.slot * SLOT_SPACING, c.z);
}

function keyframe(
  k: 0 | 1 | 2 | 3,
  part: PartSpec,
  geo: Geometry,
  L: Layout,
): Pose {
  const c = geo.centers[part.id];
  const mc = geo.modelCenter;
  const inside = part.shell ? 1 : 0;
  switch (k) {
    case 0:
      return {
        position: place(c, mc, HERO_QUAT, L.s0, L.t0),
        quaternion: HERO_QUAT.clone(),
        scale: L.s0,
        opacity: inside,
      };
    case 1: {
      if (part.id === "front" || part.id === "rear") {
        const front = part.id === "front";
        return {
          position: new Vector3(
            L.splitX + (front ? -L.splitDx : L.splitDx),
            L.splitY,
            0,
          ),
          quaternion: (front ? FRONT_SPLIT_QUAT : REAR_SPLIT_QUAT).clone(),
          scale: L.s1,
          opacity: 1,
        };
      }
      // Internals wait, invisible, where the device was — they fade up
      // out of the gap the shells leave on the way into the BOM.
      return {
        position: place(
          c,
          mc,
          HERO_QUAT,
          L.s1,
          new Vector3(L.splitX, L.splitY, 0),
        ),
        quaternion: HERO_QUAT.clone(),
        scale: L.s1,
        opacity: 0,
      };
    }
    case 2: {
      const origin = new Vector3(mc.x, (MAX_SLOT / 2) * SLOT_SPACING, mc.z);
      return {
        position: place(
          explodedCenter(part, geo),
          origin,
          EXPLODE_QUAT,
          L.s2,
          L.t2,
        ),
        quaternion: EXPLODE_QUAT.clone(),
        scale: L.s2,
        opacity: 1,
      };
    }
    case 3:
      return {
        position: place(c, mc, ZOOM_QUAT, L.s3, L.t3),
        quaternion: ZOOM_QUAT.clone(),
        scale: L.s3,
        opacity: inside,
      };
  }
}

function mix(a: Pose, b: Pose, t: number, opacity: number): Pose {
  return {
    position: a.position.clone().lerp(b.position, t),
    quaternion: a.quaternion.clone().slerp(b.quaternion, t),
    scale: MathUtils.lerp(a.scale, b.scale, t),
    opacity,
  };
}

export const MAX_PROGRESS = 3;

export function sampleFrame(
  progress: number,
  geo: Geometry,
  view: View,
): Frame {
  const p = MathUtils.clamp(progress, 0, MAX_PROGRESS);
  const L = layoutFor(view);
  const seg = Math.min(Math.floor(p), MAX_PROGRESS - 1) as 0 | 1 | 2;
  const raw = p - seg;
  const t = easeInOut(raw);

  const poses = {} as Record<PartId, Pose>;
  for (const part of PARTS) {
    const a = keyframe(seg, part, geo, L);
    const b = keyframe((seg + 1) as 1 | 2 | 3, part, geo, L);
    let opacity = MathUtils.lerp(a.opacity, b.opacity, t);
    if (!part.shell) {
      // Internals arrive late into the BOM and leave early out of it, so
      // they're never seen drifting through a closed shell.
      if (seg === 1) opacity = MathUtils.smoothstep(raw, 0.15, 0.7);
      else if (seg === 2) opacity = 1 - MathUtils.smoothstep(raw, 0.25, 0.8);
      else opacity = 0;
    }
    poses[part.id] = mix(a, b, t, opacity);
  }

  const bomHalf = (DEVICE_LONG * L.s2) / 2;
  const gap = view.h * 0.04;
  return {
    poses,
    hero: 1 - MathUtils.smoothstep(p, 0, 0.5),
    fileLabels: MathUtils.smoothstep(bump(p, 1, 0.45), 0, 0.6),
    bomLabels: MathUtils.smoothstep(bump(p, 2, 0.45), 0, 0.6),
    labelRows: {
      top: L.t2.y + bomHalf + gap,
      bottom: L.t2.y - bomHalf - gap,
      lane: view.h * 0.055,
    },
    heroCenter: L.t0.clone(),
  };
}

/**
 * Crossfade two frames directly. Used two ways: pulling the current step
 * into the FAQ backdrop as the sheet scrolls up, and jumping between
 * non-adjacent steps (the tour wrapping from the BOM back to the hero)
 * without walking back through the step in between.
 */
export function mixFrames(a: Frame, b: Frame, t: number): Frame {
  const k = easeInOut(t);
  const poses = {} as Record<PartId, Pose>;
  for (const part of PARTS) {
    poses[part.id] = mix(
      a.poses[part.id],
      b.poses[part.id],
      k,
      MathUtils.lerp(a.poses[part.id].opacity, b.poses[part.id].opacity, k),
    );
  }
  return {
    ...a,
    poses,
    hero: MathUtils.lerp(a.hero, b.hero, k),
    fileLabels: MathUtils.lerp(a.fileLabels, b.fileLabels, k),
    bomLabels: MathUtils.lerp(a.bomLabels, b.bomLabels, k),
  };
}

/**
 * Turn the whole scene about a vertical axis through the two shells'
 * midpoint — the drag-to-orbit on the share and BOM steps. Every pose
 * rotates rigidly; `anchors` keep the un-orbited positions so the BOM
 * labels stay put while their leader lines follow the parts.
 */
export function orbitFrame(frame: Frame, yaw: number): Frame {
  const pivot = frame.poses.front.position
    .clone()
    .add(frame.poses.rear.position)
    .multiplyScalar(0.5);
  const q = new Quaternion().setFromAxisAngle(axis.y, yaw);
  const poses = {} as Record<PartId, Pose>;
  const anchors = {} as Record<PartId, Vector3>;
  for (const part of PARTS) {
    const pose = frame.poses[part.id];
    anchors[part.id] = frame.anchors?.[part.id] ?? pose.position.clone();
    poses[part.id] = {
      ...pose,
      position: pose.position.clone().sub(pivot).applyQuaternion(q).add(pivot),
      quaternion: q.clone().multiply(pose.quaternion),
    };
  }
  return { ...frame, poses, anchors };
}
