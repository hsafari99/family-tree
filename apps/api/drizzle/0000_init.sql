CREATE TYPE "public"."parent_child_kind" AS ENUM('biological', 'adoptive', 'step', 'foster');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."union_status" AS ENUM('married', 'partners', 'divorced', 'separated', 'widowed');--> statement-breakpoint
CREATE TYPE "public"."union_type" AS ENUM('marriage', 'partnership');--> statement-breakpoint
CREATE TABLE "parent_child" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"union_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" "parent_child_kind" DEFAULT 'biological' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"given_name" text NOT NULL,
	"middle_name" text,
	"surname" text,
	"maiden_name" text,
	"nickname" text,
	"sex" "sex" DEFAULT 'unknown' NOT NULL,
	"birth_date" jsonb,
	"birth_sort_year" integer,
	"birth_place" text,
	"death_date" jsonb,
	"death_sort_year" integer,
	"death_place" text,
	"cause_of_death" text,
	"is_living" boolean DEFAULT true NOT NULL,
	"occupation" text,
	"education" text,
	"biography" text,
	"notes" text,
	"sibling_order" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "persons_tree_id_uq" UNIQUE("tree_id","id")
);
--> statement-breakpoint
CREATE TABLE "residences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"place" text NOT NULL,
	"from_date" jsonb,
	"to_date" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"root_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"partner_a_id" uuid,
	"partner_b_id" uuid,
	"type" "union_type" DEFAULT 'marriage' NOT NULL,
	"status" "union_status" DEFAULT 'married' NOT NULL,
	"start_date" jsonb,
	"end_date" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unions_tree_id_uq" UNIQUE("tree_id","id"),
	CONSTRAINT "unions_has_partner" CHECK ("unions"."partner_a_id" is not null or "unions"."partner_b_id" is not null),
	CONSTRAINT "unions_distinct_partners" CHECK ("unions"."partner_a_id" is null or "unions"."partner_b_id" is null or "unions"."partner_a_id" <> "unions"."partner_b_id")
);
--> statement-breakpoint
ALTER TABLE "parent_child" ADD CONSTRAINT "parent_child_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child" ADD CONSTRAINT "parent_child_union_fk" FOREIGN KEY ("tree_id","union_id") REFERENCES "public"."unions"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child" ADD CONSTRAINT "parent_child_child_fk" FOREIGN KEY ("tree_id","child_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residences" ADD CONSTRAINT "residences_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residences" ADD CONSTRAINT "residences_person_fk" FOREIGN KEY ("tree_id","person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_root_person_fk" FOREIGN KEY ("id","root_person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_partner_a_fk" FOREIGN KEY ("tree_id","partner_a_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_partner_b_fk" FOREIGN KEY ("tree_id","partner_b_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parent_child_union_child_uq" ON "parent_child" USING btree ("union_id","child_id") WHERE "parent_child"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "parent_child_child_idx" ON "parent_child" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "parent_child_tree_idx" ON "parent_child" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "persons_tree_idx" ON "persons" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "persons_tree_birth_year_idx" ON "persons" USING btree ("tree_id","birth_sort_year");--> statement-breakpoint
CREATE INDEX "persons_tree_death_year_idx" ON "persons" USING btree ("tree_id","death_sort_year");--> statement-breakpoint
CREATE INDEX "residences_person_idx" ON "residences" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "residences_tree_idx" ON "residences" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "unions_tree_idx" ON "unions" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "unions_partner_a_idx" ON "unions" USING btree ("partner_a_id");--> statement-breakpoint
CREATE INDEX "unions_partner_b_idx" ON "unions" USING btree ("partner_b_id");