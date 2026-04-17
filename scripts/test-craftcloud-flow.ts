/**
 * Probes the real CraftCloud v5 API end-to-end to understand
 * the payment flow. Does NOT go through our app's mock layer.
 *
 * Usage:
 *   npx tsx scripts/test-craftcloud-flow.ts
 *   npx tsx scripts/test-craftcloud-flow.ts --place-order   # actually creates the order (risky!)
 *
 * Steps:
 *   1. Generate a tiny cube STL in memory
 *   2. Upload model to CraftCloud
 *   3. Create price request + poll until complete
 *   4. Show cheapest quotes + shipping options
 *   5. Create a cart (safe — just a reservation)
 *   6. [--place-order only] Create an order with a test address
 *   7. [--place-order only] Call /v5/payment/stripe to inspect the response
 *   8. Report everything
 */

export {}; // Make this file a module to avoid global scope conflicts.

const BASE = "https://api.craftcloud3d.com";
const PLACE_ORDER = process.argv.includes("--place-order");

// ── Minimal binary STL (10mm cube, 12 triangles) ──────────────

function generateCubeSTL(): Uint8Array {
  // prettier-ignore
  const triangles: [number,number,number, number,number,number, number,number,number, number,number,number][] = [
    // Front  (z=10)
    [0,0,1,  0,0,10, 10,0,10, 10,10,10],
    [0,0,1,  0,0,10, 10,10,10, 0,10,10],
    // Back   (z=0)
    [0,0,-1, 10,0,0, 0,0,0, 0,10,0],
    [0,0,-1, 10,0,0, 0,10,0, 10,10,0],
    // Right  (x=10)
    [1,0,0,  10,0,0, 10,0,10, 10,10,10],
    [1,0,0,  10,0,0, 10,10,10, 10,10,0],
    // Left   (x=0)
    [-1,0,0, 0,0,10, 0,0,0, 0,10,0],
    [-1,0,0, 0,0,10, 0,10,0, 0,10,10],
    // Top    (y=10)
    [0,1,0,  0,10,0, 10,10,0, 10,10,10],
    [0,1,0,  0,10,0, 10,10,10, 0,10,10],
    // Bottom (y=0)
    [0,-1,0, 10,0,0, 0,0,0, 0,0,10],
    [0,-1,0, 10,0,0, 0,0,10, 10,0,10],
  ];

  const triCount = triangles.length;
  const buf = Buffer.alloc(80 + 4 + triCount * 50);

  buf.write("solid test-cube", 0, "ascii");
  buf.writeUInt32LE(triCount, 80);

  let offset = 84;
  for (const tri of triangles) {
    for (let i = 0; i < 12; i++) {
      buf.writeFloatLE(tri[i], offset);
      offset += 4;
    }
    buf.writeUInt16LE(0, offset); // attribute byte count
    offset += 2;
  }

  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ── API helpers ───────────────────────────────────────────────

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

async function uploadModel(stl: Uint8Array): Promise<{ modelId: string }> {
  const form = new FormData();
  form.append("file", new Blob([stl.buffer as ArrayBuffer]), "test-cube.stl");
  form.append("unit", "mm");

  const res = await fetch(`${BASE}/v5/model`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const models = await res.json();
  return models[0];
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  CraftCloud v5 API Flow Test");
  console.log("  Mode:", PLACE_ORDER ? "LIVE (will create order!)" : "DRY RUN (safe)");
  console.log("═══════════════════════════════════════════\n");

  // 1. Upload model
  console.log("1. Uploading 10mm cube STL...");
  const stl = generateCubeSTL();
  const model = await uploadModel(stl);
  console.log("   Model ID:", model.modelId);
  console.log("   Full response:", JSON.stringify(model, null, 2));

  // 2. Create price request
  console.log("\n2. Creating price request (USD, US)...");
  const priceReq = await api<{ priceId: string }>("POST", "/v5/price", {
    currency: "USD",
    countryCode: "US",
    models: [{ modelId: model.modelId, quantity: 1 }],
  });
  console.log("   Price ID:", priceReq.priceId);

  // 3. Poll for quotes
  console.log("\n3. Polling for quotes...");
  let quotes: any[] = [];
  let shipping: any[] = [];
  let allComplete = false;
  let stableCount = 0;
  let lastCount = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const price = await api<any>("GET", `/v5/price/${priceReq.priceId}`);
    quotes = price.quotes ?? [];
    shipping = price.shipping ?? price.shippings ?? [];
    allComplete = price.allComplete;

    if (quotes.length === lastCount && allComplete) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastCount = quotes.length;

    process.stdout.write(`   Poll ${attempt + 1}: ${quotes.length} quotes, ${shipping.length} shipping, complete=${allComplete}\r`);

    if (allComplete && stableCount >= 3) break;
  }
  console.log(`\n   Final: ${quotes.length} quotes, ${shipping.length} shipping options`);

  if (quotes.length === 0) {
    console.log("   No quotes returned — model may be too small or unsupported.");
    return;
  }

  // 4. Show cheapest quotes
  const sorted = [...quotes].sort((a, b) => a.price - b.price);
  console.log("\n4. Top 5 cheapest quotes:");
  for (const q of sorted.slice(0, 5)) {
    console.log(`   $${q.price.toFixed(2)} ${q.currency} — vendor=${q.vendorId} material=${q.materialConfigId}`);
  }

  // Show shipping for cheapest vendor
  const cheapest = sorted[0];
  const vendorShipping = shipping.filter((s: any) => s.vendorId === cheapest.vendorId);
  console.log(`\n   Shipping for cheapest vendor (${cheapest.vendorId}):`);
  for (const s of vendorShipping) {
    console.log(`   $${s.price.toFixed(2)} — ${s.name} (${s.deliveryTime} days) [${s.shippingId}]`);
  }

  const cheapestShipping = vendorShipping.sort((a: any, b: any) => a.price - b.price)[0];
  if (!cheapestShipping) {
    console.log("   No shipping options for this vendor.");
    return;
  }

  // 5. Create cart
  console.log("\n5. Creating cart...");
  const cart = await api<any>("POST", "/v5/cart", {
    shippingIds: [cheapestShipping.shippingId],
    currency: cheapest.currency,
    quotes: [{ id: cheapest.quoteId }],
  });
  console.log("   Cart ID:", cart.cartId);
  console.log("   Cart response:", JSON.stringify(cart, null, 2));

  if (!PLACE_ORDER) {
    console.log("\n═══════════════════════════════════════════");
    console.log("  DRY RUN COMPLETE — stopped before order.");
    console.log("  Re-run with --place-order to continue.");
    console.log("  ⚠  That WILL create a real order and");
    console.log("     may incur charges.");
    console.log("═══════════════════════════════════════════");
    return;
  }

  // 6. Create order
  console.log("\n6. Creating order (LIVE!)...");
  const order = await api<any>("POST", "/v5/order", {
    cartId: cart.cartId,
    user: {
      emailAddress: "test@materialize.dev",
      shipping: {
        firstName: "Test",
        lastName: "Order",
        address: "123 Test St",
        city: "New York",
        zipCode: "10001",
        stateCode: "NY",
        countryCode: "US",
      },
      billing: {
        firstName: "Test",
        lastName: "Order",
        address: "123 Test St",
        city: "New York",
        zipCode: "10001",
        stateCode: "NY",
        countryCode: "US",
        isCompany: false,
      },
    },
  });
  console.log("   Order ID:", order.orderId);
  console.log("   Order status:", order.status);
  console.log("   Full response:", JSON.stringify(order, null, 2));

  // 7. Check order status
  console.log("\n7. Checking order status...");
  const status = await api<any>("GET", `/v5/order/${order.orderId}/status`);
  console.log("   Status response:", JSON.stringify(status, null, 2));

  // 8. Call Stripe checkout endpoint
  console.log("\n8. Calling /v5/payment/stripe...");
  try {
    const stripe = await api<any>("POST", "/v5/payment/stripe", {
      orderId: order.orderId,
      returnUrl: "https://materialize.dev/checkout/complete",
      cancelUrl: "https://materialize.dev/checkout/cancel",
      isTestOrder: true,
    });
    console.log("   Stripe session ID:", stripe.sessionId);
    console.log("   Stripe session URL:", stripe.sessionUrl);
    console.log("   Full response:", JSON.stringify(stripe, null, 2));
  } catch (err) {
    console.log("   Stripe endpoint error:", (err as Error).message);
    console.log("   (This tells us whether payment is required)");
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  LIVE RUN COMPLETE");
  console.log("  Order ID:", order.orderId);
  console.log("  Check status later with:");
  console.log(`  curl ${BASE}/v5/order/${order.orderId}/status`);
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
