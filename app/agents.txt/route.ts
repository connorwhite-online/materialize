import { deriveAppUrl } from "@/lib/utils/request-url";
import { llmsTxt } from "@/lib/seo/llms-txt";

/**
 * Same document as /llms.txt, at the other name agents probe. Before
 * this existed the path fell through to the vanity-profile catch-all and
 * answered 200 with an HTML page, which a crawler could mistake for the
 * guide it was looking for.
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
