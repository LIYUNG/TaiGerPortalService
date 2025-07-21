CREATE TABLE "transcripts" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"title" varchar(255),
	"speakers" jsonb,
	"transcript_url" varchar(512),
	"audio_url" varchar(1024),
	"participants" jsonb,
	"meeting_attendees" jsonb,
	"duration" double precision,
	"date" bigint,
	"date_string" varchar(32),
	"summary" jsonb,
	"meeting_info" jsonb
);
