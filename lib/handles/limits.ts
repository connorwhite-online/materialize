/**
 * Handle length bounds — shared by the client-side input constraints
 * and the server-side zod schema so the two can't drift.
 *
 * MIN_USERNAME_LENGTH must match the username minimum configured on
 * the Clerk instance (Clerk's default is 4). Clerk owns the username
 * attribute, so any value we accept but Clerk rejects surfaces as a
 * 422 at `clerkClient().users.updateUser` — i.e. a failure at the
 * very last step of onboarding, after the user has already been told
 * the handle is available. That exact mismatch (schema 3 vs Clerk 4)
 * broke onboarding during the Clerk production migration.
 *
 * To allow shorter handles, lower Clerk's minimum in the dashboard
 * FIRST (User & Authentication → Username), then this constant.
 *
 * Deliberately a plain module with no `server-only` guard: client
 * components import it for `minLength` / `maxLength`.
 */

export const MIN_USERNAME_LENGTH = 4;

export const MAX_USERNAME_LENGTH = 30;
