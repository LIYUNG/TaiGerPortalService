CREATE TABLE "sales_members" (
	"user_id" varchar(64) PRIMARY KEY NOT NULL,
	"label" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
