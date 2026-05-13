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

// Enums
//
// `license` carries seven Creative Commons variants plus three
// legacy values (`free`, `personal`, `commercial`) that predate the
// CC switch. Postgres enums don't support DROP VALUE, so the legacy
// values stay in the type — migration 0012 backfills every row to a
// CC equivalent, and the upload + edit forms only offer CC ids
// going forward, so legacy values shouldn't appear on new rows.
// `LEGACY_LICENSE_MAP` in `lib/licenses.ts` handles display of any
// straggler.
export const licenseEnum = pgEnum("license", [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc_by_nc_sa",
  "cc_by_nc_nd",
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
  "ordered",
  "in_production",
  "shipped",
  "received",
  "blocked",    // factory rejected — geometry issue, needs user action
  "refunded",   // refund issued after block or cancellation
  "cancelled",
]);

// Tables

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
]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  price: integer("price").notNull().default(0), // cents, 0 = free
  currency: text("currency").notNull().default("USD"),
  license: licenseEnum("license").notNull().default("cc_by"),
  status: fileStatusEnum("status").notNull().default("draft"),
  tags: text("tags").array(),
  recommendedMaterialId: text("recommended_material_id"), // from our materials metadata
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("files_user_id_idx").on(table.userId),
  index("files_status_idx").on(table.status),
  index("files_slug_idx").on(table.slug),
  index("files_flagged_at_idx").on(table.flaggedAt),
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
  name: text("name").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  price: integer("price").notNull().default(0), // cents, 0 = free
  currency: text("currency").notNull().default("USD"),
  license: licenseEnum("license").notNull().default("cc_by"),
  status: fileStatusEnum("status").notNull().default("draft"),
  visibility: visibilityEnum("visibility").notNull().default("public"),
  tags: text("tags").array(),
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
  index("projects_status_idx").on(table.status),
  index("projects_slug_idx").on(table.slug),
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

export const printOrders = pgTable("print_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("print_orders_user_id_idx").on(table.userId),
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
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  tags: text("tags").array(),
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
  index("collections_slug_idx").on(table.slug),
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
    // Free-form text + CHECK so we can introduce new types without
    // running an enum migration. Known types are documented in
    // `lib/notifications/types.ts`.
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
