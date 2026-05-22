/**
 * pr-browser-review: programmatic Claude Agent SDK session that
 * opens a PR's preview deploy, identifies the surfaces the diff
 * touches, drives a headless browser through them, and posts a
 * structured review comment back to the PR.
 *
 * Designed to run inside a GitHub Action (see
 * .github/workflows/pr-browser-review.yml) — fires on
 * `deployment_status` so Vercel's preview is guaranteed ready by
 * the time the agent starts; no polling for the URL.
 *
 * Inputs (all via env):
 *   PR_NUMBER     — the PR being reviewed (resolved upstream)
 *   PREVIEW_URL   — the Vercel preview URL for this commit
 *   PR_HEAD_SHA   — the commit SHA being deployed
 *   BASE_REF      — what to diff against (defaults to "main")
 *
 * The agent's job:
 *   1. `gh pr diff $PR_NUMBER` to see what changed
 *   2. Map touched files to user-visible routes
 *   3. Drive Chromium through each route, collect console errors,
 *      failed network requests, and visual sanity checks
 *   4. Post (or edit) a marker-tagged review comment with findings
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
  return { prNumber, previewUrl, prHeadSha, baseRef };
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

2. **Reproduce.** Write a throwaway Playwright spec at
   \`.agent-out/review.spec.ts\` that visits each in-scope route
   against the preview and:
     - asserts no uncaught console errors
     - asserts no failed (4xx/5xx) requests to the same origin (3rd
       party 4xx is noise — filter)
     - takes a screenshot of each route into \`.agent-out/screens/\`
     - exercises any obvious interactive bits the diff implies
       (form submits, dialog opens, etc.) — keep it shallow, this
       isn't full E2E, it's a smoke check.

   Use \`page.goto("/some/path")\` — the config's baseURL resolves
   it to the preview. Run with:

   \`\`\`
   PLAYWRIGHT_BASE_URL=${ctx.previewUrl} PLAYWRIGHT_NO_WEBSERVER=1 \\
     npx playwright test --config=playwright.config.ts \\
     .agent-out/review.spec.ts --reporter=line
   \`\`\`

   \`PLAYWRIGHT_NO_WEBSERVER=1\` is critical — without it the config
   tries to boot \`npm run dev\` on localhost:3000 and the run dies.

   ### Authed routes

   For surfaces gated by Clerk (anything under \`/dashboard\`, edit
   dialogs, library — when the diff implies one of these), import
   the fixtures helpers from \`../e2e/fixtures\` and the testing
   shim from \`@clerk/testing/playwright\`:

   \`\`\`ts
   import {
     createClerkTestUser, deleteClerkTestUser,
     seedAppUserForClerkId, deleteAppUserRow,
   } from "../e2e/fixtures";
   import { clerk } from "@clerk/testing/playwright";

   // beforeAll: mint a fresh test user + seed app row
   // beforeEach: page.goto("/"); await clerk.signIn({ page,
   //   signInParams: { strategy: "email_code", identifier: user.email } });
   // afterAll:  deleteAppUserRow + deleteClerkTestUser
   \`\`\`

   See \`e2e/library.spec.ts\` for the full pattern.

   **Hard gate before attempting any authed flow**: verify the
   preview is wired to Clerk TEST keys, not prod. Check the env
   value of \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` exposed to this
   workflow — if it doesn't start with \`pk_test_\`, skip authed
   coverage entirely and note in the comment that the preview
   appears to use production Clerk keys (creating test users
   against prod would pollute the real user table). Anon
   coverage still proceeds.

3. **Report.** Post a single PR review comment with this exact
   markdown structure:

   \`\`\`
   ${COMMENT_MARKER}
   ## 🤖 PR browser review — ${ctx.prHeadSha.slice(0, 7)}

   **Scope**: <one line — what routes you checked and why>

   **Result**: ✅ Clean / ⚠️ Findings / ❌ Failures

   <if findings/failures, a bulleted list>

   <Optional: short notes the human reviewer should know>

   _Preview: ${ctx.previewUrl}_
   \`\`\`

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
   \`@clerk/testing/playwright\` for authed routes — see the spec
   section above. The \`pk_test_\` check is the only hard gate:
   if it fails, skip authed and note it. Always clean up users +
   app rows in \`afterAll\` even if assertions fail.

4. **Filter noise aggressively.** Sentry/Clerk/analytics 3rd-party
   requests fail in test environments routinely; they're not
   findings. Console warnings (yellow) are not findings. Only
   console errors (red) and same-origin 4xx/5xx count.

5. **Be brief in the comment.** Reviewers skim. One line of scope,
   one line of result, max 5 bullets of findings. The full agent
   transcript lives in the workflow log if anyone wants depth.

6. **Time budget.** You have ~20 minutes wall-clock. Don't write a
   full E2E suite — write the smallest spec that exercises the
   in-scope routes and run it once. If the spec doesn't compile,
   fix the spec, don't keep iterating forever.

7. **Always write \`.agent-out/summary.md\`** with: scope decision,
   spec path, run result, comment URL. The workflow uploads
   \`.agent-out/\` as an artifact so this is the audit trail.

# Workflow

Standard tools: Read, Write, Edit, Bash, Grep, Glob. Start by
reading AGENTS.md for project conventions, then the changed files
to understand intent, then write + run the spec.`;
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
