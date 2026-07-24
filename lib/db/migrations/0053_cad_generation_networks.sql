-- Dual-fluid isolation verdict (networks check, MTR-179) for exchanger-class
-- generations: {pitch, components, ports, isolated, minWallVoxels, plugs}.
-- Small jsonb kept on the generation row so the studio can render the
-- isolation badge without a second fetch. Null when the run declared no
-- fluid circuits (most parts) or predates the check.
--
-- Hand-written idempotent per the 0039+ convention.
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "networks_report" jsonb;
