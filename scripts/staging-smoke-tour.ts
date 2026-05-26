/**
 * staging-smoke-tour: scheduled Claude Agent SDK session that walks
 * the revenue-critical flows against the staging deploy and raises a
 * GitHub issue only when something regresses.
 *
 * Unlike pr-browser-review (scoped to a PR's diff), this tour runs a
 * FIXED checklist of the highest-value flows on a cadence. It catches
 * the class of failure no PR can surface: nothing changed in the
 * codebase, but staging broke anyway — an env var rotated, a third-
 * party API drifted, a credential expired, a dependency's CDN went
 * down.
 *
 * Triggered by .github/workflows/staging-smoke-tour.yml (daily cron +
 * manual dispatch). Requires STAGING_URL; the workflow skips the run
 * entirely when it's unset so this never fires against a nonexistent
 * environment.
 *
 * Reporting contract — quiet when green, loud on regression:
 *   - FAIL  → open (or update) the marker-tagged tracking issue
 *   - PASS  → close any open tracking issue (self-heal)
 *   - PASS + no open issue → do nothing
 *
 * Guardrails:
 *   - Allowed tools: Read, Write, Edit, Bash, Grep, Glob.
 *   - 25-minute hard abort.
 *   - The agent reviews + reports only; it never edits repo code.
 *
 * STAGING_SMOKE_TOUR_DRY_RUN=1 prints the resolved prompt and exits.
 */
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const AGENT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes
const ISSUE_MARKER = "<!-- staging-smoke-tour:status -->";

interface RunContext {
  stagingUrl: string;
}

function loadContext(): RunContext {
  const stagingUrl = process.env.STAGING_URL;
  if (!stagingUrl) {
    throw new Error(
      "STAGING_URL not set — the workflow should have skipped this run. " +
        "Refusing to tour an unknown target."
    );
  }
  return { stagingUrl };
}

function buildPrompt(ctx: RunContext): string {
  return `You're running the scheduled staging smoke tour. Walk the
revenue-critical flows against the staging deploy in a real Chromium
browser and report regressions. You do NOT modify repo code — your
only write op is opening / updating / closing a GitHub tracking issue.

# Target

Staging URL:  ${ctx.stagingUrl}

This is a dedicated staging environment. It SHOULD be wired to test
Clerk keys (\`pk_test_\`) and either CraftCloud's mock or a CraftCloud
sandbox account. Confirm the Clerk key class before any authed flow
(same gate as pr-browser-review): if \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\`
in this workflow's env doesn't start with \`pk_test_\`, skip authed
flows and note it.

# The checklist (in priority order)

These are the flows that matter most. Walk each, asserting no uncaught
console errors and no same-origin 4xx/5xx. Take a screenshot of each
into \`.agent-out/screens/\`.

1. **Home** \`/\` — loads, hero renders, no console errors.
2. **Browse files** \`/files\` — listing renders cards (or a clean
   empty state).
3. **Materials** \`/materials\` then a sample \`/materials/[slug]\` —
   the material detail page renders with its "Print with X" button.
4. **File detail** \`/files/[slug]\` — pick a published file slug from
   the browse listing and open it.
5. **Print quote pipeline (THE hot path)** — \`/print\`. As an anon
   user: upload a tiny STL (generate an 84-byte binary STL in-memory,
   see e2e/print-flow.spec.ts \`tinyStlBuffer()\` for the exact
   shape), confirm the quote configurator mounts and the upload
   transitions away from the empty state.
     - If staging uses CraftCloud's MOCK, the quote list won't render
       (the mock's material ids don't match live catalog UUIDs, so
       the poll route drops them — this is known + expected). Assert
       the upload path + configurator mount only; note "mock catalog,
       quote display not validated."
     - If staging uses a real CraftCloud SANDBOX, push further: wait
       for quotes to populate, pick a material/finish/vendor, click
       "Proceed to Checkout", confirm the shipping form appears. STOP
       before submitting payment — do not complete a Stripe checkout.
6. **Auth** — sign in with a freshly-minted Clerk test user (use the
   e2e/fixtures.ts helpers + clerk.signIn, same as library.spec.ts),
   confirm the authed home / library renders. Clean up the user in
   afterAll.

# How to run

Write the spec at \`.agent-out/tour.spec.ts\` and run with:

\`\`\`
PLAYWRIGHT_BASE_URL=${ctx.stagingUrl} PLAYWRIGHT_NO_WEBSERVER=1 \\
  npx playwright test --config=playwright.config.ts \\
  .agent-out/tour.spec.ts --reporter=line
\`\`\`

Use \`page.goto("/path")\` — baseURL resolves to staging.

# Reporting (quiet-when-green)

Decide PASS or FAIL:
  - FAIL if any flow has uncaught console errors, same-origin 5xx,
    an unexpected 4xx, a crash, or a flow that can't complete its
    documented happy path (excluding the known mock-catalog quote
    case, which is not a failure).
  - PASS otherwise.

Find the tracking issue first:
\`gh issue list --state open --search "${ISSUE_MARKER} in:body" --json number,title\`
(There should be at most one.)

- **FAIL**: if an open tracking issue exists, EDIT its body via
  \`gh issue edit <n> --body-file <path>\`; else open one with
  \`gh issue create --title "🤖 Staging smoke tour failing" --body-file <path>\`.
  The body MUST start with \`${ISSUE_MARKER}\` and include: which
  flow(s) failed, the symptom, a screenshot reference, and the run
  timestamp. Keep it skimmable.

- **PASS**: if an open tracking issue exists, close it with a comment
  noting the tour is green again:
  \`gh issue close <n> --comment "✅ Staging smoke tour green as of <timestamp>"\`.
  If no open issue exists, do NOTHING — no issue, no comment. Green
  runs are silent.

# Rules

1. Do NOT modify repo code. Writes go to \`.agent-out/\` only. The
   only gh write ops are issue create/edit/close.
2. Do NOT complete a real checkout or place a real order, even on
   staging — stop at the Stripe redirect / shipping form.
3. Clean up any Clerk test users + app rows you create.
4. ~25 minute budget. Write ONE spec covering the checklist, run it
   once, interpret, report. Don't iterate forever on a flaky flow —
   if something's flaky, that's itself a finding worth the issue.
5. Always write \`.agent-out/summary.md\`: per-flow pass/fail, the
   PASS/FAIL verdict, and the issue URL (if any). This is the audit
   trail the workflow uploads as an artifact.

# Workflow

Standard tools: Read, Write, Edit, Bash, Grep, Glob. Read AGENTS.md
and e2e/print-flow.spec.ts + e2e/library.spec.ts for the existing
patterns before writing the tour spec.`;
}

async function main() {
  console.log("[staging-smoke-tour] starting");

  const ctx = loadContext();
  console.log(`[staging-smoke-tour] target=${ctx.stagingUrl}`);

  const prompt = buildPrompt(ctx);
  fs.mkdirSync(".agent-out", { recursive: true });

  if (process.env.STAGING_SMOKE_TOUR_DRY_RUN === "1") {
    console.log("[staging-smoke-tour] DRY_RUN — printing prompt and exiting");
    console.log("\n=== PROMPT ===\n" + prompt + "\n=== END PROMPT ===\n");
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.error(
      `[staging-smoke-tour] hard timeout at ${AGENT_TIMEOUT_MS}ms — aborting session`
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
    `[staging-smoke-tour] session ended after ${assistantTurns} assistant turns`
  );
}

main().catch((err) => {
  console.error("[staging-smoke-tour] fatal:", err);
  process.exit(1);
});
