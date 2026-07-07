// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The studio module imports server actions at eval time; stub them so the
// client component under test can import without pulling server-only code.
vi.mock("@/app/actions/cad-generation", () => ({
  deleteCadBuild: vi.fn(),
  getCadTopoUrl: vi.fn(),
  recordCadFeedback: vi.fn(),
  renameCadGeneration: vi.fn(),
  saveCadFileToProfile: vi.fn(),
  setActiveCadVersion: vi.fn(),
  getCadStepDownloadUrl: vi.fn(),
}));

import { Questionnaire } from "@/components/cad/text-to-cad-studio";
import type { CadQuestionOption } from "@/lib/cad/types";

const OPTIONS: CadQuestionOption[] = [
  { id: "opt-a", label: "Pi 4B" },
  { id: "opt-b", label: "Pi 5" },
  { id: "opt-c", label: "Pi Zero 2W" },
];

function renderQ(over: Partial<Parameters<typeof Questionnaire>[0]["question"]> = {}) {
  const onAnswer = vi.fn();
  render(
    <Questionnaire
      question={{
        text: "Which board?",
        options: OPTIONS,
        defaultOptionId: "opt-b",
        answering: false,
        ...over,
      }}
      onAnswer={onAnswer}
    />
  );
  return { onAnswer };
}

describe("Questionnaire — select-then-send (MTR-209)", () => {
  beforeEach(() => cleanup());

  it("does NOT commit on option tap — arming only", () => {
    const { onAnswer } = renderQ();
    fireEvent.click(screen.getByRole("button", { name: /Pi 4B/ }));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("commits the armed option via the prominent send CTA", () => {
    const { onAnswer } = renderQ();
    fireEvent.click(screen.getByRole("button", { name: /Pi 4B/ }));
    fireEvent.click(screen.getByRole("button", { name: /Use this answer/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ optionId: "opt-a" });
  });

  it("pre-arms the recommended (default) option so send works immediately", () => {
    const { onAnswer } = renderQ();
    fireEvent.click(screen.getByRole("button", { name: /Use this answer/ }));
    expect(onAnswer).toHaveBeenCalledWith({ optionId: "opt-b" });
  });

  it("sends free text via the custom row's own send button", () => {
    const { onAnswer } = renderQ();
    fireEvent.change(screen.getByLabelText("Custom answer"), {
      target: { value: "  Pi 400 please  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send custom answer/ }));
    expect(onAnswer).toHaveBeenCalledWith({ text: "Pi 400 please" });
  });

  it("custom text takes precedence over an armed option at commit", () => {
    const { onAnswer } = renderQ();
    // Arm an option, then type custom text (which disarms the option).
    fireEvent.click(screen.getByRole("button", { name: /Pi 4B/ }));
    fireEvent.change(screen.getByLabelText("Custom answer"), {
      target: { value: "custom board" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));
    expect(onAnswer).toHaveBeenCalledWith({ text: "custom board" });
  });

  it("locks input while answering (no double-fire)", () => {
    const { onAnswer } = renderQ({ answering: true });
    // The commit CTA reads "Applying…" and is disabled.
    const cta = screen.getByRole("button", { name: /Applying/ }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    fireEvent.click(cta);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
