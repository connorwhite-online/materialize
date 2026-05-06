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

## Tools for agents

Materialize exposes an MCP (Model Context Protocol) server. Connect with a Personal Access Token from your Materialize account settings.

- MCP endpoint: ${APP_URL}/api/mcp (streamable HTTP)
- Available tool prefix: \`materialize_*\` (catalog, files, quotes, orders)
- Auth: Bearer token; tokens are scoped (catalog:read, files:write, quotes:read, orders:create, orders:read)
- See ${APP_URL}/docs/mcp for the full design doc

## Catalog

- [Materials index](${APP_URL}/materials)
- [Per-material detail](${APP_URL}/materials/{slug})
- [Full catalog dump for agents](${APP_URL}/llms-full.txt)

## Order flow

1. Agent uploads a model (\`materialize_request_upload_url\` → R2 PUT → \`materialize_register_upload\`).
2. Agent gets prices (\`materialize_get_quote\`).
3. Agent creates a draft order (\`materialize_create_order\`). The user is emailed a confirmation link.
4. User clicks the confirmation link, reviews, pays via Stripe.
5. Order is placed with the vendor; agent polls \`materialize_get_order\` for status.

Physical orders are irreversible, so v1 always requires explicit human approval at step 4. Agent-budget mode (auto-approve within a spend cap) is on the roadmap.

## Pricing

3% service fee on print orders. Material and shipping costs are vendor-priced and pass through unchanged.
`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
