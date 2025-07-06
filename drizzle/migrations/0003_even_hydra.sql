CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"line_id" varchar(100),
	"education" text,
	"degree" varchar(100),
	"country_interest" varchar(255),
	"program_interest" varchar(255),
	"status" varchar(50) DEFAULT 'new',
	"source" varchar(100),
	"tags" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" varchar(32),
	"user_id" varchar(64),
	"title" varchar(255),
	"speakers" jsonb,
	"transcript_url" varchar(512),
	"participants" jsonb,
	"meeting_attendees" jsonb,
	"duration" double precision,
	"date" bigint,
	"date_string" varchar(32),
	"summary" jsonb,
	"meeting_info" jsonb
);
