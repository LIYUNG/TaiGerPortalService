ALTER TABLE "leads" ADD COLUMN "user_id" varchar(32);--> statement-breakpoint
ALTER TABLE "meeting_transcripts" DROP COLUMN "user_id";