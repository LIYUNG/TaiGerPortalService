ALTER TABLE "leads" RENAME COLUMN "sales_member_user_id" TO "sales_user_id";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_sales_member_user_id_sales_members_user_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sales_user_id_sales_members_user_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."sales_members"("user_id") ON DELETE set null ON UPDATE no action;