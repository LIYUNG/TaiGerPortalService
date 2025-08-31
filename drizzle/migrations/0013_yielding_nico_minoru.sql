DO $$
BEGIN
	CREATE TYPE "public"."deal_status" AS ENUM ('initiated', 'sent', 'signed', 'closed', 'canceled');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "deals"
	ALTER COLUMN "status" TYPE "public"."deal_status"
	USING "status"::"public"."deal_status";