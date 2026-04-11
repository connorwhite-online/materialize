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

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "pending",
  "completed",
  "refunded",
]);

export const printOrderStatusEnum = pgEnum("print_order_status", [
  "quoting",
  "cart_created",
  "ordered",
  "in_production",
  "shipped",
  "received",
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
});

export const fileAssets = pgTable("file_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  format: fileFormatEnum("format").notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  geometryData: jsonb("geometry_data").$type<{
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  }>(),
  craftCloudModelId: text("craft_cloud_model_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: text("buyer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(), // cents
  serviceFee: integer("service_fee").notNull(), // cents
  creatorPayout: integer("creator_payout").notNull(), // cents
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: purchaseStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const printOrders = pgTable("print_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileAssetId: uuid("file_asset_id")
    .notNull()
    .references(() => fileAssets.id, { onDelete: "cascade" }),
  craftCloudOrderId: text("craft_cloud_order_id"),
  craftCloudCartId: text("craft_cloud_cart_id"),
  totalPrice: integer("total_price").notNull(), // cents
  serviceFee: integer("service_fee").notNull(), // cents
  material: text("material"),
  vendor: text("vendor"),
  status: printOrderStatusEnum("status").notNull().default("quoting"),
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
});
