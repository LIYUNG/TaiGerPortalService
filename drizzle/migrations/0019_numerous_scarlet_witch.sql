CREATE TABLE "lead_similar_users" (
	"lead_id" text NOT NULL,
	"mongo_id" text NOT NULL,
	"reason" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_similar_users" ADD CONSTRAINT "lead_similar_users_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;