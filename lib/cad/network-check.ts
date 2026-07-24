/**
 * Dual-fluid isolation verdict consumption (networks check, MTR-179).
 *
 * The sidecar runs `check_networks` whenever a script declares `fluid_ports`
 * (exchanger_core hands scripts the list ready-made) — no caller wiring, the
 * geometry author is the only one who knows where its circuits open. This
 * module turns the report into (a) a pass/fail the harness can spend a repair
 * turn on and (b) a diagnosis string specific enough for the model to act on,
 * mirroring how dimension-check.ts consumes `checks.fit`.
 */
import type { CadNetworksReport, CadRunResult } from "./types";

/** The networks report from a run, if the check ran at all. */
export function getNetworksReport(
  run: CadRunResult | undefined
): CadNetworksReport | undefined {
  return run?.checks?.networks ?? undefined;
}

/**
 * Human/model-readable diagnosis when the circuits failed verification, or
 * null when the report is missing (check never ran — not a failure; most
 * parts have no fluid circuits) or verified isolated.
 */
export function networksFailure(
  report: CadNetworksReport | null | undefined
): string | null {
  if (!report) return null;
  // Inconclusive = the probe couldn't resolve the declared walls at this
  // scale. NOT a failure: the geometry may be perfectly sound, so spending
  // repair turns (or showing a leak verdict) on it would be acting on noise.
  if (report.inconclusive) return null;
  if (report.error) {
    return `the isolation check itself errored (${report.error}) — fix the fluid_ports declaration (each port needs name/point/r, named <circuit>_<role> like "a_in") or simplify the geometry`;
  }
  if (report.isolated) return null;

  const ports = report.ports ?? {};
  const entries = Object.entries(ports);
  const problems: string[] = [];

  const lost = entries.filter(([, comp]) => comp == null).map(([name]) => name);
  if (lost.length > 0) {
    problems.push(
      `port probe${lost.length > 1 ? "s" : ""} ${lost.join(", ")} found only solid — the probe point is misplaced (must sit in open fluid space, e.g. a plenum) or that channel is blocked shut`
    );
  }

  // Map circuit prefix -> distinct components to tell leaks from blockages.
  const byPrefix = new Map<string, Set<number>>();
  for (const [name, comp] of entries) {
    if (comp == null) continue;
    const prefix = name.split("_")[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
    byPrefix.get(prefix)!.add(comp);
  }
  for (const [prefix, comps] of byPrefix) {
    if (comps.size > 1) {
      problems.push(
        `circuit "${prefix}" is split across ${comps.size} unconnected voids — a blockage (over-sealed faces, or a plenum that never reaches its channels)`
      );
    }
  }
  const compOwners = new Map<number, string[]>();
  for (const [prefix, comps] of byPrefix) {
    for (const comp of comps) {
      if (!compOwners.has(comp)) compOwners.set(comp, []);
      compOwners.get(comp)!.push(prefix);
    }
  }
  for (const [, owners] of compOwners) {
    if (owners.length > 1) {
      problems.push(
        `circuits ${owners.map((o) => `"${o}"`).join(" and ")} share one void — a LEAK wider than ~${report.pitch?.toFixed(2) ?? "?"}mm (wall too thin for the mesh pitch, a face where the other fluid was never sealed, or plenums that touch)`
      );
    }
  }

  if (problems.length === 0) {
    // isolated=false without a legible cause (e.g. a probe straddling two
    // voids) — still a failure, report what we know.
    problems.push(
      `the circuits could not be verified as isolated (ports: ${JSON.stringify(ports)})`
    );
  }
  return problems.join("; ");
}

/**
 * One-line verified summary for logs/honesty rails: what the check actually
 * proved, with its resolution bound. Null when the check didn't run.
 */
/**
 * Non-null when the check ran but declined to render a verdict (probe
 * resolution vs part size) — UI copy for a neutral "not verified" state.
 */
export function networksInconclusive(
  report: CadNetworksReport | null | undefined
): string | null {
  if (!report?.inconclusive) return null;
  return (
    report.reason ??
    `isolation not verified — the part is too large for a probe fine enough to resolve its walls (pitch ~${report.pitch?.toFixed(2) ?? "?"}mm)`
  );
}

export function networksSummary(
  report: CadNetworksReport | null | undefined
): string | null {
  if (!report || report.error || report.inconclusive) return null;
  if (!report.isolated) return "fluid circuits NOT isolated";
  const wall =
    report.minWallVoxels != null && report.pitch != null
      ? `, min wall >= ${(report.minWallVoxels * report.pitch).toFixed(1)}mm`
      : "";
  return `${report.components ?? 2} fluid circuits isolated (no leak wider than ~${report.pitch?.toFixed(2) ?? "?"}mm${wall})`;
}
