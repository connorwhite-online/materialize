import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { NotificationType } from "./types";

export type EmailPrefMap = {
  comment_on_listing?: boolean;
  reply_to_comment?: boolean;
  make_on_file?: boolean;
  print_on_file?: boolean;
};

/**
 * Resolve whether a given notification type should fire an email for
 * the recipient. Two layers of opt-out:
 *
 *   1. `emailNotificationsEnabled` (master switch). If off → no email,
 *      regardless of per-type prefs.
 *   2. `emailNotificationPrefs[type]`. Implicit default = on. Setting
 *      a specific key to `false` opts that type out individually.
 *
 * Stored as jsonb so we can add new notification types without
 * touching the schema; the lookup just falls back to "on" for any
 * type not explicitly mapped.
 */
export function isEmailEventEnabled(
  master: boolean,
  prefs: EmailPrefMap | null | undefined,
  type: NotificationType
): boolean {
  if (!master) return false;
  if (!prefs) return true;
  return prefs[type] !== false;
}

/**
 * Look up both fields in one trip and apply the rule above. Used by
 * the notify helper before queuing an email send.
 */
export async function shouldSendEmail(
  recipientId: string,
  type: NotificationType
): Promise<boolean> {
  const [row] = await db
    .select({
      master: users.emailNotificationsEnabled,
      prefs: users.emailNotificationPrefs,
    })
    .from(users)
    .where(eq(users.id, recipientId));
  if (!row) return false;
  return isEmailEventEnabled(row.master, row.prefs, type);
}
