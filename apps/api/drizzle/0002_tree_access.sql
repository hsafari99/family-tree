CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "branch_stewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"anchor_person_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"parent_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_stewards_user_anchor_uq" UNIQUE("tree_id","user_id","anchor_person_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"tree_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"steward_anchor_person_id" uuid,
	"target_person_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_not_owner" CHECK ("invites"."role" <> 'owner')
);
--> statement-breakpoint
CREATE TABLE "tree_members" (
	"tree_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"person_id" uuid,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_members_pk" PRIMARY KEY("tree_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "reset_links" ADD COLUMN "tree_id" uuid;--> statement-breakpoint
ALTER TABLE "branch_stewards" ADD CONSTRAINT "branch_stewards_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_stewards" ADD CONSTRAINT "branch_stewards_parent_grant_id_branch_stewards_id_fk" FOREIGN KEY ("parent_grant_id") REFERENCES "public"."branch_stewards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_stewards" ADD CONSTRAINT "branch_stewards_member_fk" FOREIGN KEY ("tree_id","user_id") REFERENCES "public"."tree_members"("tree_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_stewards" ADD CONSTRAINT "branch_stewards_anchor_fk" FOREIGN KEY ("tree_id","anchor_person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_anchor_fk" FOREIGN KEY ("tree_id","steward_anchor_person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_target_fk" FOREIGN KEY ("tree_id","target_person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_person_fk" FOREIGN KEY ("tree_id","person_id") REFERENCES "public"."persons"("tree_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_stewards_parent_idx" ON "branch_stewards" USING btree ("parent_grant_id");--> statement-breakpoint
CREATE INDEX "invites_tree_idx" ON "invites" USING btree ("tree_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tree_members_one_owner_uq" ON "tree_members" USING btree ("tree_id") WHERE "tree_members"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "tree_members_person_uq" ON "tree_members" USING btree ("tree_id","person_id") WHERE "tree_members"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "tree_members_user_idx" ON "tree_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reset_links" ADD CONSTRAINT "reset_links_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persons_created_by_idx" ON "persons" USING btree ("tree_id","created_by");