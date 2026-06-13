-- DeepDive Engine v2.1 - 品牌套件系统
-- CreateTable
CREATE TABLE "brand_kits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "colors" JSONB NOT NULL,
    "fonts" JSONB NOT NULL,
    "logos" JSONB NOT NULL,
    "voice" JSONB,
    "default_style" VARCHAR(50) NOT NULL DEFAULT 'consulting',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_kits_user_id_idx" ON "brand_kits"("user_id");

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
