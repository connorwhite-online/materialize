import { describe, it, expect, vi, beforeEach } from "vitest";

// TEST-24 (2026-07-25 audit): app/api/[transport]/route.ts has 28
// server.registerTool calls, each expected to call requireScope(auth, <scope>)
// as its first line of business logic. Nothing in the type system enforces
// that pairing — a 29th tool can ship without a requireScope call and the
// only signal would be a live IDOR. This test intercepts registration by
// mocking "mcp-handler" so the route module's real `initializeServer`
// callback runs against a stub MCP server, capturing every
// (toolName, handler) pair without ever standing up a real McpServer,
// transport, or DB connection. We then invoke each captured handler with
// an authenticated-but-scope-less auth extra and assert it comes back as
// an `invalid_scope` error — i.e. requireScope ran and threw before any
// business logic (DB/network) executed.

type ToolConfig = {
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};
type ToolHandler = (
  args: Record<string, unknown>,
  extra: unknown
) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;

const registered: Array<{ name: string; config: ToolConfig; handler: ToolHandler }> = [];
const registeredResources: Array<{
  name: string;
  uri: string;
  read: () => Promise<{ contents: Array<Record<string, unknown>> }>;
}> = [];

vi.mock("mcp-handler", () => ({
  createMcpHandler: (
    initializeServer: (server: {
      registerTool: (
        name: string,
        config: ToolConfig,
        handler: ToolHandler
      ) => void;
    }) => void | Promise<void>
  ) => {
    const stubServer = {
      registerTool: (name: string, config: ToolConfig, handler: ToolHandler) => {
        registered.push({ name, config, handler });
      },
      registerResource: (
        name: string,
        uri: string,
        _config: unknown,
        read: () => Promise<{ contents: Array<Record<string, unknown>> }>
      ) => {
        registeredResources.push({ name, uri, read });
      },
    };
    // The real route.ts callback is synchronous — it just calls
    // server.registerTool() 28 times and returns. Running it here, once,
    // against our stub is enough to capture every tool without ever
    // constructing a real McpServer/transport or making a request.
    initializeServer(stubServer);
    // Nothing in this suite calls the returned route handler directly.
    return () => {
      throw new Error("unexpected direct invocation of the mcp route handler");
    };
  },
  withMcpAuth: (handler: unknown) => handler,
}));

function scopelessAuthExtra() {
  return {
    authInfo: {
      extra: {
        userId: "user_test",
        tokenId: "tok_test",
        tokenName: "test token",
        scopes: [] as string[],
      },
    },
  };
}

function parseResultText(result: {
  content: Array<{ type: string; text: string }>;
}) {
  return JSON.parse(result.content[0].text);
}

// Pinned toolName -> required scope table, read off origin/main 4ebeebe
// (app/api/[transport]/route.ts). If a tool's required scope changes, or a
// tool is added/removed, this table must change too — that's the point:
// the diff makes scope changes visible in review instead of silently
// shipping.
const EXPECTED_TOOL_SCOPES: Record<string, string> = {
  materialize_list_materials: "catalog:read",
  materialize_get_material: "catalog:read",
  materialize_recommend_material: "catalog:read",
  materialize_check_printability: "files:read",
  materialize_request_upload_url: "files:write",
  materialize_register_upload: "files:write",
  materialize_import_model: "files:write",
  materialize_update_file: "files:write",
  materialize_list_files: "files:read",
  materialize_delete_file: "files:write",
  materialize_request_photo_upload_url: "files:write",
  materialize_add_file_photo: "files:write",
  materialize_set_file_cover_photo: "files:write",
  materialize_create_project: "projects:write",
  materialize_list_projects: "projects:read",
  materialize_get_project: "projects:read",
  materialize_update_project: "projects:write",
  materialize_delete_project: "projects:write",
  materialize_set_project_bom: "projects:write",
  materialize_request_circuit_upload_url: "projects:write",
  materialize_add_project_circuit_image: "projects:write",
  materialize_add_project_circuit_kicad: "projects:write",
  materialize_add_project_circuit_wokwi: "projects:write",
  materialize_delete_project_circuit: "projects:write",
  materialize_add_project_photo: "projects:write",
  materialize_add_project_inline_image: "projects:write",
  materialize_set_project_cover_photo: "projects:write",
  materialize_get_quote: "quotes:read",
  materialize_create_order: "orders:create",
  materialize_get_order: "orders:read",
  materialize_list_orders: "orders:read",
  materialize_cad_reference: "cad:build",
  materialize_cad_run: "cad:build",
  materialize_cad_save: "cad:build",
};

describe("app/api/[transport]/route requireScope coverage", () => {
  beforeEach(async () => {
    if (registered.length === 0) {
      // Import once; the module-level createMcpHandler(...) call runs the
      // registration callback synchronously against our stub.
      await import("@/app/api/[transport]/route");
    }
  });

  it("registered tools via the mocked mcp-handler", () => {
    expect(registered.length).toBeGreaterThan(0);
  });

  it("registers exactly the pinned set of tool names (catches added/removed/renamed tools)", () => {
    const names = registered.map((r) => r.name).sort();
    expect(names).toEqual(Object.keys(EXPECTED_TOOL_SCOPES).sort());
  });

  it.each(Object.keys(EXPECTED_TOOL_SCOPES))(
    "%s throws MissingScopeError (invalid_scope) when the caller lacks the required scope",
    async (name) => {
      const tool = registered.find((r) => r.name === name);
      expect(tool, `tool "${name}" was not registered`).toBeDefined();
      const result = await tool!.handler({}, scopelessAuthExtra());
      expect(result.isError).toBe(true);
      const parsed = parseResultText(result);
      expect(parsed.error.code).toBe("invalid_scope");
    }
  );

  it("succeeds past the scope check when the required scope IS present (spot check on a cheap tool)", async () => {
    // materialize_list_materials only needs catalog:read and then calls
    // getCraftCloudCatalog(), which will fail in this DB/network-less test
    // environment — but that's fine, we only care that it got PAST
    // requireScope (i.e. did NOT come back as invalid_scope).
    const tool = registered.find((r) => r.name === "materialize_list_materials");
    expect(tool).toBeDefined();
    const result = await tool!.handler(
      {},
      {
        authInfo: {
          extra: {
            userId: "user_test",
            tokenId: "tok_test",
            tokenName: "test token",
            scopes: ["catalog:read"],
          },
        },
      }
    );
    if (result.isError) {
      const parsed = parseResultText(result);
      expect(parsed.error.code).not.toBe("invalid_scope");
    }
  });
});

describe("tool annotations (ChatGPT app review + Claude permission prompts)", () => {
  beforeEach(async () => {
    if (registered.length === 0) await import("@/app/api/[transport]/route");
  });

  it("every registered tool carries all four hints and its title", () => {
    for (const { name, config } of registered) {
      const a = config.annotations;
      expect(a, name).toBeDefined();
      expect(a!.title, name).toBe(config.title);
      for (const hint of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ] as const) {
        expect(typeof a![hint], `${name}.${hint}`).toBe("boolean");
      }
    }
  });

  it("TOOL_ANNOTATIONS has no entries for tools that no longer exist", async () => {
    const { TOOL_ANNOTATIONS } = await import("@/lib/mcp/tool-annotations");
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(
      registered.map((r) => r.name).sort()
    );
  });

  it("marks every delete, update and replace destructive, and nothing that writes read-only", () => {
    for (const { name, config } of registered) {
      const a = config.annotations!;
      if (/_(delete|update)_|_set_project_bom$/.test(name)) {
        expect(a.destructiveHint, name).toBe(true);
      }
      if (a.readOnlyHint) {
        expect(a.destructiveHint, name).toBe(false);
        expect(name, name).toMatch(/_(get|list)_|_cad_(run|reference)$|_recommend_material$|_check_printability$/);
      }
    }
  });

  it("declares OAuth on every tool and keeps tool-specific _meta", () => {
    for (const { name, config } of registered) {
      const meta = (config as { _meta?: Record<string, unknown> })._meta;
      expect(meta?.securitySchemes, name).toEqual([{ type: "oauth2", scopes: [] }]);
    }
    const imp = registered.find((r) => r.name === "materialize_import_model");
    expect((imp!.config as { _meta?: Record<string, unknown> })._meta?.["openai/fileParams"]).toEqual(["file"]);
  });

  it("marks only the tool that reaches the open internet as open-world", () => {
    const openWorld = registered
      .filter((r) => r.config.annotations!.openWorldHint)
      .map((r) => r.name);
    expect(openWorld).toEqual(["materialize_import_model"]);
  });

  it("marks create_order destructive, since a spending policy can make it a real charge", () => {
    const order = registered.find((r) => r.name === "materialize_create_order");
    expect(order!.config.annotations!.destructiveHint).toBe(true);
  });
});

describe("CAD tools are owner-only on top of their scope", () => {
  it.each(["materialize_cad_reference", "materialize_cad_run", "materialize_cad_save"])(
    "%s refuses a cad:build token whose owner isn't on the text-to-CAD allowlist",
    async (name) => {
      // The sidecar executes arbitrary Python, so a scope alone must not be
      // enough: the account has to pass the same gate as the studio.
      const tool = registered.find((r) => r.name === name);
      expect(tool).toBeDefined();
      const result = await tool!.handler(
        { engine: "sdf", query: "a knob", code: "result = 1", name: "x", prompt: "x" },
        {
          authInfo: {
            extra: {
              userId: "user_test",
              tokenId: "tok_test",
              tokenName: "test token",
              scopes: ["cad:build"],
            },
          },
        }
      );
      expect(result.isError).toBe(true);
      expect(parseResultText(result).error.code).toBe("forbidden");
    }
  );
});

describe("in-chat widgets (ChatGPT apps / MCP Apps)", () => {
  it.each([
    ["materialize_get_quote", "ui://materialize/quote-v2.html"],
    ["materialize_recommend_material", "ui://materialize/materials-v2.html"],
  ])("%s points at its widget under both hosts' keys", (name, uri) => {
    const tool = registered.find((r) => r.name === name);
    const meta = (tool!.config as { _meta?: Record<string, unknown> })._meta!;
    expect(meta.ui).toEqual({ resourceUri: uri });
    expect(meta["openai/outputTemplate"]).toBe(uri);
  });

  it("registers each widget as an MCP Apps HTML resource that allows the CDN and our origin", async () => {
    expect(registeredResources.map((r) => r.uri).sort()).toEqual([
      "ui://materialize/materials-v2.html",
      "ui://materialize/quote-v2.html",
    ]);
    for (const r of registeredResources) {
      const { contents } = await r.read();
      expect(contents[0].mimeType).toBe("text/html;profile=mcp-app");
      expect(String(contents[0].text)).toContain("<!doctype html>");
      const csp = (contents[0]._meta as { ui: { csp: { connectDomains: string[]; resourceDomains: string[] } } }).ui.csp;
      expect(csp.resourceDomains).toContain("https://cdn.jsdelivr.net");
      expect(csp.connectDomains.some((d) => d.startsWith("http"))).toBe(true);
    }
  });
});
