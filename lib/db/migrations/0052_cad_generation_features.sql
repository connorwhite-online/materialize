-- Construction-feature list for the B-rep feature-chip UX (extrude /
-- fillet / chamfer / … with faceIds into the topo sidecar). Small jsonb
-- kept on the generation row so the studio can render chips without a
-- second fetch. Null on mesh-mode / legacy rows.
--
-- Hand-written idempotent per the 0039+ convention.
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "features" jsonb;
