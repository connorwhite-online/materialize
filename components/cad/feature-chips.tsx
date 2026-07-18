"use client";

/**
 * Construction-feature chip strip for the Prometheus studio.
 *
 * Each chip is one instrumented B-rep op (fillet / extrude / …). Clicking it
 * highlights the op's faces in the viewer and opens a compact popover with
 * Reset / Update controls when the op binds to top-level source params.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  BoxIcon,
  CircleDotIcon,
  CylinderIcon,
  Loader2Icon,
  RotateCcwIcon,
  ScissorsIcon,
  SlashIcon,
  SparklesIcon,
} from "lucide-react";

import type { CadFeature, CadFeatureOp } from "@/lib/cad/types";
import { featureParamsToSourceParams } from "@/lib/cad/features";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const OP_ICON: Record<CadFeatureOp, typeof BoxIcon> = {
  extrude: BoxIcon,
  fillet: SparklesIcon,
  chamfer: SlashIcon,
  loft: CylinderIcon,
  revolve: CircleDotIcon,
  shell: BoxIcon,
  hole: CircleDotIcon,
  boolean: ScissorsIcon,
  other: BoxIcon,
};

export interface FeatureChipsProps {
  features: CadFeature[];
  /** Currently open feature id (or null). */
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  /** Apply substituted params → new revision. */
  onUpdate: (
    feature: CadFeature,
    sourceParams: Record<string, number>
  ) => Promise<{ error?: string } | void>;
  disabled?: boolean;
}

export function FeatureChips({
  features,
  activeId,
  onActiveChange,
  onUpdate,
  disabled,
}: FeatureChipsProps) {
  if (features.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {features.map((f) => (
        <FeatureChip
          key={f.id}
          feature={f}
          open={activeId === f.id}
          onOpenChange={(open) => onActiveChange(open ? f.id : null)}
          onUpdate={onUpdate}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FeatureChip({
  feature,
  open,
  onOpenChange,
  onUpdate,
  disabled,
}: {
  feature: CadFeature;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: FeatureChipsProps["onUpdate"];
  disabled?: boolean;
}) {
  const Icon = OP_ICON[feature.op] ?? BoxIcon;
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const originals = feature.params;
  const [draft, setDraft] = useState<Record<string, number>>(originals);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset draft when the feature identity / baseline changes or the popover opens.
  useEffect(() => {
    if (open) {
      setDraft(feature.params);
      setError(null);
    }
  }, [open, feature.id, feature.params]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  const paramKeys = Object.keys(feature.params);
  const hasBindings =
    !!feature.paramNames &&
    Object.keys(feature.paramNames).length > 0 &&
    paramKeys.some((k) => feature.paramNames?.[k]);
  const dirty = paramKeys.some((k) => draft[k] !== originals[k]);

  const handleReset = () => {
    setDraft(originals);
    setError(null);
  };

  const handleUpdate = () => {
    if (!hasBindings) return;
    const sourceParams = featureParamsToSourceParams(feature, draft);
    if (Object.keys(sourceParams).length === 0) {
      setError("No bound parameters to update.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onUpdate(feature, sourceParams);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
          open
            ? "border-sky-500/50 bg-sky-500/10 text-foreground"
            : "border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="max-w-[10rem] truncate">{feature.label}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={feature.label}
          className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-lg border border-foreground/15 bg-background p-3 shadow-md"
        >
          <div className="mb-2 text-xs font-medium text-foreground">
            {feature.label}
          </div>

          {paramKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No numeric controls for this feature. Revise it in chat.
            </p>
          ) : (
            <ul className="space-y-2">
              {paramKeys.map((key) => {
                const bound = !!feature.paramNames?.[key];
                return (
                  <li key={key} className="flex items-center gap-2">
                    <label
                      htmlFor={`${panelId}-${key}`}
                      className="w-16 shrink-0 truncate text-[11px] text-muted-foreground"
                      title={feature.paramNames?.[key] ?? key}
                    >
                      {key}
                    </label>
                    <input
                      id={`${panelId}-${key}`}
                      type="number"
                      step="any"
                      disabled={!bound || pending || disabled}
                      value={Number.isFinite(draft[key]) ? draft[key] : ""}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setDraft((d) => ({ ...d, [key]: n }));
                      }}
                      className="min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-2 py-1 text-xs tabular-nums disabled:opacity-50"
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {!hasBindings && paramKeys.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              These values aren&apos;t bound to named source parameters — revise
              in chat to change them.
            </p>
          )}

          {error && (
            <p className="mt-2 text-[11px] text-destructive">{error}</p>
          )}

          <div className="mt-3 flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!dirty || pending || disabled}
              onClick={handleReset}
              className="h-7 gap-1 px-2 text-xs"
            >
              <RotateCcwIcon className="size-3" />
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!hasBindings || !dirty || pending || disabled}
              onClick={handleUpdate}
              className="h-7 gap-1 px-2 text-xs"
            >
              {pending ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : null}
              Update
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
