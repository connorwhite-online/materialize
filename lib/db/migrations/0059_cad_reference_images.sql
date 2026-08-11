-- Reference images for text-to-CAD generations (lib/cad/reference-images.ts):
-- R2 keys (cad-refs/ prefix) + media types, inherited by revisions so the
-- whole thread keeps building against the same references.
-- Idempotent by convention (0039+): safe to re-apply after a partial run.
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "reference_images" jsonb;
