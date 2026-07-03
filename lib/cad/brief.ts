import "server-only";

import { z } from "zod";

import {
  completeText,
  hasModelCredentials,
  type PromptImage,
} from "./model-client";
import { modelForRole } from "./models";
import { formatExemplarCatalog } from "./knowledge/exemplars";

/**
 * The design brief (docs/text-to-cad/06 part 1): a structured JSON
 * intermediate between prompt and code. The plan step's output becomes data —
 * component boxes, clearances, interfaces, keep-outs — so dimensions stop
 * being lost in prose, and the concept image can be built from the functional
 * reality instead of the raw prompt.
 *
 * Best-effort by contract (mirrors the plan step): `buildBrief` returns null
 * on ANY failure — bad JSON, schema mismatch, model error — and the harness
 * proceeds exactly as it does today. The brief is additive, never blocking.
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

// Sub-objects stay permissive (loose) — the schema WILL churn (doc 06 open
// question 1); unknown keys from a newer/looser model must not void a brief.
const componentSchema = z
  .looseObject({
    name: z.string(),
    /** Bounding box [x, y, z] in mm. */
    box: vec3,
    /** Clearance around the component, mm. */
    clearance: z.number().optional(),
    mounts: z
      .looseObject({
        pattern: z.string().optional(),
        inset: z.number().optional(),
        screw: z.string().optional(),
      })
      .optional(),
  });

const interfaceSchema = z.looseObject({
  /** e.g. "port" | "vent" | "mount" — free-form on purpose. */
  type: z.string(),
  /** Standard id resolved via knowledge/components.ts (e.g. "usb-c", "M3"). */
  std: z.string().optional(),
  /** Face the interface lives on (e.g. "+X"). */
  face: z.string().optional(),
});

export const cadBriefSchema = z.looseObject({
  v: z.literal(1).default(1),
  /** One-line restatement of what the part is. */
  part: z.string(),
  /** Things the part must contain / interface with. */
  components: z.array(componentSchema).default([]),
  /** Where the part meets the world. */
  interfaces: z.array(interfaceSchema).default([]),
  /** Explicit exclusion volumes. */
  keepOut: z.array(z.unknown()).default([]),
  /** Optional; feeds doc-06 part 2 / Tier 2. */
  loads: z.array(z.looseObject({})).optional(),
  form: z
    .looseObject({
      language: z.string().optional(),
      constraints: z.array(z.string()).optional(),
    })
    .optional(),
  envelope: z.looseObject({ max: vec3 }).optional(),
  /** CadProcess when known (MTR-171); null until then. */
  process: z.string().nullable().optional(),
});

export type CadBrief = z.infer<typeof cadBriefSchema>;

function briefSystemPrompt(): string {
  return `You are a CAD engineer writing a DESIGN BRIEF for a parametric 3D model — structured data, not prose, not code.

Output ONLY strict JSON (no markdown fence, no commentary) with this shape:
{
  "v": 1,
  "part": "one-line restatement of the part",
  "components": [{ "name": "...", "box": [x, y, z], "clearance": 1.0, "mounts": { "pattern": "corners", "inset": 3.5, "screw": "M2.5" } }],
  "interfaces": [{ "type": "port", "std": "usb-c", "face": "+X" }],
  "keepOut": [],
  "loads": [{ "at": "mount:*", "kind": "static", "n": 20 }],
  "form": { "language": "soft-premium", "constraints": ["desk-stable"] },
  "envelope": { "max": [x, y, z] },
  "process": null
}

Rules:
- All dimensions in millimeters. "components" = things the part must contain or interface with (their real bounding boxes + clearances). "interfaces" = where the part meets the world (ports, vents, mounts); use standard ids for "std" where one applies (usb-c, usb-a, micro-usb, barrel-jack-5.5, rj45, sd, M2/M2.5/M3/M4/M5/M6).
- Only state what the prompt implies or standard components require — omit optional fields you cannot ground ("loads", "envelope", "form" may be omitted). Do NOT invent components the prompt doesn't call for.
- "form.language" is a 1-3 word aesthetic direction; "form.constraints" are physical form constraints (e.g. "desk-stable", "one-hand-liftable").

${formatExemplarCatalog()}`;
}

/**
 * One completion -> strict JSON -> zod. Null on any failure (best-effort
 * contract — a brief must never block or degrade a generation).
 */
export async function buildBrief(opts: {
  prompt: string;
  images?: PromptImage[] | null;
  signal?: AbortSignal;
}): Promise<CadBrief | null> {
  if (!hasModelCredentials()) return null;
  try {
    const text = await completeText({
      system: briefSystemPrompt(),
      prompt: `Write the design brief for: ${opts.prompt}`,
      model: modelForRole("brief"),
      images: opts.images?.length ? opts.images : undefined,
      signal: opts.signal,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = cadBriefSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const fmtVec = (v: [number, number, number]) => v.map((n) => `${n}`).join(" x ");

/**
 * Compact structured text block for the generate prompt — the brief verbatim,
 * minus JSON noise, so dimensions/clearances carry real prompt weight.
 */
export function formatBriefForPrompt(brief: CadBrief): string {
  const lines = ["Design brief (structured requirements — honor these numbers exactly):"];
  lines.push(`- Part: ${brief.part}`);
  for (const c of brief.components) {
    let line = `- Component "${c.name}": ${fmtVec(c.box)} mm`;
    if (c.clearance != null) line += `, clearance ${c.clearance} mm all around`;
    if (c.mounts) {
      const m = c.mounts;
      const bits = [m.pattern, m.inset != null ? `inset ${m.inset} mm` : null, m.screw]
        .filter(Boolean)
        .join(", ");
      if (bits) line += `; mounts: ${bits}`;
    }
    lines.push(line);
  }
  for (const i of brief.interfaces) {
    let line = `- Interface: ${i.type}`;
    if (i.std) line += ` ${i.std}`;
    if (i.face) line += ` on ${i.face} face`;
    const extra = Object.entries(i)
      .filter(([k]) => !["type", "std", "face"].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (extra) line += ` (${extra})`;
    lines.push(line);
  }
  if (brief.keepOut.length > 0) {
    lines.push(`- Keep-out volumes: ${JSON.stringify(brief.keepOut)}`);
  }
  if (brief.loads?.length) {
    lines.push(`- Loads: ${JSON.stringify(brief.loads)}`);
  }
  if (brief.form?.language || brief.form?.constraints?.length) {
    const bits = [
      brief.form.language,
      ...(brief.form.constraints ?? []),
    ].filter(Boolean);
    lines.push(`- Form: ${bits.join(", ")}`);
  }
  if (brief.envelope) {
    lines.push(`- Envelope: fits within ${fmtVec(brief.envelope.max)} mm`);
  }
  if (brief.process) lines.push(`- Process: ${brief.process}`);
  return lines.join("\n");
}

/**
 * Short form/envelope description appended to the concept-image (flux) prompt
 * so the taste target matches the functional reality (doc 06: the concept is
 * built FROM the brief, not the raw prompt).
 */
export function formatBriefForConcept(brief: CadBrief): string {
  const bits: string[] = [];
  if (brief.form?.language) bits.push(`${brief.form.language} form language`);
  for (const c of brief.form?.constraints ?? []) bits.push(c);
  if (brief.envelope) {
    const [x, y, z] = brief.envelope.max;
    bits.push(`overall proportions about ${x} x ${y} x ${z} mm`);
  }
  const ports = brief.interfaces
    .filter((i) => i.type === "port" && i.std)
    .map((i) => i.std);
  if (ports.length > 0) bits.push(`visible ${ports.join(" and ")} port cutouts`);
  return bits.join(", ");
}
