-- CreateTable
CREATE TABLE "raw_data" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(500),
    "data" JSONB NOT NULL,
    "resource_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_data_source_idx" ON "raw_data"("source");

-- CreateIndex
CREATE INDEX "raw_data_external_id_idx" ON "raw_data"("external_id");

-- CreateIndex
CREATE INDEX "raw_data_resource_id_idx" ON "raw_data"("resource_id");

-- CreateIndex
CREATE INDEX "raw_data_created_at_idx" ON "raw_data"("created_at");

-- CreateIndex (GIN index for JSONB data field)
CREATE INDEX "raw_data_data_gin_idx" ON "raw_data" USING GIN ("data");

-- AddForeignKey
ALTER TABLE "raw_data" ADD CONSTRAINT "raw_data_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
