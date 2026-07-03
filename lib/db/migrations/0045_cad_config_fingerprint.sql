-- Config fingerprint (attribution): stamp WHICH harness configuration
-- produced each generation (per-role models, feature flags, router verdict)
-- so outcome data is analyzable by treatment — a config/model change becomes
-- a natural experiment instead of an unattributable quality drift.
-- Hand-written idempotent per the 0039+ convention (single guarded statement).
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "config_fingerprint" jsonb;
