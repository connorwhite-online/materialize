import "server-only";

import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Server-side download of a model file from a URL an agent handed us —
 * ChatGPT's hydrated `download_url` for a file the user attached, or any
 * public https link. Because the URL is caller-controlled this is an SSRF
 * surface, so:
 *
 * - https only, on every hop, and at most MAX_REDIRECTS hops.
 * - The address check runs inside the socket's DNS lookup (undici Agent
 *   `connect.lookup`), so the IP that is checked is the IP that is
 *   dialled. Checking a separate `dns.lookup` first and then fetching
 *   would let a rebinding DNS answer a public address to the check and a
 *   private one to the connection.
 * - Loopback, private, link-local (cloud metadata lives at 169.254.169.254),
 *   CGNAT, multicast and reserved ranges are refused, for v4, v6 and
 *   v4-mapped v6.
 * - The body is streamed against a byte cap and a deadline, so a huge or
 *   trickling response can't pin a function instance.
 */

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 60_000;

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** True for an address we're willing to connect to. Exported for tests. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return !BLOCKED.check(mapped[1], "ipv4");
    return !BLOCKED.check(address, "ipv6");
  }
  return false;
}

export class ModelFetchError extends Error {}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/** dns.lookup that refuses to hand a non-public address to the socket. */
function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback
) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (blocked || addresses.length === 0) {
      const refusal = Object.assign(
        new Error(`Refusing to connect to non-public address for ${hostname}`),
        { code: "EBLOCKED" }
      );
      return callback(refusal, []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

let agent: Agent | null = null;
function publicAgent(): Agent {
  agent ??= new Agent({ connect: { lookup: publicOnlyLookup } });
  return agent;
}

export interface FetchedModel {
  bytes: Uint8Array;
  /** Last path segment of the final URL, if it looks like a filename. */
  urlFilename: string | null;
}

export async function fetchModelBytes(
  rawUrl: string,
  maxBytes: number
): Promise<FetchedModel> {
  let url = parseHttpsUrl(rawUrl);
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  for (let hop = 0; ; hop++) {
    // An IP literal never reaches the lookup hook, so check it here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicAddress(host)) {
      throw new ModelFetchError("That URL points at a private address.");
    }

    let res;
    try {
      res = await undiciFetch(url, {
        dispatcher: publicAgent(),
        redirect: "manual",
        signal: deadline,
      });
    } catch (err) {
      const blocked = (err as { cause?: { code?: string } }).cause?.code === "EBLOCKED";
      throw new ModelFetchError(
        blocked
          ? "That URL points at a private address."
          : "Couldn't download the file from that URL."
      );
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || hop >= MAX_REDIRECTS) {
        throw new ModelFetchError("Too many redirects while downloading the file.");
      }
      url = parseHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new ModelFetchError(`Download failed (HTTP ${res.status}).`);
    }

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel();
      throw new ModelFetchError(tooBig(maxBytes));
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of res.body) {
        total += chunk.byteLength;
        if (total > maxBytes) break;
        chunks.push(chunk);
      }
    } catch {
      throw new ModelFetchError("The download timed out or was interrupted.");
    }
    if (total > maxBytes) {
      await res.body.cancel().catch(() => {});
      throw new ModelFetchError(tooBig(maxBytes));
    }
    if (total === 0) throw new ModelFetchError("The downloaded file is empty.");

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes, urlFilename: lastPathSegment(url) };
  }
}

function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ModelFetchError("That isn't a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new ModelFetchError("Only https URLs can be imported.");
  }
  if (url.username || url.password) {
    throw new ModelFetchError("URLs with embedded credentials aren't accepted.");
  }
  return url;
}

function lastPathSegment(url: URL): string | null {
  const raw = url.pathname.split("/").pop() ?? "";
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  return name.includes(".") ? name : null;
}

function tooBig(maxBytes: number) {
  return `The file is larger than the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`;
}
