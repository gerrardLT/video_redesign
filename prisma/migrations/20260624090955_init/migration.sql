-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nickname" TEXT,
    "credit_balance" INTEGER NOT NULL DEFAULT 100,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "video_url" TEXT,
    "cover_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "duration" DOUBLE PRECISION,
    "aspect_ratio" TEXT,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "export_status" TEXT,
    "export_resolution" TEXT,
    "export_video_url" TEXT,
    "export_error" TEXT,
    "export_created_at" TIMESTAMP(3),
    "engine" TEXT NOT NULL DEFAULT 'seedance',
    "bgm_key" TEXT,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shots" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "start_time" DOUBLE PRECISION NOT NULL,
    "end_time" DOUBLE PRECISION NOT NULL,
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
    "character_appearances" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_groups" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "group_index" INTEGER NOT NULL,
    "gen_duration" DOUBLE PRECISION NOT NULL,
    "start_time" DOUBLE PRECISION NOT NULL,
    "end_time" DOUBLE PRECISION NOT NULL,
    "gen_status" TEXT NOT NULL DEFAULT 'PENDING',
    "gen_video_url" TEXT,
    "gen_cover_url" TEXT,
    "last_frame_url" TEXT,
    "audio_key" TEXT,
    "clip_video_url" TEXT,
    "timeline_script" TEXT,
    "script_edited" BOOLEAN NOT NULL DEFAULT false,
    "script_hash" TEXT,
    "background_image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shot_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_group_characters" (
    "id" TEXT NOT NULL,
    "shot_group_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shot_group_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appearance" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "avatar_asset_url" TEXT,
    "avatar_group_id" TEXT,
    "avatar_asset_id" TEXT,
    "avatar_status" TEXT NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "display_name" TEXT,
    "url" TEXT NOT NULL,
    "thumb_url" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "is_char_image" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_assets" (
    "id" TEXT NOT NULL,
    "shot_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "display_num" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shot_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "shot_id" TEXT,
    "shot_group_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "prompt_snapshot" TEXT,
    "asset_snapshot" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '480p',
    "seedance_task_id" TEXT,
    "result_video_url" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'seedance',
    "segment_index" INTEGER,
    "total_segments" INTEGER,
    "cost_estimate" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "order_id" TEXT,
    "project_id" TEXT,
    "subscription_order_id" TEXT,
    "action" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pay_method" TEXT NOT NULL,
    "transaction_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "expire_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_configs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "custom_description" TEXT,
    "structured_style" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "prompt_prefix" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cover_url" TEXT NOT NULL,
    "original_video_url" TEXT NOT NULL,
    "generated_video_url" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_safety_logs" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL DEFAULT 'face_detection',
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_safety_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_download_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_download_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_versions" (
    "id" TEXT NOT NULL,
    "shot_group_id" TEXT NOT NULL,
    "generation_job_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "video_url" TEXT NOT NULL,
    "cover_url" TEXT,
    "last_frame_url" TEXT,
    "prompt_snapshot" TEXT NOT NULL,
    "cost_estimate" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "welcome_wizard" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "sample_project" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "dashboard_tooltip" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "editor_guide" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "first_project_guide" TEXT NOT NULL DEFAULT 'NOT_COMPLETED',
    "reward_granted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "monthly_credits" INTEGER NOT NULL,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "privileges" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "renewal_type" TEXT NOT NULL DEFAULT 'AUTO',
    "contract_id" TEXT,
    "pay_method" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "last_renewal_date" TIMESTAMP(3),
    "total_credits_granted" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "record_id" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pay_method" TEXT NOT NULL,
    "transaction_id" TEXT,
    "contract_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "expire_at" TIMESTAMP(3) NOT NULL,
    "fail_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");

-- CreateIndex
CREATE INDEX "shots_project_id_idx" ON "shots"("project_id");

-- CreateIndex
CREATE INDEX "shots_shot_group_id_idx" ON "shots"("shot_group_id");

-- CreateIndex
CREATE INDEX "shot_groups_project_id_idx" ON "shot_groups"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "shot_groups_project_id_group_index_key" ON "shot_groups"("project_id", "group_index");

-- CreateIndex
CREATE INDEX "shot_group_characters_shot_group_id_idx" ON "shot_group_characters"("shot_group_id");

-- CreateIndex
CREATE INDEX "shot_group_characters_character_id_idx" ON "shot_group_characters"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "shot_group_characters_shot_group_id_character_id_key" ON "shot_group_characters"("shot_group_id", "character_id");

-- CreateIndex
CREATE INDEX "characters_project_id_idx" ON "characters"("project_id");

-- CreateIndex
CREATE INDEX "assets_project_id_idx" ON "assets"("project_id");

-- CreateIndex
CREATE INDEX "assets_user_id_idx" ON "assets"("user_id");

-- CreateIndex
CREATE INDEX "assets_user_id_category_idx" ON "assets"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "shot_assets_shot_id_asset_id_key" ON "shot_assets"("shot_id", "asset_id");

-- CreateIndex
CREATE INDEX "generation_jobs_user_id_idx" ON "generation_jobs"("user_id");

-- CreateIndex
CREATE INDEX "generation_jobs_shot_id_idx" ON "generation_jobs"("shot_id");

-- CreateIndex
CREATE INDEX "generation_jobs_shot_group_id_idx" ON "generation_jobs"("shot_group_id");

-- CreateIndex
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs"("status");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_idx" ON "credit_ledger"("user_id");

-- CreateIndex
CREATE INDEX "credit_ledger_job_id_idx" ON "credit_ledger"("job_id");

-- CreateIndex
CREATE INDEX "credit_ledger_order_id_idx" ON "credit_ledger"("order_id");

-- CreateIndex
CREATE INDEX "credit_ledger_project_id_idx" ON "credit_ledger"("project_id");

-- CreateIndex
CREATE INDEX "credit_ledger_subscription_order_id_idx" ON "credit_ledger"("subscription_order_id");

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

-- CreateIndex
CREATE INDEX "subscription_records_user_id_idx" ON "subscription_records"("user_id");

-- CreateIndex
CREATE INDEX "subscription_records_status_idx" ON "subscription_records"("status");

-- CreateIndex
CREATE INDEX "subscription_records_end_date_idx" ON "subscription_records"("end_date");

-- CreateIndex
CREATE INDEX "subscription_orders_user_id_idx" ON "subscription_orders"("user_id");

-- CreateIndex
CREATE INDEX "subscription_orders_record_id_idx" ON "subscription_orders"("record_id");

-- CreateIndex
CREATE INDEX "subscription_orders_status_idx" ON "subscription_orders"("status");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shots" ADD CONSTRAINT "shots_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_groups" ADD CONSTRAINT "shot_groups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_group_characters" ADD CONSTRAINT "shot_group_characters_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_group_characters" ADD CONSTRAINT "shot_group_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_assets" ADD CONSTRAINT "shot_assets_shot_id_fkey" FOREIGN KEY ("shot_id") REFERENCES "shots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_assets" ADD CONSTRAINT "shot_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_shot_id_fkey" FOREIGN KEY ("shot_id") REFERENCES "shots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "package_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_subscription_order_id_fkey" FOREIGN KEY ("subscription_order_id") REFERENCES "subscription_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_configs" ADD CONSTRAINT "style_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_configs" ADD CONSTRAINT "style_configs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "style_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_versions" ADD CONSTRAINT "generation_versions_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_versions" ADD CONSTRAINT "generation_versions_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_records" ADD CONSTRAINT "subscription_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_records" ADD CONSTRAINT "subscription_records_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "subscription_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
