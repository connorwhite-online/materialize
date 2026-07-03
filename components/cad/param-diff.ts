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
