/**
 * pr-browser-review: programmatic Claude Agent SDK session that
 * opens a PR's preview deploy, identifies the surfaces the diff
 * touches, drives a headless browser through them, and posts a
 * structured review comment back to the PR.
 *
 * Designed to run inside a GitHub Action (see
 * .github/workflows/pr-browser-review.yml). That workflow is
 * DISABLED (CON-15) — it used to fire on `deployment_status`
 * once Vercel marked the preview Ready. Re-enable the yaml
 * trigger to restore the loop.
 *
 * Inputs (all via env):
 *   PR_NUMBER     — the PR being reviewed (resolved upstream)
 *   PREVIEW_URL   — the Vercel preview URL for this commit
 *   PR_HEAD_SHA   — the commit SHA being deployed
 *   BASE_REF      — what to diff against (defaults to "main")
 *
 * The agent's job:
 *   1. `gh pr diff $PR_NUMBER` to see what changed
 *   2. Map touched files to user-visible routes (resolving dynamic
 *      `[slug]` segments to real values) and write them to
 *      `.agent-out/routes.json`
 *   3. Run scripts/pr-review/capture-screenshots.ts, which shoots each
 *      route at mobile/tablet/desktop widths and records console
 *      errors + same-origin request failures into
 *      `.agent-out/capture-report.json`
 *   4. Post (or edit) a marker-tagged review comment with findings +
 *      a screenshot index pointing at the uploaded artifact
 *
 * Why a committed capturer instead of an agent-authored spec: the
 * original prompt asked the agent to write its own Playwright spec to
 * take screenshots. When that spec didn't compile, ran out of budget,
 * or was skipped, .agent-out/ stayed empty and the artifact upload
 * produced an empty file. Capture is now deterministic; the agent only
 * decides *which* routes to shoot.
 *
 * Guardrails:
 *   - Allowed tools: Read, Write, Edit, Bash, Grep, Glob — same
 *     surface as sentry-fixer.
 *   - Hard 20-minute abort; PRs should be smaller and faster than
 *     a full Sentry repro.
 *   - The prompt forbids editing repo code — this agent reviews,
 *     never modifies. Writes go to .agent-out/ only.
 *
 * Dry-run hook: SENTRY_FIXER_DRY_RUN-style flag isn't reused
 * (different concern). Instead set PR_BROWSER_REVIEW_DRY_RUN=1
 * to print the resolved prompt and exit without spawning the
 * agent.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  mapFilesToRoutes,
  formatRouteImpacts,
} from "../lib/pr-review/file-to-routes";

const AGENT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const COMMENT_MARKER = "<!-- pr-browser-review:autoreview -->";

interface RunContext {
  prNumber: string;
  previewUrl: string;
  prHeadSha: string;
  baseRef: string;
  /** Name of the uploaded artifact (matches the workflow's upload step). */
  artifactName: string;
  /** URL of the workflow run whose artifacts hold the screenshots. */
  artifactRunUrl: string;
}

function loadContext(): RunContext {
  const prNumber = process.env.PR_NUMBER;
  const previewUrl = process.env.PREVIEW_URL;
  const prHeadSha = process.env.PR_HEAD_SHA;
  const baseRef = process.env.BASE_REF || "main";
  if (!prNumber || !previewUrl || !prHeadSha) {
    throw new Error(
      `Missing required env: PR_NUMBER=${prNumber ?? "(unset)"} PREVIEW_URL=${
        previewUrl ?? "(unset)"
      } PR_HEAD_SHA=${prHeadSha ?? "(unset)"}`
    );
  }
  // Mirror the workflow's artifact name so the comment can point the
  // reviewer at the exact artifact to download. Kept in sync with
  // `.github/workflows/pr-browser-review.yml` (upload-artifact `name:`).
  const artifactName = `pr-browser-review-${prNumber}-${prHeadSha}`;
  // GitHub sets these default env vars in every Actions step; fall back
  // to sensible defaults for local/dry runs.
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID || "";
  const artifactRunUrl =
    repo && runId ? `${server}/${repo}/actions/runs/${runId}` : "(run URL unavailable)";
  return { prNumber, previewUrl, prHeadSha, baseRef, artifactName, artifactRunUrl };
}

interface DiffSnapshot {
  /** Raw `git diff --name-status` output, lines unchanged. */
  rawNameStatus: string;
  /** Just the file paths (no status letter), for the route mapper. */
  changedPaths: string[];
}

/**
 * Snapshot of the PR's diff stats. Used to seed the prompt with the
 * touched-file list so the agent doesn't burn turns calling `gh pr
 * diff` just to bootstrap. Also yields a parsed path list for the
 * deterministic route mapper.
 */
function snapshotChangedFiles(baseRef: string): DiffSnapshot {
  try {
    const stdout = execFileSync(
      "git",
      ["diff", "--name-status", `origin/${baseRef}...HEAD`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { rawNameStatus: "(no changes detected)", changedPaths: [] };
    }
    const paths = trimmed
      .split("\n")
      .map((line) => {
        // `git diff --name-status` lines look like "M\tpath/to/file"
        // for modifications, "A\tpath" for adds, "R100\told\tnew"
        // for renames. We want the post-rename path either way.
        const parts = line.split("\t");
        return parts[parts.length - 1] ?? "";
      })
      .filter(Boolean);
    return { rawNameStatus: trimmed, changedPaths: paths };
  } catch (err) {
    return {
      rawNameStatus: `(git diff failed: ${(err as Error).message})`,
      changedPaths: [],
    };
  }
}

function buildPrompt(ctx: RunContext, diff: DiffSnapshot): string {
  const impacts = mapFilesToRoutes(diff.changedPaths);
  const impactBlock = formatRouteImpacts(impacts);
  return `You're reviewing a pull request by opening its Vercel preview
deploy and driving a real Chromium browser through the surfaces it
changes. You don't modify code — your output is a structured PR
comment.

# Context

PR:           #${ctx.prNumber}
Head SHA:     ${ctx.prHeadSha}
Base branch:  ${ctx.baseRef}
Preview URL:  ${ctx.previewUrl}

## Files changed (git diff --name-status against base)

\`\`\`
${diff.rawNameStatus}
\`\`\`

## Pre-computed route impact (deterministic, from path parse)

${impactBlock}

This list is exhaustive for direct app-router file changes. It is
NOT exhaustive for component/lib changes — for those, the diff
column above is the source of truth and you'll need to grep for
callers. Start with this list as your minimum scope; add to it
based on the diff.

# Your workflow

1. **Scope.** Start from the "Pre-computed route impact" list above —
   those routes are derived deterministically from app-router file
   paths and you do not need to re-derive them. For each impact:
     - \`page\` / \`loading\` / \`error\` / \`not-found\`: visit that
       route directly, substituting any \`[dynamic]\` segments with
       a real value (find a published slug via \`gh pr diff\` or a
       quick grep through the codebase / DB sample).
     - \`layout\` / \`template\` with \`affectsSubtree: true\`: pick
       a representative sample of child routes (2-3 is enough) and
       visit those.
     - \`api\`: don't visit the API directly. Grep for the path in
       \`app/\` and \`components/\` to find callers, then visit one.
     - \`metadata\` (opengraph-image, sitemap, robots): skip browser
       visit, just curl the URL via Bash to verify a 200.

   Then add to that list based on the diff: changes to
   \`components/\`, \`lib/\`, or other non-route files won't show up
   in the pre-computed list. Grep for who imports them to find the
   routes that render them and add those to your scope. If a
   change is purely under \`lib/\`, \`scripts/\`, or other
   non-rendering paths, say so in the comment and exit cleanly.

2. **Capture screenshots (deterministic — do NOT write your own
   spec).** Capture is handled by a committed script,
   \`scripts/pr-review/capture-screenshots.ts\`. Your only job is to
   tell it which routes to shoot. Write the in-scope routes — with
   every \`[dynamic]\` segment already substituted for a REAL value —
   to \`.agent-out/routes.json\` as a JSON array:

   \`\`\`json
   [
     { "path": "/", "label": "Home" },
     { "path": "/files/some-real-published-slug", "label": "File detail" }
   ]
   \`\`\`

   Rules for \`routes.json\`:
     - Resolve dynamic segments to a real value (find a published slug
       via \`gh pr diff\`, a grep, or a DB sample). Routes still
       containing \`[\` or \`]\` are skipped by the capturer.
     - Keep it tight — the routes the diff actually affects, ideally
       2–6 entries. Every route is shot at 3 widths, so this isn't
       free.
     - Even for a single route, you MUST write this file. An empty or
       missing file means an empty artifact — the exact bug we're
       fixing. Writing it is not optional.

   Then run the capturer (it reads \`PREVIEW_URL\` and the Vercel
   bypass secret from the environment — both are already set):

   \`\`\`
   npx tsx scripts/pr-review/capture-screenshots.ts
   \`\`\`

   It writes a full-page PNG per route per width into
   \`.agent-out/screens/\` (named \`<idx>-<slug>-<width>.png\`, widths:
   mobile 390 / tablet 768 / desktop 1440) and a findings file at
   \`.agent-out/capture-report.json\` containing, per route, the
   captured screenshot paths plus any same-origin 4xx/5xx requests and
   uncaught console errors. READ that report — it is the source for
   both your "Result" line and the screenshot index below. You do not
   need to write or run any Playwright spec yourself.

   If you need to exercise an interactive bit the diff implies (a form
   submit, a dialog open) that a plain page load won't reveal, you may
   add that route to \`routes.json\` at the post-interaction URL, or
   note in the comment that it needs manual verification — but keep
   the smoke shallow and do not hand-roll a test harness.

   ### Authed routes

   The capturer shoots anon sessions by default. For surfaces gated
   by Clerk (anything under \`/dashboard\`, edit dialogs, library —
   when the diff implies one of these) the capturer can reuse a
   signed-in session if you hand it a Playwright storage state. Do
   this ONLY when an authed route is genuinely in scope:

   1. **Hard gate first.** Verify the preview is wired to Clerk TEST
      keys, not prod: the env value of
      \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` must start with
      \`pk_test_\`. If it doesn't, skip authed coverage entirely and
      note in the comment that the preview appears to use production
      Clerk keys (minting test users against prod would pollute the
      real user table). Anon coverage still proceeds normally.

   2. **Mint a session → storage state.** Write a tiny one-shot
      script at \`.agent-out/auth-setup.ts\` that uses the e2e
      fixtures to create a test user, sign in, and dump the browser
      storage state, then run it with \`npx tsx\`:

   \`\`\`ts
   import { chromium } from "playwright";
   import { clerkSetup, clerk } from "@clerk/testing/playwright";
   import {
     createClerkTestUser, deleteClerkTestUser,
     seedAppUserForClerkId, deleteAppUserRow,
   } from "../e2e/fixtures";

   // mint user + seed app row (see e2e/library.spec.ts for the pattern),
   // launch a context with the Vercel bypass headers, page.goto("/"),
   // await clerk.signIn({ page, signInParams: { strategy: "email_code",
   //   identifier: user.email } }), then:
   //   await context.storageState({ path: ".agent-out/auth-state.json" });
   // Keep the created user id around so you can clean it up after capture.
   \`\`\`

   3. **Capture with it.** Re-run the capturer with the authed
      routes in \`routes.json\` and the storage state pointed at:

   \`\`\`
   PR_REVIEW_STORAGE_STATE=.agent-out/auth-state.json \\
     npx tsx scripts/pr-review/capture-screenshots.ts
   \`\`\`

   4. **Always clean up** the Clerk test user + app row afterward
      (\`deleteAppUserRow\` + \`deleteClerkTestUser\`), even if capture
      failed.

   If any of this is shaky or out of budget, skip authed and note in
   the comment which authed surfaces still need a manual look. Anon
   screenshots are the priority — don't sink the whole run chasing an
   authed session.

3. **Report.** Post a single PR review comment with this exact
   markdown structure:

   \`\`\`
   ${COMMENT_MARKER}
   ## 🤖 PR browser review — ${ctx.prHeadSha.slice(0, 7)}

   **Scope**: <one line — what routes you checked and why>

   **Result**: ✅ Clean / ⚠️ Findings / ❌ Failures

   <if findings/failures, a bulleted list>

   ### 📸 Screenshots

   Captured at 3 widths — **mobile 390** / **tablet 768** /
   **desktop 1440**. Download the full-resolution set from the
   [workflow run artifacts](${ctx.artifactRunUrl}) → artifact
   \`${ctx.artifactName}\` → \`.agent-out/screens/\`.

   | Route | Screenshots (in artifact) |
   | --- | --- |
   | \`/\` | \`1-home-{mobile,tablet,desktop}.png\` |
   <one row per route from capture-report.json; list the captured
   png filenames for that route. If a route failed to capture, say so
   in the cell.>

   <Optional: short notes the human reviewer should know>

   _Preview: ${ctx.previewUrl}_
   \`\`\`

   Build the screenshot table from \`.agent-out/capture-report.json\`
   (the \`screenshots\` map on each route entry gives you the exact
   png filenames). The artifact is uploaded by the workflow after this
   step, so the link works once the run finishes. Do NOT try to inline
   the images — they live in the downloadable artifact, not as
   attachments.

   Post via \`gh pr comment ${ctx.prNumber} --body-file <path>\`.
   BEFORE posting, look for an existing comment containing
   \`${COMMENT_MARKER}\` using \`gh pr view ${ctx.prNumber} --json
   comments\` and EDIT it via \`gh api -X PATCH /repos/{owner}/{repo}/issues/comments/<id>\`
   instead of stacking a new one. This keeps the PR thread clean
   across multiple pushes.

# Rules

1. **Do NOT modify repo code.** No Edits to anything outside
   \`.agent-out/\`. Your job is review, not fix. If you find a bug,
   describe it in the comment — a human (or the sentry-fixer) will
   handle it.

2. **Do NOT open PRs.** No \`gh pr create\` calls. The only gh
   write op you make is \`gh pr comment\` / \`gh api ... issues/comments\`.

3. **Authed flows are gated, not forbidden.** Use the
   \`e2e/fixtures.ts\` helpers + \`clerk.signIn\` from
   \`@clerk/testing/playwright\` to mint a storage state for authed
   routes — see the "Authed routes" section above. The \`pk_test_\`
   check is the only hard gate: if it fails, skip authed and note it.
   Always clean up the Clerk test user + app row afterward even if
   capture fails.

4. **Filter noise aggressively.** Sentry/Clerk/analytics 3rd-party
   requests fail in test environments routinely; they're not
   findings. Console warnings (yellow) are not findings. Only
   console errors (red) and same-origin 4xx/5xx count.

5. **Be brief in the comment.** Reviewers skim. One line of scope,
   one line of result, max 5 bullets of findings. The full agent
   transcript lives in the workflow log if anyone wants depth.

6. **Time budget.** You have ~20 minutes wall-clock. Capture is
   already deterministic — your time goes to picking the right routes,
   resolving dynamic slugs, and reading the report. Don't hand-roll a
   Playwright spec; the only script you run for screenshots is
   \`scripts/pr-review/capture-screenshots.ts\`.

7. **Always write \`.agent-out/summary.md\`** with: scope decision,
   routes captured, run result, comment URL. The workflow uploads
   \`.agent-out/\` as an artifact so this is the audit trail.

# Workflow

Standard tools: Read, Write, Edit, Bash, Grep, Glob. Start by
reading AGENTS.md for project conventions, then the changed files to
understand intent, then write \`.agent-out/routes.json\` and run the
capturer.`;
}

async function main() {
  console.log("[pr-browser-review] starting");

  const ctx = loadContext();
  console.log(
    `[pr-browser-review] pr=#${ctx.prNumber} sha=${ctx.prHeadSha.slice(
      0,
      7
    )} preview=${ctx.previewUrl}`
  );

  // Fetch the base ref so `git diff origin/<base>...HEAD` works.
  // Workflow checkout fetches the PR head + history, but not always
  // the base remote ref under detached-HEAD setups. Cheap to redo.
  try {
    execFileSync("git", ["fetch", "origin", ctx.baseRef], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch {
    // Non-fatal — the snapshot just falls back to "git diff failed"
    // and the agent can still re-run gh pr diff itself.
  }

  const diff = snapshotChangedFiles(ctx.baseRef);
  const prompt = buildPrompt(ctx, diff);

  fs.mkdirSync(".agent-out", { recursive: true });

  if (process.env.PR_BROWSER_REVIEW_DRY_RUN === "1") {
    console.log(
      "[pr-browser-review] DRY_RUN — printing prompt and exiting"
    );
    console.log("\n=== PROMPT ===\n" + prompt + "\n=== END PROMPT ===\n");
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.error(
      `[pr-browser-review] hard timeout at ${AGENT_TIMEOUT_MS}ms — aborting session`
    );
    abort.abort();
  }, AGENT_TIMEOUT_MS);

  let assistantTurns = 0;

  try {
    const result = query({
      prompt,
      options: {
        cwd: process.cwd(),
        abortController: abort,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
        // The prompt forbids editing repo code, but belt-and-
        // suspenders: an SDK-level disallow on Edit/Write would
        // also block .agent-out/ writes the agent legitimately
        // needs, so we don't gate at this layer. The forbidden-
        // paths discipline is enforced by the prompt.
        disallowedTools: [],
        permissionMode: "acceptEdits",
      },
    });

    for await (const message of result) {
      if (message.type === "assistant") {
        assistantTurns += 1;
      }
      console.log(JSON.stringify({ turn: assistantTurns, message }));
    }
  } finally {
    clearTimeout(timeout);
  }

  console.log(
    `[pr-browser-review] session ended after ${assistantTurns} assistant turns`
  );
}

main().catch((err) => {
  console.error("[pr-browser-review] fatal:", err);
  process.exit(1);
});
