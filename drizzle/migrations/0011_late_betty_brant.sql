ALTER TABLE "deals" RENAME COLUMN "closed_date" TO "closed_at";--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "initiated_at" timestamp;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "canceled_at" timestamp;