import "server-only";

/**
 * Extract a user's primary email from a Clerk backend `currentUser()`
 * object. `auth()` only returns the userId, so any email-based gate
 * (lib/features.ts) needs this. Typed loosely so we don't couple to
 * Clerk's exported `User` type across SDK versions.
 */
export type ClerkUserLike = {
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id: string; emailAddress: string }>;
} | null;

export function primaryEmail(user: ClerkUserLike): string | null {
  if (!user) return null;
  const match = user.emailAddresses?.find(
    (e) => e.id === user.primaryEmailAddressId
  );
  return match?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null;
}
