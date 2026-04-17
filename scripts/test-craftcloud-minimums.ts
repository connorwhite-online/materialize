/**
 * Tests cart creation across multiple vendors to check which ones
 * have minimum production prices and how much they are.
 *
 * Usage: npx tsx scripts/test-craftcloud-minimums.ts
 */

export {}; // Make this file a module to avoid global scope conflicts.

const BASE = "https://api.craftcloud3d.com";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  // Reuse the model we already uploaded
  const modelId = "5404f2d9479f967a7743a732b7071a9f8d9332e9";

  console.log("Fetching quotes for 10mm cube...\n");
  const priceReq = await api<{ priceId: string }>("POST", "/v5/price", {
    currency: "USD",
    countryCode: "US",
    models: [{ modelId, quantity: 1 }],
  });

  let quotes: any[] = [];
  let shipping: any[] = [];
  let stableCount = 0;
  let lastCount = 0;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const price = await api<any>("GET", `/v5/price/${priceReq.priceId}`);
    quotes = price.quotes ?? [];
    shipping = price.shipping ?? price.shippings ?? [];
    if (quotes.length === lastCount && price.allComplete) stableCount++;
    else stableCount = 0;
    lastCount = quotes.length;
    process.stdout.write(`  Polling: ${quotes.length} quotes...\r`);
    if (price.allComplete && stableCount >= 3) break;
  }
  console.log(`\nGot ${quotes.length} quotes from ${new Set(quotes.map((q: any) => q.vendorId)).size} vendors\n`);

  // Group by vendor, pick cheapest quote per vendor
  const byVendor = new Map<string, any>();
  for (const q of quotes) {
    const existing = byVendor.get(q.vendorId);
    if (!existing || q.price < existing.price) {
      byVendor.set(q.vendorId, q);
    }
  }

  // Test up to 10 unique vendors
  const vendors = Array.from(byVendor.entries()).slice(0, 10);

  console.log("Creating carts for each vendor to check minimums...\n");
  console.log("Vendor                     | Quote   | Cart Total | Min Prod | Fee     | Shipping");
  console.log("---------------------------|---------|------------|----------|---------|----------");

  for (const [vendorId, quote] of vendors) {
    const vendorShipping = shipping.filter((s: any) => s.vendorId === vendorId);
    const cheapShip = vendorShipping.sort((a: any, b: any) => a.price - b.price)[0];
    if (!cheapShip) {
      console.log(`${vendorId.padEnd(27)}| $${quote.price.toFixed(2).padStart(5)} | (no shipping available)`);
      continue;
    }

    try {
      const cart = await api<any>("POST", "/v5/cart", {
        shippingIds: [cheapShip.shippingId],
        currency: quote.currency,
        quotes: [{ id: quote.quoteId }],
      });

      const amounts = cart.amounts?.total;
      const minProd = cart.minimumProductionPrice?.[vendorId];
      const prodFee = minProd?.productionFee ?? 0;
      const cartTotal = amounts?.totalNetPrice ?? 0;
      const minPrice = minProd?.price ?? quote.price;

      console.log(
        `${vendorId.substring(0, 27).padEnd(27)}| $${quote.price.toFixed(2).padStart(5)} | $${cartTotal.toFixed(2).padStart(8)} | $${minPrice.toFixed(2).padStart(6)} | $${prodFee.toFixed(2).padStart(5)} | $${cheapShip.price.toFixed(2)} ${cheapShip.name}`
      );
    } catch (err) {
      console.log(`${vendorId.substring(0, 27).padEnd(27)}| $${quote.price.toFixed(2).padStart(5)} | ERROR: ${(err as Error).message.substring(0, 40)}`);
    }
  }

  console.log("\n(Fee = amount added to reach vendor's minimum production price)");
  console.log("(If Fee is $0.00, the vendor has no minimum or the print exceeds it)");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
