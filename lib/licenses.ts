/**
 * Creative Commons licenses for file + project listings.
 *
 * We follow the Thingiverse / Printables convention: a single license
 * picker with the seven CC variants. The same license terms apply
 * whether the file is free or paid — `price` controls cost of
 * acquisition, `license` controls what you can do after.
 *
 * Legacy values (`free`, `personal`, `commercial`) are kept in the
 * Postgres enum because Postgres can't drop enum values; rows are
 * backfilled in migration 0012. New writes only use CC ids. The
 * `LEGACY_LICENSE_MAP` exists so any straggler row still renders
 * sensibly.
 */

export const LICENSE_ORDER = [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc_by_nc_sa",
  "cc_by_nc_nd",
] as const;

export type LicenseId = (typeof LICENSE_ORDER)[number];

export type LicenseMeta = {
  id: LicenseId;
  /** Compact ID, e.g. "CC-BY". Used in sidebar pills. */
  shortName: string;
  /** Full human-readable name, e.g. "Attribution". */
  name: string;
  /** One-sentence summary suitable for a Select option subtitle. */
  summary: string;
  /** Canonical CC deed URL — links from the file detail page. */
  url: string;
  permits: {
    share: boolean;
    modify: boolean;
    commercial: boolean;
  };
  requires: {
    attribution: boolean;
    shareAlike: boolean;
    noDerivatives: boolean;
  };
};

export const LICENSES: Record<LicenseId, LicenseMeta> = {
  cc0: {
    id: "cc0",
    shortName: "CC0",
    name: "Public Domain",
    summary: "No rights reserved. Anyone may use, modify, and distribute, even commercially, without credit.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    permits: { share: true, modify: true, commercial: true },
    requires: { attribution: false, shareAlike: false, noDerivatives: false },
  },
  cc_by: {
    id: "cc_by",
    shortName: "CC-BY",
    name: "Attribution",
    summary: "Use, modify, and distribute (including commercially) with credit to the creator.",
    url: "https://creativecommons.org/licenses/by/4.0/",
    permits: { share: true, modify: true, commercial: true },
    requires: { attribution: true, shareAlike: false, noDerivatives: false },
  },
  cc_by_sa: {
    id: "cc_by_sa",
    shortName: "CC-BY-SA",
    name: "Attribution-ShareAlike",
    summary: "Use and modify with credit. Derivatives must be released under the same license.",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    permits: { share: true, modify: true, commercial: true },
    requires: { attribution: true, shareAlike: true, noDerivatives: false },
  },
  cc_by_nd: {
    id: "cc_by_nd",
    shortName: "CC-BY-ND",
    name: "Attribution-NoDerivatives",
    summary: "Distribute (including commercially) with credit. No modifications allowed.",
    url: "https://creativecommons.org/licenses/by-nd/4.0/",
    permits: { share: true, modify: false, commercial: true },
    requires: { attribution: true, shareAlike: false, noDerivatives: true },
  },
  cc_by_nc: {
    id: "cc_by_nc",
    shortName: "CC-BY-NC",
    name: "Attribution-NonCommercial",
    summary: "Use and modify non-commercially with credit.",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    permits: { share: true, modify: true, commercial: false },
    requires: { attribution: true, shareAlike: false, noDerivatives: false },
  },
  cc_by_nc_sa: {
    id: "cc_by_nc_sa",
    shortName: "CC-BY-NC-SA",
    name: "Attribution-NonCommercial-ShareAlike",
    summary: "Use and modify non-commercially with credit. Derivatives must use the same license.",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    permits: { share: true, modify: true, commercial: false },
    requires: { attribution: true, shareAlike: true, noDerivatives: false },
  },
  cc_by_nc_nd: {
    id: "cc_by_nc_nd",
    shortName: "CC-BY-NC-ND",
    name: "Attribution-NonCommercial-NoDerivatives",
    summary: "Distribute non-commercially with credit. No modifications. Most restrictive.",
    url: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    permits: { share: true, modify: false, commercial: false },
    requires: { attribution: true, shareAlike: false, noDerivatives: true },
  },
};

export const DEFAULT_LICENSE: LicenseId = "cc_by";

/**
 * Mapping for old enum values → closest CC equivalent. The migration
 * backfills rows so this should never fire for fresh data, but keeping
 * the mapping makes display robust if any straggler row exists.
 */
export const LEGACY_LICENSE_MAP: Record<string, LicenseId> = {
  free: "cc0",
  personal: "cc_by_nc",
  commercial: "cc_by",
};

/**
 * Resolve any license string (new or legacy) to its metadata. Returns
 * null for genuinely unknown values so callers can decide on fallback.
 */
export function getLicenseMeta(id: string | null | undefined): LicenseMeta | null {
  if (!id) return null;
  if (id in LICENSES) return LICENSES[id as LicenseId];
  const mapped = LEGACY_LICENSE_MAP[id];
  return mapped ? LICENSES[mapped] : null;
}

export const LICENSE_ENUM_VALUES = LICENSE_ORDER;
