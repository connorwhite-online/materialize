import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { PUBLIC_ROUTES } from "@/lib/auth/public-routes";
import { LLMS_TXT_PATH, prefersMarkdown } from "@/lib/seo/agent-discovery";

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES]);

export default clerkMiddleware(async (auth, req) => {
  // An agent that asks the home page for markdown gets the agent guide
  // instead of the marketing HTML. Browsers never ask for it.
  if (
    req.nextUrl.pathname === "/" &&
    req.method === "GET" &&
    prefersMarkdown(req.headers.get("accept"))
  ) {
    const url = req.nextUrl.clone();
    url.pathname = LLMS_TXT_PATH;
    return NextResponse.rewrite(url);
  }

  // Tag the Sentry scope with the authed Clerk userId so any
  // errors captured downstream (edge + node runtimes via the
  // request-scoped AsyncLocalStorage that @sentry/nextjs sets up)
  // include the user id. Opaque id only — no email, no name; PII
  // scrubbing in `beforeSend` still applies.
  //
  // We tag BEFORE auth.protect() so anonymous-route errors stay
  // untagged (correct — there's no user) and auth-failure errors
  // on protected routes get tagged with whoever was attempting.
  try {
    const { userId } = await auth();
    if (userId) {
      Sentry.setUser({ id: userId });
    }
  } catch {
    // auth() can fail in some pre-request paths; silently skip
    // the tag rather than block the request.
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|glb)).*)",
    "/(api|trpc)(.*)",
  ],
};
