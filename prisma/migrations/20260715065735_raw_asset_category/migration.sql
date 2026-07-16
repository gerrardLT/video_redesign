-- AlterTable
ALTER TABLE "raw_assets" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE INDEX "raw_assets_storeId_category_idx" ON "raw_assets"("storeId", "category");
