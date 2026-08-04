-- Live point-cloud morph targets: sampled surface points of the last
-- snapshot's solid (base64 LE Float32 xyz triples, ~32 KB — see
-- lib/cad/stl-points.ts). Rides beside last_snapshot so the events route can
-- re-emit the morph target on reconnect. Null when no parsable STL.
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "last_snapshot_points" text;
