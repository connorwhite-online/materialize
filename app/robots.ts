import type { MetadataRoute } from "next";

/**
 * Robots policy. Default-allow with explicit lockdown of personal
 * dashboards, agent-private surfaces, and webhook receivers. Major
 * agent crawlers (OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-
 * SearchBot, PerplexityBot, GPTBot, Google-Extended) get the same
 * default-allow with the same disallows — we want them to find the
 * marketplace + material pages + llms.txt for their answers.
 *
 * Authenticated routes (/dashboard, /api/mcp, /api/webhooks, etc.)
 * are explicitly disallowed because (a) they can't be crawled
 * meaningfully without auth and (b) we don't want bots wasting
 * compute on 401-walled paths.
 */

const DISALLOW = [
  "/dashboard",
  "/api/mcp",
  "/api/webhooks",
  "/api/cron",
  "/orders",
  "/checkout",
  "/sign-in",
  "/sign-up",
  "/sso-callback",
  "/onboarding",
];

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
