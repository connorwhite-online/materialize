/**
 * Resend / agent-order-confirmation email smoke test.
 *
 * Renders the actual production email template with fake order data
 * and sends it via the configured Resend client. Lets you verify in
 * <30 seconds that:
 *
 *   - RESEND_API_KEY is set and valid
 *   - RESEND_FROM_EMAIL points at a domain Resend has verified
 *   - The React Email template renders without errors
 *   - Inline styles survive whatever client you're testing in
 *
 * Usage:
 *
 *   TO_EMAIL=you@example.com npx tsx scripts/email-smoke.ts
 *
 * Add `--app-url=https://staging.materialize.cc` to override the
 * confirmationUrl host (defaults to NEXT_PUBLIC_APP_URL or localhost).
 *
 * Exits 0 on success, 1 on failure.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// `server-only` throws on import outside Next.js's bundler so callers
// can't accidentally pull a server module into a client bundle. This
// script runs in plain Node where that guard is unwanted — preload a
// fake `server-only` into the require cache so subsequent imports
// resolve to a no-op instead of the real (throwing) package.
{
  const req = createRequire(import.meta.url);
  const path = req.resolve("server-only");
  // @ts-expect-error — populating the CJS require cache directly
  req.cache[path] = { id: path, filename: path, loaded: true, exports: {} };
}

// Load .env.local before importing anything that reads env vars.
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const TO_EMAIL = process.env.TO_EMAIL;
  if (!TO_EMAIL) {
    console.error("Missing TO_EMAIL env var. Set it to the recipient address.");
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "RESEND_API_KEY is not set — this run will hit the console-log stub instead of actually sending."
    );
  }
  if (!process.env.RESEND_FROM_EMAIL) {
    console.warn(
      "RESEND_FROM_EMAIL is not set — falling back to the placeholder default. The send will likely fail unless you've verified that domain in Resend."
    );
  }

  const appUrl =
    parseAppUrlArg() ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  // Imports are dynamic so the dotenv calls above run first.
  const { sendEmail } = await import("@/lib/email/client");
  const {
    AgentOrderConfirmationEmail,
    renderAgentOrderConfirmationText,
  } = await import("@/lib/email/templates/agent-order-confirmation");

  const props = {
    agentName: "Smoke Test Agent",
    fileName: "30mm-calibration-cube.stl",
    materialName: "PLA Black (Standard)",
    vendorName: "Test Vendor",
    totalDisplay: "$4.50",
    confirmationUrl: `${appUrl}/orders/00000000-0000-0000-0000-000000000000/confirm?token=smoke-test`,
    revokeAgentUrl: `${appUrl}/dashboard/settings/tokens`,
    expiresAtDisplay: "in 24 hours",
  };

  console.log(`\nMaterialize email smoke test`);
  console.log(`  To:        ${TO_EMAIL}`);
  console.log(`  From:      ${process.env.RESEND_FROM_EMAIL ?? "(default)"}`);
  console.log(`  App URL:   ${appUrl}\n`);

  const result = await sendEmail({
    to: TO_EMAIL,
    subject: "[smoke test] Confirm print order from Smoke Test Agent — Materialize",
    react: AgentOrderConfirmationEmail(props),
    text: renderAgentOrderConfirmationText(props),
  });

  if (!result.ok) {
    console.error(`\n  \x1b[31mFAIL\x1b[0m  ${result.error ?? "Unknown error"}`);
    process.exit(1);
  }

  console.log(
    `  \x1b[32mPASS\x1b[0m  ${result.id ? `sent (id: ${result.id})` : "stub mode — printed to console above"}`
  );
}

function parseAppUrlArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--app-url="));
  return arg ? arg.slice("--app-url=".length) : undefined;
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
