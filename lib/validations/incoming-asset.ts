/**
 * Shape of a client-uploaded asset before it's persisted to the
 * DB. The client PUTs the file to R2 via a presigned URL, then
 * POSTs this descriptor (serialized as `assetsJson` on the form)
 * to createFileListing / createDraftFileForPrint so the server
 * can insert a fileAssets row that points at the R2 key.
 *
 * Kept outside app/actions/files.ts because "use server" files
 * can only export async functions, and we want a plain type
 * guard callable from tests.
 */
export type IncomingAsset = {
  storageKey: string;
  originalFilename: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileSize: number;
  fileUnit?: "mm" | "cm" | "in";
};

const VALID_FORMATS = new Set(["stl", "obj", "3mf", "step", "amf"]);
const VALID_UNITS = new Set(["mm", "cm", "in"]);

/**
 * Runtime type guard for an IncomingAsset row. JSON.parse returns
 * `unknown` — this validates the shape before we trust it.
 */
export function isIncomingAsset(v: unknown): v is IncomingAsset {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.storageKey === "string" &&
    a.storageKey.length > 0 &&
    typeof a.originalFilename === "string" &&
    a.originalFilename.length > 0 &&
    typeof a.format === "string" &&
    VALID_FORMATS.has(a.format) &&
    typeof a.fileSize === "number" &&
    Number.isFinite(a.fileSize) &&
    a.fileSize > 0 &&
    (a.fileUnit === undefined ||
      (typeof a.fileUnit === "string" && VALID_UNITS.has(a.fileUnit)))
  );
}
