import "server-only";

import { craftCloudQuoteProvider } from "./craftcloud-provider";
import type { QuoteProvider } from "./types";

export * from "./types";

/**
 * The provider that serves quotes. One today; this is the seam a second
 * provider (or a fan-out over several) plugs into, so routes and the MCP
 * tool never import a provider module directly.
 */
export function getQuoteProvider(): QuoteProvider {
  return craftCloudQuoteProvider;
}
