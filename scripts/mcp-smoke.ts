/**
 * MCP smoke test — connects to the running Materialize MCP server using
 * the official SDK client and exercises a safe subset of tools (catalog
 * + list views; nothing that uploads, quotes, or creates orders). Run
 * against a local dev server to validate the wire protocol, the PAT
 * auth gate, and the read-only tool registrations end-to-end.
 *
 * Usage:
 *
 *   # 1. Start the dev server in another terminal
 *   npm run dev
 *
 *   # 2. Mint a PAT at http://localhost:3000/dashboard/settings/tokens
 *   #    Grant: catalog:read, files:read, orders:read
 *
 *   # 3. Run the smoke test
 *   MCP_PAT=mtl_pat_xxxxx npx tsx scripts/mcp-smoke.ts
 *   MCP_PAT=mtl_pat_xxxxx MCP_BASE_URL=https://staging.materialize.cc npx tsx scripts/mcp-smoke.ts
 *
 * Exits 0 on success, 1 on any failure. CI-friendly.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const RESULTS: CheckResult[] = [];

function check(name: string, ok: boolean, detail: string) {
  RESULTS.push({ name, ok, detail });
  const symbol = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${symbol}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const PAT = process.env.MCP_PAT;
  const BASE_URL = process.env.MCP_BASE_URL ?? "http://localhost:3000";
  if (!PAT) {
    console.error("Missing MCP_PAT env var. See top-of-file usage.");
    process.exit(1);
  }
  const url = new URL(`${BASE_URL}/api/mcp`);

  console.log(`\nMaterialize MCP smoke test`);
  console.log(`  Endpoint: ${url}`);
  console.log(`  Token:    ${PAT.slice(0, 16)}…\n`);

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${PAT}`,
      },
    },
  });
  const client = new Client(
    { name: "materialize-smoke-test", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    check("connect", true, "MCP handshake succeeded");
  } catch (err) {
    check("connect", false, err instanceof Error ? err.message : String(err));
    summary();
    process.exit(1);
  }

  // -- tools/list --------------------------------------------------
  let toolNames: string[] = [];
  try {
    const list = await client.listTools();
    toolNames = list.tools.map((t) => t.name);
    check(
      "tools/list",
      toolNames.length >= 9,
      `${toolNames.length} tools registered`
    );
    const expected = [
      "materialize_list_materials",
      "materialize_get_material",
      "materialize_request_upload_url",
      "materialize_register_upload",
      "materialize_list_files",
      "materialize_delete_file",
      "materialize_get_quote",
      "materialize_create_order",
      "materialize_get_order",
      "materialize_list_orders",
    ];
    for (const name of expected) {
      check(`tool registered: ${name}`, toolNames.includes(name), "");
    }
  } catch (err) {
    check("tools/list", false, err instanceof Error ? err.message : String(err));
  }

  // -- materialize_list_materials ---------------------------------
  try {
    const result = await client.callTool({
      name: "materialize_list_materials",
      arguments: { limit: 5 },
    });
    const body = parseFirstText(result);
    const materials = body?.materials as Array<{ id: string; name: string }>;
    check(
      "materialize_list_materials",
      Array.isArray(materials) && materials.length > 0 && !!materials[0]?.id,
      `${materials?.length ?? 0} materials returned`
    );

    // Stash the first id for the get_material check
    if (materials?.[0]?.id) {
      try {
        const get = await client.callTool({
          name: "materialize_get_material",
          arguments: { id: materials[0].id },
        });
        const m = parseFirstText(get);
        check(
          "materialize_get_material",
          !!m?.id && m.id === materials[0].id,
          m?.name ?? "(no name)"
        );
      } catch (err) {
        check(
          "materialize_get_material",
          false,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  } catch (err) {
    check(
      "materialize_list_materials",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // -- materialize_list_files (may be empty) ----------------------
  try {
    const result = await client.callTool({
      name: "materialize_list_files",
      arguments: {},
    });
    const body = parseFirstText(result);
    check(
      "materialize_list_files",
      Array.isArray(body?.files),
      `${body?.files?.length ?? 0} files`
    );
  } catch (err) {
    check(
      "materialize_list_files",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // -- materialize_list_orders (may be empty) ---------------------
  try {
    const result = await client.callTool({
      name: "materialize_list_orders",
      arguments: { limit: 5 },
    });
    const body = parseFirstText(result);
    check(
      "materialize_list_orders",
      Array.isArray(body?.orders),
      `${body?.orders?.length ?? 0} orders`
    );
  } catch (err) {
    check(
      "materialize_list_orders",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // -- scope enforcement: invalid material id should produce a
  //    structured error (not crash the server) -------------------
  try {
    const result = await client.callTool({
      name: "materialize_get_material",
      arguments: { id: "definitely-not-a-real-uuid" },
    });
    const body = parseFirstText(result);
    check(
      "structured error on bad input",
      body?.error?.code === "not_found",
      body?.error?.message ?? "(no error body)"
    );
  } catch (err) {
    check(
      "structured error on bad input",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  await client.close();
  summary();
}

function parseFirstText(result: unknown): Record<string, any> | undefined {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const first = r.content?.[0];
  if (!first || first.type !== "text" || !first.text) return undefined;
  try {
    return JSON.parse(first.text);
  } catch {
    return undefined;
  }
}

function summary() {
  const passed = RESULTS.filter((r) => r.ok).length;
  const failed = RESULTS.filter((r) => !r.ok).length;
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error in smoke test:", err);
  process.exit(1);
});
