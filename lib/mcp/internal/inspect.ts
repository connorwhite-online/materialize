import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { widgetModelLink } from "@/lib/mcp/widgets";
import { checkPrintabilityForUser } from "./printability";

/** Formats the widget's browser loaders can read (STEP/AMF can't be shown). */
const VIEWABLE = new Set(["stl", "obj", "3mf"]);
const MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, in: 25.4 };

export const MAX_INSPECT_PARTS = 8;

export interface InspectResult {
  kind: "inspect";
  title: string;
  parts: Array<{
    fileAssetId: string;
    name: string;
    format: string;
    /** Millimetres per file unit, so the view measures in mm. */
    scale: number;
    url: string;
  }>;
  geometry: {
    sizeMm: { x: number; y: number; z: number } | null;
    volumeCm3: number | null;
    thinnestWallMm: number | null;
    watertight: boolean | null;
    shells: number | null;
  };
  issues: Array<{ part: string; severity: string; message: string; fix: string }>;
  printable: boolean;
}

/**
 * Everything the inspector widget needs for one model or the parts of an
 * assembly: a signed link per part plus the printability facts. Access is
 * the printability check's own (owner, or a published file), run per
 * part, so the view never shows something the caller couldn't check.
 */
export async function inspectModelForUser(input: {
  userId: string;
  fileAssetIds: string[];
  title?: string;
}): Promise<InspectResult | { error: string }> {
  const ids = [...new Set(input.fileAssetIds)].slice(0, MAX_INSPECT_PARTS);
  const rows = await db
    .select({
      id: fileAssets.id,
      format: fileAssets.format,
      unit: fileAssets.fileUnit,
      filename: fileAssets.originalFilename,
      fileName: files.name,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(inArray(fileAssets.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const checks = await Promise.all(
    ids.map((id) => checkPrintabilityForUser({ userId: input.userId, fileAssetId: id }))
  );

  const parts: InspectResult["parts"] = [];
  const issues: InspectResult["issues"] = [];
  let printable = true;
  for (let i = 0; i < ids.length; i++) {
    const row = byId.get(ids[i]);
    const check = checks[i];
    if (!row) return { error: `File not found: ${ids[i]}` };
    if ("error" in check && check.error === "Forbidden") return { error: "Forbidden" };
    if (!VIEWABLE.has(row.format)) {
      return {
        error: `${row.filename} is ${row.format.toUpperCase()}, which the inspector can't display. Export an STL, 3MF or OBJ.`,
      };
    }
    const name = row.fileName || row.filename;
    const link = await widgetModelLink(row.id, row.format);
    parts.push({
      fileAssetId: row.id,
      name,
      format: row.format,
      scale: MM_PER_UNIT[row.unit] ?? 1,
      url: link.url,
    });
    if (!("error" in check)) {
      if (!check.printable) printable = false;
      for (const issue of check.issues) {
        issues.push({ part: name, severity: issue.severity, message: ids.length > 1 ? `${name}: ${issue.message}` : issue.message, fix: issue.fix });
      }
    }
  }

  // Size and walls are per file; an assembly shows its parts' issues only.
  const single = ids.length === 1 && !("error" in checks[0]) ? checks[0] : null;
  return {
    kind: "inspect",
    title: input.title || (parts.length === 1 ? parts[0].name : `${parts.length} parts`),
    parts,
    geometry: {
      sizeMm: single?.geometry.sizeMm ?? null,
      volumeCm3: single?.geometry.volumeCm3 ?? null,
      thinnestWallMm: single?.geometry.wallThickness?.thinnestMm ?? null,
      watertight: single?.geometry.watertight ?? null,
      shells: single?.geometry.shells ?? null,
    },
    issues,
    printable,
  };
}
