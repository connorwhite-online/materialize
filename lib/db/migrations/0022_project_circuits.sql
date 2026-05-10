CREATE TYPE "project_circuit_kind" AS ENUM (
  'image',
  'fritzing',
  'kicad_sch',
  'kicad_pcb',
  'gerber',
  'wokwi_url'
);
--> statement-breakpoint
CREATE TABLE "project_circuits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "kind" "project_circuit_kind" NOT NULL,
  "source_storage_key" text,
  "preview_storage_key" text,
  "external_url" text,
  "original_filename" text,
  "caption" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "project_circuits_project_id_sort_idx"
  ON "project_circuits" ("project_id", "sort_order");
