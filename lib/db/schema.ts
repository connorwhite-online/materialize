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
export const licenseEnum = pgEnum("license", [
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
  license: licenseEnum("license").notNull().default("free"),
  status: fileStatusEnum("status").notNull().default("draft"),
  tags: text("tags").array(),
  recommendedMaterialId: text("recommended_material_id"), // from our materials metadata
  designTags: text("design_tags").array(), // ["strong", "flexible", "heat-resistant", "watertight", "detailed"]
  minWallThickness: integer("min_wall_thickness"), // in 0.1mm units (e.g., 10 = 1.0mm)
  visibility: visibilityEnum("visibility").notNull().default("public"),
  downloadCount: integer("download_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  thumbnailUrl: text("thumbnail_url"),
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
  license: licenseEnum("license").notNull().default("free"),
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
  contentHash: text("content_hash"), // SHA-256 of file content for anti-piracy
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("file_assets_file_id_idx").on(table.fileId),
  index("file_assets_content_hash_idx").on(table.contentHash),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("print_orders_user_id_idx").on(table.userId),
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
