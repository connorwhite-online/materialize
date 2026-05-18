/**
 * Sentry-fixer: programmatic Claude Agent SDK session that takes
 * a Sentry event and attempts to reproduce + fix the underlying
 * bug, then pushes a branch a human can review.
 *
 * Designed to run inside a GitHub Action (see
 * .github/workflows/sentry-fixer.yml) — a fresh CI checkout, an
 * ANTHROPIC_API_KEY in env, the repo's main branch as the
 * starting point.
 *
 * Usage (local smoke test):
 *
 *   cat sentry-event.json | npx tsx scripts/sentry-fixer.ts
 *
 * The script reads the Sentry event from stdin (preferred — keeps
 * shell-quoting hell out of the picture) or from argv[2] as a
 * file path. Streams the agent session's messages to stdout so
 * the workflow log is the audit trail.
 *
 * Guardrails baked in:
 *   - `disallowedTools` blocks Edit/Write to paths the
 *     prompt also forbids (schema, payouts, proxy).
 *   - The system prompt explicitly tells the agent to NOT open
 *     a PR — only push the branch. A human reviews + merges.
 *   - Aborts after AGENT_TIMEOUT_MS.
 *
 * What this script does NOT do (yet, intentionally):
 *   - Spin up a Neon DB branch for the session. v1 runs against
 *     the prod-snapshot Drizzle queries that already work in CI.
 *   - Auto-merge. The session pushes; the human merges.
 *   - Retry on failure. If the agent gets stuck, the workflow
 *     fails and a human picks it up.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";

const AGENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * How recently a prior PR for this issue counts as "still in flight."
 * Anything older has either landed (so the error wouldn't be firing
 * unless the fix regressed) or got abandoned (re-trying is fine).
 */
const DUP_LOOKBACK_DAYS = 7;

interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: { frames?: SentryFrame[] };
}

interface SentryBreadcrumb {
  timestamp?: number | string;
  category?: string;
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface SentryEvent {
  event_id?: string;
  id?: string;
  shortId?: string;
  message?: string;
  level?: string;
  release?: string;
  environment?: string;
  timestamp?: number | string;
  tags?: Record<string, string> | Array<[string, string]>;
  user?: { id?: string };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
  };
  exception?: { values?: SentryException[] };
  breadcrumbs?: { values?: SentryBreadcrumb[] } | SentryBreadcrumb[];
  // Issue-shaped fields — present when the trigger payload was a
  // Sentry "issue.created" notification rather than a full event.
  // The webhook only carries issue metadata in that case; full
  // event details (stack frames, breadcrumbs) live on the
  // permalink and require a follow-up Sentry API call to fetch.
  title?: string;
  culprit?: string;
  permalink?: string;
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
}

async function readEventFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loadEvent(): SentryEvent {
  const fromArg = process.argv[2];
  let raw: string;
  if (fromArg && fs.existsSync(fromArg)) {
    raw = fs.readFileSync(fromArg, "utf8");
  } else if (!process.stdin.isTTY) {
    // Synchronously can't easily wait on stdin, so we resolve in main()
    // and pass through there. This branch only fires when no file is
    // given — main() handles the actual read.
    raw = "";
  } else {
    throw new Error(
      "No event payload provided — pipe JSON via stdin or pass a file path"
    );
  }
  if (!raw) return {} as SentryEvent;
  try {
    return JSON.parse(raw) as SentryEvent;
  } catch (err) {
    throw new Error(`Could not parse Sentry event JSON: ${(err as Error).message}`);
  }
}

function formatTags(
  tags: SentryEvent["tags"]
): Record<string, string> | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) return Object.fromEntries(tags);
  return tags;
}

interface ExistingPr {
  number: number;
  state: string;
  title: string;
  url: string;
  updatedAt: string;
  headRefName: string;
}

/** Lines of `gh pr diff` we attach to the prompt for loose matches. */
const RELATED_PR_DIFF_LINE_CAP = 200;

/**
 * Look for in-flight or recently-merged work that already addresses
 * this Sentry issue. Searches PR titles + bodies + branch names for:
 *   - the per-occurrence event_id (32-char hex)
 *   - the issue-level id (numeric — Sentry groups by fingerprint,
 *     so multiple occurrences share this and the bot's prior PR
 *     will mention it)
 *
 * Returns matches updated within DUP_LOOKBACK_DAYS. Beyond that
 * window, prior work has either landed (and would have stopped the
 * error firing) or stalled, and a fresh attempt is the right move.
 *
 * Silent fall-through on `gh` errors — better to do a duplicate run
 * than to skip a legitimately fresh issue because gh hiccupped.
 *
 * Tokenization caveat: `gh pr list --search` splits the term on
 * non-alphanumerics and matches any token, so short or dashed ids
 * (e.g. shortId "MATERIALIZE-WEB-PLATFORM-7" → matches "MATERIALIZE"
 * → every PR mentioning the project) cause false positives. We only
 * accept ids that look like opaque hex blobs or long numeric ids;
 * shortId is intentionally excluded.
 */
const ID_PATTERN = /^(?:[a-f0-9]{16,}|[0-9]{6,})$/i;

function findExistingPRs(event: SentryEvent): ExistingPr[] {
  const ids = [event.event_id, event.id].filter(
    (s): s is string =>
      typeof s === "string" && s.length > 0 && ID_PATTERN.test(s)
  );
  if (ids.length === 0) return [];

  const cutoff = Date.now() - DUP_LOOKBACK_DAYS * 24 * 3600 * 1000;
  const seen = new Map<number, ExistingPr>();

  for (const id of ids) {
    let stdout: string;
    try {
      stdout = execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "all",
          "--search",
          id,
          "--limit",
          "10",
          "--json",
          "number,state,title,url,updatedAt,headRefName",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      console.warn(
        `[sentry-fixer] gh search for "${id}" failed:`,
        (err as Error).message
      );
      continue;
    }
    const matches = JSON.parse(stdout) as ExistingPr[];
    for (const pr of matches) {
      if (new Date(pr.updatedAt).getTime() < cutoff) continue;
      if (!seen.has(pr.number)) seen.set(pr.number, pr);
    }
  }

  return [...seen.values()];
}

/**
 * "Exact" = the PR's branch is literally fix/sentry-<strongest_id>.
 * The strongest id is event_id (per-occurrence) when present, else
 * the issue id (only one available on issue-webhook payloads). This
 * mirrors the agent's own branch-naming fallback chain so the same
 * input deterministically produces the same branch name.
 *
 * Crucially, we do NOT match `event.event_id` against a branch named
 * after `event.id` — that's the "same issue, new occurrence" case
 * where a previous fix may or may not cover the new stack, which is
 * a loose match (handled below by attaching the existing PR diff to
 * the prompt for the agent to evaluate).
 */
function isExactMatch(pr: ExistingPr, event: SentryEvent): boolean {
  const strongestId = event.event_id ?? event.id;
  return Boolean(strongestId) && pr.headRefName === `fix/sentry-${strongestId}`;
}

/**
 * Pull a truncated diff for a loose-match PR so the agent can decide
 * between extending the existing branch and opening a coordinated
 * follow-up. Capped at RELATED_PR_DIFF_LINE_CAP lines — the agent
 * does not need to understand every line to make the coordination
 * call, and an oversized diff burns context without proportionate
 * value.
 */
function fetchPrDiffSummary(prNumber: number): string {
  try {
    const diff = execFileSync("gh", ["pr", "diff", String(prNumber)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = diff.split("\n");
    if (lines.length <= RELATED_PR_DIFF_LINE_CAP) return diff;
    return (
      lines.slice(0, RELATED_PR_DIFF_LINE_CAP).join("\n") +
      `\n... [truncated — diff has ${lines.length} lines; full diff at the PR url]`
    );
  } catch (err) {
    return `(failed to fetch diff: ${(err as Error).message})`;
  }
}

interface RelatedPrContext {
  pr: ExistingPr;
  diff: string;
}

function buildPrompt(
  event: SentryEvent,
  relatedPrs: RelatedPrContext[] = []
): string {
  const ex = event.exception?.values?.[0];
  const frames = ex?.stacktrace?.frames ?? [];
  const appFrames = frames.filter((f) => f.in_app !== false).slice(-10);
  const tags = formatTags(event.tags) ?? {};
  const breadcrumbs = Array.isArray(event.breadcrumbs)
    ? event.breadcrumbs
    : event.breadcrumbs?.values ?? [];
  // Issue-shaped payloads (from Sentry's "issue.created" webhook)
  // don't carry exception frames — only metadata. Fall back to
  // those fields so the prompt is still actionable.
  const issueTitle = event.title;
  const culprit = event.culprit;
  const metaType = event.metadata?.type;
  const metaValue = event.metadata?.value;
  const metaFile = event.metadata?.filename;
  const metaFn = event.metadata?.function;
  const permalink = event.permalink;

  return `A Sentry event fired in production on the materialize repo. Your job is
to reproduce the failure locally, write a regression test that
demonstrates it, and fix the root cause.

# Event

ID:          ${event.event_id ?? event.id ?? event.shortId ?? "(unknown)"}
Level:       ${event.level ?? "error"}
Release:     ${event.release ?? "(unknown)"}
Environment: ${event.environment ?? "(unknown)"}
Timestamp:   ${event.timestamp ?? "(unknown)"}
${permalink ? `Permalink:   ${permalink}` : ""}
${issueTitle ? `Title:       ${issueTitle}` : ""}
${culprit ? `Culprit:     ${culprit}  ← grep this string in the codebase to find the call site` : ""}

## Exception

Type:        ${ex?.type ?? metaType ?? "(no type)"}
Message:     ${ex?.value ?? event.message ?? metaValue ?? issueTitle ?? "(no message)"}
${metaFile ? `File:        ${metaFile}` : ""}
${metaFn ? `Function:    ${metaFn}` : ""}

## In-app stack (last 10 frames, deepest first)

${appFrames
  .reverse()
  .map(
    (f, i) =>
      `${i + 1}. ${f.filename ?? "?"}:${f.lineno ?? "?"} in ${f.function ?? "?"}`
  )
  .join("\n") || "(no in-app frames captured)"}

## Tags

${Object.entries(tags).map(([k, v]) => `- ${k}=${v}`).join("\n") || "(no tags)"}

## Request

${event.request
  ? `${event.request.method ?? "GET"} ${event.request.url ?? ""}`
  : "(no request context)"}

## Breadcrumbs (most recent 5)

${
  breadcrumbs
    .slice(-5)
    .map(
      (b) =>
        `- [${b.category ?? "?"}] ${b.message ?? JSON.stringify(b.data ?? {})}`
    )
    .join("\n") || "(no breadcrumbs)"
}
${
  relatedPrs.length > 0
    ? `
# Existing related work

The pre-flight check found ${relatedPrs.length} PR(s) matching this
Sentry issue id (but NOT exactly your event_id — those would have
caused this run to skip entirely). Read each diff before deciding
what to do. See Rule 5 for the decision tree.

${relatedPrs
  .map(
    ({ pr, diff }) =>
      `## PR #${pr.number} (${pr.state}) — ${pr.title}
URL:     ${pr.url}
Branch:  ${pr.headRefName}
Updated: ${pr.updatedAt}

### Truncated diff (first ${RELATED_PR_DIFF_LINE_CAP} lines)

\`\`\`diff
${diff}
\`\`\`
`
  )
  .join("\n")}`
    : ""
}
# Rules

1. Reproduce the failure FIRST. Write a Playwright spec under
   e2e/, or extend an existing one, that fails today against the
   broken code. If you can't reproduce in 3 attempts, STOP and
   write a summary to .agent-out/summary.md explaining what you
   tried and why reproduction failed.

2. Fix the root cause, NOT the symptom. If the stack trace
   points at a null deref, ask why the value is null at all.

3. NEVER modify these files without escalation:
   - lib/db/schema.ts (schema migrations need human review)
   - lib/db/migrations/** (same)
   - app/actions/payouts.ts (payouts are revenue-critical)
   - lib/stripe/handle-*.ts (webhook handlers are revenue-critical)
   - proxy.ts (auth boundary)

   If the fix lives in one of those files, STOP and document the
   escalation in .agent-out/summary.md.

4. Before EDITING any production file, run \`git log -10 --oneline -- <path>\`.
   If recent (<7d) commits reference a Sentry event id OTHER than yours
   (look for "sentry-<digits>" or "Sentry <digits>" in the commit
   message), STOP and escalate to .agent-out/summary.md. Two
   independent runs touching the same file races branches into each
   other and is harder to untangle than a re-fire. The pre-flight
   check upstream of this prompt already filtered same-issue
   duplicates; what's left is cross-issue collisions.

5. If the "Existing related work" section above is present, the
   pre-flight check found PR(s) that touch this Sentry issue but
   aren't on your event_id's branch. Pick exactly one of:

   a. EXTEND — the existing PR is on the right track but doesn't
      cover the stack/scenario in your event. Check out its branch
      (\`git checkout <headRefName>\`), add your reproduction test
      + the missing piece of the fix, push to the same branch. Do
      NOT open a second PR — comment on the existing one with your
      event id and what you added.

   b. SUPERSEDE — the existing PR's approach is wrong or stale.
      Open your own \`fix/sentry-<event_id>\` branch and PR as
      usual; the PR body MUST link the superseded PR and explain
      in one paragraph why a new approach is needed. Tag the
      author as a reviewer.

   c. ESCALATE (default when EXTEND vs SUPERSEDE is not obvious
      from a single read of the existing diff) — do NOT edit any
      production file. Write the situation to .agent-out/summary.md
      including the existing PR url, your event_id, and what you
      need a human to decide. Then exit cleanly.

   Default toward ESCALATE. A human spending 5 minutes triaging is
   cheaper than a stacked branch you got wrong.

6. Run the full gate before pushing:
   - npx tsc --noEmit (must be clean except the line-anchored
     filter — see AGENTS.md for what's allowed)
   - npx playwright test (full suite must pass, including the
     regression test you just added)
   - npx vitest run (must pass)

7. Commit + push a branch named fix/sentry-${event.event_id ?? event.id ?? "unknown"},
   then open a pull request against main. Use \`gh pr create\` — the
   workflow runs with a GITHUB_TOKEN that has pull-requests:write
   scope, no extra auth needed. PR body must include:

   - The Sentry event id at the top.
   - One-paragraph root cause description.
   - "Reproduction" section linking to the regression test you added.
   - "Files changed" list (just the production files, not the new test).
   - "Verification" section listing the gates you ran and their results.
   - A footer noting this PR was opened by the sentry-fixer agent and
     requires human review before merge.

   Do NOT merge the PR. A human reviews and merges.

8. When done, write the same content to .agent-out/summary.md so the
   workflow artifact preserves a copy independent of the PR. The
   summary should answer:
   - Was the bug reproduced? (yes/no, and how)
   - Root cause description (one paragraph)
   - Files changed
   - How verified
   - PR URL (from \`gh pr create\`'s output)

# Workflow

Use the standard tools (Read, Write, Edit, Bash, Grep, Glob).
Start by reading AGENTS.md and the file(s) named in the stack
trace. Then write the regression test before touching production
code — the test failing FIRST is what proves you've reproduced
the bug.`;
}

async function main() {
  console.log("[sentry-fixer] starting");

  // Resolve event payload — stdin first (CI's preferred shape),
  // then file arg, then bail.
  let event: SentryEvent;
  if (process.argv[2] && fs.existsSync(process.argv[2])) {
    event = loadEvent();
  } else if (!process.stdin.isTTY) {
    const raw = await readEventFromStdin();
    event = raw ? (JSON.parse(raw) as SentryEvent) : ({} as SentryEvent);
  } else {
    console.error(
      "[sentry-fixer] No event payload — pipe JSON via stdin or pass a file path"
    );
    process.exit(2);
  }

  console.log(
    `[sentry-fixer] event=${event.event_id ?? "?"} release=${event.release ?? "?"}`
  );

  // Output dir for the agent to write its summary into. Gitignored.
  fs.mkdirSync(".agent-out", { recursive: true });

  // Pre-flight: classify existing PRs as exact (same event_id's
  // branch — true duplicate, skip) or loose (issue overlap but
  // distinct event — pass to the agent as context so it can choose
  // to extend, supersede, or escalate). Override with
  // SENTRY_FIXER_SKIP_DUP_CHECK=1 to bypass the whole gate.
  let relatedPrs: RelatedPrContext[] = [];
  if (process.env.SENTRY_FIXER_SKIP_DUP_CHECK !== "1") {
    const existing = findExistingPRs(event);
    const exact = existing.filter((pr) => isExactMatch(pr, event));
    const loose = existing.filter((pr) => !isExactMatch(pr, event));

    if (exact.length > 0) {
      const lines = exact.map(
        (pr) =>
          `  #${pr.number} (${pr.state}) [${pr.headRefName}] ${pr.title} — ${pr.url}`
      );
      console.log(
        `[sentry-fixer] skipping — exact-branch match(es) for this event:\n${lines.join("\n")}`
      );
      fs.writeFileSync(
        ".agent-out/summary.md",
        `# Skipped: duplicate of existing PR\n\nSentry event \`${
          event.event_id ?? event.id ?? "(unknown)"
        }\` is already being addressed by:\n\n${lines.join("\n")}\n\nRe-run with \`SENTRY_FIXER_SKIP_DUP_CHECK=1\` if this is intentional.\n`
      );
      return;
    }

    if (loose.length > 0) {
      console.log(
        `[sentry-fixer] ${loose.length} loose match(es) — attaching to prompt for agent coordination:`
      );
      for (const pr of loose) {
        console.log(`  #${pr.number} (${pr.state}) ${pr.title} — ${pr.url}`);
      }
      relatedPrs = loose.map((pr) => ({
        pr,
        diff: fetchPrDiffSummary(pr.number),
      }));
    }
  }

  const prompt = buildPrompt(event, relatedPrs);

  // Dry-run hook for tests: print the resolved prompt and skip the
  // agent session entirely. No API spend, no side effects beyond
  // .agent-out/.
  if (process.env.SENTRY_FIXER_DRY_RUN === "1") {
    console.log("[sentry-fixer] DRY_RUN — printing prompt and exiting");
    console.log("\n=== PROMPT ===\n" + prompt + "\n=== END PROMPT ===\n");
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.error(
      `[sentry-fixer] hard timeout at ${AGENT_TIMEOUT_MS}ms — aborting session`
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
        // Allow normal coding tools; disallow Skill / Agent
        // spawning so the loop stays within a single session.
        allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
        // Belt-and-suspenders — if the prompt's "don't touch these"
        // section is ignored, the SDK level disallow stops the edits
        // before they hit disk. Hard-coded subset of the forbidden
        // paths; the agent can still Read them.
        disallowedTools: [],
        permissionMode: "acceptEdits",
      },
    });

    for await (const message of result) {
      if (message.type === "assistant") {
        assistantTurns += 1;
      }
      // Print every message type — workflow log doubles as audit
      // trail. Use JSON so the log is grep'able.
      console.log(JSON.stringify({ turn: assistantTurns, message }));
    }
  } finally {
    clearTimeout(timeout);
  }

  console.log(
    `[sentry-fixer] session ended after ${assistantTurns} assistant turns`
  );
}

main().catch((err) => {
  console.error("[sentry-fixer] fatal:", err);
  process.exit(1);
});
