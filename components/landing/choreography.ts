import { MathUtils, Matrix4, Quaternion, Vector3 } from "three";

/**
 * Choreography for the anon landing's enclosure stage.
 *
 * Pure: given tour progress (0 → 2, one unit per stepper step) and the
 * visible viewport size at z = 0, return a world pose for every part of
 * the Pneuma S enclosure. The scene only applies what this returns, so
 * every pose is testable without a GPU.
 *
 *   0  print  — assembled, shells only; materials burn-sweep on their own
 *   1  build  — horizontal exploded view, electronics revealed, BOM leaders
 *   2  agents — the device shrinks into the Materialize M, fed by the
 *               mascot's laptop (agent-desk.tsx)
 *
 * Scrolling to the FAQ no longer drives the scene: the tour just keeps
 * playing behind the glass.
 *
 * Model space is the GLB's own: metres, Y is the stack axis (rear shell
 * at -Y, front shell at +Y), Z is the long axis.
 */

export type PartId =
  | "rear"
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
  // Pneuma S: no rigid carrier; the boards screw straight into the rear
  // body. `node` is each part's group in the GLB.
  {
    id: "rear",
    node: "01_Rear_shell",
    label: "Rear body",
    slot: 0,
    shell: true,
    bom: { side: "bottom", lane: 0 },
  },
  {
    id: "battery",
    node: "05_Battery",
    label: "Battery",
    slot: 1.8,
    bom: { side: "bottom", lane: 1 },
  },
  {
    id: "main",
    node: "04_Main_PCB",
    label: "Main board",
    slot: 1.8,
    bom: { side: "top", lane: 1 },
  },
  { id: "pwr", node: "03_Power_PCB", label: "Power board", slot: 1.8 },
  {
    id: "speaker",
    node: "06_Speaker",
    label: "Speaker",
    slot: 2.8,
    bom: { side: "bottom", lane: 0 },
  },
  {
    id: "lra",
    node: "07_Haptic_motor",
    label: "Haptic motor",
    slot: 2.8,
    bom: { side: "top", lane: 0 },
  },
  {
    id: "camera",
    node: "08_Camera_PROVISIONAL",
    label: "Camera",
    slot: 3.6,
    bom: { side: "top", lane: 1 },
  },
  {
    id: "front",
    node: "09_Front_shell",
    label: "Front shell",
    slot: 4.8,
    shell: true,
    bom: { side: "bottom", lane: 1 },
  },
];

/** Assembled envelope, metres. */
export const DEVICE_LONG = 0.121;
export const DEVICE_WIDE = 0.06;
// S has one part fewer than Q (no carrier), so its slots spread wider.
const SLOT_SPACING = 0.032;
const MAX_SLOT = 4.8;
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
  /** 1 on the agents step: the cable, spark and call log. */
  agent: number;
  /** Opacity of the BOM leader labels. */
  bomLabels: number;
  /** Anchors the labels hang off, world space. */
  labelRows: { top: number; bottom: number; lane: number };
  /** Hero centre — the pivot the swipe deformation scales around. */
  heroCenter: Vector3;
  /** Agents step layout, world space (see Layout). */
  desk: Vector3;
  agentUnit: number;
  /**
   * The holographic printer platform the device stands on: centre of its
   * top face, world space, and its radius. Under the device on every step;
   * the agents step pulls back to show all of it.
   */
  platform: { position: Vector3; radius: number; tilt: number };
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
export const EXPLODE_QUAT = turn(LAID_OUT, 0.6, 0.08);
/**
 * Agents step: turned well round to its side, so the gap between the
 * two shells (pulled apart on the hologram) reads from the camera.
 */
export const AGENT_QUAT = turn(STANDING, -1.05, 0.02);
/** How far each shell stands off the other on the hologram, metres. */
const AGENT_GAP = 0.012;

/**
 * Internals that stay visible once the device closes: the camera shows
 * through the lens opening. Everything else fades as the shells meet.
 */
const SEEN_WHEN_CLOSED: ReadonlySet<PartId> = new Set(["camera"]);

export function easeInOut(t: number): number {
  const c = MathUtils.clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function bump(p: number, centre: number, half: number): number {
  return MathUtils.clamp(1 - Math.abs(p - centre) / half, 0, 1);
}

export interface Layout {
  portrait: boolean;
  /** Very wide + short (landscape phone): stages shift right, no BOM labels. */
  wide: boolean;
  s0: number;
  t0: Vector3;
  s2: number;
  t2: Vector3;
  /** Agents step: the mascot's desk, and the Materialize M it feeds. */
  desk: Vector3;
  /** Agents step: where the device stands (on the platform), and its scale. */
  stage: Vector3;
  sA: number;
  /** World size of one unit of the agent scene (mascot, laptop). */
  agentUnit: number;
}

export function layoutFor(view: View): Layout {
  const portrait = view.w < view.h;
  const wide = !portrait && view.w / view.h > 1.9;
  const s0 = Math.min(
    ((portrait ? 0.54 : 0.6) * view.h) / DEVICE_LONG,
    ((portrait ? 0.9 : 0.55) * view.w) / DEVICE_WIDE,
  );
  // The stage is centred on every viewport (copy sits bottom-left on
  // desktop, the stepper bottom-centre). Every step lives in the upper
  // ~two-thirds so the copy and stepper below never collide with it.
  const s2 = Math.min(
    ((portrait ? 0.38 : 0.48) * view.h) / DEVICE_LONG,
    ((portrait ? 1.05 : 0.8) * view.w) / EXPLODE_WIDE,
  );
  return {
    portrait,
    wide,
    s0,
    // Very wide + short (a phone on its side): the copy owns the left
    // half, so every step's stage shifts right, clear of it.
    t0: portrait
      ? new Vector3(0, view.h * 0.03, 0)
      : wide
        ? new Vector3(0, view.h * 0.06, 0)
        : new Vector3(0, -view.h * 0.03, 0),
    s2,
    t2: portrait
      ? new Vector3(0, view.h * 0.05, 0)
      : wide
        ? new Vector3(0, view.h * 0.06, 0)
        : new Vector3(0, -view.h * 0.04, 0),
    // Agents step: pulled back to show the whole printer platform with
    // the device on it. Desktop: platform right of centre, the mascot
    // left and a little below centre, his hose looping back to it.
    // Portrait: platform up top, the mascot in front of it, lower-left.
    stage: portrait
      ? new Vector3(0, view.h * 0.17, 0)
      : wide
        ? new Vector3(0, view.h * 0.06, 0)
        : new Vector3(0, view.h * 0.02, 0),
    sA: s0 * (portrait ? 0.42 : wide ? 0.34 : 0.5),
    desk: portrait
      ? new Vector3(-view.w * 0.22, -view.h * 0.14, view.h * 0.1)
      : wide
        ? new Vector3(-view.w * 0.14, -view.h * 0.08, 0)
        : new Vector3(-view.w * 0.2, -view.h * 0.12, 0),
    agentUnit: portrait
      ? Math.min(view.w * 0.24, view.h * 0.11)
      : wide
        ? Math.min(view.w * 0.07, view.h * 0.2)
        : Math.min(view.w * 0.1, view.h * 0.19),
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
  k: 0 | 1 | 2,
  part: PartSpec,
  geo: Geometry,
  L: Layout,
): Pose {
  const c = geo.centers[part.id];
  const mc = geo.modelCenter;
  // Shells, plus the camera: it shows through the bump's lens opening, so
  // the device reads fully assembled wherever it's closed.
  const inside = part.shell || SEEN_WHEN_CLOSED.has(part.id) ? 1 : 0;
  switch (k) {
    case 0:
      return {
        position: place(c, mc, HERO_QUAT, L.s0, L.t0),
        quaternion: HERO_QUAT.clone(),
        scale: L.s0,
        opacity: inside,
      };
    case 1: {
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
    case 2: {
      // Standing on the hologram, the two shells pulled slightly apart —
      // what Claude is building. The scene materialises them bottom to
      // top behind the burn edge (enclosure-scene.tsx, runBuild); the
      // internals stay out.
      const off =
        part.id === "front" ? AGENT_GAP : part.id === "rear" ? -AGENT_GAP : 0;
      const at = new Vector3(c.x, c.y + off, c.z);
      return {
        position: place(at, mc, AGENT_QUAT, L.sA, L.stage),
        quaternion: AGENT_QUAT.clone(),
        scale: L.sA,
        opacity: part.shell ? 1 : 0,
      };
    }
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

/**
 * The platform's top plane is seen from 15° above it on the print and
 * build steps (tilted toward the camera, so the hologram reads as a
 * surface, not a line); a little more on the agents step, pulled back.
 */
export const PLATFORM_TILT = (15 * Math.PI) / 180;
/** Nearly side-on: the hologram reads as a disc edge, not a table top. */
// Negative: tipped back against the camera looking down on it.
const PLATFORM_TILT_AGENTS = (-4 * Math.PI) / 180;

/**
 * Platform under the device on each step. The device's long axis is
 * vertical when standing, so its base sits DEVICE_LONG/2 below centre.
 */
function platformFor(
  k: number,
  L: Layout,
): { position: Vector3; radius: number; tilt: number } {
  const under = (at: Vector3, s: number, r: number, tilt: number) => ({
    position: new Vector3(at.x, at.y - (DEVICE_LONG / 2) * s * 1.02, at.z),
    radius: r,
    tilt,
  });
  if (k === 0)
    return under(L.t0, L.s0, DEVICE_WIDE * L.s0 * 1.25, PLATFORM_TILT);
  if (k === 1) {
    // Beneath the exploded stack, wide enough to read as its stage.
    const half = (DEVICE_LONG / 2) * L.s2;
    return {
      position: new Vector3(L.t2.x, L.t2.y - half * 1.18, L.t2.z),
      radius: EXPLODE_WIDE * L.s2 * 0.42,
      tilt: PLATFORM_TILT,
    };
  }
  // Agents: pulled back, the platform reads large relative to the device.
  return under(L.stage, L.sA, DEVICE_WIDE * L.sA * 1.9, PLATFORM_TILT_AGENTS);
}

function mixPlatform(
  a: { position: Vector3; radius: number; tilt: number },
  b: { position: Vector3; radius: number; tilt: number },
  t: number,
) {
  return {
    position: a.position.clone().lerp(b.position, t),
    radius: MathUtils.lerp(a.radius, b.radius, t),
    tilt: MathUtils.lerp(a.tilt, b.tilt, t),
  };
}

export const MAX_PROGRESS = 2;

export function sampleFrame(
  progress: number,
  geo: Geometry,
  view: View,
): Frame {
  const p = MathUtils.clamp(progress, 0, MAX_PROGRESS);
  const L = layoutFor(view);
  const seg = Math.min(Math.floor(p), MAX_PROGRESS - 1) as 0 | 1;
  const raw = p - seg;
  const t = easeInOut(raw);

  const poses = {} as Record<PartId, Pose>;
  for (const part of PARTS) {
    const a = keyframe(seg, part, geo, L);
    const b = keyframe((seg + 1) as 1 | 2, part, geo, L);
    let opacity = MathUtils.lerp(a.opacity, b.opacity, t);
    // Into the agents step the internals fade out fast, before they've
    // travelled far enough to read as flying somewhere.
    if (seg === 1 && !part.shell)
      opacity = a.opacity * (1 - MathUtils.smoothstep(raw, 0, 0.35));
    if (!part.shell) {
      // Internals arrive late into the BOM and leave early out of it, so
      // they're never seen drifting through a closed shell. The camera,
      // visible through the lens opening, stays once the device closes.
      const seen = SEEN_WHEN_CLOSED.has(part.id);
      if (seg === 0) opacity = seen ? 1 : MathUtils.smoothstep(raw, 0.15, 0.7);
    }
    poses[part.id] = mix(a, b, t, opacity);
  }

  const bomHalf = (DEVICE_LONG * L.s2) / 2;
  const gap = view.h * 0.04;
  return {
    poses,
    hero: 1 - MathUtils.smoothstep(p, 0, 0.5),
    // No room for leader labels on a landscape phone: 390px of height
    // puts them into the nav and the carousel. The headline carries it.
    bomLabels: L.wide ? 0 : MathUtils.smoothstep(bump(p, 1, 0.45), 0, 0.6),
    agent: MathUtils.smoothstep(bump(p, 2, 0.45), 0, 0.6),
    labelRows: {
      top: L.t2.y + bomHalf + gap,
      bottom: L.t2.y - bomHalf - gap,
      lane: view.h * 0.055,
    },
    heroCenter: L.t0.clone(),
    desk: L.desk.clone(),
    agentUnit: L.agentUnit,
    platform: mixPlatform(platformFor(seg, L), platformFor(seg + 1, L), t),
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
      fadeLate(a.poses[part.id].opacity, b.poses[part.id].opacity, k),
    );
  }
  return {
    ...a,
    poses,
    hero: MathUtils.lerp(a.hero, b.hero, k),
    agent: MathUtils.lerp(a.agent, b.agent, k),
    platform: mixPlatform(a.platform, b.platform, k),
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

/**
 * Opacity across a crossfade. Fading in follows the motion; fading OUT
 * is held back to the last stretch, so internals don't vanish while the
 * shells are still visibly apart — they go once it has closed.
 */
function fadeLate(from: number, to: number, k: number): number {
  const t = to < from ? MathUtils.smoothstep(k, 0.6, 1) : k;
  return MathUtils.lerp(from, to, t);
}
