ALTER TABLE "sales_members" RENAME TO "sales_reps";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_sales_user_id_sales_members_user_id_fk";
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_sales_user_id_sales_members_user_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sales_user_id_sales_reps_user_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."sales_reps"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sales_user_id_sales_reps_user_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."sales_reps"("user_id") ON DELETE set null ON UPDATE no action;