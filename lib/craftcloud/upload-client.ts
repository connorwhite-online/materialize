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
    // Only definitive HTTP failures are reported. A bare network
    // rejection (TypeError) falls through unreported, matching the
    // `Failed to fetch` noise floor in instrumentation-client.ts.
    if (error instanceof CraftCloudUploadError) {
      reportClientError("craftcloud.model-upload-failed", error, {
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
