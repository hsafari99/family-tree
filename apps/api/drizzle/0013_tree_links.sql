CREATE TYPE "public"."tree_link_end_reason" AS ENUM('ended', 'cancelled', 'declined', 'bridge_left', 'card_unlinked', 'tree_deleted', 'expired');--> statement-breakpoint
CREATE TABLE "tree_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_a_id" uuid NOT NULL,
	"tree_b_id" uuid NOT NULL,
	"bridge_user_id" uuid NOT NULL,
	"bridge_person_a_id" uuid NOT NULL,
	"bridge_person_b_id" uuid NOT NULL,
	"proposed_by_user_id" uuid,
	"a_accepted_at" timestamp with time zone,
	"b_accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" uuid,
	"end_reason" "tree_link_end_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_links_ordered" CHECK ("tree_links"."tree_a_id" < "tree_links"."tree_b_id"),
	CONSTRAINT "tree_links_end_reason" CHECK (("tree_links"."ended_at" is null) = ("tree_links"."end_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_tree_a_id_trees_id_fk" FOREIGN KEY ("tree_a_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_tree_b_id_trees_id_fk" FOREIGN KEY ("tree_b_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_bridge_user_id_users_id_fk" FOREIGN KEY ("bridge_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_bridge_a_fk" FOREIGN KEY ("tree_a_id","bridge_person_a_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_links" ADD CONSTRAINT "tree_links_bridge_b_fk" FOREIGN KEY ("tree_b_id","bridge_person_b_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tree_links_open_pair_uq" ON "tree_links" USING btree ("tree_a_id","tree_b_id") WHERE "tree_links"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "tree_links_tree_b_idx" ON "tree_links" USING btree ("tree_b_id");