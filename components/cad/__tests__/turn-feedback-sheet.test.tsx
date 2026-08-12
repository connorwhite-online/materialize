// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const recordCadFeedback = vi.fn();

// Server action module — stubbed so this client component imports cleanly.
vi.mock("@/app/actions/cad-generation", () => ({
  recordCadFeedback: (...args: unknown[]) => recordCadFeedback(...args),
}));

import {
  TurnFeedbackSheet,
  hasFeedback,
  type TurnFeedbackTarget,
} from "@/components/cad/turn-feedback-sheet";

const TURN: TurnFeedbackTarget = {
  id: "gen-1",
  rating: null,
  feedbackTags: [],
  feedbackNote: null,
};

function renderSheet(over: Partial<Parameters<typeof TurnFeedbackSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <TurnFeedbackSheet
      open
      turn={TURN}
      onClose={onClose}
      onSaved={onSaved}
      {...over}
    />
  );
  return { onClose, onSaved, ...utils };
}

beforeEach(() => {
  cleanup();
  recordCadFeedback.mockReset();
  recordCadFeedback.mockResolvedValue({ ok: true });
});

describe("hasFeedback", () => {
  it("is false only when every signal is empty", () => {
    expect(hasFeedback(TURN)).toBe(false);
    expect(hasFeedback({ ...TURN, rating: "good" })).toBe(true);
    expect(hasFeedback({ ...TURN, feedbackTags: ["wrong_dimensions"] })).toBe(true);
    expect(hasFeedback({ ...TURN, feedbackNote: "hm" })).toBe(true);
  });
});

describe("TurnFeedbackSheet", () => {
  it("renders nothing while closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByText("How did this turn out?")).toBeNull();
  });

  it("renders nothing when no turn is targeted, even if open", () => {
    renderSheet({ turn: null });
    expect(screen.queryByText("How did this turn out?")).toBeNull();
  });

  it("seeds from the targeted turn's saved feedback", () => {
    renderSheet({
      turn: {
        id: "gen-2",
        rating: "bad",
        feedbackTags: [],
        feedbackNote: "holes too small",
      },
    });
    expect(
      screen.getByRole("button", { name: /Bad/ }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByDisplayValue("holes too small")).toBeTruthy();
  });

  it("drops persisted tags that are no longer part of the vocabulary", () => {
    // A stale tag from an older build must not crash or render a ghost chip.
    renderSheet({
      turn: { ...TURN, feedbackTags: ["retired_tag_from_2025"] },
    });
    expect(screen.queryByText("retired_tag_from_2025")).toBeNull();
    expect(screen.getByText("How did this turn out?")).toBeTruthy();
  });

  it("toggles a rating off when the pressed one is tapped again", () => {
    renderSheet();
    const good = screen.getByRole("button", { name: /Good/ });
    fireEvent.click(good);
    expect(good.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(good);
    expect(good.getAttribute("aria-pressed")).toBe("false");
  });

  it("saves the rating, tags and note, reports the patch up, and closes", async () => {
    const { onSaved, onClose } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Good/ }));
    fireEvent.change(screen.getByPlaceholderText(/Anything else/), {
      target: { value: "  nailed it  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save feedback/ }));

    await waitFor(() => expect(recordCadFeedback).toHaveBeenCalledTimes(1));
    expect(recordCadFeedback).toHaveBeenCalledWith({
      generationId: "gen-1",
      rating: "good",
      tags: [],
      note: "  nailed it  ",
    });
    // The patch normalizes a whitespace-only note to null for the caller's
    // in-memory threads, matching what the server persists.
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        rating: "good",
        feedbackTags: [],
        feedbackNote: "nailed it",
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the sheet open and reports nothing when the save fails", async () => {
    recordCadFeedback.mockResolvedValue({ error: "nope" });
    const { onSaved, onClose } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Save feedback/ }));
    await waitFor(() => expect(recordCadFeedback).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without saving on 'Not now'", () => {
    const { onClose, onSaved } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(recordCadFeedback).not.toHaveBeenCalled();
  });
});
