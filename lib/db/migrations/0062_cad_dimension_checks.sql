-- Dimension-contract results per generation (MTR-197 annotation layer):
-- each brief dimension target checked against the built geometry, with the
-- matched topology face ids anchoring feature-level callouts in the viewer.
-- Idempotent by convention (0039+): safe to re-apply after a partial run.
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "dimension_checks" jsonb;
