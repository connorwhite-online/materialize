"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleDashedIcon, Loader2Icon } from "lucide-react";

import { runCadTemplate } from "@/app/actions/cad-generation";
import { cn } from "@/lib/utils";

/** One read-only parameter (top-level numeric assignment) of an exemplar. */
export interface ExemplarParam {
  name: string;
  value: number;
}

/** What the debug gallery needs to show + build one verified exemplar. */
export interface ExemplarDescriptor {
  id: string;
  title: string;
  lesson: string;
  keywords: string[];
  verified: boolean;
  params: ExemplarParam[];
}

/** Trim float noise from a parameter literal ("2.4", not "2.4000…4"). */
function fmtParam(n: number): string {
  return String(Number(n.toFixed(4)));
}

type BuildState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "error"; message: string }
  | { status: "built"; renderUrl: string | null; fileAssetId: string };

/**
 * Owner-only exemplar debug gallery (MTR-208). Lists every exemplar with its
 * verified flag + read-only params; "Build this" runs the verified source
 * through `runCadTemplate` (the same render/thumbnail path the old user-facing
 * template gallery used) and shows the resulting render inline. Unverified
 * exemplars can't be built — `runCadTemplate` only instantiates verified ones —
 * so the button self-disables for them.
 */
export function ExemplarsDebug({
  exemplars,
}: {
  exemplars: ExemplarDescriptor[];
}) {
  const [builds, setBuilds] = useState<Record<string, BuildState>>({});

  async function build(ex: ExemplarDescriptor) {
    if (!ex.verified) return;
    setBuilds((prev) => ({ ...prev, [ex.id]: { status: "building" } }));
    try {
      // Build with the exemplar's own authored parameter values — deterministic
      // and watertight-by-construction (the sliders are gone; this is a
      // straight instantiation of the proven source).
      const params = Object.fromEntries(ex.params.map((p) => [p.name, p.value]));
      const res = await runCadTemplate({ exemplarId: ex.id, params });
      if ("error" in res) {
        setBuilds((prev) => ({
          ...prev,
          [ex.id]: { status: "error", message: res.error },
        }));
        return;
      }
      setBuilds((prev) => ({
        ...prev,
        [ex.id]: {
          status: "built",
          renderUrl: res.renderUrl,
          fileAssetId: res.fileAssetId,
        },
      }));
    } catch {
      setBuilds((prev) => ({
        ...prev,
        [ex.id]: { status: "error", message: "Build failed. Try again." },
      }));
    }
  }

  const verifiedCount = exemplars.filter((e) => e.verified).length;

  return (
    <div className="mt-6">
      <p className="mb-3 text-xs text-muted-foreground/80">
        {verifiedCount} of {exemplars.length} verified.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {exemplars.map((ex) => {
          const state = builds[ex.id] ?? { status: "idle" };
          return (
            <li
              key={ex.id}
              className="flex flex-col rounded-xl border border-foreground/10 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {ex.title}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground/70">
                    {ex.id}
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                    ex.verified
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-foreground/15 text-muted-foreground"
                  )}
                >
                  {ex.verified ? (
                    <CheckCircle2Icon className="size-3" />
                  ) : (
                    <CircleDashedIcon className="size-3" />
                  )}
                  {ex.verified ? "verified" : "unverified"}
                </span>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">{ex.lesson}</p>

              {/* Render thumbnail — only exists after a build (the exemplar
                  source carries no pre-render). */}
              {state.status === "built" && state.renderUrl && (
                <Link
                  href={`/print/${state.fileAssetId}`}
                  className="mt-3 block overflow-hidden rounded-lg border border-foreground/10 bg-muted/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={state.renderUrl}
                    alt={`${ex.title} render`}
                    className="mx-auto max-h-40 w-auto object-contain"
                  />
                </Link>
              )}

              {/* Read-only params. */}
              {ex.params.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  {ex.params.map((p) => (
                    <div key={p.name} className="flex justify-between gap-2">
                      <dt className="truncate text-muted-foreground">
                        {p.name}
                      </dt>
                      <dd className="shrink-0 font-mono text-foreground">
                        {fmtParam(p.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-auto pt-3">
                {state.status === "error" && (
                  <p className="mb-2 text-xs text-destructive">
                    {state.message}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => build(ex)}
                  disabled={!ex.verified || state.status === "building"}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state.status === "building" && (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  {state.status === "built"
                    ? "Rebuild"
                    : state.status === "building"
                      ? "Building…"
                      : "Build this"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
