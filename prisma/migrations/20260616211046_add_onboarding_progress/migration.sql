-- CreateTable
CREATE TABLE "generation_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shot_group_id" TEXT NOT NULL,
    "generation_job_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "video_url" TEXT NOT NULL,
    "cover_url" TEXT,
    "last_frame_url" TEXT,
    "prompt_snapshot" TEXT NOT NULL,
    "cost_estimate" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generation_versions_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "generation_versions_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "welcome_wizard" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "sample_project" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "dashboard_tooltip" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "editor_guide" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "first_project_guide" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "reward_granted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "onboarding_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "video_url" TEXT,
    "cover_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PARSING',
    "duration" REAL,
    "aspect_ratio" TEXT,
    "error_msg" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "export_status" TEXT,
    "export_resolution" TEXT,
    "export_video_url" TEXT,
    "export_error" TEXT,
    "export_created_at" DATETIME,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_projects" ("aspect_ratio", "cover_url", "created_at", "duration", "error_msg", "export_created_at", "export_error", "export_resolution", "export_status", "export_video_url", "id", "name", "status", "updated_at", "user_id", "video_url") SELECT "aspect_ratio", "cover_url", "created_at", "duration", "error_msg", "export_created_at", "export_error", "export_resolution", "export_status", "export_video_url", "id", "name", "status", "updated_at", "user_id", "video_url" FROM "projects";
DROP TABLE "projects";
ALTER TABLE "new_projects" RENAME TO "projects";
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "generation_versions_generation_job_id_key" ON "generation_versions"("generation_job_id");

-- CreateIndex
CREATE INDEX "generation_versions_shot_group_id_idx" ON "generation_versions"("shot_group_id");

-- CreateIndex
CREATE INDEX "generation_versions_generation_job_id_idx" ON "generation_versions"("generation_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_versions_shot_group_id_version_number_key" ON "generation_versions"("shot_group_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_progress_user_id_key" ON "onboarding_progress"("user_id");
