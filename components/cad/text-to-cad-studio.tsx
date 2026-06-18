"use client";

import { lazy, Suspense, useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import {
  recordCadFeedback,
  renameCadGeneration,
} from "@/app/actions/cad-generation";
import type { CadStreamEvent, CadProgressEvent } from "@/lib/cad/types";
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
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSource, setShowSource] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight stream if the studio unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

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

  function startNewBuild() {
    abortRef.current?.abort();
    setGenerating(false);
    setActiveRootId(null);
    setViewTurnId(null);
    setProgress([]);
    setError(null);
    setPrompt("");
    setImages([]);
    setShowHistory(false);
    setRenaming(false);
  }

  function openThread(t: StudioThread) {
    if (generating) return;
    setActiveRootId(t.rootId);
    const lastGood = [...t.turns]
      .reverse()
      .find((x) => x.status === "succeeded" && x.fileAssetId);
    setViewTurnId(lastGood?.id ?? null);
    setProgress([]);
    setError(null);
    setShowHistory(false);
    setRenaming(false);
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
    setError(null);
    setProgress([]);
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
          prompt: text,
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

  const composerLabel = generating
    ? "Generating…"
    : activeThread
      ? "Revise"
      : "Generate";

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-44 pt-6 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <section className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                Text to CAD
              </h1>
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
                      className="text-sm font-medium text-foreground disabled:opacity-50"
                    >
                      {savingName ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="text-sm text-muted-foreground hover:text-foreground"
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
                    className="group mt-1 inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    title="Rename build"
                  >
                    <span className="truncate">{threadLabel(activeThread)}</span>
                    <PencilIcon className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
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
            <div className="aspect-square w-full bg-muted/30">
              {generating ? (
                <ProgressPanel events={progress} />
              ) : viewedTurn?.fileAssetId ? (
                <Suspense fallback={<ViewerSkeleton label="Loading model…" />}>
                  <ModelViewer
                    key={viewedTurn.fileAssetId}
                    modelUrl={`/api/files/preview/${viewedTurn.fileAssetId}`}
                    format="stl"
                    mode="detail"
                    showZoomControls
                    inspect
                    className="h-full w-full"
                  />
                </Suspense>
              ) : (
                <ViewerSkeleton
                  label={
                    activeThread
                      ? "No printable model in this build yet."
                      : "Describe a part below to start."
                  }
                />
              )}
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Actions for the viewed model */}
          {!generating && viewedTurn?.fileAssetId && (
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/print/${viewedTurn.fileAssetId}`}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Print this model
              </Link>
              <a
                href={`/api/files/preview/${viewedTurn.fileAssetId}`}
                download={`${
                  activeThread ? threadLabel(activeThread) : "model"
                }.stl`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/15 px-4 py-2 text-sm hover:bg-foreground/5"
              >
                <DownloadIcon className="size-4" />
                Download STL
              </a>
            </div>
          )}

          {/* Feedback — the in-the-moment eval signal (feeds /text-to-cad/eval) */}
          {!generating && viewedTurn?.status === "succeeded" && (
            <TurnFeedback
              key={viewedTurn.id}
              turn={viewedTurn}
              onSaved={(patch) => applyFeedback(viewedTurn.id, patch)}
            />
          )}

          {/* Revision history — collapsed until opened */}
          {!generating && turns.length > 0 && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {showHistory ? (
                  <ChevronDownIcon className="size-4" />
                ) : (
                  <ChevronRightIcon className="size-4" />
                )}
                Revision history ({turns.length})
              </button>
              {showHistory && (
                <ol className="mt-2 space-y-1.5">
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

          {/* Source code — collapsible */}
          {!generating && viewedTurn?.sourceCode && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowSource((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {showSource ? (
                  <ChevronDownIcon className="size-4" />
                ) : (
                  <ChevronRightIcon className="size-4" />
                )}
                Parametric source
              </button>
              {showSource && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
                  {viewedTurn.sourceCode}
                </pre>
              )}
            </div>
          )}
        </section>

        {/* Thread list */}
        <aside>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Builds</h2>
            <button
              type="button"
              onClick={startNewBuild}
              aria-label="New build"
              className="flex size-7 items-center justify-center rounded-md border border-foreground/15 hover:bg-foreground/5"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {threads.length === 0 && (
              <li className="text-sm text-muted-foreground">No builds yet.</li>
            )}
            {threads.map((t) => {
              const thumb = [...t.turns]
                .reverse()
                .find((x) => x.renderUrl)?.renderUrl;
              const isActive = t.rootId === activeRootId;
              return (
                <li key={t.rootId}>
                  <button
                    type="button"
                    onClick={() => openThread(t)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
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
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {/* Floating composer */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
        <div className="pointer-events-auto mx-auto max-w-3xl px-4 pb-4">
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
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={generating || images.length >= MAX_IMAGES}
                aria-label="Attach reference image"
                title="Attach reference image"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
              >
                <ImageIcon className="size-4" />
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
              <textarea
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
                    ? "Describe a change… e.g. make it 2mm taller, add a lanyard hole"
                    : "Describe a part… e.g. a parametric phone stand for a 7mm-thick phone"
                }
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={generating || prompt.trim().length < 3}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                {generating && <Loader2Icon className="size-4 animate-spin" />}
                {composerLabel}
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
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
      <div className="size-12 animate-pulse rounded-xl border-2 border-dashed border-foreground/20" />
      <ul className="w-full max-w-sm space-y-1.5 text-sm">
        {events.length === 0 && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Starting…
          </li>
        )}
        {events.map((ev, i) => {
          const isLast = i === events.length - 1;
          const d = describeEvent(ev);
          return (
            <li key={i} className={`flex items-center gap-2 ${d.tone}`}>
              {isLast ? (
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
              ) : (
                d.icon
              )}
              <span className="min-w-0 flex-1">{d.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function describeEvent(ev: CadProgressEvent): {
  text: string;
  icon: ReactNode;
  tone: string;
} {
  switch (ev.type) {
    case "phase":
      return ev.phase === "generating"
        ? {
            text:
              ev.attempt > 1
                ? `Rewriting parametric code (attempt ${ev.attempt}/${ev.maxAttempts})…`
                : "Writing parametric code…",
            icon: <CheckIcon className="size-4 shrink-0 text-muted-foreground" />,
            tone: "text-foreground",
          }
        : {
            text: "Running geometry kernel (build123d)…",
            icon: <CheckIcon className="size-4 shrink-0 text-muted-foreground" />,
            tone: "text-foreground",
          };
    case "validation":
      return ev.pass
        ? {
            text: "Solid is watertight & manifold",
            icon: <CheckIcon className="size-4 shrink-0 text-emerald-600" />,
            tone: "text-foreground",
          }
        : {
            text: `Issues: ${ev.failures.join(", ") || "invalid solid"}`,
            icon: (
              <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
            ),
            tone: "text-muted-foreground",
          };
    case "repairing":
      return {
        text: `Repairing — attempt ${ev.attempt + 1} of ${ev.maxAttempts}…`,
        icon: <RotateCwIcon className="size-4 shrink-0 text-muted-foreground" />,
        tone: "text-foreground",
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
}: {
  turn: StudioTurn;
  onSaved: (
    patch: Pick<StudioTurn, "rating" | "feedbackTags" | "feedbackNote">
  ) => void;
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
          How did it do?
        </span>
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
