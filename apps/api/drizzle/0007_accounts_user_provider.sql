-- Keep the oldest login of each kind per user before the constraint (none expected: only one
-- Google account per user was ever allowed, and Better Auth keeps one credential account).
DELETE FROM "accounts" AS "newer"
USING "accounts" AS "older"
WHERE "newer"."user_id" = "older"."user_id"
  AND "newer"."provider_id" = "older"."provider_id"
  AND ("newer"."created_at", "newer"."id") > ("older"."created_at", "older"."id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_provider_uq" UNIQUE("user_id","provider_id");
