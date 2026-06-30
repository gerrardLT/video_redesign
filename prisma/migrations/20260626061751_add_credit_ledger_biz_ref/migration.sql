-- AlterTable
ALTER TABLE "credit_ledger" ADD COLUMN     "biz_ref_id" TEXT,
ADD COLUMN     "biz_ref_type" TEXT;

-- CreateIndex
CREATE INDEX "credit_ledger_biz_ref_type_biz_ref_id_idx" ON "credit_ledger"("biz_ref_type", "biz_ref_id");
