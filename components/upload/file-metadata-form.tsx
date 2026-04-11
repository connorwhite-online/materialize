"use client";

import { useActionState } from "react";
import { createFileListing } from "@/app/actions/files";

interface UploadedAsset {
  id: string;
  originalFilename: string;
  format: string;
  fileSize: number;
}

interface FileMetadataFormProps {
  assets: UploadedAsset[];
}

export function FileMetadataForm({ assets }: FileMetadataFormProps) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      // Append asset IDs to form data
      for (const asset of assets) {
        formData.append("assetIds", asset.id);
      }
      return createFileListing(formData);
    },
    null
  );

  const errors = state && "error" in state ? state.error : null;

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          placeholder="My 3D Model"
        />
        {errors?.name && (
          <p className="mt-1 text-xs text-red-500">{errors.name[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          placeholder="Describe your 3D model..."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="price" className="block text-sm font-medium">
            Price (USD)
          </label>
          <input
            id="price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0"
            className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-foreground/40">
            Set to 0 for free download
          </p>
        </div>

        <div>
          <label htmlFor="license" className="block text-sm font-medium">
            License
          </label>
          <select
            id="license"
            name="license"
            defaultValue="free"
            className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          >
            <option value="free">Free</option>
            <option value="personal">Personal Use</option>
            <option value="commercial">Commercial Use</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="tags" className="block text-sm font-medium">
          Tags
        </label>
        <input
          id="tags"
          name="tags"
          type="text"
          className="mt-1 block w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm"
          placeholder="miniature, tabletop, gaming (comma separated)"
        />
      </div>

      <div>
        <p className="text-sm font-medium">Uploaded Files</p>
        <div className="mt-2 space-y-1">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center gap-2 rounded-md bg-foreground/5 px-3 py-2 text-sm"
            >
              <span className="font-medium">{asset.originalFilename}</span>
              <span className="text-foreground/50 uppercase text-xs">
                {asset.format}
              </span>
              <span className="text-foreground/40 text-xs">
                {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || assets.length === 0}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create Listing"}
      </button>
    </form>
  );
}
