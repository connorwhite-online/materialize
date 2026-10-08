import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeRow {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: Date | null;
  revokedAt: Date | null;
}
const touched: string[] = [];

let rows: FakeRow[] = [];
const inserted: Array<Record<string, unknown>> = [];
let insertThrows = false;

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows.slice(0, 1)),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          touched.push("touch");
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (insertThrows) return Promise.reject(new Error("fk violation"));
          inserted.push(v);
          rows.push({
            id: "conn_new",
            name: v.name as string,
            scopes: v.scopes as string[],
            revokedAt: null,
          });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  personalAccessTokens: {
    id: "id",
    userId: "user_id",
    oauthClientId: "oauth_client_id",
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const ensureUserRow = vi.fn();
vi.mock("@/lib/users/ensure-user-row", () => ({
  ensureUserRow: (id: string) => ensureUserRow(id),
}));

const verify = vi.fn();
const listApps = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () =>
    Promise.resolve({
      idPOAuthAccessToken: { verify },
      oauthApplications: { list: listApps },
    }),
}));

import {
  clerkIssuerUrl,
  clientNameFromMetadataUrl,
  toEpochSeconds,
  verifyOAuthAccessToken,
  OAUTH_CONNECTION_SCOPES,
} from "../oauth";
import { verifyMaterializeToken } from "../auth";

function liveToken(overrides: Record<string, unknown> = {}) {
  return {
    clientId: "client_chatgpt",
    subject: "user_abc",
    revoked: false,
    expired: false,
    expiration: Date.UTC(2030, 0, 1),
    ...overrides,
  };
}

describe("clerkIssuerUrl", () => {
  const pk = (host: string, env = "live") =>
    `pk_${env}_${Buffer.from(`${host}$`).toString("base64")}`;

  it("decodes the frontend API host from the publishable key", () => {
    expect(clerkIssuerUrl(pk("clerk.materialize.xyz"))).toBe(
      "https://clerk.materialize.xyz"
    );
    expect(clerkIssuerUrl(pk("happy-cat-12.clerk.accounts.dev", "test"))).toBe(
      "https://happy-cat-12.clerk.accounts.dev"
    );
  });

  it("returns null for a missing or malformed key rather than advertising a bogus server", () => {
    expect(clerkIssuerUrl("")).toBeNull();
    expect(clerkIssuerUrl("sk_live_abc")).toBeNull();
    // No trailing `$` sentinel.
    expect(clerkIssuerUrl(`pk_live_${Buffer.from("x.com").toString("base64")}`)).toBeNull();
    // A host with a path or scheme smuggled in.
    expect(clerkIssuerUrl(pk("evil.example/x"))).toBeNull();
  });
});

describe("verifyOAuthAccessToken", () => {
  beforeEach(() => {
    rows = [];
    inserted.length = 0;
    touched.length = 0;
    insertThrows = false;
    verify.mockReset();
    ensureUserRow.mockReset();
    ensureUserRow.mockResolvedValue(true);
    listApps.mockReset();
    listApps.mockResolvedValue({
      data: [{ clientId: "client_chatgpt", name: "ChatGPT" }],
    });
  });

  it("rejects a token Clerk doesn't recognise", async () => {
    verify.mockRejectedValue(new Error("not found"));
    expect(await verifyOAuthAccessToken("oat_bogus")).toBeUndefined();
  });

  it.each([
    ["revoked", { revoked: true }],
    ["expired", { expired: true }],
    ["issued to a non-user subject", { subject: "org_123" }],
  ])("rejects a token that is %s", async (_label, overrides) => {
    verify.mockResolvedValue(liveToken(overrides));
    expect(await verifyOAuthAccessToken("oat_x")).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("creates a connection row named after the client on first use", async () => {
    verify.mockResolvedValue(liveToken());
    const info = await verifyOAuthAccessToken("oat_live");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: "user_abc",
      name: "ChatGPT",
      oauthClientId: "client_chatgpt",
      prefix: "oauth",
      scopes: OAUTH_CONNECTION_SCOPES,
    });
    expect(info?.extra).toEqual({
      userId: "user_abc",
      tokenId: "conn_new",
      tokenName: "ChatGPT",
      scopes: OAUTH_CONNECTION_SCOPES,
    });
    // Clerk reports ms; AuthInfo wants seconds.
    expect(info?.expiresAt).toBe(Date.UTC(2030, 0, 1) / 1000);
  });

  it("reuses the existing connection without another insert", async () => {
    rows = [{ id: "conn_1", name: "Claude", scopes: ["orders:read"], revokedAt: null }];
    verify.mockResolvedValue(liveToken());
    const info = await verifyOAuthAccessToken("oat_live");
    expect(inserted).toHaveLength(0);
    expect(info?.extra.tokenId).toBe("conn_1");
    expect(info?.scopes).toEqual(["orders:read"]);
    expect(touched).toHaveLength(1);
  });

  it("skips the last-used write inside the one-minute backoff", async () => {
    rows = [
      { id: "conn_1", name: "Claude", scopes: [], lastUsedAt: new Date(), revokedAt: null },
    ];
    verify.mockResolvedValue(liveToken());
    await verifyOAuthAccessToken("oat_live");
    expect(touched).toHaveLength(0);
  });

  it("refuses every token for a connection the user revoked", async () => {
    rows = [{ id: "conn_1", name: "ChatGPT", scopes: [], revokedAt: new Date() }];
    verify.mockResolvedValue(liveToken());
    expect(await verifyOAuthAccessToken("oat_fresh")).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("falls back to a generic name when the client isn't on the first page", async () => {
    listApps.mockResolvedValue({ data: [] });
    verify.mockResolvedValue(liveToken());
    await verifyOAuthAccessToken("oat_live");
    expect(inserted[0].name).toBe("Connected app");
  });

  it("creates the users row before the connection, since the webhook may not have", async () => {
    verify.mockResolvedValue(liveToken());
    await verifyOAuthAccessToken("oat_live");
    expect(ensureUserRow).toHaveBeenCalledWith("user_abc");
    expect(inserted).toHaveLength(1);
  });

  it("refuses the token when the users row can't be created", async () => {
    ensureUserRow.mockResolvedValue(false);
    verify.mockResolvedValue(liveToken());
    expect(await verifyOAuthAccessToken("oat_live")).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("names a metadata-document client after its host without asking Clerk", async () => {
    verify.mockResolvedValue(
      liveToken({ clientId: "https://chatgpt.com/oauth/client.json" })
    );
    await verifyOAuthAccessToken("oat_live");
    expect(inserted[0]).toMatchObject({
      name: "ChatGPT",
      oauthClientId: "https://chatgpt.com/oauth/client.json",
    });
    expect(listApps).not.toHaveBeenCalled();
  });

  it("refuses the token instead of throwing when the connection can't be created", async () => {
    insertThrows = true;
    verify.mockResolvedValue(liveToken());
    expect(await verifyOAuthAccessToken("oat_live")).toBeUndefined();
  });
});

describe("verifyMaterializeToken routing", () => {
  beforeEach(() => {
    rows = [];
    verify.mockReset();
  });

  it("sends non-PAT bearers to Clerk", async () => {
    verify.mockRejectedValue(new Error("not found"));
    await verifyMaterializeToken(new Request("https://x"), "oat_something");
    expect(verify).toHaveBeenCalledWith("oat_something");
  });

  it("never sends a personal access token to Clerk", async () => {
    await verifyMaterializeToken(
      new Request("https://x"),
      "mtl_pat_abcdefghijklmnopqrstuvwxyz1234567890"
    );
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("clientNameFromMetadataUrl", () => {
  it("names known clients and falls back to the host", () => {
    expect(clientNameFromMetadataUrl("https://chatgpt.com/oauth/client.json")).toBe("ChatGPT");
    expect(clientNameFromMetadataUrl("https://claude.ai/oauth/mcp-client.json")).toBe("Claude");
    expect(clientNameFromMetadataUrl("https://www.example.dev/client.json")).toBe("example.dev");
  });

  it("returns null for an ordinary Clerk client id or a non-https URL", () => {
    expect(clientNameFromMetadataUrl("SCamTHu6rYwGs0nT")).toBeNull();
    expect(clientNameFromMetadataUrl("http://chatgpt.com/oauth/client.json")).toBeNull();
  });
});

describe("toEpochSeconds", () => {
  it("converts Clerk's millisecond expirations and keeps second ones as they are", () => {
    const seconds = Date.UTC(2030, 0, 1) / 1000;
    expect(toEpochSeconds(seconds * 1000)).toBe(seconds);
    // A seconds value must not be divided again: that lands in 1970 and
    // mcp-handler 401s every request as expired.
    expect(toEpochSeconds(seconds)).toBe(seconds);
    expect(toEpochSeconds(null)).toBeUndefined();
  });
});
