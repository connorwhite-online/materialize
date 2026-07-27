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
  updateFileForUser,
  addFilePhotoForUser,
  setFileCoverPhotoForUser,
  requestPhotoUploadUrlForUser,
  requestCircuitUploadUrlForUser,
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
import { getQuoteForUser } from "@/lib/mcp/internal/quotes";
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
        title: "Create a project bundling one or more files",
        description:
          "Create a project that bundles N existing files the agent owns. Projects can carry a build guide (long-form markdown how-to), a BOM, wiring diagrams, a firmware repo URL, and curator photos — set those at create time or via the followup tools (materialize_update_project, materialize_set_project_bom, materialize_add_project_circuit_*, materialize_add_project_photo, materialize_add_project_inline_image).",
        inputSchema: {
          name: z.string().min(1).max(200),
          fileIds: z.array(z.string().uuid()).min(1).max(50),
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
          "Creates a draft order against the user's account. The user is notified by email and must approve and pay via the returned confirmationUrl before the order is placed with the vendor. USD only. Idempotency is keyed on (user, idempotencyKey).",
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
            shippingAddress: input.shippingAddress,
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
