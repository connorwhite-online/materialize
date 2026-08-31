import { createFileListing } from "@/app/actions/files";
import { uploadFileToR2 } from "./upload-file-to-r2";

/**
 * The full create-a-listing pipeline from a client-side picked
 * file to the createFileListing server action. Extracted out of
 * FileMetadataForm so the chain can be unit-tested without
 * rendering the component, and so the component stays focused on
 * UI state.
 *
 * Steps:
 *   1-2. uploadFileToR2 (presign + R2 PUT with progress, shared
 *        helper — MONEY-3) → { uploadUrl, storageKey, format }
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
  /** Curated browse category slug, or "" for uncategorized. */
  category?: string;
  recommendedMaterial: string;
  sellEnabled: boolean;
  license: string;
  collectionChoice: string;
  newCollectionName: string;
  /** Optional project to attach the new file to ("none" / "" = skip). */
  projectChoice?: string;
  onProgress?: (percent: number) => void;
  onPhaseChange?: (phase: "uploading" | "saving") => void;
}

export type CreateListingResult =
  | { ok: true }
  | {
      ok: false;
      duplicate: DuplicateUploadMatch;
      error?: never;
      fieldErrors?: never;
    }
  | {
      ok: false;
      duplicate?: never;
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

export interface DuplicateUploadMatch {
  claimIntentId: string;
  file: {
    name: string | null;
    slug: string | null;
    thumbnailUrl: string | null;
  };
  owner: {
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export async function runCreateListing(
  input: CreateListingInput
): Promise<CreateListingResult> {
  try {
    // 1-2. Presign + PUT the file to R2 with progress (shared helper —
    //      MONEY-3). XHR under the hood because fetch on the client
    //      doesn't expose upload progress events.
    input.onPhaseChange?.("uploading");
    input.onProgress?.(0);

    const uploaded = await uploadFileToR2({
      file: input.file,
      kind: "create-listing",
      onProgress: input.onProgress,
    });
    if ("error" in uploaded) return { ok: false, error: uploaded.error };
    const { storageKey, format: serverFormat } = uploaded;

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
    if (input.category) {
      input.formData.set("category", input.category);
    }
    // Sale toggle only controls price — license is always the
    // creator's choice (reuse terms apply to free downloads too).
    if (!input.sellEnabled) {
      input.formData.set("price", "0");
    }
    input.formData.set("license", input.license);
    if (input.recommendedMaterial) {
      input.formData.set("recommendedMaterialId", input.recommendedMaterial);
    }
    input.formData.set("collectionId", input.collectionChoice);
    if (input.collectionChoice === "__new__") {
      input.formData.set("newCollectionName", input.newCollectionName);
    }
    if (input.projectChoice && input.projectChoice !== "none") {
      input.formData.set("projectId", input.projectChoice);
    }

    const result = await createFileListing(input.formData);
    // On success the action calls redirect() and we never reach
    // here. Reaching the next line means it returned an error
    // object.
    if (result && typeof result === "object" && "duplicate" in result) {
      return {
        ok: false,
        duplicate: result.duplicate,
      };
    }
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
