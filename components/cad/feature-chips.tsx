"use client";

/**
 * Construction-timeline strip for the Prometheus studio (MTR-224).
 *
 * Each chip is one instrumented B-rep op (fillet / extrude / …) rendered in
 * op-execution order — the sidecar's emission order IS construction order —
 * as a horizontal, scrollable Fusion-style timeline. Clicking a chip
 * highlights the op's faces in the viewer and opens a compact popover with
 * Reset / Update controls when the op binds to top-level source params.
 * `markedIds` flags chips whose faces the user annotated in the viewer
 * (face→chip reverse highlight).
 *
 * The popover renders OUTSIDE the horizontal scroll container (as a sibling,
 * absolutely positioned under the strip and aligned to the open chip) so the
 * strip's `overflow-x-auto` never clips it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  BoxIcon,
  CheckIcon,
  CircleDotIcon,
  CombineIcon,
  CylinderIcon,
  LayersIcon,
  Loader2Icon,
  Rotate3dIcon,
  RotateCcwIcon,
  ShapesIcon,
  SlashIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";

import type { CadFeature } from "@/lib/cad/types";
import { editableFeatureKeys } from "@/lib/cad/features";
import {
  timelineEntries,
  type TimelineIconKind,
} from "@/components/cad/feature-timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const KIND_ICON: Record<TimelineIconKind, typeof BoxIcon> = {
  extrude: BoxIcon,
  revolve: Rotate3dIcon,
  boolean: CombineIcon,
  fillet: SparklesIcon,
  chamfer: SlashIcon,
  shell: LayersIcon,
  loft: CylinderIcon,
  hole: CircleDotIcon,
  generic: ShapesIcon,
};

/** Matches the popover's `w-56` for clamping it inside the strip. */
const POPOVER_WIDTH_PX = 224;

export interface FeatureChipsProps {
  features: CadFeature[];
  /**
   * The generation's source — editability of each control (top-level name
   * binding or span-literal, MTR-225) is derived from it client-side; the
   * server re-derives from its own copy on apply.
   */
  sourceCode: string;
  /** Currently open feature id (or null). */
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  /** Apply a control-key draft → new revision (server resolves bindings). */
  onUpdate: (
    feature: CadFeature,
    draft: Record<string, number>
  ) => Promise<{ error?: string } | void>;
  /**
   * Statement-scoped LLM edit for this chip (MTR-225). `fallback: true` in
   * the result means "retry as a normal chat revision".
   */
  onEditStatement?: (
    feature: CadFeature,
    instruction: string
  ) => Promise<{ error?: string; fallback?: boolean } | void>;
  /**
   * Live preview (docs/text-to-cad/10 interaction model): called with the
   * DEBOUNCED dirty draft while the user dials values — the parent re-runs
   * the parametric source and swaps the viewer to transient geometry — and
   * with `null` when the draft returns to clean / the popover closes, to
   * revert the viewer. Absent (or `previewEnabled` false) = the popover
   * behaves exactly as before: change values, ✓ to commit.
   */
  onPreview?: (
    feature: CadFeature,
    draft: Record<string, number> | null
  ) => void;
  /** Gate for live preview (parent turns it off for assemblies/compare). */
  previewEnabled?: boolean;
  /** A preview run is in flight — shows the dot spinner in the popover. */
  previewPending?: boolean;
  /** Last preview failure ("that radius can't be built") — inline, non-fatal. */
  previewError?: string | null;
  disabled?: boolean;
  /**
   * Feature ids to mark as "referenced" — chips owning a face the user
   * selected/annotated in the viewer (MTR-224 reverse highlight).
   */
  markedIds?: ReadonlySet<string>;
}

export function FeatureChips({
  features,
  sourceCode,
  activeId,
  onActiveChange,
  onUpdate,
  onEditStatement,
  onPreview,
  previewEnabled,
  previewPending,
  previewError,
  disabled,
  markedIds,
}: FeatureChipsProps) {
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const [popoverLeft, setPopoverLeft] = useState(0);

  const activeFeature = features.find((f) => f.id === activeId) ?? null;

  // Keep the popover under its chip: measure on open, strip scroll, and
  // resize; clamp so it never overflows the strip's own width.
  const updatePopoverLeft = useCallback(() => {
    if (!activeId) return;
    const wrapper = wrapperRef.current;
    const chip = chipRefs.current.get(activeId);
    if (!wrapper || !chip) return;
    const wRect = wrapper.getBoundingClientRect();
    const cRect = chip.getBoundingClientRect();
    const maxLeft = Math.max(0, wRect.width - POPOVER_WIDTH_PX);
    setPopoverLeft(Math.max(0, Math.min(cRect.left - wRect.left, maxLeft)));
  }, [activeId]);

  useLayoutEffect(updatePopoverLeft, [updatePopoverLeft]);
  useEffect(() => {
    if (!activeId) return;
    window.addEventListener("resize", updatePopoverLeft);
    return () => window.removeEventListener("resize", updatePopoverLeft);
  }, [activeId, updatePopoverLeft]);

  // Close on outside click (chips + popover both live inside the wrapper).
  useEffect(() => {
    if (!activeId) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) onActiveChange(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [activeId, onActiveChange]);

  // When a chip becomes marked via a viewer annotation, scroll it into view
  // (horizontal only — never scroll the page).
  const prevMarkedRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const prev = prevMarkedRef.current;
    prevMarkedRef.current = markedIds ?? new Set();
    if (!markedIds) return;
    const added = [...markedIds].filter((id) => !prev.has(id));
    const target = added[added.length - 1];
    const sc = scrollRef.current;
    const chip = target ? chipRefs.current.get(target) : undefined;
    if (!sc || !chip) return;
    const lo = chip.offsetLeft - 16;
    const hi = chip.offsetLeft + chip.offsetWidth + 16;
    if (lo < sc.scrollLeft) sc.scrollTo({ left: lo, behavior: "smooth" });
    else if (hi > sc.scrollLeft + sc.clientWidth)
      sc.scrollTo({ left: hi - sc.clientWidth, behavior: "smooth" });
  }, [markedIds]);

  if (features.length === 0) return null;

  const entries = timelineEntries(features);

  return (
    <div ref={wrapperRef} className="relative">
      <div
        ref={scrollRef}
        onScroll={updatePopoverLeft}
        className="relative overflow-x-auto pb-1"
      >
        <ol
          aria-label="Construction timeline"
          className="flex w-max items-center"
        >
          {entries.map((entry, i) => {
            const f = entry.feature;
            const Icon = KIND_ICON[entry.iconKind];
            const open = activeId === f.id;
            const marked = !open && !!markedIds?.has(f.id);
            return (
              <li key={f.id} className="flex shrink-0 items-center">
                {i > 0 && (
                  <span
                    aria-hidden
                    className="h-px w-2.5 shrink-0 bg-foreground/15"
                  />
                )}
                <button
                  ref={(el) => {
                    if (el) chipRefs.current.set(f.id, el);
                    else chipRefs.current.delete(f.id);
                  }}
                  type="button"
                  disabled={disabled}
                  aria-label={entry.accessibleName}
                  title={entry.accessibleName}
                  aria-expanded={open}
                  aria-controls={open ? panelId : undefined}
                  onClick={() => onActiveChange(open ? null : f.id)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                    open
                      ? "border-sky-500/50 bg-sky-500/10 text-foreground"
                      : marked
                        ? "border-amber-500/50 bg-amber-500/10 text-foreground"
                        : "border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">
                    {entry.step}
                  </span>
                  <Icon className="size-3.5 shrink-0" />
                  <span className="max-w-[10rem] truncate">{f.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {activeFeature && (
        <FeatureParamsPopover
          // Remount (fresh draft) whenever the open feature changes.
          key={activeFeature.id}
          panelId={panelId}
          feature={activeFeature}
          sourceCode={sourceCode}
          left={popoverLeft}
          onClose={() => onActiveChange(null)}
          onUpdate={onUpdate}
          onEditStatement={onEditStatement}
          onPreview={onPreview}
          previewEnabled={previewEnabled}
          previewPending={previewPending}
          previewError={previewError}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/** Debounce for live preview re-runs while a value is being dialed. */
const PREVIEW_DEBOUNCE_MS = 600;

function FeatureParamsPopover({
  panelId,
  feature,
  sourceCode,
  left,
  onClose,
  onUpdate,
  onEditStatement,
  onPreview,
  previewEnabled,
  previewPending,
  previewError,
  disabled,
}: {
  panelId: string;
  feature: CadFeature;
  sourceCode: string;
  left: number;
  onClose: () => void;
  onUpdate: FeatureChipsProps["onUpdate"];
  onEditStatement?: FeatureChipsProps["onEditStatement"];
  onPreview?: FeatureChipsProps["onPreview"];
  previewEnabled?: boolean;
  previewPending?: boolean;
  previewError?: string | null;
  disabled?: boolean;
}) {
  const originals = feature.params;
  const [draft, setDraft] = useState<Record<string, number>>(originals);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();

  const paramKeys = Object.keys(feature.params);
  // Editable = bound to a top-level name OR a unique literal in the
  // feature's statement span (MTR-225). Same derivation the server re-runs.
  const editable = editableFeatureKeys(feature, sourceCode);
  const hasBindings = paramKeys.some((k) => editable.has(k));
  const canEditStatement = !!onEditStatement && !!feature.span;
  const dirty = paramKeys.some((k) => draft[k] !== originals[k]);

  // Live preview: debounce the dirty draft out to the parent, and always
  // send a final `null` (revert) when the popover unmounts or the draft
  // returns to clean. Refs keep the effect off the callback identity.
  const canPreview = !!onPreview && previewEnabled !== false && hasBindings;
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const previewedRef = useRef(false);
  useEffect(() => {
    if (!canPreview) return;
    const changed: Record<string, number> = {};
    for (const key of paramKeys) {
      if (editable.has(key) && draft[key] !== originals[key]) {
        changed[key] = draft[key];
      }
    }
    if (Object.keys(changed).length === 0) {
      if (previewedRef.current) {
        previewedRef.current = false;
        onPreviewRef.current?.(feature, null);
      }
      return;
    }
    const timer = setTimeout(() => {
      previewedRef.current = true;
      onPreviewRef.current?.(feature, changed);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // paramKeys/editable derive from feature+sourceCode (stable per mount —
    // the popover remounts per feature via `key`); draft is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, canPreview, feature]);
  // Unmount (close/feature switch): revert the viewer if we previewed.
  useEffect(
    () => () => {
      if (previewedRef.current) onPreviewRef.current?.(feature, null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleReset = () => {
    setDraft(originals);
    setError(null);
  };

  const handleUpdate = () => {
    if (!hasBindings) return;
    const changed: Record<string, number> = {};
    for (const key of paramKeys) {
      if (editable.has(key) && draft[key] !== originals[key]) {
        changed[key] = draft[key];
      }
    }
    if (Object.keys(changed).length === 0) {
      setError("No bound parameters to update.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onUpdate(feature, changed);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const handleEditStatement = () => {
    const text = instruction.trim();
    if (!onEditStatement || !text) return;
    setError(null);
    startTransition(async () => {
      const res = await onEditStatement(feature, text);
      if (res && "error" in res && res.error) {
        setError(
          res.fallback
            ? `${res.error} Try asking for it as a chat revision instead.`
            : res.error
        );
        return;
      }
      onClose();
    });
  };

  return (
    <div
      id={panelId}
      role="dialog"
      aria-label={feature.label}
      style={{ left }}
      className="absolute top-full z-30 mt-1.5 w-56 rounded-lg border border-foreground/15 bg-background p-3 shadow-md"
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
            const bound = editable.has(key);
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
                  className="field-text min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-2 py-1 tabular-nums disabled:opacity-50 sm:text-xs"
                />
              </li>
            );
          })}
        </ul>
      )}

      {!hasBindings && paramKeys.length > 0 && !canEditStatement && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          These values aren&apos;t bound to named source parameters — revise
          in chat to change them.
        </p>
      )}

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

      {/* Live-preview status: the viewer is already showing the dialed
          values (or trying to); ✓ below makes them a real revision. */}
      {canPreview && (previewPending || previewError || dirty) && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px]",
            previewError ? "text-destructive" : "text-muted-foreground"
          )}
          aria-live="polite"
        >
          {previewPending ? (
            <>
              <Loader2Icon className="size-3 shrink-0 animate-spin" />
              Building preview…
            </>
          ) : (
            (previewError ?? "Previewing — ✓ saves it as a revision.")
          )}
        </p>
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
          aria-label="Save these values as a revision"
          disabled={!hasBindings || !dirty || pending || disabled}
          onClick={handleUpdate}
          className="h-7 gap-1 px-2 text-xs"
        >
          {pending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <CheckIcon className="size-3" />
          )}
          Save
        </Button>
      </div>

      {canEditStatement && (
        <form
          className="mt-3 border-t border-foreground/10 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleEditStatement();
          }}
        >
          <label
            htmlFor={`${panelId}-stmt`}
            className="mb-1 block text-[11px] text-muted-foreground"
          >
            Describe a change to this step
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`${panelId}-stmt`}
              type="text"
              value={instruction}
              maxLength={500}
              placeholder="e.g. make this fillet bigger"
              disabled={pending || disabled}
              onChange={(e) => setInstruction(e.target.value)}
              className="field-text min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-2 py-1 disabled:opacity-50 sm:text-xs"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={!instruction.trim() || pending || disabled}
              className="h-7 gap-1 px-2 text-xs"
            >
              {pending ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <WandSparklesIcon className="size-3" />
              )}
              Apply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
