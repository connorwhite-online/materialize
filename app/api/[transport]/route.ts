import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  verifyMaterializeToken,
  requireScope,
  MissingScopeError,
  type MaterializeAuthExtra,
} from "@/lib/mcp/auth";
import {
  getCraftCloudCatalog,
  findMaterialBySlug,
} from "@/lib/craftcloud/catalog";
import {
  requestUploadUrlForUser,
  registerUploadForUser,
  listFilesForUser,
  deleteFileForUser,
} from "@/lib/mcp/internal/files";
import { getQuoteForUser } from "@/lib/mcp/internal/quotes";
import {
  createAgentInitiatedOrder,
  getOrderForUser,
  listOrdersForUser,
} from "@/lib/mcp/internal/orders";
import { sendOrderConfirmationEmail } from "@/lib/mcp/email";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * Convert any tool result into the MCP shape. We always return a
 * single text block whose body is JSON so agents can parse a stable
 * structure without needing schema-by-schema content typing.
 */
function jsonResult(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
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

const handler = createMcpHandler(
  (server) => {
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
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
        }
      }
    );

    server.registerTool(
      "materialize_register_upload",
      {
        title: "Register an uploaded model",
        description:
          "After PUTting the file to the URL returned by materialize_request_upload_url, register the upload to receive a fileAssetId. The CraftCloud model upload runs in the background; you may need to wait a few seconds before quoting.",
        inputSchema: {
          storageKey: z.string().min(1),
          originalFilename: z.string().min(1),
          format: z.enum(["stl", "obj", "3mf", "step", "amf"]),
          fileSize: z.number().int().min(1),
          fileUnit: z.enum(["mm", "cm", "in"]).optional(),
        },
      },
      async (
        { storageKey, originalFilename, format, fileSize, fileUnit },
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
          });
          if ("error" in result) {
            return errorResult({
              code: "register_failed",
              message: result.error,
            });
          }
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
        }
      }
    );

    /* -------------------- Quotes -------------------- */

    server.registerTool(
      "materialize_get_quote",
      {
        title: "Get prices for a print",
        description:
          "Server-side polls CraftCloud for prices on a registered fileAsset. Returns sorted (cheapest first) quotes with vendor, finish, color, lead time. Pass the returned priceId/quoteId/materialConfigId/shippingId into materialize_create_order. Quotes and orders are USD-only for now.",
        inputSchema: {
          fileAssetId: z.string().uuid(),
          materialId: z
            .string()
            .optional()
            .describe(
              "Narrow to a specific material UUID (from materialize_list_materials) — much faster than getting all quotes."
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
        { fileAssetId, materialId, countryCode, quantity },
        extra
      ) => {
        try {
          const auth = readAuthExtra(extra);
          requireScope(auth, "quotes:read");
          const result = await getQuoteForUser({
            userId: auth.userId,
            fileAssetId,
            materialId,
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
          return jsonResult(result);
        } catch (err) {
          return scopeOrInternal(err);
        }
      }
    );

    /* -------------------- Orders -------------------- */

    server.registerTool(
      "materialize_create_order",
      {
        title: "Create a draft print order (requires user confirmation)",
        description:
          "Creates a draft order against the user's account. The user is notified by email and must approve and pay via the returned confirmationUrl before the order is placed with the vendor. USD only. Idempotency is keyed on (user, idempotencyKey).",
        inputSchema: {
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
            email: z.string().email(),
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            address: z.string().min(1),
            addressLine2: z.string().optional(),
            city: z.string().min(1),
            zipCode: z.string().min(1),
            stateCode: z.string().optional(),
            countryCode: z.string().length(2),
            phoneNumber: z.string().optional(),
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
          const result = await createAgentInitiatedOrder({
            userId: auth.userId,
            initiatedByTokenId: auth.tokenId,
            agentName: auth.tokenName,
            idempotencyKey: input.idempotencyKey,
            fileAssetId: input.fileAssetId,
            quoteId: input.quoteId,
            vendorId: input.vendorId,
            vendorName: input.vendorName,
            materialConfigId: input.materialConfigId,
            shippingId: input.shippingId,
            quantity: input.quantity,
            materialPriceCents: input.materialPriceCents,
            shippingPriceCents: input.shippingPriceCents,
            currency: "USD",
            shippingAddress: input.shippingAddress,
          });
          if ("error" in result) {
            return errorResult({
              code: "order_failed",
              message: result.error,
            });
          }
          const confirmationUrl = `${appUrl()}/orders/${result.orderId}/confirm?token=${result.confirmationToken}`;
          const emailResult = await sendOrderConfirmationEmail({
            orderId: result.orderId,
          });

          if (result.path === "auto_approved") {
            return jsonResult({
              orderId: result.orderId,
              status: "auto_approved",
              terminal: false,
              chargedAt: new Date().toISOString(),
              cancellationDeadline: result.cancellationDeadline,
              totalPriceCents: result.totalPriceCents,
              serviceFeeCents: result.serviceFeeCents,
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
            totalPriceCents: result.totalPriceCents,
            serviceFeeCents: result.serviceFeeCents,
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
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
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
          return scopeOrInternal(err);
        }
      }
    );
  },
  {
    serverInfo: {
      name: "materialize",
      version: "0.1.0",
    },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: false,
    disableSse: true,
    sessionIdGenerator: undefined,
  }
);

const authedHandler = withMcpAuth(handler, verifyMaterializeToken, {
  required: true,
});

function scopeOrInternal(err: unknown) {
  if (err instanceof MissingScopeError) {
    return errorResult({
      code: "invalid_scope",
      message: err.message,
    });
  }
  console.error("[mcp] tool error", err);
  return errorResult({
    code: "internal",
    message:
      err instanceof Error ? err.message : "Internal error",
    retryable: true,
  });
}

export {
  authedHandler as GET,
  authedHandler as POST,
  authedHandler as DELETE,
};
