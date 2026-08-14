// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HomeFaq } from "../home-faq";
import { HOME_FAQ } from "@/lib/seo/home-faq";

describe("HomeFaq", () => {
  it("titles the section Questions?", () => {
    render(<HomeFaq />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Questions?" }).textContent
    ).toBe("Questions?");
  });

  it("renders each question as a collapsed disclosure whose answer is in the DOM", () => {
    const { container } = render(<HomeFaq />);
    const items = container.querySelectorAll("details");
    expect(items).toHaveLength(HOME_FAQ.length);

    for (const [i, item] of HOME_FAQ.entries()) {
      const details = items[i];
      expect(details.open).toBe(false);
      expect(details.querySelector("summary")?.textContent).toContain(
        item.question
      );
      // Answers must stay in the HTML even while collapsed — FAQPage
      // JSON-LD is a structured-data violation if the marked-up text
      // isn't on the page.
      expect(details.textContent).toContain(item.answer);
    }
  });

  it("opens an item so the answer appears below the question", () => {
    const { container } = render(<HomeFaq />);
    const first = container.querySelector("details")!;
    fireEvent.click(first.querySelector("summary")!);
    expect(first.open).toBe(true);
  });

  it("places the Materialise disambiguation last", () => {
    const { container } = render(<HomeFaq />);
    const last = [...container.querySelectorAll("details")].at(-1);
    expect(last?.querySelector("summary")?.textContent).toMatch(
      /Materialise|i\.materialise/
    );
  });
});
