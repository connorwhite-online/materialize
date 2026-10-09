import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  verifyMaterializeToken,
  requireScope,
  MissingScopeError,
  type MaterializeAuthExtra,
  type MaterializeAuthInfo,
} from "@/lib/mcp/auth";
import {
  getCraftCloudCatalog,
  findMaterialBySlug,
} from "@/lib/craftcloud/catalog";
import {
  checkPrintabilityForUser,
  recommendMaterialsForUser,
} from "@/lib/mcp/internal/printability";
import type { Needs } from "@/lib/dfm/recommend";
import { designLimits } from "@/lib/craftcloud/design-limits";
import {
  requestUploadUrlForUser,
  registerUploadForUser,
  listFilesForUser,
  deleteFileForUser,
  updateFileForUser,
  addFilePhotoForUser,
  setFileCoverPhotoForUser,
  requestPhotoUploadUrlForUser,
  requestCircuitUploadUrlForUser,
  importModelFromUrlForUser,
} from "@/lib/mcp/internal/files";
import {
  createProjectForUser,
  listProjectsForUser,
  getProjectForUser,
  updateProjectForUser,
  deleteProjectForUser,
  setProjectBomForUser,
  addProjectCircuitImageForUser,
  addProjectCircuitKicadForUser,
  addProjectCircuitWokwiForUser,
  deleteProjectCircuitForUser,
  addProjectPhotoForUser,
  addProjectInlineImageForUser,
  setProjectCoverPhotoForUser,
} from "@/lib/mcp/internal/projects";
import { cheapestByMaterial, getQuoteForUser } from "@/lib/mcp/internal/quotes";
import {
  MATERIALS_WIDGET_URI,
  QUOTE_WIDGET_URI,
  registerWidgets,
  widgetModelLink,
  widgetToolMeta,
} from "@/lib/mcp/widgets";
import {
  assertCadAccess,
  CadAccessError,
  hasCadAccess,
  cadReference,
  MAX_CAD_CODE_CHARS,
  runCadForAgent,
  runRenders,
  saveCadForAgent,
  summarizeRun,
} from "@/lib/mcp/internal/cad";
import {
  createAgentInitiatedOrder,
  getOrderForUser,
  listOrdersForUser,
} from "@/lib/mcp/internal/orders";
import { sendOrderConfirmationEmail } from "@/lib/mcp/email";
import { LICENSE_ENUM_VALUES } from "@/lib/licenses";
import { DESIGN_TAG_OPTIONS } from "@/lib/validations/file";
import { deriveAppUrl } from "@/lib/utils/request-url";
import { logError } from "@/lib/logger";
import { clerkClient } from "@clerk/nextjs/server";
import { primaryEmail } from "@/lib/clerk-email";
import { shippingPhoneSchema } from "@/lib/validations/address";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/tool-annotations";

/**
 * Convert any tool result into the MCP shape. The payload goes out
 * twice: as `structuredContent` (what ChatGPT apps and Claude's MCP Apps
 * hand to widgets, and what current clients read first) and as one
 * JSON text block for clients that predate structured output.
 */
/**
 * ChatGPT puts its own `openai/*` keys (locale, user agent, location) in
 * every tools/call request's _meta; their presence means the result will
 * render as our card.
 */
function hostRendersCard(extra: unknown): boolean {
  const meta = (extra as { _meta?: Record<string, unknown> } | undefined)?._meta;
  return !!meta && Object.keys(meta).some((k) => k.startsWith("openai/"));
}

/**
 * A card result: the JSON for the model and widget, led by a note that the
 * user is already looking at it. The widget description alone didn't stop
 * ChatGPT from re-tabulating every price under the card; the note goes
 * only to hosts that render it, so text-only clients still get prices.
 */
function cardResult(payload: object, extra: unknown, note: string) {
  const base = jsonResult(payload);
  if (!hostRendersCard(extra)) return base;
  return { ...base, content: [{ type: "text" as const, text: note }, ...base.content] };
}

function jsonResult(payload: object) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

/**
 * Attach each tool's annotations from TOOL_ANNOTATIONS at registration,
 * and refuse to register one that has none. Patching registerTool keeps
 * every call site below unchanged while making "forgot the annotations"
 * a startup failure instead of a review rejection.
 */
function annotateTools(server: { registerTool: (...args: never[]) => unknown }) {
  const tools = new Map<string, unknown>();
  const register = server.registerTool.bind(server) as (
    name: string,
    config: Record<string, unknown>,
    handler: unknown
  ) => unknown;
  (server as { registerTool: typeof register }).registerTool = (
    name,
    config,
    handler
  ) => {
    const annotations = TOOL_ANNOTATIONS[name];
    if (!annotations) {
      throw new Error(`MCP tool ${name} has no entry in TOOL_ANNOTATIONS`);
    }
    const tool = register(
      name,
      {
        ...config,
        annotations: { title: config.title, ...annotations },
        // Every tool acts as the signed-in user. ChatGPT reads this to
        // decide that a tool needs account linking; OpenAI asks for it per
        // tool rather than as a server default. The MCP SDK drops unknown
        // top-level config keys, so it travels in _meta.
        _meta: {
          ...(config._meta as Record<string, unknown> | undefined),
          securitySchemes: [{ type: "oauth2", scopes: [] }],
        },
      },
      handler
    );
    tools.set(name, tool);
    return tool;
  };
  return tools;
}

/**
 * The verified auth for the request being served. mcp-handler builds a
 * fresh McpServer per request but hands the init callback only the
 * server, so the token verifier records its result here for
 * hideUnavailableTools to read.
 */
const OWNER_ONLY_TOOLS = [
  "materialize_cad_reference",
  "materialize_cad_run",
  "materialize_cad_save",
];

const requestAuth = new AsyncLocalStorage<{ auth?: MaterializeAuthInfo }>();

/**
 * Order price fields for create_order responses. amountDueCents is what
 * the user pays (the confirm page charges totalPriceCents + the service
 * fee); totalPriceCents alone reads as the total and isn't.
 */
function priceFields(result: {
  totalPriceCents: number;
  serviceFeeCents: number;
  breakdown?: {
    productionCents: number;
    minimumFeeCents: number;
    shippingCents: number;
  };
}) {
  return {
    amountDueCents: result.totalPriceCents + result.serviceFeeCents,
    totalPriceCents: result.totalPriceCents,
    serviceFeeCents: result.serviceFeeCents,
    ...(result.breakdown
      ? {
          productionCents: result.breakdown.productionCents,
          minimumFeeCents: result.breakdown.minimumFeeCents,
          shippingCents: result.breakdown.shippingCents,
        }
      : {}),
  };
}

/**
 * The signed-in user's primary email, so an agent doesn't have to ask
 * for something the account already has (ChatGPT stopped the order
 * review case to ask for it). Null when Clerk has none or is unreachable.
 */
async function accountEmail(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    return primaryEmail(await client.users.getUser(userId));
  } catch (err) {
    logError("mcp.accountEmail", err);
    return null;
  }
}

async function verifyAndRecord(req: Request, bearerToken: string | undefined) {
  const auth = await verifyMaterializeToken(req, bearerToken);
  if (!auth) {
    // Temporary, while ChatGPT's tool discovery 401s after a good
    // sign-in: which of its requests is refused, and with what.
    logError("mcp.auth.rejected", {
      method: req.method,
      hasBearer: Boolean(bearerToken),
      bearerIsPat: bearerToken?.startsWith("mtl_pat_") ?? false,
      userAgent: req.headers.get("user-agent"),
    });
  }
  const slot = requestAuth.getStore();
  if (slot) slot.auth = auth;
  return auth;
}

/**
 * Owner-only tools stay out of tools/list for everyone else, so a
 * directory reviewer or a ChatGPT user never sees tools that can only
 * refuse them. Presentation only: each tool still enforces its own gate.
 */
async function hideUnavailableTools(tools: Map<string, unknown>) {
  const userId = requestAuth.getStore()?.auth?.extra?.userId;
  if (!userId || (await hasCadAccess(userId))) return;
  for (const name of OWNER_ONLY_TOOLS) {
    (tools.get(name) as { disable?: () => void } | undefined)?.disable?.();
  }
}

function errorResult(error: {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable ?? false,
              ...(error.details ? { details: error.details } : {}),
            },
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function readAuthExtra(extra: {
  authInfo?: { extra?: unknown };
}): MaterializeAuthExtra {
  const e = extra.authInfo?.extra as MaterializeAuthExtra | undefined;
  if (!e?.userId) {
    throw new Error("Missing auth context");
  }
  return e;
}

const MCP_SERVER_INSTRUCTIONS = [
  "Materialize gets 3D models professionally printed and shipped, and hosts models and hardware projects creators publish.",
  "To print: get the model in with materialize_import_model (a file attached in chat or a public https URL) or materialize_request_upload_url + materialize_register_upload, run materialize_check_printability and fix any blockers it reports, price it with materialize_get_quote, then materialize_create_order.",
  "If the user hasn't picked a material, ask what the part has to do and use materialize_recommend_material rather than guessing; pass its materialId to materialize_get_quote.",
  "Before materialize_create_order, show the user the price, material, vendor and lead time and get their go-ahead. Orders are physical and can't be undone once placed.",
  "The user approves and pays at the returned confirmationUrl unless their spending policy allows the order. Don't tell them it is placed until materialize_get_order says so.",
].join(" ");

const handler = createMcpHandler(
  async (server) => {
    const tools = annotateTools(server);
    registerWidgets(server as unknown as Parameters<typeof registerWidgets>[0]);

    /* -------------------- CAD (agent writes, Materialize runs) -------------------- */

    server.registerTool(
      "materialize_cad_reference",
      {
        title: "CAD engine reference",
        description:
          "How to write a CAD program Materialize can build: the engine's full guide (vocabulary, output contract, printability rules) plus the closest verified example programs for what you're making. Read this before materialize_cad_run. Engines: 'sdf' (implicit fields + exact mesh booleans; best for organic, blended, enclosure and lattice parts; STL) and 'brep' (build123d on OpenCASCADE; crisp prismatic parts; STL + STEP).",
        inputSchema: {
          engine: z.enum(["sdf", "brep"]),
          query: z.string().min(2).max(2000).describe("What you're making, in plain words; used to pick examples"),
          examples: z.number().int().min(0).max(5).optional(),
        },
      },
      async ({ engine, query, examples }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "cad:build");
          await assertCadAccess(auth.userId);
          return jsonResult(cadReference(engine, query, examples ?? 3));
        } catch (err) {
          return cadOrInternal(err, "materialize_cad_reference");
        }
      }
    );

    server.registerTool(
      "materialize_cad_run",
      {
        title: "Run a CAD program",
        description:
          "Execute a CAD program on Materialize's geometry engine and get back exactly what the studio's own harness sees: whether it compiled, the exact error and script line if not, watertight/solid/manifold validity, dimensions in mm, printability (minimum wall, overhangs, trapped voids), and rendered views as images. Nothing is saved. Iterate with this, then call materialize_cad_save.",
        inputSchema: {
          engine: z.enum(["sdf", "brep"]),
          code: z.string().min(1).max(MAX_CAD_CODE_CHARS).describe("The full Python program; must assign `result` (or a `parts` dict)"),
          views: z.number().int().min(0).max(6).optional().describe("How many rendered views to return as images (default 3)"),
        },
      },
      async ({ engine, code, views }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "cad:build");
          await assertCadAccess(auth.userId);
          const run = await runCadForAgent(code, engine);
          const images = runRenders(run, views ?? 3);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ ...summarizeRun(run), views: images.map((i) => i.view) }, null, 2) },
              ...images.map((i) => ({ type: "image" as const, data: i.png, mimeType: "image/png" })),
            ],
          };
        } catch (err) {
          return cadOrInternal(err, "materialize_cad_run");
        }
      }
    );

    server.registerTool(
      "materialize_cad_save",
      {
        title: "Save a CAD build",
        description:
          "Run a finished CAD program and save it as a build in the user's Materialize studio (a new thread with its own file, or a project for multi-part assemblies), so it can be viewed, revised, quoted and printed. Fails without saving anything usable if the program doesn't produce a valid watertight result; fix it with materialize_cad_run first.",
        inputSchema: {
          engine: z.enum(["sdf", "brep"]),
          code: z.string().min(1).max(MAX_CAD_CODE_CHARS),
          name: z.string().min(2).max(120).describe("Build name shown in the studio"),
          prompt: z.string().min(2).max(2000).describe("What was asked for, recorded as the build's prompt"),
        },
      },
      async ({ engine, code, name, prompt }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "cad:build");
          await assertCadAccess(auth.userId);
          const saved = await saveCadForAgent({ userId: auth.userId, code, engine, name, prompt });
          if (!saved.ok) {
            return errorResult({
              code: "build_failed",
              message: saved.error,
              details: saved.run ? { run: summarizeRun(saved.run) } : undefined,
            });
          }
          return jsonResult(saved);
        } catch (err) {
          return cadOrInternal(err, "materialize_cad_save");
        }
      }
    );

    /* -------------------- Catalog -------------------- */

    server.registerTool(
      "materialize_list_materials",
      {
        title: "List materials",
        description:
          "Browse Materialize's printable material catalog. Returns CraftCloud material UUIDs that can be passed to materialize_get_quote.",
        inputSchema: {
          group: z
            .string()
            .optional()
            .describe(
              "Optional family filter, e.g. 'Standard Plastics', 'Nylons', 'Resins', 'Metals'"
            ),
          query: z.string().optional().describe(
            "Substring match against material names (case-insensitive)"
          ),
          limit: z.number().int().min(1).max(200).optional(),
        },
      },
      async ({ group, query, limit }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "catalog:read");
          const catalog = await getCraftCloudCatalog();
          const q = query?.toLowerCase();
          const out: Array<{
            id: string;
            name: string;
            group: string;
            featuredImage: string | null;
            tags: string[];
            finishes: Array<{ id: string; name: string }>;
          }> = [];
          for (const g of catalog.groups) {
            if (group && g.name.toLowerCase() !== group.toLowerCase()) continue;
            for (const m of g.materials) {
              if (q && !m.name.toLowerCase().includes(q)) continue;
              out.push({
                id: m.id,
                name: m.name,
                group: g.name,
                featuredImage: m.featuredImage ?? null,
                tags: (m.tags ?? []).map((t) => t.name),
                finishes: (m.finishGroups ?? []).map((fg) => ({
                  id: fg.id,
                  name: fg.name,
                })),
              });
              if (limit && out.length >= limit) break;
            }
            if (limit && out.length >= limit) break;
          }
          return jsonResult({ materials: out, total: out.length });
        } catch (err) {
          return scopeOrInternal(err, "materialize_list_materials");
        }
      }
    );

    server.registerTool(
      "materialize_get_material",
      {
        title: "Get material details",
        description:
          "Fetch full detail for a single material — properties, build volume, available finishes, vendors, colors. Accepts the CraftCloud material id (preferred) or a marketplace slug.",
        inputSchema: {
          id: z.string().optional(),
          slug: z.string().optional(),
        },
      },
      async ({ id, slug }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "catalog:read");
          if (!id && !slug) {
            return errorResult({
              code: "invalid_input",
              message: "Provide either id or slug",
            });
          }

          let material: Awaited<
            ReturnType<typeof getCraftCloudCatalog>
          >["groups"][number]["materials"][number] | null = null;
          let groupName = "";

          if (id) {
            const catalog = await getCraftCloudCatalog();
            const m = catalog.materialById.get(id);
            if (m) {
              material = m;
              groupName = m.materialGroupName ?? "";
            }
          } else if (slug) {
            const found = await findMaterialBySlug(slug);
            if (found) {
              material = found.material;
              groupName = found.group.name;
            }
          }
          if (!material) {
            return errorResult({
              code: "not_found",
              message: "Material not found",
            });
          }

          return jsonResult({
            id: material.id,
            name: material.name,
            slug: material.slug,
            group: groupName,
            description: material.description ?? null,
            descriptionShort: material.descriptionShort ?? null,
            featuredImage: material.featuredImage ?? null,
            properties: {
              tensileStrengthMpaMin: material.tensileStrengthMin ?? null,
              tensileStrengthMpaMax: material.tensileStrengthMax ?? null,
              densityGCm3: material.density ?? null,
              heatDeflection66PsiMaxC:
                material.heatDeflectionTemp66PSIMax ?? null,
              defaultLayerHeightMm: material.defaultLayerHeight ?? null,
              defaultInfillPct: material.defaultInfill ?? null,
              accuracyMm: material.accuracy ?? null,
              warpingRisk: material.warpingRisk ?? null,
            },
            buildVolumeMm: material.maximumPrintingDimensions ?? null,
            // CraftCloud's own minimums per process, in mm. Design to
            // these: thinner walls fail or get rejected.
            designLimits: designLimits(material),
            finishes: (material.finishGroups ?? []).map((fg) => ({
              id: fg.id,
              name: fg.name,
              description: fg.descriptionShort ?? null,
              colors: Array.from(
                new Set((fg.materialConfigs ?? []).map((c) => c.color))
              ),
              configCount: fg.materialConfigs?.length ?? 0,
            })),
          });
        } catch (err) {
          return scopeOrInternal(err, "materialize_get_material");
        }
      }
    );

    server.registerTool(
      "materialize_check_printability",
      {
        title: "Check a model before printing",
        description:
          "Check an uploaded model for problems that make prints fail, and see which materials it suits. Reports size, holes in the surface, loose pieces, flipped faces, probable unit mistakes, and thin walls, each with how to fix it, plus a good/risky/no verdict per material and design tips for the processes that fit. Run this after upload and before materialize_get_quote, and fix blockers first: a quote for a broken mesh gets rejected by the vendor after you've told the user a price. Walls are measured at sample points over the surface and judged against CraftCloud's published minimums for each process; a vendor can still reject a part.",
        inputSchema: {
          fileAssetId: z
            .string()
            .uuid()
            .describe("The fileAssetId from materialize_register_upload or materialize_import_model"),
        },
      },
      async ({ fileAssetId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:read");
          const result = await checkPrintabilityForUser({
            userId: auth.userId,
            fileAssetId,
          });
          if ("error" in result) {
            return errorResult({
              code: result.error === "Forbidden" ? "forbidden" : "not_found",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_check_printability");
        }
      }
    );

    server.registerTool(
      "materialize_recommend_material",
      {
        title: "Recommend materials for a part",
        description:
          "Shortlist materials for what the part must do, with why each fits, what to watch out for, and the materialId to pass to materialize_get_quote. Say what matters (useCase, or minimum scores 1-5 for strength, flexibility, detail, heatResistance, a price ceiling, a preference) and, if you have one, the fileAssetId so materials the part can't be made in (too big, too thin) are ruled out. Ask the user what the part will do before guessing: a bracket, a figurine and a phone case want different materials. ruledOut says which requirement removed each material. Where the host shows Materialize's materials card (ChatGPT, Claude), the card already shows the shortlist and ratings: don't repeat them in a table, say which you'd pick and why. With a fileAssetId, each pick also carries `price.fromCents`: the cheapest all-in price to print that file in it (US shipping), so prices can guide the choice.",
        _meta: widgetToolMeta(MATERIALS_WIDGET_URI, {
          invoking: "Shortlisting materials…",
          invoked: "Materials ready",
        }),
        inputSchema: {
          useCase: z
            .enum([
              "prototype",
              "functional",
              "display",
              "outdoor",
              "flexible",
              "high_temp",
              "miniature",
            ])
            .optional(),
          needs: z
            .object({
              strength: z.number().int().min(1).max(5).optional(),
              flexibility: z.number().int().min(1).max(5).optional(),
              detail: z.number().int().min(1).max(5).optional(),
              heatResistance: z.number().int().min(1).max(5).optional(),
            })
            .optional()
            .describe("Minimum scores out of 5; overrides the useCase defaults"),
          maxPrice: z
            .enum(["budget", "mid", "premium"])
            .optional()
            .describe("Highest price tier to consider"),
          category: z
            .enum(["plastic", "metal", "flexible", "resin", "ceramic", "composite"])
            .optional(),
          prefer: z
            .enum([
              "cheapest",
              "strongest",
              "most_detail",
              "most_flexible",
              "most_heat_resistant",
            ])
            .optional(),
          fileAssetId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(10).optional(),
        },
      },
      async (args, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "catalog:read");
          if (args.fileAssetId) requireScope(auth, "files:read");
          const result = await recommendMaterialsForUser({
            userId: auth.userId,
            ...args,
            needs: args.needs as Needs | undefined,
          });
          if ("error" in result) {
            return errorResult({
              code: result.error === "Forbidden" ? "forbidden" : "not_found",
              message: result.error,
            });
          }
          // With a file, price each pick for it, so the user and the agent
          // see what each material costs while still choosing one.
          let picks: Array<(typeof result.picks)[number] & { price?: unknown }> = result.picks;
          const ids = result.picks.map((p) => p.craftCloudMaterialId).filter((id): id is string => !!id);
          if (args.fileAssetId && ids.length) {
            try {
              const quote = await getQuoteForUser({
                userId: auth.userId,
                fileAssetId: args.fileAssetId,
                materialIds: ids,
                currency: "USD",
                maxOptions: 200,
              });
              if (!("error" in quote)) {
                const best = cheapestByMaterial(quote.quotes);
                picks = result.picks.map((p) => {
                  const q = p.craftCloudMaterialId ? best.get(p.craftCloudMaterialId) : undefined;
                  return q
                    ? {
                        ...p,
                        price: {
                          fromCents: q.totalCents,
                          vendorName: q.vendorName,
                          process: q.process,
                          arrivesEarliest: q.arrivesEarliest,
                          arrivesLatest: q.arrivesLatest,
                        },
                      }
                    : p;
                });
              }
            } catch (err) {
              logError("mcp.recommend.prices", err);
            }
          }
          // useCase titles the material widget.
          return cardResult({ ...result, picks, useCase: args.useCase ?? null }, extra,
            "The user is looking at this shortlist in Materialize's materials card: each material's strength, flex, detail and heat ratings, description, cautions, price for their file when known, and what was ruled out. Reply in one or two sentences on which you'd pick and why. Don't restate the shortlist, ratings or prices in a table."
          );
        } catch (err) {
          return scopeOrInternal(err, "materialize_recommend_material");
        }
      }
    );

    /* -------------------- Files -------------------- */

    server.registerTool(
      "materialize_request_upload_url",
      {
        title: "Request a presigned upload URL",
        description:
          "Get a presigned R2 URL the agent can PUT a 3D model file to directly. After uploading, call materialize_register_upload with the returned storageKey.",
        inputSchema: {
          filename: z.string().min(1),
          sizeBytes: z.number().int().min(1).max(200 * 1024 * 1024),
          contentType: z.string().optional(),
        },
      },
      async ({ filename, sizeBytes, contentType }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await requestUploadUrlForUser({
            userId: auth.userId,
            filename,
            sizeBytes,
            contentType,
          });
          if ("error" in result) {
            return errorResult({
              code: "invalid_input",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_request_upload_url");
        }
      }
    );

    // Shared Zod sub-schema for file metadata. Used by both
    // materialize_register_upload (set at create time) and
    // materialize_update_file (edit existing). All fields optional;
    // omitted fields preserve their existing value on update or
    // default sensibly on create.
    const fileMetadataSchema = z.object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      priceCents: z.number().int().min(0).optional(),
      license: z.enum(LICENSE_ENUM_VALUES).optional(),
      visibility: z.enum(["public", "private"]).optional(),
      tags: z.array(z.string().min(1).max(32)).max(20).optional(),
      designTags: z.array(z.enum(DESIGN_TAG_OPTIONS)).optional(),
      recommendedMaterialId: z.string().max(100).optional(),
      minWallThicknessMm: z.number().min(0).max(100).optional(),
    });

    server.registerTool(
      "materialize_register_upload",
      {
        title: "Register an uploaded model",
        description:
          "After PUTting the file to the URL returned by materialize_request_upload_url, register the upload to receive a fileAssetId + fileId. Optionally pass `metadata` to set name, description, license, price, tags, and visibility at create time — otherwise the file lands with name derived from the filename, license=cc_by, price=0, and your default upload visibility. The CraftCloud model upload runs in the background; you may need to wait a few seconds before quoting.",
        inputSchema: {
          storageKey: z.string().min(1),
          originalFilename: z.string().min(1),
          format: z.enum(["stl", "obj", "3mf", "step", "amf"]),
          fileSize: z.number().int().min(1),
          fileUnit: z.enum(["mm", "cm", "in"]).optional(),
          metadata: fileMetadataSchema.optional(),
        },
      },
      async (
        { storageKey, originalFilename, format, fileSize, fileUnit, metadata },
        extra
      ) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await registerUploadForUser({
            userId: auth.userId,
            storageKey,
            originalFilename,
            format,
            fileSize,
            fileUnit,
            metadata,
          });
          if ("error" in result) {
            return errorResult({
              code: "register_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_register_upload");
        }
      }
    );

    // ChatGPT hydrates a declared file param into this shape when the user
    // attaches a file (Apps SDK `openai/fileParams`). Optional because the
    // host occasionally drops it, and other clients pass `url` instead.
    const chatFileSchema = z
      .object({
        download_url: z.string().url(),
        file_id: z.string(),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
      })
      .describe("A 3D model file the user attached in the chat");

    server.registerTool(
      "materialize_import_model",
      {
        title: "Import a 3D model from the chat or a link",
        description:
          "Add a 3D model (STL, OBJ, 3MF, STEP, AMF) to the user's Materialize library from a file they attached in this chat, or from a public https URL. Returns a fileAssetId to pass to materialize_get_quote. Prefer this over materialize_request_upload_url whenever you can't PUT the bytes yourself. Optionally pass `metadata` to name the file or set its listing details; it lands private by default.",
        inputSchema: {
          file: chatFileSchema.optional(),
          url: z
            .string()
            .url()
            .optional()
            .describe("Public https URL of the model, when there's no attached file"),
          filename: z
            .string()
            .max(200)
            .optional()
            .describe("Original filename with extension, if the URL doesn't end in one"),
          fileUnit: z.enum(["mm", "cm", "in"]).optional(),
          metadata: fileMetadataSchema.optional(),
        },
        _meta: { "openai/fileParams": ["file"] },
      },
      async ({ file, url, filename, fileUnit, metadata }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const source = file?.download_url ?? url;
          if (!source) {
            return errorResult({
              code: "missing_file",
              message:
                "No file reached Materialize. Ask the user to attach the model again, or pass a public https URL as `url`.",
              retryable: true,
            });
          }
          const result = await importModelFromUrlForUser({
            userId: auth.userId,
            url: source,
            filename: filename ?? file?.file_name,
            fileUnit,
            metadata,
          });
          if ("error" in result) {
            return errorResult({ code: "import_failed", message: result.error });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_import_model");
        }
      }
    );

    server.registerTool(
      "materialize_update_file",
      {
        title: "Update a file listing's metadata",
        description:
          "Edit a file the user owns — change name, description, license, price, tags, recommended material, visibility. Pass only the fields you want to update.",
        inputSchema: {
          fileId: z.string().uuid(),
          metadata: fileMetadataSchema,
        },
      },
      async ({ fileId, metadata }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await updateFileForUser({
            userId: auth.userId,
            fileId,
            metadata,
          });
          if ("error" in result) {
            return errorResult({
              code: "update_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_update_file");
        }
      }
    );

    server.registerTool(
      "materialize_list_files",
      {
        title: "List your uploaded models",
        description:
          "Returns the agent's user's uploaded fileAssets — one entry per registered model. Newest first.",
        inputSchema: {},
      },
      async (_args, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:read");
          const files = await listFilesForUser(auth.userId);
          return jsonResult({ files });
        } catch (err) {
          return scopeOrInternal(err, "materialize_list_files");
        }
      }
    );

    server.registerTool(
      "materialize_delete_file",
      {
        title: "Delete an uploaded model",
        description:
          "Delete a fileAsset (and its parent listing) from the user's library. Fails if the file is referenced by any print order; use the dashboard to handle those.",
        inputSchema: {
          fileAssetId: z.string().uuid(),
        },
      },
      async ({ fileAssetId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await deleteFileForUser({
            userId: auth.userId,
            fileAssetId,
          });
          if ("error" in result) {
            return errorResult({
              code: "delete_failed",
              message: result.error,
            });
          }
          return jsonResult({ deleted: true });
        } catch (err) {
          return scopeOrInternal(err, "materialize_delete_file");
        }
      }
    );

    /* -------------------- Photos (files + projects) -------------------- */

    server.registerTool(
      "materialize_request_photo_upload_url",
      {
        title: "Request a presigned upload URL for a photo",
        description:
          "Get a presigned R2 URL for a photo (JPG/PNG/WEBP/SVG, up to 20MB). After PUTting the bytes, pass the returned storageKey into materialize_add_file_photo or materialize_add_project_photo.",
        inputSchema: {
          filename: z.string().min(1),
          sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
          contentType: z.string().optional(),
        },
      },
      async ({ filename, sizeBytes, contentType }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await requestPhotoUploadUrlForUser({
            userId: auth.userId,
            filename,
            sizeBytes,
            contentType,
          });
          if ("error" in result) {
            return errorResult({
              code: "invalid_input",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_request_photo_upload_url");
        }
      }
    );

    server.registerTool(
      "materialize_add_file_photo",
      {
        title: "Attach a curator photo to a file",
        description:
          "Adds an already-uploaded photo (use materialize_request_photo_upload_url first) to a file's curator gallery. Owner-only.",
        inputSchema: {
          fileId: z.string().uuid(),
          storageKey: z.string().min(1),
          caption: z.string().max(500).optional(),
        },
      },
      async ({ fileId, storageKey, caption }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await addFilePhotoForUser({
            userId: auth.userId,
            fileId,
            storageKey,
            caption,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_photo_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_file_photo");
        }
      }
    );

    server.registerTool(
      "materialize_set_file_cover_photo",
      {
        title: "Set a file's cover photo",
        description:
          "Pick one of the file's curator photos to serve as the cover image (shown on cards, profile, OG previews). Pass photoId=null to revert to the auto-captured 3D thumbnail.",
        inputSchema: {
          fileId: z.string().uuid(),
          photoId: z.string().uuid().nullable(),
        },
      },
      async ({ fileId, photoId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "files:write");
          const result = await setFileCoverPhotoForUser({
            userId: auth.userId,
            fileId,
            photoId,
          });
          if ("error" in result) {
            return errorResult({
              code: "set_cover_failed",
              message: result.error,
            });
          }
          return jsonResult({ ok: true });
        } catch (err) {
          return scopeOrInternal(err, "materialize_set_file_cover_photo");
        }
      }
    );

    /* -------------------- Projects -------------------- */

    const projectMetadataSchema = z.object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      buildGuide: z
        .string()
        .max(50_000)
        .nullable()
        .optional()
        .describe(
          "Long-form markdown build guide (steps, photos, code). Distinct from `description`. Embed images with materialize_add_project_inline_image, which returns a ready-to-paste `![](…)` snippet. Pass null to clear."
        ),
      priceCents: z.number().int().min(0).optional(),
      license: z.enum(LICENSE_ENUM_VALUES).optional(),
      visibility: z.enum(["public", "private"]).optional(),
      tags: z.array(z.string().min(1).max(32)).max(20).optional(),
      repoUrl: z.string().url().max(500).nullable().optional(),
    });

    server.registerTool(
      "materialize_create_project",
      {
        title: "Create a project, optionally bundling files",
        description:
          "Create a project, optionally bundling N existing files the agent owns. Files are optional: pass none for a project with no 3D-printable parts (boards, wiring, code) and attach an enclosure later. Projects can carry a build guide (long-form markdown how-to), a BOM, wiring diagrams, a firmware repo URL, and curator photos — set those at create time or via the followup tools (materialize_update_project, materialize_set_project_bom, materialize_add_project_circuit_*, materialize_add_project_photo, materialize_add_project_inline_image).",
        inputSchema: {
          name: z.string().min(1).max(200),
          fileIds: z.array(z.string().uuid()).max(50).optional(),
          description: z.string().max(5000).nullable().optional(),
          buildGuide: z
            .string()
            .max(50_000)
            .nullable()
            .optional()
            .describe(
              "Long-form markdown build guide (steps, photos, code). Distinct from `description`. Embed images with materialize_add_project_inline_image."
            ),
          priceCents: z.number().int().min(0).optional(),
          license: z.enum(LICENSE_ENUM_VALUES).optional(),
          visibility: z.enum(["public", "private"]).optional(),
          tags: z.array(z.string().min(1).max(32)).max(20).optional(),
          repoUrl: z
            .string()
            .url()
            .max(500)
            .nullable()
            .optional()
            .describe(
              "Optional firmware / source repo URL. Surfaces as a 'View code' button on the project page."
            ),
        },
      },
      async (input, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await createProjectForUser({
            userId: auth.userId,
            ...input,
          });
          if ("error" in result) {
            return errorResult({
              code: "create_project_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_create_project");
        }
      }
    );

    server.registerTool(
      "materialize_list_projects",
      {
        title: "List your projects",
        description:
          "Returns projects owned by the agent's user, newest first. Default limit 100.",
        inputSchema: {
          limit: z.number().int().min(1).max(200).optional(),
        },
      },
      async ({ limit }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:read");
          const projects = await listProjectsForUser(auth.userId, limit ?? 100);
          return jsonResult({ projects });
        } catch (err) {
          return scopeOrInternal(err, "materialize_list_projects");
        }
      }
    );

    server.registerTool(
      "materialize_get_project",
      {
        title: "Get a project's full detail",
        description:
          "Returns project metadata, bundled files, BOM line items, circuit diagrams (image / KiCad / Wokwi), and the repo URL.",
        inputSchema: { projectId: z.string().uuid() },
      },
      async ({ projectId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:read");
          const result = await getProjectForUser({
            userId: auth.userId,
            projectId,
          });
          if ("error" in result) {
            return errorResult({
              code: "not_found",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_get_project");
        }
      }
    );

    server.registerTool(
      "materialize_update_project",
      {
        title: "Update a project's metadata",
        description:
          "Edit name, description, build guide, license, price, tags, visibility, or the firmware repo URL. Pass only the fields you want to update.",
        inputSchema: {
          projectId: z.string().uuid(),
          metadata: projectMetadataSchema,
        },
      },
      async ({ projectId, metadata }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await updateProjectForUser({
            userId: auth.userId,
            projectId,
            metadata,
          });
          if ("error" in result) {
            return errorResult({
              code: "update_project_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_update_project");
        }
      }
    );

    server.registerTool(
      "materialize_delete_project",
      {
        title: "Delete a project",
        description:
          "Delete a project and its BOM + circuit diagrams + project-photos. The bundled files themselves are not deleted.",
        inputSchema: { projectId: z.string().uuid() },
      },
      async ({ projectId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await deleteProjectForUser({
            userId: auth.userId,
            projectId,
          });
          if ("error" in result) {
            return errorResult({
              code: "delete_project_failed",
              message: result.error,
            });
          }
          return jsonResult({ deleted: true });
        } catch (err) {
          return scopeOrInternal(err, "materialize_delete_project");
        }
      }
    );

    server.registerTool(
      "materialize_set_project_bom",
      {
        title: "Replace a project's Bill of Materials",
        description:
          "Bulk-replace the BOM line items on a project. Items list the parts a builder needs beyond the printed model (screws, electronics, magnets, wire, etc.). Pass an empty array to clear the BOM.",
        inputSchema: {
          projectId: z.string().uuid(),
          items: z
            .array(
              z.object({
                name: z.string().min(1).max(200),
                quantity: z.number().positive(),
                unit: z.string().max(32).nullable().optional(),
                notes: z.string().max(500).nullable().optional(),
                sourceUrl: z.string().url().max(500).nullable().optional(),
              })
            )
            .max(200),
        },
      },
      async ({ projectId, items }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await setProjectBomForUser({
            userId: auth.userId,
            projectId,
            items,
          });
          if ("error" in result) {
            return errorResult({
              code: "set_bom_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_set_project_bom");
        }
      }
    );

    /* -------------------- Project circuits / wiring -------------------- */

    server.registerTool(
      "materialize_request_circuit_upload_url",
      {
        title: "Request a presigned upload URL for a wiring diagram",
        description:
          "Get a presigned R2 URL for a circuit asset. Accepts image diagrams (JPG/PNG/WEBP/SVG) or KiCad source files (.kicad_sch / .kicad_pcb / .kicad_pro), up to 20MB. After PUT, call materialize_add_project_circuit_image or materialize_add_project_circuit_kicad with the storageKey.",
        inputSchema: {
          filename: z.string().min(1),
          sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024),
          contentType: z.string().optional(),
        },
      },
      async ({ filename, sizeBytes, contentType }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await requestCircuitUploadUrlForUser({
            userId: auth.userId,
            filename,
            sizeBytes,
            contentType,
          });
          if ("error" in result) {
            return errorResult({
              code: "invalid_input",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_request_circuit_upload_url");
        }
      }
    );

    server.registerTool(
      "materialize_add_project_circuit_image",
      {
        title: "Attach an image wiring diagram to a project",
        description:
          "Add an already-uploaded image (JPG/PNG/WEBP/SVG) as a circuit / wiring diagram on the project. Use materialize_request_circuit_upload_url first to get a storageKey.",
        inputSchema: {
          projectId: z.string().uuid(),
          storageKey: z.string().min(1),
          originalFilename: z.string().max(200).optional(),
          caption: z.string().max(500).optional(),
        },
      },
      async (
        { projectId, storageKey, originalFilename, caption },
        extra
      ) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await addProjectCircuitImageForUser({
            userId: auth.userId,
            projectId,
            storageKey,
            originalFilename,
            caption,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_circuit_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_project_circuit_image");
        }
      }
    );

    server.registerTool(
      "materialize_add_project_circuit_kicad",
      {
        title: "Attach a KiCad source file to a project",
        description:
          "Add an already-uploaded .kicad_sch or .kicad_pcb file as a circuit on the project. The lightbox on the project page renders these live via KiCanvas. Use materialize_request_circuit_upload_url first.",
        inputSchema: {
          projectId: z.string().uuid(),
          storageKey: z.string().min(1),
          kind: z.enum(["kicad_sch", "kicad_pcb"]),
          originalFilename: z.string().min(1).max(200),
          caption: z.string().max(500).optional(),
        },
      },
      async (
        { projectId, storageKey, kind, originalFilename, caption },
        extra
      ) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await addProjectCircuitKicadForUser({
            userId: auth.userId,
            projectId,
            storageKey,
            kind,
            originalFilename,
            caption,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_circuit_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_project_circuit_kicad");
        }
      }
    );

    server.registerTool(
      "materialize_add_project_circuit_wokwi",
      {
        title: "Embed a Wokwi simulation into a project",
        description:
          "Attach a wokwi.com project URL as an interactive circuit embed. No upload needed — Wokwi hosts the sketch; we just iframe it from the project page.",
        inputSchema: {
          projectId: z.string().uuid(),
          url: z
            .string()
            .url()
            .describe("Public Wokwi URL, e.g. https://wokwi.com/projects/123456789"),
          caption: z.string().max(500).optional(),
        },
      },
      async ({ projectId, url, caption }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await addProjectCircuitWokwiForUser({
            userId: auth.userId,
            projectId,
            url,
            caption,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_circuit_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_project_circuit_wokwi");
        }
      }
    );

    server.registerTool(
      "materialize_delete_project_circuit",
      {
        title: "Remove a circuit / diagram from a project",
        description:
          "Delete a circuit row by id. R2 cleanup is best-effort.",
        inputSchema: { circuitId: z.string().uuid() },
      },
      async ({ circuitId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await deleteProjectCircuitForUser({
            userId: auth.userId,
            circuitId,
          });
          if ("error" in result) {
            return errorResult({
              code: "delete_circuit_failed",
              message: result.error,
            });
          }
          return jsonResult({ deleted: true });
        } catch (err) {
          return scopeOrInternal(err, "materialize_delete_project_circuit");
        }
      }
    );

    /* -------------------- Project photos -------------------- */

    server.registerTool(
      "materialize_add_project_photo",
      {
        title: "Attach a curator photo to a project",
        description:
          "Adds an already-uploaded photo (use materialize_request_photo_upload_url first) to the project's curator gallery. Owner-only.",
        inputSchema: {
          projectId: z.string().uuid(),
          storageKey: z.string().min(1),
          caption: z.string().max(500).optional(),
        },
      },
      async ({ projectId, storageKey, caption }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await addProjectPhotoForUser({
            userId: auth.userId,
            projectId,
            storageKey,
            caption,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_photo_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_project_photo");
        }
      }
    );

    server.registerTool(
      "materialize_add_project_inline_image",
      {
        title: "Register an inline image for a project's build guide",
        description:
          "Register an already-uploaded image (use materialize_request_photo_upload_url first to PUT the bytes and get a storageKey) as an inline build-guide image. Returns a ready-to-paste markdown `![](…)` snippet whose URL re-signs on every load (never expires). Splice the snippet into the build guide markdown, then save it via materialize_update_project. Unlike materialize_add_project_photo, the image does NOT appear in the curator gallery. Owner-only.",
        inputSchema: {
          projectId: z.string().uuid(),
          storageKey: z.string().min(1),
        },
      },
      async ({ projectId, storageKey }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await addProjectInlineImageForUser({
            userId: auth.userId,
            projectId,
            storageKey,
          });
          if ("error" in result) {
            return errorResult({
              code: "add_inline_image_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_add_project_inline_image");
        }
      }
    );

    server.registerTool(
      "materialize_set_project_cover_photo",
      {
        title: "Set a project's cover photo",
        description:
          "Pick one of the project's curator photos as the cover image. Pass photoId=null to revert to the legacy thumbnailUrl.",
        inputSchema: {
          projectId: z.string().uuid(),
          photoId: z.string().uuid().nullable(),
        },
      },
      async ({ projectId, photoId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "projects:write");
          const result = await setProjectCoverPhotoForUser({
            userId: auth.userId,
            projectId,
            photoId,
          });
          if ("error" in result) {
            return errorResult({
              code: "set_cover_failed",
              message: result.error,
            });
          }
          return jsonResult({ ok: true });
        } catch (err) {
          return scopeOrInternal(err, "materialize_set_project_cover_photo");
        }
      }
    );

    /* -------------------- Quotes -------------------- */

    server.registerTool(
      "materialize_get_quote",
      {
        title: "Get prices for a print",
        description:
          "Server-side polls CraftCloud for prices on a registered fileAsset. Returns quotes sorted by what the buyer pays, with vendor, finish, color, lead time. `lead` names the option to recommend first: the cheapest industrial print (SLS, MJF, SLA…) when it costs at most twice the cheapest, with the cheaper FDM print as its `alternative`; otherwise the cheapest, with industrial as the upgrade. Present it the same way. totalCents is the price to tell the user: production x quantity, plus the vendor's minimum-order top-up (minimumFeeCents), shipping, and Materialize's service fee (serviceFeeCents). priceCents is the per-unit production price only; never present it as the price. Pass the returned priceId/quoteId/materialConfigId/shippingId and the per-unit priceCents as materialPriceCents into materialize_create_order. Quotes and orders are USD-only for now. Shipping is priced per destination country (a ZIP code doesn't change it). Where the host shows Materialize's quote card (ChatGPT, Claude), the card already lists the prices and compares the options: don't repeat them in a table, give a sentence or two of advice instead.",
        _meta: widgetToolMeta(QUOTE_WIDGET_URI, {
          invoking: "Getting live quotes…",
          invoked: "Quotes ready",
        }),
        inputSchema: {
          fileAssetId: z.string().uuid(),
          materialId: z
            .string()
            .optional()
            .describe(
              "Narrow to a specific material UUID (from materialize_list_materials) — much faster than getting all quotes."
            ),
          materialIds: z
            .array(z.string())
            .min(1)
            .max(8)
            .optional()
            .describe(
              "Quote several materials in one call, e.g. every nylon (FDM nylon, SLS PA12, MJF PA12) or the user's shortlist. Prefer this to one call per material: the user gets one comparison instead of several separate cards."
            ),
          countryCode: z
            .string()
            .length(2)
            .optional()
            .describe("ISO 3166-1 alpha-2 destination country, default US"),
          quantity: z.number().int().min(1).max(100).optional(),
        },
      },
      async (
        { fileAssetId, materialId, materialIds, countryCode, quantity },
        extra
      ) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "quotes:read");
          const result = await getQuoteForUser({
            userId: auth.userId,
            fileAssetId,
            materialId,
            materialIds,
            currency: "USD",
            countryCode,
            quantity,
          });
          if ("error" in result) {
            return errorResult({
              code: "quote_failed",
              message: result.error,
              retryable: true,
            });
          }
          // The widget's 3D view; best-effort, the card renders without it.
          let model: Awaited<ReturnType<typeof widgetModelLink>> | null = null;
          try {
            model = await widgetModelLink(result.part.fileAssetId, result.part.format);
          } catch (err) {
            logError("mcp.quote.widgetModelLink", err);
          }
          return cardResult({ ...result, part: { ...result.part, model } }, extra,
            "The user is looking at these quotes in Materialize's quote card: the part in 3D, the recommended option's price breakdown and arrival dates, and a comparison of every option. Reply in one or two sentences of advice. Don't restate the prices, list the options in a table, or describe the materials again. Shipping is priced for the destination country and doesn't depend on the ZIP code, so don't caveat ZIP-specific rates."
          );
        } catch (err) {
          return scopeOrInternal(err, "materialize_get_quote");
        }
      }
    );

    /* -------------------- Orders -------------------- */

    server.registerTool(
      "materialize_create_order",
      {
        title: "Create a draft print order (requires user confirmation)",
        description:
          "Creates a draft order against the user's account. The user is notified by email and must approve and pay via the returned confirmationUrl before the order is placed with the vendor. The response's amountDueCents is what the user will pay, broken down as productionCents + minimumFeeCents (the vendor's minimum-order top-up) + shippingCents + serviceFeeCents; tell the user that amount, and explain minimumFeeCents if it's above zero. USD only. Idempotency is keyed on (user, idempotencyKey).",
        inputSchema: {
          priceId: z
            .string()
            .min(1)
            .describe(
              "The priceId returned alongside this quote by materialize_get_quote — required so the server can re-verify the price against CraftCloud before charging."
            ),
          quoteId: z.string().min(1),
          fileAssetId: z.string().uuid(),
          vendorId: z.string().min(1),
          vendorName: z.string().optional(),
          materialConfigId: z.string().min(1),
          shippingId: z.string().min(1),
          quantity: z.number().int().min(1).max(100).default(1),
          materialPriceCents: z.number().int().min(1),
          shippingPriceCents: z.number().int().min(0),
          shippingAddress: z.object({
            email: z
              .string()
              .email()
              .optional()
              .describe(
                "Where order emails go. Omit to use the signed-in account's email; only ask the user if they want a different one."
              ),
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            address: z.string().min(1),
            addressLine2: z.string().optional(),
            city: z.string().min(1),
            zipCode: z.string().min(1),
            stateCode: z.string().optional(),
            countryCode: z.string().length(2),
            phoneNumber: shippingPhoneSchema.describe(
              "Recipient phone number. Required: the manufacturer rejects orders without one."
            ),
          }),
          idempotencyKey: z
            .string()
            .min(8)
            .max(128)
            .describe(
              "Agent-supplied key for retry safety. Same key + same input within 24h returns the original orderId."
            ),
        },
      },
      async (input, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "orders:create");
          const email =
            input.shippingAddress.email ?? (await accountEmail(auth.userId));
          if (!email) {
            return errorResult({
              code: "email_required",
              message:
                "This account has no email address on file. Ask the user for one and pass shippingAddress.email.",
            });
          }
          const result = await createAgentInitiatedOrder({
            userId: auth.userId,
            initiatedByTokenId: auth.tokenId,
            agentName: auth.tokenName,
            idempotencyKey: input.idempotencyKey,
            fileAssetId: input.fileAssetId,
            priceId: input.priceId,
            quoteId: input.quoteId,
            vendorId: input.vendorId,
            vendorName: input.vendorName,
            materialConfigId: input.materialConfigId,
            shippingId: input.shippingId,
            quantity: input.quantity,
            materialPriceCents: input.materialPriceCents,
            shippingPriceCents: input.shippingPriceCents,
            currency: "USD",
            shippingAddress: { ...input.shippingAddress, email },
          });
          if ("error" in result) {
            return errorResult({
              code: "order_failed",
              message: result.error,
            });
          }
          const appUrl = await deriveAppUrl();
          const confirmationUrl = `${appUrl}/orders/${result.orderId}/confirm?token=${result.confirmationToken}`;
          const emailResult = await sendOrderConfirmationEmail({
            orderId: result.orderId,
            appUrl,
          });

          if (result.path === "auto_approved") {
            return jsonResult({
              orderId: result.orderId,
              status: "auto_approved",
              terminal: false,
              chargedAt: new Date().toISOString(),
              cancellationDeadline: result.cancellationDeadline,
              ...priceFields(result),
              currency: "USD",
              remainingPeriodBudgetCents: result.remainingPeriodBudgetCents,
              notificationsSent: { email: emailResult.ok, push: false },
              ...(emailResult.ok
                ? {}
                : {
                    warnings: [
                      `Notification email failed to send (${emailResult.error}). The user can still cancel via their dashboard.`,
                    ],
                  }),
            });
          }

          return jsonResult({
            orderId: result.orderId,
            status: "awaiting_user_approval",
            terminal: false,
            confirmationUrl,
            expiresAt: result.confirmationExpiresAt,
            ...priceFields(result),
            currency: "USD",
            ...(result.fallbackReason
              ? { reason: result.fallbackReason }
              : {}),
            notificationsSent: { email: emailResult.ok, push: false },
            ...(emailResult.ok
              ? {}
              : {
                  warnings: [
                    `Confirmation email failed to send (${emailResult.error}). The user can still confirm via the URL above.`,
                  ],
                }),
          });
        } catch (err) {
          return scopeOrInternal(err, "materialize_create_order");
        }
      }
    );

    server.registerTool(
      "materialize_get_order",
      {
        title: "Get a print order by id",
        description:
          "Returns the current status, vendor, material, price breakdown, and tracking (if shipped) for an order owned by the user.",
        inputSchema: { orderId: z.string().uuid() },
      },
      async ({ orderId }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "orders:read");
          const result = await getOrderForUser({
            userId: auth.userId,
            orderId,
          });
          if ("error" in result) {
            return errorResult({
              code: "not_found",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err, "materialize_get_order");
        }
      }
    );

    server.registerTool(
      "materialize_list_orders",
      {
        title: "List recent print orders",
        description:
          "Returns recent orders owned by the user, newest first. Default limit 25, max 100.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ limit }, extra) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "orders:read");
          const orders = await listOrdersForUser({
            userId: auth.userId,
            limit,
          });
          return jsonResult({ orders });
        } catch (err) {
          return scopeOrInternal(err, "materialize_list_orders");
        }
      }
    );

    await hideUnavailableTools(tools);
  },
  {
    serverInfo: {
      name: "materialize",
      version: "0.1.0",
    },
    // Server-wide guidance every MCP client gets at initialize, so a host
    // without the skill installed still learns the flow and the one rule
    // that matters. Keep it short; per-tool detail lives in descriptions.
    instructions: MCP_SERVER_INSTRUCTIONS,
  },
  {
    basePath: "/api",
    // 300 (was 60): materialize_cad_run / _save execute real geometry, and a
    // fine-pitch organic part can take tens of seconds on the sidecar.
    maxDuration: 300,
    verboseLogs: false,
    disableSse: true,
    sessionIdGenerator: undefined,
  }
);

const verifiedHandler = withMcpAuth(handler, verifyAndRecord, {
  required: true,
});

function authedHandler(req: Request) {
  return requestAuth.run({}, () => verifiedHandler(req));
}

/**
 * SEC-6 — the internal branch used to echo `err.message` straight
 * back to any PAT holder calling the tool. That leaks whatever a
 * thrown Error happens to say (DB driver text, stack-adjacent
 * details, etc.) to an external, only-scope-authenticated caller.
 * Now it returns a fixed, non-identifying message and routes the
 * real detail through `logError` (tagged per-tool via `context`) so
 * it's still fully diagnosable server-side. The MissingScopeError
 * branch is untouched — that message is deliberately actionable
 * ("this token lacks scope X") and safe to return as-is.
 */
/** scopeOrInternal, plus the CAD owner gate's own (safe, actionable) error. */
function cadOrInternal(err: unknown, context: string) {
  if (err instanceof CadAccessError) {
    return errorResult({ code: "forbidden", message: err.message });
  }
  return scopeOrInternal(err, context);
}

function scopeOrInternal(err: unknown, context: string) {
  if (err instanceof MissingScopeError) {
    return errorResult({
      code: "invalid_scope",
      message: err.message,
    });
  }
  logError(`mcp.tool.${context}`, err);
  return errorResult({
    code: "internal",
    message: "Internal error",
    retryable: true,
  });
}

export {
  authedHandler as GET,
  authedHandler as POST,
  authedHandler as DELETE,
};
