// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HomeFaq } from "../home-faq";
import { HOME_FAQ } from "@/lib/seo/home-faq";

describe("HomeFaq", () => {
  it("renders every question and keeps every answer in the DOM", () => {
    render(<HomeFaq />);
    for (const item of HOME_FAQ) {
      expect(screen.getByText(item.question)).toBeTruthy();
      expect(screen.getByText(item.answer)).toBeTruthy();
    }
    expect(
      screen.getAllByRole("button", { expanded: false })
    ).toHaveLength(HOME_FAQ.length);
  });

  it("opens from the question and closes from a click on the answer", () => {
    render(<HomeFaq />);
    const question = screen.getByRole("button", {
      name: HOME_FAQ[0].question,
    });
    const answer = screen.getByText(HOME_FAQ[0].answer);
    expect(question.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(question);
    expect(question.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(answer);
    expect(question.getAttribute("aria-expanded")).toBe("false");
  });

  it("places the Materialise disambiguation last", () => {
    render(<HomeFaq />);
    const questions = screen.getAllByRole("button");
    expect(questions.at(-1)?.textContent).toMatch(/Materialise|i\.materialise/);
  });
});
