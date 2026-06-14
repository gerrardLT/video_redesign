-- 移除 ShotGroup.firstFrameUrl 死字段（缺陷 13）
-- first_frame 流程已全面废弃，人物一致性改由 asset:// 人物锚定图作 reference_image 承载。
-- SQLite 不支持直接 DROP COLUMN，采用 Prisma 标准「重建表」模式：新建不含 first_frame_url 的表，
-- 拷贝全部既有数据后替换原表（数据无损，仅删除 first_frame_url 列）。
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shot_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "group_index" INTEGER NOT NULL,
    "gen_duration" REAL NOT NULL,
    "start_time" REAL NOT NULL,
    "end_time" REAL NOT NULL,
    "gen_status" TEXT NOT NULL DEFAULT 'PENDING',
    "gen_video_url" TEXT,
    "audio_key" TEXT,
    "clip_video_url" TEXT,
    "timeline_script" TEXT,
    "script_edited" BOOLEAN NOT NULL DEFAULT false,
    "script_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shot_groups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shot_groups" ("audio_key", "clip_video_url", "created_at", "end_time", "gen_duration", "gen_status", "gen_video_url", "group_index", "id", "project_id", "script_edited", "script_hash", "start_time", "timeline_script", "updated_at") SELECT "audio_key", "clip_video_url", "created_at", "end_time", "gen_duration", "gen_status", "gen_video_url", "group_index", "id", "project_id", "script_edited", "script_hash", "start_time", "timeline_script", "updated_at" FROM "shot_groups";
DROP TABLE "shot_groups";
ALTER TABLE "new_shot_groups" RENAME TO "shot_groups";
CREATE INDEX "shot_groups_project_id_idx" ON "shot_groups"("project_id");
CREATE UNIQUE INDEX "shot_groups_project_id_group_index_key" ON "shot_groups"("project_id", "group_index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
