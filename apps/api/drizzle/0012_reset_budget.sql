ALTER TABLE "two_factors" ADD COLUMN "reset_failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factors" ADD COLUMN "reset_locked_until" timestamp with time zone;