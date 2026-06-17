"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { generateCadModel } from "@/app/actions/cad-generation";

export interface StudioGeneration {
  id: string;
  prompt: string;
  status: "pending" | "succeeded" | "failed";
  renderUrl: string | null;
  fileAssetId: string | null;
}

interface CurrentResult {
  generationId: string;
  fileAssetId: string;
  fileSlug: string;
  renderUrl: string | null;
  sourceCode: string;
}

/**
 * The experimental text-to-CAD studio (owner-gated). Prompt -> generated
 * parametric model -> preview + "Print this model" into the existing quote
 * flow. Picking a prior generation seeds an "edit existing" revision.
 */
export function TextToCadStudio({
  initialGenerations,
}: {
  initialGenerations: StudioGeneration[];
}) {
  const [prompt, setPrompt] = useState("");
  const [parent, setParent] = useState<StudioGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentResult | null>(null);
  const [history, setHistory] = useState<StudioGeneration[]>(initialGenerations);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (prompt.trim().length < 3 || pending) return;
    setError(null);
    const submittedPrompt = prompt;
    startTransition(async () => {
      const res = await generateCadModel({
        prompt: submittedPrompt,
        parentGenerationId: parent?.id,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setCurrent(res);
      setHistory((h) => [
        {
          id: res.generationId,
          prompt: submittedPrompt,
          status: "succeeded",
          renderUrl: res.renderUrl,
          fileAssetId: res.fileAssetId,
        },
        ...h,
      ]);
      setPrompt("");
      setParent(null);
    });
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Text to CAD</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe a part in plain language. Experimental — owner preview.
        </p>

        {parent && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="truncate">
              Editing: <span className="text-muted-foreground">{parent.prompt}</span>
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

        {current && (
          <div className="mt-6 rounded-xl border border-foreground/10 p-4">
            {current.renderUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.renderUrl}
                alt="Generated model preview"
                className="mb-4 w-full rounded-lg bg-muted/40 object-contain"
              />
            )}
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/print/${current.fileAssetId}`}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              >
                Print this model
              </Link>
              <button
                type="button"
                onClick={() => {
                  setParent({
                    id: current.generationId,
                    prompt: "",
                    status: "succeeded",
                    renderUrl: current.renderUrl,
                    fileAssetId: current.fileAssetId,
                  });
                }}
                className="rounded-lg border border-foreground/15 px-4 py-2 text-sm"
              >
                Edit
              </button>
            </div>
            <pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-muted/40 p-3 text-xs">
              {current.sourceCode}
            </pre>
          </div>
        )}
      </section>

      <aside>
        <h2 className="text-sm font-medium text-muted-foreground">History</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {history.length === 0 && (
            <li className="text-sm text-muted-foreground">No generations yet.</li>
          )}
          {history.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-3 rounded-lg border border-foreground/10 p-2"
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
              <span className="min-w-0 flex-1 truncate text-xs">{g.prompt}</span>
              <div className="flex shrink-0 gap-1.5">
                {g.fileAssetId && (
                  <Link
                    href={`/print/${g.fileAssetId}`}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Print
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setParent(g)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
