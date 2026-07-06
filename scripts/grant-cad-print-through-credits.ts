/**
 * Print-through credit refund sweep (MTR-181, docs/text-to-cad/08): grant
 * CAD_PRINT_THROUGH_REFUND_CREDITS back to users whose studio-generated
 * designs reached a paid print order. Idempotent — the partial unique index
 * on cad_credit_ledger allows exactly one refund per print order, so this
 * can run repeatedly (manual backfill today; a cron can adopt the same
 * sweepPrintThroughRefunds() later, and wiring it into the Stripe webhook's
 * handlePrintOrderPayment is the tracked follow-up — deliberately not done
 * in this wave to keep the payment webhook untouched).
 *
 * Hard no-op unless BOTH are set:
 *   CAD_CREDITS_ENABLED=true
 *   CAD_PRINT_THROUGH_REFUND_CREDITS=<n> (> 0)
 *
 * Run with:
 *   npx tsx scripts/grant-cad-print-through-credits.ts
 *   npx tsx scripts/grant-cad-print-through-credits.ts --limit 100
 */

import fs from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { cadCreditsEnabled, printThroughRefundCredits, sweepPrintThroughRefunds } =
    await import("@/lib/billing/cad-credits");

  if (!cadCreditsEnabled()) {
    console.log("CAD_CREDITS_ENABLED is not 'true' — nothing to do.");
    return;
  }
  if (printThroughRefundCredits() <= 0) {
    console.log("CAD_PRINT_THROUGH_REFUND_CREDITS is 0/unset — nothing to do.");
    return;
  }

  const granted = await sweepPrintThroughRefunds({
    limit: flag("limit") ? Number(flag("limit")) : undefined,
  });

  if (granted.length === 0) {
    console.log("No new print-through refunds to grant (all up to date).");
    return;
  }
  for (const g of granted) {
    console.log(`granted ${g.credits} credits for print order ${g.printOrderId}`);
  }
  console.log(`\n${granted.length} refund(s) granted.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
