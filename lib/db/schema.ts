import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  numeric,
  pgEnum,
  index,
  check,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import type { CadJobProgressEntry, CadUsageSummary } from "../cad/types";

// Enums
//
// `license` carries the CC variants, MIT, GPL-3.0, plus three legacy
// values (`free`, `personal`, `commercial`) that predate the CC switch.
// Postgres enums don't support DROP VALUE, so legacy values stay in the
// type — migration 0012 backfills rows to CC equivalents.
// `LEGACY_LICENSE_MAP` in `lib/licenses.ts` handles display of stragglers.
export const licenseEnum = pgEnum("license", [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc_by_nc_sa",
  "cc_by_nc_nd",
  "mit",
  "gpl_v3",
  "free",
  "personal",
  "commercial",
]);

export const fileStatusEnum = pgEnum("file_status", [
  "draft",
  "published",
  "archived",
]);

export const fileFormatEnum = pgEnum("file_format", [
  "stl",
  "obj",
  "3mf",
  "step",
  "amf",
]);

export const fileUnitEnum = pgEnum("file_unit", ["mm", "cm", "in"]);

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "pending",
  "completed",
  "refunded",
]);

export const visibilityEnum = pgEnum("visibility", ["public", "private"]);

// Kinds of circuit/wiring assets that can be attached to a project.
// `image` is the catch-all hobby format (PNG/SVG/JPG diagram); the
// remaining values are scaffolding for the next two phases —
// Fritzing extraction, KiCanvas embed of `.kicad_*`, and Wokwi link
// embeds. Gerber zips come last (full PCB-tier). Surfacing the enum
// up here so future migrations only have to ADD VALUE.
export const projectCircuitKindEnum = pgEnum("project_circuit_kind", [
  "image",
  "fritzing",
  "kicad_sch",
  "kicad_pcb",
  "gerber",
  "wokwi_url",
]);

export const printOrderStatusEnum = pgEnum("print_order_status", [
  "quoting",
  "cart_created",
  // Agent-initiated orders waiting for the user to approve via email link.
  // Lives between cart_created and ordered: the CraftCloud cart exists,
  // but no Stripe session has been opened yet. Cleanup jobs that prune
  // stale `cart_created` rows should leave this state alone.
  "awaiting_agent_approval",
  // Agent-initiated orders auto-charged via off-session PaymentIntent
  // because the token's spending policy permitted it. Sits between
  // payment success and CraftCloud-order placement to give the user a
  // short cancellation window (see auto_approved_until on print_orders).
  "auto_approved",
  // Two-step checkout orders (CON-118): our service fee is authorized
  // (a hold, not a charge) and the CraftCloud order is placed but
  // unpaid — the customer still has to complete CraftCloud's hosted
  // checkout. The reconciliation cron captures the fee and advances
  // the row to `ordered` once CraftCloud payment is confirmed.
  "awaiting_production_payment",
  "ordered",
  "in_production",
  "shipped",
  "received",
  "blocked",    // factory rejected — geometry issue, needs user action
  "refunded",   // refund issued after block or cancellation
  "cancelled",
]);

// Tables

// Organizations — GitHub-style team accounts. The source of truth for
// org records and memberships is Clerk Organizations; the rows here
// are a local mirror, kept in sync by `organization.*` and
// `organizationMembership.*` events in
// `app/api/webhooks/clerk/route.ts`. The mirror exists so that:
//
//   - Ownership queries (`WHERE organization_id = ?`) and member
//     joins stay in SQL on the hot path instead of round-tripping to
//     Clerk on every page render.
//   - The auth helper in `lib/authorization.ts` can resolve
//     "is this user allowed to write to this resource?" with a single
//     query that covers both user-owned and org-owned rows.
//   - Org profile pages have a stable slug to route on.
//
// Resources owned by an org carry `organizationId` set; user-owned
// rows leave it null. The existing `userId` column on those resources
// still tracks who created the row (for attribution / audit), but the
// org becomes the owner for permission purposes when both are set.
// The unified write check lives in `lib/authorization.ts`.

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), // Clerk org id (org_…)
  // URL-safe handle, mirrored from Clerk. Routed at `/o/[slug]`,
  // parallel to `/u/[username]`. Unique across all orgs.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  // Free-form description shown on the org profile page. Not part of
  // the Clerk record — owners edit it via our settings UI and we keep
  // it in our DB so the profile page can render it without an extra
  // Clerk roundtrip.
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("organizations_slug_idx").on(table.slug),
]);

// Org membership mirror — also kept in sync from Clerk webhooks. Role
// is stored as plain text (not a pgEnum) so we can absorb Clerk
// custom roles without an enum migration; `lib/authorization.ts`
// treats anything other than "admin" as "member" for write-gating.
// The webhook strips Clerk's `org:` role prefix on the way in
// (`org:admin` -> `admin`).

export const organizationMembers = pgTable("organization_members", {
  id: text("id").primaryKey(), // Clerk membership id
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("organization_members_org_user_uniq").on(
    table.organizationId,
    table.userId
  ),
  index("organization_members_user_idx").on(table.userId),
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user ID
  username: text("username").unique(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  socialLinks: jsonb("social_links").$type<
    Array<{ platform: string; url: string }>
  >(),
  stripeAccountId: text("stripe_account_id"),
  stripeOnboardingComplete: boolean("stripe_onboarding_complete")
    .notNull()
    .default(false),
  // Stripe Customer + saved off-session payment method, used for
  // agent-initiated orders that pass the per-token spending policy.
  // Both nullable — users without a card on file fall through to the
  // confirm-by-email flow regardless of token policy.
  stripeCustomerId: text("stripe_customer_id"),
  defaultPaymentMethod: text("default_payment_method"),
  // Default visibility for files uploaded through implicit flows
  // (print checkout, agent MCP uploads). Explicit dashboard
  // publishes ignore this setting.
  defaultUploadVisibility: visibilityEnum("default_upload_visibility")
    .notNull()
    .default("private"),
  // Master switch for transactional email notifications. The in-app
  // bell always works regardless; this toggle only governs email.
  // Default ON so users actually find out about activity without
  // having to hunt for the setting.
  emailNotificationsEnabled: boolean("email_notifications_enabled")
    .notNull()
    .default(true),
  // Per-event-type opt-out map. Null = use the implicit default
  // (every type ON when master is ON); a key set to `false` opts
  // that specific type out. Stored as jsonb so we can add new
  // notification types without a schema migration. Read via
  // `isEmailEventEnabled` in `lib/notifications/email-prefs.ts`.
  emailNotificationPrefs: jsonb("email_notification_prefs").$type<{
    comment_on_listing?: boolean;
    reply_to_comment?: boolean;
    build_on_file?: boolean;
    print_on_file?: boolean;
    collaborator_added_to_project?: boolean;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  // Stripe `account.updated` webhook (in `app/api/webhooks/stripe/
  // route.ts`) looks up the user by stripeAccountId only — without
  // this every Connect account event scans the full users table.
  index("users_stripe_account_id_idx").on(table.stripeAccountId),
  // Trigram GIN indexes powering the global search ILIKE on
  // username/displayName (app/api/search). Without these, every
  // substring search is a sequential scan; pg_trgm's gin_trgm_ops
  // supports both LIKE and ILIKE. The pg_trgm extension is created in
  // the same migration.
  index("users_username_trgm_idx").using(
    "gin",
    sql`${table.username} gin_trgm_ops`
  ),
  index("users_display_name_trgm_idx").using(
    "gin",
    sql`${table.displayName} gin_trgm_ops`
  ),
]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable. When set, the row is owned by an organization; the
  // `userId` above is preserved as the creator (who uploaded), but
  // `lib/authorization.ts` resolves write access against org
  // membership instead of equality against `userId`. Existing rows
  // and ad-hoc personal uploads leave this null. Cascade on org
  // delete mirrors the user-delete cascade above.
  organizationId: text("organization_id").references(
    () => organizations.id,
    { onDelete: "cascade" }
  ),
  name: text("name").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  price: integer("price").notNull().default(0), // cents, 0 = free
  currency: text("currency").notNull().default("USD"),
  license: licenseEnum("license").notNull().default("cc_by"),
  status: fileStatusEnum("status").notNull().default("draft"),
  // Where the file came from: 'upload' (user upload, the default) or
  // 'studio' (text-to-CAD draft). Plain text validated at the app
  // layer like `category`, so new sources need no migration. Studio
  // drafts stay invisible to library/profile/marketplace listings
  // until promoted — explicit Save or print checkout — per
  // docs/text-to-cad/05 §B.
  source: text("source").notNull().default("upload"),
  tags: text("tags").array(),
  // Optional curated browse category — one slug from lib/categories.
  // Plain text (not a pg enum) so the taxonomy grows without a
  // migration; validated at the app layer. Null = uncategorized.
  category: text("category"),
  recommendedMaterialId: text("recommended_material_id"), // from our materials metadata (editorial slug e.g. "pla-white")
  recommendedCcMaterialId: text("recommended_cc_material_id"), // direct CraftCloud material UUID (bypasses resolver)
  recommendedCcFinishGroupId: text("recommended_cc_finish_group_id"), // CraftCloud finish group UUID for direct vendor jump
  designTags: text("design_tags").array(), // ["strong", "flexible", "heat-resistant", "watertight", "detailed"]
  minWallThickness: integer("min_wall_thickness"), // in 0.1mm units (e.g., 10 = 1.0mm)
  visibility: visibilityEnum("visibility").notNull().default("public"),
  downloadCount: integer("download_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  thumbnailUrl: text("thumbnail_url"),
  // Optional override for the cover image — points at one of the
  // file's curator photos (filePhotos with kind='creator'). The
  // thumbnails route prefers this when set, falling back to the
  // auto-captured thumbnail at thumbnails/{fileId}.webp otherwise.
  // FK declared in the migration with ON DELETE SET NULL so the
  // column self-clears if the picked photo is deleted.
  coverPhotoId: uuid("cover_photo_id"),
  // Set when a deferred check (e.g. async geometry-hash dedup) finds
  // something that should pull this listing out of public view. The
  // server action that detects the collision flips status -> archived
  // and writes both fields together. flaggedAgainstFileId points at
  // the existing listing whose work we matched.
  flaggedReason: text("flagged_reason"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  flaggedAgainstFileId: uuid("flagged_against_file_id"),
  /**
   * Provenance edge (docs/text-to-cad/10): the file this one was derived
   * from — a remix, a studio edit seeded from an existing file, or any
   * future derivation entry point. FACTUAL and immutable by convention:
   * attribution is provenance, not ownership, so it never changes hands
   * with licensing decisions and survives the source going private
   * (SET NULL only on actual deletion; FK in the migration). No writers
   * yet — recorded from day one so the remix graph exists before the
   * remix feature does.
   */
  derivedFromFileId: uuid("derived_from_file_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("files_user_id_idx").on(table.userId),
  index("files_organization_id_idx").on(table.organizationId),
  index("files_status_idx").on(table.status),
  index("files_slug_idx").on(table.slug),
  index("files_flagged_at_idx").on(table.flaggedAt),
  index("files_category_idx").on(table.category),
  // (source, status) covers the listing-consumer exclusion of unsaved
  // studio drafts (WHERE NOT (source = 'studio' AND status = 'draft'))
  // and the GC sweep's direct lookup of them (docs/text-to-cad/05 §B/§E).
  index("files_source_status_idx").on(table.source, table.status),
  // Trigram GIN index for the global search ILIKE on files.name
  // (app/api/search) — turns substring search from a seq scan into an
  // index scan. pg_trgm extension created in the same migration.
  index("files_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  // Partial composite indexes for the hot browse queries (CON-167).
  // The WHERE clause restricts the index to publicly visible rows so
  // it stays small and the planner can use it without a residual filter.
  // (category, created_at DESC) supports ORDER BY created_at DESC with
  // an optional category = $1 equality filter.
  index("files_pub_category_created_at_idx")
    .on(table.category, table.createdAt)
    .where(
      sql`${table.status} = 'published' AND ${table.visibility} = 'public'`
    ),
  // (download_count DESC) supports the idle-browse ORDER BY download_count
  // DESC ordering without reading the full table.
  index("files_pub_download_count_idx")
    .on(table.downloadCount)
    .where(
      sql`${table.status} = 'published' AND ${table.visibility} = 'public'`
    ),
]);

// Projects — sellable bundles of files. A creator can list a single
// file directly OR group multiple files into a project that's sold as
// a unit. Buying a project grants access to every file inside it.
// File <-> project is many-to-many (a file can be reused across
// bundles); see projectFiles below.

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable org owner — same semantics as files.organizationId. When
  // set, all org members can read/write the project regardless of who
  // created it. See lib/authorization.ts.
  organizationId: text("organization_id").references(
    () => organizations.id,
    { onDelete: "cascade" }
  ),
  name: text("name").notNull(),
  description: text("description"),
  // Long-form, markdown build guide — the step-by-step "how to build
  // this" documentation, distinct from `description` (which only says
  // what the thing is). Supports inline images via markdown
  // `![](/api/thumbnails/projects/{id}?photoId={id})` URLs that resolve
  // to freshly-signed R2 links on each load. Projects only.
  buildGuide: text("build_guide"),
  slug: text("slug").notNull().unique(),
  price: integer("price").notNull().default(0), // cents, 0 = free
  currency: text("currency").notNull().default("USD"),
  license: licenseEnum("license").notNull().default("cc_by"),
  status: fileStatusEnum("status").notNull().default("draft"),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  tags: text("tags").array(),
  // Curated browse category slug from lib/categories — see files.category.
  category: text("category"),
  designTags: text("design_tags").array(),
  thumbnailUrl: text("thumbnail_url"),
  // Optional pointer to the project's source code / firmware repo
  // (GitHub, GitLab, Codeberg, etc.). Kit-style projects (a printed
  // enclosure + microcontroller + custom firmware) need a place to
  // surface the code without us hosting it ourselves.
  repoUrl: text("repo_url"),
  // Curator-picked cover image. Null = use the legacy thumbnailUrl
  // (auto-captured or first uploaded photo). Resolved via the
  // /api/thumbnails/projects/{id} route which JOINs to the picked
  // photo and signs a fresh R2 URL on each request. Mirrors the
  // pattern on files.cover_photo_id.
  coverPhotoId: uuid("cover_photo_id"),
  downloadCount: integer("download_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
  index("projects_organization_id_idx").on(table.organizationId),
  index("projects_status_idx").on(table.status),
  index("projects_slug_idx").on(table.slug),
  index("projects_category_idx").on(table.category),
  // Trigram GIN index for the global search ILIKE on projects.name.
  index("projects_name_trgm_idx").using(
    "gin",
    sql`${table.name} gin_trgm_ops`
  ),
  // Partial composite index for the hot browse query (CON-167).
  // Mirrors the files partial index: category browse + created_at sort
  // on the publicly visible subset.
  index("projects_pub_category_created_at_idx")
    .on(table.category, table.createdAt)
    .where(
      sql`${table.status} = 'published' AND ${table.visibility} = 'public'`
    ),
]);

export const projectFiles = pgTable("project_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("project_files_project_id_idx").on(table.projectId),
  index("project_files_file_id_idx").on(table.fileId),
  uniqueIndex("project_files_project_file_uniq").on(
    table.projectId,
    table.fileId
  ),
]);

// Per-project ad-hoc collaborators. Orthogonal to org ownership:
// an org-owned project ALREADY grants write access to every org
// member; this table lets the owner pull in an outside user (a
// freelancer, a teammate from another org, a friend helping on a
// personal project) without going through the full org-membership
// flow.
//
// Authorization branch lives in `lib/authorization.ts.canWriteProject`
// — a viewer passes if any of: user_id equality, org membership of
// the owning org, OR a row in this table. Read entitlement
// (lib/entitlement.ts.userOwnsProject) follows the same shape so a
// collaborator can download project files transitively.
//
// V1 is direct-add: the project owner picks a username and the
// collaborator immediately gains access (plus a notification). No
// invite/accept ceremony — we can graduate to that when there's
// demand, mirroring how org invites already work.

export const projectCollaborators = pgTable("project_collaborators", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Role is plain text + a CHECK (declared in the migration) so we
  // can add future roles (viewer, maintainer) without an enum
  // migration. canWriteProject treats anything other than "viewer"
  // as a write-capable collaborator.
  role: text("role").notNull().default("editor"),
  // Audit trail — who added this collaborator. Useful when an owner
  // wants to know "who invited Bob to this project" and for
  // surfacing the inviter on the notification email later.
  addedBy: text("added_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("project_collaborators_project_user_uniq").on(
    table.projectId,
    table.userId
  ),
  index("project_collaborators_user_idx").on(table.userId),
  check(
    "project_collaborators_role_check",
    sql`${table.role} IN ('editor', 'viewer')`
  ),
]);

export const fileAssets = pgTable("file_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }), // nullable until linked to a listing
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  format: fileFormatEnum("format").notNull(),
  fileUnit: fileUnitEnum("file_unit").notNull().default("mm"),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  geometryData: jsonb("geometry_data").$type<{
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  }>(),
  craftCloudModelId: text("craft_cloud_model_id"),
  // R2 key for the editable B-rep STEP source alongside the printable
  // mesh (MTR-196). The sidecar exports STEP on every build123d/cadquery
  // run; this is the "Download STEP (editable CAD)" artifact — a real
  // marketplace value-add vs a trinket mesh. Null for mesh-mode / sdf_kit
  // generations (no B-rep) and every non-CAD upload, so consumers must
  // treat it as optional and degrade gracefully (no dead download button).
  // Sits beside `storageKey` (the STL) and shares its lifecycle: the
  // file-delete + stale-draft GC paths delete it with the STL.
  stepStorageKey: text("step_storage_key"),
  contentHash: text("content_hash"), // SHA-256 of raw file bytes
  // Normalized geometry hash — SHA-256 over a canonical (sorted, rounded)
  // triangle list. Survives format conversion, vertex reordering, and
  // re-export by the same software. Null for formats we don't parse
  // server-side (3mf/step/amf today) or files that fail to parse.
  geometryHash: text("geometry_hash"),
  // Bumped when normalization rules change; lets us re-fingerprint
  // older rows in a backfill rather than mixing schemes in one index.
  geometryHashVersion: integer("geometry_hash_version"),
  // Coarse shape fingerprint — SHA-256 over the (volume, triangle
  // count, bbox dimensions) tuple at integer-micrometer precision.
  // Cheaper to collide than the geometry hash, useful as a soft
  // flag when the byte/geometry hashes both miss but the basic
  // shape stats line up suspiciously.
  coarseFingerprint: text("coarse_fingerprint"),
  volumeUm3: bigint("volume_um3", { mode: "number" }),
  triangleCount: integer("triangle_count"),
  bboxXUm: bigint("bbox_x_um", { mode: "number" }),
  bboxYUm: bigint("bbox_y_um", { mode: "number" }),
  bboxZUm: bigint("bbox_z_um", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("file_assets_file_id_idx").on(table.fileId),
  index("file_assets_content_hash_idx").on(table.contentHash),
  index("file_assets_geometry_hash_idx").on(table.geometryHash),
  index("file_assets_coarse_fingerprint_idx").on(table.coarseFingerprint),
]);

// A purchase grants ownership of exactly one sellable: either a
// standalone file or a project (which transitively grants its files
// via the entitlement helper). The CHECK constraint enforces the
// xor — exactly one of file_id / project_id is set.

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: text("buyer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  amount: integer("amount").notNull(), // cents
  serviceFee: integer("service_fee").notNull(), // cents
  creatorPayout: integer("creator_payout").notNull(), // cents
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: purchaseStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("purchases_buyer_id_idx").on(table.buyerId),
  index("purchases_file_id_idx").on(table.fileId),
  index("purchases_project_id_idx").on(table.projectId),
  // Stripe webhooks (`handleListingPurchase`, `handleListingRefund`)
  // look up the row by PaymentIntent id only — without this index
  // every event scans the full purchases table.
  index("purchases_stripe_payment_intent_idx").on(table.stripePaymentIntentId),
  check(
    "purchases_target_exactly_one",
    sql`(${table.fileId} IS NOT NULL AND ${table.projectId} IS NULL) OR (${table.fileId} IS NULL AND ${table.projectId} IS NOT NULL)`
  ),
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "resolved",
  "rejected",
]);

// A short-lived, server-created receipt for an upload that matched another
// creator's byte hash. Keeping the uploaded object referenced here lets the
// uploader turn it into ownership evidence without uploading the model again.
// Unclaimed receipts expire and are then eligible for the orphan-upload sweep.
export const ownershipClaimIntents = pgTable("ownership_claim_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  raisedByUserId: text("raised_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  existingFileId: uuid("existing_file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileSize: integer("file_size").notNull(),
  contentHash: text("content_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("ownership_claim_intents_user_idx").on(table.raisedByUserId),
  index("ownership_claim_intents_file_idx").on(table.existingFileId),
  index("ownership_claim_intents_expires_idx").on(table.expiresAt),
  uniqueIndex("ownership_claim_intents_active_uniq")
    .on(table.raisedByUserId, table.existingFileId, table.contentHash)
    .where(sql`${table.consumedAt} IS NULL`),
]);

// Creator-filed disputes against an auto-archived listing (see the
// geometry-collision flow), plus ownership claims raised from a blocked
// byte-identical upload. A row lands here in `open` and an email fires to
// the operator, who reviews and flips the status by hand.
export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  raisedByUserId: text("raised_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  claimIntentId: uuid("claim_intent_id").references(
    () => ownershipClaimIntents.id,
    { onDelete: "set null" }
  ),
  reason: text("reason").notNull(),
  evidencePhotoKeys: jsonb("evidence_photo_keys")
    .$type<string[]>()
    .notNull()
    .default([]),
  status: disputeStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("disputes_file_id_idx").on(table.fileId),
  index("disputes_project_id_idx").on(table.projectId),
  index("disputes_raised_by_idx").on(table.raisedByUserId),
  index("disputes_status_idx").on(table.status),
  uniqueIndex("disputes_claim_intent_uniq").on(table.claimIntentId),
  uniqueIndex("disputes_open_file_raiser_uniq")
    .on(table.fileId, table.raisedByUserId)
    .where(sql`${table.status} = 'open' AND ${table.claimIntentId} IS NOT NULL`),
  check(
    "disputes_target_exactly_one",
    sql`(${table.fileId} IS NOT NULL AND ${table.projectId} IS NULL) OR (${table.fileId} IS NULL AND ${table.projectId} IS NOT NULL)`
  ),
]);

export const printOrders = pgTable("print_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable. When set, the order was placed on behalf of an
  // organization — any member can see it on the org's orders tab.
  // Personal orders (the existing default) leave it null. The owning
  // `userId` above remains the buyer-of-record for the Stripe session
  // and the email confirmations, even on org-attributed orders.
  organizationId: text("organization_id").references(
    () => organizations.id,
    { onDelete: "set null" }
  ),
  // Nullable: legacy single-item orders have this set directly;
  // multi-item orders (Phase 1+) leave it null and use printOrderItems.
  fileAssetId: uuid("file_asset_id")
    .references(() => fileAssets.id, { onDelete: "cascade" }),
  craftCloudOrderId: text("craft_cloud_order_id"),
  craftCloudCartId: text("craft_cloud_cart_id"),
  stripeSessionId: text("stripe_session_id"),
  totalPrice: integer("total_price").notNull(), // cents
  serviceFee: integer("service_fee").notNull(), // cents
  // Breakdown of totalPrice — persisted so Stripe Checkout can show
  // print/shipping/qty as distinct line items instead of one lump.
  // Nullable for rows created before the breakdown columns existed.
  materialSubtotal: integer("material_subtotal"), // cents, unit price
  shippingSubtotal: integer("shipping_subtotal"), // cents
  quantity: integer("quantity"),
  material: text("material"),
  vendor: text("vendor"),
  // Human-readable vendor name resolved from CraftCloud's provider
  // directory at checkout time. Nullable because legacy rows predate
  // this column and the catalog lookup can miss on unknown vendors.
  vendorName: text("vendor_name"),
  status: printOrderStatusEnum("status").notNull().default("quoting"),
  shippingAddress: jsonb("shipping_address").$type<{
    email: string;
    shipping: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      phoneNumber?: string;
    };
    billing: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      phoneNumber?: string;
      isCompany: boolean;
      vatId?: string;
    };
  }>(),
  trackingInfo: jsonb("tracking_info").$type<{
    trackingUrl?: string;
    trackingNumber?: string;
    carrier?: string;
  }>(),
  // Set on agent-initiated orders (created via the MCP server). Points
  // at the PAT used to create the draft. SET NULL on token revocation
  // so we keep order history intact even after the agent is removed.
  initiatedByTokenId: uuid("initiated_by_token_id"),
  // Captured at create time (rather than joining personalAccessTokens
  // every time we render the confirmation page) so a later rename or
  // revoke of the token doesn't muddy the audit trail.
  agentName: text("agent_name"),
  // Random opaque secret embedded in the confirmation email URL. Lets
  // the user open the confirmation page from email without a session;
  // never logged or surfaced to the agent.
  confirmationToken: text("confirmation_token"),
  confirmationExpiresAt: timestamp("confirmation_expires_at", {
    withTimezone: true,
  }),
  // Per-(user, key) idempotency for create_order. Lets an agent retry
  // a tool call after a transient failure without producing a second
  // draft order.
  agentIdempotencyKey: text("agent_idempotency_key"),
  // Set on agent-initiated orders that were auto-charged. The
  // CraftCloud-placement webhook handler skips rows where this
  // timestamp is in the future, giving the user a one-click "cancel"
  // window before fulfillment proceeds. Null on every other order
  // path (anon checkout, agent confirm-by-email, etc.).
  autoApprovedUntil: timestamp("auto_approved_until", {
    withTimezone: true,
  }),
  // Set when a Stripe refund attempt failed after the order was already
  // cancelled (see cancelAutoApprovedOrder). The retry-failed-refunds cron
  // re-attempts the refund and clears this on success, so a transient
  // Stripe error can't leave a cancelled order silently charged. Null on
  // every order whose refund either succeeded or was never attempted.
  refundFailedAt: timestamp("refund_failed_at", { withTimezone: true }),
  // Which checkout architecture this order was created under (CON-118):
  // "single" (one charge via our Stripe Checkout) or "two_step" (fee
  // authorization + CraftCloud-hosted production payment). The row value
  // — not the CHECKOUT_MODEL env var — drives all lifecycle branching,
  // so flipping the env never strands in-flight orders.
  checkoutModel: text("checkout_model").notNull().default("single"),
  // Two-step only: CraftCloud-hosted Stripe session the customer pays
  // production + shipping at. Null on single-checkout orders.
  bridgeSessionId: text("bridge_session_id"),
  bridgeSessionUrl: text("bridge_session_url"),
  // Two-step only: our manual-capture PaymentIntent for the 3% service
  // fee — authorized at checkout, captured by the reconciliation cron.
  feePaymentIntentId: text("fee_payment_intent_id"),
  feeAuthorizedAt: timestamp("fee_authorized_at", { withTimezone: true }),
  feeCapturedAt: timestamp("fee_captured_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("print_orders_user_id_idx").on(table.userId),
  index("print_orders_organization_id_idx").on(table.organizationId),
  // Serves the per-minute place-auto-approved-orders cron
  // (status='auto_approved' AND auto_approved_until<=now). The leftmost
  // (status) prefix also covers the cleanup-stale-orders cron
  // (status='cart_created') and files.ts' status IN (...) filter, so one
  // composite index replaces the full-table scans on all three. (CON-78)
  index("print_orders_status_auto_approved_until_idx").on(
    table.status,
    table.autoApprovedUntil
  ),
  uniqueIndex("print_orders_confirmation_token_uniq").on(
    table.confirmationToken
  ),
  uniqueIndex("print_orders_agent_idempotency_uniq").on(
    table.userId,
    table.agentIdempotencyKey
  ),
]);

// Print order line items — committed items on a placed order.
// Multi-item orders (fileAssetId = null on printOrders) store their
// per-item detail here. Legacy single-item rows don't have children
// in this table — the code falls back to printOrders' own columns.

export const printOrderItems = pgTable("print_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  printOrderId: uuid("print_order_id")
    .notNull()
    .references(() => printOrders.id, { onDelete: "cascade" }),
  fileAssetId: uuid("file_asset_id")
    .notNull()
    .references(() => fileAssets.id, { onDelete: "cascade" }),
  quoteId: text("quote_id").notNull(),
  vendorId: text("vendor_id"),
  vendorName: text("vendor_name"),
  materialConfigId: text("material_config_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  materialSubtotal: integer("material_subtotal").notNull(), // cents, unit price
  shippingSubtotal: integer("shipping_subtotal").notNull(), // cents
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("print_order_items_order_id_idx").on(table.printOrderId),
]);

// Cart staging — pre-order items accumulated via "Add to Cart".
// Deleted when the user checks out a vendor group (items move to
// printOrderItems) or explicitly removes them.

export const cartItems = pgTable("cart_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileAssetId: uuid("file_asset_id")
    .notNull()
    .references(() => fileAssets.id, { onDelete: "cascade" }),
  quoteId: text("quote_id").notNull(),
  // CraftCloud priceId the quoteId was resolved from — lets
  // checkoutVendorGroup re-derive the authoritative per-unit price via
  // getPrice(priceId) at checkout time instead of trusting the stored
  // materialPrice (MTR-130). Nullable: rows written before this column
  // existed have no way to reconcile and are skipped (best-effort).
  priceId: text("price_id"),
  vendorId: text("vendor_id").notNull(),
  // Friendly vendor name captured at add-time so we don't have to
  // round-trip to CraftCloud's catalog on every cart render.
  vendorName: text("vendor_name"),
  materialConfigId: text("material_config_id").notNull(),
  shippingId: text("shipping_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  materialPrice: integer("material_price").notNull(), // cents, unit price
  shippingPrice: integer("shipping_price").notNull(), // cents
  currency: text("currency").notNull().default("USD"),
  countryCode: text("country_code").notNull().default("US"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("cart_items_user_id_idx").on(table.userId),
  index("cart_items_user_vendor_idx").on(table.userId, table.vendorId),
  // Race-safe dedup: a double "Add to Cart" click can otherwise pass
  // the SELECT-then-INSERT check on both requests and end up with two
  // rows for the same (file, quote). The constraint pairs with an
  // INSERT ... ON CONFLICT DO UPDATE in addToCart so the second
  // request becomes a quantity bump instead of a duplicate row.
  uniqueIndex("cart_items_user_file_quote_uniq").on(
    table.userId,
    table.fileAssetId,
    table.quoteId
  ),
]);

// Collections

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable org owner — same semantics as files.organizationId.
  organizationId: text("organization_id").references(
    () => organizations.id,
    { onDelete: "cascade" }
  ),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  tags: text("tags").array(),
  // Curated browse category slug from lib/categories — see files.category.
  category: text("category"),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("collections_user_id_idx").on(table.userId),
  index("collections_organization_id_idx").on(table.organizationId),
  index("collections_slug_idx").on(table.slug),
  index("collections_category_idx").on(table.category),
  // Trigram GIN index for the global search ILIKE on collections.name.
  index("collections_name_trgm_idx").using(
    "gin",
    sql`${table.name} gin_trgm_ops`
  ),
  // Partial composite index for the hot browse query (CON-167).
  // Collections only filter on visibility (no status column), so the
  // WHERE clause is narrower than the files/projects equivalents.
  index("collections_pub_category_created_at_idx")
    .on(table.category, table.createdAt)
    .where(sql`${table.visibility} = 'public'`),
]);

// Collection items — heterogeneous, can hold a file OR a project.
// Renamed from collection_files in migration 0003. Same xor CHECK
// pattern as purchases.

export const collectionItems = pgTable("collection_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  collectionId: uuid("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("collection_items_collection_id_idx").on(table.collectionId),
  index("collection_items_file_id_idx").on(table.fileId),
  index("collection_items_project_id_idx").on(table.projectId),
  check(
    "collection_items_target_exactly_one",
    sql`(${table.fileId} IS NOT NULL AND ${table.projectId} IS NULL) OR (${table.fileId} IS NULL AND ${table.projectId} IS NOT NULL)`
  ),
]);

// Bill of Materials — line items required to assemble a project
// beyond the printed parts (screws, electronics, magnets, etc.).
//
// Project-only by design (see plan doc). A creator with a single STL
// that needs hardware bundles into a single-file project to attach a
// BOM. This keeps file pages tight and reuses the project primitive
// as the assembly surface.
//
// Bulk-replace edit pattern: server action drops all rows for a
// project + reinserts the new list inside one transaction. Simpler
// than per-item CRUD; matches the editor UX (one form, one save).

export const projectBomItems = pgTable(
  "project_bom_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Stored as numeric so we can represent "0.5m of wire". Drizzle's
    // `mode: 'number'` returns it as a JS number — fine because the
    // realistic upper bound (100k pieces of anything) is well under
    // Number.MAX_SAFE_INTEGER and we never do exact math on quantities.
    quantity: numeric("quantity", {
      precision: 12,
      scale: 3,
      mode: "number",
    }).notNull(),
    unit: text("unit"),
    notes: text("notes"),
    sourceUrl: text("source_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_bom_items_project_id_sort_idx").on(
      table.projectId,
      table.sortOrder
    ),
  ]
);

// Circuit / wiring assets — paired with the BOM, this is the "how
// it goes together electrically" half of an assembly story. Phase 1
// here is image uploads only (PNG/SVG/JPG diagrams), but the
// schema accommodates Fritzing source files, KiCad schematic / PCB
// files, Gerber zips, and Wokwi links so subsequent phases don't
// need migrations.
//
// `sourceStorageKey` — R2 key for the uploaded source (the .fzz, the
// .kicad_sch, the gerber zip, or for image-kind the diagram itself).
// `previewStorageKey` — R2 key for a render the page can `<img>` at.
//   For `image` rows it's the same as sourceStorageKey. For source
//   formats, this is the auto-extracted thumb (Fritzing breadboard
//   SVG, KiCad page render, etc.) or a manual fallback the owner
//   uploaded alongside.
// `externalUrl` — for `wokwi_url` rows; null otherwise.
export const projectCircuits = pgTable(
  "project_circuits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: projectCircuitKindEnum("kind").notNull(),
    sourceStorageKey: text("source_storage_key"),
    previewStorageKey: text("preview_storage_key"),
    externalUrl: text("external_url"),
    originalFilename: text("original_filename"),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_circuits_project_id_sort_idx").on(
      table.projectId,
      table.sortOrder
    ),
  ]
);

// Notifications — recipient-keyed events about activity on the
// recipient's listings (their files / projects / comments). Single
// table with a `type` discriminator + JSON payload rather than a
// table per event source — keeps the schema small and lets us add
// new event types (purchases, follows, etc.) without migrations.
//
// Payload is denormalized at insert time (actor name, listing name,
// snippet, deep-link slugs). The bell renders directly from these
// fields without joining; that means a notification keeps rendering
// even after the source comment is deleted, the listing is renamed,
// or the actor changes their handle. Trade-off: a renamed listing
// still shows the old name in old notifications. Acceptable.
//
// Indexes: (user_id, created_at) for the bell's "newest N" feed,
// (user_id, read_at) for the unread count and "mark all read" path.

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Free-form text (not a pg enum) so we can introduce new types
    // without running an enum migration. Known types are documented in
    // `lib/notifications/types.ts`; validation is at the app layer.
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    index("notifications_user_read_idx").on(table.userId, table.readAt),
  ]
);

// Comments — public discussion on a file or project listing.
//
// Two parallel tables (one per target type) instead of one polymorphic
// table with a `target_type` discriminator. Same precedent as
// `purchases.fileId` vs `purchases.projectId`: separate FKs let
// Postgres enforce referential integrity (cascade on listing delete)
// and keep queries free of `WHERE target_type = ?` filters.
//
// Threading: `parentId` is a self-FK. Depth-1 only (top-level + one
// level of replies); enforced in the server action so the DB stays
// constraint-free. Replies cascade-delete with their parent.
//
// Soft-delete: `deletedAt` non-null = "deleted, render as placeholder".
// Lets threads stay coherent when an author or the listing owner
// removes a single comment from the middle of a discussion.
//
// Indexes:
//   - (file_id|project_id, parent_id, created_at) for the listing
//     render: pull all top-level rows for a file + their replies in
//     one query, ordered chronologically.
//   - (user_id, created_at) for the per-user "your comments" view.

export const fileComments = pgTable(
  "file_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "file_comments_parent_id_fk",
    }).onDelete("cascade"),
    index("file_comments_file_parent_created_idx").on(
      table.fileId,
      table.parentId,
      table.createdAt
    ),
    index("file_comments_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export const projectComments = pgTable(
  "project_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "project_comments_parent_id_fk",
    }).onDelete("cascade"),
    index("project_comments_project_parent_created_idx").on(
      table.projectId,
      table.parentId,
      table.createdAt
    ),
    index("project_comments_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
  ]
);

// Per-download log — one row per successful file download. The hot
// `files.downloadCount` counter remains the source of truth for the
// running total (cheap to read on listing pages); this table is for
// "who downloaded and when" (the file detail activity stream, future
// per-creator audit views).
//
// userId is nullable because free files allow anon downloads
// (entitlement check returns true regardless of `userId`). On user
// deletion we keep the row but null the FK so creators can still see
// historical download volume; the activity stream renders nulls as
// "Anonymous".
//
// fileAssetId is nullable for the same reason — cascading file
// deletion takes the row, but if a single asset gets removed (e.g.
// the creator swaps out an STL), we keep the historical fact that a
// download happened.

export const fileDownloads = pgTable(
  "file_downloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    fileAssetId: uuid("file_asset_id").references(() => fileAssets.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("file_downloads_file_id_created_at_idx").on(
      table.fileId,
      table.createdAt
    ),
    index("file_downloads_user_id_idx").on(table.userId),
  ]
);

// Part photos — real-world images of printed parts.
//
// Two flavors share the table:
//   - `kind = 'creator'` — owner-curated gallery shots (default,
//     preserves existing behavior).
//   - `kind = 'build'` — community build photos posted by a user who
//     has downloaded or printed the file. Posters can have userId
//     != fileId.userId.
//
// Sharing one table is the "v1 keep it simple" choice: when a real
// `Build` model with material/printer/settings/multiple-photos is
// needed, we'll graduate to a `file_builds` parent + photos as
// children, and migrate `kind='build'` rows over.

export const filePhotos = pgTable("file_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  caption: text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
  // 'creator' (curator gallery), 'build' (community post), or
  // 'inline' (image attached to a comment). Free-form text + CHECK
  // constraint instead of an enum so we can add new kinds without an
  // enum migration. Index covers the `WHERE kind = 'creator'` and
  // `WHERE kind = 'build'` paths used by the file detail page.
  kind: text("kind").notNull().default("creator"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("file_photos_file_id_idx").on(table.fileId),
  index("file_photos_file_kind_created_idx").on(
    table.fileId,
    table.kind,
    table.createdAt
  ),
  check(
    "file_photos_kind_check",
    sql`${table.kind} IN ('creator', 'build', 'inline')`
  ),
]);

// Project photos — the project-side counterpart to `file_photos`.
// Same `kind` semantics (`creator` / `build` / `inline`), same storage
// shape (R2 prefix `photos/<userId>/...`), same composer flows. Kept
// in a separate table rather than polymorphic-targeting `file_photos`
// because the cover-photo FK + cascade-on-listing-delete is far
// simpler when each listing kind has its own photos table.
//
// CHECK constraint mirrors file_photos with the wider kind set —
// 'inline' is permitted for comment-attached photos that get spliced
// into the comment body as markdown rather than showing in the
// curator gallery.

export const projectPhotos = pgTable("project_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  caption: text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
  kind: text("kind").notNull().default("creator"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("project_photos_project_id_idx").on(table.projectId),
  index("project_photos_project_kind_created_idx").on(
    table.projectId,
    table.kind,
    table.createdAt
  ),
  check(
    "project_photos_kind_check",
    sql`${table.kind} IN ('creator', 'build', 'inline')`
  ),
]);

// Personal Access Tokens — the agent-facing auth surface for the MCP
// server (see docs/mcp-server.md). Users mint a PAT in account
// settings, paste it into their agent's config, and the agent passes
// it as a Bearer token on every MCP request. We never store the raw
// token; only its SHA-256 hash plus a short visible prefix so the
// user can identify the token in the UI.
//
// Scopes are stored as a string[] (not an enum) so we can introduce
// new scopes without an enum migration. Known scopes are documented
// in lib/mcp/scopes.ts.

export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // User-supplied label. e.g. "Claude Desktop", "My CAD agent".
    name: text("name").notNull(),
    // SHA-256 (hex) of the raw token. We look tokens up by computing
    // the hash of the incoming bearer and matching this column.
    tokenHash: text("token_hash").notNull(),
    // First 16 chars of the raw token (e.g. "mtl_pat_abcd1234").
    // Shown in the UI so users can recognize which row corresponds
    // to which token without revealing the secret.
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().notNull(),
    // Optional auto-approval policy. Null = "every order needs the
    // confirm-by-email loop" (today's behavior). When set, agent
    // orders that fit within the policy are auto-charged off-session
    // and skip the email step. See docs/agent-payments.md.
    spendingPolicy: jsonb("spending_policy").$type<{
      perOrderLimitCents: number;
      periodBudgetCents: number;
      periodWindow: "day" | "week" | "month";
      confirmAboveCents?: number;
      allowedVendorIds?: string[];
      allowedMaterialIds?: string[];
      cancellationWindowMinutes?: number;
    }>(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("personal_access_tokens_user_id_idx").on(table.userId),
    uniqueIndex("personal_access_tokens_token_hash_uniq").on(table.tokenHash),
  ]
);

// Per-token spending ledger for agent-initiated auto-approved orders.
// Lets us compute "how much has this token spent in the current
// period" without scanning all of print_orders. Period boundary
// (day/week/month) is computed in app code, not stored.

export const tokenSpendingLedger = pgTable(
  "token_spending_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => personalAccessTokens.id, { onDelete: "cascade" }),
    printOrderId: uuid("print_order_id")
      .notNull()
      .references(() => printOrders.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    chargedAt: timestamp("charged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("token_spending_ledger_token_id_charged_at_idx").on(
      table.tokenId,
      table.chargedAt
    ),
  ]
);

// Webhook event-level dedup. Stripe delivers events at-least-once
// and may double-deliver across retries; the inner atomic claim in
// handlePrintOrderPayment already protects against duplicate
// CraftCloud orders, but recording event ids here lets the webhook
// route ack pure duplicates with zero downstream side effects.
// Only events we actively handle land here — other event types are
// acked but not recorded, so the table only grows with real work.

export const webhookEventsProcessed = pgTable(
  "webhook_events_processed",
  {
    // Stripe event id, e.g. "evt_1Nv...". Primary key — the unique
    // constraint is the dedup mechanism.
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_events_processed_processed_at_idx").on(table.processedAt),
  ]
);

// Text-to-CAD threads — one row per studio design conversation. The
// root generation plus every revision/fork hangs off it via
// cadGenerations.threadId, replacing the read-time parentGenerationId
// chain reconstruction (docs/text-to-cad/05 §A). `title` lives here
// going forward; the root generation's title is a legacy-read fallback
// during migration.
export const cadThreads = pgTable(
  "cad_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Thread title (agent-written or user-renamed). Null = untitled;
    // readers fall back to the root generation's title, then prompt.
    title: text("title"),
    // The first generation in the thread. FK declared in the migration
    // with ON DELETE SET NULL — cadGenerations.threadId points back at
    // this table, and declaring both directions inline trips drizzle's
    // circular type inference (same pattern as files.coverPhotoId).
    rootGenerationId: uuid("root_generation_id"),
    // Which version the thread currently "is" — defaults to the latest
    // successful generation; the user can pin an older one. FK in the
    // migration (ON DELETE SET NULL), same circularity note as above.
    activeGenerationId: uuid("active_generation_id"),
    // THE library file for this design once saved — one file per design,
    // re-pointed on re-save rather than multiplied (docs/text-to-cad/05
    // §C). Null until the first save; SET NULL if the file is later
    // deleted so the thread history survives.
    savedFileId: uuid("saved_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Composite covers the studio thread list (WHERE user_id ORDER BY
    // updated_at) and the user_id-prefix lookup.
    index("cad_threads_user_updated_idx").on(table.userId, table.updatedAt),
  ]
);

// Text-to-CAD generations (experimental, owner-only — gated by
// lib/features.ts). One row per generation attempt. This is both the
// edit-history source ("edit existing" re-prompts against a prior row's
// sourceCode via parentGenerationId) and the prompt -> code -> printed?
// data flywheel: joining fileAssetId out to printOrders tells us which
// generations a human actually accepted and ordered.
export const cadGenerationStatusEnum = pgEnum("cad_generation_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const cadGenerations = pgTable(
  "cad_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    // Short, agent-written title summarizing the whole thread. Set once on
    // the ROOT generation (parentGenerationId IS NULL) after its first
    // success; revision rows leave it null and inherit the root's title at
    // read time. Best-effort — null when the summarizer is unavailable.
    title: text("title"),
    // CAD program dialect the harness emitted (e.g. "build123d"). Plain
    // text + default so adding engines later needs no enum migration.
    engine: text("engine").notNull().default("build123d"),
    // The generated parametric source. Null while pending / on failure.
    sourceCode: text("source_code"),
    // Set on an "edit existing" generation — points at the generation
    // whose sourceCode seeded this one. Self-FK declared below.
    parentGenerationId: uuid("parent_generation_id"),
    /**
     * Provenance edge (docs/text-to-cad/10): the OTHER-thread generation
     * this one was seeded from — a cross-thread/cross-user remix, vs.
     * parentGenerationId which encodes revision structure WITHIN a thread.
     * Immutable by convention (factual attribution, not ownership). FK
     * declared in the migration with ON DELETE SET NULL. No writers yet —
     * the column exists so the remix graph is recordable from day one.
     */
    remixOfGenerationId: uuid("remix_of_generation_id"),
    // The thread this generation belongs to (docs/text-to-cad/05 §A).
    // Root generations create the thread; revisions carry it from the
    // parent. parentGenerationId still encodes the branch structure
    // WITHIN a thread. SET NULL so the generation history survives
    // thread deletion.
    threadId: uuid("thread_id").references(() => cadThreads.id, {
      onDelete: "set null",
    }),
    // The printable library asset produced on success. Null until the
    // R2 upload + createDraftFileForPrint step completes; SET NULL if the
    // asset is later deleted so the generation history survives.
    fileAssetId: uuid("file_asset_id").references(() => fileAssets.id, {
      onDelete: "set null",
    }),
    // For a multi-part assembly, the Project bundling the part files. The row's
    // fileAssetId is only the PRIMARY part, so without this the history loader
    // can't rebuild the parts on reload and an assembly collapses to one file.
    // SET NULL if the project is later deleted.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    status: cadGenerationStatusEnum("status").notNull().default("pending"),
    // Failure message surfaced back to the studio UI when status=failed.
    error: text("error"),
    // How many harness loop turns (generate -> run -> repair) it took.
    attempts: integer("attempts").notNull().default(0),
    // R2 storage key for the preview render the sidecar produced (PNG).
    // Stored in object storage like every other image — never inline — so
    // the history query stays small; a presigned URL is minted at read time.
    renderStorageKey: text("render_storage_key"),
    // Owner feedback — the in-the-moment human eval signal. `rating` is
    // "good"/"bad" (null = unrated); `feedbackTags` is a small set of
    // structured failure-mode tags (see lib/cad/feedback.ts) that make the
    // signal actionable; `feedbackNote` is freeform. This is the highest-
    // value early eval data and feeds the scorecard at /text-to-cad/eval.
    rating: text("rating"),
    feedbackTags: jsonb("feedback_tags").$type<string[]>(),
    feedbackNote: text("feedback_note"),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    // VLM aesthetic-judge aggregate (0-100), null when the judge is off or
    // unavailable. Surfaced as the average aesthetic score on the scorecard.
    aestheticScore: integer("aesthetic_score"),
    // Whether the sidecar's lossy voxel-remesh fallback produced this
    // generation's final mesh (docs/text-to-cad/02 §C). Remesh rate per
    // tier is a quality KPI on the eval scorecard — today it's invisible.
    remeshed: boolean("remeshed").notNull().default(false),
    // Design-brief intermediate the harness derived from the prompt
    // before writing code (docs/text-to-cad/06). Null when the brief
    // stage is off or the row predates it.
    brief: jsonb("brief"),
    // Per-dimension VLM aesthetic-judge scores backing aestheticScore
    // (docs/text-to-cad/07). Null when the judge is off or unavailable.
    aestheticDims: jsonb("aesthetic_dims"),
    // R2 storage key for the B-rep topology sidecar JSON (docs/
    // text-to-cad/01 phase 2). Object storage like the render — never
    // inline — so the history query stays small. Null until produced.
    topoStorageKey: text("topo_storage_key"),
    /**
     * User-attached reference images for this turn: R2 keys (cad-refs/
     * prefix) + media type, newest first, capped at 4. Revisions copy the
     * parent's list (plus anything newly attached) so the whole thread keeps
     * building against the same references (lib/cad/reference-images.ts).
     * Keys may be shared across rows of a thread — the GC sweep treats a key
     * as live while ANY row lists it. Object storage like the render — never
     * inline — so history queries stay small.
     */
    referenceImages: jsonb("reference_images").$type<
      { key: string; mediaType: string; label?: string }[]
    >(),
    /**
     * Scan / CAD geometry attached to this turn (lib/cad/geometry-refs.ts).
     * The sibling of referenceImages for GEOMETRY rather than pictures, and
     * inherited by revisions the same way, so "make the lid taller" on turn 3
     * still reaches a model that knows what it is building around.
     *
     * Deliberately NOT a files/fileAssets row: this is studio input, not a
     * library artifact, so it needs no file_format enum migration and never
     * surfaces on marketplace or library surfaces. Same GC contract as
     * referenceImages — a key is live while ANY row lists it.
     *
     * Shared with the remix/edit workflow (MTR-207): a user-uploaded STEP and
     * a phone scan are the same kind of input, differing only in the proxy
     * derivation applied to them sidecar-side.
     */
    geometryRefs: jsonb("geometry_refs").$type<
      {
        key: string;
        name: string;
        fileType: string;
        label?: string;
        captureTier?: string;
        proxyLevel?: string;
        clearanceMm?: number;
        byteSize?: number;
      }[]
    >(),
    /**
     * Instrumented construction features for the feature-chip UX
     * (extrude/fillet/chamfer/… + faceIds into topo). Small jsonb list —
     * kept on the row so the studio can render chips without a second
     * fetch. Null when the run produced none (mesh-mode / legacy).
     */
    features: jsonb("features").$type<
      {
        id: string;
        op: string;
        label: string;
        params: Record<string, number>;
        paramNames?: Record<string, string>;
        faceIds: number[];
      }[]
    >(),
    /**
     * Dual-fluid isolation verdict (networks check, MTR-179) for
     * exchanger-class generations: {pitch, components, ports, isolated,
     * minWallVoxels, plugs}. Kept on the row so the studio renders the
     * isolation badge without a second fetch. Null when the run declared no
     * fluid circuits (most parts) or predates the check.
     */
    networksReport: jsonb("networks_report").$type<{
      pitch?: number;
      components?: number;
      ports?: Record<string, number | null>;
      isolated?: boolean;
      minWallVoxels?: number | null;
      plugs?: number;
      error?: string;
    }>(),
    /**
     * Dimension-contract results (MTR-197): each brief dimension target
     * checked deterministically against the built geometry, with matched
     * topology face ids for feature-level kinds. Small jsonb list (a handful
     * of callouts) kept on the row — like `features` — so the studio renders
     * the dimension annotation layer + verified chip without a second fetch.
     * Null when the run carried no targets or predates the check.
     */
    dimensionChecks: jsonb("dimension_checks").$type<
      import("@/lib/cad/dimension-check").DimensionCheckResult[]
    >(),
    /**
     * Config fingerprint: WHICH harness configuration produced this row
     * (per-role models, flags, router verdict) — the treatment beside the
     * outcome, so quality changes are attributable (lib/cad/fingerprint.ts).
     */
    configFingerprint: jsonb("config_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite covers the history query (WHERE user_id ORDER BY created_at)
    // and the user_id-prefix lookup, so no separate user_id index needed.
    index("cad_generations_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    index("cad_generations_file_asset_id_idx").on(table.fileAssetId),
    index("cad_generations_parent_idx").on(table.parentGenerationId),
    index("cad_generations_thread_id_idx").on(table.threadId),
    foreignKey({
      columns: [table.parentGenerationId],
      foreignColumns: [table.id],
      name: "cad_generations_parent_fk",
    }).onDelete("set null"),
  ]
);

// Background job rows for text-to-CAD generation (docs/text-to-cad/02
// §A). Kept separate from cadGenerations so the generation row stays
// immutable-ish and a generation can own multiple jobs later (e.g. a
// topopt solve + verify pair as siblings). The worker polls on
// (status, createdAt); clients tail `progress` over SSE and can
// disconnect/reconnect freely — client disconnect no longer cancels.
export const cadJobStatusEnum = pgEnum("cad_job_status", [
  "queued",
  "running",
  // Mid-cycle interactive question (MTR-191): the executor emitted a `question`
  // progress event and is polling `answers` for the pick. NON-terminal — the
  // events route keeps tailing and the executor flips back to `running` once
  // the answer lands or the question times out.
  "awaiting_input",
  "done",
  "failed",
  "cancelled",
]);

export const cadJobs = pgTable(
  "cad_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => cadGenerations.id, { onDelete: "cascade" }),
    status: cadJobStatusEnum("status").notNull().default("queued"),
    // Append-only list of CadJobProgressEntry (progress events plus the
    // terminal done/error record) — the SSE replay log the events
    // endpoint serves before tailing live ones. The size cap /
    // prune-on-completion is enforced at the app layer, not here.
    progress: jsonb("progress")
      .$type<CadJobProgressEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Failure message when status=failed (mirrors cadGenerations.error).
    error: text("error"),
    /**
     * The REAL failure: exception message + stack + stage, for debugging.
     * `error` above stays the user-facing copy ("Generation failed. Please
     * try again.") — this column exists because scrubbing the message for
     * the UI used to scrub it for everyone, and diagnosing a failed job
     * meant hoping the dev console hadn't rotated. Never render to users.
     */
    errorDetail: text("error_detail"),
    // Cooperative cancellation — the cancel endpoint sets this; the
    // worker checks it between attempts and flips status to cancelled.
    cancelRequestedAt: timestamp("cancel_requested_at", {
      withTimezone: true,
    }),
    // Interactive-question answers (MTR-191): questionId -> chosen optionId,
    // written by POST /api/cad/jobs/[jobId]/answer and read by the executor's
    // awaiting_input poll (mirrors the cancelRequestedAt single-writer model —
    // the answer endpoint is the only writer, the executor the only reader).
    answers: jsonb("answers")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * Live build preview: latest in-progress render (base64 PNG) + a
     * monotonic step counter for cheap change detection. Deliberately NOT in
     * `progress` — the events route's cursor needs that array append-only,
     * and a per-exec image would bloat every read-modify-write.
     */
    lastSnapshot: text("last_snapshot"),
    snapshotStep: integer("snapshot_step").notNull().default(0),
    /**
     * Sampled surface points of the last snapshot's solid (base64 LE Float32
     * xyz triples, ~32 KB — lib/cad/stl-points.ts). Rides beside lastSnapshot
     * so the events route can re-emit the live point-cloud morph target on
     * reconnect. Null when the run produced no parsable STL.
     */
    lastSnapshotPoints: text("last_snapshot_points"),
    /**
     * Cost metering (MTR-181, docs/text-to-cad/08): RAW per-job usage —
     * model tokens per (role, model), sidecar wall time, fal invocations,
     * router verdict — written once at job termination. Raw on purpose:
     * unit prices (CAD_PRICE_*) re-compute cost from this at read time, so
     * price changes never orphan history.
     */
    usage: jsonb("usage").$type<CadUsageSummary>(),
    /**
     * Cents rollup of `usage` at the unit prices in force when the job
     * finished (lib/billing/cad-pricing.ts). A point-in-time snapshot for
     * cheap aggregation — recompute from `usage` for anything price-
     * sensitive. 0 while all CAD_PRICE_* default to 0 (metering-only).
     */
    costCents: integer("cost_cents"),
    /**
     * Flight recorder (lib/cad/transcript.ts): R2 key of the job's full
     * gzipped transcript JSON (cad-transcripts/ prefix) — every model
     * prompt/response, every sidecar exec + render, the agentic message
     * log. Object storage like the renders — never inline. Null when
     * recording is off (CAD_TRANSCRIPT=false), nothing was recorded, or
     * the upload failed (best-effort). GC: cleanup-studio-artifacts sweeps
     * cad-transcripts/ against this column.
     */
    transcriptStorageKey: text("transcript_storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("cad_jobs_generation_id_idx").on(table.generationId),
    // Covers the worker poll (WHERE status = 'queued' ORDER BY created_at).
    index("cad_jobs_status_created_idx").on(table.status, table.createdAt),
  ]
);

// Fetched-facts cache (lib/cad/repo-fetch.ts): the distilled mechanical
// fact sheet for a set of URLs a prompt linked (GitHub repo and/or
// datasheet PDFs), cached per user so re-generating against the same
// project skips the trees API, the board-file download, and the distill
// model call. `sourceUrl` is the canonical cache key (sorted URLs joined
// with a space). Rows are re-read for 7 days (app-layer TTL), then
// re-fetched and replaced; stale rows are harmless and tiny (text only).
export const cadFetchedFacts = pgTable(
  "cad_fetched_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    facts: text("facts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("cad_fetched_facts_user_url_idx").on(table.userId, table.sourceUrl),
  ]
);

// Studio credit ledger (MTR-181, docs/text-to-cad/08): one signed row per
// credit movement; a user's balance is SUM(delta) — no denormalized balance
// column to drift. Append-only by convention (corrections are new `admin`
// rows, never updates). Entirely inert unless CAD_CREDITS_ENABLED=true
// (default off): no writer runs without the flag, and credits are an
// internal unit — nothing here touches Stripe or real money.
//
// `reason` is free-form text like notifications.type (new reasons need no
// migration); known values live in lib/billing/cad-credits.ts:
//   generation           — debit for a finished generation job (delta < 0)
//   grant                — signup/monthly/plan credit grant (delta > 0)
//   print_through_refund — credit-back when a studio design reaches a paid
//                          print order (docs/text-to-cad/08 strategic
//                          alignment; delta > 0)
//   admin                — manual correction, either sign
export const cadCreditLedger = pgTable(
  "cad_credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Signed credit amount: negative = debit, positive = grant/refund.
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    // Provenance refs — SET NULL so the ledger (money-adjacent history)
    // survives deletion of what it points at.
    generationId: uuid("generation_id").references(() => cadGenerations.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => cadJobs.id, {
      onDelete: "set null",
    }),
    printOrderId: uuid("print_order_id").references(() => printOrders.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Covers balance (WHERE user_id) and per-user statement listing.
    index("cad_credit_ledger_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    // Idempotency rails: at most ONE debit per job, and at most ONE
    // print-through refund per print order — writers use
    // onConflictDoNothing against these, so retries/crons can't double-write.
    uniqueIndex("cad_credit_ledger_generation_debit_uq")
      .on(table.jobId)
      .where(sql`reason = 'generation'`),
    uniqueIndex("cad_credit_ledger_print_refund_uq")
      .on(table.printOrderId)
      .where(sql`reason = 'print_through_refund'`),
  ]
);

/**
 * Presigned-upload grants issued to UNAUTHENTICATED visitors on the
 * anon print flow.
 *
 * CraftCloud's model-upload endpoints only accept
 * `https://craftcloud3d.com` as an origin, so the browser can no
 * longer upload directly and the bytes must pass through R2 + our
 * server. Signed-in users already have that path; anon visitors had
 * no way to write to storage at all (`/api/upload/presign` is
 * authed-only, and its key is derived from the Clerk userId).
 *
 * This table is what makes issuing an unauthenticated presigned PUT
 * safe. It does two jobs:
 *
 *   1. Rate limiting. `ipHash` + `createdAt` is counted over a
 *      trailing window before a new grant is issued. It has to be
 *      persistent rather than in-memory: the route runs on serverless
 *      instances that don't share memory and cold-start freely, so an
 *      in-memory counter would reset constantly and under-count. Same
 *      reasoning as the CAD generate throttle.
 *   2. Authorization. `/api/craftcloud/upload-model` will only read an
 *      anon `anon-uploads/` key that appears here, so a caller cannot
 *      point it at an arbitrary object in the bucket. Prefix-matching
 *      alone would not give us that.
 *
 * `ipHash` is a salted SHA-256, never the raw address — this row
 * exists for abuse control, and storing visitor IPs in plaintext to
 * achieve it would be a poor trade.
 *
 * Rows are disposable. The daily orphan-cleanup cron sweeps both the
 * R2 objects and these rows once they age out.
 */
export const anonUploadGrants = pgTable(
  "anon_upload_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Salted SHA-256 of the client IP. Never the raw address. */
    ipHash: text("ip_hash").notNull(),
    /** The exact R2 key this grant authorises, under `anon-uploads/`. */
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    /** Set once the key has been consumed, so a grant is single-use. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Drives the sliding-window count in the presign route.
    index("anon_upload_grants_ip_created_idx").on(
      table.ipHash,
      table.createdAt
    ),
    // Drives the authorization lookup in upload-model, and stops the
    // same key ever being granted twice.
    uniqueIndex("anon_upload_grants_storage_key_uq").on(table.storageKey),
  ]
);
