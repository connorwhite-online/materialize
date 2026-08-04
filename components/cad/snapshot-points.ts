/**
 * Decode a snapshot event's `points` payload (base64 LE Float32 xyz triples,
 * lib/cad/stl-points.ts) into a flat array. Null on garbage — fail-open.
 *
 * Deliberately three.js-free: the studio imports this statically while
 * materializing-blob (which consumes the points) stays lazy-loaded.
 */
export function decodeSnapshotPoints(b64: string): Float32Array | null {
  try {
    const bin = atob(b64);
    if (bin.length < 12 || bin.length % 12 !== 0) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  } catch {
    return null;
  }
}
