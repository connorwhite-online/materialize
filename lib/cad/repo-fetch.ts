import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import type { PromptImage } from "./types";
import { modelForRole } from "./models";
import { logError } from "@/lib/logger";

/**
 * Repo fetching (v1): when the prompt links a GitHub repository, READ it
 * instead of guessing. Before this, a prompt like "enclosure for the device
 * at this repo: <url>" passed the URL as inert text — the models can't
 * browse, so every port and dimension was invented (the phantom-cutout
 * failure mode). Now the job fetches, pre-brief:
 *
 *   1. The README — distilled by a cheap model call into a MECHANICAL fact
 *      sheet (dims, ports, components, mounting), which feeds the brief; the
 *      brief's existing rules then turn explicit numbers into
 *      machine-checked dimensionTargets.
 *   2. README images — folded into the reference-image flow (persisted to
 *      R2, inherited by revisions, shown captioned to every model step).
 *   3. The first `.kicad_pcb` — the board outline (Edge.Cuts bounding box)
 *      and non-plated drill sizes extracted DETERMINISTICALLY. Measured
 *      numbers, not model guesses, flagged as ground truth. (Hole
 *      *positions* need a real s-expression parse — v2.)
 *
 * Security + reliability rails: fetches only a URL the user explicitly
 * typed; hosts pinned to github.com / raw.githubusercontent.com /
 * api.github.com; per-request timeouts and size caps; and the whole stage
 * is best-effort — a dead link, rate limit, or parse failure degrades to
 * "no facts", never a failed build. Optional GITHUB_TOKEN raises the
 * unauthenticated trees-API rate limit. Disable with CAD_REPO_FETCH=false.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_README_BYTES = 200_000;
const MAX_KICAD_BYTES = 5_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_IMAGES = 2;
const README_CLIP_CHARS = 15_000;

export function repoFetchEnabled(): boolean {
  return process.env.CAD_REPO_FETCH !== "false";
}

/** First GitHub repo URL in the prompt, or null. */
export function extractRepoUrl(
  prompt: string
): { owner: string; repo: string; url: string } | null {
  const m = prompt.match(
    /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[\s)\].,;!?'"]|\/|$)/
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

/** Image paths referenced by a README (markdown + <img src>), in order. */
export function extractReadmeImagePaths(readme: string): string[] {
  const out: string[] = [];
  const push = (p: string | undefined) => {
    if (!p) return;
    const clean = p.trim();
    if (/\.(png|jpe?g|webp|gif)(\?[^\s]*)?$/i.test(clean)) out.push(clean);
  };
  for (const m of readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) push(m[1]);
  for (const m of readme.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  return [...new Set(out)];
}

/**
 * Board facts from a .kicad_pcb, extracted with tolerant regexes (KiCad
 * files are s-expressions; a full parse is v2). Returns measured lines for
 * the fact sheet, or [] when nothing parses. Exported for tests.
 */
export function extractKicadFacts(pcb: string): string[] {
  const facts: string[] = [];
  // Board outline: bbox over every coordinate that appears inside an
  // Edge.Cuts graphic element (gr_line/gr_arc/gr_rect/gr_circle segments).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of pcb.matchAll(
    /\((?:gr_line|gr_rect|gr_arc|gr_circle|gr_curve|gr_poly)[\s\S]{0,600}?Edge\.Cuts/g
  )) {
    for (const c of m[0].matchAll(
      /\((?:start|end|center|mid|xy)\s+(-?[\d.]+)\s+(-?[\d.]+)/g
    )) {
      xs.push(Number(c[1]));
      ys.push(Number(c[2]));
    }
  }
  if (xs.length >= 2 && ys.length >= 2) {
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w > 1 && h > 1 && w < 1000 && h < 1000) {
      facts.push(
        `Board outline (measured from the KiCad Edge.Cuts layer): ${w.toFixed(1)} x ${h.toFixed(1)} mm.`
      );
    }
  }
  // Non-plated through holes = mounting holes: count + drill diameters.
  const drills = [
    ...pcb.matchAll(/\(pad\s+"[^"]*"\s+np_thru_hole[\s\S]{0,300}?\(drill\s+([\d.]+)/g),
  ].map((m) => Number(m[1]));
  if (drills.length > 0) {
    const byDia = new Map<string, number>();
    for (const d of drills) {
      const k = d.toFixed(1);
      byDia.set(k, (byDia.get(k) ?? 0) + 1);
    }
    const parts = [...byDia.entries()].map(
      ([dia, n]) => `${n} x ${dia} mm drill`
    );
    facts.push(
      `Mounting holes (measured, non-plated): ${parts.join(", ")}. Exact positions not extracted — do not guess them; use standoffs sized to these drills.`
    );
  }
  return facts;
}

async function fetchCapped(
  url: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
  accept?: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      ...(accept ? { Accept: accept } : {}),
      ...(url.startsWith("https://api.github.com/") && process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "" };
}

const IMAGE_MEDIA: Record<string, PromptImage["mediaType"]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface FetchedRepoContext {
  url: string;
  /** Prompt-ready fact block ("" when nothing usable was learned). */
  facts: string;
  /** README images, ready to join the reference-image flow. */
  images: PromptImage[];
}

/**
 * Fetch + distill a linked GitHub repo. Null when the prompt links no repo,
 * the stage is disabled, or nothing could be fetched. Never throws.
 */
export async function fetchRepoContext(
  prompt: string,
  signal?: AbortSignal
): Promise<FetchedRepoContext | null> {
  if (!repoFetchEnabled()) return null;
  const target = extractRepoUrl(prompt);
  if (!target) return null;
  const { owner, repo, url } = target;
  const raw = (path: string) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path.replace(/^\.?\//, "")}`;

  try {
    // README (best-effort across common names).
    let readme: string | null = null;
    for (const name of ["README.md", "readme.md", "Readme.md"]) {
      const r = await fetchCapped(raw(name), MAX_README_BYTES, signal).catch(
        () => null
      );
      if (r) {
        readme = Buffer.from(r.bytes).toString("utf8");
        break;
      }
    }

    // README images → reference images (capped; absolute URLs must stay on
    // GitHub's raw/asset hosts so we never fetch an arbitrary third party).
    const images: PromptImage[] = [];
    if (readme) {
      for (const path of extractReadmeImagePaths(readme)) {
        if (images.length >= MAX_IMAGES) break;
        const ext = path.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
        const mediaType = IMAGE_MEDIA[ext];
        if (!mediaType) continue;
        const target = /^https?:\/\//i.test(path)
          ? /^https:\/\/(raw\.githubusercontent\.com|github\.com|user-images\.githubusercontent\.com|[\w.-]+\.githubusercontent\.com)\//i.test(
              path
            )
            ? path
            : null
          : raw(path);
        if (!target) continue;
        const img = await fetchCapped(target, MAX_IMAGE_BYTES, signal).catch(
          () => null
        );
        if (!img) continue;
        images.push({
          data: Buffer.from(img.bytes).toString("base64"),
          mediaType,
          label:
            "Reference image fetched from the GitHub repository linked in the prompt — shows the device this part must fit.",
        });
      }
    }

    // KiCad board file via the trees API (optional; rate-limited unauthed).
    let kicadFacts: string[] = [];
    try {
      const tree = await fetchCapped(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
        2_000_000,
        signal,
        "application/vnd.github+json"
      );
      if (tree) {
        const parsed = JSON.parse(Buffer.from(tree.bytes).toString("utf8")) as {
          tree?: Array<{ path?: string; size?: number }>;
        };
        const pcbPath = parsed.tree?.find(
          (e) =>
            e.path?.endsWith(".kicad_pcb") &&
            (e.size ?? 0) <= MAX_KICAD_BYTES
        )?.path;
        if (pcbPath) {
          const pcb = await fetchCapped(raw(pcbPath), MAX_KICAD_BYTES, signal);
          if (pcb) {
            kicadFacts = extractKicadFacts(
              Buffer.from(pcb.bytes).toString("utf8")
            );
          }
        }
      }
    } catch (err) {
      logError("fetchRepoContext.kicad", err);
    }

    // README → mechanical fact sheet, via a cheap model pass. Facts only —
    // the brief downstream decides what becomes a checked dimension target.
    let distilled = "";
    if (readme && hasModelCredentials()) {
      try {
        distilled = (
          await completeText({
            system:
              "You extract MECHANICAL facts for enclosure/fixture design from a hardware project's README. Output a terse fact sheet (plain lines, no markdown headers): overall dimensions with units, PCB size, ports/connectors and which side they're on, buttons/displays/antennas/vents, mounting provisions, component names (boards, screens, batteries). ONLY state facts the text supports — never invent or estimate a number. If the README has no mechanical information, output exactly: NO_MECHANICAL_FACTS",
            prompt: readme.slice(0, README_CLIP_CHARS),
            model: modelForRole("plan"),
            role: "fetch",
            signal,
          })
        ).trim();
        if (distilled.includes("NO_MECHANICAL_FACTS")) distilled = "";
      } catch (err) {
        logError("fetchRepoContext.distill", err);
      }
    }

    const sections = [
      ...kicadFacts.map((f) => `- ${f} [measured — ground truth]`),
      ...(distilled
        ? distilled.split("\n").map((l) => (l.startsWith("-") ? l : `- ${l}`))
        : []),
    ];
    if (sections.length === 0 && images.length === 0) return null;

    const facts =
      sections.length > 0
        ? [
            `FETCHED PROJECT FACTS — read from the repository the user linked (${url}). Lines marked [measured] are parsed from the project's own CAD files and are GROUND TRUTH; honor them exactly. Do NOT invent ports, cutouts, or dimensions this list doesn't support.`,
            ...sections,
          ].join("\n")
        : "";
    return { url, facts, images };
  } catch (err) {
    logError("fetchRepoContext", err);
    return null;
  }
}
