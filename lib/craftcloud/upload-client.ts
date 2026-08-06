/**
 * Client-side CraftCloud upload — runs in the browser.
 * Uploads files directly from the client to CraftCloud,
 * keeping large files off our server.
 */

import { reportClientError } from "@/lib/observability/report-client-error";

const CRAFTCLOUD_BASE_URL = "https://api.craftcloud3d.com";

export interface UploadedModel {
  modelId: string;
  dimensions: { x: number; y: number; z: number } | null;
  volume: number | null;
  triangleCount: number | null;
}

async function postModelToCraftCloud(
  body: Blob | File,
  filename: string,
  unit: "mm" | "cm" | "in"
): Promise<UploadedModel> {
  const formData = new FormData();
  formData.append("file", body, filename);
  formData.append("unit", unit);

  const uploadRes = await fetch(`${CRAFTCLOUD_BASE_URL}/v5/model`, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    // Every caller catches this and renders it in the UI, so client
    // Sentry never auto-captures it — a CraftCloud upload outage is
    // invisible to monitoring without this report. Include the
    // response body: the status alone (seen in prod: a bare 404 from
    // POST /v5/model) doesn't say what CraftCloud thinks is wrong.
    const responseBody = await uploadRes.text().catch(() => "");
    const error = new Error(`CraftCloud upload failed: ${uploadRes.status}`);
    reportClientError("craftcloud.model-upload-failed", error, {
      status: uploadRes.status,
      filename,
      unit,
      responseBody: responseBody.slice(0, 500),
    });
    throw error;
  }

  const models = await uploadRes.json();
  if (!Array.isArray(models) || models.length === 0) {
    const error = new Error("CraftCloud returned no models");
    reportClientError("craftcloud.model-upload-empty", error, {
      filename,
      unit,
    });
    throw error;
  }

  const model = models[0];
  return {
    modelId: model.modelId || model.id,
    dimensions: model.dimensions || null,
    volume: model.volume || null,
    triangleCount: null,
  };
}

/**
 * Upload a file to CraftCloud directly from the browser.
 * Downloads from our R2 URL, then uploads to CraftCloud.
 */
export async function uploadToCraftCloud(
  downloadUrl: string,
  filename: string,
  unit: "mm" | "cm" | "in" = "mm"
): Promise<UploadedModel> {
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    // A definitive HTTP status from our own R2 presigned URL — as
    // actionable as an upload failure, and just as invisible once the
    // caller catches it. Network-level rejections (TypeError) stay
    // unreported by design — see the `Failed to fetch` noise floor in
    // instrumentation-client.ts.
    const error = new Error("Failed to download file");
    reportClientError("craftcloud.model-download-failed", error, {
      status: fileRes.status,
      filename,
    });
    throw error;
  }
  const blob = await fileRes.blob();
  return postModelToCraftCloud(blob, filename, unit);
}

/**
 * Upload a local File object straight to CraftCloud. Used by the
 * anon draft flow where the user's file never touches our R2.
 */
export async function uploadFileToCraftCloud(
  file: File,
  unit: "mm" | "cm" | "in" = "mm"
): Promise<UploadedModel> {
  return postModelToCraftCloud(file, file.name, unit);
}
