// Builds the two anon-landing enclosure files from the Pneuma Q CAD export:
//
//   public/home/pneuma-q.glb         shells (25%, AO UVs) + 2% internal proxies — ~365KB gz
//   public/home/pneuma-q-detail.glb  25% internals — ~435KB gz, streamed in after first paint
//
// Run from anywhere with the tools ad hoc (they're not app dependencies):
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 \
//     @gltf-transform/extensions@4 meshoptimizer
//   node scripts/landing-glb/build.mjs path/to/Pneuma-Q-shells-and-electronics.glb
//
// With baked AO (the shipped setup), first run bake-ao.py, then:
//   SHELLS_UV=<workdir>/shells-uv.glb node scripts/landing-glb/build.mjs <src.glb>
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
import { dedup, meshopt, mergeDocuments, prune, quantize, simplify, simplifyPrimitive, weld } from "@gltf-transform/functions";
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
// 10-bit UVs are plenty for the 1024² AO maps (saves ~19KB vs 12).
const finish = [dedup(), prune(), quantize({ quantizeNormal: 16, quantizeTexcoord: 10 }), meshopt({ encoder: MeshoptEncoder, level: "high" })];
// Shells keep most of their triangles for the same reason — mirror
// finishes show every facet. SHELL_RATIO overrides for experiments.
const SHELL_RATIO = Number(process.env.SHELL_RATIO ?? 0.25);
// Internals in the hero file are proxies: they only need a bounding box
// (part centres drive the choreography) and to exist for the moment
// before the detail file lands. Detail internals are what the BOM shows.
const PROXY_RATIO = Number(process.env.PROXY_RATIO ?? 0.02);
// 25%: indistinguishable from 50% at the BOM view's size (checked side by
// side), and 435KB gz instead of 764KB.
const DETAIL_RATIO = Number(process.env.DETAIL_RATIO ?? 0.25);
/** Path to the Blender-baked shells (with UVs); see bake-ao.py. */
const SHELLS_UV = process.env.SHELLS_UV;

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
  await internals(doc, PROXY_RATIO, 0.01);
  if (SHELLS_UV) {
    // Shells come from the Blender AO bake (scripts/landing-glb/bake-ao.py):
    // already 60% and carrying the UVs the baked ao-*.webp maps are laid
    // out on — so they must replace ours wholesale, never be re-simplified.
    const uvDoc = await io.read(SHELLS_UV);
    const copies = mergeDocuments(doc, uvDoc);
    for (const n of doc.getRoot().listNodes()) {
      if (!isShell(n.getName()) || copies.has(n)) continue;
      const src = uvDoc.getRoot().listNodes().find((u) => u.getName() === n.getName());
      if (!src) throw new Error(`SHELLS_UV has no node ${n.getName()}`);
      const copy = copies.get(src);
      n.setMesh(copy.getMesh()).setTranslation(copy.getTranslation()).setRotation(copy.getRotation()).setScale(copy.getScale());
    }
    for (const scene of doc.getRoot().listScenes().slice(1)) {
      for (const node of scene.listChildren()) node.dispose();
      scene.dispose();
    }
    // A GLB holds one buffer; the merge brought Blender's along.
    const [buffer, ...extra] = doc.getRoot().listBuffers();
    for (const acc of doc.getRoot().listAccessors()) acc.setBuffer(buffer);
    for (const b of extra) b.dispose();
  } else {
    for (const n of doc.getRoot().listNodes()) {
      if (!isShell(n.getName())) continue;
      for (const p of n.getMesh().listPrimitives()) {
        if (SHELL_RATIO < 1) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: SHELL_RATIO, error: 0.0003, lockBorder: false });
      }
    }
  }
  await doc.transform(...finish);
  await io.write(`${out}/pneuma-q.glb`, doc);
}

// Detail: internals only, 50%.
{
  const doc = await io.read(src);
  for (const n of doc.getRoot().listNodes()) if (isShell(n.getName())) n.dispose();
  await internals(doc, DETAIL_RATIO, 0.0002);
  await doc.transform(...finish);
  await io.write(`${out}/pneuma-q-detail.glb`, doc);
}
