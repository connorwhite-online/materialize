import { describe, it, expect } from "vitest";
import {
  PRIVACY_MARKDOWN,
  TERMS_MARKDOWN,
  SUPPORT_MARKDOWN,
  SUPPORT_EMAIL,
} from "../content";

const PAGES = Object.entries({ PRIVACY_MARKDOWN, TERMS_MARKDOWN, SUPPORT_MARKDOWN });

describe("legal copy", () => {
  it.each(PAGES)("%s has no unfilled draft blanks", (_, md) => {
    // Markdown links are fine; a bare [UPPER CASE] token is a draft blank.
    expect(md).not.toMatch(/\[[A-Z][A-Z /]+\](?!\()/);
    expect(md).not.toMatch(/DRAFT/);
  });

  it.each(PAGES)("%s gives the support email", (_, md) => {
    expect(md).toContain(SUPPORT_EMAIL);
  });
});
