"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  CheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PackageIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { zipSync } from "fflate";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "@/components/icons/chevron-down";
import { ChevronRight } from "@/components/icons/chevron-right";
import { ClockRewind } from "@/components/icons/clock-rewind";
import { EditSparkle } from "@/components/icons/edit-sparkle";
import { Layers } from "@/components/icons/layers";
import {
  deleteCadBuild,
  getCadTopoUrl,
  recordCadFeedback,
  renameCadGeneration,
  saveCadFileToProfile,
  setActiveCadVersion,
} from "@/app/actions/cad-generation";
import { StepDownloadLink } from "@/components/files/step-download-button";
import { diffParams, extractParams } from "@/components/cad/param-diff";
import type {
  CadStreamEvent,
  CadProgressEvent,
  CadQuestionOption,
} from "@/lib/cad/types";
// Type-only: lib/cad/brief is server-only at runtime; the type is erased.
import type { CadBrief } from "@/lib/cad/brief";
import type { ViewerAnnotation } from "@/components/viewer/model-viewer";
import { useKeyboardStickyBottom } from "@/lib/hooks/use-keyboard-sticky-bottom";
import {
  CAD_FEEDBACK_TAGS,
  CAD_FEEDBACK_TAG_LABELS,
  type CadFeedbackTag,
  type CadRating,
} from "@/lib/cad/feedback";
import { cn } from "@/lib/utils";

// A few human-written example prompts for the empty state — plain strings that
// prefill the composer (NOT exemplar template cards; MTR-208). Kept short and
// evocative so a first-time visitor sees the kind of thing to ask for.
const EXAMPLE_PROMPTS: readonly string[] = [
  "A parametric enclosure for a Raspberry Pi with vents",
  "An ergonomic knurled knob, 30mm",
  "A desk organizer with three compartments",
  "A wall bracket for a 22mm dowel",
];

// The 3D viewer pulls in three.js / react-three-fiber — lazy-load it so the
// studio shell (and its bundle) stays light until a model is on screen.
const ModelViewer = lazy(() =>
  import("@/components/viewer/model-viewer").then((mod) => ({
    default: mod.ModelViewer,
  }))
);

// Idle/working visual — a deforming wireframe blob shown before a model exists.
const MaterializingBlob = lazy(() =>
  import("@/components/cad/materializing-blob").then((mod) => ({
    default: mod.MaterializingBlob,
  }))
);

export interface StudioPart {
  name: string;
  fileAssetId: string;
  /** True when this part carried an editable STEP source (MTR-196/215). */
  hasStep?: boolean;
}

export interface StudioTurn {
  id: string;
  prompt: string;
  status: "pending" | "succeeded" | "failed";
  renderUrl: string | null;
  fileAssetId: string | null;
  sourceCode: string | null;
  error: string | null;
  rating: CadRating | null;
  feedbackTags: string[];
  feedbackNote: string | null;
  /** Multi-part assembly members (length > 1); empty for a single solid. */
  parts: StudioPart[];
  /** Project bundling an assembly's parts, when one was created. */
  projectSlug: string | null;
  /** True when the result was voxel-remeshed (an approximation). */
  remeshed: boolean;
  /**
   * True when the primary asset carried an editable STEP source (MTR-196).
   * Threaded from the server / done event so the "Download STEP" action is
   * present at first paint — no probe-driven late pop-in (MTR-215). Optional:
   * absent on turns minted before the signal was threaded.
   */
  hasStep?: boolean;
  /**
   * The generation this one revised — encodes the branch structure within
   * a thread (a fork when it isn't the immediately preceding turn).
   * Optional: absent on turns minted before the column was threaded
   * through.
   */
  parentGenerationId?: string | null;
}

export interface StudioThread {
  rootId: string;
  title: string | null;
  lastActivity: number;
  turns: StudioTurn[];
  /**
   * cadThreads.id when the thread is DB-backed (docs/text-to-cad/05 §A).
   * Absent on legacy pre-migration groups and threads created in-session
   * (the done event doesn't carry it) — those can't pin until reload.
   */
  threadId?: string;
  /** Pinned version — which generation the thread currently "is". */
  activeGenerationId?: string | null;
  /** THE library file for this design once saved (one file per design). */
  savedFileId?: string | null;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const ALLOWED_IMAGE_TYPES: ImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const MAX_IMAGES = 4;

interface AttachedImage {
  id: string;
  /** data: URL for the thumbnail. */
  dataUrl: string;
  /** base64 payload (no data: prefix) sent to the model. */
  data: string;
  mediaType: ImageMediaType;
}

/** A selected face/edge plus the user's note, fed to the agent on revision. */
type StudioAnnotation = ViewerAnnotation & { note: string };

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/** Filesystem-safe stem for a client-generated download filename. */
function safeFileStem(s: string): string {
  return s
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Trigger a browser download of an in-memory blob (same-origin object URL). */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has committed first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function threadLabel(t: StudioThread): string {
  return t.title?.trim() || truncate(t.turns[0]?.prompt ?? "Untitled build");
}

/** Most changed params shown inline; the rest fold into "+N more". */
const MAX_DIFF_PARAMS = 3;

/** Trim float noise from a parsed parameter literal ("2.4", not "2.4000…4"). */
function fmtParam(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * One-line "what changed" between a revision and its parent: up to
 * MAX_DIFF_PARAMS changed top-level parameters ("wall 2 → 2.4 ·
 * corner_r 6 → 8"), the rest folded into "+N more". Null when either side
 * parses to no parameters (mesh-mode scripts) or nothing changed.
 */
function paramDiffSummary(
  prevSource: string,
  nextSource: string
): string | null {
  const prev = extractParams(prevSource);
  const next = extractParams(nextSource);
  if (Object.keys(prev).length === 0 || Object.keys(next).length === 0) {
    return null;
  }
  const { changed } = diffParams(prev, next);
  if (changed.length === 0) return null;
  const shown = changed
    .slice(0, MAX_DIFF_PARAMS)
    .map(([name, from, to]) => `${name} ${fmtParam(from)} → ${fmtParam(to)}`);
  const extra = changed.length - shown.length;
  return shown.join(" · ") + (extra > 0 ? ` · +${extra} more` : "");
}

// Resume-on-return: a cold visit to the studio starts a fresh build, but if
// you were just here and bounced away, coming back within this window restores
// the build you were on. The timestamp is refreshed on every selection change
// and when you leave (SPA nav / tab hide / reload), so it measures time-away.
const RESUME_STORAGE_KEY = "prometheus:last-session";
const RESUME_GRACE_MS = 2 * 60_000;

type ResumeState = {
  rootId: string | null;
  viewTurnId: string | null;
  ts: number;
  /** In-flight background generation job to reattach to (MTR-175). */
  job?: StoredJob | null;
};

/**
 * A background generation job persisted alongside the resume slot. Unlike
 * the rootId/viewTurnId selection (grace-windowed), a stored job is
 * reattached regardless of time away — the build keeps running server-side
 * and the events stream replays whatever was missed.
 */
type StoredJob = {
  jobId: string;
  generationId: string;
  /** The submitted prompt + thread context, needed to apply the `done`. */
  prompt: string;
  parentId: string | null;
  rootId: string | null;
};

/** Read the persisted in-flight job, if any (no grace window — see above). */
function readStoredJob(): StoredJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<ResumeState> | null;
    const job = saved?.job;
    if (
      !job ||
      typeof job.jobId !== "string" ||
      typeof job.generationId !== "string"
    ) {
      return null;
    }
    return {
      jobId: job.jobId,
      generationId: job.generationId,
      prompt: typeof job.prompt === "string" ? job.prompt : "",
      parentId: job.parentId ?? null,
      rootId: job.rootId ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Read the persisted selection iff it's recent enough to count as "came right
 * back" AND the build still exists. Returns null on a cold visit → new build.
 */
function readRecentResume(threads: StudioThread[]): ResumeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<ResumeState> | null;
    if (!saved || typeof saved.ts !== "number") return null;
    if (Date.now() - saved.ts > RESUME_GRACE_MS) return null;
    // Only resume a build that's still in the list (it may have been deleted).
    if (saved.rootId && !threads.some((t) => t.rootId === saved.rootId)) {
      return null;
    }
    return {
      rootId: saved.rootId ?? null,
      viewTurnId: saved.viewTurnId ?? null,
      ts: saved.ts,
    };
  } catch {
    return null;
  }
}

/**
 * Experimental, owner-gated text-to-CAD studio. A chat-style surface: a
 * floating composer drives a thread of generations (the first message starts
 * a build, every later message revises it), with a live 3D viewer, streamed
 * harness progress, an agent-titled thread list, and per-turn revision
 * history. Each successful turn mints a printable asset that flows into the
 * existing /print/[fileAssetId] quote pipeline.
 */
export function TextToCadStudio({
  initialThreads,
}: {
  initialThreads: StudioThread[];
}) {
  const [threads, setThreads] = useState<StudioThread[]>(initialThreads);
  // Cold visit → start a fresh build (blank canvas). Only resume the last
  // build if you were just here and came right back (see readRecentResume).
  const [activeRootId, setActiveRootId] = useState<string | null>(
    () => readRecentResume(initialThreads)?.rootId ?? null
  );
  const [viewTurnId, setViewTurnId] = useState<string | null>(
    () => readRecentResume(initialThreads)?.viewTurnId ?? null
  );
  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState<CadProgressEvent[]>([]);
  // Live build preview: the LATEST snapshot render only (replace, never
  // accumulate — each frame is a whole base64 PNG). Kept out of `progress`
  // so the status transcript stays tiny.
  const [snapshot, setSnapshot] = useState<{
    render: string;
    step: number;
  } | null>(null);
  // Reviewable design brief (docs/text-to-cad/06): drafted from the composer
  // prompt, edited in place, and sent with the generate request. Fresh
  // builds only — revisions inherit the parent's brief server-side.
  const [brief, setBrief] = useState<CadBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Mid-cycle interactive question (MTR-191): set when the running job emits a
  // `question` event and the job is suspended (awaiting_input); cleared when
  // its `answer` resolution arrives (the user picked, or the server took the
  // default on timeout) or the build ends. `answering` disables the chips
  // during the POST so a double-tap can't fire twice.
  const [pendingQuestion, setPendingQuestion] = useState<{
    jobId: string;
    questionId: string;
    text: string;
    options: CadQuestionOption[];
    defaultOptionId?: string;
    timeoutS: number;
    answering: boolean;
  } | null>(null);
  // Loader→model handoff: on a fresh result the deforming blob morphs into the
  // generated shape ("morph"), then the crisp ModelViewer is mounted underneath
  // and the blob is faded out ("reveal").
  const [transition, setTransition] = useState<{
    assetId: string;
    phase: "morph" | "reveal";
  } | null>(null);
  // The model to deform in place while generating a REVISION (the shape being
  // edited). Null on a fresh build → the wireframe blob deforms instead.
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSource, setShowSource] = useState(true);
  const [showBuilds, setShowBuilds] = useState(true);
  // Mobile-only: the Builds history dropdown that pops down from the header
  // icon (the desktop sidebar Builds block is hidden below `lg`).
  const [showBuildsMenu, setShowBuildsMenu] = useState(false);
  // Which build's three-dot menu is open in the sidebar.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Eval feedback: auto-prompt per turn until rated/dismissed, then collapse to
  // an edit affordance. `feedbackEditing` force-opens the panel for a turn.
  const [feedbackDismissed, setFeedbackDismissed] = useState<Set<string>>(
    new Set()
  );
  const [feedbackEditing, setFeedbackEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [savedAssets, setSavedAssets] = useState<Set<string>>(new Set());
  // Pin-as-active in flight (optimistic; see pinVersion).
  const [pinning, startPinning] = useTransition();
  // Ghost-overlay compare: viewed (older) revision at ~35% opacity on top
  // of the thread's latest model. Reset whenever the viewed asset changes.
  const [compareOn, setCompareOn] = useState(false);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotations, setAnnotations] = useState<StudioAnnotation[]>([]);
  // Per-generation B-rep topology URL for EXACT viewer picking (MTR-174):
  // fetched lazily for the viewed single-solid turn. A stored `null` means
  // "confirmed no topology" (mesh-mode / legacy) so we never refetch and the
  // viewer stays on its flood-fill fallback.
  const [topoUrls, setTopoUrls] = useState<Record<string, string | null>>({});
  // The submitted prompt, held for the life of a generation so it can ride in
  // the RIGHT-aligned "sent" bubble of the morphing generation thread (MTR-209)
  // while the composer empties. Restored into the composer on error so a failed
  // build never loses the user's typed instruction.
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  // Respect the OS "reduce motion" setting: the morph sequence collapses to
  // instant opacity swaps instead of layout/spring animation (Accessibility).
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Outer fixed wrapper of the floating composer — its `bottom` is rewritten
  // from the VisualViewport API so the composer stays pinned above the iOS
  // keyboard instead of hiding behind it (MTR-211).
  const composerFixedRef = useRef<HTMLDivElement>(null);
  useKeyboardStickyBottom(composerFixedRef, 0);
  const abortRef = useRef<AbortController | null>(null);
  // In-flight silent spec-check (fetchBrief) — aborted on thread switch /
  // new-build so a slow check can't pop a stale quick-check card.
  const briefAbortRef = useRef<AbortController | null>(null);
  // The in-flight background job (persisted to the resume slot). Only
  // cleared when the job reaches a terminal event or the user explicitly
  // abandons it — NOT on unmount, so a reload/return can reattach.
  const jobRef = useRef<StoredJob | null>(null);

  // Close an open events stream if the studio unmounts. The background job
  // keeps running server-side; the resume slot reattaches on return.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Persist the current selection for resume-on-return. Refs hold the latest
  // values so the leave-time writers (unmount / pagehide) don't capture stale
  // state from their setup-time closure.
  const activeRootIdRef = useRef(activeRootId);
  activeRootIdRef.current = activeRootId;
  const viewTurnIdRef = useRef(viewTurnId);
  viewTurnIdRef.current = viewTurnId;
  const persistResume = useCallback(() => {
    try {
      window.sessionStorage.setItem(
        RESUME_STORAGE_KEY,
        JSON.stringify({
          rootId: activeRootIdRef.current,
          viewTurnId: viewTurnIdRef.current,
          ts: Date.now(),
          job: jobRef.current,
        } satisfies ResumeState)
      );
    } catch {
      // sessionStorage can throw (private mode / quota); resume is best-effort.
    }
  }, []);
  // Stamp on every selection change (so a quick return restores it) and again
  // when leaving — SPA nav (cleanup), full reload/close (pagehide), or tab hide
  // — so the grace window measures time-away, not time-since-last-click.
  useEffect(() => {
    persistResume();
    const onHide = () => {
      if (document.visibilityState === "hidden") persistResume();
    };
    window.addEventListener("pagehide", persistResume);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", persistResume);
      document.removeEventListener("visibilitychange", onHide);
      persistResume();
    };
  }, [activeRootId, viewTurnId, persistResume]);

  // Reattach on return: if a background job from a previous visit is stored,
  // tail its events stream — replay + live tail means an already-finished
  // job resolves instantly and a running one keeps streaming (MTR-175).
  useEffect(() => {
    const saved = readStoredJob();
    if (!saved) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    jobRef.current = saved;
    if (saved.rootId) setActiveRootId(saved.rootId);
    setProgress([]);
    setSnapshot(null);
    setError(null);
    // Repopulate the "sent" bubble so a reattached build shows its prompt in
    // the morphing thread (the composer text itself was never persisted).
    setSubmittedPrompt(saved.prompt || null);
    setGenerating(true);
    void streamJobEvents(
      saved.jobId,
      controller,
      saved.prompt,
      saved.parentId ?? undefined
    )
      .then((terminal) => {
        // Keep the stored job on a non-terminal drop (unmount / lost
        // connection) so the next visit can reattach again.
        if (terminal) {
          jobRef.current = null;
          persistResume();
        }
      })
      .finally(() => setGenerating(false));
    // Mount-only by design: reattach exactly once per studio mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the build three-dot menu on any outside click.
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  // Close the mobile Builds dropdown on any outside click (the trigger and
  // the panel stopPropagation so their own clicks don't immediately close it).
  useEffect(() => {
    if (!showBuildsMenu) return;
    const close = () => setShowBuildsMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showBuildsMenu]);

  // Once the morph finishes and the model is mounted underneath, give it a
  // beat to load, then clear the transition (unmounts the faded-out blob).
  useEffect(() => {
    if (transition?.phase !== "reveal") return;
    const t = setTimeout(() => setTransition(null), 550);
    return () => clearTimeout(t);
  }, [transition]);

  // Auto-grow the composer textarea with its content (capped), and shrink
  // back when it's cleared after a send.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  const activeThread = threads.find((t) => t.rootId === activeRootId) ?? null;
  // Memoized (not just `?? []`) so the param-diff useMemo below only
  // recomputes when the active thread's turns actually change.
  const turns = useMemo(() => activeThread?.turns ?? [], [activeThread]);
  const latestTurn = turns[turns.length - 1] ?? null;

  // The most recent successful turn — the thread's "latest" model, used as
  // the viewer fallback and as the solid side of the compare overlay.
  const latestGoodTurn =
    [...turns]
      .reverse()
      .find((t) => t.status === "succeeded" && t.fileAssetId) ?? null;

  // Which turn's model fills the viewer: the explicitly selected one, else the
  // most recent successful turn in the active thread.
  const viewedTurn =
    (viewTurnId
      ? turns.find((t) => t.id === viewTurnId && t.fileAssetId)
      : null) ?? latestGoodTurn;

  // For an assembly, the viewer/print/download act on the selected part; for a
  // single solid (or a stale selection) fall back to the turn's primary asset.
  const viewedParts = viewedTurn?.parts ?? [];
  // A revision mints parts with NEW fileAssetIds, so a `selectedPartId` held
  // over from the previous turn no longer matches any part. Left unguarded that
  // made the assembly viewer render every part with `visible=false` → a blank
  // canvas (MTR-188 item 3: "a revision leaves the viewer blank / pointing at a
  // stale part"). Resolve the selection against the CURRENT parts and treat a
  // non-match as "All parts".
  const effectiveSelectedPartId =
    viewedParts.find((p) => p.fileAssetId === selectedPartId)?.fileAssetId ??
    null;
  const activeAssetId = effectiveSelectedPartId ?? viewedTurn?.fileAssetId ?? null;

  // Clear a stale isolation when the viewed turn changes (revision or history
  // navigation) so the part tabs highlight "All parts", matching the guard
  // above. Switching parts within a turn keeps the same turn id → no reset.
  useEffect(() => {
    setSelectedPartId(null);
  }, [viewedTurn?.id]);

  // Annotations are tied to a specific model — drop them (and exit pin mode)
  // whenever the viewed asset changes (new turn, switched part, opened build).
  // The compare overlay is likewise per-selection.
  useEffect(() => {
    setAnnotations([]);
    setAnnotateMode(false);
    setCompareOn(false);
  }, [activeAssetId]);

  // Lazily resolve the viewed build's B-rep topology sidecar so the viewer
  // picks faces/edges by EXACT CAD identity (MTR-174: binary-search triRange →
  // face; real smooth-tangent edge polylines) instead of mesh flood-fill.
  // Single-solid path only — assemblies render via assemblyParts and keep the
  // flood-fill fallback. Cached per generation; a null (mesh-mode / legacy) is
  // remembered so we never refetch and never thread a dead URL.
  useEffect(() => {
    const turn = viewedTurn;
    if (!turn || turn.status !== "succeeded") return;
    if ((turn.parts?.length ?? 0) > 1) return;
    if (turn.id in topoUrls) return;
    let active = true;
    void getCadTopoUrl({ generationId: turn.id })
      .then((res) => {
        if (!active) return;
        setTopoUrls((prev) => ({
          ...prev,
          [turn.id]: "url" in res ? res.url : null,
        }));
      })
      .catch(() => {
        if (active) setTopoUrls((prev) => ({ ...prev, [turn.id]: null }));
      });
    return () => {
      active = false;
    };
  }, [viewedTurn, topoUrls]);

  // Pinned version (docs/text-to-cad/05 §D item 2): which generation the
  // thread currently "is". Only DB-backed threads (threadId present) can
  // pin; legacy groups and just-created in-session threads gain the
  // affordance after a reload.
  const pinnedTurnId = activeThread?.activeGenerationId ?? null;
  const canPinVersions = !!activeThread?.threadId;

  function pinVersion(turn: StudioTurn) {
    if (!activeThread?.threadId || pinning || turn.id === pinnedTurnId) return;
    const rootId = activeThread.rootId;
    const prevPinned = pinnedTurnId;
    // Optimistic: badge moves immediately, rolls back on error.
    setThreads((prev) =>
      prev.map((t) =>
        t.rootId === rootId ? { ...t, activeGenerationId: turn.id } : t
      )
    );
    startPinning(async () => {
      const res = await setActiveCadVersion({ generationId: turn.id });
      if ("error" in res) {
        setError(res.error);
        setThreads((prev) =>
          prev.map((t) =>
            t.rootId === rootId ? { ...t, activeGenerationId: prevPinned } : t
          )
        );
      }
    });
  }

  // Parametric diff per revision against its parent (docs/text-to-cad/05
  // §D item 4): up to 3 changed top-level parameters as a one-line summary
  // under the revision row. Parent = the turn parentGenerationId points at,
  // falling back to the preceding turn for rows that predate the column.
  const paramDiffSummaries = useMemo(() => {
    const byId = new Map(turns.map((t) => [t.id, t]));
    const out = new Map<string, string>();
    turns.forEach((t, i) => {
      if (!t.sourceCode) return;
      const parent =
        (t.parentGenerationId ? byId.get(t.parentGenerationId) : undefined) ??
        (i > 0 ? turns[i - 1] : undefined);
      if (!parent?.sourceCode) return;
      const summary = paramDiffSummary(parent.sourceCode, t.sourceCode);
      if (summary) out.set(t.id, summary);
    });
    return out;
  }, [turns]);

  // Ghost-overlay compare (docs/text-to-cad/05 §D item 3): while viewing an
  // older revision, overlay it (translucent) on the thread's latest model.
  // Both render through the same deterministic fixed frame, so they align.
  const compareBaseAssetId =
    compareOn &&
    viewedTurn &&
    latestGoodTurn?.fileAssetId &&
    viewedTurn.id !== latestGoodTurn.id
      ? latestGoodTurn.fileAssetId
      : null;
  const compareAvailable =
    !!viewedTurn &&
    !!latestGoodTurn?.fileAssetId &&
    viewedTurn.id !== latestGoodTurn.id &&
    !!activeAssetId;

  // A pin that points somewhere other than the latest turn is worth calling
  // out on Save (the pinned version is what the design "is").
  const pinnedDiffersFromLatest =
    !!pinnedTurnId && !!latestGoodTurn && pinnedTurnId !== latestGoodTurn.id;

  // Exact-picking topology for the viewer (MTR-174): only for the viewed
  // single-solid build and never in compare mode (the solid layer there is a
  // DIFFERENT generation than the viewed one, so its topology wouldn't match).
  const viewerTopoUrl =
    !compareBaseAssetId && viewedParts.length <= 1 && viewedTurn
      ? topoUrls[viewedTurn.id] ?? undefined
      : undefined;

  function startNewBuild() {
    // Abandoning an in-flight build is an explicit cancel: close the events
    // stream AND ask the server to stop the job (fire-and-forget — the row
    // flips to cancelled once the worker's poll notices).
    const job = jobRef.current;
    if (job) {
      void fetch(`/api/cad/jobs/${job.jobId}/cancel`, { method: "POST" }).catch(
        () => undefined
      );
      jobRef.current = null;
    }
    abortRef.current?.abort();
    briefAbortRef.current?.abort();
    setGenerating(false);
    setTransition(null);
    setSourceAssetId(null);
    setActiveRootId(null);
    setViewTurnId(null);
    setProgress([]);
    setPendingQuestion(null);
    setSnapshot(null);
    setBrief(null);
    setBriefLoading(false);
    setError(null);
    setPrompt("");
    setSubmittedPrompt(null);
    setImages([]);
    setSelectedPartId(null);
    setShowHistory(false);
    setShowBuildsMenu(false);
    setRenaming(false);
  }

  function openThread(t: StudioThread) {
    if (generating) return;
    briefAbortRef.current?.abort();
    setTransition(null);
    setSourceAssetId(null);
    setActiveRootId(t.rootId);
    const lastGood = [...t.turns]
      .reverse()
      .find((x) => x.status === "succeeded" && x.fileAssetId);
    setViewTurnId(lastGood?.id ?? null);
    setProgress([]);
    setSnapshot(null);
    setBrief(null);
    setBriefLoading(false);
    setError(null);
    setSelectedPartId(null);
    setShowHistory(false);
    setRenaming(false);
  }

  // Delete a build (root + revisions) from history. Optimistic; if it was the
  // open build, reset to a blank canvas.
  async function deleteBuild(t: StudioThread) {
    setOpenMenuId(null);
    const ids = t.turns.map((x) => x.id);
    setThreads((prev) => prev.filter((x) => x.rootId !== t.rootId));
    if (activeRootId === t.rootId) startNewBuild();
    const res = await deleteCadBuild({ generationIds: ids });
    if ("error" in res) setError(res.error);
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (!activeThread || !viewedTurn?.fileAssetId || next.length < 1) {
      setRenaming(false);
      return;
    }
    if (next === threadLabel(activeThread)) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    const res = await renameCadGeneration({
      fileAssetId: viewedTurn.fileAssetId,
      name: next,
    });
    setSavingName(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    const root = activeRootId;
    setThreads((prev) =>
      prev.map((t) => (t.rootId === root ? { ...t, title: res.name } : t))
    );
    setRenaming(false);
  }

  async function saveToProfile() {
    if (!activeAssetId || savingModel || savedAssets.has(activeAssetId)) return;
    const assetId = activeAssetId;
    setSavingModel(true);
    const res = await saveCadFileToProfile({ fileAssetId: assetId });
    setSavingModel(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setSavedAssets((prev) => new Set(prev).add(assetId));
  }

  // Download every part of an assembly as a single .zip of STLs (MTR-44). The
  // parts are individually printable files; a creator wants them all in one
  // grab. Zipped client-side (fflate, store-only — STL is already large binary,
  // so compression buys little and costs CPU) from the same-origin preview
  // endpoint that backs the single-part download.
  async function downloadAssemblyZip() {
    if (viewedParts.length < 2) return;
    try {
      const entries: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      await Promise.all(
        viewedParts.map(async (p) => {
          const res = await fetch(`/api/files/preview/${p.fileAssetId}`);
          if (!res.ok) throw new Error(`part ${p.name} ${res.status}`);
          const buf = new Uint8Array(await res.arrayBuffer());
          const base = safeFileStem(p.name) || "part";
          let name = `${base}.stl`;
          let i = 2;
          // Distinct filenames so two equally-named parts both land in the zip.
          while (used.has(name)) name = `${base}-${i++}.stl`;
          used.add(name);
          entries[name] = buf;
        })
      );
      const zipped = zipSync(entries, { level: 0 });
      const label = activeThread ? threadLabel(activeThread) : "assembly";
      // fflate returns a fresh Uint8Array over a fresh buffer; hand its buffer
      // to Blob (the Uint8Array<ArrayBufferLike> generic doesn't satisfy the
      // stricter BlobPart type directly).
      triggerBlobDownload(
        new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }),
        `${safeFileStem(label) || "assembly"}.zip`
      );
    } catch {
      setError("Could not prepare the download. Please try again.");
    }
  }

  // Reflect a saved feedback edit into the in-memory threads so the panel
  // and history stay consistent without a refetch.
  function applyFeedback(
    turnId: string,
    patch: Pick<StudioTurn, "rating" | "feedbackTags" | "feedbackNote">
  ) {
    setThreads((prev) =>
      prev.map((t) => ({
        ...t,
        turns: t.turns.map((x) => (x.id === turnId ? { ...x, ...patch } : x)),
      }))
    );
  }

  function applyDone(
    ev: Extract<CadStreamEvent, { type: "done" }>,
    submittedPrompt: string,
    parentId: string | undefined
  ) {
    const newTurn: StudioTurn = {
      id: ev.generationId,
      prompt: submittedPrompt,
      status: "succeeded",
      renderUrl: ev.renderUrl,
      fileAssetId: ev.fileAssetId,
      sourceCode: ev.sourceCode,
      error: null,
      rating: null,
      feedbackTags: [],
      feedbackNote: null,
      parts: ev.parts ?? [],
      projectSlug: ev.projectSlug ?? null,
      remeshed: ev.remeshed ?? false,
      // STEP presence rides the done event so the action row is stable at first
      // paint (MTR-215).
      hasStep: ev.hasStep ?? false,
      parentGenerationId: parentId ?? null,
    };
    const now = Date.now();

    if (parentId) {
      // Revision: append to the active thread. Read the root id from the
      // ref (not the closure) so a stream resumed after a remount still
      // lands on the right thread; skip if a replayed `done` already did.
      // The server re-points activeGenerationId at every new success
      // (persistGenerationSuccess), so mirror that for the pin badge.
      const rootId = activeRootIdRef.current;
      setThreads((prev) =>
        prev
          .map((t) =>
            t.rootId === rootId && !t.turns.some((x) => x.id === newTurn.id)
              ? {
                  ...t,
                  turns: [...t.turns, newTurn],
                  lastActivity: now,
                  activeGenerationId: newTurn.id,
                }
              : t
          )
          .sort((a, b) => b.lastActivity - a.lastActivity)
      );
    } else {
      // New build: open a fresh thread — unless a resumed job replayed a
      // `done` the server page already rendered into initialThreads.
      const thread: StudioThread = {
        rootId: ev.generationId,
        title: ev.title,
        lastActivity: now,
        turns: [newTurn],
      };
      setThreads((prev) =>
        prev.some((t) => t.rootId === ev.generationId)
          ? prev
          : [thread, ...prev]
      );
      setActiveRootId(ev.generationId);
    }
    setViewTurnId(ev.generationId);
    // Kick off the loader→model morph (the blob is still on screen here; it
    // morphs into this asset, then we crossfade to the real viewer). No asset
    // means nothing to morph into — fall straight through to the empty state.
    setTransition(ev.fileAssetId ? { assetId: ev.fileAssetId, phase: "morph" } : null);
    // Clear the composer only now that the turn landed — on an error the
    // user's typed instruction (and any attached refs) stay put to retry.
    // The brief card clears with it (same lifecycle: kept around to retry).
    setPrompt("");
    setImages([]);
    setBrief(null);
  }

  async function addFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    const incoming = Array.from(files).filter((f) =>
      ALLOWED_IMAGE_TYPES.includes(f.type as ImageMediaType)
    );
    for (const f of incoming) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      const comma = dataUrl.indexOf(",");
      const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      setImages((prev) =>
        prev.length >= MAX_IMAGES
          ? prev
          : [
              ...prev,
              {
                id: crypto.randomUUID(),
                dataUrl,
                data,
                mediaType: f.type as ImageMediaType,
              },
            ]
      );
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  /**
   * The brief is MACHINERY, not UI (MTR-194 pattern revision): it still
   * grounds dimensions and feeds the generate prompt, but the user never
   * reviews a form. This fetches it silently before a fresh build; the ONLY
   * thing that ever surfaces is `questions` — a genuine fork the prompt
   * didn't settle, asked as tappable choices. Null on any failure: a brief
   * must never block or degrade a generation.
   */
  async function fetchBrief(text: string): Promise<CadBrief | null> {
    const controller = new AbortController();
    briefAbortRef.current?.abort();
    briefAbortRef.current = controller;
    setBriefLoading(true);
    try {
      const res = await fetch("/api/cad/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          images: images.length
            ? images.map((i) => ({ data: i.data, mediaType: i.mediaType }))
            : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const { brief: drafted } = (await res.json()) as {
        brief: CadBrief | null;
      };
      return drafted;
    } catch {
      return null;
    } finally {
      if (briefAbortRef.current === controller) setBriefLoading(false);
    }
  }

  async function submit() {
    const text = prompt.trim();
    if (text.length < 3 || generating || briefLoading) return;

    const parentId = latestTurn?.id; // revise the latest turn when in a thread

    // Ask-before-build (MTR-191 ask-site a): fresh builds run the silent
    // brief step first. Questions pause the flow ONCE with choice chips;
    // no questions (or no brief) goes straight to generation. A brief
    // already in state means the user answered/skipped — build with it.
    let briefToSend = !parentId ? brief : null;
    if (!parentId && !brief) {
      const drafted = await fetchBrief(text);
      if (drafted?.questions?.length) {
        setBrief(drafted); // renders the quick-check card; user resumes
        return;
      }
      briefToSend = drafted;
      if (drafted) setBrief(drafted);
    }

    // Fold pinned annotations into the instruction sent to the agent, as
    // structured spatial feedback (the displayed turn keeps the clean text).
    const fmt = (p: readonly number[]) => p.map((n) => n.toFixed(1)).join(", ");
    const annoBlock = annotations.length
      ? "\n\nAnnotated selections on the current model (mm, model coordinates):\n" +
        annotations
          .map((a, i) => {
            const note = a.note.trim();
            // Part name (assemblies, MTR-188) + semantic CAD handle when B-rep
            // topology is present (MTR-174): "cylinder r=2.7, axis Z". The mm
            // coordinates stay as a fallback channel so a code model without a
            // clean topology signal still has something to reason from.
            const partPrefix = a.partName ? `on part '${a.partName}', ` : "";
            if (a.kind === "edge") {
              const semantic = a.topo ? `${a.topo.description} — ` : "";
              return `#${i + 1} — ${partPrefix}${semantic}edge from (${fmt(
                a.edge.a
              )}) to (${fmt(a.edge.b)}), length ${a.edge.length.toFixed(
                1
              )} mm: ${note || "(address this edge)"}`;
            }
            const sz = a.extent.some((n) => n > 0)
              ? `, ~${a.extent.map((n) => n.toFixed(0)).join("×")} mm`
              : "";
            const semantic = a.topo ? `${a.topo.description} — ` : "";
            return `#${i + 1} — ${partPrefix}${semantic}face centered at (${fmt(
              a.point
            )})${sz}, normal (${a.normal
              .map((n) => n.toFixed(2))
              .join(", ")}): ${note || "(address this face)"}`;
          })
          .join("\n")
      : "";
    const sentPrompt = text + annoBlock;

    setError(null);
    setProgress([]);
    setSnapshot(null);
    // A revision deforms the model currently on screen (edit-in-place); a fresh
    // build has none, so the wireframe blob deforms instead.
    setSourceAssetId(parentId ? activeAssetId : null);
    setTransition(null);
    // Morph the composer into the "sent" bubble: stash the prompt for the
    // thread and empty the composer (MTR-209). Restored on any error path below
    // so a failed build doesn't swallow what the user typed.
    setSubmittedPrompt(text);
    setPrompt("");
    setGenerating(true);
    setShowHistory(false);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/cad/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sentPrompt,
          parentGenerationId: parentId,
          // Revisions inherit the build's current name; new builds get an
          // agent-written one server-side.
          name: parentId && activeThread ? threadLabel(activeThread) : undefined,
          images: images.length
            ? images.map((i) => ({ data: i.data, mediaType: i.mediaType }))
            : undefined,
          // The silently-drafted brief (with any answered questions folded
          // into `decisions`). Fresh builds only — the server ignores it on
          // revisions anyway.
          brief: briefToSend ?? undefined,
          // Target-process threading (MTR-171) stays supported by the route but
          // is no longer asked up-front in the composer (MTR-208): the signal
          // will later be auto-derived from a material/print selection.
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setError((await res.text()) || "Generation failed.");
        // Restore the composer so the user can retry (the thread unwinds).
        setPrompt(text);
        setSubmittedPrompt(null);
        return;
      }

      // The generate route now returns a background job (MTR-175); progress
      // streams from the job's events endpoint, which survives reloads.
      const { generationId, jobId } = (await res.json()) as {
        generationId: string;
        jobId: string;
      };
      jobRef.current = {
        jobId,
        generationId,
        prompt: text,
        parentId: parentId ?? null,
        rootId: parentId ? activeRootId : generationId,
      };
      persistResume();

      const terminal = await streamJobEvents(jobId, controller, text, parentId);
      // Keep the stored job on a non-terminal drop (unmount / lost
      // connection) so the next visit can reattach.
      if (terminal) {
        jobRef.current = null;
        persistResume();
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError("Generation failed. Please try again.");
        setPrompt(text);
        setSubmittedPrompt(null);
      }
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Tail a background job's SSE stream (replay + live), applying events
   * exactly as the old in-request stream did. Returns true once a terminal
   * event (`done`/`error`) arrived. On a drop WITHOUT one (proxy timeout,
   * flaky network, the route's own ceiling) the job keeps running server-
   * side, so retry the events URL up to 3 times with a 2s backoff.
   */
  async function streamJobEvents(
    jobId: string,
    controller: AbortController,
    submittedPrompt: string,
    parentId: string | undefined
  ): Promise<boolean> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; ; attempt++) {
      let sawTerminal = false;
      try {
        const res = await fetch(`/api/cad/jobs/${jobId}/events`, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let ev: CadStreamEvent;
            try {
              ev = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (ev.type === "done") {
              sawTerminal = true;
              // Clear the live preview BEFORE the transition state lands so
              // the blob→model morph hand-off runs exactly as before.
              setSnapshot(null);
              setPendingQuestion(null);
              applyDone(ev, submittedPrompt, parentId);
            } else if (ev.type === "error") {
              sawTerminal = true;
              setSnapshot(null);
              setPendingQuestion(null);
              setError(ev.error);
              // Return the typed instruction to the composer so a failed build
              // can be retried; the morphing thread unwinds to rest.
              setPrompt(submittedPrompt);
              setSubmittedPrompt(null);
            } else if (ev.type === "snapshot") {
              // Live build preview: latest frame only — REPLACE, never
              // accumulate (each frame is a whole base64 PNG; the progress
              // transcript must stay light).
              setSnapshot({ render: ev.render, step: ev.step });
            } else if (ev.type === "question") {
              // Mid-cycle question (MTR-191): the job suspended awaiting a pick.
              // Replay-safe — reattaching mid-question re-emits this and we just
              // re-open the same card (the answer merge on the server is
              // idempotent). Never clobber an in-flight answer for the same id.
              setPendingQuestion((cur) =>
                cur && cur.questionId === ev.questionId && cur.answering
                  ? cur
                  : {
                      jobId,
                      questionId: ev.questionId,
                      text: ev.text,
                      options: ev.options,
                      defaultOptionId: ev.defaultOptionId,
                      timeoutS: ev.timeoutS,
                      answering: false,
                    }
              );
            } else if (ev.type === "answer") {
              // Resolution arrived (user pick or server default on timeout) —
              // close the card and note the decision in the transcript.
              setPendingQuestion((cur) =>
                cur && cur.questionId === ev.questionId ? null : cur
              );
              setProgress((p) => [...p, ev]);
            } else {
              setProgress((p) => [...p, ev]);
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return sawTerminal;
      }
      if (sawTerminal || controller.signal.aborted) return sawTerminal;
      if (attempt >= MAX_RETRIES) {
        setError(
          "Lost the connection to this build — it may still be running. Reload to check."
        );
        return false;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /**
   * Answer a mid-cycle question (MTR-191): POST the pick to the job, then let
   * the still-open events stream carry the resolving `answer` event that
   * closes the card. We optimistically flip `answering` (not clear) so the
   * chips lock but the card stays until the server confirms — a failed POST
   * re-enables it to retry. The SSE tail is untouched; the executor's poll
   * picks the answer up and resumes the build.
   */
  async function answerQuestion(pick: { optionId?: string; text?: string }) {
    const q = pendingQuestion;
    if (!q || q.answering) return;
    // A preset card sends `optionId`; the always-present custom field sends
    // `text` (MTR-209). Guard against an empty custom submit.
    const customText = pick.text?.trim();
    if (!pick.optionId && !customText) return;
    setPendingQuestion({ ...q, answering: true });
    try {
      const res = await fetch(`/api/cad/jobs/${q.jobId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pick.optionId
            ? { questionId: q.questionId, optionId: pick.optionId }
            : { questionId: q.questionId, text: customText }
        ),
      });
      if (!res.ok) throw new Error(`answer ${res.status}`);
      // Leave the card in place (answering=true) — the `answer` event clears
      // it. If the stream already dropped, the reconnect replays that event.
    } catch {
      // Let the user retry; the question is still live server-side.
      setPendingQuestion((cur) =>
        cur && cur.questionId === q.questionId
          ? { ...cur, answering: false }
          : cur
      );
    }
  }

  // Viewer layering. Exactly ONE of the two renders while work is in flight:
  // the transition canvas (deforming loader / morph) OWNS the frame during
  // generating + morph, then fades out on reveal as the crisp model takes over.
  // Showing the crisp model underneath a deforming overlay made the wobbling
  // silhouette reveal the static model at its edges — a ghost "second copy".
  const showTransition = generating || transition !== null;
  const showModel =
    !!activeAssetId &&
    (!showTransition || transition?.phase === "reveal");

  const composerLabel = generating
    ? "Generating…"
    : activeThread
      ? "Revise"
      : "Generate";

  return (
    <div className="relative min-h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-60 pt-6 lg:h-full lg:min-h-0 lg:pb-0 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-36">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {activeThread && !generating && viewedTurn?.fileAssetId ? (
                renaming ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      value={nameDraft}
                      autoFocus
                      maxLength={60}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                      className="w-56 rounded-md border border-foreground/20 bg-card px-2 py-1 text-sm outline-none focus:border-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={saveName}
                      disabled={savingName}
                      className="cursor-pointer rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                    >
                      {savingName ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="cursor-pointer rounded-lg border border-foreground/15 px-3 py-1.5 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(threadLabel(activeThread));
                      setRenaming(true);
                    }}
                    className="group inline-flex max-w-full cursor-pointer items-center gap-2 font-heading text-xl font-normal tracking-tight text-foreground"
                    title="Rename build"
                  >
                    <span className="truncate">{threadLabel(activeThread)}</span>
                    <PencilIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )
              ) : activeThread ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {threadLabel(activeThread)}
                </p>
              ) : (
                // Empty state: just the heading, matching the post-generation
                // build title's size/font so the page doesn't visibly shift.
                <h1 className="mt-1 font-heading text-xl font-normal tracking-tight text-foreground">
                  New Build
                </h1>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Owner-only debug affordances (MTR-208): the whole studio is
                  owner-gated, so these links are inherently owner-only. The
                  eval scorecard had NO link from anywhere before this. */}
              <Link
                href="/prometheus/eval"
                title="Harness scorecard"
                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/15 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <ClipboardListIcon className="size-3.5" />
                <span className="hidden lg:inline">Scorecard</span>
              </Link>
              <Link
                href="/prometheus/exemplars"
                title="Verified exemplars (debug)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/15 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <Layers className="size-3.5" />
                <span className="hidden lg:inline">Exemplars</span>
              </Link>
              {/* Builds history — mobile only; pops a scrollable dropdown down
                  from this icon. At lg+ the Builds sidebar block takes over. */}
              <div className="relative lg:hidden">
                <button
                  type="button"
                  aria-label="Builds history"
                  title="Builds history"
                  aria-expanded={showBuildsMenu}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(null);
                    setShowBuildsMenu((v) => !v);
                  }}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-foreground/15 hover:bg-foreground/5"
                >
                  <HistoryIcon className="size-4" />
                </button>
                {showBuildsMenu && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-foreground/15 bg-card p-2 shadow-xl"
                  >
                    <div className="mb-1.5 flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                      <ClockRewind className="size-4 shrink-0" />
                      <span>Builds ({threads.length})</span>
                    </div>
                    <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-0.5 py-1">
                      <BuildsList
                        threads={threads}
                        activeRootId={activeRootId}
                        openMenuId={openMenuId}
                        onOpenThread={(t) => {
                          openThread(t);
                          setShowBuildsMenu(false);
                        }}
                        onToggleMenu={(id) =>
                          setOpenMenuId((m) => (m === id ? null : id))
                        }
                        onDelete={(t) => {
                          deleteBuild(t);
                          setShowBuildsMenu(false);
                        }}
                      />
                    </ul>
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={startNewBuild}
                aria-label="New build"
                title="New build"
                className="shrink-0 rounded-lg px-2.5 lg:px-3"
              >
                <PlusIcon className="size-4" />
                <span className="hidden lg:inline">New build</span>
              </Button>
            </div>
          </div>

          {/* Viewer / progress / empty state */}
          <div className="mt-5 overflow-hidden rounded-xl border border-foreground/10">
            <div className="relative aspect-[4/3] w-full bg-muted/30 lg:aspect-auto lg:h-[clamp(260px,46vh,520px)]">
              {/* Crisp model — the BASE layer (fixed frame). Stays mounted
                  under the transition so the morph fades to reveal it with no
                  remount/zoom; on a revision it's the shape being deformed. */}
              {showModel && activeAssetId && (
                <Suspense fallback={<ViewerSkeleton label="Loading model…" />}>
                  {/* Compare mode swaps the solid model for the thread's
                      latest and ghosts the viewed (older) revision on top;
                      both land in the same deterministic fixed frame.
                      Assemblies (MTR-174) render every part in assembly
                      position in ONE shared frame; part tabs below isolate
                      by hiding the others — the key stays per-turn so
                      switching tabs never remounts/reframes the canvas. */}
                  <ModelViewer
                    key={
                      compareBaseAssetId
                        ? `${compareBaseAssetId}::${activeAssetId}`
                        : viewedParts.length > 1
                          ? `asm::${viewedTurn?.fileAssetId}`
                          : activeAssetId
                    }
                    assemblyParts={
                      viewedParts.length > 1 && !compareBaseAssetId
                        ? viewedParts.map((p) => ({
                            url: `/api/files/preview/${p.fileAssetId}`,
                            name: p.name,
                            visible:
                              selectedPartId === null ||
                              p.fileAssetId === selectedPartId,
                          }))
                        : undefined
                    }
                    modelUrl={`/api/files/preview/${
                      compareBaseAssetId ?? activeAssetId
                    }`}
                    topoUrl={viewerTopoUrl}
                    ghostUrl={
                      compareBaseAssetId
                        ? `/api/files/preview/${activeAssetId}`
                        : undefined
                    }
                    format="stl"
                    mode="detail"
                    showZoomControls
                    inspect
                    fixedFrame
                    annotateMode={annotateMode}
                    onToggleAnnotate={() => setAnnotateMode((v) => !v)}
                    annotations={annotations}
                    onAnnotate={(a) =>
                      setAnnotations((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), ...a },
                      ])
                    }
                    className="absolute inset-0 h-full w-full"
                  />
                </Suspense>
              )}

              {/* Transition overlay — deforming loader (blob for a fresh build,
                  the previous solid model for a revision) → morph into the new
                  shape. Same frame as the model layer; fades out on reveal. */}
              {showTransition && (
                <div
                  className={`absolute inset-0 transition-opacity duration-500 ${
                    transition?.phase === "reveal" ? "opacity-0" : "opacity-100"
                  }`}
                >
                  <Suspense fallback={<div className="h-full w-full" />}>
                    <MaterializingBlob
                      className="h-full w-full"
                      active
                      sourceUrl={
                        sourceAssetId
                          ? `/api/files/preview/${sourceAssetId}`
                          : null
                      }
                      morphUrl={
                        transition
                          ? `/api/files/preview/${transition.assetId}`
                          : null
                      }
                      onMorphComplete={() =>
                        setTransition((t) =>
                          t ? { ...t, phase: "reveal" } : null
                        )
                      }
                    />
                  </Suspense>
                  {generating && !transition && snapshot && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
                      {/* Live build preview — the latest snapshot render of the
                          in-progress solid, cross-fading as frames land. Status
                          + the interactive question now live in the morphing
                          generation thread above the composer (MTR-209); the
                          particle cloud is the visual backdrop here (MTR-210). */}
                      <SnapshotPreview
                        render={snapshot.render}
                        step={snapshot.step}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Empty state — no model, nothing generating. */}
              {!showTransition && !showModel && (
                <div className="flex h-full w-full flex-col">
                  <Suspense fallback={<div className="min-h-0 flex-1" />}>
                    <MaterializingBlob className="min-h-0 flex-1" />
                  </Suspense>
                  {activeThread && (
                    <p className="shrink-0 px-6 pb-8 text-center text-sm text-muted-foreground">
                      No printable model in this build yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Prompt-first empty state (MTR-208): a few human-written example
              prompts as plain chips. Tapping one prefills the composer and
              focuses it — a starting point to edit, not an exemplar to build. */}
          {!activeThread && !generating && !showTransition && (
            <div className="mt-5">
              <p className="mb-2 text-xs text-muted-foreground">
                Not sure where to start? Try one of these:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setPrompt(ex);
                      requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(el.value.length, el.value.length);
                        }
                      });
                    }}
                    className="cursor-pointer rounded-full border border-foreground/15 bg-foreground/5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assembly view tabs (MTR-174): default = every part in assembly
              position; a part tab isolates it by hiding the others (same
              frame — no recenter). Print/Download/Save follow the selection
              (primary part while viewing All). */}
          {!generating && viewedParts.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPartId(null)}
                aria-pressed={selectedPartId === null}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selectedPartId === null
                    ? "border-foreground/30 bg-foreground/5 text-foreground"
                    : "border-foreground/10 text-muted-foreground hover:bg-foreground/5"
                }`}
              >
                All parts
              </button>
              {viewedParts.map((p) => {
                const isActive = p.fileAssetId === selectedPartId;
                return (
                  <button
                    key={p.fileAssetId}
                    type="button"
                    onClick={() => setSelectedPartId(p.fileAssetId)}
                    aria-pressed={isActive}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      isActive
                        ? "border-foreground/30 bg-foreground/5 text-foreground"
                        : "border-foreground/10 text-muted-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Compare with latest — only while viewing an older revision.
              On: the latest model renders solid with this revision ghosted
              over it at ~35% opacity (same fixed frame, so they align). */}
          {!generating && compareAvailable && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={compareOn}
                onClick={() => setCompareOn((v) => !v)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                  compareOn
                    ? "border-foreground/30 bg-foreground/5 text-foreground"
                    : "border-foreground/10 text-muted-foreground hover:bg-foreground/5"
                }`}
              >
                Compare with latest
              </button>
              {compareOn && (
                <span className="text-xs text-muted-foreground">
                  Latest solid · this revision ghosted
                </span>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Approximation notice — the result came from the voxel-remesh
              fallback (organic/complex shape repair couldn't close). */}
          {!generating && viewedTurn?.remeshed && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangleIcon className="size-4 shrink-0" />
              Approximated — this complex shape was re-meshed to be printable, so
              fine detail and exact dimensions may differ.
            </p>
          )}

          {/* Feedback — the in-the-moment eval signal (feeds /text-to-cad/eval).
              Sits ABOVE the actions; auto-prompts after each generation until
              rated or dismissed, then collapses to a small edit affordance. */}
          {!generating &&
            viewedTurn?.status === "succeeded" &&
            (() => {
              const vt = viewedTurn;
              const rated =
                !!vt.rating ||
                vt.feedbackTags.length > 0 ||
                !!vt.feedbackNote;
              const open =
                feedbackEditing === vt.id ||
                (!rated && !feedbackDismissed.has(vt.id));
              return open ? (
                <TurnFeedback
                  key={vt.id}
                  turn={vt}
                  onSaved={(patch) => {
                    applyFeedback(vt.id, patch);
                    setFeedbackEditing(null);
                  }}
                  onDismiss={() => {
                    setFeedbackDismissed((s) => new Set(s).add(vt.id));
                    setFeedbackEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setFeedbackEditing(vt.id)}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <MessageSquareTextIcon className="size-3.5" />
                  {rated
                    ? `Feedback ${
                        vt.rating === "good"
                          ? "👍"
                          : vt.rating === "bad"
                            ? "👎"
                            : "saved"
                      } · edit`
                    : "Add feedback"}
                </button>
              );
            })()}

          {/* Actions for the viewed model (the selected part, for assemblies) */}
          {!generating && activeAssetId && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/print/${activeAssetId}`}
                className="cursor-pointer rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Print
              </Link>
              {/* Assembly + "All parts" selected → one .zip of every part's
                  STL ("Download Files", MTR-44). A specific part (or a single
                  solid) → that one STL. */}
              {viewedParts.length > 1 && effectiveSelectedPartId === null ? (
                <button
                  type="button"
                  onClick={downloadAssemblyZip}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5"
                >
                  <PackageIcon className="size-4" />
                  Download Files ({viewedParts.length})
                </button>
              ) : (
                <a
                  href={`/api/files/preview/${activeAssetId}`}
                  download={`${
                    (viewedParts.length > 1
                      ? viewedParts.find((p) => p.fileAssetId === activeAssetId)
                          ?.name
                      : activeThread && threadLabel(activeThread)) || "model"
                  }.stl`}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5"
                >
                  <DownloadIcon className="size-4" />
                  Download
                </a>
              )}
              {/* Editable STEP source (MTR-196). `available` is threaded from
                  the turn/part (MTR-215) so the button is present or absent from
                  first paint — no async probe that inserts late and reflows the
                  row. Undefined (legacy turns) falls back to the self-probe. */}
              <StepDownloadLink
                key={activeAssetId}
                fileAssetId={activeAssetId}
                label="Download STEP"
                available={
                  viewedParts.length > 1
                    ? viewedParts.find((p) => p.fileAssetId === activeAssetId)
                        ?.hasStep
                    : viewedTurn?.hasStep
                }
              />
              <button
                type="button"
                onClick={saveToProfile}
                disabled={savingModel || savedAssets.has(activeAssetId)}
                title={
                  pinnedDiffersFromLatest
                    ? "Saves the pinned (Active) version"
                    : undefined
                }
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5 disabled:opacity-60"
              >
                {savedAssets.has(activeAssetId) ? (
                  <>
                    <CheckIcon className="size-4" /> Saved
                  </>
                ) : savingModel ? (
                  "Saving…"
                ) : (
                  "Save"
                )}
              </button>
              {viewedTurn?.projectSlug && (
                <Link
                  href={`/projects/${viewedTurn.projectSlug}`}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5"
                >
                  Open assembly project
                </Link>
              )}
            </div>
          )}

          {/* Annotations — pin points on the model + notes; folded into the
              next revision as structured spatial feedback for the agent. */}
          {!generating && activeAssetId && (annotateMode || annotations.length > 0) && (
            <div className="mt-4 rounded-xl border border-foreground/10 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Annotations{" "}
                  <span className="text-muted-foreground">
                    ({annotations.length})
                  </span>
                </span>
                {annotations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAnnotations([])}
                    className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {annotations.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Pick <span className="font-medium">Face</span> or{" "}
                  <span className="font-medium">Edge</span> in the viewer, click
                  the model, and describe the change. Selections are sent with
                  your next message.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {annotations.map((a, i) => (
                    <li key={a.id} className="flex items-start gap-2">
                      <span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-[10px] font-medium text-white">
                        {i + 1}
                      </span>
                      <input
                        value={a.note}
                        onChange={(e) =>
                          setAnnotations((prev) =>
                            prev.map((x) =>
                              x.id === a.id ? { ...x, note: e.target.value } : x
                            )
                          )
                        }
                        placeholder={`e.g. ${
                          a.kind === "edge" ? "fillet this edge" : "round this face"
                        } — at (${a.point
                          .map((n) => n.toFixed(0))
                          .join(", ")}) mm`}
                        className="min-w-0 flex-1 rounded-md border border-foreground/15 bg-card px-2 py-1 text-sm outline-none focus:border-foreground/30"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAnnotations((prev) =>
                            prev.filter((x) => x.id !== a.id)
                          )
                        }
                        aria-label="Remove annotation"
                        className="mt-1 cursor-pointer text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="size-4" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

        </section>

        {/* Right sidebar — revisions + parametric source for the current build,
            then the build history. self-start keeps it at content height instead
            of stretching to match the (tall) viewer column. */}
        <aside className="flex min-w-0 flex-col gap-5 self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:min-h-0">
          {/* Revisions for the current build */}
          {!generating && turns.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <EditSparkle className="size-4 shrink-0" />
                <span>Revisions ({turns.length})</span>
                {showHistory ? (
                  <ChevronDown className="ml-auto size-4 shrink-0" />
                ) : (
                  <ChevronRight className="ml-auto size-4 shrink-0" />
                )}
              </button>
              {showHistory && (
                <ol className="mt-2 space-y-1.5 lg:max-h-56 lg:overflow-y-auto">
                  {turns.map((t, i) => {
                    const isViewed = viewedTurn?.id === t.id;
                    const selectable = t.status === "succeeded" && !!t.fileAssetId;
                    const isPinned = pinnedTurnId === t.id;
                    const pinnable = canPinVersions && selectable;
                    // A branch: this turn revised something other than the
                    // immediately preceding turn — indent it as a fork.
                    const isFork =
                      i > 0 &&
                      !!t.parentGenerationId &&
                      t.parentGenerationId !== turns[i - 1].id;
                    const diff = paramDiffSummaries.get(t.id);
                    return (
                      <li
                        key={t.id}
                        className={cn(
                          "group relative",
                          isFork && "ml-3 border-l-2 border-foreground/10 pl-2"
                        )}
                      >
                        <button
                          type="button"
                          disabled={!selectable}
                          onClick={() => setViewTurnId(t.id)}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg border py-2 pl-2.5 text-left text-sm transition-colors",
                            pinnable ? "pr-8" : "pr-2.5",
                            isViewed
                              ? "border-foreground/30 bg-foreground/5"
                              : "border-foreground/10 hover:bg-foreground/5",
                            selectable ? "" : "opacity-60"
                          )}
                        >
                          {t.renderUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.renderUrl}
                              alt=""
                              className="size-10 shrink-0 rounded bg-muted/40 object-cover"
                            />
                          ) : (
                            <div className="size-10 shrink-0 rounded bg-muted/40" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">
                                {i === 0 ? "Start" : `#${i}`}
                              </span>
                              {isPinned && (
                                <span className="rounded-full border border-foreground/15 bg-foreground/5 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                                  Active
                                </span>
                              )}
                            </span>
                            <span className="block truncate">{t.prompt}</span>
                            {t.status === "failed" && (
                              <span className="block truncate text-xs text-destructive">
                                {t.error ?? "failed"}
                              </span>
                            )}
                            {diff && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {diff}
                              </span>
                            )}
                          </span>
                        </button>
                        {/* Pin as active — hover/focus reveal; always shown
                            on the pinned row. Outside the row button (no
                            nested buttons). */}
                        {pinnable && (
                          <button
                            type="button"
                            onClick={() => pinVersion(t)}
                            disabled={pinning}
                            aria-pressed={isPinned}
                            aria-label={
                              isPinned
                                ? "Pinned as active version"
                                : "Pin as active version"
                            }
                            title={
                              isPinned
                                ? "Active version"
                                : "Pin as active version"
                            }
                            className={cn(
                              "absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-foreground/10 disabled:opacity-50",
                              isPinned
                                ? "text-foreground"
                                : "text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                            )}
                          >
                            <PinIcon
                              className={cn("size-3.5", isPinned && "fill-current")}
                            />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {/* Parametric source for the current build — collapsible */}
          {!generating && viewedTurn?.sourceCode && (
            <div>
              <button
                type="button"
                onClick={() => setShowSource((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <Layers className="size-4 shrink-0" />
                <span>Parametric source</span>
                {showSource ? (
                  <ChevronDown className="ml-auto size-4 shrink-0" />
                ) : (
                  <ChevronRight className="ml-auto size-4 shrink-0" />
                )}
              </button>
              {showSource && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
                  {viewedTurn.sourceCode}
                </pre>
              )}
            </div>
          )}

          {/* Build history — collapsible; header fixed, list scrolls. Hidden
              below lg, where the header history icon opens it as a dropdown. */}
          <div className="hidden min-h-0 flex-1 flex-col lg:flex">
            <button
              type="button"
              onClick={() => setShowBuilds((v) => !v)}
              className="flex w-full shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ClockRewind className="size-4 shrink-0" />
              <span>Builds ({threads.length})</span>
              {showBuilds ? (
                <ChevronDown className="ml-auto size-4 shrink-0" />
              ) : (
                <ChevronRight className="ml-auto size-4 shrink-0" />
              )}
            </button>
            {showBuilds && (
            <ul
              className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-0.5 py-1"
              style={{
                // Bottom-only fade: the top feather dimmed the first row even
                // when the list wasn't scrolled, which read as a render glitch.
                maskImage:
                  "linear-gradient(to bottom, black 0, black calc(100% - 14px), transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, black 0, black calc(100% - 14px), transparent 100%)",
              }}
            >
              <BuildsList
                threads={threads}
                activeRootId={activeRootId}
                openMenuId={openMenuId}
                onOpenThread={openThread}
                onToggleMenu={(id) =>
                  setOpenMenuId((m) => (m === id ? null : id))
                }
                onDelete={deleteBuild}
              />
            </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Floating composer */}
      {/* nav:pl-56 matches the app layout's left sidebar gutter so this
          viewport-fixed bar lines up with the page's content area; the inner
          grid then mirrors the page grid so the composer centers under the
          viewer column and ignores the Builds sidebar (empty 300px track). */}
      <div
        ref={composerFixedRef}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 nav:pl-56"
      >
        {/* Sub-nav viewports show the floating MobileTabBar pill (bottom-6,
            z-40); lift the composer above it so its controls stay tappable.
            At nav+ the pill is gone and the sidebar rail takes over. */}
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-28 nav:pb-4 lg:grid-cols-[1fr_300px]">
          <div className="pointer-events-auto mx-auto w-full max-w-2xl">
          {/* Quick check — shown ONLY when the silent brief step surfaced a
              genuine choice. Answer (or skip) and it builds; the brief data
              itself never renders as a form (MTR-194 pattern revision). */}
          {brief && (brief.questions?.length ?? 0) > 0 && !generating && (
            <QuickCheckCard
              brief={brief}
              onChange={setBrief}
              onClose={() =>
                // Close = keep the brief (and the recommended defaults) but
                // stop asking; the next send builds with it directly.
                setBrief({ ...brief, questions: undefined })
              }
              onBuild={submit}
              canBuild={prompt.trim().length >= 3}
            />
          )}
          {/* Morphing generation thread (MTR-209): the composer "sends" the
              prompt as a RIGHT-aligned bubble, a one-line status loader sits
              LEFT-aligned below it, and when a question fires the status
              container physically morphs into the questionnaire — then back.
              Unmounts (exits down) on completion, returning to the rest
              composer. */}
          <AnimatePresence>
            {generating && submittedPrompt !== null && (
              <GenerationThread
                key="gen-thread"
                promptText={submittedPrompt}
                statusText={
                  progress.length
                    ? describeEvent(progress[progress.length - 1]).text
                    : "Getting started"
                }
                pendingQuestion={pendingQuestion}
                onAnswer={answerQuestion}
                reduce={!!reduceMotion}
              />
            )}
          </AnimatePresence>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!generating) addFiles(e.dataTransfer.files);
            }}
            className="rounded-2xl border border-foreground/15 bg-card/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
          >
            {images.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {images.map((img) => (
                  <div key={img.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt="reference"
                      className="h-12 w-12 rounded-md border border-foreground/10 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      aria-label="Remove image"
                      className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background"
                    >
                      <XIcon className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Annotation chips — make it obvious selected faces send with the
                message. */}
            {annotations.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                {annotations.map((a, i) => (
                  <span
                    key={a.id}
                    className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-[#2563eb]/30 bg-[#2563eb]/10 py-0.5 pl-2 pr-1 text-xs text-foreground"
                  >
                    <span className="truncate">
                      📍 {a.note.trim() ||
                        `${a.kind === "edge" ? "Edge" : "Face"} ${i + 1}`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAnnotations((prev) =>
                          prev.filter((x) => x.id !== a.id)
                        )
                      }
                      aria-label="Remove annotation"
                      className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <XIcon className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Textarea on top — borderless, auto-grows with the prompt. */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length && !generating) addFiles(files);
              }}
              rows={1}
              maxLength={2000}
              disabled={generating}
              placeholder={
                activeThread
                  ? "What do you want to change?"
                  : "What do you want to bring into existence?"
              }
              // text-base (16px) on mobile prevents iOS Safari from auto-
              // zooming when the field is focused (it zooms any input < 16px).
              className="max-h-[200px] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-base outline-none disabled:opacity-60 nav:text-sm"
            />
            {/* Toolbar below the text: attach + draft-brief (left), send
                (right). */}
            <div className="flex items-center justify-between px-1 pt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={generating || images.length >= MAX_IMAGES}
                  aria-label="Attach reference image"
                  title="Attach reference image"
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
                >
                  <PaperclipIcon className="size-4" />
                </button>
                {/* Silent pre-build spec check in flight (fresh builds). */}
                {briefLoading && (
                  <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    Checking the spec…
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={submit}
                disabled={generating || prompt.trim().length < 3}
                aria-label={composerLabel}
                title={composerLabel}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
              >
                {generating ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <ArrowUpIcon className="size-4" strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The build-history list items (thumbnail, label, revision count, and a
 * three-dot delete menu). Shared by the desktop Builds sidebar and the mobile
 * header dropdown so both stay in sync. Renders bare <li>s into a caller-owned
 * <ul> (which controls scroll/mask), including the empty state.
 */
function BuildsList({
  threads,
  activeRootId,
  openMenuId,
  onOpenThread,
  onToggleMenu,
  onDelete,
}: {
  threads: StudioThread[];
  activeRootId: string | null;
  openMenuId: string | null;
  onOpenThread: (t: StudioThread) => void;
  onToggleMenu: (rootId: string) => void;
  onDelete: (t: StudioThread) => void;
}) {
  // Anchor rect for the open menu, captured from the trigger button. The
  // menu renders in a portal with fixed positioning so it isn't clipped by
  // the scrolling, mask-faded <ul> it lives inside.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  if (threads.length === 0) {
    return <li className="text-sm text-muted-foreground">No builds yet.</li>;
  }
  return (
    <>
      {threads.map((t) => {
        // Still PNG render captured per generation (newest with one).
        const thumb = [...t.turns].reverse().find((x) => x.renderUrl)?.renderUrl;
        const isActive = t.rootId === activeRootId;
        return (
          <li key={t.rootId} className="relative">
            <button
              type="button"
              onClick={() => onOpenThread(t)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border p-2 pr-9 text-left transition-colors ${
                isActive
                  ? "border-foreground/30 bg-foreground/5"
                  : "border-foreground/10 hover:bg-foreground/5"
              }`}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded bg-muted/40 object-contain"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded bg-muted/40" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {threadLabel(t)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t.turns.length} revision
                  {t.turns.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>

            {/* Three-dot menu (delete) */}
            <button
              type="button"
              aria-label="Build options"
              onClick={(e) => {
                e.stopPropagation();
                setAnchorRect(e.currentTarget.getBoundingClientRect());
                onToggleMenu(t.rootId);
              }}
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
            >
              <EllipsisVerticalIcon className="size-4" />
            </button>
            {openMenuId === t.rootId &&
              anchorRect &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    top: anchorRect.bottom + 4,
                    left: anchorRect.right - 140,
                  }}
                  className="z-50 min-w-[140px] rounded-lg border border-foreground/15 bg-card p-1 shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => onDelete(t)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2Icon className="size-4" />
                    Delete build
                  </button>
                </div>,
                document.body
              )}
          </li>
        );
      })}
    </>
  );
}

/**
 * Live build preview — the latest snapshot render of the in-progress solid,
 * shown over the generating blob. Cross-fades when a new frame replaces the
 * old: the previous frame stays mounted underneath while the new one
 * transitions in (opacity only; prefers-reduced-motion swaps instantly).
 */
function SnapshotPreview({ render, step }: { render: string; step: number }) {
  const [prev, setPrev] = useState<{ render: string; step: number } | null>(
    null
  );
  const [faded, setFaded] = useState(false);
  const lastRef = useRef<{ render: string; step: number }>({ render, step });
  useEffect(() => {
    if (lastRef.current.step !== step) setPrev(lastRef.current);
    lastRef.current = { render, step };
    // Double-rAF: commit the new frame at opacity 0, then flip it visible so
    // the CSS opacity transition actually runs.
    setFaded(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFaded(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [render, step]);
  return (
    <div className="glass relative w-40 max-w-[60%] overflow-hidden rounded-xl shadow-lg sm:w-52">
      {prev && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${prev.render}`}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/png;base64,${render}`}
        alt="Live preview of the model being built"
        className={cn(
          "relative block h-auto w-full transition-opacity duration-[250ms] motion-reduce:transition-none",
          faded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

/** Axis labels for a component's bounding-box inputs. */
/**
 * Reviewable design brief card (docs/text-to-cad/06): part restatement up
 * top, component boxes + clearances as editable number inputs (the numbers
 * users actually correct), interfaces and envelope read-only. Lives above
 * the composer; the current (edited) value rides along with the generate
 * request whether the user hits this card's button or just sends normally.
 */
/**
 * Quick check (MTR-191 ask-site a / MTR-194 pattern revision): the ONLY
 * user-facing surface of the brief step. The brief itself is machinery —
 * grounded dims ride along to the generate prompt invisibly; this card
 * appears solely when the model surfaced a genuine choice the prompt didn't
 * settle, as tappable options with the recommendation pre-selected.
 */
function QuickCheckCard({
  brief,
  onChange,
  onClose,
  onBuild,
  canBuild,
}: {
  brief: CadBrief;
  onChange: (b: CadBrief) => void;
  onClose: () => void;
  onBuild: () => void;
  canBuild: boolean;
}) {
  const questions = brief.questions ?? [];

  const chosenFor = (q: NonNullable<CadBrief["questions"]>[number]) =>
    brief.decisions?.find((d) => d.q === q.question)?.a ?? q.default ?? null;

  function choose(
    q: NonNullable<CadBrief["questions"]>[number],
    label: string
  ) {
    const rest = (brief.decisions ?? []).filter((d) => d.q !== q.question);
    onChange({ ...brief, decisions: [...rest, { q: q.question, a: label }] });
  }

  return (
    <div className="mb-2 max-h-[45vh] overflow-y-auto rounded-2xl border border-foreground/15 bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-start gap-2">
        <ClipboardListIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Quick check</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {questions.length === 1
              ? "One choice before building — the recommended option is selected."
              : "A couple of choices before building — recommended options are selected."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Skip questions"
          title="Skip — the next send builds with the recommended options"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {questions.map((q) => {
        const chosen = chosenFor(q);
        return (
          <div key={q.id} className="mt-3">
            <p className="text-sm">{q.question}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const selected = chosen === o.label;
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => choose(q, o.label)}
                    aria-pressed={selected}
                    title={o.detail}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/15 bg-foreground/5 hover:border-foreground/30"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-3">
        <button
          type="button"
          onClick={onBuild}
          disabled={!canBuild}
          className="cursor-pointer rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
        >
          Build
        </button>
      </div>
    </div>
  );
}

/**
 * The morphing generation thread (MTR-209). One surface that carries the whole
 * generation lifecycle in an iMessage sent/received metaphor:
 *   • the submitted prompt as a RIGHT-aligned "sent" bubble (truncated, 1 line),
 *   • a LEFT-aligned "received" system bubble that shows a one-line status
 *     loader and *physically morphs* (shared-layout resize) into the
 *     questionnaire when a mid-cycle question fires, then morphs back.
 * All motion is transform/opacity + layout (no per-frame CPU); `reduce`
 * collapses everything to instant opacity swaps for prefers-reduced-motion.
 * Mounted while a build runs; exits (down) on completion → back to rest.
 */
function GenerationThread({
  promptText,
  statusText,
  pendingQuestion,
  onAnswer,
  reduce,
}: {
  promptText: string;
  statusText: string;
  pendingQuestion: {
    questionId: string;
    text: string;
    options: CadQuestionOption[];
    defaultOptionId?: string;
    answering: boolean;
  } | null;
  onAnswer: (pick: { optionId?: string; text?: string }) => void;
  reduce: boolean;
}) {
  const spring = reduce
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 480, damping: 42, mass: 0.9 } as const);
  const fade = reduce
    ? { duration: 0 }
    : ({ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } as const);

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      transition={fade}
      className="mb-2 flex flex-col gap-2"
    >
      {/* Sent — the user's prompt, right-aligned, truncated to one line. */}
      <motion.div layout={!reduce} className="flex justify-end">
        <div className="max-w-[85%] truncate rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background shadow-sm">
          {promptText}
        </div>
      </motion.div>

      {/* Received — the system bubble. `layout` on THIS element is what makes
          the container physically morph between the short status line and the
          taller questionnaire (a real resize, not a cross-fade swap). */}
      <motion.div layout={!reduce} className="flex justify-start">
        <motion.div
          layout={!reduce}
          transition={spring}
          className="max-w-[92%] overflow-hidden rounded-2xl rounded-bl-md border border-foreground/10 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80"
        >
          <AnimatePresence mode="wait" initial={false}>
            {pendingQuestion ? (
              <motion.div
                key={`q:${pendingQuestion.questionId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="p-3"
              >
                <Questionnaire question={pendingQuestion} onAnswer={onAnswer} />
              </motion.div>
            ) : (
              <motion.div
                key="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="flex items-center gap-2.5 px-3.5 py-2.5"
              >
                <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {statusText}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The mid-cycle question (MTR-191), restyled for the morphing thread (MTR-209):
 * question text on top, each answer a full-width contained card (an inline
 * thumbnail when the option carries a visual draft variant), and — ALWAYS — a
 * custom free-text field as the last option so the user can bypass the presets
 * and answer in their own words. Picking a card sends `optionId`; the custom
 * field sends `text`. Ignoring it still lets the server take the default after
 * the timeout, so it never traps an away user.
 */
function Questionnaire({
  question,
  onAnswer,
}: {
  question: {
    text: string;
    options: CadQuestionOption[];
    defaultOptionId?: string;
    answering: boolean;
  };
  onAnswer: (pick: { optionId?: string; text?: string }) => void;
}) {
  const [custom, setCustom] = useState("");
  const canCustom = custom.trim().length > 0 && !question.answering;
  return (
    <div>
      <div className="flex items-start gap-2">
        <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {question.text}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((o) => {
          const isDefault = o.id === question.defaultOptionId;
          return (
            <button
              key={o.id}
              type="button"
              disabled={question.answering}
              onClick={() => onAnswer({ optionId: o.id })}
              title={o.detail}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-foreground/15 bg-foreground/[0.03] p-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-foreground/[0.06] disabled:opacity-50"
            >
              {o.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/png;base64,${o.thumbnail}`}
                  alt=""
                  className="size-12 shrink-0 rounded-lg bg-background/40 object-contain"
                />
              )}
              <span className="min-w-0 flex-1 text-sm text-foreground">
                {o.label}
              </span>
              {isDefault && (
                <span className="shrink-0 rounded-full border border-foreground/15 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  recommended
                </span>
              )}
            </button>
          );
        })}

        {/* Always-present custom free-text escape hatch (MTR-209). */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canCustom) onAnswer({ text: custom });
          }}
          className="flex items-center gap-2 rounded-xl border border-dashed border-foreground/25 p-1.5 pl-3"
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            disabled={question.answering}
            maxLength={2000}
            placeholder="Or answer in your own words…"
            aria-label="Custom answer"
            // text-base on mobile keeps iOS Safari from auto-zooming the field.
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!canCustom}
            aria-label="Send custom answer"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30"
          >
            <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </form>
      </div>

      <p className="mt-2.5 text-[11px] text-muted-foreground">
        {question.answering
          ? "Applying your choice…"
          : "Pick one, or the recommended option is used automatically to keep the build moving."}
      </p>
    </div>
  );
}

function ViewerSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <svg
        width="96"
        height="96"
        viewBox="0 0 100 100"
        fill="none"
        className="opacity-40"
        aria-hidden
      >
        <path
          d="M50 8 L88 30 L88 70 L50 92 L12 70 L12 30 Z M50 8 L50 50 M50 50 L88 30 M50 50 L12 30"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeDasharray="4 4"
        />
      </svg>
      <p className="px-6 text-center text-sm">{label}</p>
    </div>
  );
}

function describeEvent(ev: CadProgressEvent): {
  text: string;
  sub: string | null;
} {
  switch (ev.type) {
    case "queued":
      return { text: "Queued", sub: null };
    case "snapshot":
      // Rendered as the live preview image, not as status copy.
      return { text: "Taking shape", sub: null };
    case "phase":
      if (ev.phase === "generating") {
        return ev.attempt > 1
          ? { text: "Refining the design", sub: `Pass ${ev.attempt} of ${ev.maxAttempts}` }
          : { text: "Designing your model", sub: null };
      }
      return { text: "Shaping the geometry", sub: null };
    case "validation":
      return ev.pass
        ? { text: "Almost there", sub: null }
        : { text: "Tidying up a few details", sub: null };
    case "repairing":
      return {
        text: "Refining the design",
        sub: `Pass ${ev.attempt + 1} of ${ev.maxAttempts}`,
      };
    case "question":
      // Rendered as the QuestionCard, not as status copy — but keep the switch
      // exhaustive so a new event type can't silently fall through.
      return { text: "Waiting on your answer", sub: null };
    case "answer":
      return {
        text: "Continuing your build",
        sub: ev.viaDefault ? `Using ${ev.label}` : `Building ${ev.label}`,
      };
  }
}

/**
 * Per-turn feedback widget — the in-the-moment human eval signal. Seeded
 * from the turn (remounted via `key` when the viewed turn changes), saves
 * through recordCadFeedback, and reports saved values up so the in-memory
 * threads stay in sync. Rolls up on /text-to-cad/eval.
 */
function TurnFeedback({
  turn,
  onSaved,
  onDismiss,
}: {
  turn: StudioTurn;
  onSaved: (
    patch: Pick<StudioTurn, "rating" | "feedbackTags" | "feedbackNote">
  ) => void;
  onDismiss?: () => void;
}) {
  const [rating, setRating] = useState<CadRating | null>(turn.rating);
  const [tags, setTags] = useState<CadFeedbackTag[]>(
    turn.feedbackTags.filter((t): t is CadFeedbackTag =>
      (CAD_FEEDBACK_TAGS as readonly string[]).includes(t)
    )
  );
  const [note, setNote] = useState(turn.feedbackNote ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  function toggleTag(tag: CadFeedbackTag) {
    setSaved(false);
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  function save() {
    startSaving(async () => {
      const res = await recordCadFeedback({
        generationId: turn.id,
        rating,
        tags,
        note,
      });
      if ("ok" in res) {
        setSaved(true);
        onSaved({
          rating,
          feedbackTags: tags,
          feedbackNote: note.trim() || null,
        });
      }
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-foreground/10 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          How did this turn out?
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss feedback"
            className="order-last ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-pressed={rating === "good"}
          onClick={() => {
            setSaved(false);
            setRating((r) => (r === "good" ? null : "good"));
          }}
          className={cn(
            "rounded-md border px-2 py-1 text-sm",
            rating === "good"
              ? "border-foreground/40 bg-foreground/5"
              : "border-foreground/15"
          )}
        >
          👍
        </button>
        <button
          type="button"
          aria-pressed={rating === "bad"}
          onClick={() => {
            setSaved(false);
            setRating((r) => (r === "bad" ? null : "bad"));
          }}
          className={cn(
            "rounded-md border px-2 py-1 text-sm",
            rating === "bad"
              ? "border-foreground/40 bg-foreground/5"
              : "border-foreground/15"
          )}
        >
          👎
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {CAD_FEEDBACK_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={tags.includes(tag)}
            onClick={() => toggleTag(tag)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              tags.includes(tag)
                ? "border-foreground/40 bg-foreground/5"
                : "border-foreground/15 text-muted-foreground"
            )}
          >
            {CAD_FEEDBACK_TAG_LABELS[tag]}
          </button>
        ))}
      </div>

      <input
        value={note}
        onChange={(e) => {
          setSaved(false);
          setNote(e.target.value);
        }}
        maxLength={1000}
        placeholder="Optional note…"
        className="mt-2 w-full rounded-md border border-foreground/15 bg-card px-2 py-1 text-xs outline-none focus:border-foreground/30"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md border border-foreground/15 px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save feedback"}
        </button>
        {saved && <span className="text-xs text-muted-foreground">Saved ✓</span>}
      </div>
    </div>
  );
}
