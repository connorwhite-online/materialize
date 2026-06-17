/**
 * Shared types for the text-to-CAD harness and its execution sidecar.
 * Pure types — safe to import from client or server.
 */

/** Output formats the sidecar can export from a build123d script. */
export type CadOutputFormat = "stl" | "step";

/** Geometry stats the sidecar measures off the produced solid. */
export interface CadGeometry {
  dimensions?: { x: number; y: number; z: number };
  volume?: number;
  triangleCount?: number;
}

/** Validity flags — the cheap, objective part of the manufacturability oracle. */
export interface CadValidation {
  compiled: boolean;
  isSolid: boolean;
  isWatertight: boolean;
  isManifold: boolean;
}

/** Result of executing one CAD script in the sidecar. */
export interface CadRunResult {
  ok: boolean;
  /** Base64-encoded file bytes per requested format. Present only when ok. */
  files: Partial<Record<CadOutputFormat, string>>;
  /** Base64 PNG preview render (no `data:` prefix). */
  renderPng?: string;
  geometry?: CadGeometry;
  validation: CadValidation;
  /** stderr / exception message when compile or export failed. */
  error?: string;
}
