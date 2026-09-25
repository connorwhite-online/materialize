import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PartId } from "./choreography";

/**
 * Procedural stand-ins for the parts the Pneuma Q CAD only carries as
 * envelopes (`battery`, `camera-PROVISIONAL`, `ffc` are 12-triangle
 * boxes; `speaker` and `lra` are bare cylinders). Each is modelled on
 * the Rev A part it stands for (pneuma/hardware/REV-A.md) and fills its
 * envelope exactly, so part centres — and therefore the scroll
 * choreography — are unchanged.
 *
 * Built in model space (metres, Y = stack axis toward the front shell,
 * Z = long axis), in code rather than as mesh files so they cost the
 * download nothing. Swap any of these for a vendor STEP by putting a
 * real node in the GLB and deleting its entry here.
 *
 * Client-only: labels are drawn onto a <canvas>.
 */

const mm = (v: number) => v / 1000;

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(mm(position[0]), mm(position[1]), mm(position[2]));
  return m;
}

/** Plane lying in XZ, facing +Y. */
function topPlane(w: number, d: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(mm(w), mm(d));
  g.rotateX(-Math.PI / 2);
  return g;
}

function barcode(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  let cx = x;
  let seed = 7;
  while (cx < x + w) {
    seed = (seed * 9301 + 49297) % 233280;
    const bar = 2 + (seed % 5);
    if (seed % 3) g.fillRect(cx, y, bar, h);
    cx += bar + 2 + (seed % 3);
  }
}

/**
 * Flat ribbon swept along a curve (for flex circuits): a strip of the
 * given width lying across X, following the curve's tangent.
 */
function ribbonGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  segments: number,
) {
  const pos: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= segments; i++) {
    const p = curve.getPoint(i / segments);
    const a = p.clone().addScaledVector(side, -width / 2);
    const b = p.clone().addScaledVector(side, width / 2);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ─── Battery: LP702040 Li-po pouch, 7 × 20 × 40 mm ──────────────────

function battery(): THREE.Group {
  const g = new THREE.Group();
  const L = 38.5; // pouch body along X; PCM strip takes the rest
  const pouch = new THREE.MeshPhysicalMaterial({
    color: "#c9ccd0",
    metalness: 0.75,
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  g.add(
    mesh(
      new RoundedBoxGeometry(mm(L), mm(6.8), mm(20.4), 4, mm(1.4)),
      pouch,
      [-0.75, 0, 0],
    ),
  );

  const label = canvasTexture(1400, 720, (c, w, h) => {
    c.fillStyle = "#f3f1ec";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#1b1d22";
    c.fillRect(0, 0, w, 120);
    c.fillStyle = "#f3f1ec";
    c.font = "600 64px Helvetica, Arial, sans-serif";
    c.fillText("Li-ion Polymer Battery", 48, 82);
    c.fillStyle = "#1b1d22";
    c.font = "700 150px Helvetica, Arial, sans-serif";
    c.fillText("LP702040", 48, 300);
    c.font = "500 70px Helvetica, Arial, sans-serif";
    c.fillText("3.7V  600mAh  2.22Wh", 52, 400);
    c.font = "400 40px Helvetica, Arial, sans-serif";
    c.fillStyle = "#4a4d55";
    c.fillText(
      "Do not short circuit · Do not puncture · Do not dispose in fire",
      52,
      470,
    );
    // Warning glyph boxes
    for (let i = 0; i < 3; i++) {
      c.strokeStyle = "#1b1d22";
      c.lineWidth = 6;
      c.strokeRect(52 + i * 118, 520, 96, 96);
      c.beginPath();
      c.moveTo(52 + i * 118 + 18, 600);
      c.lineTo(52 + i * 118 + 78, 536);
      c.stroke();
    }
    c.fillStyle = "#1b1d22";
    barcode(c, 800, 520, 520, 110);
    c.font = "400 34px Menlo, monospace";
    c.fillText("PN 2609 1841 07", 850, 675);
    c.fillStyle = "#c2272d";
    c.font = "700 72px Helvetica, Arial, sans-serif";
    c.fillText("+", 1260, 300);
  });
  g.add(
    mesh(
      topPlane(33, 17),
      new THREE.MeshStandardMaterial({
        map: label,
        roughness: 0.62,
        metalness: 0,
      }),
      [-1.2, 3.41, 0],
    ),
  );

  // Protection-circuit strip, folded under amber Kapton at the +X end.
  const pcm = new THREE.MeshStandardMaterial({
    color: "#11492e",
    roughness: 0.45,
    metalness: 0.2,
  });
  g.add(
    mesh(new THREE.BoxGeometry(mm(1.4), mm(3.2), mm(17)), pcm, [19.2, -0.4, 0]),
  );
  const kapton = new THREE.MeshPhysicalMaterial({
    color: "#d98a1c",
    roughness: 0.28,
    transmission: 0.35,
    thickness: mm(0.1),
    clearcoat: 1,
  });
  g.add(
    mesh(
      new THREE.BoxGeometry(mm(1.6), mm(3.6), mm(18)),
      kapton,
      [19.3, -0.4, 0],
    ),
  );
  // Nickel tabs
  const nickel = new THREE.MeshStandardMaterial({
    color: "#d9dadc",
    metalness: 1,
    roughness: 0.3,
  });
  for (const z of [-4.5, 4.5]) {
    g.add(
      mesh(new THREE.BoxGeometry(mm(1.2), mm(0.15), mm(3)), nickel, [
        18.2,
        1.3,
        z,
      ]),
    );
  }
  // Red / black leads running toward the power board (+Z).
  const wire = (color: string, x: number, zEnd: number) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(mm(19.6), mm(0), mm(x)),
      new THREE.Vector3(mm(19.9), mm(0.2), mm(x + 3)),
      new THREE.Vector3(mm(18.5), mm(0.6), mm(zEnd)),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, mm(0.45), 8),
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.35,
          clearcoat: 0.8,
        }),
      ),
    );
  };
  wire("#c62828", 3, 10.2);
  wire("#15161a", 5.2, 10.2);
  return g;
}

// ─── Speaker: PUI AS01508MR, Ø15 × 3.5 mm, firing +Y ─────────────────

function speaker(): THREE.Group {
  const g = new THREE.Group();
  const R = 7.5;
  const frame = new THREE.MeshPhysicalMaterial({
    color: "#16171a",
    roughness: 0.4,
    clearcoat: 0.4,
  });
  // Stamped basket: outer ring
  g.add(
    mesh(
      new THREE.CylinderGeometry(mm(R), mm(R), mm(0.9), 64, 1, true),
      frame,
      [0, 1.3, 0],
    ),
  );
  g.add(
    mesh(
      new THREE.RingGeometry(mm(R - 0.9), mm(R), 64).rotateX(-Math.PI / 2),
      frame,
      [0, 1.75, 0],
    ),
  );
  // Surround roll
  const surround = new THREE.MeshStandardMaterial({
    color: "#222327",
    roughness: 0.7,
  });
  const roll = new THREE.TorusGeometry(mm(R - 1.5), mm(0.55), 12, 64);
  roll.rotateX(Math.PI / 2);
  g.add(mesh(roll, surround, [0, 1.25, 0]));
  // Cone (lathe) with a fine concentric grain
  const cone = new THREE.LatheGeometry(
    [
      new THREE.Vector2(mm(2.6), mm(0.1)),
      new THREE.Vector2(mm(4), mm(0.55)),
      new THREE.Vector2(mm(5.4), mm(0.95)),
      new THREE.Vector2(mm(R - 2), mm(1.2)),
    ],
    64,
  );
  const grain = canvasTexture(512, 64, (c, w, h) => {
    c.fillStyle = "#2b2c31";
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      c.fillStyle = y % 8 ? "#303137" : "#27282d";
      c.fillRect(0, y, w, 2);
    }
  });
  g.add(
    mesh(
      cone,
      new THREE.MeshStandardMaterial({
        map: grain,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
      [0, 0, 0],
    ),
  );
  // Dust cap
  const cap = new THREE.SphereGeometry(
    mm(2.7),
    32,
    12,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2.6,
  );
  g.add(
    mesh(
      cap,
      new THREE.MeshPhysicalMaterial({
        color: "#1c1d21",
        roughness: 0.3,
        clearcoat: 1,
      }),
      [0, -1.2, 0],
    ),
  );
  // Magnet pot underneath
  const pot = new THREE.MeshStandardMaterial({
    color: "#b9bcc2",
    metalness: 1,
    roughness: 0.22,
  });
  g.add(
    mesh(
      new THREE.CylinderGeometry(mm(4.2), mm(4.2), mm(1.6), 48),
      pot,
      [0, -0.95, 0],
    ),
  );
  // Solder tabs + leads
  const gold = new THREE.MeshStandardMaterial({
    color: "#d4a74a",
    metalness: 1,
    roughness: 0.28,
  });
  for (const s of [-1, 1]) {
    g.add(
      mesh(new THREE.BoxGeometry(mm(1.4), mm(0.3), mm(2)), gold, [
        s * 2.2,
        1.6,
        -R - 0.6,
      ]),
    );
  }
  return g;
}

// ─── LRA: Vybronics VG1040003D, Ø10 coin ────────────────────────────

function lra(): THREE.Group {
  const g = new THREE.Group();
  const R = 5;
  const can = new THREE.MeshPhysicalMaterial({
    color: "#d4d6da",
    metalness: 1,
    roughness: 0.26,
    clearcoat: 0.3,
  });
  // Can with a rolled top edge
  const profile = [
    new THREE.Vector2(0, mm(-1.9)),
    new THREE.Vector2(mm(R), mm(-1.9)),
    new THREE.Vector2(mm(R), mm(1.5)),
    new THREE.Vector2(mm(R - 0.35), mm(1.9)),
    new THREE.Vector2(0, mm(1.9)),
  ];
  g.add(mesh(new THREE.LatheGeometry(profile, 64), can));
  const etch = canvasTexture(512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(40,42,48,0.55)";
    c.font = "600 64px Helvetica, Arial, sans-serif";
    c.textAlign = "center";
    c.fillText("VG1040003D", w / 2, h / 2 - 10);
    c.font = "400 44px Menlo, monospace";
    c.fillText("2609 · 170Hz", w / 2, h / 2 + 60);
    c.beginPath();
    c.arc(w / 2, h / 2, w / 2 - 34, 0, Math.PI * 2);
    c.lineWidth = 5;
    c.strokeStyle = "rgba(40,42,48,0.35)";
    c.stroke();
  });
  const disc = new THREE.CircleGeometry(mm(R - 0.4), 64).rotateX(-Math.PI / 2);
  g.add(
    mesh(
      disc,
      new THREE.MeshStandardMaterial({
        map: etch,
        transparent: true,
        metalness: 1,
        roughness: 0.3,
        color: "#d4d6da",
      }),
      [0, 1.91, 0],
    ),
  );
  // Fine red/black leads leaving the side of the can, as shipped.
  for (const [color, dz] of [
    ["#c62828", -0.35],
    ["#15161a", 0.35],
  ] as const) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(mm(R - 0.2), mm(-1.4), mm(dz)),
      new THREE.Vector3(mm(R + 1.5), mm(-1.5), mm(dz * 1.6)),
      new THREE.Vector3(mm(R + 3.5), mm(-1.2), mm(dz + 1.2)),
      new THREE.Vector3(mm(R + 5.5), mm(-1.0), mm(dz + 1.6)),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 32, mm(0.22), 6),
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.35,
          clearcoat: 0.8,
        }),
      ),
    );
  }
  return g;
}

// ─── Camera: compact FPC module on the 30° axis ─────────────────────

function camera(): THREE.Group {
  const outer = new THREE.Group();
  const g = new THREE.Group();
  // Built along +Y, then tilted onto the lens axis (0, cos30°, −sin30°).
  g.rotation.x = -Math.PI / 6;
  outer.add(g);

  const pcb = new THREE.MeshStandardMaterial({
    color: "#0f1a14",
    roughness: 0.5,
    metalness: 0.2,
  });
  g.add(
    mesh(new THREE.BoxGeometry(mm(8.5), mm(0.8), mm(8.5)), pcb, [0, -2.6, 0]),
  );
  const holder = new THREE.MeshPhysicalMaterial({
    color: "#121316",
    roughness: 0.55,
    clearcoat: 0.2,
  });
  g.add(
    mesh(
      new RoundedBoxGeometry(mm(7.6), mm(2.4), mm(7.6), 3, mm(0.5)),
      holder,
      [0, -1, 0],
    ),
  );
  // Threaded barrel
  g.add(
    mesh(
      new THREE.CylinderGeometry(mm(3), mm(3.2), mm(2.6), 48),
      holder,
      [0, 1.3, 0],
    ),
  );
  const ring = new THREE.MeshStandardMaterial({
    color: "#2a2b30",
    metalness: 0.9,
    roughness: 0.35,
  });
  const bezel = new THREE.TorusGeometry(mm(2.55), mm(0.35), 12, 48).rotateX(
    Math.PI / 2,
  );
  g.add(mesh(bezel, ring, [0, 2.6, 0]));
  // Coated glass: iridescence gives the green/violet AR sheen.
  const lens = new THREE.SphereGeometry(
    mm(2.4),
    48,
    16,
    0,
    Math.PI * 2,
    0,
    Math.PI / 4.5,
  );
  g.add(
    mesh(
      lens,
      new THREE.MeshPhysicalMaterial({
        color: "#0a0c12",
        metalness: 0,
        roughness: 0.02,
        clearcoat: 1,
        iridescence: 1,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [250, 600],
      }),
      [0, 0.55, 0],
    ),
  );
  // FPC: a thin ribbon leaving the underside of the module board, bending
  // down and back toward the main board, ending in a stiffened tab.
  const fpcPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, mm(-3.05), mm(3.6)),
    new THREE.Vector3(0, mm(-3.1), mm(5.5)),
    new THREE.Vector3(0, mm(-3.9), mm(7.2)),
    new THREE.Vector3(0, mm(-5.2), mm(8)),
  ]);
  const ribbon = ribbonGeometry(fpcPath, mm(4.2), 40);
  g.add(
    new THREE.Mesh(
      ribbon,
      new THREE.MeshPhysicalMaterial({
        color: "#c98322",
        roughness: 0.3,
        clearcoat: 1,
        side: THREE.DoubleSide,
      }),
    ),
  );
  const end = fpcPath.getPoint(1);
  const tangent = fpcPath.getTangent(1);
  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(mm(4.2), mm(0.25), mm(1.6)),
    new THREE.MeshStandardMaterial({ color: "#1f3f8a", roughness: 0.5 }),
  );
  tab.position.copy(end).addScaledVector(tangent, mm(0.6));
  tab.lookAt(tab.position.clone().add(tangent));
  g.add(tab);
  return outer;
}

// ─── FFC: 30-way 0.5 mm, 16.5 mm wide, under the battery ────────────

function ffc(): THREE.Group {
  const g = new THREE.Group();
  const W = 16.5;
  const L = 23.7;
  const traces = canvasTexture(660, 1024, (c, w, h) => {
    c.fillStyle = "#b8741a";
    c.fillRect(0, 0, w, h);
    const pitch = w / 31;
    for (let i = 1; i <= 30; i++) {
      c.fillStyle = "rgba(226,160,88,0.85)";
      c.fillRect(i * pitch - pitch * 0.18, 70, pitch * 0.36, h - 140);
      // Tinned contacts at both ends
      c.fillStyle = "#e3e4e6";
      c.fillRect(i * pitch - pitch * 0.2, 0, pitch * 0.4, 70);
      c.fillRect(i * pitch - pitch * 0.2, h - 70, pitch * 0.4, 70);
    }
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.font = "500 26px Helvetica, Arial, sans-serif";
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillText("AWM 20624 80C 60V VW-1  ·  30P 0.5mm", 0, 8);
    c.restore();
  });
  const strip = new THREE.MeshPhysicalMaterial({
    map: traces,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  g.add(mesh(new THREE.BoxGeometry(mm(W), mm(0.12), mm(L)), strip));
  const stiff = new THREE.MeshStandardMaterial({
    color: "#1f3f8a",
    roughness: 0.5,
  });
  for (const s of [-1, 1]) {
    g.add(
      mesh(new THREE.BoxGeometry(mm(W), mm(0.25), mm(2.2)), stiff, [
        0,
        -0.12,
        s * (L / 2 - 3.6),
      ]),
    );
  }
  return g;
}

const BUILDERS: Partial<Record<PartId, () => THREE.Group>> = {
  battery,
  speaker,
  lra,
  camera,
  ffc,
};

export function hasStandIn(id: PartId): boolean {
  return id in BUILDERS;
}

/**
 * Build the stand-in for `id`, centred where the CAD's envelope was.
 * The returned group sits in model space like any GLB node.
 */
export function buildStandIn(
  id: PartId,
  envelope: THREE.Object3D,
): THREE.Object3D | null {
  const build = BUILDERS[id];
  if (!build) return null;
  envelope.updateMatrixWorld(true);
  const center = new THREE.Box3()
    .setFromObject(envelope)
    .getCenter(new THREE.Vector3());
  const group = build();
  group.position.copy(center);
  return group;
}
