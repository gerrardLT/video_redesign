-- CreateEnum
CREATE TYPE "MerchantIndustry" AS ENUM ('RESTAURANT', 'DRINK', 'BAKERY', 'CAFE', 'HOTPOT', 'BBQ', 'FAST_FOOD', 'OTHER_LOCAL');

-- CreateEnum
CREATE TYPE "ContentGoal" AS ENUM ('TRAFFIC', 'PROMOTION', 'NEW_PRODUCT', 'TRUST_BUILDING', 'BRAND_STORY', 'CUSTOMER_TESTIMONIAL', 'WEEKEND_BOOST', 'REPEAT_PURCHASE');

-- CreateEnum
CREATE TYPE "ContentBriefStatus" AS ENUM ('DRAFT', 'READY_TO_SHOOT', 'MATERIALS_UPLOADED', 'RENDERING', 'GENERATED', 'COMPLIANCE_REVIEW', 'READY_TO_EXPORT', 'EXPORTED', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ShotTaskType" AS ENUM ('STOREFRONT', 'PRODUCT_CLOSEUP', 'COOKING_PROCESS', 'STAFF_ACTION', 'CUSTOMER_REACTION', 'OWNER_TALKING', 'ENVIRONMENT', 'OFFER_DISPLAY', 'CTA_SCREEN', 'AI_GENERATED_FILLER');

-- CreateEnum
CREATE TYPE "VideoVariantType" AS ENUM ('PROMOTION', 'ATMOSPHERE', 'OWNER_TALKING', 'TRUST', 'PRODUCT');

-- CreateEnum
CREATE TYPE "ComplianceRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PublishPlatform" AS ENUM ('DOUYIN', 'KUAISHOU', 'XIAOHONGSHU', 'WECHAT_CHANNELS', 'MANUAL_EXPORT');

-- CreateEnum
CREATE TYPE "PublishJobStatus" AS ENUM ('DRAFT', 'READY', 'EXPORTING', 'EXPORTED', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "industry" "MerchantIndustry" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" "MerchantIndustry" NOT NULL,
    "city" TEXT,
    "district" TEXT,
    "businessArea" TEXT,
    "address" TEXT,
    "avgTicket" INTEGER,
    "openingHours" TEXT,
    "phone" TEXT,
    "mainProducts" JSONB NOT NULL,
    "mainSellingPoints" JSONB NOT NULL,
    "targetCustomers" JSONB,
    "brandTone" TEXT,
    "canShootKitchen" BOOLEAN NOT NULL DEFAULT false,
    "canShootStaff" BOOLEAN NOT NULL DEFAULT true,
    "canShootCustomers" BOOLEAN NOT NULL DEFAULT false,
    "hasGroupBuying" BOOLEAN NOT NULL DEFAULT false,
    "hasReservation" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_profiles" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contentPositioning" TEXT,
    "recommendedPersona" TEXT,
    "contentDos" JSONB,
    "contentDonts" JSONB,
    "visualStyle" TEXT,
    "hookKeywords" JSONB,
    "forbiddenClaims" JSONB,
    "preferredCta" JSONB,
    "weeklyCadence" JSONB,
    "aiSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_offers" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "originalPrice" INTEGER,
    "salePrice" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "sellingPoints" JSONB,
    "usageRules" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playbooks" (
    "id" TEXT NOT NULL,
    "industry" "MerchantIndustry" NOT NULL,
    "name" TEXT NOT NULL,
    "goal" "ContentGoal" NOT NULL,
    "description" TEXT,
    "structure" JSONB NOT NULL,
    "requiredShots" JSONB NOT NULL,
    "optionalShots" JSONB,
    "hookTemplates" JSONB NOT NULL,
    "captionTemplates" JSONB NOT NULL,
    "coverTitleTemplates" JSONB NOT NULL,
    "ctaTemplates" JSONB NOT NULL,
    "complianceRules" JSONB,
    "scoreWeight" JSONB,
    "tierRequired" TEXT NOT NULL DEFAULT 'FREE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_plans" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "strategy" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_briefs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contentPlanId" TEXT,
    "playbookId" TEXT,
    "title" TEXT NOT NULL,
    "goal" "ContentGoal" NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "status" "ContentBriefStatus" NOT NULL DEFAULT 'DRAFT',
    "hook" TEXT,
    "mainMessage" TEXT,
    "offerId" TEXT,
    "suggestedCaption" TEXT,
    "suggestedTitle" TEXT,
    "suggestedCoverTitle" TEXT,
    "suggestedCta" TEXT,
    "platformCopies" JSONB,
    "tags" JSONB,
    "aiReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shot_tasks" (
    "id" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "ShotTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "examplePrompt" TEXT,
    "durationSec" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "framingGuide" JSONB,
    "qualityRules" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shot_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_assets" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shotTaskId" TEXT,
    "uploaderUserId" TEXT,
    "type" TEXT NOT NULL,
    "ossKey" TEXT NOT NULL,
    "url" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnailKey" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "qualityReport" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_variants" (
    "id" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "type" "VideoVariantType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ossKey" TEXT,
    "coverOssKey" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "subtitles" JSONB,
    "renderParams" JSONB,
    "generationLog" JSONB,
    "score" DOUBLE PRECISION,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_jobs" (
    "id" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "videoVariantId" TEXT,
    "platform" "PublishPlatform" NOT NULL,
    "status" "PublishJobStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "caption" TEXT,
    "tags" JSONB,
    "locationText" TEXT,
    "exportedOssKey" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "publish_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_metrics" (
    "id" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "platform" "PublishPlatform" NOT NULL,
    "publishJobId" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" TEXT NOT NULL,
    "contentBriefId" TEXT NOT NULL,
    "videoVariantId" TEXT,
    "riskLevel" "ComplianceRiskLevel" NOT NULL,
    "issues" JSONB NOT NULL,
    "suggestions" JSONB,
    "blockedReasons" JSONB,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "personName" TEXT,
    "personRole" TEXT,
    "consentType" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "assetOssKey" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_userId_key" ON "merchants"("userId");

-- CreateIndex
CREATE INDEX "merchants_userId_idx" ON "merchants"("userId");

-- CreateIndex
CREATE INDEX "merchants_industry_idx" ON "merchants"("industry");

-- CreateIndex
CREATE INDEX "stores_merchantId_idx" ON "stores"("merchantId");

-- CreateIndex
CREATE INDEX "stores_industry_idx" ON "stores"("industry");

-- CreateIndex
CREATE INDEX "stores_city_district_idx" ON "stores"("city", "district");

-- CreateIndex
CREATE UNIQUE INDEX "store_profiles_storeId_key" ON "store_profiles"("storeId");

-- CreateIndex
CREATE INDEX "product_offers_storeId_idx" ON "product_offers"("storeId");

-- CreateIndex
CREATE INDEX "product_offers_isActive_idx" ON "product_offers"("isActive");

-- CreateIndex
CREATE INDEX "playbooks_industry_idx" ON "playbooks"("industry");

-- CreateIndex
CREATE INDEX "playbooks_goal_idx" ON "playbooks"("goal");

-- CreateIndex
CREATE INDEX "playbooks_isActive_idx" ON "playbooks"("isActive");

-- CreateIndex
CREATE INDEX "content_plans_storeId_idx" ON "content_plans"("storeId");

-- CreateIndex
CREATE INDEX "content_plans_startDate_endDate_idx" ON "content_plans"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "content_briefs_storeId_idx" ON "content_briefs"("storeId");

-- CreateIndex
CREATE INDEX "content_briefs_scheduledDate_idx" ON "content_briefs"("scheduledDate");

-- CreateIndex
CREATE INDEX "content_briefs_status_idx" ON "content_briefs"("status");

-- CreateIndex
CREATE INDEX "content_briefs_contentPlanId_idx" ON "content_briefs"("contentPlanId");

-- CreateIndex
CREATE INDEX "shot_tasks_contentBriefId_idx" ON "shot_tasks"("contentBriefId");

-- CreateIndex
CREATE INDEX "shot_tasks_order_idx" ON "shot_tasks"("order");

-- CreateIndex
CREATE INDEX "raw_assets_storeId_idx" ON "raw_assets"("storeId");

-- CreateIndex
CREATE INDEX "raw_assets_shotTaskId_idx" ON "raw_assets"("shotTaskId");

-- CreateIndex
CREATE INDEX "raw_assets_expiresAt_idx" ON "raw_assets"("expiresAt");

-- CreateIndex
CREATE INDEX "video_variants_contentBriefId_idx" ON "video_variants"("contentBriefId");

-- CreateIndex
CREATE INDEX "video_variants_type_idx" ON "video_variants"("type");

-- CreateIndex
CREATE INDEX "publish_jobs_contentBriefId_idx" ON "publish_jobs"("contentBriefId");

-- CreateIndex
CREATE INDEX "publish_jobs_platform_idx" ON "publish_jobs"("platform");

-- CreateIndex
CREATE INDEX "publish_jobs_status_idx" ON "publish_jobs"("status");

-- CreateIndex
CREATE INDEX "publish_metrics_contentBriefId_idx" ON "publish_metrics"("contentBriefId");

-- CreateIndex
CREATE INDEX "publish_metrics_platform_idx" ON "publish_metrics"("platform");

-- CreateIndex
CREATE INDEX "publish_metrics_capturedAt_idx" ON "publish_metrics"("capturedAt");

-- CreateIndex
CREATE INDEX "compliance_checks_contentBriefId_idx" ON "compliance_checks"("contentBriefId");

-- CreateIndex
CREATE INDEX "compliance_checks_videoVariantId_idx" ON "compliance_checks"("videoVariantId");

-- CreateIndex
CREATE INDEX "compliance_checks_riskLevel_idx" ON "compliance_checks"("riskLevel");

-- CreateIndex
CREATE INDEX "consent_records_storeId_idx" ON "consent_records"("storeId");

-- CreateIndex
CREATE INDEX "consent_records_validTo_idx" ON "consent_records"("validTo");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_profiles" ADD CONSTRAINT "store_profiles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "playbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shot_tasks" ADD CONSTRAINT "shot_tasks_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_assets" ADD CONSTRAINT "raw_assets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_assets" ADD CONSTRAINT "raw_assets_shotTaskId_fkey" FOREIGN KEY ("shotTaskId") REFERENCES "shot_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_variants" ADD CONSTRAINT "video_variants_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_videoVariantId_fkey" FOREIGN KEY ("videoVariantId") REFERENCES "video_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_metrics" ADD CONSTRAINT "publish_metrics_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "content_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_videoVariantId_fkey" FOREIGN KEY ("videoVariantId") REFERENCES "video_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
