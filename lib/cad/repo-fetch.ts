import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadFetchedFacts } from "@/lib/db/schema";
import { completeText, hasModelCredentials } from "./model-client";
import type { PromptImage } from "./types";
import { kicadFactLines } from "./kicad";
import { modelForRole } from "./models";
import { logError } from "@/lib/logger";

/**
 * Prompt-linked source fetching: when the prompt links a GitHub repository
 * and/or a datasheet PDF, READ them instead of guessing. Before this, a
 * prompt like "enclosure for the device at this repo: <url>" passed the URL
 * as inert text — the models can't browse, so every port and dimension was
 * invented (the phantom-cutout failure mode). The job fetches, pre-brief:
 *
 *   1. The README — distilled (with any datasheet PDF, read natively by the
 *      model as a document) into a MECHANICAL fact sheet; the brief's
 *      existing rules turn its explicit numbers into machine-checked
 *      dimensionTargets.
 *   2. README images — folded into the reference-image flow (persisted to
 *      R2, inherited by revisions, captioned to every model step).
 *   3. The first `.kicad_pcb` — board outline, mounting-hole POSITIONS, and
 *      connector locations extracted DETERMINISTICALLY (lib/cad/kicad.ts, a
 *      real s-expression parse). Measured numbers, flagged as ground truth.
 *
 * Caching (cad_fetched_facts): the distilled fact sheet is cached per user
 * for 7 days, keyed by the canonical URL set — a cache hit skips the
 * trees-API call, the board-file download, any PDF download, and the
 * distill model call (README + images are still fetched: cheap, no model).
 *
 * Security + reliability rails: fetches only URLs the user explicitly
 * typed; repo fetches pinned to GitHub hosts; datasheet fetches restricted
 * to https on public-looking hostnames (no IP literals / localhost /
 * .internal, no credentials in the URL); per-request timeouts and size
 * caps; and the whole stage is best-effort — a dead link, rate limit, or
 * parse failure degrades to "no facts", never a failed build. Optional
 * GITHUB_TOKEN raises the unauthenticated trees-API rate limit. Disable
 * with CAD_REPO_FETCH=false.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_README_BYTES = 200_000;
const MAX_KICAD_BYTES = 5_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_PDF_BYTES = 8_000_000;
const MAX_IMAGES = 2;
const README_CLIP_CHARS = 15_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Datasheet PDF URLs typed in the prompt (https only, public-looking hosts,
 * no credentials). First match wins downstream; capped here at 2.
 */
export function extractPdfUrls(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(/https:\/\/[^\s)\]'"<>]+\.pdf\b/gi)) {
    try {
      const u = new URL(m[0]);
      if (u.username || u.password) continue;
      const host = u.hostname.toLowerCase();
      if (
        /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
        host === "localhost" ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.includes(":")
      ) {
        continue;
      }
      out.push(u.toString());
    } catch {
      // Not a URL after all — skip.
    }
  }
  return [...new Set(out)].slice(0, 2);
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
  /** True when the fact sheet came from the per-user cache. */
  cached: boolean;
}

async function readCachedFacts(
  userId: string,
  sourceUrl: string
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ facts: cadFetchedFacts.facts })
      .from(cadFetchedFacts)
      .where(
        and(
          eq(cadFetchedFacts.userId, userId),
          eq(cadFetchedFacts.sourceUrl, sourceUrl),
          gt(cadFetchedFacts.createdAt, new Date(Date.now() - CACHE_TTL_MS))
        )
      )
      .orderBy(desc(cadFetchedFacts.createdAt))
      .limit(1);
    return row?.facts ?? null;
  } catch (err) {
    logError("repoFetch.cacheRead", err);
    return null;
  }
}

async function writeCachedFacts(
  userId: string,
  sourceUrl: string,
  facts: string
): Promise<void> {
  try {
    await db.insert(cadFetchedFacts).values({ userId, sourceUrl, facts });
  } catch (err) {
    logError("repoFetch.cacheWrite", err);
  }
}

/**
 * Fetch + distill the sources a prompt links. Null when the prompt links
 * nothing, the stage is disabled, or nothing could be fetched. Never throws.
 */
export async function fetchRepoContext(
  prompt: string,
  signal?: AbortSignal,
  opts?: { userId?: string }
): Promise<FetchedRepoContext | null> {
  if (!repoFetchEnabled()) return null;
  const repo = extractRepoUrl(prompt);
  const pdfUrls = extractPdfUrls(prompt);
  if (!repo && pdfUrls.length === 0) return null;
  const cacheKey = [repo?.url, ...pdfUrls].filter(Boolean).sort().join(" ");
  const displayUrl = repo?.url ?? pdfUrls[0];

  try {
    const raw = (path: string) =>
      `https://raw.githubusercontent.com/${repo!.owner}/${repo!.repo}/HEAD/${path.replace(/^\.?\//, "")}`;

    // README (best-effort across common names).
    let readme: string | null = null;
    if (repo) {
      for (const name of ["README.md", "readme.md", "Readme.md"]) {
        const r = await fetchCapped(raw(name), MAX_README_BYTES, signal).catch(
          () => null
        );
        if (r) {
          readme = Buffer.from(r.bytes).toString("utf8");
          break;
        }
      }
    }

    // README images → reference images (capped; absolute URLs must stay on
    // GitHub's raw/asset hosts so we never fetch an arbitrary third party).
    const images: PromptImage[] = [];
    if (readme && repo) {
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

    // Cache hit: reuse the distilled facts, skip the expensive legs (trees
    // API, board download, PDF download, distill call) entirely.
    if (opts?.userId) {
      const cached = await readCachedFacts(opts.userId, cacheKey);
      if (cached) {
        return { url: displayUrl, facts: cached, images, cached: true };
      }
    }

    // KiCad board file via the trees API (optional; rate-limited unauthed).
    let kicadFacts: string[] = [];
    if (repo) {
      try {
        const tree = await fetchCapped(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/HEAD?recursive=1`,
          2_000_000,
          signal,
          "application/vnd.github+json"
        );
        if (tree) {
          const parsed = JSON.parse(
            Buffer.from(tree.bytes).toString("utf8")
          ) as { tree?: Array<{ path?: string; size?: number }> };
          const pcbPath = parsed.tree?.find(
            (e) =>
              e.path?.endsWith(".kicad_pcb") && (e.size ?? 0) <= MAX_KICAD_BYTES
          )?.path;
          if (pcbPath) {
            const pcb = await fetchCapped(raw(pcbPath), MAX_KICAD_BYTES, signal);
            if (pcb) {
              kicadFacts = kicadFactLines(
                Buffer.from(pcb.bytes).toString("utf8")
              );
            }
          }
        }
      } catch (err) {
        logError("fetchRepoContext.kicad", err);
      }
    }

    // Datasheet PDFs: fetched (validated as PDFs) and handed to the distill
    // call as native documents, so the model reads the mechanical-drawing
    // pages with vision instead of us scraping text.
    const documents: { data: string }[] = [];
    for (const pdfUrl of pdfUrls) {
      try {
        const pdf = await fetchCapped(pdfUrl, MAX_PDF_BYTES, signal);
        if (!pdf) continue;
        const isPdf =
          pdf.contentType.includes("pdf") ||
          (pdf.bytes[0] === 0x25 &&
            pdf.bytes[1] === 0x50 &&
            pdf.bytes[2] === 0x44 &&
            pdf.bytes[3] === 0x46);
        if (!isPdf) continue;
        documents.push({ data: Buffer.from(pdf.bytes).toString("base64") });
      } catch (err) {
        logError("fetchRepoContext.pdf", err);
      }
    }

    // README + datasheets → mechanical fact sheet, one model pass. Facts
    // only — the brief downstream decides what becomes a checked target.
    let distilled = "";
    if ((readme || documents.length > 0) && hasModelCredentials()) {
      try {
        distilled = (
          await completeText({
            system:
              "You extract MECHANICAL facts for enclosure/fixture design from a hardware project's docs (README text and/or attached datasheet PDFs — read the datasheets' mechanical-drawing/package pages carefully). Output a terse fact sheet (plain lines, no markdown headers): overall dimensions with units, PCB size, ports/connectors and which side they're on, mounting hole patterns and sizes, buttons/displays/antennas/vents, component names (boards, screens, batteries). ONLY state facts the sources support — never invent or estimate a number. If the sources have no mechanical information, output exactly: NO_MECHANICAL_FACTS",
            prompt: readme
              ? readme.slice(0, README_CLIP_CHARS)
              : "Extract the mechanical facts from the attached datasheet(s).",
            model: modelForRole("plan"),
            role: "fetch",
            documents: documents.length > 0 ? documents : undefined,
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
            `FETCHED PROJECT FACTS — read from the sources the user linked (${[repo?.url, ...pdfUrls].filter(Boolean).join(", ")}). Lines marked [measured] are parsed from the project's own CAD files and are GROUND TRUTH; honor them exactly. Do NOT invent ports, cutouts, or dimensions this list doesn't support.`,
            ...sections,
          ].join("\n")
        : "";
    if (facts && opts?.userId) {
      await writeCachedFacts(opts.userId, cacheKey, facts);
    }
    return { url: displayUrl, facts, images, cached: false };
  } catch (err) {
    logError("fetchRepoContext", err);
    return null;
  }
}
