import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../route";

describe("sanitizeFilename", () => {
  it("passes clean filenames through unchanged", () => {
    expect(sanitizeFilename("model.stl")).toBe("model.stl");
    expect(sanitizeFilename("left_bracket_v3.obj")).toBe(
      "left_bracket_v3.obj"
    );
    expect(sanitizeFilename("Part-2.3mf")).toBe("Part-2.3mf");
  });

  it("replaces path separators with underscores", () => {
    // Full leading "../../" sequence gets eaten by the leading
    // [._] trim since every character is either a dot or an
    // underscore after the first regex pass.
    expect(sanitizeFilename("../../etc/passwd.stl")).toBe("etc_passwd.stl");
    expect(sanitizeFilename("foo/bar.stl")).toBe("foo_bar.stl");
    expect(sanitizeFilename("foo\\bar.stl")).toBe("foo_bar.stl");
  });

  it("strips leading dots so hidden-file traversal is blocked", () => {
    expect(sanitizeFilename(".env")).toBe("env");
    expect(sanitizeFilename("..hidden.stl")).toBe("hidden.stl");
  });

  it("collapses control characters and whitespace", () => {
    expect(sanitizeFilename("part one.stl")).toBe("part_one.stl");
    expect(sanitizeFilename("evil\nfile.stl")).toBe("evil_file.stl");
    expect(sanitizeFilename("evil\rfile.stl")).toBe("evil_file.stl");
    expect(sanitizeFilename("evil\0file.stl")).toBe("evil_file.stl");
  });

  it("strips wildcard / glob / shell metacharacters", () => {
    expect(sanitizeFilename("file*?.stl")).toBe("file_.stl");
    expect(sanitizeFilename("file<>.stl")).toBe("file_.stl");
    expect(sanitizeFilename("file|pipe.stl")).toBe("file_pipe.stl");
    expect(sanitizeFilename('name"quote.stl')).toBe("name_quote.stl");
  });

  it("falls back to 'file' when everything gets stripped", () => {
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("..")).toBe("file");
  });

  it("replaces unicode with underscores rather than dropping it", () => {
    // Leading `[_.]` gets trimmed too, so the all-unicode prefix
    // collapses down to just the extension.
    expect(sanitizeFilename("模型.stl")).toBe("stl");
    expect(sanitizeFilename("émoji 🎉.stl")).toBe("moji_.stl");
  });
});
