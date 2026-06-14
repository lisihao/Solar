-- CreateTable
CREATE TABLE "generated_images" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "prompt" TEXT NOT NULL,
    "enhanced_prompt" TEXT,
    "style" VARCHAR(50) NOT NULL DEFAULT 'realistic',
    "aspect_ratio" VARCHAR(10) NOT NULL DEFAULT '1:1',
    "negative_prompt" TEXT,
    "image_url" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1024,
    "height" INTEGER NOT NULL DEFAULT 1024,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'stability',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_images_user_id_idx" ON "generated_images"("user_id");

-- CreateIndex
CREATE INDEX "generated_images_created_at_idx" ON "generated_images"("created_at");

-- AddForeignKey
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
