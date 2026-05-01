-- Mesh fingerprinting columns. Layered defenses on top of the existing
-- byte-equal SHA-256 (`content_hash`) so we can also catch re-exports,
-- format conversions, and visually-suspicious near-duplicates.
--
-- Population strategy: written at upload time by the file-listing and
-- print-flow paths in app/actions/files.ts when the format is parseable
-- server-side (stl, obj). Other formats stay null and fall back to the
-- byte-hash check; we'll backfill via a worker once we add 3mf parsing.
ALTER TABLE "file_assets"
  ADD COLUMN "geometry_hash" text,
  ADD COLUMN "geometry_hash_version" integer,
  ADD COLUMN "coarse_fingerprint" text,
  ADD COLUMN "volume_um3" bigint,
  ADD COLUMN "triangle_count" integer,
  ADD COLUMN "bbox_x_um" bigint,
  ADD COLUMN "bbox_y_um" bigint,
  ADD COLUMN "bbox_z_um" bigint;
--> statement-breakpoint
CREATE INDEX "file_assets_geometry_hash_idx"
  ON "file_assets" USING btree ("geometry_hash");
--> statement-breakpoint
CREATE INDEX "file_assets_coarse_fingerprint_idx"
  ON "file_assets" USING btree ("coarse_fingerprint");
