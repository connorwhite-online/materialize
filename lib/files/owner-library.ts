import { isNotNull, ne, or } from "drizzle-orm";
import { files } from "@/lib/db/schema";

/**
 * Which of an owner's own files their library shows. An archived file is
 * one the owner deleted but that couldn't be hard-deleted (a buyer or an
 * open order still points at it), so it stays out of the library. The
 * exception is a file the fingerprint check auto-archived
 * (flaggedReason set): the owner didn't do that, so it stays visible
 * with its Flagged badge until they dispute or delete it.
 */
export function shownInOwnerLibrary() {
  // Both operands are defined, so or() can't return undefined.
  return or(ne(files.status, "archived"), isNotNull(files.flaggedReason))!;
}
