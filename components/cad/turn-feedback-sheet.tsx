"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckIcon, CircleDashedIcon } from "lucide-react";
import { ChevronUp } from "@/components/icons/chevron-up";
import { NativeSheet } from "@/components/ui/native-sheet";
import { recordCadFeedback } from "@/app/actions/cad-generation";
import {
  CAD_FEEDBACK_TAGS,
  CAD_FEEDBACK_TAG_LABELS,
  type CadFeedbackTag,
  type CadRating,
} from "@/lib/cad/feedback";
import { cn } from "@/lib/utils";

/**
 * Turn-feedback bottom sheet — the in-the-moment human eval signal
 * (rating + failure-mode tags + note) that feeds the scorecard at
 * /prometheus/eval.
 *
 * Lives in a sheet rather than inline in the studio column: the feedback
 * card used to push the model actions down the page on every unrated turn,
 * and on a phone it landed below the fold entirely. As a sheet it's a
 * deliberate surface, and `NativeSheet` handles the keyboard-height math
 * for the note field (see its KEYBOARD note).
 *
 * The auto-prompt is the CALLER's decision, not this component's — it opens
 * when a build finishes, not merely when an unrated turn is viewed, so
 * clicking back through thread history never throws a modal in your face.
 */

/** Just the feedback-bearing slice of a studio turn (avoids a type cycle). */
export interface TurnFeedbackTarget {
  id: string;
  rating: CadRating | null;
  feedbackTags: string[];
  feedbackNote: string | null;
}

export type TurnFeedbackPatch = {
  rating: CadRating | null;
  feedbackTags: CadFeedbackTag[];
  feedbackNote: string | null;
};

/** True when a turn already carries any feedback signal. */
export function hasFeedback(turn: TurnFeedbackTarget): boolean {
  return (
    !!turn.rating || turn.feedbackTags.length > 0 || !!turn.feedbackNote
  );
}

/**
 * The row that opens the sheet, sitting where the inline feedback card used
 * to live. Its leading glyph IS the status: a dotted circle while this
 * revision is unrated (an open loop — something still to do), a solid filled
 * check once feedback is saved. The trailing chevron says "this opens a sheet"
 * rather than "this navigates".
 *
 * Lives beside `hasFeedback` on purpose: the saved/unsaved rendering and the
 * predicate that decides it should never drift into different files.
 */
export function TurnFeedbackTrigger({
  turn,
  onOpen,
}: {
  turn: TurnFeedbackTarget;
  onOpen: () => void;
}) {
  const saved = hasFeedback(turn);
  const ratingGlyph =
    turn.rating === "good" ? "👍" : turn.rating === "bad" ? "👎" : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={saved ? "Edit feedback for this revision" : "Add feedback for this revision"}
      className={cn(
        "mt-4 inline-flex items-center gap-2 rounded-full border py-1.5 pl-2 pr-2.5 text-xs transition-colors",
        saved
          ? "border-emerald-600/30 text-foreground hover:bg-emerald-500/10"
          : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      {saved ? (
        // A real filled disc: lucide's circle-check is stroke-based, and
        // filling that svg would flood the check path too — so the disc is
        // the wrapper and the check sits on top of it.
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-600">
          <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />
        </span>
      ) : (
        <CircleDashedIcon className="size-4 shrink-0" />
      )}
      <span>
        {saved ? "Feedback saved" : "Add feedback"}
        {ratingGlyph ? ` ${ratingGlyph}` : ""}
      </span>
      <ChevronUp size={12} className="shrink-0 opacity-60" />
    </button>
  );
}

export function TurnFeedbackSheet({
  open,
  turn,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null while no turn is targeted — the sheet stays closed. */
  turn: TurnFeedbackTarget | null;
  onClose: () => void;
  onSaved: (patch: TurnFeedbackPatch) => void;
}) {
  const [rating, setRating] = useState<CadRating | null>(null);
  const [tags, setTags] = useState<CadFeedbackTag[]>([]);
  const [note, setNote] = useState("");
  const [saving, startSaving] = useTransition();

  // Re-seed from the targeted turn each time the sheet opens on a new one, so
  // editing existing feedback starts from what's saved and a fresh turn starts
  // empty. Keyed on the turn id (not the object) — the studio re-creates turn
  // objects on every thread update, which would otherwise wipe in-progress
  // edits mid-typing.
  useEffect(() => {
    if (!open || !turn) return;
    setRating(turn.rating);
    setTags(
      turn.feedbackTags.filter((t): t is CadFeedbackTag =>
        (CAD_FEEDBACK_TAGS as readonly string[]).includes(t)
      )
    );
    setNote(turn.feedbackNote ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, turn?.id]);

  function toggleTag(tag: CadFeedbackTag) {
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  function save() {
    if (!turn) return;
    startSaving(async () => {
      const res = await recordCadFeedback({
        generationId: turn.id,
        rating,
        tags,
        note,
      });
      if ("ok" in res) {
        onSaved({
          rating,
          feedbackTags: tags,
          feedbackNote: note.trim() || null,
        });
        // Saving IS the completion of the flow — close rather than leaving a
        // "Saved ✓" the user has to dismiss themselves.
        onClose();
      }
    });
  }

  return (
    <NativeSheet
      open={open && !!turn}
      onClose={onClose}
      ariaLabel="Feedback on this generation"
    >
      <div className="px-5 pt-1 pb-2">
        <h2 className="text-base font-medium">How did this turn out?</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Ratings train the harness — they show up on the eval scorecard.
        </p>

        {/* Rating — the one field worth making big and thumb-reachable. */}
        <div className="mt-4 flex gap-2">
          {(
            [
              { value: "good", glyph: "👍", label: "Good" },
              { value: "bad", glyph: "👎", label: "Bad" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={rating === opt.value}
              onClick={() =>
                setRating((r) => (r === opt.value ? null : opt.value))
              }
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-2xl border py-3 text-sm transition-colors",
                rating === opt.value
                  ? "border-foreground/40 bg-foreground/5 font-medium"
                  : "border-border/60 text-muted-foreground hover:bg-foreground/5"
              )}
            >
              <span className="text-lg leading-none">{opt.glyph}</span>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <span className="text-xs font-medium text-muted-foreground">
            What stood out?
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CAD_FEEDBACK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={tags.includes(tag)}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  tags.includes(tag)
                    ? "border-foreground/40 bg-foreground/5"
                    : "border-border/60 text-muted-foreground hover:bg-foreground/5"
                )}
              >
                {CAD_FEEDBACK_TAG_LABELS[tag]}
              </button>
            ))}
          </div>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Anything else? (optional)"
          // text-base (16px) on mobile prevents iOS Safari from auto-zooming
          // the page when the field is focused (it zooms any input < 16px) —
          // same convention as the composer / home-bar / quantity inputs.
          className="mt-4 w-full resize-none rounded-2xl border border-border/60 bg-background px-3 py-2 field-text outline-none focus:border-foreground/30 sm:text-sm"
        />

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-foreground py-3 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                <CheckIcon className="size-4" />
                Save feedback
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-border/60 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      </div>
    </NativeSheet>
  );
}
