import { deriveAppUrl } from "@/lib/utils/request-url";
import { llmsTxt } from "@/lib/seo/llms-txt";

/**
 * https://llmstxt.org — the entry point for an agent that lands on
 * Materialize cold. It answers three questions and nothing else: what a
 * user can get done here, how to connect, and which tools or pages do
 * each job. Business internals (fee model, vendor relationships,
 * roadmap) stay out: an agent can't act on them and every line costs
 * the reader context. /llms-full.txt carries the material catalog.
 *
 * Keep the tool names in sync with app/api/[transport]/route.ts; a test
 * pins that every tool named here exists.
 *
 * The base URL comes from the request, not NEXT_PUBLIC_APP_URL, which
 * bakes at build time (see lib/utils/request-url.ts).
 */
export async function GET() {
  const url = await deriveAppUrl();
  return new Response(llmsTxt(url), {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
