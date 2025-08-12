CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"gender" varchar(10),
	"applicant_role" text,
	"preferred_contact" varchar(50),
	"email" varchar(255),
	"line_id" varchar(100),
	"skype_id" varchar(100),
	"phone" varchar(50),
	"source" varchar(100),
	"status" varchar(50) DEFAULT 'open',
	"tags" text,
	"notes" text,
	"user_id" varchar(32),
	"is_currently_studying" text,
	"current_year_or_graduated" text,
	"current_status" text,
	"bachelor_school" text,
	"bachelor_gpa" text,
	"bachelor_program_name" text,
	"graduated_bachelor_school" text,
	"graduated_bachelor_program" text,
	"graduated_bachelor_gpa" text,
	"master_school" text,
	"master_program_name" text,
	"master_gpa" text,
	"highest_education" text,
	"highschool_name" text,
	"highschool_gpa" text,
	"intended_programs" text,
	"intended_direction" text,
	"intended_start_time" text,
	"intended_program_level" text,
	"english_level" text,
	"german_level" text,
	"work_experience" text,
	"other_activities" text,
	"awards" text,
	"additional_info" text,
	"reason_for_germany" text,
	"reasons_to_study_abroad" text,
	"promo_code" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_transcripts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"title" varchar(255),
	"speakers" jsonb,
	"transcript_url" varchar(512),
	"participants" jsonb,
	"meeting_attendees" jsonb,
	"duration" double precision,
	"date" bigint,
	"date_string" varchar(32),
	"summary" jsonb,
	"meeting_info" jsonb,
	"is_archived" boolean DEFAULT false,
	"lead_id" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "student_embeddings" (
	"mongo_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(3072),
	"created_at" timestamp DEFAULT now(),
	"text" text,
	"full_name" text
);
--> statement-breakpoint
CREATE TABLE "lead_similar_users" (
	"lead_id" text NOT NULL,
	"mongo_id" text NOT NULL,
	"reason" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_similar_users" ADD CONSTRAINT "lead_similar_users_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;