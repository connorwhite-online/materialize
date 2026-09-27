/**
 * Probes whether CraftCloud's invoice payment is open to us, using a
 * TEST order. Talks to the real CraftCloud API directly; the app's
 * mock layer is not involved.
 *
 * Usage (from a machine that can reach api.craftcloud3d.com):
 *   npx tsx scripts/test-craftcloud-invoice.ts --email you@example.com --yes
 *
 * Flags:
 *   --email <addr>   Required. The order's contact address. CraftCloud
 *                    sends its order emails here, so use an inbox you
 *                    can read: whether those emails carry tracking is
 *                    one of the things we want to learn.
 *   --yes            Required. Confirms you understand this creates an
 *                    unpaid order on CraftCloud (flagged as a test on
 *                    the invoice call).
 *   --country <cc>   Quote/shipping country, default US.
 *
 * Steps:
 *   1. Upload the synthetic canary tetrahedron (lib/craftcloud/canary-solid.ts)
 *   2. Price it and poll until quotes settle
 *   3. Cart the cheapest quote + its cheapest shipping
 *   4. Place the order (unpaid)
 *   5. Read order status BEFORE any payment
 *   6. POST /v5/payment/invoice with isTestOrder: true
 *   7. Read order status AFTER the invoice call
 *
 * Every raw response is printed. Paste the whole output back into the
 * project thread: the answers we need are whether step 6 is accepted
 * without special access, what it returns (payment link? bank
 * details? a token for the net30 PATCH?), and whether steps 5/7 show
 * any status entries before payment.
 */

import { uploadModelToCraftCloud } from "../lib/craftcloud/model-upload";
import {
  buildCanarySolid,
  CANARY_FILENAME,
} from "../lib/craftcloud/canary-solid";

const BASE = "https://api.craftcloud3d.com";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const EMAIL = argValue("--email");
const COUNTRY = (argValue("--country") ?? "US").toUpperCase();
const CONFIRMED = process.argv.includes("--yes");

function show(label: string, value: unknown) {
  console.log(`   ${label}:`, JSON.stringify(value, null, 2));
}

/** Returns status + parsed body without throwing, so errors are data. */
async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as text
  }
  return { status: res.status, body: parsed };
}

async function must<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${JSON.stringify(res.body)}`
    );
  }
  return res.body as T;
}

interface Quote {
  quoteId: string;
  vendorId: string;
  price: number;
  currency: string;
  materialConfigId: string;
}
interface Shipping {
  shippingId: string;
  vendorId: string;
  price: number;
  name: string;
}

async function main() {
  if (!EMAIL || !CONFIRMED) {
    console.error(
      "Usage: npx tsx scripts/test-craftcloud-invoice.ts --email you@example.com --yes\n" +
        "This creates an unpaid order on CraftCloud; --yes confirms that."
    );
    process.exit(2);
  }

  console.log("CraftCloud invoice probe (test order)\n");

  console.log("1. Uploading canary model...");
  const model = await uploadModelToCraftCloud(
    buildCanarySolid(),
    CANARY_FILENAME,
    "mm"
  );
  show("model", model);

  console.log(`\n2. Pricing (USD, ${COUNTRY})...`);
  const { priceId } = await must<{ priceId: string }>("POST", "/v5/price", {
    currency: "USD",
    countryCode: COUNTRY,
    models: [{ modelId: model.modelId, quantity: 1 }],
  });
  let quotes: Quote[] = [];
  let shipping: Shipping[] = [];
  let stable = 0;
  let last = -1;
  // Same settle rule as the app: complete AND count stable for 4 polls.
  for (let i = 0; i < 60 && stable < 4; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const price = await must<{
      allComplete: boolean;
      quotes?: Quote[];
      shipping?: Shipping[];
      shippings?: Shipping[];
    }>("GET", `/v5/price/${priceId}`);
    quotes = price.quotes ?? [];
    shipping = price.shipping ?? price.shippings ?? [];
    stable = price.allComplete && quotes.length === last ? stable + 1 : 0;
    last = quotes.length;
  }
  console.log(`   ${quotes.length} quotes, ${shipping.length} shipping options`);
  if (quotes.length === 0) throw new Error("No quotes returned");

  const quote = [...quotes].sort((a, b) => a.price - b.price)[0];
  const ship = shipping
    .filter((s) => s.vendorId === quote.vendorId)
    .sort((a, b) => a.price - b.price)[0];
  if (!ship) throw new Error(`No shipping for vendor ${quote.vendorId}`);
  show("chosen quote", quote);
  show("chosen shipping", ship);

  console.log("\n3. Creating cart...");
  const cart = await must<{ cartId: string }>("POST", "/v5/cart", {
    shippingIds: [ship.shippingId],
    currency: quote.currency,
    quotes: [{ id: quote.quoteId }],
  });
  show("cart", cart);

  console.log("\n4. Placing order (unpaid)...");
  const address = {
    firstName: "Materialize",
    lastName: "Invoice Test",
    address: "123 Test St",
    city: "New York",
    zipCode: "10001",
    stateCode: "NY",
    countryCode: COUNTRY,
    // Required by POST /v5/order; a 555 number is fine for an unpaid test.
    phoneNumber: "+12125550123",
  };
  const order = await must<{ orderId: string }>("POST", "/v5/order", {
    cartId: cart.cartId,
    user: {
      emailAddress: EMAIL,
      shipping: address,
      billing: { ...address, isCompany: true, companyName: "Materialize" },
    },
  });
  show("order", order);

  console.log("\n5. Order status BEFORE payment...");
  show("status", await call("GET", `/v5/order/${order.orderId}/status`));

  console.log("\n6. POST /v5/payment/invoice (isTestOrder: true)...");
  const invoice = await call("POST", "/v5/payment/invoice", {
    orderId: order.orderId,
    isTestOrder: true,
  });
  show("invoice response", invoice);

  console.log("\n7. Order status AFTER invoice call...");
  show("status", await call("GET", `/v5/order/${order.orderId}/status`));

  console.log(
    `\nDone. Order ${order.orderId}. Re-check later with:\n` +
      `  curl ${BASE}/v5/order/${order.orderId}/status\n` +
      `Paste this whole output into the project thread, and watch ${EMAIL} for CraftCloud emails.`
  );
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
