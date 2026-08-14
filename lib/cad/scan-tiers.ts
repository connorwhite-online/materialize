/**
 * Capture tiers for scan-to-CAD.
 *
 * The honest centre of this feature. Scanning an object and asking for a case
 * around it is a software problem we can solve; the thing that actually limits
 * the output is how accurately the object was measured in the first place, and
 * that is a property of the CAPTURE, not of the harness.
 *
 * ARKit-class phone reconstruction lands around ±5–10mm of surface error with
 * drift across a sweep. A press-fit or snap-fit needs roughly ±0.2mm. That is
 * not a gap prompt engineering closes — it is two orders of magnitude — so the
 * tier a scan was captured at decides two things: how much clearance the proxy
 * carries, and which case archetypes may be offered at all. At phone-lidar
 * accuracy the answer is loose fits with compliant retention: cradles, trays,
 * sleeves, stands, mounts, straps. Those are genuinely useful and genuinely
 * achievable. A snap fit is not, and we do not offer one.
 *
 * Pure and client-safe on purpose — the composer renders these labels, the
 * knowledge block quotes these numbers, and the ingestion path applies these
 * clearances, all from one table so the promise made in the UI is the promise
 * enforced in the geometry.
 *
 * v1 supports phone lidar only. The other tiers are declared, not enabled:
 * writing them down is how the accuracy budget stays legible, but shipping
 * them means proving the tolerance claims first (see
 * docs/text-to-cad/11-scan-to-cad.md).
 */

export type CaptureTierId = "phone_lidar" | "photogrammetry" | "structured_light";

/** Proxy shapes the sidecar's ladder can build (cad-runner/scan_proxy.py). */
export type ProxyLevel = "bbox" | "hull" | "offset";

export interface CaptureTier {
  id: CaptureTierId;
  label: string;
  /** What the user actually did, in their words. */
  blurb: string;
  /** Typical surface error, mm. The number every other number derives from. */
  surfaceErrorMm: number;
  /** Clearance baked into the proxy at this tier, mm. */
  clearanceMm: number;
  /** Proxy shape this tier can support (see scan_proxy.py's ladder). */
  proxyLevel: ProxyLevel;
  /** Whether a press/snap fit may be attempted. False = compliant retention. */
  tightFits: boolean;
  /** Enabled in v1. */
  supported: boolean;
  /** Case archetypes honest at this accuracy. */
  archetypes: string[];
}

export const CAPTURE_TIERS: Record<CaptureTierId, CaptureTier> = {
  phone_lidar: {
    id: "phone_lidar",
    label: "Phone scan",
    blurb: "Captured with an iPhone/iPad lidar or AR scanning app",
    surfaceErrorMm: 8,
    // 3mm swallows the capture error's typical case without making the part
    // absurd. It is deliberately not 8mm: the proxy is already conservative
    // (it may only grow), so stacking worst-case error on top of a hull that
    // already bounds the noise would double-count it.
    clearanceMm: 3,
    proxyLevel: "hull",
    tightFits: false,
    supported: true,
    archetypes: [
      "cradle",
      "tray",
      "sleeve",
      "stand",
      "wall mount",
      "strap or band retainer",
    ],
  },
  photogrammetry: {
    id: "photogrammetry",
    label: "Photogrammetry",
    blurb: "Reconstructed from photos (Object Capture and similar)",
    // Relative shape is good; ABSOLUTE scale is the problem — a photo-only
    // reconstruction has no metric reference, so it needs a known dimension
    // from the user before its millimetres mean anything. That resolution
    // step is why this tier is not enabled yet.
    surfaceErrorMm: 3,
    clearanceMm: 2,
    proxyLevel: "offset",
    tightFits: false,
    supported: false,
    archetypes: ["cradle", "tray", "sleeve", "stand", "wall mount"],
  },
  structured_light: {
    id: "structured_light",
    label: "3D scanner",
    blurb: "Captured with a dedicated structured-light or laser scanner",
    surfaceErrorMm: 0.1,
    clearanceMm: 0.4,
    proxyLevel: "offset",
    tightFits: true,
    supported: false,
    archetypes: ["case", "press fit", "snap fit", "cradle", "bracket"],
  },
};

export const DEFAULT_CAPTURE_TIER: CaptureTierId = "phone_lidar";

export const SUPPORTED_CAPTURE_TIERS: CaptureTier[] = Object.values(
  CAPTURE_TIERS
).filter((t) => t.supported);

/**
 * Resolve a client-supplied tier id. Anything unknown OR not yet enabled
 * falls back to the default rather than erroring: an unsupported tier means
 * "we cannot promise that accuracy", and the safe reading of a scan we cannot
 * vouch for is the loosest one, not a rejection.
 */
export function resolveCaptureTier(id?: string | null): CaptureTier {
  const tier = CAPTURE_TIERS[id as CaptureTierId];
  return tier?.supported ? tier : CAPTURE_TIERS[DEFAULT_CAPTURE_TIER];
}

/** Mesh formats accepted as studio geometry input. */
export const SCAN_FILE_TYPES = ["obj", "stl", "ply", "glb", "3mf"] as const;
export type ScanFileType = (typeof SCAN_FILE_TYPES)[number];

/**
 * Hard cap on one uploaded scan, bytes. The sidecar decimates to 200k
 * triangles on receipt, but the bytes still have to travel there base64-encoded
 * inside the run payload, so the cap is about transport rather than geometry.
 * A single-object phone capture is typically 2–10MB.
 */
export const MAX_SCAN_BYTES = 32 * 1024 * 1024;

/** How many geometry attachments one turn may carry. */
export const MAX_GEOMETRY_REFS = 2;

export function scanFileTypeFromName(filename: string): ScanFileType | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  // .gltf is glTF's JSON form; the sidecar's trimesh reads both, but the
  // separate .bin payload a .gltf usually references would not come with it.
  return (SCAN_FILE_TYPES as readonly string[]).includes(ext)
    ? (ext as ScanFileType)
    : null;
}
