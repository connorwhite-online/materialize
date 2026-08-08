/**
 * Client-side CraftCloud upload — runs in the browser.
 *
 * Thin telemetry wrapper over the shared three-step chain in
 * `model-upload.ts` (initiate → S3 PUT → confirm), which replaced the
 * removed `POST /v5/model`. The chain itself is shared with the
 * server-side path in `client.ts`; this module only adds the
 * `reportClientError` calls, because every caller catches these
 * failures and renders them in the UI — so client Sentry never
 * auto-captures them and an upload outage is otherwise invisible.
 */

import { reportClientError } from "@/lib/observability/report-client-error";
import {
  CraftCloudUploadError,
  NETWORK_FAILURE_STATUS,
  uploadModelToCraftCloud,
  type UploadedModel,
} from "./model-upload";

export type { UploadedModel };

async function uploadAndReport(
  body: Blob | File,
  filename: string,
  unit: "mm" | "cm" | "in"
): Promise<UploadedModel> {
  try {
    return await uploadModelToCraftCloud(body, filename, unit);
  } catch (error) {
    // Aborts (navigation mid-upload) arrive here untouched and stay
    // unreported — those are the noise the client floor exists for.
    if (error instanceof CraftCloudUploadError) {
      // A network-level rejection gets its own context rather than
      // being dropped. On this chain that is most likely a CORS
      // refusal from customer-api (which answers with an explicit
      // origin, not `*`), i.e. a total outage of the upload path —
      // precisely the failure that must not be silent. Split from
      // the HTTP-status context so it can be muted independently if
      // it turns out to be dominated by offline users.
      const context =
        error.status === NETWORK_FAILURE_STATUS
          ? "craftcloud.model-upload-unreachable"
          : "craftcloud.model-upload-failed";
      reportClientError(context, error, {
        step: error.step,
        status: error.status,
        filename,
        unit,
        responseBody: error.responseBody.slice(0, 500),
      });
    }
    throw error;
  }
}

/**
 * Upload a file to CraftCloud directly from the browser.
 * Downloads from our same-origin proxy URL, then uploads to CraftCloud.
 */
export async function uploadToCraftCloud(
  downloadUrl: string,
  filename: string,
  unit: "mm" | "cm" | "in" = "mm"
): Promise<UploadedModel> {
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    // A definitive HTTP status from our own storage proxy — as
    // actionable as an upload failure, and just as invisible once the
    // caller catches it.
    const error = new Error("Failed to download file");
    reportClientError("craftcloud.model-download-failed", error, {
      status: fileRes.status,
      filename,
    });
    throw error;
  }
  const blob = await fileRes.blob();
  return uploadAndReport(blob, filename, unit);
}

/**
 * Upload a local File object straight to CraftCloud. Used by the
 * anon draft flow where the user's file never touches our R2.
 */
export async function uploadFileToCraftCloud(
  file: File,
  unit: "mm" | "cm" | "in" = "mm"
): Promise<UploadedModel> {
  return uploadAndReport(file, file.name, unit);
}
