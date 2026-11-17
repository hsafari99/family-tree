-- Person privacy (feedback round, docs/superpowers/specs/2026-11-17-person-privacy.md).
CREATE TYPE "public"."privacy_level" AS ENUM('public', 'branch', 'private');--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "privacy_level" "privacy_level" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "privacy_steps" integer;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "hide_birth_year" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_privacy_steps" CHECK (("persons"."privacy_level" = 'branch') = ("persons"."privacy_steps" is not null) and coalesce("persons"."privacy_steps" between 1 and 10, true));