ALTER TABLE "leads" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "full_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "gender" varchar(10);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preferred_contact" varchar(50);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "skype_id" varchar(100);--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "last_name";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "first_name_chinese";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "last_name_chinese";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "education";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "degree";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "country_interest";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "program_interest";