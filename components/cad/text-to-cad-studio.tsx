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
import { MetaballLoader } from "@/components/ui/metaball-loader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  rerunCadWithParams,
  reviseCadFeatureStatement,
  saveCadFileToProfile,
  setActiveCadVersion,
} from "@/app/actions/cad-generation";
import { StepDownloadLink } from "@/components/files/step-download-button";
import { diffParams, extractParams } from "@/components/cad/param-diff";
import { FeatureChips } from "@/components/cad/feature-chips";
import { featureIdsForFaceIds } from "@/components/cad/feature-timeline";
import type {
  CadStreamEvent,
  CadJobProgressEntry,
  CadProgressEvent,
  CadQuestionOption,
  CadFeature,
  CadNetworksReport,
  CadUsageSummary,
} from "@/lib/cad/types";
import {
  networksFailure,
  networksInconclusive,
  networksSummary,
} from "@/lib/cad/network-check";
import { parseFeatures } from "@/lib/cad/features";
// Type-only: lib/cad/brief is server-only at runtime; the type is erased.
import type { CadBrief } from "@/lib/cad/brief";
import type { ViewerAnnotation } from "@/components/viewer/model-viewer";
import { planComposerSubmit } from "@/components/cad/composer-submit";
import { decodeSnapshotPoints } from "@/components/cad/snapshot-points";
import {
  isAssemblyOverview,
  resolveEffectiveSelectedPartId,
} from "@/components/cad/assembly-selection";
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
  /**
   * Instrumented construction features for the feature-chip strip.
   * Empty/absent on mesh-mode or legacy generations.
   */
  features?: CadFeature[];
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
   * Dual-fluid isolation verdict (MTR-179) when the generation declared
   * fluid circuits (exchanger builds); null/absent otherwise.
   */
  networksReport?: CadNetworksReport | null;
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
  /**
   * Non-terminal cadJobs row still executing this (pending) generation —
   * server-derived, so a live build survives navigation/new tabs: the
   * studio reattaches to this job's events stream on load. Null/absent on
   * settled turns.
   */
  activeJobId?: string | null;
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
  // Live cost meter (usage SSE frames, flushed mid-run by the executor):
  // drives the tokens-so-far readout next to the stage status.
  const [liveUsage, setLiveUsage] = useState<CadUsageSummary | null>(null);
  // 1s heartbeat for the stage-elapsed timer while a build is in flight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Live build preview: the LATEST snapshot render only (replace, never
  // accumulate — each frame is a whole base64 PNG). Kept out of `progress`
  // so the status transcript stays tiny.
  const [snapshot, setSnapshot] = useState<{
    render: string;
    step: number;
    /** Sampled surface points of the in-progress solid (base64, optional). */
    points?: string;
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
  // Loader→model handoff (MTR-210/214). On a fresh result the deforming blob
  // morphs into the generated shape ("morph"), then FREEZES at the final shape
  // ("hold") while the crisp ModelViewer — mounted transparently underneath the
  // whole time — finishes loading; once it reports ready we crossfade the
  // particles out and the solid in ("reveal"). Gating reveal on the real load
  // (not a fixed timer) is what kills the "Loading model…" flash + cloud
  // regression + abrupt pop.
  const [transition, setTransition] = useState<{
    assetId: string;
    phase: "morph" | "hold" | "reveal";
  } | null>(null);
  // The solid ModelViewer has reported its geometry loaded for the current
  // handoff (MTR-214). Reset when a new transition begins; drives morph→reveal.
  const [modelReady, setModelReady] = useState(false);
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
  // Feature-chip popover: which construction op is open (also drives viewer
  // highlight of that op's faceIds).
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const [featureUpdating, setFeatureUpdating] = useState(false);
  // Live param preview (docs/text-to-cad/10): transient STL object URL the
  // viewer shows while a chip's values are being dialed — nothing persisted
  // until the popover's ✓ commits through rerunCadWithParams.
  const [paramPreviewUrl, setParamPreviewUrl] = useState<string | null>(null);
  const [paramPreviewPending, setParamPreviewPending] = useState(false);
  const [paramPreviewError, setParamPreviewError] = useState<string | null>(
    null
  );
  const paramPreviewAbortRef = useRef<AbortController | null>(null);
  const paramPreviewUrlRef = useRef<string | null>(null);
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

  // Reattach on return: tail the events stream of any in-flight build —
  // replay + live tail means an already-finished job resolves instantly and
  // a running one keeps streaming (MTR-175). Two sources, in order:
  //   1. sessionStorage (same-tab return — carries prompt/thread context);
  //   2. the SERVER's view (turns with an activeJobId) — sessionStorage is
  //      per-tab and best-effort, and forgetting a job that was still
  //      running stranded live builds behind a dead empty state.
  useEffect(() => {
    let saved = readStoredJob();
    if (!saved) {
      let fromDb: (StoredJob & { at: number }) | null = null;
      for (const thread of initialThreads) {
        for (const turn of thread.turns) {
          if (turn.status !== "pending" || !turn.activeJobId) continue;
          // Threads are ordered by lastActivity; prefer the newest.
          if (!fromDb || thread.lastActivity > fromDb.at) {
            fromDb = {
              jobId: turn.activeJobId,
              generationId: turn.id,
              prompt: turn.prompt,
              parentId: turn.parentGenerationId ?? null,
              rootId: thread.rootId,
              at: thread.lastActivity,
            };
          }
        }
      }
      saved = fromDb;
    }
    if (!saved) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    jobRef.current = saved;
    if (saved.rootId) setActiveRootId(saved.rootId);
    setProgress([]);
    setLiveUsage(null);
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

  // Tick the stage-elapsed timer once a second while a build is in flight.
  useEffect(() => {
    if (!generating) return;
    setNowMs(Date.now());
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [generating]);

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

  // Loader→model reveal, gated on the solid actually loading (MTR-214). The
  // morphed particle cloud holds frozen at its final shape ("hold") until the
  // ModelViewer (preloaded transparently underneath) reports `onReady`; only
  // then do we flip to "reveal" and crossfade. A backstop timer forces the
  // reveal if the load never lands, so the handoff can't get stuck.
  useEffect(() => {
    if (!transition || transition.phase === "reveal") return;
    // Morph done + model loaded → reveal now.
    if (transition.phase === "hold" && modelReady) {
      setTransition((t) => (t ? { ...t, phase: "reveal" } : null));
      return;
    }
    // Backstop: don't hold the frozen cloud forever if the mesh never loads.
    const backstop = setTimeout(() => {
      setTransition((t) => (t ? { ...t, phase: "reveal" } : null));
    }, 8000);
    return () => clearTimeout(backstop);
  }, [transition, modelReady]);

  // Once revealed, let the crossfade run, then clear the transition (unmounts
  // the faded-out blob). The particles fade over 500ms; give it a small beat.
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
  // stale part"). Resolve against the CURRENT parts; non-match → "All parts".
  const effectiveSelectedPartId = resolveEffectiveSelectedPartId(
    viewedParts,
    selectedPartId
  );
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
  // "All parts" keeps the shared assembly frame + explode; a part tab frames
  // that part alone so it fills the viewport (hide-in-place left small /
  // off-center parts looking blank when stacked in assembly coordinates).
  const showAssemblyOverview =
    !compareBaseAssetId &&
    isAssemblyOverview(viewedParts.length, effectiveSelectedPartId);
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
  // Mesh-mode / legacy models expose no B-rep topology (resolved to null in
  // topoUrls): a pin then references approximate coordinates only, not an exact
  // CAD face, so the reference is weaker — worth flagging (MTR-217).
  const viewedModelHasNoTopo =
    !!viewedTurn &&
    viewedTurn.id in topoUrls &&
    topoUrls[viewedTurn.id] == null;

  const viewedFeatures = viewedTurn?.features ?? [];
  const activeFeature =
    viewedFeatures.find((f) => f.id === activeFeatureId) ?? null;
  const highlightFaceIds =
    activeFeature && activeFeature.faceIds.length > 0
      ? activeFeature.faceIds
      : undefined;
  // Reverse highlight (MTR-224): faces the user annotated in the viewer →
  // the owning timeline chips. Only exact-topo face pins participate (mesh
  // flood-fill picks carry no face id, so they can't resolve to a feature).
  const annotatedFeatureIds = featureIdsForFaceIds(
    viewedFeatures,
    annotations.flatMap((a) =>
      a.kind === "face" && a.topo ? [a.topo.faceId] : []
    )
  );

  // Drop the open feature chip when the viewed turn changes.
  useEffect(() => {
    setActiveFeatureId(null);
  }, [viewedTurn?.id]);

  /** Adopt a feature-revision result (param rerun or stmt edit) as a turn. */
  function adoptFeatureRevision(
    res: Extract<
      Awaited<ReturnType<typeof rerunCadWithParams>>,
      { generationId: string }
    >,
    promptLabel: string
  ) {
    const newTurn: StudioTurn = {
      id: res.generationId,
      prompt: promptLabel,
      status: "succeeded",
      renderUrl: res.renderUrl,
      fileAssetId: res.fileAssetId,
      sourceCode: res.sourceCode,
      features: res.features,
      error: null,
      rating: null,
      feedbackTags: [],
      feedbackNote: null,
      parts: res.parts,
      projectSlug: res.projectSlug,
      remeshed: res.remeshed,
      networksReport: res.networksReport ?? null,
      hasStep: res.hasStep,
      parentGenerationId: res.parentGenerationId,
    };

    const rootId = activeRootIdRef.current;
    setThreads((prev) =>
      prev.map((t) => {
        if (t.rootId !== rootId) return t;
        if (t.turns.some((x) => x.id === newTurn.id)) return t;
        return {
          ...t,
          lastActivity: Date.now(),
          activeGenerationId: newTurn.id,
          turns: [...t.turns, newTurn],
        };
      })
    );
    setViewTurnId(newTurn.id);
    setActiveFeatureId(null);
    // Fresh topo for the new revision — clear any cached miss.
    setTopoUrls((u) => {
      const next = { ...u };
      delete next[newTurn.id];
      return next;
    });
  }

  /** Drop the transient preview and return the viewer to the real asset. */
  const clearParamPreview = useCallback(() => {
    paramPreviewAbortRef.current?.abort();
    paramPreviewAbortRef.current = null;
    if (paramPreviewUrlRef.current) {
      URL.revokeObjectURL(paramPreviewUrlRef.current);
      paramPreviewUrlRef.current = null;
    }
    setParamPreviewUrl(null);
    setParamPreviewPending(false);
    setParamPreviewError(null);
  }, []);

  // Any turn/asset switch invalidates an in-flight or shown preview.
  useEffect(() => clearParamPreview, [activeAssetId, clearParamPreview]);

  /**
   * Live preview for a chip's dialed values: deterministic sidecar re-run of
   * the rewritten source (NO LLM, nothing persisted) → transient STL object
   * URL the viewer swaps to. `draft: null` reverts. Single-solid only — the
   * caller gates assemblies/compare off via `previewEnabled`.
   */
  async function previewFeatureDraft(
    feature: CadFeature,
    draft: Record<string, number> | null
  ) {
    if (!draft) {
      clearParamPreview();
      return;
    }
    if (!viewedTurn) return;
    paramPreviewAbortRef.current?.abort();
    const ctrl = new AbortController();
    paramPreviewAbortRef.current = ctrl;
    setParamPreviewPending(true);
    setParamPreviewError(null);
    try {
      const res = await fetch("/api/cad/feature-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId: viewedTurn.id,
          featureId: feature.id,
          params: draft,
        }),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setParamPreviewError(body?.error ?? "Preview failed.");
        return;
      }
      const blob = await res.blob();
      if (ctrl.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      if (paramPreviewUrlRef.current) {
        URL.revokeObjectURL(paramPreviewUrlRef.current);
      }
      paramPreviewUrlRef.current = url;
      setParamPreviewUrl(url);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setParamPreviewError("Preview failed.");
      }
    } finally {
      if (paramPreviewAbortRef.current === ctrl) {
        setParamPreviewPending(false);
      }
    }
  }

  async function applyFeatureUpdate(
    feature: CadFeature,
    draft: Record<string, number>
  ): Promise<{ error?: string } | void> {
    if (!viewedTurn) return { error: "No generation selected." };
    setFeatureUpdating(true);
    try {
      // Control-key draft; the server re-derives every binding (top-level
      // name or span literal, MTR-225) from its own copy of the source.
      const res = await rerunCadWithParams({
        generationId: viewedTurn.id,
        featureId: feature.id,
        params: draft,
      });
      if ("error" in res) return { error: res.error };
      adoptFeatureRevision(
        res,
        Object.entries(draft)
          .filter(([k, v]) => feature.params[k] !== v)
          .map(([k, v]) => `${k} → ${v}`)
          .slice(0, 3)
          .join(" · ") || "Update params"
      );
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Update failed.",
      };
    } finally {
      setFeatureUpdating(false);
    }
  }

  /** Statement-scoped LLM edit for one chip (MTR-225, route stmt-edit). */
  async function applyFeatureStatementEdit(
    feature: CadFeature,
    instruction: string
  ): Promise<{ error?: string; fallback?: boolean } | void> {
    if (!viewedTurn) return { error: "No generation selected." };
    setFeatureUpdating(true);
    try {
      const res = await reviseCadFeatureStatement({
        generationId: viewedTurn.id,
        featureId: feature.id,
        instruction,
      });
      if ("error" in res) return res;
      adoptFeatureRevision(res, `Edit ${feature.label}: ${instruction}`);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Edit failed.",
        fallback: true,
      };
    } finally {
      setFeatureUpdating(false);
    }
  }

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
    setLiveUsage(null);
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
    setLiveUsage(null);
    setSnapshot(null);
    setBrief(null);
    setBriefLoading(false);
    // Switching builds at the quick-check stage (in flight but not yet
    // generating) must drop the sent bubble so the resting composer returns.
    setSubmittedPrompt(null);
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
      features: parseFeatures(ev.features),
      error: null,
      rating: null,
      feedbackTags: [],
      feedbackNote: null,
      parts: ev.parts ?? [],
      projectSlug: ev.projectSlug ?? null,
      remeshed: ev.remeshed ?? false,
      networksReport: ev.networksReport ?? null,
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
    // Reset the ready flag first so the reveal waits for THIS asset to load.
    setModelReady(false);
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
    // A pin with no typed text is a valid revision on its own (MTR-217) — the
    // annotations carry the instruction. Otherwise require a few characters.
    const { canSubmit, annotationOnly, instruction } = planComposerSubmit(
      prompt,
      annotations.length
    );
    if (!canSubmit || generating || briefLoading) return;

    const parentId = latestTurn?.id; // revise the latest turn when in a thread
    // Annotation-only sends need a model to annotate (always a revision).
    if (annotationOnly && !parentId) return;

    // Morph the composer into the right-aligned "sent" bubble immediately, on
    // BOTH entry paths (chip or typed), BEFORE the spec check runs (MTR-209
    // round 2 #1) — so the prompt visibly "sends" and the composer unmounts
    // rather than parking the text with an inline "Checking the spec…". The
    // typed value stays in `prompt` for the quick-check re-submit / error retry;
    // it's just no longer shown (the composer is unmounted while in flight).
    setSubmittedPrompt(instruction);

    // Ask-before-build (MTR-191 ask-site a): fresh builds run the silent
    // brief step first. Questions pause the flow ONCE with choice cards;
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
    const sentPrompt = instruction + annoBlock;

    setError(null);
    setProgress([]);
    setLiveUsage(null);
    setSnapshot(null);
    // A revision deforms the model currently on screen (edit-in-place); a fresh
    // build has none, so the wireframe blob deforms instead.
    setSourceAssetId(parentId ? activeAssetId : null);
    setTransition(null);
    // `submittedPrompt` was already stashed at the top (the composer sent on
    // submit). Now that the build is actually starting, empty the composer's
    // backing value; it's restored on any error path below so a failed build
    // doesn't swallow what the user typed.
    setPrompt("");
    // The pins have "sent" — clear them at send time (MTR-217) so they don't
    // linger through the build or silently re-send on the next revision. The
    // snapshot restores them if the request fails below.
    const sentAnnotations = annotations;
    setAnnotations([]);
    setAnnotateMode(false);
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
        // Restore the composer so the user can retry (the thread unwinds); bring
        // the pins back too so an annotation revision isn't silently lost.
        setPrompt(text);
        setSubmittedPrompt(null);
        setAnnotations(sentAnnotations);
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
        // The turn's history label — the synthesized instruction for an
        // annotation-only revision so it isn't blank (MTR-217).
        prompt: instruction,
        parentId: parentId ?? null,
        rootId: parentId ? activeRootId : generationId,
      };
      persistResume();

      const terminal = await streamJobEvents(
        jobId,
        controller,
        instruction,
        parentId
      );
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
        setAnnotations(sentAnnotations);
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
    // Resumable-replay cursor (CAD-8): the highest persisted-entry `seq`
    // (CAD-7) applied so far. Scoped OUTSIDE the retry loop so it survives
    // across reconnect attempts for this same job — a dropped connection
    // (proxy timeout, the route's own ~290s ceiling) resumes from here
    // instead of re-streaming the whole transcript from the start. -1 means
    // "nothing applied yet", matching the route's cold-start default.
    let lastSeq = -1;
    for (let attempt = 0; ; attempt++) {
      let sawTerminal = false;
      try {
        const res = await fetch(
          `/api/cad/jobs/${jobId}/events?from=${lastSeq}`,
          { signal: controller.signal }
        );
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
            let ev: CadJobProgressEntry;
            try {
              ev = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            // Advance the replay cursor (CAD-8) for every persisted-log
            // entry that carries one — synthesized frames (snapshot, usage)
            // aren't part of cadJobs.progress and never carry `seq`, so they
            // leave the cursor untouched, which is correct: reconnecting
            // only needs to skip what the route can actually replay.
            if (typeof ev.seq === "number" && ev.seq > lastSeq) {
              lastSeq = ev.seq;
            }
            if (ev.type === "done") {
              sawTerminal = true;
              // Clear the live preview BEFORE the transition state lands so
              // the blob→model morph hand-off runs exactly as before.
              setSnapshot(null);
              setPendingQuestion(null);
              applyDone(ev, submittedPrompt, parentId);
              // Return to rest: the sent bubble morphs back into the empty
              // composer (MTR-209). Clearing this unmounts the thread and
              // re-mounts the resting composer.
              setSubmittedPrompt(null);
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
              // transcript must stay light). `points` (when present) drives
              // the point cloud morphing onto the in-progress solid.
              setSnapshot({ render: ev.render, step: ev.step, points: ev.points });
            } else if (ev.type === "usage") {
              // Live cost meter — replace, never append (synthesized by the
              // events route from the job row, not part of the transcript).
              setLiveUsage(ev.usage);
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

  // The morphing generation thread owns the whole in-flight window (submit →
  // done), across both the chip and typed paths. While it's up, the resting
  // composer is UNMOUNTED (round 2 note #3). `submittedPrompt` is the single
  // "conversation active" signal — set on submit, cleared on done/error.
  const inFlight = submittedPrompt !== null;
  // The pre-build quick-check is live (a genuine choice surfaced) but the build
  // hasn't started — the system bubble shows the questionnaire, not status.
  const briefActive =
    !!brief && (brief.questions?.length ?? 0) > 0 && !generating;
  // One-line status for the system bubble: "Checking the spec" during the
  // silent brief step, then the harness's current phase (round 1 dropped the
  // second line).
  const statusText = briefLoading
    ? "Checking the spec"
    : progress.length
      ? describeEvent(progress[progress.length - 1]).text
      : "Getting started";
  // Stage-elapsed timer: the current stage began at the FIRST event of the
  // trailing run whose display text matches the latest one. Uses the entry's
  // own emit stamp (`t`, persisted server-side) so a reattached/replayed
  // build shows true elapsed time, not time-since-reconnect.
  const stageStartMs = useMemo(() => {
    if (progress.length === 0) return null;
    const lastText = describeEvent(progress[progress.length - 1]).text;
    let start: number | null = null;
    for (let i = progress.length - 1; i >= 0; i--) {
      const e = progress[i];
      if (describeEvent(e).text !== lastText) break;
      start = (e as { t?: number }).t ?? start;
    }
    return start;
  }, [progress]);
  const stageSecs =
    stageStartMs != null
      ? Math.max(0, Math.floor((nowMs - stageStartMs) / 1000))
      : null;
  const totalTokens =
    liveUsage?.model?.reduce(
      (sum, m) => sum + m.inputTokens + m.outputTokens,
      0
    ) ?? 0;
  // "2m 14s · 148k tokens" under the stage label — the build's live vitals.
  const statusDetail =
    [
      stageSecs != null && stageSecs >= 1 ? formatElapsed(stageSecs) : null,
      totalTokens > 0 ? `${formatTokens(totalTokens)} tokens` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  // Cancel the quick-check → back to the resting composer with the prompt kept
  // so it can be edited (round 2 note #4 escape hatch).
  const cancelBrief = () => {
    setBrief(null);
    setSubmittedPrompt(null);
  };

  // Live morph target: the latest snapshot's surface points, decoded once per
  // snapshot — the forming point cloud morphs onto each in-progress solid.
  const livePoints = useMemo(
    () => (snapshot?.points ? decodeSnapshotPoints(snapshot.points) : null),
    [snapshot?.points]
  );

  // Viewer layering (MTR-214). The transition canvas (deforming loader / morph)
  // OWNS the frame during generating + morph + hold; the crisp ModelViewer is
  // mounted TRANSPARENTLY underneath from the start of the handoff so it's
  // loaded by the time the morph freezes, then crossfades in on reveal.
  const inTransition = transition !== null;
  const showTransition = generating || inTransition;
  // Mount the solid whenever there's an asset AND we're either settled or in the
  // loader→model handoff (so it preloads under the frozen particles).
  const mountModel = !!activeAssetId && (inTransition || !generating);
  // Opaque only when settled or once the morph revealed it; during morph/hold
  // it's mounted-but-transparent (loading) so there's no ghost-edge second copy.
  const modelVisible = !inTransition || transition?.phase === "reveal";

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
                  owner-gated, so these are inherently owner-only. Scorecard +
                  Exemplars are folded into a single three-dot menu so the
                  toolbar reads as one row of same-size icon buttons. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="More options"
                      title="More options"
                      className="shrink-0 rounded-lg"
                    >
                      <EllipsisVerticalIcon className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem
                    render={<Link href="/prometheus/eval" />}
                    className="px-2.5 py-2 text-sm"
                  >
                    <ClipboardListIcon className="size-4" />
                    Scorecard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={<Link href="/prometheus/exemplars" />}
                    className="px-2.5 py-2 text-sm"
                  >
                    <Layers className="size-4" />
                    Exemplars
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
              {/* Crisp model — the BASE layer (fixed frame). Mounted (and
                  loading) UNDER the transition from the start of the handoff,
                  transparent until reveal, so the morph crossfades into a
                  ready mesh with no "Loading model…" flash or cloud regression
                  (MTR-214). On a revision it's the shape being deformed. */}
              {mountModel && activeAssetId && (
                <div
                  className={cn(
                    "absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none",
                    modelVisible ? "opacity-100" : "opacity-0"
                  )}
                >
                <Suspense
                  fallback={
                    // During the handoff the morphed particles are the loader —
                    // a transparent fallback keeps a second skeleton from
                    // showing through (MTR-214).
                    inTransition ? (
                      <div className="h-full w-full" />
                    ) : (
                      <ViewerSkeleton label="Loading model…" />
                    )
                  }
                >
                  {/* Compare mode swaps the solid model for the thread's
                      latest and ghosts the viewed (older) revision on top;
                      both land in the same deterministic fixed frame.
                      Assemblies (MTR-174): "All parts" renders every part in
                      assembly position in ONE shared frame. A part tab drops
                      to the single-solid path so that part is re-framed to
                      fill the viewport (hide-in-place left stacked/offset
                      parts looking empty). Visibility also keys off
                      effectiveSelectedPartId — raw selectedPartId can go
                      stale across a revision and blank the canvas (MTR-188). */}
                  <ModelViewer
                    key={
                      compareBaseAssetId
                        ? `${compareBaseAssetId}::${activeAssetId}`
                        : showAssemblyOverview
                          ? `asm::${viewedTurn?.fileAssetId}`
                          : activeAssetId
                    }
                    assemblyParts={
                      showAssemblyOverview
                        ? viewedParts.map((p) => ({
                            url: `/api/files/preview/${p.fileAssetId}`,
                            name: p.name,
                            visible: true,
                          }))
                        : undefined
                    }
                    modelUrl={
                      // Live param preview: transient geometry while a chip's
                      // values are dialed. Never during compare (ghost pair
                      // must stay coherent) or assembly overview (assemblyParts
                      // takes precedence anyway).
                      paramPreviewUrl && !compareBaseAssetId
                        ? paramPreviewUrl
                        : `/api/files/preview/${
                            compareBaseAssetId ?? activeAssetId
                          }`
                    }
                    topoUrl={viewerTopoUrl}
                    highlightFaceIds={highlightFaceIds}
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
                    // Real "geometry loaded" signal gates the reveal (MTR-214);
                    // suppress the inner deforming-cloud fallback during the
                    // handoff so the morphed particles stay the only loader.
                    onReady={() => setModelReady(true)}
                    hideLoadingFallback={inTransition}
                    className="absolute inset-0 h-full w-full"
                  />
                </Suspense>
                </div>
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
                      livePoints={livePoints}
                      // Morph done → FREEZE at the final shape ("hold"); the
                      // load-gated effect flips to "reveal" once the solid is
                      // ready, so there's no timer-guessed pop (MTR-214).
                      onMorphComplete={() =>
                        setTransition((t) =>
                          t && t.phase === "morph"
                            ? { ...t, phase: "hold" }
                            : t
                        )
                      }
                    />
                  </Suspense>
                  {/* The live build preview now renders INSIDE the generation
                      thread's status bubble (round 4), not over the particle
                      cloud — so nothing competes with the backdrop here. */}
                </div>
              )}

              {/* Empty state — no model, nothing generating. A still-pending
                  turn is NOT "no model": either its job is alive (reattach
                  picks it up on load) or it died without a terminal write —
                  say which, never imply a finished-and-empty build. */}
              {!showTransition && !mountModel && (
                <div className="flex h-full w-full flex-col">
                  <Suspense fallback={<div className="min-h-0 flex-1" />}>
                    <MaterializingBlob className="min-h-0 flex-1" />
                  </Suspense>
                  {activeThread && (
                    <p className="shrink-0 px-6 pb-8 text-center text-sm text-muted-foreground">
                      {viewedTurn?.status === "pending" && viewedTurn.activeJobId
                        ? "This build is still generating — reload to reattach to its live progress."
                        : viewedTurn?.status === "pending"
                          ? "This build was interrupted before finishing — send a revision to rebuild it."
                          : "No printable model in this build yet."}
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
              position; a part tab frames that part alone (fills viewport).
              Print/Download/Save follow the selection (primary part while
              viewing All). Highlight uses effectiveSelectedPartId so a stale
              raw selection never leaves every tab unpressed. */}
          {!generating && viewedParts.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedPartId(null)}
                aria-pressed={effectiveSelectedPartId === null}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  effectiveSelectedPartId === null
                    ? "border-foreground/30 bg-foreground/5 text-foreground"
                    : "border-foreground/10 text-muted-foreground hover:bg-foreground/5"
                }`}
              >
                All parts
              </button>
              {viewedParts.map((p) => {
                const isActive = p.fileAssetId === effectiveSelectedPartId;
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

          {/* Dual-fluid isolation verdict (MTR-179) — present only on
              exchanger-class builds that declared fluid circuits. Copy states
              the voxel-resolution bound, never "leak-free" (honesty rail).
              Three states: red (verified leak/blockage), amber (part too
              large to verify at wall resolution — no verdict), green
              (verified isolated at the stated bound). */}
          {!generating &&
            viewedTurn?.networksReport &&
            (networksFailure(viewedTurn.networksReport) ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangleIcon className="size-4 shrink-0" />
                Fluid circuits not isolated —{" "}
                {networksFailure(viewedTurn.networksReport)}
              </p>
            ) : networksInconclusive(viewedTurn.networksReport) ? (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangleIcon className="size-4 shrink-0" />
                Isolation not verified —{" "}
                {networksInconclusive(viewedTurn.networksReport)}
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckIcon className="size-4 shrink-0" />
                Verified: {networksSummary(viewedTurn.networksReport)}
              </p>
            ))}

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
              <Button render={<Link href={`/print/${activeAssetId}`} />}>
                Print
              </Button>
              {/* Assembly + "All parts" selected → one .zip of every part's
                  STL ("Download Files", MTR-44). A specific part (or a single
                  solid) → that one STL. */}
              {viewedParts.length > 1 && effectiveSelectedPartId === null ? (
                <Button variant="outline" onClick={downloadAssemblyZip}>
                  <PackageIcon className="size-4" />
                  Download Files ({viewedParts.length})
                </Button>
              ) : (
                <Button
                  variant="outline"
                  render={
                    <a
                      href={`/api/files/preview/${activeAssetId}`}
                      download={`${
                        (viewedParts.length > 1
                          ? viewedParts.find(
                              (p) => p.fileAssetId === activeAssetId
                            )?.name
                          : activeThread && threadLabel(activeThread)) ||
                        "model"
                      }.stl`}
                    />
                  }
                >
                  <DownloadIcon className="size-4" />
                  Download
                </Button>
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
              <Button
                variant="outline"
                onClick={saveToProfile}
                disabled={savingModel || savedAssets.has(activeAssetId)}
                title={
                  pinnedDiffersFromLatest
                    ? "Saves the pinned (Active) version"
                    : undefined
                }
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
              </Button>
              {viewedTurn?.projectSlug && (
                <Button
                  variant="outline"
                  render={<Link href={`/projects/${viewedTurn.projectSlug}`} />}
                >
                  Open assembly project
                </Button>
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
              {annotations.length > 0 && viewedModelHasNoTopo && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This model has no exact CAD faces, so pins reference
                  approximate coordinates — the change may be less precise.
                </p>
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

          {/* Construction features (chips) + collapsible parametric source */}
          {!generating && viewedTurn?.sourceCode && (
            <div className="space-y-3">
              {viewedFeatures.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Layers className="size-4 shrink-0" />
                    <span>Features</span>
                  </div>
                  <FeatureChips
                    features={viewedFeatures}
                    sourceCode={viewedTurn.sourceCode}
                    activeId={activeFeatureId}
                    onActiveChange={setActiveFeatureId}
                    onUpdate={applyFeatureUpdate}
                    onEditStatement={applyFeatureStatementEdit}
                    onPreview={previewFeatureDraft}
                    // Single-solid viewer only: assemblies render via
                    // assemblyParts and compare mode pins a ghost pair.
                    previewEnabled={
                      viewedParts.length <= 1 && !compareBaseAssetId
                    }
                    previewPending={paramPreviewPending}
                    previewError={paramPreviewError}
                    disabled={featureUpdating}
                    markedIds={annotatedFeatureIds}
                  />
                </div>
              )}
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
          <div className="pointer-events-auto mx-auto w-full min-w-0 max-w-2xl">
          {/* Morphing generation thread (MTR-209). Present for the WHOLE
              in-flight window (submit → done), across BOTH entry paths (chip
              or typed): the composer "sends" the prompt into a right-aligned
              bubble and UNMOUNTS (below), while this left-aligned system bubble
              carries "Checking the spec" → the quick-check / mid-cycle
              questionnaire → the live status, morphing its own size between
              each. Exits (morphs back to the empty composer) on completion. */}
          <AnimatePresence>
            {inFlight && (
              <GenerationThread
                key="gen-thread"
                promptText={submittedPrompt ?? ""}
                statusText={statusText}
                statusDetail={statusDetail}
                preview={snapshot}
                pendingQuestion={pendingQuestion}
                onAnswer={answerQuestion}
                brief={brief}
                briefActive={briefActive}
                onBriefChange={setBrief}
                onBuild={submit}
                onCancelBrief={cancelBrief}
                canBuild={prompt.trim().length >= 3}
                reduce={!!reduceMotion}
              />
            )}
          </AnimatePresence>
          {/* Resting composer — UNMOUNTED while a build is in flight (round 2
              note #3): it conceptually became the sent bubble, so a disabled
              ghost input serves no purpose. It morphs back (empty) at rest. */}
          {!inFlight && (
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
                disabled={
                  generating ||
                  !planComposerSubmit(prompt, annotations.length).canSubmit
                }
                aria-label={composerLabel}
                title={composerLabel}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
              >
                <ArrowUpIcon className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          )}
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
 * shown INSIDE the generation thread's status bubble above the status line
 * (MTR-209 round 4). Cross-fades when a new frame replaces the old: the previous
 * frame stays mounted underneath while the new one transitions in (opacity only;
 * prefers-reduced-motion swaps instantly). Full-width, contained, so it sits
 * cleanly in the bubble; the bubble's `layout` springs open to hold it.
 */
function BubblePreview({ render, step }: { render: string; step: number }) {
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
    <div className="relative mb-2.5 max-h-40 overflow-hidden rounded-lg border border-foreground/10 bg-background/40">
      {prev && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${prev.render}`}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/png;base64,${render}`}
        alt="Live preview of the model being built"
        className={cn(
          "relative block max-h-40 w-full object-contain transition-opacity duration-[250ms] motion-reduce:transition-none",
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
 * The morphing generation thread (MTR-209). ONE surface that carries the whole
 * generation lifecycle in an iMessage sent/received metaphor:
 *   • the submitted prompt as a RIGHT-aligned "sent" bubble (truncated, 1 line);
 *   • a LEFT-aligned "received" system bubble that is the single evolving
 *     container — it shows a one-line status loader (with a live preview
 *     thumbnail above it once a render lands, round 4), and *physically morphs*
 *     into a full-width questionnaire (a pre-build quick-check OR a mid-cycle
 *     question) when one fires, then morphs back.
 *
 * Alignment discipline (rounds 1–3): user/sent = right, black; collapsed
 * system = left, light; an OPEN spec/questionnaire panel = full width.
 *
 * Size interpolation (round 5): the received bubble owns `layout`, so every
 * open/close/grow (status↔questionnaire, thumbnail appearing, width 85%↔full)
 * springs its size via FLIP. The content swap uses `mode="popLayout"` so the
 * incoming panel sizes the box while the outgoing fades on top — never a flash
 * of empty container, never a height snap. `reduce` collapses all of it to
 * instant opacity swaps for prefers-reduced-motion.
 *
 * Mounted for the whole in-flight window (submit → done), so the resting
 * composer is unmounted meanwhile (round 2 note #3) — it *became* this bubble.
 */
function GenerationThread({
  promptText,
  statusText,
  statusDetail,
  preview,
  pendingQuestion,
  onAnswer,
  brief,
  briefActive,
  onBriefChange,
  onBuild,
  onCancelBrief,
  canBuild,
  reduce,
}: {
  promptText: string;
  statusText: string;
  /** Live vitals under the stage label: "2m 14s · 148k tokens". */
  statusDetail: string | null;
  preview: { render: string; step: number } | null;
  pendingQuestion: {
    questionId: string;
    text: string;
    options: CadQuestionOption[];
    defaultOptionId?: string;
    answering: boolean;
  } | null;
  onAnswer: (pick: { optionId?: string; text?: string }) => void;
  brief: CadBrief | null;
  briefActive: boolean;
  onBriefChange: (b: CadBrief) => void;
  onBuild: () => void;
  onCancelBrief: () => void;
  canBuild: boolean;
  reduce: boolean;
}) {
  const spring = reduce
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 420, damping: 40, mass: 0.9 } as const);
  const fade = reduce
    ? { duration: 0 }
    : ({ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } as const);

  // An open spec/questionnaire panel expands the system bubble to full width;
  // the collapsed status stays a narrow left bubble (round 3 note #3).
  const panelOpen = !!pendingQuestion || (briefActive && !!brief);

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      transition={fade}
      className="mb-2 flex min-w-0 flex-col gap-2"
    >
      {/* Sent — the user's prompt, right-aligned, truncated to one line. The
          min-w-0 on this row (and the ancestors) lets truncate actually clip:
          without it the bubble's nowrap text expands the grid/flex track to the
          full string width and the "85%" cap resolves against an over-wide
          parent, running the bubble off the right edge (MTR-218). */}
      <motion.div layout={!reduce} className="flex min-w-0 justify-end">
        <div className="max-w-[85%] truncate rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background shadow-sm">
          {promptText}
        </div>
      </motion.div>

      {/* Received — the single evolving system container. `layout` here springs
          its size (width + height) between every state; the popLayout swap
          below cross-fades the content without an empty intermediate box. */}
      <motion.div layout={!reduce} className="flex min-w-0 justify-start">
        <motion.div
          layout={!reduce}
          transition={spring}
          className={cn(
            "overflow-hidden rounded-2xl rounded-bl-md border border-foreground/10 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80",
            panelOpen ? "w-full" : "max-w-[85%]"
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {pendingQuestion ? (
              <motion.div
                key={`q:${pendingQuestion.questionId}`}
                layout={!reduce}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="p-3.5"
              >
                <Questionnaire question={pendingQuestion} onAnswer={onAnswer} />
              </motion.div>
            ) : briefActive && brief ? (
              <motion.div
                key="brief"
                layout={!reduce}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="p-3.5"
              >
                <BriefQuestionnaire
                  brief={brief}
                  onChange={onBriefChange}
                  onBuild={onBuild}
                  onCancel={onCancelBrief}
                  canBuild={canBuild}
                />
              </motion.div>
            ) : (
              <motion.div
                key="status"
                layout={!reduce}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
                className="px-3.5 py-[7px]"
              >
                {/* Live preview render lands INSIDE the bubble, above the
                    status line (round 4). The bubble's `layout` springs open to
                    hold it — no jump. */}
                {preview && (
                  <BubblePreview render={preview.render} step={preview.step} />
                )}
                {/* One non-wrapping row: loader, stage label, then the live
                    vitals to its RIGHT (never stacked below). The loader is
                    sized under the text line-height and the padding trimmed so
                    the whole bubble never grows taller than the user's prompt
                    bubble across the gap. */}
                <div className="flex items-center gap-2.5">
                  <span className="flex shrink-0 text-muted-foreground">
                    <MetaballLoader size={18} />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {statusText}
                    </span>
                    {/* Live vitals: stage elapsed + tokens so far. Fixed
                        tabular digits so the ticking seconds don't wiggle. */}
                    {statusDetail && (
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {statusDetail}
                      </span>
                    )}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/** A full-width, contained answer card (MTR-209 round 3 look): optional
 *  thumbnail, label, a `recommended` chip on the default, and a check when
 *  armed. Selecting ARMS it (highlight) — commit is a separate deliberate
 *  action (the panel's send/Build CTA), never an instant fire on tap. */
function OptionCard({
  label,
  detail,
  thumbnail,
  recommended,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  detail?: string;
  thumbnail?: string;
  recommended?: boolean;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      title={detail}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-colors disabled:opacity-50",
        selected
          ? "border-foreground bg-foreground/[0.08]"
          : "border-foreground/15 bg-foreground/[0.03] hover:border-foreground/40 hover:bg-foreground/[0.06]"
      )}
    >
      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${thumbnail}`}
          alt=""
          className="size-12 shrink-0 rounded-lg bg-background/40 object-contain"
        />
      )}
      <span className="min-w-0 flex-1 text-sm text-foreground">{label}</span>
      {recommended && (
        <span className="shrink-0 rounded-full border border-foreground/15 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Recommended
        </span>
      )}
      {selected && (
        <CheckIcon className="size-4 shrink-0 text-foreground" strokeWidth={2.5} />
      )}
    </button>
  );
}

/**
 * The mid-cycle question (MTR-191), styled as the round-3 questionnaire
 * (MTR-209): question text on top, each answer a full-width contained card, an
 * always-present custom free-text row, a one-line helper, and a PROMINENT
 * full-width commit CTA.
 *
 * Select-then-send (round 3 note #2): tapping a card ARMS it — the build does
 * NOT fire on tap. The recommended option is pre-armed so a satisfied user can
 * just hit send. Typing in the free-text row arms the custom answer instead
 * (and its own send button commits it). One deliberate confirm either way; a
 * preset arms → `optionId`, custom → `text`.
 *
 * Exported for unit tests (select-then-send dispatch); not a public API.
 */
export function Questionnaire({
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
  const [armed, setArmed] = useState<string | null>(
    question.defaultOptionId ?? null
  );
  const [custom, setCustom] = useState("");
  const usingCustom = custom.trim().length > 0;
  const canSend = !question.answering && (usingCustom || armed !== null);

  function commit() {
    if (question.answering) return;
    if (usingCustom) onAnswer({ text: custom.trim() });
    else if (armed) onAnswer({ optionId: armed });
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {question.text}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((o) => (
          <OptionCard
            key={o.id}
            label={o.label}
            detail={o.detail}
            thumbnail={o.thumbnail}
            recommended={o.id === question.defaultOptionId}
            selected={armed === o.id && !usingCustom}
            disabled={question.answering}
            onSelect={() => {
              setArmed(o.id);
              setCustom("");
            }}
          />
        ))}

        {/* Always-present custom free-text escape hatch with its own send. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (usingCustom && !question.answering) onAnswer({ text: custom.trim() });
          }}
          className={cn(
            "flex items-center gap-2 rounded-xl border border-dashed p-1.5 pl-3 transition-colors",
            usingCustom ? "border-foreground/50" : "border-foreground/25"
          )}
        >
          <input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              if (e.target.value.trim()) setArmed(null);
            }}
            disabled={question.answering}
            maxLength={2000}
            placeholder="Or answer in your own words…"
            aria-label="Custom answer"
            // text-base on mobile keeps iOS Safari from auto-zooming the field.
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!usingCustom || question.answering}
            aria-label="Send custom answer"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30"
          >
            <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </form>
      </div>

      {/* Prominent full-width commit CTA (round 2 note #4). */}
      <button
        type="button"
        onClick={commit}
        disabled={!canSend}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background disabled:opacity-40"
      >
        {question.answering ? (
          <>
            <Loader2Icon className="size-4 animate-spin" /> Applying…
          </>
        ) : (
          <>
            {usingCustom ? "Send answer" : "Use this answer"}
            <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
          </>
        )}
      </button>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {question.answering
          ? "Applying your choice…"
          : "Pick an option or write your own, then send — the recommended choice is used if you skip."}
      </p>
    </div>
  );
}

/**
 * Pre-build quick check (MTR-191 ask-site a / MTR-194): the ONLY user-facing
 * surface of the silent brief step, styled as the round-3 questionnaire and
 * rendered INSIDE the system bubble (round 2 note #2 — it morphs out of the
 * status container, no longer a detached card). Each choice is a full-width
 * card with the recommendation pre-selected; a PROMINENT full-width Build CTA
 * commits the spec, and Cancel returns to the composer to edit the prompt.
 */
function BriefQuestionnaire({
  brief,
  onChange,
  onBuild,
  onCancel,
  canBuild,
}: {
  brief: CadBrief;
  onChange: (b: CadBrief) => void;
  onBuild: () => void;
  onCancel: () => void;
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
    <div>
      <div className="flex items-start gap-2">
        <ClipboardListIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            Quick check
          </span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {questions.length === 1
              ? "One choice before building — the recommended option is selected."
              : "A couple of choices before building — recommended options are selected."}
          </p>
        </div>
      </div>

      {questions.map((q) => {
        const chosen = chosenFor(q);
        return (
          <div key={q.id} className="mt-3">
            <p className="text-sm text-foreground">{q.question}</p>
            <div className="mt-2 flex flex-col gap-2">
              {q.options.map((o) => (
                <OptionCard
                  key={o.label}
                  label={o.label}
                  detail={o.detail}
                  recommended={o.label === q.default}
                  selected={chosen === o.label}
                  onSelect={() => choose(q, o.label)}
                />
              ))}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onBuild}
        disabled={!canBuild}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background disabled:opacity-40"
      >
        Build
        <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 w-full cursor-pointer text-center text-[11px] text-muted-foreground hover:text-foreground"
      >
        Cancel and edit prompt
      </button>
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

/** "42s" under a minute, then "2m 14s" — compact, stable-width. */
function formatElapsed(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** "740" / "9.4k" / "148k" — coarse on purpose, it's a vibe meter. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
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
    // Observability breadcrumbs (route/fallback): persisted for the job
    // trail and debugging, not user-narrated — show neutral copy. The
    // fallback copy is honest without being alarming: the build is being
    // redone by the scripted engine.
    case "route":
      return { text: "Designing your model", sub: null };
    case "fallback":
      return { text: "Rebuilding with a fresh approach", sub: null };
    // Never lands in `progress` (handled as live state) — here only to keep
    // the switch exhaustive.
    case "usage":
      return { text: "Designing your model", sub: null };
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
