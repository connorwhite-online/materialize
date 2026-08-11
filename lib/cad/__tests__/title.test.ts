import { describe, it, expect, vi, beforeEach } from "vitest";

const completeText = vi.fn(async (..._args: unknown[]) => "Widget Bracket");
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...args: unknown[]) =>
    completeText(...(args as Parameters<typeof completeText>)),
  hasModelCredentials: () => true,
}));

import { generateThreadTitle } from "@/lib/cad/title";

describe("generateThreadTitle", () => {
  beforeEach(() => {
    completeText.mockReset().mockResolvedValue("Widget Bracket");
  });

  it("returns a clean title", async () => {
    completeText.mockResolvedValue('"ESP32 Case, USB-C"');
    expect(await generateThreadTitle("a case")).toBe("ESP32 Case, USB-C");
  });

  it("rejects conversational output instead of truncating it into a title", async () => {
    // Seen in the wild: a prompt mentioning attached images made the title
    // model apologize, and the apology became the permanent thread name.
    completeText.mockResolvedValue(
      "I don't see any attached images in your message. Could you provide them?"
    );
    expect(await generateThreadTitle("an enclosure, see attached")).toBeNull();
  });

  it("rejects questions and over-long replies", async () => {
    completeText.mockResolvedValue("What device is this enclosure for?");
    expect(await generateThreadTitle("an enclosure")).toBeNull();

    completeText.mockResolvedValue(
      "A Very Long Title That Keeps Going And Going Beyond Any Reasonable Sidebar Width"
    );
    expect(await generateThreadTitle("an enclosure")).toBeNull();
  });

  it("returns null on a model failure", async () => {
    completeText.mockRejectedValue(new Error("api down"));
    expect(await generateThreadTitle("a case")).toBeNull();
  });
});
