/**
 * Read a request body that must be a JSON object.
 *
 * Returns `null` for a malformed body, and for valid JSON that isn't a
 * plain object (`null`, an array, a bare string/number) — destructuring
 * any of those is what used to turn a bad client request into a 500.
 * Callers answer `null` with a 400.
 */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

export function invalidJsonResponse(): Response {
  return Response.json({ error: "Invalid JSON body" }, { status: 400 });
}
