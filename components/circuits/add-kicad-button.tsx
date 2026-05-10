"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addProjectCircuitKicad } from "@/app/actions/circuits";
import {
  uploadCircuitToR2,
  validateCircuitKicad,
  ACCEPTED_KICAD_EXTENSIONS,
} from "@/lib/circuits/upload-circuit";

interface Props {
  projectId: string;
}

/**
 * "+ KiCad file" button — opens the native file picker filtered to
 * `.kicad_sch` / `.kicad_pcb` / `.kicad_pro`. Schematic and PCB
 * uploads land as their own gallery tiles; the `.kicad_pro` project
 * file currently bundles up as a `kicad_sch` row (it's a sketch
 * descriptor more than a renderable view — the schematic inside is
 * what KiCanvas wants to load).
 */
export function AddKiCadButton({ projectId }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const invalid = validateCircuitKicad(file);
      if (invalid) {
        setError(invalid);
        return;
      }
      setUploading(true);
      try {
        const { storageKey } = await uploadCircuitToR2(file);
        const lower = file.name.toLowerCase();
        const kind: "kicad_sch" | "kicad_pcb" = lower.endsWith(".kicad_pcb")
          ? "kicad_pcb"
          : "kicad_sch";
        const res = await addProjectCircuitKicad({
          projectId,
          storageKey,
          kind,
          originalFilename: file.name,
        });
        if (res && "error" in res) {
          throw new Error(res.error);
        }
        router.refresh();
      } catch (err) {
        console.error("KiCad upload failed:", err);
        setError(
          err instanceof Error ? err.message : "Upload failed."
        );
      } finally {
        setUploading(false);
      }
    },
    [projectId, router]
  );

  return (
    <div className="inline-block">
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "+ KiCad file"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_KICAD_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
