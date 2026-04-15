import { createFileListing } from "@/app/actions/files";

/**
 * The full create-a-listing pipeline from a client-side picked
 * file to the createFileListing server action. Extracted out of
 * FileMetadataForm so the chain can be unit-tested without
 * rendering the component, and so the component stays focused on
 * UI state.
 *
 * Steps:
 *   1. POST /api/upload/presign → { uploadUrl, storageKey, format }
 *   2. PUT the file bytes to R2 via XHR (for upload progress)
 *   3. Stuff the collected form fields + assetsJson into the
 *      passed-in FormData snapshot
 *   4. Call createFileListing(formData) — on success it calls
 *      redirect() server-side and the promise never resolves.
 *      On validation failure it returns { error: fieldErrors }.
 *
 * The onProgress callback fires repeatedly during the R2 upload
 * (0-100). The onPhaseChange callback fires once when the
 * pipeline enters each step, so the caller can show a matching
 * label ("Uploading..." / "Saving...").
 */

export interface CreateListingInput {
  file: File;
  fileUnit: "mm" | "cm" | "in";
  /** Snapshot of the form fields. Mutated to add assetsJson. */
  formData: FormData;
  selectedDesignTags: string[];
  recommendedMaterial: string;
  sellEnabled: boolean;
  license: string;
  collectionChoice: string;
  newCollectionName: string;
  onProgress?: (percent: number) => void;
  onPhaseChange?: (phase: "uploading" | "saving") => void;
}

export type CreateListingResult =
  | { ok: true }
  | {
      ok: false;
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

export async function runCreateListing(
  input: CreateListingInput
): Promise<CreateListingResult> {
  try {
    // 1. Get a presigned URL for R2.
    input.onPhaseChange?.("uploading");
    input.onProgress?.(0);

    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: input.file.name,
        contentType: "application/octet-stream",
        fileSize: input.file.size,
      }),
    });
    if (!presignRes.ok) {
      const data = await presignRes.json().catch(() => ({}));
      return {
        ok: false,
        error: data.error || `Presign failed (${presignRes.status})`,
      };
    }
    const { uploadUrl, storageKey, format: serverFormat } =
      (await presignRes.json()) as {
        uploadUrl: string;
        storageKey: string;
        format: "stl" | "obj" | "3mf" | "step" | "amf";
      };

    // 2. PUT the file to R2 with progress. XHR instead of fetch
    //    because fetch on the client doesn't expose upload
    //    progress events.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable) {
          input.onProgress?.(Math.round((ev.loaded / ev.total) * 100));
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new Error(
              `R2 upload failed (${xhr.status}). Check R2 CORS settings.`
            )
          );
        }
      });
      xhr.addEventListener("error", () =>
        reject(new Error("Network error uploading to R2."))
      );
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(input.file);
    });

    // 3. Populate the remaining form fields and call the server
    //    action.
    input.onPhaseChange?.("saving");
    input.formData.set(
      "assetsJson",
      JSON.stringify([
        {
          storageKey,
          originalFilename: input.file.name,
          format: serverFormat,
          fileSize: input.file.size,
          fileUnit: input.fileUnit,
        },
      ])
    );
    for (const tag of input.selectedDesignTags) {
      input.formData.append("designTags", tag);
    }
    if (!input.sellEnabled) {
      input.formData.set("price", "0");
      input.formData.set("license", "free");
    } else {
      input.formData.set("license", input.license);
    }
    if (input.recommendedMaterial) {
      input.formData.set("recommendedMaterialId", input.recommendedMaterial);
    }
    input.formData.set("collectionId", input.collectionChoice);
    if (input.collectionChoice === "__new__") {
      input.formData.set("newCollectionName", input.newCollectionName);
    }

    const result = await createFileListing(input.formData);
    // On success the action calls redirect() and we never reach
    // here. Reaching the next line means it returned an error
    // object.
    if (result && typeof result === "object" && "error" in result) {
      return {
        ok: false,
        fieldErrors: result.error as Record<string, string[] | undefined>,
      };
    }

    // Unexpected — shouldn't hit this but return ok so we don't
    // misclassify a weird server-action response.
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed",
    };
  }
}
