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

/**
 * Upload a file to CraftCloud directly from the browser.
 * Downloads from our R2 URL, then uploads to CraftCloud.
 */
export async function uploadToCraftCloud(
  downloadUrl: string,
  filename: string,
  unit: "mm" | "cm" | "in" = "mm"
): Promise<UploadedModel> {
  // Download the file from R2
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) throw new Error("Failed to download file");
  const blob = await fileRes.blob();

  // Upload to CraftCloud
  const formData = new FormData();
  formData.append("file", blob, filename);
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
    triangleCount: model.area ? null : null, // CraftCloud uses 'area' not triangleCount
  };
}
