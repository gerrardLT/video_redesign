-- AlterTable
ALTER TABLE "assets" ADD COLUMN "expires_at" DATETIME;
ALTER TABLE "assets" ADD COLUMN "reject_reason" TEXT;

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "package_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pay_method" TEXT NOT NULL,
    "transaction_id" TEXT,
    "paid_at" DATETIME,
    "expire_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "package_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "package_orders_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "style_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "custom_description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "style_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "style_configs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "style_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "style_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "prompt_prefix" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cover_url" TEXT NOT NULL,
    "original_video_url" TEXT NOT NULL,
    "generated_video_url" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "content_safety_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL DEFAULT 'face_detection',
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "video_download_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_msg" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appearance" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "avatar_asset_url" TEXT,
    "avatar_group_id" TEXT,
    "avatar_asset_id" TEXT,
    "avatar_status" TEXT NOT NULL DEFAULT 'NONE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_characters" ("appearance", "created_at", "enabled", "id", "image_url", "name", "project_id", "updated_at") SELECT "appearance", "created_at", "enabled", "id", "image_url", "name", "project_id", "updated_at" FROM "characters";
DROP TABLE "characters";
ALTER TABLE "new_characters" RENAME TO "characters";
CREATE INDEX "characters_project_id_idx" ON "characters"("project_id");
CREATE TABLE "new_credit_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "order_id" TEXT,
    "action" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "remark" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "credit_ledger_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "credit_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "package_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_credit_ledger" ("action", "amount", "balance_after", "created_at", "id", "job_id", "remark", "user_id") SELECT "action", "amount", "balance_after", "created_at", "id", "job_id", "remark", "user_id" FROM "credit_ledger";
DROP TABLE "credit_ledger";
ALTER TABLE "new_credit_ledger" RENAME TO "credit_ledger";
CREATE INDEX "credit_ledger_user_id_idx" ON "credit_ledger"("user_id");
CREATE INDEX "credit_ledger_job_id_idx" ON "credit_ledger"("job_id");
CREATE INDEX "credit_ledger_order_id_idx" ON "credit_ledger"("order_id");
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shots" ("audio_desc", "camera_move", "cover_url", "created_at", "dialogue", "end_time", "gen_status", "gen_video_url", "id", "order_index", "project_id", "prompt", "scene", "shot_type", "start_time", "updated_at") SELECT "audio_desc", "camera_move", "cover_url", "created_at", "dialogue", "end_time", "gen_status", "gen_video_url", "id", "order_index", "project_id", "prompt", "scene", "shot_type", "start_time", "updated_at" FROM "shots";
DROP TABLE "shots";
ALTER TABLE "new_shots" RENAME TO "shots";
CREATE INDEX "shots_project_id_idx" ON "shots"("project_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "package_orders_user_id_idx" ON "package_orders"("user_id");

-- CreateIndex
CREATE INDEX "package_orders_status_idx" ON "package_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "style_configs_project_id_key" ON "style_configs"("project_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "case_items_category_idx" ON "case_items"("category");

-- CreateIndex
CREATE INDEX "case_items_is_published_idx" ON "case_items"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");

-- CreateIndex
CREATE INDEX "help_articles_section_idx" ON "help_articles"("section");

-- CreateIndex
CREATE INDEX "help_articles_is_published_idx" ON "help_articles"("is_published");

-- CreateIndex
CREATE INDEX "content_safety_logs_asset_id_idx" ON "content_safety_logs"("asset_id");

-- CreateIndex
CREATE INDEX "content_safety_logs_user_id_idx" ON "content_safety_logs"("user_id");

-- CreateIndex
CREATE INDEX "content_safety_logs_result_idx" ON "content_safety_logs"("result");

-- CreateIndex
CREATE INDEX "video_download_tasks_project_id_idx" ON "video_download_tasks"("project_id");

-- CreateIndex
CREATE INDEX "video_download_tasks_user_id_idx" ON "video_download_tasks"("user_id");

-- CreateIndex
CREATE INDEX "video_download_tasks_status_idx" ON "video_download_tasks"("status");
