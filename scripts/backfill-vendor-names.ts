/**
 * One-time backfill for rows created before the vendor_name migration.
 * Hits CraftCloud's provider directory once and populates `vendor_name`
 * across three tables:
 *   - cart_items.vendor_id         → cart_items.vendor_name
 *   - print_orders.vendor          → print_orders.vendor_name
 *   - print_order_items.vendor_id  → print_order_items.vendor_name
 *
 * Safe to re-run: only touches rows where vendor_name IS NULL and the
 * resolved provider is non-null. Unknown vendor IDs stay NULL so the
 * display layer keeps falling back to the ID string (no regression).
 *
 * Run with:
 *   bun run scripts/backfill-vendor-names.ts
 *   bun run scripts/backfill-vendor-names.ts --dry-run
 *
 * Bypasses lib/craftcloud/catalog.ts because that file is `server-only`
 * (Next.js RSC guard) and won't import in a tsx/bun script context —
 * we hit the same public CraftCloud endpoint directly instead.
 */

import { neon } from "@neondatabase/serverless";

const DRY_RUN = process.argv.includes("--dry-run");
const CRAFTCLOUD_PROVIDERS_URL =
  "https://customer-api.craftcloud3d.com/provider";

interface Provider {
  vendorId: string;
  name: string;
}

async function fetchProviderMap(): Promise<Map<string, string>> {
  const res = await fetch(CRAFTCLOUD_PROVIDERS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MaterializeBackfill/1.0; +https://materialize.cc)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`CraftCloud /provider fetch failed: ${res.status}`);
  }
  const list = (await res.json()) as Provider[];
  const map = new Map<string, string>();
  for (const p of list) {
    if (p.vendorId && p.name) map.set(p.vendorId, p.name);
  }
  return map;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL — set it in .env / .env.local before running"
    );
  }
  const sql = neon(url);

  const vendorRows = (await sql`
    SELECT DISTINCT vendor_id AS id
    FROM cart_items
    WHERE vendor_name IS NULL
    UNION
    SELECT DISTINCT vendor AS id
    FROM print_orders
    WHERE vendor_name IS NULL AND vendor IS NOT NULL
    UNION
    SELECT DISTINCT vendor_id AS id
    FROM print_order_items
    WHERE vendor_name IS NULL AND vendor_id IS NOT NULL
  `) as { id: string }[];

  const vendorIds = vendorRows.map((r) => r.id).filter(Boolean);
  console.log(`Found ${vendorIds.length} distinct vendor IDs needing names`);

  if (vendorIds.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const providerMap = await fetchProviderMap();
  console.log(`Loaded ${providerMap.size} providers from CraftCloud`);

  const resolved = new Map<string, string>();
  for (const id of vendorIds) {
    const name = providerMap.get(id);
    if (name) resolved.set(id, name);
  }

  console.log(
    `Resolved ${resolved.size}/${vendorIds.length} vendor IDs to names`
  );
  const unresolved = vendorIds.filter((id) => !resolved.has(id));
  if (unresolved.length > 0) {
    console.log("Unresolved IDs (will stay NULL):", unresolved.join(", "));
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: skipping writes. Resolved map:");
    for (const [id, name] of resolved) {
      console.log(`  ${id} → ${name}`);
    }
    return;
  }

  let totalUpdated = 0;
  for (const [vendorId, vendorName] of resolved) {
    const cartRes = await sql`
      UPDATE cart_items
      SET vendor_name = ${vendorName}
      WHERE vendor_id = ${vendorId} AND vendor_name IS NULL
    `;
    const orderRes = await sql`
      UPDATE print_orders
      SET vendor_name = ${vendorName}
      WHERE vendor = ${vendorId} AND vendor_name IS NULL
    `;
    const itemRes = await sql`
      UPDATE print_order_items
      SET vendor_name = ${vendorName}
      WHERE vendor_id = ${vendorId} AND vendor_name IS NULL
    `;
    const count =
      ((cartRes as unknown as { rowCount?: number }).rowCount ?? 0) +
      ((orderRes as unknown as { rowCount?: number }).rowCount ?? 0) +
      ((itemRes as unknown as { rowCount?: number }).rowCount ?? 0);
    totalUpdated += count;
    console.log(`  ${vendorId} (${vendorName}): updated ${count} rows`);
  }

  console.log(`\nDone. Updated ${totalUpdated} rows total.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
