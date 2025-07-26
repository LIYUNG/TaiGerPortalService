CREATE TABLE "student_embeddings" (
	"mongo_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(3072),
	"created_at" timestamp DEFAULT now(),
	"text" text,
	"full_name" text
);
