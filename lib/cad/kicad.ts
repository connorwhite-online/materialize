/**
 * Minimal KiCad `.kicad_pcb` reader (pure — no server-only, testable): a
 * real s-expression parse, replacing the v1 regex scan so we can extract
 * POSITIONS, not just sizes. Everything here is measured ground truth for
 * the enclosure prompts — board outline, mounting-hole coordinates, and
 * connector locations — the numbers the model must never invent.
 *
 * Coordinate convention: KiCad's board space is x-right, y-DOWN. All
 * positions reported here are relative to the board outline's top-left
 * corner (min-x, min-y), stated as such in the fact lines so the model
 * anchors features consistently.
 */

export type SExpr = string | SExpr[];

/** Parse s-expression source into a top-level expression list. Throws on
 *  unbalanced input — callers treat any throw as "not parseable". */
export function parseSExpr(src: string): SExpr[] {
  const root: SExpr[] = [];
  const stack: SExpr[][] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "(") {
      const node: SExpr[] = [];
      stack[stack.length - 1].push(node);
      stack.push(node);
      i++;
    } else if (c === ")") {
      if (stack.length === 1) throw new Error("unbalanced )");
      stack.pop();
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= n) throw new Error("unterminated string");
      stack[stack.length - 1].push(out);
      i = j + 1;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s()"]/.test(src[j])) j++;
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  if (stack.length !== 1) throw new Error("unbalanced (");
  return root;
}

const isList = (e: SExpr): e is SExpr[] => Array.isArray(e);
const head = (e: SExpr): string | null =>
  isList(e) && typeof e[0] === "string" ? e[0] : null;

/** First child list with the given head. */
function child(e: SExpr[], name: string): SExpr[] | null {
  for (const c of e) if (isList(c) && c[0] === name) return c;
  return null;
}

/** Every descendant list with the given head (recursive). */
function descendants(e: SExpr[], name: string, out: SExpr[][] = []): SExpr[][] {
  for (const c of e) {
    if (!isList(c)) continue;
    if (c[0] === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

const num = (e: SExpr | undefined): number | null => {
  if (typeof e !== "string") return null;
  const v = Number(e);
  return Number.isFinite(v) ? v : null;
};

/** `(at x y [rot])` → {x, y, rot}. */
function atOf(e: SExpr[]): { x: number; y: number; rot: number } | null {
  const at = child(e, "at");
  if (!at) return null;
  const x = num(at[1]);
  const y = num(at[2]);
  if (x === null || y === null) return null;
  return { x, y, rot: num(at[3]) ?? 0 };
}

function layerIs(e: SExpr[], layer: string): boolean {
  const l = child(e, "layer");
  if (l && l[1] === layer) return true;
  const ls = child(e, "layers");
  return !!ls && ls.slice(1).some((v) => v === layer);
}

export interface KicadBoard {
  /** Board outline bbox, mm. */
  outline: { widthMm: number; heightMm: number } | null;
  /** Mounting holes: position from the outline's top-left corner (x-right,
   *  y-down, KiCad convention), drill diameter mm. */
  mountingHoles: { xMm: number; yMm: number; drillMm: number }[];
  /** Connector-ish footprints (by name/reference), same coordinate frame. */
  connectors: { name: string; reference: string; xMm: number; yMm: number }[];
}

const CONNECTOR_NAME =
  /usb|hdmi|jst|rj45|barrel|jack|sd[-_ ]?card|microsd|conn|header|terminal|qwiic|stemma/i;

/** Extract measured board facts from a parsed .kicad_pcb. */
export function readKicadBoard(src: string): KicadBoard | null {
  let tree: SExpr[];
  try {
    tree = parseSExpr(src);
  } catch {
    return null;
  }
  const pcb = tree.find((e) => head(e) === "kicad_pcb");
  if (!pcb || !isList(pcb)) return null;

  // Outline bbox: every coordinate of every Edge.Cuts graphic.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const name of [
    "gr_line",
    "gr_rect",
    "gr_arc",
    "gr_circle",
    "gr_curve",
    "gr_poly",
  ]) {
    for (const g of descendants(pcb, name)) {
      if (!layerIs(g, "Edge.Cuts")) continue;
      for (const key of ["start", "end", "center", "mid"]) {
        const pt = child(g, key);
        const x = pt && num(pt[1]);
        const y = pt && num(pt[2]);
        if (x !== null && x !== undefined && y !== null && y !== undefined) {
          xs.push(x);
          ys.push(y);
        }
      }
      const pts = child(g, "pts");
      if (pts) {
        for (const xy of descendants(pts, "xy")) {
          const x = num(xy[1]);
          const y = num(xy[2]);
          if (x !== null && y !== null) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
    }
  }
  const hasOutline = xs.length >= 2 && ys.length >= 2;
  const minX = hasOutline ? Math.min(...xs) : 0;
  const minY = hasOutline ? Math.min(...ys) : 0;
  const widthMm = hasOutline ? Math.max(...xs) - minX : 0;
  const heightMm = hasOutline ? Math.max(...ys) - minY : 0;
  const outline =
    hasOutline && widthMm > 1 && heightMm > 1 && widthMm < 1000 && heightMm < 1000
      ? { widthMm, heightMm }
      : null;

  // Footprints: mounting holes (np_thru_hole pads, absolute = footprint at +
  // pad offset rotated by footprint rotation) and connector-ish parts.
  const mountingHoles: KicadBoard["mountingHoles"] = [];
  const connectors: KicadBoard["connectors"] = [];
  for (const fpName of ["footprint", "module"]) {
    for (const fp of descendants(pcb, fpName)) {
      const fpAt = atOf(fp);
      if (!fpAt) continue;
      const name = typeof fp[1] === "string" ? fp[1] : "";
      const rad = (fpAt.rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      for (const pad of descendants(fp, "pad")) {
        if (pad[2] !== "np_thru_hole") continue;
        const drillExpr = child(pad, "drill");
        const drill = drillExpr ? num(drillExpr[1]) : null;
        const padAt = atOf(pad);
        if (drill === null || !padAt) continue;
        // KiCad footprint rotation is counter-clockwise, y-down space.
        const xMm = fpAt.x + padAt.x * cos + padAt.y * sin - minX;
        const yMm = fpAt.y - padAt.x * sin + padAt.y * cos - minY;
        mountingHoles.push({
          xMm: Math.round(xMm * 100) / 100,
          yMm: Math.round(yMm * 100) / 100,
          drillMm: drill,
        });
      }

      // Connector detection: footprint lib name OR its reference text (J*).
      const refText = descendants(fp, "fp_text").find((t) => t[1] === "reference");
      const property = descendants(fp, "property").find(
        (p) => p[1] === "Reference"
      );
      const reference =
        (refText && typeof refText[2] === "string" ? refText[2] : null) ??
        (property && typeof property[2] === "string" ? property[2] : "");
      if (CONNECTOR_NAME.test(name) || /^J\d+$/.test(reference)) {
        connectors.push({
          name: name.split(":").pop() ?? name,
          reference,
          xMm: Math.round((fpAt.x - minX) * 100) / 100,
          yMm: Math.round((fpAt.y - minY) * 100) / 100,
        });
      }
    }
  }

  if (!outline && mountingHoles.length === 0 && connectors.length === 0) {
    return null;
  }
  return { outline, mountingHoles, connectors };
}

/** Render measured board facts as prompt lines ([] when nothing parsed). */
export function kicadFactLines(src: string): string[] {
  const board = readKicadBoard(src);
  if (!board) return [];
  const lines: string[] = [];
  if (board.outline) {
    lines.push(
      `Board outline (measured from the KiCad Edge.Cuts layer): ${board.outline.widthMm.toFixed(1)} x ${board.outline.heightMm.toFixed(1)} mm.`
    );
  }
  if (board.mountingHoles.length > 0) {
    const holes = board.mountingHoles
      .map(
        (h) =>
          `(${h.xMm.toFixed(1)}, ${h.yMm.toFixed(1)}) drill ${h.drillMm.toFixed(1)} mm`
      )
      .join("; ");
    lines.push(
      `Mounting holes (measured; positions from the board outline's top-left corner, x-right y-down): ${holes}. Place standoffs/bosses at EXACTLY these positions.`
    );
  }
  if (board.connectors.length > 0) {
    const conns = board.connectors
      .slice(0, 8)
      .map(
        (c) =>
          `${c.reference || c.name} (${c.name}) at (${c.xMm.toFixed(1)}, ${c.yMm.toFixed(1)})`
      )
      .join("; ");
    lines.push(
      `Connectors (measured positions, same frame — cutouts must align with these): ${conns}.`
    );
  }
  return lines;
}
