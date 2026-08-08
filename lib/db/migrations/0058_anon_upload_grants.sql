-- Presigned-upload grants for UNAUTHENTICATED visitors on the anon
-- print flow.
--
-- CraftCloud's replacement model-upload endpoints only accept
-- https://craftcloud3d.com as an origin, so the browser can no longer
-- upload directly and the bytes have to pass through R2 + our server.
-- Signed-in users already had that path; anon visitors had no way to
-- write to storage at all (/api/upload/presign is authed-only and
-- derives its key from the Clerk userId).
--
-- This table is what makes handing an unauthenticated caller a
-- presigned PUT safe. Two jobs:
--   1. Rate limiting — (ip_hash, created_at) is counted over a
--      trailing window before a new grant is issued. Persistent
--      rather than in-memory because the route runs on serverless
--      instances that don't share memory and cold-start freely.
--   2. Authorization — /api/craftcloud/upload-model only reads an
--      anon-uploads/ key that appears here, so a caller can't point
--      it at an arbitrary object in the bucket.
--
-- ip_hash is a salted SHA-256, never the raw address.
--
-- Hand-written idempotent per the 0039+ convention (each statement
-- safe to re-apply; the neon-http migrator runs them over HTTP with
-- no wrapping transaction).
CREATE TABLE IF NOT EXISTS "anon_upload_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ip_hash" text NOT NULL,
  "storage_key" text NOT NULL,
  "original_filename" text NOT NULL,
  "file_size" bigint NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Drives the sliding-window count in the presign route.
CREATE INDEX IF NOT EXISTS "anon_upload_grants_ip_created_idx"
  ON "anon_upload_grants" ("ip_hash", "created_at");--> statement-breakpoint

-- Drives the authorization lookup in upload-model, and stops the same
-- key ever being granted twice.
CREATE UNIQUE INDEX IF NOT EXISTS "anon_upload_grants_storage_key_uq"
  ON "anon_upload_grants" ("storage_key");
