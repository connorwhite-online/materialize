/**
 * Deterministic multi-width screenshot capture for pr-browser-review.
 *
 * The agent (scripts/pr-browser-review.ts) used to be asked to *write*
 * its own throwaway Playwright spec that took screenshots. That was the
 * single biggest source of the "artifact is always empty" bug: if the
 * agent ran out of budget, picked a lib-only scope, or wrote a spec
 * that didn't compile, zero PNGs landed in .agent-out/ and the upload
 * step (if-no-files-found: ignore) produced an empty artifact.
 *
 * This module makes capture deterministic and committed. The agent's
 * only screenshot responsibility now is to resolve the in-scope routes
 * (substituting any `[slug]` dynamic segments with a real value) and
 * write them to `.agent-out/routes.json`. This script does the rest:
 * for every route it loads the preview at mobile / tablet / desktop
 * widths, takes a full-page screenshot, and records console errors and
 * same-origin failed requests. Output:
 *
 *   .agent-out/screens/<idx>-<slug>-<width>.png   (the images)
 *   .agent-out/capture-report.json                (findings + index)
 *
 * Inputs (env):
 *   PREVIEW_URL                       — Vercel preview base URL (required)
 *   VERCEL_AUTOMATION_BYPASS_SECRET   — bypass the preview 401 wall (optional)
 *   PR_REVIEW_ROUTES_FILE             — routes manifest (default .agent-out/routes.json)
 *   PR_REVIEW_STORAGE_STATE           — Playwright storageState JSON for authed
 *                                       routes (optional; produced by the agent
 *                                       via the e2e Clerk fixtures when in scope)
 *
 * Routes manifest shape (JSON array):
 *   [{ "path": "/files/some-real-slug", "label": "File detail" }, ...]
 * A bare array of strings (["/", "/files"]) is also accepted.
 *
 * Designed to be invoked by the agent via:
 *   npx tsx scripts/pr-review/capture-screenshots.ts
 * but it is plain Node — runnable locally against any base URL too.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

const AGENT_OUT = ".agent-out";
const SCREENS_DIR = path.join(AGENT_OUT, "screens");
const DEFAULT_ROUTES_FILE = path.join(AGENT_OUT, "routes.json");
const REPORT_FILE = path.join(AGENT_OUT, "capture-report.json");

/** The widths we shoot every route at. Names land in the filenames. */
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

// Third-party hosts whose console errors / failed requests are routine
// noise in a preview environment — mirrors the filter rule the agent
// prompt already applies to its own findings.
const NOISE_HOST_RE =
  /clerk\.|clerk-telemetry|sentry|ingest\.|segment\.|google-analytics|googletagmanager|stripe\.com|doubleclick|hotjar|fullstory|posthog/i;

interface RouteSpec {
  path: string;
  label?: string;
}

interface RouteResult {
  path: string;
  label: string;
  screenshots: Record<string, string>; // width name -> relative png path
  consoleErrors: string[];
  failedRequests: string[];
  navError: string | null;
  ok: boolean;
}

function slugifyPath(p: string): string {
  const cleaned = p.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-");
  return cleaned || "home";
}

function loadRoutes(file: string): RouteSpec[] {
  if (!fs.existsSync(file)) {
    console.error(
      `[capture] routes file not found: ${file} — nothing to capture. ` +
        `The agent must write resolved routes there first.`
    );
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`[capture] routes file is not valid JSON: ${(err as Error).message}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error(`[capture] routes file must be a JSON array`);
    return [];
  }
  const routes: RouteSpec[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    let spec: RouteSpec | null = null;
    if (typeof entry === "string") {
      spec = { path: entry };
    } else if (entry && typeof entry === "object" && typeof (entry as RouteSpec).path === "string") {
      spec = { path: (entry as RouteSpec).path, label: (entry as RouteSpec).label };
    }
    if (!spec) continue;
    // Normalize to a leading-slash path; skip unresolved dynamic segments.
    let p = spec.path.trim();
    if (!p.startsWith("/")) p = "/" + p;
    if (p.includes("[") || p.includes("]")) {
      console.warn(`[capture] skipping route with unresolved dynamic segment: ${p}`);
      continue;
    }
    if (seen.has(p)) continue;
    seen.add(p);
    routes.push({ path: p, label: spec.label });
  }
  return routes;
}

async function captureRoute(
  browser: Browser,
  baseUrl: string,
  sameOrigin: string,
  extraHeaders: Record<string, string> | undefined,
  storageState: string | undefined,
  route: RouteSpec,
  idx: number
): Promise<RouteResult> {
  const slug = slugifyPath(route.path);
  const result: RouteResult = {
    path: route.path,
    label: route.label || route.path,
    screenshots: {},
    consoleErrors: [],
    failedRequests: [],
    navError: null,
    ok: true,
  };

  const target = new URL(route.path, baseUrl).toString();

  for (const vp of VIEWPORTS) {
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        extraHTTPHeaders: extraHeaders,
        // When the agent has produced a signed-in Clerk session for
        // authed routes, reuse it. Absent (the common anon case) this
        // is undefined and the context is a fresh anon session.
        ...(storageState ? { storageState } : {}),
      });
      const page = await context.newPage();

      // Collect findings once (on the desktop pass is enough, but we
      // attach on every pass and de-dupe — cheap and resilient).
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (NOISE_HOST_RE.test(text)) return;
        if (!result.consoleErrors.includes(text)) result.consoleErrors.push(text);
      });
      page.on("response", (resp) => {
        const status = resp.status();
        if (status < 400) return;
        const url = resp.url();
        if (!url.startsWith(sameOrigin)) return; // only same-origin failures count
        if (NOISE_HOST_RE.test(url)) return;
        const line = `${status} ${url}`;
        if (!result.failedRequests.includes(line)) result.failedRequests.push(line);
      });

      try {
        await page.goto(target, { waitUntil: "load", timeout: 30_000 });
      } catch (err) {
        // A nav timeout shouldn't abort the screenshot — many app routes
        // keep a long-poll open and never reach "load" cleanly. Record it
        // and still try to shoot whatever rendered.
        result.navError = (err as Error).message;
      }
      // Let client-side render + fonts settle before the shot.
      await page.waitForTimeout(1500);

      const rel = path.join("screens", `${idx}-${slug}-${vp.name}.png`);
      await page.screenshot({
        path: path.join(AGENT_OUT, rel),
        fullPage: true,
      });
      result.screenshots[vp.name] = rel;
      console.log(`[capture] ${route.path} @ ${vp.name} -> ${rel}`);
    } catch (err) {
      result.ok = false;
      result.navError = result.navError || (err as Error).message;
      console.error(`[capture] failed ${route.path} @ ${vp.name}: ${(err as Error).message}`);
    } finally {
      if (context) await context.close();
    }
  }

  if (Object.keys(result.screenshots).length === 0) result.ok = false;
  return result;
}

async function main() {
  const baseUrl = process.env.PREVIEW_URL;
  if (!baseUrl) {
    console.error("[capture] PREVIEW_URL is required");
    process.exit(1);
  }
  const sameOrigin = new URL(baseUrl).origin;
  const routesFile = process.env.PR_REVIEW_ROUTES_FILE || DEFAULT_ROUTES_FILE;

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const extraHeaders = bypass
    ? {
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "true",
      }
    : undefined;

  // Optional pre-authenticated Clerk session for authed routes.
  let storageState: string | undefined;
  const storageStatePath = process.env.PR_REVIEW_STORAGE_STATE;
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    storageState = storageStatePath;
    console.log(`[capture] using storage state from ${storageStatePath}`);
  }

  fs.mkdirSync(SCREENS_DIR, { recursive: true });

  const routes = loadRoutes(routesFile);
  if (routes.length === 0) {
    // Still write a report so the agent / artifact has a breadcrumb
    // instead of nothing at all.
    fs.writeFileSync(
      REPORT_FILE,
      JSON.stringify(
        { baseUrl, capturedAt: new Date().toISOString(), routes: [], note: "no routes to capture" },
        null,
        2
      )
    );
    console.log("[capture] no routes — wrote empty report");
    return;
  }

  console.log(`[capture] capturing ${routes.length} route(s) at ${VIEWPORTS.length} widths against ${baseUrl}`);

  const browser = await chromium.launch();
  const results: RouteResult[] = [];
  try {
    let idx = 0;
    for (const route of routes) {
      idx += 1;
      results.push(
        await captureRoute(
          browser,
          baseUrl,
          sameOrigin,
          extraHeaders,
          storageState,
          route,
          idx
        )
      );
    }
  } finally {
    await browser.close();
  }

  const report = {
    baseUrl,
    capturedAt: new Date().toISOString(),
    widths: VIEWPORTS,
    routes: results,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  const shotCount = results.reduce((n, r) => n + Object.keys(r.screenshots).length, 0);
  const withErrors = results.filter(
    (r) => r.consoleErrors.length > 0 || r.failedRequests.length > 0 || !r.ok
  ).length;
  console.log(
    `[capture] done: ${shotCount} screenshot(s) across ${results.length} route(s); ` +
      `${withErrors} route(s) with errors/failures. Report: ${REPORT_FILE}`
  );
}

main().catch((err) => {
  console.error("[capture] fatal:", err);
  process.exit(1);
});
