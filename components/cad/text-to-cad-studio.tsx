"use client";

import { lazy, Suspense, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  BoxesIcon,
  CheckIcon,
  Code2Icon,
  DownloadIcon,
  EllipsisVerticalIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ChevronDown } from "@/components/icons/chevron-down";
import { ChevronRight } from "@/components/icons/chevron-right";
import {
  deleteCadBuild,
  recordCadFeedback,
  renameCadGeneration,
  saveCadFileToProfile,
} from "@/app/actions/cad-generation";
import type { CadStreamEvent, CadProgressEvent } from "@/lib/cad/types";
import type { ViewerAnnotation } from "@/components/viewer/model-viewer";
import {
  CAD_FEEDBACK_TAGS,
  CAD_FEEDBACK_TAG_LABELS,
  type CadFeedbackTag,
  type CadRating,
} from "@/lib/cad/feedback";
import { cn } from "@/lib/utils";

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
}

export interface StudioThread {
  rootId: string;
  title: string | null;
  lastActivity: number;
  turns: StudioTurn[];
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

function threadLabel(t: StudioThread): string {
  return t.title?.trim() || truncate(t.turns[0]?.prompt ?? "Untitled build");
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
  // Open the most recent build on load (like reopening a chat); "New build"
  // resets to a blank canvas.
  const [activeRootId, setActiveRootId] = useState<string | null>(
    initialThreads[0]?.rootId ?? null
  );
  const [viewTurnId, setViewTurnId] = useState<string | null>(() => {
    const first = initialThreads[0];
    if (!first) return null;
    return (
      [...first.turns]
        .reverse()
        .find((x) => x.status === "succeeded" && x.fileAssetId)?.id ?? null
    );
  });
  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState<CadProgressEvent[]>([]);
  const [generating, setGenerating] = useState(false);
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
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotations, setAnnotations] = useState<StudioAnnotation[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight stream if the studio unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Close the build three-dot menu on any outside click.
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

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
  const turns = activeThread?.turns ?? [];
  const latestTurn = turns[turns.length - 1] ?? null;

  // Which turn's model fills the viewer: the explicitly selected one, else the
  // most recent successful turn in the active thread.
  const viewedTurn =
    (viewTurnId
      ? turns.find((t) => t.id === viewTurnId && t.fileAssetId)
      : null) ??
    [...turns].reverse().find((t) => t.status === "succeeded" && t.fileAssetId) ??
    null;

  // For an assembly, the viewer/print/download act on the selected part; for a
  // single solid (or a stale selection) fall back to the turn's primary asset.
  const viewedParts = viewedTurn?.parts ?? [];
  const activeAssetId =
    viewedParts.find((p) => p.fileAssetId === selectedPartId)?.fileAssetId ??
    viewedTurn?.fileAssetId ??
    null;

  // Annotations are tied to a specific model — drop them (and exit pin mode)
  // whenever the viewed asset changes (new turn, switched part, opened build).
  useEffect(() => {
    setAnnotations([]);
    setAnnotateMode(false);
  }, [activeAssetId]);

  function startNewBuild() {
    abortRef.current?.abort();
    setGenerating(false);
    setTransition(null);
    setSourceAssetId(null);
    setActiveRootId(null);
    setViewTurnId(null);
    setProgress([]);
    setError(null);
    setPrompt("");
    setImages([]);
    setSelectedPartId(null);
    setShowHistory(false);
    setRenaming(false);
  }

  function openThread(t: StudioThread) {
    if (generating) return;
    setTransition(null);
    setSourceAssetId(null);
    setActiveRootId(t.rootId);
    const lastGood = [...t.turns]
      .reverse()
      .find((x) => x.status === "succeeded" && x.fileAssetId);
    setViewTurnId(lastGood?.id ?? null);
    setProgress([]);
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
    };
    const now = Date.now();

    if (parentId) {
      // Revision: append to the active thread.
      setThreads((prev) =>
        prev
          .map((t) =>
            t.rootId === activeRootId
              ? { ...t, turns: [...t.turns, newTurn], lastActivity: now }
              : t
          )
          .sort((a, b) => b.lastActivity - a.lastActivity)
      );
    } else {
      // New build: open a fresh thread.
      const thread: StudioThread = {
        rootId: ev.generationId,
        title: ev.title,
        lastActivity: now,
        turns: [newTurn],
      };
      setThreads((prev) => [thread, ...prev]);
      setActiveRootId(ev.generationId);
    }
    setViewTurnId(ev.generationId);
    // Kick off the loader→model morph (the blob is still on screen here; it
    // morphs into this asset, then we crossfade to the real viewer). No asset
    // means nothing to morph into — fall straight through to the empty state.
    setTransition(ev.fileAssetId ? { assetId: ev.fileAssetId, phase: "morph" } : null);
    // Clear the composer only now that the turn landed — on an error the
    // user's typed instruction (and any attached refs) stay put to retry.
    setPrompt("");
    setImages([]);
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

  async function submit() {
    const text = prompt.trim();
    if (text.length < 3 || generating) return;

    const parentId = latestTurn?.id; // revise the latest turn when in a thread

    // Fold pinned annotations into the instruction sent to the agent, as
    // structured spatial feedback (the displayed turn keeps the clean text).
    const fmt = (p: readonly number[]) => p.map((n) => n.toFixed(1)).join(", ");
    const annoBlock = annotations.length
      ? "\n\nAnnotated selections on the current model (mm, model coordinates):\n" +
        annotations
          .map((a, i) => {
            const note = a.note.trim();
            if (a.kind === "edge") {
              return `#${i + 1} — edge from (${fmt(a.edge.a)}) to (${fmt(
                a.edge.b
              )}), length ${a.edge.length.toFixed(1)} mm: ${
                note || "(address this edge)"
              }`;
            }
            const sz = a.extent.some((n) => n > 0)
              ? `, ~${a.extent.map((n) => n.toFixed(0)).join("×")} mm`
              : "";
            return `#${i + 1} — face centered at (${fmt(a.point)})${sz}, normal (${a.normal
              .map((n) => n.toFixed(2))
              .join(", ")}): ${note || "(address this face)"}`;
          })
          .join("\n")
      : "";
    const sentPrompt = text + annoBlock;

    setError(null);
    setProgress([]);
    // A revision deforms the model currently on screen (edit-in-place); a fresh
    // build has none, so the wireframe blob deforms instead.
    setSourceAssetId(parentId ? activeAssetId : null);
    setTransition(null);
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
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError((await res.text()) || "Generation failed.");
        return;
      }

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
            applyDone(ev, text, parentId);
          } else if (ev.type === "error") {
            setError(ev.error);
          } else {
            setProgress((p) => [...p, ev]);
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError("Generation failed. Please try again.");
      }
    } finally {
      setGenerating(false);
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
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-44 pt-6 lg:h-full lg:min-h-0 lg:pb-0 lg:grid-cols-[1fr_300px]">
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
                    className="group inline-flex max-w-full cursor-pointer items-center gap-2 text-xl font-semibold tracking-tight text-foreground"
                    title="Rename build"
                  >
                    <span className="truncate">{threadLabel(activeThread)}</span>
                    <PencilIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeThread
                    ? threadLabel(activeThread)
                    : "Describe a part in plain language. Experimental — owner preview."}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={startNewBuild}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5"
            >
              <PlusIcon className="size-4" />
              New build
            </button>
          </div>

          {/* Viewer / progress / empty state */}
          <div className="mt-5 overflow-hidden rounded-xl border border-foreground/10">
            <div className="relative aspect-[4/3] w-full bg-muted/30 lg:aspect-auto lg:h-[clamp(260px,46vh,520px)]">
              {/* Crisp model — the BASE layer (fixed frame). Stays mounted
                  under the transition so the morph fades to reveal it with no
                  remount/zoom; on a revision it's the shape being deformed. */}
              {showModel && activeAssetId && (
                <Suspense fallback={<ViewerSkeleton label="Loading model…" />}>
                  <ModelViewer
                    key={activeAssetId}
                    modelUrl={`/api/files/preview/${activeAssetId}`}
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
                  {generating && !transition && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                      <div className="glass rounded-2xl px-5 py-4 shadow-lg">
                        <ProgressPanel events={progress} />
                      </div>
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
                  <p className="shrink-0 px-6 pb-8 text-center text-sm text-muted-foreground">
                    {activeThread
                      ? "No printable model in this build yet."
                      : "Describe a part below to start."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Assembly part selector — switch which part the viewer/actions
              target. Shown only for multi-part builds. */}
          {!generating && viewedParts.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {viewedParts.length} parts:
              </span>
              {viewedParts.map((p) => {
                const isActive = p.fileAssetId === activeAssetId;
                return (
                  <button
                    key={p.fileAssetId}
                    type="button"
                    onClick={() => setSelectedPartId(p.fileAssetId)}
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
              <button
                type="button"
                onClick={saveToProfile}
                disabled={savingModel || savedAssets.has(activeAssetId)}
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
        <aside className="flex flex-col gap-5 self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-7rem)] lg:min-h-0">
          {/* Revisions for the current build */}
          {!generating && turns.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <HistoryIcon className="size-4 shrink-0" />
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
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          disabled={!selectable}
                          onClick={() => setViewTurnId(t.id)}
                          className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            isViewed
                              ? "border-foreground/30 bg-foreground/5"
                              : "border-foreground/10 hover:bg-foreground/5"
                          } ${selectable ? "" : "opacity-60"}`}
                        >
                          <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                            {i === 0 ? "Start" : `#${i}`}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{t.prompt}</span>
                            {t.status === "failed" && (
                              <span className="text-xs text-destructive">
                                {t.error ?? "failed"}
                              </span>
                            )}
                          </span>
                        </button>
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
                className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <Code2Icon className="size-4 shrink-0" />
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

          {/* Build history — collapsible; header fixed, list scrolls */}
          <div className="flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => setShowBuilds((v) => !v)}
              className="flex w-full shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <BoxesIcon className="size-4 shrink-0" />
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
                maskImage:
                  "linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)",
              }}
            >
              {threads.length === 0 && (
                <li className="text-sm text-muted-foreground">No builds yet.</li>
              )}
              {threads.map((t) => {
                // Still PNG render captured per generation (newest with one).
                const thumb = [...t.turns]
                  .reverse()
                  .find((x) => x.renderUrl)?.renderUrl;
                const isActive = t.rootId === activeRootId;
                return (
                  <li key={t.rootId} className="relative">
                    <button
                      type="button"
                      onClick={() => openThread(t)}
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
                        setOpenMenuId((id) => (id === t.rootId ? null : t.rootId));
                      }}
                      className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                    >
                      <EllipsisVerticalIcon className="size-4" />
                    </button>
                    {openMenuId === t.rootId && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-1.5 top-10 z-20 min-w-[130px] rounded-lg border border-foreground/15 bg-card p-1 shadow-lg"
                      >
                        <button
                          type="button"
                          onClick={() => deleteBuild(t)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                        >
                          <Trash2Icon className="size-4" />
                          Delete build
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
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
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 nav:pl-56">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-4 lg:grid-cols-[1fr_300px]">
          <div className="pointer-events-auto mx-auto w-full max-w-2xl">
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
                  : "Describe a part… e.g. a parametric phone stand for a 7mm-thick phone"
              }
              className="max-h-[200px] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-60"
            />
            {/* Toolbar below the text: attach (left), send (right). */}
            <div className="flex items-center justify-between px-1 pt-1">
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
          <p className="mt-1.5 px-2 text-center text-xs text-muted-foreground">
            {activeThread
              ? "Sending a message revises this build · ⌘/Ctrl + Enter"
              : "⌘/Ctrl + Enter to generate"}
          </p>
          </div>
        </div>
      </div>
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

/** Renders the streamed harness transcript as a live checklist. */
function ProgressPanel({ events }: { events: CadProgressEvent[] }) {
  // Only ever show the current step — the live status, not a transcript.
  const current = events[events.length - 1];
  const d = current
    ? describeEvent(current)
    : { text: "Getting started", sub: null as string | null };
  return (
    <div className="flex items-center gap-3 text-sm">
      <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      <div className="flex flex-col">
        <span className="font-medium text-foreground">{d.text}</span>
        {d.sub && (
          <span className="text-xs text-muted-foreground">{d.sub}</span>
        )}
      </div>
    </div>
  );
}

function describeEvent(ev: CadProgressEvent): {
  text: string;
  sub: string | null;
} {
  switch (ev.type) {
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
