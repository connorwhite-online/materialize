-- STEP-first artifact chain (MTR-196): persist the editable B-rep STEP
-- source the sidecar already exports on every build123d/cadquery run,
-- alongside the printable STL. One nullable pointer column on file_assets
-- (sibling of `storage_key`), null for mesh-mode / sdf_kit generations and
-- every non-CAD upload so consumers degrade gracefully.
--
-- Hand-written idempotent per the 0039+ convention (single guarded statement,
-- no DO-block — the neon-http migrator runs each statement over HTTP without a
-- wrapping transaction, so a partial run must be safe to re-apply).
ALTER TABLE "file_assets" ADD COLUMN IF NOT EXISTS "step_storage_key" text;
