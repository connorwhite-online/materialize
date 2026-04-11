/**
 * Light geometry checks — soft hints only.
 * We're not engineers. CraftCloud and the factories do the real validation.
 * These just give the user a heads-up about things they might want to know.
 * NEVER block a user from ordering based on these.
 */

export interface GeometryData {
  dimensions?: { x: number; y: number; z: number };
  volume?: number;
  triangleCount?: number;
}

export interface GeometryHint {
  message: string;
  detail: string;
}

export function checkGeometry(geometry: GeometryData | null): GeometryHint[] {
  if (!geometry) return [];
  const hints: GeometryHint[] = [];

  const dims = geometry.dimensions;
  const volume = geometry.volume;
  const triangles = geometry.triangleCount;

  // Near-zero volume — almost certainly a broken mesh
  if (volume !== undefined && volume < 0.1 && dims) {
    const boundingVolume = dims.x * dims.y * dims.z;
    if (boundingVolume > 10) {
      hints.push({
        message: "Model may have geometry issues",
        detail: "Volume is very low relative to its size. The mesh might not be watertight.",
      });
    }
  }

  // Very large — just a heads-up on material availability
  if (dims) {
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    if (maxDim > 400) {
      hints.push({
        message: "Large model",
        detail: `Largest dimension is ${maxDim.toFixed(0)}mm. Fewer materials may be available at this size.`,
      });
    }
  }

  // High poly — processing time hint
  if (triangles && triangles > 5_000_000) {
    hints.push({
      message: "High polygon count",
      detail: `${(triangles / 1_000_000).toFixed(1)}M triangles. Quoting may take longer than usual.`,
    });
  }

  return hints;
}
