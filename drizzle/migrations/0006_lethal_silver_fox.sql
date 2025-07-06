ALTER TABLE "leads" RENAME COLUMN "full_name" TO "first_name_chinese";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_name" varchar(255);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_name" varchar(255);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_name_chinese" varchar(255);