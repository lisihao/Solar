-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "resource_upvotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_upvotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "resource_upvotes_user_id_idx" ON "resource_upvotes"("user_id");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "resource_upvotes_resource_id_idx" ON "resource_upvotes"("resource_id");

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "resource_upvotes_user_id_resource_id_key" ON "resource_upvotes"("user_id", "resource_id");

-- AddForeignKey (idempotent - check if constraint exists before adding)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_upvotes_user_id_fkey') THEN
        ALTER TABLE "resource_upvotes" ADD CONSTRAINT "resource_upvotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (idempotent - check if constraint exists before adding)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_upvotes_resource_id_fkey') THEN
        ALTER TABLE "resource_upvotes" ADD CONSTRAINT "resource_upvotes_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
