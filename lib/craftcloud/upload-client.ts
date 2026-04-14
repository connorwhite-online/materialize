/**
 * Client-side CraftCloud upload — runs in the browser.
 * Uploads files directly from the client to CraftCloud,
 * keeping large files off our server.
 */

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
    throw new Error(`CraftCloud upload failed: ${uploadRes.status}`);
  }

  const models = await uploadRes.json();
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("CraftCloud returned no models");
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
  if (!fileRes.ok) throw new Error("Failed to download file");
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
