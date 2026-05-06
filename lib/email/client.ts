import "server-only";

import { Resend } from "resend";
import type { ReactElement } from "react";
import { logError } from "@/lib/logger";

/**
 * Thin wrapper over Resend for transactional email. Two operating modes:
 *
 *   - With `RESEND_API_KEY` set: actually send via Resend.
 *   - Without it (default in local dev): log the rendered HTML to the
 *     server console and pretend success. Lets the rest of the app
 *     run end-to-end without a Resend account, with no behaviour
 *     change for callers — they still get `{ ok: true }`.
 *
 * Set `RESEND_FROM_EMAIL` in production. Defaults to a placeholder so
 * local dev surfaces an obvious "you forgot to configure this" if the
 * key is set but the from-address isn't.
 */

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "Materialize <noreply@materialize.cc>";

let cachedClient: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  react: ReactElement;
  /**
   * Plain-text fallback. Recommended — improves deliverability and
   * works in clients with HTML disabled.
   */
  text: string;
  /**
   * Reply-To header. Defaults to no reply-to.
   */
  replyTo?: string;
}

export async function sendEmail(
  params: SendEmailParams
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const client = getResend();
  if (!client) {
    console.log(
      `[email] (stub, no RESEND_API_KEY) would send:\n` +
        `  to: ${params.to}\n` +
        `  subject: ${params.subject}\n---\n${params.text}\n---`
    );
    return { ok: true };
  }

  try {
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      react: params.react,
      text: params.text,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
    if (result.error) {
      logError("email.send", result.error);
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id };
  } catch (error) {
    logError("email.send", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email send error",
    };
  }
}
