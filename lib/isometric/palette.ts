/**
 * Isometric drawing palette, resolved from the page's own tokens so a
 * drawing follows light/dark like the rest of the UI.
 *
 * Colours are plain sRGB triples (0–1). The renderer writes them to the
 * canvas untouched, so there's no colour-management round trip to
 * drift through.
 */

export type Rgb = readonly [number, number, number];

export type IsometricPalette = {
  top: Rgb;
  left: Rgb;
  right: Rgb;
  ink: Rgb;
};

/**
 * How much `--foreground` is mixed into `--background` for each tone,
 * in percent. Low on purpose for backdrop use: the drawing should read
 * at a glance and then get out of the way.
 */
export type IsometricInk = {
  top: number;
  left: number;
  right: number;
  line: number;
};

export const BACKDROP_INK: IsometricInk = {
  top: 1,
  left: 5,
  right: 10,
  line: 42,
};

let ctx: CanvasRenderingContext2D | null = null;

/**
 * Resolve a CSS colour expression (tokens are oklch) to sRGB by
 * painting one pixel — `getComputedStyle` hands back the oklch string,
 * which nothing on the WebGL side can parse.
 */
export function resolveCssColor(expr: string, host: HTMLElement): Rgb {
  const probe = document.createElement("span");
  probe.style.color = expr;
  host.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  ctx ??= document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) return [0.5, 0.5, 0.5];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

export function readIsometricPalette(
  host: HTMLElement,
  ink: IsometricInk = BACKDROP_INK
): IsometricPalette {
  const mix = (pct: number) =>
    resolveCssColor(
      `color-mix(in oklab, var(--foreground) ${pct}%, var(--background))`,
      host
    );
  return {
    top: mix(ink.top),
    left: mix(ink.left),
    right: mix(ink.right),
    ink: mix(ink.line),
  };
}

export function paletteKey(p: IsometricPalette) {
  return [p.top, p.left, p.right, p.ink]
    .map((c) => c.map((v) => Math.round(v * 255)).join(","))
    .join("|");
}
