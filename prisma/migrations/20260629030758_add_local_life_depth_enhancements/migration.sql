-- AlterTable
ALTER TABLE "content_briefs" ADD COLUMN     "copyEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "planInputId" TEXT,
ADD COLUMN     "provenance" JSONB;

-- AlterTable
ALTER TABLE "video_variants" ADD COLUMN     "regenScope" JSONB;

-- CreateTable
CREATE TABLE "plan_generation_inputs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "acceptedNextGoals" JSONB,
    "reusePlaybookIds" JSONB,
    "avoidPlaybookIds" JSONB,
    "acceptedSummaries" JSONB NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_generation_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "platform" "PublishPlatform" NOT NULL,
    "encryptedCookie" TEXT NOT NULL,
    "authConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastCrawledAt" TIMESTAMP(3),
    "crawlIntervalH" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_queue_items" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "videoVariantId" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remindAfterH" INTEGER NOT NULL DEFAULT 24,
    "reminded" BOOLEAN NOT NULL DEFAULT false,
    "publishedPlatforms" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_notifications" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionHref" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_day_states" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_day_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_records" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currentDays" INTEGER NOT NULL DEFAULT 0,
    "currentWeeks" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TIMESTAMP(3),
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streak_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_generation_inputs_storeId_idx" ON "plan_generation_inputs"("storeId");

-- CreateIndex
CREATE INDEX "plan_generation_inputs_consumedAt_idx" ON "plan_generation_inputs"("consumedAt");

-- CreateIndex
CREATE INDEX "platform_accounts_status_idx" ON "platform_accounts"("status");

-- CreateIndex
CREATE INDEX "platform_accounts_lastCrawledAt_idx" ON "platform_accounts"("lastCrawledAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_storeId_platform_key" ON "platform_accounts"("storeId", "platform");

-- CreateIndex
CREATE INDEX "publish_queue_items_storeId_idx" ON "publish_queue_items"("storeId");

-- CreateIndex
CREATE INDEX "publish_queue_items_contentBriefId_idx" ON "publish_queue_items"("contentBriefId");

-- CreateIndex
CREATE INDEX "publish_queue_items_reminded_exportedAt_idx" ON "publish_queue_items"("reminded", "exportedAt");

-- CreateIndex
CREATE INDEX "store_notifications_storeId_read_idx" ON "store_notifications"("storeId", "read");

-- CreateIndex
CREATE INDEX "store_notifications_createdAt_idx" ON "store_notifications"("createdAt");

-- CreateIndex
CREATE INDEX "calendar_day_states_storeId_idx" ON "calendar_day_states"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_day_states_storeId_date_key" ON "calendar_day_states"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "streak_records_storeId_key" ON "streak_records"("storeId");
