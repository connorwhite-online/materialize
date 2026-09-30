import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool annotations for every tool on the server, in one table.
 *
 * Hosts act on these: ChatGPT asks the user before a tool that isn't
 * `readOnlyHint`, and app review checks that each hint is accurate (a
 * write marked read-only, or a delete not marked destructive, is a
 * rejection). Claude uses the same hints for its permission prompts.
 *
 * - readOnlyHint: changes nothing anywhere.
 * - destructiveHint: can delete or overwrite something the user made.
 *   Replacing fields in place (update_*, set_project_bom) counts.
 * - idempotentHint: repeating the same call has no further effect.
 * - openWorldHint: reaches outside Materialize (CraftCloud quotes and
 *   orders). Everything else only touches the user's own account.
 *
 * `annotateTools` (route.ts) refuses to register a tool missing from
 * this table, so a new tool can't ship unannotated.
 */
const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const OVERWRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
const DELETE: ToolAnnotations = OVERWRITE;

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // CAD. A run executes on our sidecar and saves nothing.
  materialize_cad_reference: READ,
  materialize_cad_run: READ,
  materialize_cad_save: CREATE,

  // Catalog
  materialize_list_materials: READ,
  materialize_get_material: READ,

  // Files. Presigning mints a URL and writes no row.
  materialize_request_upload_url: { ...CREATE, idempotentHint: true },
  materialize_register_upload: CREATE,
  materialize_update_file: OVERWRITE,
  materialize_list_files: READ,
  materialize_delete_file: DELETE,

  // Photos
  materialize_request_photo_upload_url: { ...CREATE, idempotentHint: true },
  materialize_add_file_photo: CREATE,
  materialize_set_file_cover_photo: { ...CREATE, idempotentHint: true },

  // Projects
  materialize_create_project: CREATE,
  materialize_list_projects: READ,
  materialize_get_project: READ,
  materialize_update_project: OVERWRITE,
  materialize_delete_project: DELETE,
  materialize_set_project_bom: OVERWRITE,
  materialize_request_circuit_upload_url: { ...CREATE, idempotentHint: true },
  materialize_add_project_circuit_image: CREATE,
  materialize_add_project_circuit_kicad: CREATE,
  materialize_add_project_circuit_wokwi: CREATE,
  materialize_delete_project_circuit: DELETE,
  materialize_add_project_photo: CREATE,
  materialize_add_project_inline_image: CREATE,
  materialize_set_project_cover_photo: { ...CREATE, idempotentHint: true },

  // Quotes and orders reach CraftCloud.
  materialize_get_quote: { ...READ, openWorldHint: true },
  // A draft the user confirms and pays for on the web, unless their
  // spending policy auto-approves it. The idempotencyKey makes a retry
  // return the same order.
  materialize_create_order: { ...CREATE, idempotentHint: true, openWorldHint: true },
  materialize_get_order: READ,
  materialize_list_orders: READ,
};
