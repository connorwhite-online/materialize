-- Scan / CAD geometry attached to a studio turn (scan-to-CAD + remix,
-- MTR-207): R2 keys under cad-geo/ plus the proxy settings they were ingested
-- with, inherited by revisions exactly like reference_images. Deliberately not
-- a files/file_assets row — studio input, not a library artifact.
-- Idempotent by convention (0039+): safe to re-apply after a partial run.
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "geometry_refs" jsonb;
