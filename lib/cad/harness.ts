import "server-only";

import {
  completeText,
  hasModelCredentials,
  type PromptImage,
} from "./model-client";
import { runCadCode } from "./runner-client";
import {
  buildSystemPrompt,
  selectSystemPromptSections,
  PLAN_SYSTEM_PROMPT,
  extractCode,
  gradeRun,
} from "./prompt";
import { buildKnowledgeBlock, type CadProcess } from "./knowledge";
import { needsExchangerRecipe } from "./knowledge/exchanger-recipe";
import {
  needsEnclosureRecipe,
  ENCLOSURE_SPLIT_REPAIR_NOTE,
} from "./knowledge/enclosure-recipe";
import { judgeAesthetics } from "./critique";
import type { DimensionScore } from "./critique-core";
import { conceptImage, CONCEPT_IMAGE_NOTE } from "./concept";
import {
  selectExemplars,
  selectExemplarsByIds,
  formatExemplars,
  formatExemplarCatalog,
} from "./knowledge/exemplars";
import { formatComponentHints, fitTargetsForBrief } from "./knowledge/components";
import {
  sourcePartsForBrief,
  formatSourcedPartsForPrompt,
  type BriefSourcing,
} from "./step-parts";
import {
  buildBrief,
  cadBriefSchema,
  formatBriefForPrompt,
  formatBriefForConcept,
  type CadBrief,
} from "./brief";
import {
  modelForRole,
  planStepEnabled,
  briefStepEnabled,
  type CadRole,
} from "./models";
import { CAD_FEEDBACK_TAG_LABELS, type CadFeedbackTag } from "./feedback";
import {
  checkDimensionTargets,
  hasDimensionFailures,
  formatDimensionRepairHints,
  buildFitChecksFromTargets,
  type DimensionCheckResult,
  type DimensionTarget,
} from "./dimension-check";
import { enrichRepairHint } from "./repair-taxonomy";
import { sampleStlPoints } from "./stl-points";
import { getNetworksReport, networksFailure } from "./network-check";
import {
  BREP_OUTPUT_FORMATS,
  CUSTOM_ANSWER_PREFIX,
  type CadProgressEvent,
  type CadQuestionAsker,
  type CadRunResult,
} from "./types";

/** Owner feedback on the version being revised (CON-181). */
export interface PriorFeedback {
  rating?: string | null;
  tags?: string[] | null;
  note?: string | null;
}

/**
 * The text-to-CAD harness. The harness — not a bespoke model — is the
 * product: an LLM emits parametric build123d, we execute it in the sidecar,
 * check validity, and on failure feed the error back for a repair turn.
 *
 * Output contract (also enforced in the sidecar): the script must assign
 * its final solid to a variable named `result` (a build123d object). We
 * export STL (printable) + STEP (editable) from it.
 *
 * buildSystemPrompt / extractCode / gradeRun live in ./prompt (pure, shared
 * with the eval runner).
 */

// Complex parts often clear a sequence of distinct build123d gotchas; give the
// repair loop room to cross several hurdles (each repair turn gets a targeted
// hint). Only failing generations use the extra turns — success exits early.
const MAX_ATTEMPTS_DEFAULT = 4;

// Floor for starting another repair attempt under a deadline (codegen +
// sidecar run + judge). Below this, the loop returns what it has instead of
// getting platform-killed mid-attempt with nothing persisted.
const MIN_ATTEMPT_MS = 60_000;

export interface HarnessInput {
  prompt: string;
  /** When editing an existing generation, its source code to revise. */
  priorSourceCode?: string | null;
  /**
   * Owner feedback on the version being revised — folded into the prompt so a
   * revision corrects known problems (CON-181). No-op on a fresh build.
   */
  priorFeedback?: PriorFeedback | null;
  /** Reference images the user attached, passed to the generate steps. */
  images?: PromptImage[] | null;
  maxAttempts?: number;
  signal?: AbortSignal;
  /**
   * Target CraftCloud process, if known at generation time. Drives which DFM
   * block is injected; when omitted the harness uses the conservative
   * multi-process envelope (generation often precedes material selection).
   */
  process?: CadProcess | null;
  /**
   * The brief persisted with the version being revised — included in the
   * revise prompt and passed through to the result unchanged (revisions never
   * rebuild the brief; persistence is the caller's job). No-op on fresh builds.
   */
  priorBrief?: unknown;
  /**
   * A brief the user reviewed/edited BEFORE generating (the studio's brief
   * card). When valid it replaces the brief step entirely — user-confirmed
   * numbers beat a fresh model guess. Fresh builds only.
   */
  providedBrief?: unknown;
  /**
   * Called as the loop advances so the caller can stream status to the UI.
   * Best-effort and synchronous — the harness never awaits it and a throw
   * here must not derail a generation.
   */
  onProgress?: (event: CadProgressEvent) => void;
  /**
   * Interactive-question hook (MTR-191): lets a mid-cycle ask site SUSPEND the
   * build to ask the user one multiple-choice question and RESUME with the
   * chosen option id. Provided by the background-job executor (executeCadJob);
   * absent on legacy/inline callers and secondary best-of candidates, in which
   * case the harness never pauses and decides for itself. Awaited by design —
   * unlike onProgress, this one blocks the loop until the user answers or the
   * question times out.
   */
  onQuestion?: CadQuestionAsker;
  /**
   * Wall-clock deadline (epoch ms) the WHOLE generation must finish by —
   * the platform kills the executor function shortly after (Vercel
   * maxDuration). Engines treat it as a hard planning input: the scripted
   * loop won't start an attempt it can't plausibly finish, the agentic loop
   * trims its own budget under it, and the orchestrator skips the scripted
   * fallback when too little remains (salvaging instead). Absent on
   * unbounded callers (eval runner, self-hosted) — everything then behaves
   * exactly as before.
   */
  deadlineAt?: number;
}

export interface HarnessResult {
  ok: boolean;
  sourceCode: string;
  attempts: number;
  /** The last sidecar run (carries files, render, geometry, validation). */
  run?: CadRunResult;
  /** VLM aesthetic aggregate (0-100), null when the judge is off/unavailable. */
  aestheticScore?: number | null;
  /**
   * Per-dimension judge scores (docs/text-to-cad/07 §B) — shows WHICH
   * dimension drags. Null whenever aestheticScore is null.
   */
  aestheticDims?: Record<string, DimensionScore> | null;
  /**
   * The design brief this generation was built against (docs/text-to-cad/06):
   * freshly built on a fresh build, the caller's priorBrief passed through
   * unchanged on a revision. Persistence is the caller's job.
   */
  brief?: unknown;
  /**
   * Deterministic dimension-contract results (MTR-197): each brief dimension
   * target checked against the final geometry. Only checks that RAN are ever
   * counted as verified (honesty rail). Empty when the brief carried no
   * targets. Persistence is the caller's job (see the TODO below on the column).
   */
  dimensionChecks?: DimensionCheckResult[];
  /** Per-role model usage for routing/telemetry (which model, how long). */
  telemetry?: Array<{ role: CadRole; model?: string; ms: number }>;
  /** Router verdict that selected the engine (stamped by orchestrate). */
  route?: string;
  /**
   * Off-the-shelf parts sourced + misses recorded (MTR-200), from either the
   * scripted brief enrichment or the agentic search_parts/fetch_part tools.
   * Present only when part sourcing ran. Misses (with network-error
   * distinguished from no-match) are the signal the generation fell back to a
   * documented envelope; persisting them onto the generation row is a follow-up
   * (no column yet).
   */
  partSourcing?: import("./step-parts").BriefSourcing;
  error?: string;
}

/**
 * Credential-free fallback so the whole pipeline is demoable without a
 * model key (mirrors the CraftCloud / runner mock philosophy). Emits a
 * parametric cube sized from the first number found in the prompt.
 */
function localFakeModel(prompt: string, prior?: string | null): string {
  if (prior) return prior;
  const n = prompt.match(/(\d+(?:\.\d+)?)\s*(mm|cm|in)?/i);
  const size = n ? Number(n[1]) : 20;
  return [
    "from build123d import *",
    "",
    `size = ${Number.isFinite(size) ? size : 20}`,
    "with BuildPart() as part:",
    "    Box(size, size, size)",
    "result = part.part",
    "",
  ].join("\n");
}

/** Prompt for the plan step — request a short design plan (no code). */
function buildPlanPrompt(input: HarnessInput): string {
  const knowledge = buildKnowledgeBlock({
    prompt: input.prompt,
    process: input.process,
  });
  // Exemplar retrieval v2 (docs/text-to-cad/07 §C): the plan step sees the
  // catalog (id/title/keywords/lesson — not code) and names its pick(s) on the
  // last line; the generate step then injects the chosen exemplar code.
  const catalog = formatExemplarCatalog();
  const exemplarAsk = catalog
    ? `\n\n${catalog}\n\nAfter the plan, your LAST line must be exactly \`EXEMPLAR: <id>\` (or \`EXEMPLAR: <id>|<id2>\` for two, or \`EXEMPLAR: none\` if none fits) naming the catalog exemplar(s) closest to this request.`
    : "";
  return `Plan a parametric 3D model for this request: ${input.prompt}\n\nDesign guidance to honor:\n\n${knowledge}${exemplarAsk}`;
}

/**
 * Split the plan step's trailing `EXEMPLAR: <id>|<id2>|none` line off the plan
 * text. `ids: null` = no/unparseable line (fall back to keyword selection);
 * `ids: []` = an explicit "none" (the model saw the catalog and declined).
 * Pure + exported for tests.
 */
export function parsePlanExemplarLine(planText: string): {
  ids: string[] | null;
  plan: string;
} {
  const lines = planText.trimEnd().split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  const m = last.match(/^EXEMPLAR:\s*(.+)$/i);
  if (!m) return { ids: null, plan: planText.trim() };
  const plan = lines.slice(0, -1).join("\n").trim();
  const tokens = m[1]
    .split("|")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return { ids: null, plan };
  if (tokens.length === 1 && tokens[0] === "none") return { ids: [], plan };
  return { ids: tokens.filter((t) => t !== "none").slice(0, 2), plan };
}

/** Optional context threaded from the pre-generation steps (brief + plan). */
interface PromptExtras {
  /** Fresh-build design brief; folded in as a structured requirements block. */
  brief?: CadBrief | null;
  /**
   * Exemplar ids the plan chose from the catalog. undefined/null = no plan
   * choice, use keyword selection; [] = explicit "none", inject nothing.
   */
  exemplarIds?: string[] | null;
  /**
   * Off-the-shelf part sourcing block (MTR-200): sourced-part envelopes +
   * honest miss notes, appended so the model sizes cavities/cutouts from real
   * dims. "" / undefined = nothing sourced.
   */
  partSourcing?: string | null;
}

function buildUserPrompt(
  input: HarnessInput,
  plan?: string,
  extras: PromptExtras = {}
): string {
  const task = input.priorSourceCode
    ? [
        "Revise the following build123d model per this instruction:",
        `Instruction: ${input.prompt}`,
        "",
        "Current code:",
        "```python",
        input.priorSourceCode,
        "```",
      ].join("\n")
    : `Create a 3D model: ${input.prompt}`;

  const knowledge = buildKnowledgeBlock({
    prompt: input.prompt,
    process: input.process,
  });

  let out = `${task}\n\nDesign guidance to follow:\n\n${knowledge}`;

  // Fresh-build brief: structured requirements + real cutout dims so the
  // numbers stop being lost in prose (docs/text-to-cad/06 part 1).
  if (extras.brief) {
    out += `\n\n${formatBriefForPrompt(extras.brief)}`;
    const hints = formatComponentHints(extras.brief);
    if (hints) out += `\n\n${hints}`;
  }

  // Off-the-shelf part sourcing (MTR-200): real vendor / local-fastener
  // envelopes so cavities and cutouts FIT, plus honest miss notes.
  if (extras.partSourcing) out += `\n\n${extras.partSourcing}`;

  // Revision: replay the persisted brief so the revised code still honors the
  // original structured requirements. Tolerate any shape — the column is
  // untyped jsonb and older rows may predate the schema.
  if (input.priorSourceCode && input.priorBrief != null) {
    const parsed = cadBriefSchema.safeParse(input.priorBrief);
    const block = parsed.success
      ? formatBriefForPrompt(parsed.data)
      : `Design brief (from the original build):\n${JSON.stringify(input.priorBrief)}`;
    out += `\n\n${block}`;
  }

  if (plan) {
    out += `\n\nFollow this plan:\n${plan}`;
  }

  // Fold the owner's feedback on the prior version into the revise prompt so
  // the model actually corrects what was flagged (CON-181).
  const fb = input.priorFeedback;
  if (fb) {
    const tagLabels = (fb.tags ?? [])
      .map((t) => CAD_FEEDBACK_TAG_LABELS[t as CadFeedbackTag] ?? t)
      .filter(Boolean);
    const note = fb.note?.trim();
    if (fb.rating === "bad" || tagLabels.length > 0 || note) {
      const lines = ["The previous version received this feedback — fix it:"];
      if (tagLabels.length > 0) lines.push(`- Problems: ${tagLabels.join(", ")}`);
      if (note) lines.push(`- Note: ${note}`);
      out += `\n\n${lines.join("\n")}`;
    }
  }

  // On a fresh build, show the best-matching verified exemplar(s) as a style
  // reference. (Revisions already have the prior code as their reference.)
  // The plan step's catalog pick wins when present (retrieval v2); keyword
  // scoring remains the fallback when the plan named nothing parseable.
  if (!input.priorSourceCode) {
    let chosen = selectExemplars(input.prompt);
    if (extras.exemplarIds != null) {
      if (extras.exemplarIds.length === 0) {
        chosen = []; // explicit "none" — the model saw the catalog and declined
      } else {
        const byId = selectExemplarsByIds(extras.exemplarIds);
        // All-invalid ids fall back to keyword scoring, never to nothing.
        if (byId.length > 0) chosen = byId;
      }
    }
    const exemplars = formatExemplars(chosen);
    if (exemplars) out += `\n\n${exemplars}`;
  }

  return out;
}

/**
 * Targeted repair guidance for known, recurring failure classes — a generic
 * "fix it" lets the model retry the same mistake. Returns "" for unknown errors.
 */
export function repairHintFor(note: string): string {
  const n = note.toLowerCase();
  // Fragment gate: multiple bodies in one `result`. Must NOT steer toward
  // fuse/union — that collapses a stacked assembly into one shell (MTR-213).
  if (/disconnected solids/.test(n) || /via the parts dict/.test(n)) {
    return (
      "The script put multiple printable pieces into a single `result` " +
      "compound (the stacked preview is the tell). Do NOT fuse them into " +
      "one body. Assign each piece to a `parts` dict — " +
      '`parts = {"base": <solid>, "lid": <solid>}` (name them for what they ' +
      "are) — and remove the `result =` assignment. Fuse only stray debris " +
      "INTO its parent part."
    );
  }
  // sdf_kit's to_mesh refuses over-budget grids with a message that already
  // names a pitch that fits — pass it through verbatim, it IS the fix.
  if (/cells exceeds/.test(n) && /use pitch >=/.test(n)) {
    const verbatim = note.match(/grid .*use pitch >= [\d.]+/i)?.[0] ?? note;
    return `The SDF grid was too large for the cell budget: ${verbatim}. Increase the pitch (and/or shrink the bounding box) exactly as instructed.`;
  }
  if (/(fillet|chamfer)/.test(n) && /(smaller|max_fillet|radius|length|valid)/.test(n)) {
    return "That fillet/chamfer radius is too large for the geometry. REDUCE it substantially (at least halve it, and keep it well under the thinnest adjacent wall), apply it to fewer/specific edges, or wrap it in try/except and fall back to max_fillet() — do NOT retry the same radius.";
  }
  if (/rectanglerounded/.test(n) && /buildsketch/.test(n)) {
    return "RectangleRounded is a sketch primitive — use it INSIDE `with BuildSketch(...)` then extrude, not as a BuildPart operation.";
  }
  if (/slot/.test(n) && /width|height/.test(n)) {
    return "Slot/SlotOverall require width > height. Swap the dimensions and rotate the sketch 90°, or build the slot from a Rectangle + two Circles instead.";
  }
  if (/buildpart|buildsketch/.test(n) && /(combined|builder|part.{0,3}attribute|can.?t be)/.test(n)) {
    return "A BuildPart/BuildSketch is a builder, not a Shape — don't add/subtract/combine the builders. Use `.part` (e.g. `part.part`, or `a.part + b.part`), or build everything in ONE BuildPart with nested add/subtract modes.";
  }
  if (/no result|oom|crash|killed|memory|timed out/.test(n)) {
    return "The previous attempt CRASHED or hung the geometry kernel — it was too heavy. Drastically SIMPLIFY: far fewer boolean operations, no large loops or dense patterns, coarser detail, simple primitives. Build the simplest geometry that still reads as the requested object.";
  }
  // Dual-fluid isolation failures (MTR-179): concrete geometry fixes, not
  // "try again". The diagnosis in the note already names leak vs blockage.
  if (/fluid circuits failed isolation/.test(n)) {
    return (
      "Fix the dual-fluid core, in order of likelihood: (1) LEAK — the wall " +
      "is thinner than the mesh can resolve: raise `wall` (>= 1.0mm polymer) " +
      "and keep to_mesh pitch <= wall/3; or a plenum face never sealed the " +
      "other fluid — every port face needs the OTHER circuit ramp-sealed " +
      "(seal_a/seal_b via seal_ramp over >= half a cell), which " +
      "exchanger_core() does for you. (2) BLOCKAGE — a circuit split in two " +
      "means its channels never reach the plenum: don't seal a fluid on its " +
      "OWN port face, and keep the core >= 1.5 cells per axis. (3) Probe " +
      "misplaced — fluid_ports probes must sit in open fluid space (plenum " +
      "centers, off the bore axis). Prefer `exchanger_core(...)` from " +
      "`exchanger` over hand-rolling the seals; it returns correct " +
      "fluid_ports/fluid_plugs."
    );
  }
  // The harness runs the sidecar with allowRemesh: false (docs/text-to-cad/02
  // §C) — a non-watertight result is the model's to fix, not the voxelizer's.
  if (/not watertight/.test(n)) {
    return "The result was NOT WATERTIGHT and the lossy voxel-remesh fallback is off — close the surface yourself. In mesh/SDF mode: pad the field with a void border (np.pad(..., constant_values=<void>)) so the isosurface closes at the box boundary, then mesh.merge_vertices() + mesh.fix_normals(). In build123d: simplify the boolean sequence — fewer overlapping/tangent booleans, ensure solids genuinely overlap (not merely touch) before fusing.";
  }
  return "";
}

/**
 * Run the generate -> execute -> validate -> repair loop. Returns the last
 * attempt's code + run regardless of success so the caller can persist the
 * full record (the failed code is still useful flywheel data).
 */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS_DEFAULT;
  const useModel = hasModelCredentials();

  // Router-gated system prompt (MTR-222): selected ONCE from the job's user
  // prompt and reused for every attempt (fresh generate + every repair turn)
  // so the assembled prefix stays byte-stable within the job — a sibling PR's
  // prompt caching depends on that stability.
  const systemPrompt = buildSystemPrompt(selectSystemPromptSections(input.prompt));

  // Swallow listener errors — progress is cosmetic, never load-bearing.
  const emit = (event: CadProgressEvent) => {
    try {
      input.onProgress?.(event);
    } catch {
      /* ignore */
    }
  };

  const telemetry: NonNullable<HarnessResult["telemetry"]> = [];
  const timed = async <T>(
    role: CadRole,
    model: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      telemetry.push({ role, model, ms: Date.now() - t });
    }
  };

  // Design brief (fresh builds only, docs/text-to-cad/06 part 1): structured
  // JSON between prompt and code. Best-effort like the plan step — null on any
  // failure and the run proceeds as before. Revisions never rebuild it; they
  // carry input.priorBrief through instead.
  let brief: CadBrief | null = null;
  if (!input.priorSourceCode && input.providedBrief != null) {
    const parsed = cadBriefSchema.safeParse(input.providedBrief);
    if (parsed.success) brief = parsed.data;
  }
  if (brief === null && useModel && !input.priorSourceCode && briefStepEnabled()) {
    const briefModel = modelForRole("brief");
    brief = await timed("brief", briefModel, () =>
      buildBrief({
        prompt: input.prompt,
        images: input.images,
        signal: input.signal,
      })
    );
  }
  // Ask-before-build now lives INSIDE the job (walk-away UX): the brief's
  // open questions surface through the executor's suspend/resume question
  // machinery — present users get the choice cards, absent users get the
  // defaults after the timeout — instead of the old client-side quick-check
  // card that gated the build on a phone that might be locked in a pocket.
  // Budget/timeout policy is entirely the asker's (jobs.ts maxQuestionsPerJob:
  // beyond-budget questions resolve to their default without suspending).
  if (brief?.questions?.length && input.onQuestion) {
    const decisions = [...(brief.decisions ?? [])];
    const decided = new Set(decisions.map((d) => d.q));
    for (const [qi, q] of brief.questions.entries()) {
      if (decided.has(q.question) || q.options.length === 0) continue;
      const options = q.options.map((o, oi) => ({
        id: `opt-${oi + 1}`,
        label: o.label,
        detail: o.detail,
      }));
      const defaultOptionId =
        options.find((o) => o.label === q.default)?.id ?? options[0].id;
      try {
        const answer = await input.onQuestion({
          id: `brief-${qi + 1}`,
          text: q.question,
          options,
          defaultOptionId,
        });
        // Free-text replies (MTR-216) carry the user's own words; preset
        // picks map back to the option label the brief prompt understands.
        const custom = answer.startsWith(CUSTOM_ANSWER_PREFIX)
          ? answer.slice(CUSTOM_ANSWER_PREFIX.length).trim()
          : null;
        const label = custom || options.find((o) => o.id === answer)?.label;
        if (label) decisions.push({ q: q.question, a: label });
      } catch {
        // Asking is best-effort — an asker failure falls through to the
        // question's default at prompt-format time (formatBrief).
      }
    }
    if (decisions.length > (brief.decisions?.length ?? 0)) {
      brief = { ...brief, decisions };
    }
  }
  // The brief (fresh) or the caller's priorBrief (revision) rides the result
  // unchanged — persistence is the caller's job.
  const resultBrief = input.priorSourceCode ? input.priorBrief : (brief ?? undefined);
  // Design intent for the aesthetic judge (MTR-223): the brief this run is
  // actually built against — the fresh brief, or the revision's prior brief
  // when it parses. Best-effort; undefined leaves the judge prompt unchanged.
  const priorBriefParsed =
    input.priorSourceCode && input.priorBrief != null
      ? cadBriefSchema.safeParse(input.priorBrief)
      : null;
  const judgeBrief =
    brief ?? (priorBriefParsed?.success ? priorBriefParsed.data : undefined);

  // Off-the-shelf part sourcing (MTR-200): resolve the brief's named components
  // to real envelopes ONCE, up front, and thread the block into every generate
  // prompt (fresh + repair). With the catalog gated off (default) this only
  // resolves local fasteners — offline, cheap; never blocks a generation.
  let partSourcing: BriefSourcing = { sourced: [], misses: [] };
  let partSourcingBlock = "";
  if (brief) {
    try {
      partSourcing = await sourcePartsForBrief(brief, { signal: input.signal });
      partSourcingBlock = formatSourcedPartsForPrompt(partSourcing);
    } catch {
      /* best-effort — a sourcing failure never derails a generation */
    }
  }

  // Dimension contract (MTR-197): the machine-checkable targets to assert after
  // a valid run. From the fresh brief, or re-parsed from the revision's brief so
  // a revision still honors the original callouts. Fit targets (MTR-204) for
  // known components are auto-appended inside extractDimensionTargets.
  const dimensionTargets: DimensionTarget[] = extractDimensionTargets(
    input.priorSourceCode ? input.priorBrief : brief
  );
  // Component-fit checks (MTR-204): the sidecar request derived from the fit
  // targets, passed on every run so the verdicts land on run.checks.fit and
  // flow through the SAME dimension-check → repair-hint machinery. Null (no
  // `checks` sent at all) when the brief names no known component.
  const fitChecks = buildFitChecksFromTargets(dimensionTargets);
  const runChecks = fitChecks ? { fit: fitChecks } : undefined;
  // The last run's dimension-check results, surfaced on the return + used to
  // drive a dimension-specific repair turn.
  let dimensionChecks: DimensionCheckResult[] = [];

  // Per-prompt concept image (fresh builds only): a beautiful product render the
  // generator builds TOWARD — taste injection that hand-authored code exemplars
  // can't provide. Best-effort + gated by FAL_KEY; null when disabled/failed.
  // Built FROM the brief when one exists, so the taste target matches the
  // functional reality (envelope, form language).
  const conceptImg =
    useModel && !input.priorSourceCode
      ? await conceptImage(
          input.prompt,
          input.signal,
          brief ? formatBriefForConcept(brief) : undefined
        )
      : null;
  const withConcept = (base?: PromptImage[] | null): PromptImage[] | undefined => {
    const imgs = [...(base ?? []), ...(conceptImg ? [conceptImg] : [])];
    return imgs.length ? imgs : undefined;
  };

  // Plan-then-code: a short design plan up front (fresh builds only — revisions
  // already have the prior code as their plan). Best-effort: a planning failure
  // must not block generation. No-op without model credentials.
  let plan: string | undefined;
  // Exemplar ids the plan chose from the catalog (null = no parseable choice,
  // keyword fallback; [] = explicit none).
  let exemplarIds: string[] | null = null;
  if (useModel && !input.priorSourceCode && planStepEnabled()) {
    const planModel = modelForRole("plan");
    try {
      const text = await timed("plan", planModel, () =>
        completeText({
          system: PLAN_SYSTEM_PROMPT,
          prompt: conceptImg
            ? `${buildPlanPrompt(input)}\n\n${CONCEPT_IMAGE_NOTE}`
            : buildPlanPrompt(input),
          model: planModel,
          role: "plan",
          images: withConcept(input.images),
          signal: input.signal,
        })
      );
      // Strip the EXEMPLAR line before the plan reaches the generate prompt —
      // the id choice routes exemplar injection, it isn't part of the plan.
      const parsed = parsePlanExemplarLine(text);
      plan = parsed.plan || undefined;
      exemplarIds = parsed.ids;
    } catch {
      plan = undefined;
    }
  }

  let lastCode = "";
  let lastRun: CadRunResult | undefined;
  let repairNote = "";
  // Real count of attempts actually run, for the failure return below — NOT
  // maxAttempts, which is only the cap. Set once we commit to running this
  // attempt (past the abort check) so an aborted/never-started attempt isn't
  // counted (MTR-158).
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.signal?.aborted) break;
    // Deadline rail: never start an attempt there's no time to finish — a
    // codegen call + sidecar run + judge comfortably eats a minute. Attempt 1
    // always runs (a deadline that tight means the caller misconfigured it;
    // dying mid-try beats returning nothing by fiat).
    if (
      attempt > 1 &&
      input.deadlineAt &&
      input.deadlineAt - Date.now() < MIN_ATTEMPT_MS
    ) {
      break;
    }
    lastAttempt = attempt;

    emit({ type: "phase", phase: "generating", attempt, maxAttempts });
    if (useModel) {
      // Route the generate step by role: implement on the first pass, repair
      // thereafter. Both default to the strong model until configured.
      const role: CadRole = repairNote ? "repair" : "implement";
      const model = modelForRole(role);
      // On a repair turn, show the model a render of its OWN previous attempt
      // (when one exists) — text errors alone leave it blind to the actual
      // form. A render only exists once the run produced a valid solid, so
      // this kicks in mainly for "printable but visually weak" repairs.
      const priorRender = repairNote ? lastRun?.renderPng : undefined;
      const userPrompt = repairNote
        ? [
            buildUserPrompt(input, plan, { brief, exemplarIds, partSourcing: partSourcingBlock }),
            "",
            `The previous attempt failed because ${repairNote}. Here is that code:`,
            "```python",
            lastCode,
            "```",
            repairHintFor(repairNote),
            // Deterministic stderr->class->fixes enrichment (MTR-198). Additive
            // to the tailored hint above; names the failure class + standard
            // fixes even when repairHintFor had no specific match.
            enrichRepairHint(repairNote),
            priorRender
              ? "A render of that previous attempt is attached — use it to see what is actually wrong with the form, then fix it."
              : "",
            "Fix it.",
          ]
            .filter(Boolean)
            .join("\n")
        : buildUserPrompt(input, plan, { brief, exemplarIds, partSourcing: partSourcingBlock });
      const images: PromptImage[] = [
        ...(input.images ?? []),
        ...(conceptImg ? [conceptImg] : []),
        ...(priorRender
          ? [{ data: priorRender, mediaType: "image/png" as const }]
          : []),
      ];
      const text = await timed(role, model, () =>
        completeText({
          system: systemPrompt,
          prompt: conceptImg ? `${userPrompt}\n\n${CONCEPT_IMAGE_NOTE}` : userPrompt,
          model,
          role,
          images: images.length ? images : undefined,
          signal: input.signal,
        })
      );
      lastCode = extractCode(text);
    } else {
      // No credentials: deterministic local fallback, no repair value.
      lastCode = localFakeModel(input.prompt, input.priorSourceCode);
    }

    emit({ type: "phase", phase: "executing", attempt, maxAttempts });
    lastRun = await runCadCode(lastCode, BREP_OUTPUT_FORMATS, input.signal, {
      checks: runChecks,
    });

    // Last attempt, and the ONLY defect is an open/non-manifold surface:
    // accept the lossy voxel remesh as an explicit, recorded decision
    // (docs/text-to-cad/02 §C) rather than failing the generation. Earlier
    // attempts keep allowRemesh off so the model fixes its own geometry.
    if (
      attempt === maxAttempts &&
      !lastRun.ok &&
      lastRun.validation.compiled &&
      lastRun.validation.isSolid &&
      !lastRun.validation.isWatertight
    ) {
      const remeshed = await runCadCode(lastCode, BREP_OUTPUT_FORMATS, input.signal, {
        allowRemesh: true,
        checks: runChecks,
      });
      if (remeshed.ok) lastRun = remeshed;
    }

    // Live preview: stream the attempt's render so the studio shows the
    // part taking shape instead of a spinner (kept out of the progress log).
    // Sampled surface points ride along so the forming point cloud can morph
    // toward the actual solid, not stay a generic blob.
    if (lastRun.renderPng) {
      emit({
        type: "snapshot",
        render: lastRun.renderPng,
        step: attempt,
        points: lastRun.files.stl
          ? sampleStlPoints(lastRun.files.stl) ?? undefined
          : undefined,
      });
    }

    const grade = gradeRun(lastRun);
    emit({
      type: "validation",
      attempt,
      maxAttempts,
      pass: grade.pass,
      failures: grade.failures,
      validation: lastRun.validation,
    });
    if (grade.pass) {
      // Enclosure split enforcement (MTR-213): an enclosure-shaped prompt is
      // two-piece by default (recipe step 4), but nothing downstream forced it —
      // a base+lid returned as one solid silently ships as a single shell. When
      // the run produced a single part for such a prompt, spend a repair turn on
      // a TARGETED parts-dict hint (never the generic fuse-into-one hint that
      // caused the collapse). Runs before the dimension/aesthetic passes:
      // structure comes first. On the last attempt we accept what we have rather
      // than hard-fail a valid single solid.
      const producedAssembly = (lastRun.parts?.length ?? 0) >= 2;
      if (
        needsEnclosureRecipe(input.prompt) &&
        !producedAssembly &&
        useModel &&
        attempt < maxAttempts
      ) {
        repairNote = ENCLOSURE_SPLIT_REPAIR_NOTE;
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      // Dimension contract (MTR-197): assert the brief's callouts against the
      // built geometry. Deterministic, no model call. A failed target that we
      // have budget to fix earns a dimension-specific repair turn BEFORE the
      // (paid) aesthetic judge — function before beauty.
      dimensionChecks = checkDimensionTargets(lastRun, dimensionTargets);
      if (
        hasDimensionFailures(dimensionChecks) &&
        useModel &&
        attempt < maxAttempts
      ) {
        repairNote = `dimensions are out of spec — ${formatDimensionRepairHints(dimensionChecks)}`;
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      // Dual-fluid isolation (MTR-179): the sidecar ran check_networks
      // because the script declared `fluid_ports` (exchanger builds). A leak
      // or blockage earns a targeted repair turn before the (paid) aesthetic
      // judge — an exchanger that mixes its fluids is scrap however it looks.
      const networksFail = networksFailure(getNetworksReport(lastRun));
      if (networksFail && useModel && attempt < maxAttempts) {
        repairNote = `the fluid circuits failed isolation — ${networksFail}`;
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      // Exchanger prompt with NO networks report at all: the script never
      // (validly) declared fluid_ports, so the isolation check silently
      // never ran — the exact hole that shipped an unverified solid block
      // as a "finished" exchanger. Verification is not optional for a
      // two-fluid part; spend a repair turn demanding the declaration.
      if (
        needsExchangerRecipe(input.prompt) &&
        !getNetworksReport(lastRun) &&
        useModel &&
        attempt < maxAttempts
      ) {
        repairNote =
          "this is a dual-fluid part but NO isolation check ran — declare `fluid_ports` (a LIST of {\"name\": \"a_in\", \"point\": [x,y,z], \"r\": mm} probes, one per inlet/outlet, each sitting in open fluid space), `fluid_plugs` (a LIST of {\"a\": [x,y,z], \"b\": [x,y,z], \"r\": mm} capsules spanning each port bore), and `fluid_min_feature = wall`. exchanger_core() returns ports and plugs ready-made. An exchanger without a verified isolation check cannot ship.";
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      // Geometrically valid — now judge it aesthetically. On by default with
      // credentials (CAD_CRITIQUE=false disables); all available views go to
      // the judge so one 3/4 view can't hide a defect.
      const judgement = await judgeAesthetics({
        renderPng: lastRun.renderPng,
        renders: lastRun.renders,
        prompt: input.prompt,
        // CoT-to-critic (MTR-223): the plan + brief this attempt was built
        // against — context for intent-vs-outcome judging, never an excuse
        // for visual defects.
        intent: { plan, brief: judgeBrief },
        signal: input.signal,
      });
      const aestheticScore = judgement.available
        ? (judgement.score ?? null)
        : null;
      const aestheticDims = judgement.available
        ? (judgement.perDimension ?? null)
        : null;

      // Spend a repair turn on a visually-weak (but printable) result when we
      // have budget and a model. Otherwise accept it.
      if (
        judgement.available &&
        judgement.pass === false &&
        useModel &&
        attempt < maxAttempts
      ) {
        repairNote = `the design is printable but visually weak — ${judgement.feedback}`;
        emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
        continue;
      }

      return {
        ok: true,
        sourceCode: lastCode,
        attempts: attempt,
        run: lastRun,
        aestheticScore,
        aestheticDims,
        brief: resultBrief,
        // TODO(MTR-197): persist on a cad_generations.dimension_checks jsonb
        // column (the cad-artifacts PR owns migrations); until then this rides
        // the in-memory result for the studio chip + eval reuse only.
        dimensionChecks,
        telemetry,
        ...(partSourcing.sourced.length > 0 || partSourcing.misses.length > 0
          ? { partSourcing }
          : {}),
      };
    }

    repairNote = grade.failures.join("; ");
    // The local fallback is deterministic — repairing it is pointless.
    if (!useModel) break;
    if (attempt < maxAttempts) {
      emit({ type: "repairing", attempt, maxAttempts, reason: repairNote });
    }
  }

  return {
    ok: false,
    sourceCode: lastCode,
    attempts: lastAttempt,
    run: lastRun,
    brief: resultBrief,
    dimensionChecks,
    error: repairNote || "generation failed",
    telemetry,
    ...(partSourcing.sourced.length > 0 || partSourcing.misses.length > 0
      ? { partSourcing }
      : {}),
  };
}

/**
 * Pull the machine-checkable dimension targets off a brief (fresh CadBrief or
 * an untyped persisted priorBrief), plus the auto-emitted component-fit
 * targets (MTR-204) for any known dev board the brief names. Best-effort — a
 * malformed/absent brief just yields no targets, so the dimension pass is a
 * no-op rather than a failure.
 */
function extractDimensionTargets(brief: unknown): DimensionTarget[] {
  if (brief == null) return [];
  const parsed = cadBriefSchema.safeParse(brief);
  if (!parsed.success) return [];
  const declared =
    (parsed.data.dimensionTargets as DimensionTarget[] | undefined) ?? [];
  return [...declared, ...fitTargetsForBrief(parsed.data)];
}
