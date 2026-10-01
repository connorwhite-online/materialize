/**
 * Body of /llms.txt (app/llms.txt/route.ts). Lives outside the route
 * file because Next rejects non-handler exports from route modules, and
 * the test needs to render it with a fixed base URL.
 */
export function llmsTxt(url: string): string {
  return `# Materialize

> Get a 3D model printed and shipped. Upload or link an STL, OBJ, 3MF, STEP or AMF file (or pick one from the marketplace), compare live prices from professional print shops across plastics, resins and metals, and order. Creators also publish their models and hardware projects here.

## Connect

- MCP server: ${url}/api/mcp (streamable HTTP)
- Sign-in: OAuth 2.1 with dynamic client registration. Discovery starts at ${url}/.well-known/oauth-protected-resource. ChatGPT and Claude connect this way.
- Personal access token (scripts, CI, coding agents): the user creates one at ${url}/dashboard/settings/tokens and sends it as \`Authorization: Bearer mtl_pat_...\`.
- Coding-agent skill: \`npx skills install connorwhite-online/materialize\` installs the upload, quote and order workflow.

## Print a model

1. Get the model in.
   - Attached in chat or at a public https URL: \`materialize_import_model\`.
   - Local file: \`materialize_request_upload_url\`, PUT the bytes, then \`materialize_register_upload\`.
   - Already uploaded: \`materialize_list_files\`.
2. Price it: \`materialize_get_quote\` with the \`fileAssetId\`. Pass \`materialId\` (from \`materialize_list_materials\`) when the user has a material in mind; it is much faster. Prices are USD, cheapest first, and include vendor, finish, color and lead time.
3. Order: \`materialize_create_order\` with the chosen quote, a shipping address and a phone number (the manufacturer requires one).
4. The user approves and pays at the returned \`confirmationUrl\` unless they set a spending policy that lets this connection order within limits. Nothing is placed with a print shop until payment clears. Do not tell the user the order is placed before that.
5. Track it: \`materialize_get_order\` and \`materialize_list_orders\`.

Help choosing a material: \`materialize_list_materials\`, \`materialize_get_material\`, or the guides at ${url}/materials.

## Publish models and projects

- Files: \`materialize_update_file\` sets the title, description, category, license, price and visibility of an uploaded model. Add photos with \`materialize_request_photo_upload_url\` and \`materialize_add_file_photo\`.
- Projects bundle files into a hardware build with a bill of materials, wiring diagrams and a build guide: \`materialize_create_project\`, \`materialize_set_project_bom\`, \`materialize_add_project_circuit_*\`.
- Paid downloads are bought on the website. Agents can't purchase them.

## Browse without signing in

- [Models](${url}/files) and search at \`${url}/api/search?q=<query>\`
- [Materials](${url}/materials): each page has Product JSON-LD
- [Material catalog as text](${url}/llms-full.txt): ids usable as \`materialId\`
- [Sitemap](${url}/sitemap.xml)

## Rules

- Physical orders can't be undone once placed. Always show the user the price, material, vendor and lead time, and get their go-ahead before \`materialize_create_order\`.
- Retry \`materialize_create_order\` with the same \`idempotencyKey\`; a new key creates a second order.
- Tool errors carry a \`code\` and a \`retryable\` flag. Fix the input rather than retrying when \`retryable\` is false.
`;
}
