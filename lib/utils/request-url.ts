import { headers } from "next/headers";

/**
 * Derive the redirect base URL from the live request rather than a
 * build-time env var. NEXT_PUBLIC_APP_URL bakes at build time and,
 * when unset in production, the fallback "http://localhost:3000"
 * gets embedded into URLs (e.g. Stripe session success/cancel URLs),
 * landing every customer on a dead localhost page after payment.
 *
 * Falls back to NEXT_PUBLIC_APP_URL, then "http://localhost:3000", only
 * when no host header is present (e.g. in tests or cron contexts).
 */
export async function deriveAppUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
