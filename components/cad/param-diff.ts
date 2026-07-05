/**
 * Parametric diff between two generations' source code (docs/text-to-cad/05
 * §D item 4). The generated code is parametric by contract — named dimensions
 * as top-level `name = <number>` assignments — so diffing those assignments
 * yields a legible "what changed" summary ("wall 2 → 2.4") that no mesh diff
 * could ever say as well. Pure string parsing; safe to import anywhere.
 */

/** A Python numeric literal (ints, floats, leading sign, exponent). */
const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_]*`;

/**
 * A top-level assignment whose right-hand side is purely numeric:
 * `name = 2.4` or the tuple-unpack form `a, b, c = 1, 2, 3`, with an
 * optional trailing comment. Anything else on the RHS (expressions,
 * strings, calls) is not a parameter literal and is ignored. `(?!=)`
 * keeps `==` comparisons from matching.
 */
const ASSIGN_RE = new RegExp(
  `^(${IDENT}(?:\\s*,\\s*${IDENT})*)\\s*=(?!=)\\s*(${NUM}(?:\\s*,\\s*${NUM})*)\\s*(?:#.*)?$`
);

/**
 * Extract top-level numeric parameters from a generated script. Only
 * unindented `name = <number>` lines count (indented lines live inside a
 * function/loop and aren't the design's parameters); comment lines,
 * string assignments, and expressions are ignored. Tuple unpacking
 * (`a, b, c = 1, 2, 3`) yields one entry per name. A name assigned twice
 * keeps the last value. Mesh-mode scripts with no parameter block simply
 * produce an empty record.
 */
export function extractParams(sourceCode: string): Record<string, number> {
  const params: Record<string, number> = {};
  for (const line of sourceCode.split(/\r?\n/)) {
    if (/^\s/.test(line)) continue; // indented → not a top-level assignment
    const m = ASSIGN_RE.exec(line);
    if (!m) continue;
    const names = m[1].split(",").map((s) => s.trim());
    const values = m[2].split(",").map((s) => Number(s.trim()));
    // `x = 1, 2` (or `a, b = 1`) is a tuple mismatch, not parameters.
    if (names.length !== values.length) continue;
    if (values.some((v) => !Number.isFinite(v))) continue;
    names.forEach((name, i) => {
      params[name] = values[i];
    });
  }
  return params;
}

/**
 * The same top-level assignment as ASSIGN_RE, but with the separator and any
 * trailing comment captured so a substituted line can be rebuilt byte-for-byte
 * around new values (group 1 = names, 2 = `=` + surrounding whitespace,
 * 3 = the numeric RHS, 4 = trailing whitespace/comment).
 */
const ASSIGN_SUBST_RE = new RegExp(
  `^(${IDENT}(?:\\s*,\\s*${IDENT})*)(\\s*=(?!=)\\s*)(${NUM}(?:\\s*,\\s*${NUM})*)(\\s*(?:#.*)?)$`
);

/** Trim float noise from a substituted literal ("2.4", not "2.4000000004"). */
function fmtParamLiteral(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Substitute picked parameter values into a parametric script (MTR-190 template
 * instantiation). Only the top-level `name = <number>` / tuple-unpack lines
 * `extractParams` reads are rewritten; indentation, comments, names, and every
 * non-parametric line are preserved exactly. Unknown or non-finite params are
 * ignored, so a stale slider can never inject a new line or a non-numeric RHS.
 * Pure — the inverse of extractParams and safe to import anywhere.
 */
export function substituteParams(
  sourceCode: string,
  params: Record<string, number>
): string {
  return sourceCode
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s/.test(line)) return line; // indented → not a top-level param
      const m = ASSIGN_SUBST_RE.exec(line);
      if (!m) return line;
      const names = m[1].split(",").map((s) => s.trim());
      const values = m[3].split(",").map((s) => s.trim());
      if (names.length !== values.length) return line; // tuple mismatch
      const next = names.map((name, i) =>
        name in params && Number.isFinite(params[name])
          ? fmtParamLiteral(params[name])
          : values[i]
      );
      return `${m[1]}${m[2]}${next.join(", ")}${m[4]}`;
    })
    .join("\n");
}

export interface ParamDiff {
  /** Parameters present in both versions with a different value. */
  changed: [name: string, from: number, to: number][];
  /** Parameters only in the newer version. */
  added: [name: string, value: number][];
  /** Parameters only in the older version. */
  removed: [name: string, value: number][];
}

/**
 * Diff two extracted parameter sets. Order is deterministic: `changed`
 * and `added` follow `next`'s declaration order, `removed` follows
 * `prev`'s.
 */
export function diffParams(
  prev: Record<string, number>,
  next: Record<string, number>
): ParamDiff {
  const changed: ParamDiff["changed"] = [];
  const added: ParamDiff["added"] = [];
  const removed: ParamDiff["removed"] = [];
  for (const [name, value] of Object.entries(next)) {
    if (!(name in prev)) added.push([name, value]);
    else if (prev[name] !== value) changed.push([name, prev[name], value]);
  }
  for (const [name, value] of Object.entries(prev)) {
    if (!(name in next)) removed.push([name, value]);
  }
  return { changed, added, removed };
}
