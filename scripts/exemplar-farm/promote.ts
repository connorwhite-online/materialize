/**
 * Promote farm candidates (or a studio generation) into the farmed exemplar
 * catalog — the HUMAN half of the farm: you looked at the renders (or built
 * it in the studio), you approve, this re-verifies and writes the entry.
 *
 *   # Approve farm candidates after eyeballing candidates/<id>/*.png:
 *   npx tsx scripts/exemplar-farm/promote.ts farm_phone_stand farm_pen_cup
 *
 *   # Promote/UPDATE from a studio build (the "edit exemplars in the studio"
 *   # loop: open exemplar in studio → tweak via chips/revisions → promote):
 *   DATABASE_URL=... npx tsx scripts/exemplar-farm/promote.ts \
 *     --from-generation <generationId> --id farm_phone_stand \
 *     [--title "..."] [--lesson "..."] [--keywords a,b,c]
 *
 * Every promotion re-runs the source through the sidecar (compile +
 * watertight + single-solid gate) — `verified: true` is written only after
 * that passes NOW, not when the candidate was farmed. Ids must be farm_* and
 * must not collide with the authored catalog.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  CAD_EXEMPLARS,
  type CadExemplar,
} from "../../lib/cad/knowledge/exemplars";
import { FARMED_EXEMPLARS } from "../../lib/cad/knowledge/exemplars-farmed";
import { gradeRun } from "../../lib/cad/prompt";
import type { CadRunResult } from "../../lib/cad/types";
import {
  authoredCollisions,
  serializeFarmedCatalog,
  upsertFarmed,
  type FarmCandidate,
} from "./catalog-io";

const RUNNER_URL = process.env.CAD_RUNNER_URL || "http://localhost:8000";
const CANDIDATES_DIR =
  process.env.FARM_OUT || join("scripts", "exemplar-farm", "candidates");
const CATALOG_PATH = join("lib", "cad", "knowledge", "exemplars-farmed.ts");

async function verify(code: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, formats: ["stl"] }),
  });
  if (!res.ok) return { ok: false, why: `runner ${res.status}` };
  const run = (await res.json()) as CadRunResult;
  const grade = gradeRun(run);
  return grade.pass
    ? { ok: true }
    : { ok: false, why: grade.failures.join("; ") };
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function fromGeneration(args: string[]): Promise<CadExemplar> {
  const generationId = argValue(args, "--from-generation")!;
  const id = argValue(args, "--id");
  if (!id) throw new Error("--id farm_<name> is required with --from-generation");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  // Read-only row fetch; no drizzle/server-only chain in a script.
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  const rows = (await sql`
    SELECT g.source_code, g.prompt, t.title
    FROM cad_generations g
    LEFT JOIN cad_threads t ON t.id = g.thread_id
    WHERE g.id = ${generationId} AND g.status = 'succeeded'
    LIMIT 1`) as { source_code: string | null; prompt: string; title: string | null }[];
  const row = rows[0];
  if (!row?.source_code) throw new Error("generation not found / no source");
  const prior = FARMED_EXEMPLARS.find((e) => e.id === id);
  return {
    id,
    title: argValue(args, "--title") ?? prior?.title ?? row.title ?? id,
    keywords:
      argValue(args, "--keywords")?.split(",").map((s) => s.trim()).filter(Boolean) ??
      prior?.keywords ??
      [],
    lesson:
      argValue(args, "--lesson") ??
      prior?.lesson ??
      `Promoted from studio generation ${generationId}.`,
    code: row.source_code,
    verified: true,
  };
}

function fromCandidate(id: string): CadExemplar {
  const path = join(CANDIDATES_DIR, id, "candidate.json");
  if (!existsSync(path)) throw new Error(`no candidate at ${path}`);
  const c = JSON.parse(readFileSync(path, "utf8")) as FarmCandidate;
  return {
    id: c.id,
    title: c.title,
    keywords: c.keywords,
    lesson: c.lesson,
    code: c.code,
    verified: true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const entries: CadExemplar[] = [];

  if (args.includes("--from-generation")) {
    entries.push(await fromGeneration(args));
  } else {
    const ids = args.filter((a) => !a.startsWith("--"));
    if (ids.length === 0) {
      console.error(
        "Usage: promote.ts farm_<id> [...] | --from-generation <id> --id farm_<id>"
      );
      process.exit(1);
    }
    for (const id of ids) entries.push(fromCandidate(id));
  }

  for (const e of entries) {
    if (!e.id.startsWith("farm_")) {
      throw new Error(`farmed ids must start with farm_ (got ${e.id})`);
    }
  }
  const authoredIds = CAD_EXEMPLARS.filter(
    (e) => !FARMED_EXEMPLARS.some((f) => f.id === e.id)
  ).map((e) => e.id);
  const collisions = authoredCollisions(entries, authoredIds);
  if (collisions.length) {
    throw new Error(`ids collide with the authored catalog: ${collisions.join(", ")}`);
  }

  // Verification gate — at promotion time, against the current sidecar.
  for (const e of entries) {
    process.stdout.write(`verify ${e.id}… `);
    const v = await verify(e.code);
    if (!v.ok) throw new Error(`\n${e.id} failed verification: ${v.why}`);
    console.log("ok");
  }

  const next = upsertFarmed(FARMED_EXEMPLARS, entries);
  writeFileSync(CATALOG_PATH, serializeFarmedCatalog(next));
  console.log(
    `\nWrote ${entries.length} entr${entries.length === 1 ? "y" : "ies"} → ${CATALOG_PATH} ` +
      `(pool now ${next.length} farmed + ${authoredIds.length} authored). ` +
      `Run vitest + commit the file.`
  );
}

void main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
