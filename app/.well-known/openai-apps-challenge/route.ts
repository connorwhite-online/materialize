/**
 * Domain verification for OpenAI's plugin directory. The submission
 * portal shows a challenge token when the MCP server is connected; it
 * must be served here as the exact token in plain text — no JSON, no
 * list. Set it with OPENAI_APPS_CHALLENGE_TOKEN; unset is a 404 so the
 * path discloses nothing until a submission is in progress.
 */
export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
