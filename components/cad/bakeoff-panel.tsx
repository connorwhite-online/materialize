"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CadStreamEvent } from "@/lib/cad/types";
import type { CadEngineId } from "@/lib/cad/engines";
import {
  bakeoffVerdict,
  elapsedMs,
  initialPane,
  reduceBakeoffEvent,
  type BakeoffPane,
} from "./bakeoff-state";

/**
 * Owner-only side-by-side engine comparison (docs/text-to-cad/11).
 *
 * Deliberately a SEPARATE surface rather than a mode inside
 * text-to-cad-studio.tsx. Two reasons: side-by-side is a different layout,
 * not a variation on the studio's; and this is a comparison with a scheduled
 * end, so it should delete in one directory when the losing engine is
 * retired rather than leave a mode threaded through 3.7k lines.
 *
 * All the interesting logic lives in ./bakeoff-state (pure, unit-tested).
 * This file is rendering and one EventSource per arm.
 */

const ENGINE_LABEL: Record<CadEngineId, string> = {
  brep: "build123d (B-rep)",
  sdf: "sdf_kit (implicit)",
};

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(0)}s`;
}

function PaneCard({ pane, tick }: { pane: BakeoffPane; tick: number }) {
  const running = pane.status === "queued" || pane.status === "running";
  const preview = pane.renderUrl ?? pane.snapshotPng ?? null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-sm font-medium">{ENGINE_LABEL[pane.engine]}</h2>
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            pane.status === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {/* `tick` is read here so the elapsed clock re-renders each second
              while running; it is intentionally unused otherwise. */}
          {secs(elapsedMs(pane, tick))}
        </span>
      </div>

      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-muted/40">
        {preview ? (
          /* Plain <img>: a base64 snapshot has nothing for the optimizer to
             fetch, and a presigned R2 render expires — next/image would
             cache a URL that dies. Both bypass it by design. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              pane.renderUrl ??
              `data:image/png;base64,${pane.snapshotPng ?? ""}`
            }
            alt={`${ENGINE_LABEL[pane.engine]} result`}
            className="h-full w-full object-contain"
          />
        ) : (
          <Loader2Icon
            className={cn(
              "size-5 text-muted-foreground",
              running && "animate-spin"
            )}
          />
        )}
      </div>

      <p className="min-h-10 text-xs text-muted-foreground">
        {pane.status === "error" ? (
          <span className="text-destructive">{pane.error}</span>
        ) : pane.status === "done" ? (
          <>
            Valid mesh in {secs(elapsedMs(pane))}
            {pane.attempt ? ` · ${pane.attempt} attempt(s)` : ""}
            {pane.fileSlug ? (
              <>
                {" · "}
                <a className="underline" href={`/files/${pane.fileSlug}`}>
                  open
                </a>
              </>
            ) : null}
          </>
        ) : pane.phase ? (
          <>
            {pane.phase === "generating" ? "Writing code" : "Running geometry"}
            {pane.attempt ? ` · attempt ${pane.attempt}/${pane.maxAttempts}` : ""}
          </>
        ) : (
          "Queued"
        )}
      </p>
    </div>
  );
}

export function BakeoffPanel() {
  const [prompt, setPrompt] = useState("");
  const [panes, setPanes] = useState<BakeoffPane[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const sourcesRef = useRef<EventSource[]>([]);

  // Drive the elapsed clocks. One interval for the whole panel, and only
  // while something is in flight.
  const live = panes.some((p) => p.status === "queued" || p.status === "running");
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  // Close every stream on unmount so navigating away cannot leak connections.
  useEffect(
    () => () => {
      for (const es of sourcesRef.current) es.close();
      sourcesRef.current = [];
    },
    []
  );

  const run = useCallback(async () => {
    if (prompt.trim().length < 3 || starting) return;
    setStarting(true);
    setStartError(null);
    for (const es of sourcesRef.current) es.close();
    sourcesRef.current = [];

    try {
      const res = await fetch("/api/cad/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), compare: true }),
      });
      if (!res.ok) {
        setStartError(await res.text());
        return;
      }
      const body = (await res.json()) as {
        runs: { generationId: string; jobId: string; engine: CadEngineId }[];
      };
      setPanes(body.runs.map(initialPane));

      for (const arm of body.runs) {
        const es = new EventSource(`/api/cad/jobs/${arm.jobId}/events`);
        es.onmessage = (msg) => {
          let event: CadStreamEvent;
          try {
            event = JSON.parse(msg.data) as CadStreamEvent;
          } catch {
            return; // a malformed frame must not kill the other arm
          }
          setPanes((current) =>
            current.map((p) =>
              p.jobId === arm.jobId ? reduceBakeoffEvent(p, event) : p
            )
          );
          if (event.type === "done" || event.type === "error") es.close();
        };
        // A dropped connection is not a failed build — the job keeps running
        // server-side and the row is the source of truth. Close the stream
        // and leave the pane as-is rather than reporting a failure that did
        // not happen.
        es.onerror = () => es.close();
        sourcesRef.current.push(es);
      }
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }, [prompt, starting]);

  const verdict = panes.length > 0 ? bakeoffVerdict(panes) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a part — both engines build it from this same prompt."
          rows={3}
          className="field-text w-full resize-y rounded-xl border border-border bg-background p-3 outline-none focus:ring-2 focus:ring-ring sm:text-sm"
        />
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={starting || prompt.trim().length < 3}>
            {starting ? "Starting…" : "Run both engines"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Runs two full generations — double the model and sidecar spend.
          </span>
        </div>
        {startError ? (
          <p className="text-xs text-destructive">{startError}</p>
        ) : null}
      </div>

      {panes.length > 0 ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row">
            {panes.map((p) => (
              <PaneCard key={p.jobId} pane={p} tick={tick} />
            ))}
          </div>
          {verdict?.settled ? (
            <p className="text-sm">
              {verdict.winner ? (
                <>
                  <span className="font-medium">
                    {ENGINE_LABEL[verdict.winner]}
                  </span>{" "}
                  — {verdict.reason}
                </>
              ) : (
                verdict.reason
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
