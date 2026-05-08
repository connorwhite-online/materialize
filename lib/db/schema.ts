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
  pgEnum,
  index,
  check,
  uniqueIndex,
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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

// Part photos — real-world images of printed parts

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("file_photos_file_id_idx").on(table.fileId),
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
