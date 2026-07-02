/**
 * codebase-health-weekly: a Claude Agent SDK session that runs the
 * `codebase-health` skill in `weekly` mode — the scheduled flagship
 * audit → file Linear issues → batch-dispatch executor PRs pass.
 *
 * Runs inside a GitHub Action (see
 * .github/workflows/codebase-health-weekly.yml) on a weekly cron:
 * fresh CI checkout, the smartest model pinned, Linear MCP wired for
 * filing/reconciling issues, gh + a repo token for the executor PRs.
 *
 * Design mirrors scripts/sentry-fixer.ts:
 *   - `query()` from @anthropic-ai/claude-agent-sdk, streamed to stdout
 *     so the workflow log is the audit trail.
 *   - Hard timeout via AbortController.
 *   - Auth resolved by the workflow step (OAuth token preferred, else
 *     API key); this script only reads what's in env.
 *
 * The skill itself (.claude/skills/codebase-health/SKILL.md, "Weekly
 * deep run") is the source of truth for WHAT to do. This harness only
 * (a) picks the model, (b) wires the tools/MCP, (c) hands the skill the
 * `weekly` invocation, (d) bounds the run.
 *
 * Guard: if no Linear MCP credential is configured the run is a safe
 * no-op (prints a notice and exits 0) — the audit is useless without a
 * place to file issues, and we never want a red weekly job just because
 * the secret isn't set yet. Same "skip cleanly when unconfigured"
 * posture as staging-smoke-tour's STAGING_URL guard.
 *
 * Local dry run (no API spend, prints the resolved prompt + config):
 *   CODEBASE_HEALTH_DRY_RUN=1 npx tsx scripts/codebase-health-weekly.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

// 3 hours — a full deep sweep fans out ~10 read-only subagents, files
// dozens of issues, then dispatches up to 4 concurrent worktree
// executors that each run npm ci + tsc + vitest. The GitHub Action's
// own `timeout-minutes` is the outer fence.
const AGENT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * The smartest generally-available model at time of writing. Bump this
 * (and only this) when a newer flagship ships — the skill's "Model"
 * section says the weekly driver must always run on the top tier.
 * Overridable via env so the workflow can pin without a code change.
 */
const DRIVER_MODEL =
  process.env.CODEBASE_HEALTH_MODEL?.trim() || "claude-fable-5";

/**
 * The Linear MCP server the driver files/reconciles issues through.
 * The credential shape depends on how the maintainer wires Linear MCP
 * in CI (an API key or an OAuth token minted for a service identity).
 * We read a single env var and pass it as a Bearer token to Linear's
 * remote MCP endpoint; if it's absent we skip the run (see guard).
 */
const LINEAR_MCP_URL =
  process.env.LINEAR_MCP_URL?.trim() || "https://mcp.linear.app/mcp";
const LINEAR_MCP_TOKEN = process.env.LINEAR_MCP_TOKEN?.trim() || "";

function buildPrompt(): string {
  return `Run the **codebase-health** skill in \`weekly\` mode against this
repository. You are the advisor/dispatcher, running on the smartest
available model. Invoke the skill and follow its "Weekly deep run"
routine exactly — do not improvise a different process.

Non-negotiables from the skill you must honor:
- Reconcile the Linear board FIRST (close fixed issues, refresh drifted
  excerpts + Planned-at SHA, promote answered 🔵 OPEN QUESTIONs).
- Full deep audit, every category, whole repo, with parallel read-only
  Explore subagents — INCLUDING the normally-excluded Text-to-CAD area,
  flagged churn-risky with drift-check STOP conditions.
- Run the two flagship extra passes: the surface-coverage map (→ a
  Testing & E2E program epic + concrete first-wave test issues) and the
  meta-audit of the Linear/workflow itself (→ Platform: Infra, DevX &
  Environment).
- Vet every finding against the live code before filing. Dedup against
  the open backlog. File issues into the correct MTR project + label,
  **state Todo by default** (Backlog only for real open-questions /
  unmet dependencies / spikes), with the drift SHA and real Linear
  "blocked by" relations for dependencies.
- Then **batch-dispatch into as few PRs as possible**: cluster the
  ready Todo set by file-locality into disjoint batches, one worktree
  executor → one branch → one PR each, ≤4 concurrent, sequence batches
  that must share a file. Review every PR like a tech lead. NEVER merge
  and NEVER push to a protected branch.
- This is unattended: never block on a human. Forks become 🔵 OPEN
  QUESTION comments with numbered options + a recommendation. Never
  auto-decide a money or security tradeoff.
- Finish with a single run-summary Linear comment.

Confirm the live Linear coordinates with list_teams / list_projects /
list_issue_labels / list_issue_statuses before filing — IDs drift.`;
}

async function main() {
  console.log("[codebase-health-weekly] starting");
  console.log(`[codebase-health-weekly] driver model = ${DRIVER_MODEL}`);

  if (!LINEAR_MCP_TOKEN) {
    // Safe no-op: an audit with nowhere to file issues is pointless, and
    // a missing secret must not turn the weekly job red. Mirror the
    // staging-smoke-tour STAGING_URL guard.
    console.log(
      "::notice::LINEAR_MCP_TOKEN is not configured — skipping the weekly codebase-health run. " +
        "Set the LINEAR_MCP_TOKEN secret (and optionally LINEAR_MCP_URL / CODEBASE_HEALTH_MODEL) to enable it."
    );
    return;
  }

  const prompt = buildPrompt();

  if (process.env.CODEBASE_HEALTH_DRY_RUN === "1") {
    console.log("[codebase-health-weekly] DRY_RUN — printing config + prompt, no API spend");
    console.log(
      JSON.stringify(
        { driverModel: DRIVER_MODEL, linearMcpUrl: LINEAR_MCP_URL, hasLinearToken: Boolean(LINEAR_MCP_TOKEN) },
        null,
        2
      )
    );
    console.log("\n=== PROMPT ===\n" + prompt + "\n=== END PROMPT ===\n");
    return;
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => {
    console.error(
      `[codebase-health-weekly] hard timeout at ${AGENT_TIMEOUT_MS}ms — aborting`
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
        model: DRIVER_MODEL,
        // The driver needs the full toolset: read/search for the audit,
        // Bash for read-only checks + git, Skill to invoke codebase-health,
        // Task/Agent to fan out subagents and worktree executors, and the
        // Linear MCP tools to file/reconcile issues. Executors it spawns
        // get their own (cheaper) sessions.
        allowedTools: [
          "Read",
          "Grep",
          "Glob",
          "Bash",
          "Skill",
          "Task",
          "Agent",
          "mcp__linear",
        ],
        permissionMode: "acceptEdits",
        mcpServers: {
          linear: {
            type: "http",
            url: LINEAR_MCP_URL,
            headers: { Authorization: `Bearer ${LINEAR_MCP_TOKEN}` },
          },
        },
      },
    });

    for await (const message of result) {
      if (message.type === "assistant") assistantTurns += 1;
      console.log(JSON.stringify({ turn: assistantTurns, message }));
    }
  } finally {
    clearTimeout(timeout);
  }

  console.log(
    `[codebase-health-weekly] session ended after ${assistantTurns} assistant turns`
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[codebase-health-weekly] fatal:", err);
    process.exit(1);
  });
}
