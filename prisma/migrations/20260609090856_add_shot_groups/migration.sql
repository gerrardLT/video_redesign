-- CreateTable
CREATE TABLE "shot_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "group_index" INTEGER NOT NULL,
    "gen_duration" REAL NOT NULL,
    "start_time" REAL NOT NULL,
    "end_time" REAL NOT NULL,
    "gen_status" TEXT NOT NULL DEFAULT 'PENDING',
    "gen_video_url" TEXT,
    "audio_key" TEXT,
    "timeline_script" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shot_groups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "generation_jobs_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_generation_jobs" ("aspect_ratio", "asset_snapshot", "cost_estimate", "created_at", "duration", "error_code", "error_message", "id", "project_id", "prompt_snapshot", "resolution", "result_video_url", "retry_count", "seedance_task_id", "shot_id", "status", "updated_at", "user_id") SELECT "aspect_ratio", "asset_snapshot", "cost_estimate", "created_at", "duration", "error_code", "error_message", "id", "project_id", "prompt_snapshot", "resolution", "result_video_url", "retry_count", "seedance_task_id", "shot_id", "status", "updated_at", "user_id" FROM "generation_jobs";
DROP TABLE "generation_jobs";
ALTER TABLE "new_generation_jobs" RENAME TO "generation_jobs";
CREATE INDEX "generation_jobs_user_id_idx" ON "generation_jobs"("user_id");
CREATE INDEX "generation_jobs_shot_id_idx" ON "generation_jobs"("shot_id");
CREATE INDEX "generation_jobs_shot_group_id_idx" ON "generation_jobs"("shot_group_id");
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs"("status");
CREATE TABLE "new_shots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "start_time" REAL NOT NULL,
    "end_time" REAL NOT NULL,
    "cover_url" TEXT,
    "scene" TEXT,
    "shot_type" TEXT,
    "camera_move" TEXT,
    "dialogue" TEXT,
    "audio_desc" TEXT,
    "prompt" TEXT,
    "gen_status" TEXT NOT NULL DEFAULT 'PENDING',
    "gen_video_url" TEXT,
    "has_face" BOOLEAN NOT NULL DEFAULT true,
    "shot_group_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shots_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_shots" ("audio_desc", "camera_move", "cover_url", "created_at", "dialogue", "end_time", "gen_status", "gen_video_url", "has_face", "id", "order_index", "project_id", "prompt", "scene", "shot_type", "start_time", "updated_at") SELECT "audio_desc", "camera_move", "cover_url", "created_at", "dialogue", "end_time", "gen_status", "gen_video_url", "has_face", "id", "order_index", "project_id", "prompt", "scene", "shot_type", "start_time", "updated_at" FROM "shots";
DROP TABLE "shots";
ALTER TABLE "new_shots" RENAME TO "shots";
CREATE INDEX "shots_project_id_idx" ON "shots"("project_id");
CREATE INDEX "shots_shot_group_id_idx" ON "shots"("shot_group_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "shot_groups_project_id_idx" ON "shot_groups"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "shot_groups_project_id_group_index_key" ON "shot_groups"("project_id", "group_index");
