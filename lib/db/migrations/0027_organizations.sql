-- GitHub-style organizations + memberships. Source of truth is Clerk;
-- these rows are a local mirror kept in sync by the Clerk webhook so
-- ownership joins can stay in SQL (see lib/authorization.ts).
--
-- Resources owned by an org carry organization_id set; user-owned
-- rows leave it null. The existing user_id column on those resources
-- still tracks the creator; the org becomes the owner for permission
-- purposes when both are set.

CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

CREATE TABLE "organization_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "organization_members"
	ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk"
	FOREIGN KEY ("organization_id")
	REFERENCES "public"."organizations"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "organization_members"
	ADD CONSTRAINT "organization_members_user_id_users_id_fk"
	FOREIGN KEY ("user_id")
	REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "organization_members_org_user_uniq"
	ON "organization_members" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "organization_members_user_idx"
	ON "organization_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "organizations_slug_idx"
	ON "organizations" USING btree ("slug");
--> statement-breakpoint

-- Nullable org-owner FK on each top-level resource. Null = personal
-- (existing behavior). Cascade on the listing-ish tables so a deleted
-- org takes its content; SET NULL on print_orders so a deleted org
-- doesn't wipe historical orders / refund obligations.

ALTER TABLE "files"
	ADD COLUMN "organization_id" text;
--> statement-breakpoint
ALTER TABLE "files"
	ADD CONSTRAINT "files_organization_id_organizations_id_fk"
	FOREIGN KEY ("organization_id")
	REFERENCES "public"."organizations"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "files_organization_id_idx"
	ON "files" USING btree ("organization_id");
--> statement-breakpoint

ALTER TABLE "projects"
	ADD COLUMN "organization_id" text;
--> statement-breakpoint
ALTER TABLE "projects"
	ADD CONSTRAINT "projects_organization_id_organizations_id_fk"
	FOREIGN KEY ("organization_id")
	REFERENCES "public"."organizations"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "projects_organization_id_idx"
	ON "projects" USING btree ("organization_id");
--> statement-breakpoint

ALTER TABLE "collections"
	ADD COLUMN "organization_id" text;
--> statement-breakpoint
ALTER TABLE "collections"
	ADD CONSTRAINT "collections_organization_id_organizations_id_fk"
	FOREIGN KEY ("organization_id")
	REFERENCES "public"."organizations"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "collections_organization_id_idx"
	ON "collections" USING btree ("organization_id");
--> statement-breakpoint

ALTER TABLE "print_orders"
	ADD COLUMN "organization_id" text;
--> statement-breakpoint
ALTER TABLE "print_orders"
	ADD CONSTRAINT "print_orders_organization_id_organizations_id_fk"
	FOREIGN KEY ("organization_id")
	REFERENCES "public"."organizations"("id")
	ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "print_orders_organization_id_idx"
	ON "print_orders" USING btree ("organization_id");
