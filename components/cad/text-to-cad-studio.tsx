"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  generateCadModel,
  recordCadFeedback,
} from "@/app/actions/cad-generation";
import {
  CAD_FEEDBACK_TAGS,
  CAD_FEEDBACK_TAG_LABELS,
  type CadFeedbackTag,
  type CadRating,
} from "@/lib/cad/feedback";
import { CadModelViewerLazy } from "@/components/cad/cad-model-viewer-lazy";
import { cn } from "@/lib/utils";

export interface StudioGeneration {
  id: string;
  prompt: string;
  status: "pending" | "succeeded" | "failed";
  renderUrl: string | null;
  fileAssetId: string | null;
  sourceCode: string | null;
  rating: CadRating | null;
  feedbackTags: string[];
  feedbackNote: string | null;
}

/**
 * The experimental text-to-CAD studio (owner-gated):
 *   prompt -> parametric model -> interactive 3D preview + parametric source
 *   -> "Print" into the existing quote flow, "Revise" to edit by prompt.
 * Clicking a history item re-opens it in the viewer. Each generation can be
 * rated (the in-the-moment eval signal); the scorecard lives at
 * /text-to-cad/eval.
 */
export function TextToCadStudio({
  initialGenerations,
}: {
  initialGenerations: StudioGeneration[];
}) {
  const [prompt, setPrompt] = useState("");
  const [parent, setParent] = useState<StudioGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudioGeneration | null>(
    initialGenerations.find((g) => g.status === "succeeded") ?? null
  );
  const [history, setHistory] =
    useState<StudioGeneration[]>(initialGenerations);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (prompt.trim().length < 3 || pending) return;
    setError(null);
    const submittedPrompt = prompt;
    const parentId = parent?.id;
    startTransition(async () => {
      const res = await generateCadModel({
        prompt: submittedPrompt,
        parentGenerationId: parentId,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const gen: StudioGeneration = {
        id: res.generationId,
        prompt: submittedPrompt,
        status: "succeeded",
        renderUrl: res.renderUrl,
        fileAssetId: res.fileAssetId,
        sourceCode: res.sourceCode,
        rating: null,
        feedbackTags: [],
        feedbackNote: null,
      };
      setSelected(gen);
      setHistory((h) => [gen, ...h]);
      setPrompt("");
      setParent(null);
    });
  }

  // Reflect a saved feedback edit into both the selected panel and history
  // so the UI stays consistent without a refetch.
  function applyFeedback(
    id: string,
    patch: Pick<StudioGeneration, "rating" | "feedbackTags" | "feedbackNote">
  ) {
    setHistory((h) => h.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    setSelected((s) => (s && s.id === id ? { ...s, ...patch } : s));
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[1fr_320px]">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Text to CAD</h1>
          <Link
            href="/text-to-cad/eval"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Scorecard →
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe a part in plain language. Experimental — owner preview.
        </p>

        {parent && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="truncate">
              Revising:{" "}
              <span className="text-muted-foreground">{parent.prompt}</span>
            </span>
            <button
              type="button"
              onClick={() => setParent(null)}
              className="ml-3 shrink-0 text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          rows={4}
          maxLength={2000}
          placeholder={
            parent
              ? "e.g. make it 2cm taller and add a drain hole"
              : "e.g. a parametric phone stand for a 7mm-thick phone"
          }
          className="mt-3 w-full resize-y rounded-xl border border-foreground/15 bg-card p-3 text-sm outline-none focus:border-foreground/30"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending || prompt.trim().length < 3}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? "Generating…" : parent ? "Revise model" : "Generate"}
          </button>
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter</span>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {selected && (
          <div className="mt-6 rounded-xl border border-foreground/10 p-4">
            <div className="mb-4 h-80 w-full overflow-hidden rounded-lg bg-muted/40">
              {selected.fileAssetId ? (
                <CadModelViewerLazy
                  modelUrl={`/api/files/preview/${selected.fileAssetId}`}
                  format="stl"
                  mode="detail"
                  enableWheelZoom={false}
                  showZoomControls
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No model
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {selected.fileAssetId && (
                <Link
                  href={`/print/${selected.fileAssetId}`}
                  className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                >
                  Print this model
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  setParent(selected);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-lg border border-foreground/15 px-4 py-2 text-sm"
              >
                Revise
              </button>
            </div>

            <FeedbackPanel
              key={selected.id}
              generation={selected}
              onSaved={(patch) => applyFeedback(selected.id, patch)}
            />

            {selected.sourceCode && (
              <pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
                {selected.sourceCode}
              </pre>
            )}
          </div>
        )}
      </section>

      <aside>
        <h2 className="text-sm font-medium text-muted-foreground">History</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {history.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No generations yet.
            </li>
          )}
          {history.map((g) => (
            <li
              key={g.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-2",
                selected?.id === g.id
                  ? "border-foreground/30 bg-muted/40"
                  : "border-foreground/10"
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(g)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title="Open in viewer"
              >
                {g.renderUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.renderUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded bg-muted/40 object-contain"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded bg-muted/40" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs">
                  {g.rating === "good" && "👍 "}
                  {g.rating === "bad" && "👎 "}
                  {g.prompt}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setParent(g);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Revise
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/**
 * Per-generation feedback widget. Seeded from the generation (remounted via
 * `key` when the selection changes), saves through recordCadFeedback, and
 * reports the saved values back up so history + the panel stay in sync.
 */
function FeedbackPanel({
  generation,
  onSaved,
}: {
  generation: StudioGeneration;
  onSaved: (
    patch: Pick<StudioGeneration, "rating" | "feedbackTags" | "feedbackNote">
  ) => void;
}) {
  const [rating, setRating] = useState<CadRating | null>(generation.rating);
  const [tags, setTags] = useState<CadFeedbackTag[]>(
    generation.feedbackTags.filter((t): t is CadFeedbackTag =>
      (CAD_FEEDBACK_TAGS as readonly string[]).includes(t)
    )
  );
  const [note, setNote] = useState(generation.feedbackNote ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  function toggleTag(tag: CadFeedbackTag) {
    setSaved(false);
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  function save() {
    startSaving(async () => {
      const res = await recordCadFeedback({
        generationId: generation.id,
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
    <div className="mt-4 rounded-lg border border-foreground/10 p-3">
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
              ? "border-foreground/40 bg-muted/60"
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
              ? "border-foreground/40 bg-muted/60"
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
                ? "border-foreground/40 bg-muted/60"
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
