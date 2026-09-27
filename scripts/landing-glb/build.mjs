// Builds the two anon-landing enclosure files from the Pneuma Q CAD export:
//
//   public/home/pneuma-q.glb         shells (60%) + 12% internals — paints the hero at once
//   public/home/pneuma-q-detail.glb  50% internals — streamed in on idle
//
// Run from anywhere with the tools ad hoc (they're not app dependencies):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 \
//     @gltf-transform/extensions@4 meshoptimizer
//   node scripts/landing-glb/build.mjs path/to/Pneuma-Q-shells-and-electronics.glb
//
// The trick that makes the boards simplifiable: CAD exports split every
// vertex at hard edges (one normal per face), so no triangle shares a
// vertex with its neighbour and the simplifier can't collapse anything —
// 25% and 50% targets both came back at ~100%. Internals therefore drop
// NORMAL, weld on position, simplify, and ship WITHOUT normals; the scene
// rebuilds creased normals at load (enclosure-scene.tsx `fadeable`).
// Shells keep theirs — their smooth normals already weld.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, quantize, simplify, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { resolve } from "node:path";

const src = process.argv[2];
if (!src) throw new Error("usage: node build.mjs <source.glb>");
const out = resolve(import.meta.dirname, "../../public/home");
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const isShell = (name) => /soft_shell/.test(name);
// 16-bit normals: the default 10 bits bands reflections on polished
// metal (steel/alloy looked faceted). Costs ~1KB after meshopt.
const finish = [dedup(), prune(), quantize({ quantizeNormal: 16 }), meshopt({ encoder: MeshoptEncoder, level: "high" })];
// Shells keep most of their triangles for the same reason — mirror
// finishes show every facet. SHELL_RATIO overrides for experiments.
const SHELL_RATIO = Number(process.env.SHELL_RATIO ?? 0.6);

async function internals(doc, ratio, error) {
  for (const m of doc.getRoot().listMeshes()) {
    if (isShell(m.getName())) continue;
    for (const p of m.listPrimitives()) p.setAttribute("NORMAL", null);
  }
  await doc.transform(weld());
  for (const n of doc.getRoot().listNodes()) {
    if (isShell(n.getName()) || !n.getMesh()) continue;
    for (const p of n.getMesh().listPrimitives()) {
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
    }
  }
}

// Main: shells (topology-safe simplify, normals kept) + 12% internals.
{
  const doc = await io.read(src);
  await internals(doc, 0.12, 0.0008);
  for (const n of doc.getRoot().listNodes()) {
    if (!isShell(n.getName())) continue;
    for (const p of n.getMesh().listPrimitives()) {
      if (SHELL_RATIO < 1) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: SHELL_RATIO, error: 0.0003, lockBorder: false });
    }
  }
  await doc.transform(...finish);
  await io.write(`${out}/pneuma-q.glb`, doc);
}

// Detail: internals only, 50%.
{
  const doc = await io.read(src);
  for (const n of doc.getRoot().listNodes()) if (isShell(n.getName())) n.dispose();
  await internals(doc, 0.5, 0.0002);
  await doc.transform(...finish);
  await io.write(`${out}/pneuma-q-detail.glb`, doc);
}
