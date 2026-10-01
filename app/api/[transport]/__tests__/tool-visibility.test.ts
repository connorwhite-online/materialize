import { describe, it, expect, vi, beforeEach } from "vitest";

// Owner-only CAD tools are left out of tools/list for everyone else. The
// route builds a fresh server per request, so this drives the exported
// handler end to end: token verification, then server init, then reads
// which tools were disabled.

const { state } = vi.hoisted(() => ({
  state: {
    init: undefined as undefined | ((server: unknown) => Promise<void> | void),
    verify: undefined as undefined | ((req: Request, token?: string) => Promise<unknown>),
    disabled: [] as string[],
    cadAllowed: false,
  },
}));

vi.mock("mcp-handler", () => ({
  createMcpHandler: (init: (server: unknown) => Promise<void> | void) => {
    state.init = init;
    return async () => {
      const server = {
        registerTool: (name: string) => ({
          disable: () => state.disabled.push(name),
        }),
      };
      await state.init!(server);
      return new Response(null, { status: 200 });
    };
  },
  withMcpAuth:
    (handler: (req: Request) => Promise<Response>, verify: typeof state.verify) =>
    async (req: Request) => {
      await verify!(req, "token");
      return handler(req);
    },
}));

vi.mock("@/lib/mcp/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/auth")>()),
  verifyMaterializeToken: async () => ({
    token: "token",
    clientId: "client",
    scopes: [],
    extra: { userId: "user_viewer", tokenId: "tok", tokenName: "t", scopes: [] },
  }),
}));

vi.mock("@/lib/mcp/internal/cad", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/internal/cad")>()),
  hasCadAccess: async () => state.cadAllowed,
}));

import { POST } from "../route";

const CAD_TOOLS = [
  "materialize_cad_reference",
  "materialize_cad_run",
  "materialize_cad_save",
];

describe("owner-only tool visibility", () => {
  beforeEach(() => {
    state.disabled = [];
  });

  it("hides the CAD tools from a user without CAD access", async () => {
    state.cadAllowed = false;
    await POST(new Request("https://materialize.cc/api/mcp", { method: "POST" }));
    expect(state.disabled.sort()).toEqual(CAD_TOOLS);
  });

  it("lists everything for the owner", async () => {
    state.cadAllowed = true;
    await POST(new Request("https://materialize.cc/api/mcp", { method: "POST" }));
    expect(state.disabled).toEqual([]);
  });
});
