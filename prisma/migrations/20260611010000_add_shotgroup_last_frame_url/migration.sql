-- 本组生成成功时 Seedance 返回的受信尾帧 URL（returnLastFrame=true 时有值），供后续同场景承接复用
-- AlterTable
ALTER TABLE "shot_groups" ADD COLUMN "last_frame_url" TEXT;

-- 以下为既有 db push 变更的迁移追平（dev.db 已存在，仅用于让迁移历史与 schema 一致）
-- AlterTable
ALTER TABLE "credit_ledger" ADD COLUMN "project_id" TEXT;

-- AlterTable
ALTER TABLE "style_configs" ADD COLUMN "structured_style" TEXT;

-- CreateTable
CREATE TABLE "shot_group_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shot_group_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shot_group_characters_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shot_group_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "shot_group_characters_shot_group_id_idx" ON "shot_group_characters"("shot_group_id");

-- CreateIndex
CREATE INDEX "shot_group_characters_character_id_idx" ON "shot_group_characters"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "shot_group_characters_shot_group_id_character_id_key" ON "shot_group_characters"("shot_group_id", "character_id");

-- CreateIndex
CREATE INDEX "credit_ledger_project_id_idx" ON "credit_ledger"("project_id");
