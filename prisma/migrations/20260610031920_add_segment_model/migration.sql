-- AlterTable
ALTER TABLE "shot_groups" ADD COLUMN "script_hash" TEXT;

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "segment_index" INTEGER NOT NULL,
    "start_time" REAL NOT NULL,
    "end_time" REAL NOT NULL,
    "gen_duration" REAL NOT NULL,
    "prompt" TEXT NOT NULL,
    "gen_status" TEXT NOT NULL DEFAULT 'PENDING',
    "gen_video_url" TEXT,
    "audio_key" TEXT,
    "cover_url" TEXT,
    "script_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "segments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_generation_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "shot_id" TEXT,
    "shot_group_id" TEXT,
    "segment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "prompt_snapshot" TEXT,
    "asset_snapshot" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "seedance_task_id" TEXT,
    "result_video_url" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "cost_estimate" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "generation_jobs_shot_id_fkey" FOREIGN KEY ("shot_id") REFERENCES "shots" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "generation_jobs_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "generation_jobs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_generation_jobs" ("aspect_ratio", "asset_snapshot", "cost_estimate", "created_at", "duration", "error_code", "error_message", "id", "project_id", "prompt_snapshot", "resolution", "result_video_url", "retry_count", "seedance_task_id", "shot_group_id", "shot_id", "status", "updated_at", "user_id") SELECT "aspect_ratio", "asset_snapshot", "cost_estimate", "created_at", "duration", "error_code", "error_message", "id", "project_id", "prompt_snapshot", "resolution", "result_video_url", "retry_count", "seedance_task_id", "shot_group_id", "shot_id", "status", "updated_at", "user_id" FROM "generation_jobs";
DROP TABLE "generation_jobs";
ALTER TABLE "new_generation_jobs" RENAME TO "generation_jobs";
CREATE INDEX "generation_jobs_user_id_idx" ON "generation_jobs"("user_id");
CREATE INDEX "generation_jobs_shot_id_idx" ON "generation_jobs"("shot_id");
CREATE INDEX "generation_jobs_shot_group_id_idx" ON "generation_jobs"("shot_group_id");
CREATE INDEX "generation_jobs_segment_id_idx" ON "generation_jobs"("segment_id");
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "segments_project_id_idx" ON "segments"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "segments_project_id_segment_index_key" ON "segments"("project_id", "segment_index");
