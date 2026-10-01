-- OAuth connection rows on personal_access_tokens (see
-- personalAccessTokens.oauthClientId in lib/db/schema.ts and
-- lib/mcp/oauth.ts). ChatGPT apps and Claude connectors sign in with
-- Clerk-issued OAuth tokens; each (user, client) pair is mirrored into
-- this table so agent orders, spending policies and revocation work the
-- same as for personal access tokens.
--
-- Postgres treats NULLs as distinct, so the unique index leaves every
-- ordinary PAT row (oauth_client_id NULL) unconstrained.
--
-- Was 0066 with journal `when` 1786003200000. Renumbered after the
-- 2026-10-01 outage: preview builds migrate the shared prod DB, and that
-- `when` tied main's 0066_file_versions, so prod skipped it. Its `when`
-- now sits above 0066_file_versions (1786100000000). A preview may
-- already have applied the earlier copy, hence IF NOT EXISTS throughout.
--
-- Idempotent per the 0039+ convention.
ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "oauth_client_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "personal_access_tokens_user_oauth_client_uniq" ON "personal_access_tokens" USING btree ("user_id","oauth_client_id");
