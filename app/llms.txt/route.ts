/**
 * https://llmstxt.org — short, human- and agent-readable description
 * of what Materialize is, what it offers, and where the structured
 * agent-facing surface lives. Sibling /llms-full.txt dumps the
 * material catalog in plain text.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

export async function GET() {
  const body = `# Materialize

> Materialize is a 3D-print marketplace and instant-quote service. Upload a model, pick a material, get printed by a vetted vendor (via CraftCloud), and shipped to your door. Revenue is a 3% service fee on print orders.

## Buying through an agent

Two ways an AI agent can drive a purchase on Materialize:

1. **Direct via the Materialize MCP server.** A user mints a personal access token in their account, the agent authenticates as that user, and uses the \`materialize_*\` tools to upload + quote + order. The user can attach a per-token spending policy so routine orders auto-charge their saved card; out-of-policy orders fall back to email confirmation. Best for: ongoing creator/agent setups where the same user runs the agent repeatedly.

2. **Open standards (Agentic Commerce Protocol).** Roadmap. Agents on platforms supporting ACP/UCP (e.g. ChatGPT, Claude apps) will be able to discover Materialize products and complete purchases via Shared Payment Tokens without a per-merchant integration. We expose product and pricing data through the catalog endpoints below.

Either way, fulfillment is identical: payment via Stripe, order placed with the vendor, tracking surfaced through the order-status tools.

## Tools for agents (MCP)

Materialize exposes an MCP (Model Context Protocol) server. Connect with a Personal Access Token from your Materialize account settings.

- MCP endpoint: ${APP_URL}/api/mcp (streamable HTTP)
- Available tool prefix: \`materialize_*\` (catalog, files, quotes, orders)
- Auth: Bearer token; tokens are scoped (catalog:read, files:write, quotes:read, orders:create, orders:read)
- Spending policies: per-token caps (per-order, period budget, vendor/material allowlist) configurable at ${APP_URL}/dashboard/settings/tokens

## Catalog

- [Materials index](${APP_URL}/materials)
- [Per-material detail](${APP_URL}/materials/{slug}) — JSON-LD Product + Offer markup
- [Full catalog dump for agents](${APP_URL}/llms-full.txt)
- [Sitemap](${APP_URL}/sitemap.xml)

## Order flow (MCP)

1. Agent uploads a model (\`materialize_request_upload_url\` → R2 PUT → \`materialize_register_upload\`).
2. Agent gets prices (\`materialize_get_quote\`).
3. Agent creates an order (\`materialize_create_order\`).
4. Approval depends on the token's spending policy:
   - Within policy → order auto-charges the user's saved card and goes to \`auto_approved\` for a short cancellation window. The user is emailed a receipt with a one-click cancel link.
   - Out of policy (or no policy) → order parks at \`awaiting_user_approval\`. The user is emailed a confirmation link, reviews, pays via Stripe.
5. After payment + cancellation window, the order is placed with the vendor; agent polls \`materialize_get_order\` for status.

Physical orders are irreversible, so payment-on-fulfillment is enforced. There's no "agent places without any user gate" mode.

## Pricing

3% service fee on print orders. Material and shipping costs are vendor-priced and pass through unchanged. USD only at the moment.
`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
