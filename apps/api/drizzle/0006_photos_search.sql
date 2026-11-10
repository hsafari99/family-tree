CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tree_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"storage_key_full" text NOT NULL,
	"storage_key_thumb" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_bytes_chk" CHECK ("photos"."bytes" > 0 and "photos"."width" > 0 and "photos"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "storage_deletions" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_tried_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "search_name" text GENERATED ALWAYS AS (lower(family_unaccent(given_name || ' ' || coalesce(middle_name, '') || ' ' || coalesce(surname, '') || ' ' || coalesce(maiden_name, '') || ' ' || coalesce(nickname, '')))) STORED;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_person_fk" FOREIGN KEY ("tree_id","person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_one_primary_uq" ON "photos" USING btree ("person_id") WHERE "photos"."is_primary";--> statement-breakpoint
CREATE INDEX "photos_person_idx" ON "photos" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "photos_tree_idx" ON "photos" USING btree ("tree_id");--> statement-breakpoint
CREATE INDEX "persons_search_name_trgm_idx" ON "persons" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "persons_birth_place_trgm_idx" ON "persons" USING gin (lower(family_unaccent("birth_place")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "persons_death_place_trgm_idx" ON "persons" USING gin (lower(family_unaccent("death_place")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "residences_place_trgm_idx" ON "residences" USING gin (lower(family_unaccent("place")) gin_trgm_ops);