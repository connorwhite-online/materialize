import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * iOS auto-zoom guard, enforced repo-wide.
 *
 * iOS Safari zooms the entire page when a text-entry field is focused whose
 * font-size is under 16px — and it never zooms back out, leaving the layout
 * scrolled and oversized until the user pinches. It is a genuinely bad
 * mobile experience and it kept recurring: before this test, 7 of the 15
 * text-entry fields in the app were under 16px on phones, including two in
 * a SHARED primitive (`ui/number-input`) and the CAD feedback sheet the bug
 * was first reported on.
 *
 * The fix is the `.field-text` utility in app/globals.css (16px, with
 * Tailwind's `text-base` metrics). This test is the half that makes it
 * stick: every `<input>` / `<textarea>` that accepts typed text must carry
 * it, so reaching for a bare `text-sm` on a new field fails the build
 * instead of shipping.
 *
 * Deliberately a source scan, not a render test: the failure mode is a
 * class someone forgets to write, which no amount of rendering the
 * components we already know about would catch on the NEXT new field.
 *
 * Known limitation (stated rather than silently tolerated): a consumer can
 * still pass `className="text-sm"` into a shared primitive and win on
 * specificity via `cn()`. The unprefixed-small-size check below catches the
 * common in-place case; a call-site override is beyond a static scan.
 */

const ROOTS = ["app", "components"];

/** Input types that never accept typed text — iOS doesn't zoom for these. */
const NON_TEXT_TYPE =
  /type=['"](checkbox|radio|range|file|hidden|submit|button|color|image|reset)['"]/;

/** An unprefixed small size, i.e. one that applies at phone widths. */
const UNPREFIXED_SMALL = /(?<![:\w-])text-(sm|xs)\b/;

/** Opt-out for a field that genuinely cannot be 16px. Must state a reason. */
const OPT_OUT = "field-text-exempt:";

interface Field {
  file: string;
  line: number;
  tag: string;
  /** The raw opening tag (used for type + opt-out detection). */
  source: string;
  /** Only the class strings — comments and handler bodies excluded. */
  classes: string;
}

/**
 * The class names an element actually applies: the contents of every string
 * literal inside its `className` attribute (covering both `className="…"`
 * and `className={cn("…", cond && "…")}`).
 *
 * Reading the class strings rather than the whole tag matters — the first
 * version of this test scanned raw tag text and flagged the words "text-sm"
 * sitting in an explanatory CODE COMMENT as a violation.
 */
function classStrings(source: string): string {
  const at = source.indexOf("className");
  if (at === -1) return "";
  let i = source.indexOf("=", at) + 1;
  while (i < source.length && /\s/.test(source[i])) i++;
  let region: string;
  if (source[i] === "{") {
    let depth = 0;
    const start = i;
    while (i < source.length) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    region = source.slice(start, i + 1);
  } else {
    const quote = source[i];
    const end = source.indexOf(quote, i + 1);
    region = end === -1 ? "" : source.slice(i, end + 1);
  }
  // Every single/double/back-quoted literal in the region, concatenated.
  return (region.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? [])
    .map((s) => s.slice(1, -1))
    .join(" ");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every text-entry element's opening tag. Brace-aware so a `{...}` prop
 * containing a `>` (arrow functions in handlers) doesn't end the tag early.
 */
function findFields(file: string): Field[] {
  const src = readFileSync(file, "utf8");
  const fields: Field[] = [];
  const re = /<(input|textarea)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let j = m.index;
    while (j < src.length) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
      j++;
    }
    const source = src.slice(m.index, j + 1);
    if (NON_TEXT_TYPE.test(source)) continue;
    if (source.includes(OPT_OUT)) continue;
    fields.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      tag: m[1],
      source,
      classes: classStrings(source),
    });
  }
  return fields;
}

const allFields = ROOTS.flatMap((root) => walk(root)).flatMap(findFields);

describe("iOS auto-zoom: every text-entry field is >= 16px on phones", () => {
  it("finds text-entry fields to check (the scan itself isn't silently empty)", () => {
    // A regex that quietly matches nothing would make every assertion below
    // pass vacuously — the exact way a guard like this rots.
    expect(allFields.length).toBeGreaterThan(8);
  });

  it("requires the shared .field-text utility on every one", () => {
    const missing = allFields
      .filter((f) => !f.classes.includes("field-text"))
      .map((f) => `${f.file}:${f.line} <${f.tag}>`);
    expect(
      missing,
      `These text-entry fields are missing the \`field-text\` class, so iOS ` +
        `Safari will zoom the page when they're focused. Add \`field-text\` ` +
        `(see app/globals.css) and put any smaller desktop size behind a ` +
        `breakpoint, e.g. "field-text sm:text-sm". If a field genuinely ` +
        `cannot be 16px, add a \`${OPT_OUT} <reason>\` comment inside its tag.`
    ).toEqual([]);
  });

  it("rejects an unprefixed text-sm/text-xs that would win at phone widths", () => {
    // `field-text sm:text-xs` is correct; `field-text text-xs` is not — the
    // Tailwind utility beats the @layer components class at every width.
    const clobbered = allFields
      .filter((f) => UNPREFIXED_SMALL.test(f.classes))
      .map((f) => `${f.file}:${f.line} <${f.tag}>`);
    expect(
      clobbered,
      `These fields carry an unprefixed \`text-sm\`/\`text-xs\`, which ` +
        `overrides \`field-text\` on phones and reintroduces the iOS zoom. ` +
        `Put the small size behind a breakpoint (e.g. \`sm:text-xs\`).`
    ).toEqual([]);
  });
});
