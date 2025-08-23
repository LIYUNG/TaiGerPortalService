CREATE TABLE "deals" (
	"deal_id" serial PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"sales_user_id" varchar(64),
	"status" varchar(50),
	"closed_date" date,
	"deal_size_ntd" numeric(12, 2),
	"note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sales_user_id_sales_members_user_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."sales_members"("user_id") ON DELETE set null ON UPDATE no action;