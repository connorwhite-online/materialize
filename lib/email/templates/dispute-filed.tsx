import "server-only";
import { sendEmail } from "@/lib/email/client";

/**
 * Notifies the operator that a creator filed a dispute against an
 * auto-archived listing. Part of the MVP dispute workflow (CON-67):
 * the dispute is persisted in the `disputes` table and this email
 * pings a human to review + resolve it by hand.
 *
 * Target address: `DISPUTE_NOTIFY_EMAIL` (optional — defaults below).
 */
const OPERATOR_EMAIL = process.env.DISPUTE_NOTIFY_EMAIL ?? "disputes@materialize.cc";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.materialize.cc";

export async function sendDisputeFiledEmail(params: {
  fileName: string | null;
  fileSlug: string | null;
  fileId: string;
  raisedByUserId: string;
  reason: string;
}): Promise<void> {
  const title = params.fileName ?? "Untitled listing";
  const link = params.fileSlug
    ? `${APP_URL}/files/${params.fileSlug}`
    : `${APP_URL}/files`;

  const text = [
    "A creator disputed an auto-archived listing.",
    "",
    `Listing: ${title}`,
    link,
    `File id: ${params.fileId}`,
    `Raised by (user id): ${params.raisedByUserId}`,
    "",
    "Reason:",
    params.reason,
    "",
    "Review the disputes table and resolve manually (open → resolved/rejected).",
  ].join("\n");

  await sendEmail({
    to: OPERATOR_EMAIL,
    subject: `Listing dispute: ${title}`,
    text,
    react: (
      <div>
        <h2>Listing dispute filed</h2>
        <p>
          <strong>Listing:</strong> {title} (<a href={link}>{link}</a>)
        </p>
        <p>
          <strong>File id:</strong> {params.fileId}
        </p>
        <p>
          <strong>Raised by (user id):</strong> {params.raisedByUserId}
        </p>
        <p>
          <strong>Reason:</strong>
        </p>
        <p style={{ whiteSpace: "pre-wrap" }}>{params.reason}</p>
        <p>Review the disputes table and resolve manually.</p>
      </div>
    ),
  });
}
