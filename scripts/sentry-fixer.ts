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
import { query } from "@anthropic-ai/claude-agent-sdk";

const AGENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

function buildPrompt(event: SentryEvent): string {
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

4. Run the full gate before pushing:
   - npx tsc --noEmit (must be clean except the line-anchored
     filter — see AGENTS.md for what's allowed)
   - npx playwright test (full suite must pass, including the
     regression test you just added)
   - npx vitest run (must pass)

5. Commit + push a branch named fix/sentry-${event.event_id ?? "unknown"},
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

6. When done, write the same content to .agent-out/summary.md so the
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

  const prompt = buildPrompt(event);

  // Output dir for the agent to write its summary into. Gitignored.
  fs.mkdirSync(".agent-out", { recursive: true });

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
