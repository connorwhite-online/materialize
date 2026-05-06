/**
 * Full agent-readable catalog dump. Pairs with /llms.txt — that one
 * is a short summary; this one is the structured corpus an agent can
 * grep for material names + properties without needing JSON.
 */

import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

export async function GET() {
  const catalog = await getCraftCloudCatalog();
  const lines: string[] = [];
  lines.push("# Materialize — full catalog dump");
  lines.push("");
  lines.push(
    `Generated for agents. Each material has a CraftCloud id (UUID) usable in the MCP \`materialize_get_quote\` tool's \`materialId\` parameter.`
  );
  lines.push("");
  lines.push(`MCP endpoint: ${APP_URL}/api/mcp`);
  lines.push("");

  for (const group of catalog.groups) {
    lines.push(`## ${group.name}`);
    lines.push("");
    for (const m of group.materials) {
      lines.push(`### ${m.name}`);
      lines.push("");
      lines.push(`- id: ${m.id}`);
      lines.push(`- slug: ${m.slug}`);
      if (m.descriptionShort) {
        lines.push(`- summary: ${m.descriptionShort}`);
      }
      const props: string[] = [];
      if (m.tensileStrengthMax != null)
        props.push(`tensile strength up to ${m.tensileStrengthMax} MPa`);
      if (m.density != null) props.push(`density ${m.density} g/cm³`);
      if (m.heatDeflectionTemp66PSIMax != null)
        props.push(
          `heat deflection ${m.heatDeflectionTemp66PSIMax}°C @ 66 PSI`
        );
      if (m.maximumPrintingDimensions) {
        const [x, y, z] = m.maximumPrintingDimensions;
        props.push(`max build volume ${x}×${y}×${z} mm`);
      }
      if (m.warpingRisk) props.push(`warping risk: ${m.warpingRisk}`);
      if (props.length) lines.push(`- properties: ${props.join("; ")}`);
      const finishes = (m.finishGroups ?? []).map((fg) => fg.name);
      if (finishes.length)
        lines.push(`- finishes: ${finishes.join(", ")}`);
      lines.push("");
    }
  }

  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
