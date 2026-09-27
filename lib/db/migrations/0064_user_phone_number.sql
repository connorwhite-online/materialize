-- Buyer phone on the profile (see users.phoneNumber in lib/db/schema.ts).
--
-- CraftCloud requires a shipping phone on every order, so checkout now
-- collects one; we keep the latest on the user so it can seed phone
-- sign-in later. Unverified, nullable, no backfill: users who haven't
-- checked out since this shipped simply have none.
--
-- Idempotent per the 0039+ convention.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number" text;
