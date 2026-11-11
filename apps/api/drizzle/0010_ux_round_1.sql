-- UX round 1 (brief #11, #16): parents-unknown unions and each partner's saved union order.
-- Not reversible: once a partnerless parents-unknown row exists it cannot satisfy the old CHECK.
ALTER TABLE "unions" DROP CONSTRAINT "unions_has_partner";--> statement-breakpoint
ALTER TABLE "unions" ADD COLUMN "parents_unknown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unions" ADD COLUMN "partner_a_order" integer;--> statement-breakpoint
ALTER TABLE "unions" ADD COLUMN "partner_b_order" integer;--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_has_partner" CHECK ("unions"."partner_a_id" is not null or "unions"."partner_b_id" is not null or "unions"."parents_unknown");