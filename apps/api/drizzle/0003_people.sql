CREATE TYPE "public"."deletion_mode" AS ENUM('person', 'descendants', 'relation');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"deleted_by_user_id" uuid,
	"mode" "deletion_mode" NOT NULL,
	"root_person_id" uuid,
	"root_union_id" uuid,
	"root_parent_child_id" uuid,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone,
	CONSTRAINT "deletion_batches_tree_id_uq" UNIQUE("tree_id","id")
);
--> statement-breakpoint
ALTER TABLE "parent_child" ADD COLUMN "deletion_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "deletion_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "unions" ADD COLUMN "deletion_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_batches" ADD CONSTRAINT "deletion_batches_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_batches" ADD CONSTRAINT "deletion_batches_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tree_created_idx" ON "audit_log" USING btree ("tree_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_person_ids_idx" ON "audit_log" USING gin ("person_ids");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "deletion_batches_tree_idx" ON "deletion_batches" USING btree ("tree_id","created_at");--> statement-breakpoint
ALTER TABLE "parent_child" ADD CONSTRAINT "parent_child_deletion_batch_fk" FOREIGN KEY ("tree_id","deletion_batch_id") REFERENCES "public"."deletion_batches"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_deletion_batch_fk" FOREIGN KEY ("tree_id","deletion_batch_id") REFERENCES "public"."deletion_batches"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_deletion_batch_fk" FOREIGN KEY ("tree_id","deletion_batch_id") REFERENCES "public"."deletion_batches"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parent_child_deletion_batch_idx" ON "parent_child" USING btree ("deletion_batch_id");--> statement-breakpoint
CREATE INDEX "persons_deletion_batch_idx" ON "persons" USING btree ("deletion_batch_id");--> statement-breakpoint
CREATE INDEX "unions_deletion_batch_idx" ON "unions" USING btree ("deletion_batch_id");