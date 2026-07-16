-- Create enums
CREATE TYPE "CreationMode" AS ENUM ('REPLICATE_TRENDING', 'IMMERSIVE_SHORT', 'INSPIRE_TO_VIDEO', 'PHOTO_ANIMATE');
CREATE TYPE "ConversationMode" AS ENUM ('REPLICATE', 'SHORTFILM', 'IDEA2VIDEO', 'PHOTO2MOTION', 'MERCHANT');
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable: conversations
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "mode" "ConversationMode" NOT NULL DEFAULT 'REPLICATE',
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: chat_messages
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "action_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for conversations
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");

-- CreateIndex for chat_messages
CREATE INDEX "chat_messages_conversation_id_idx" ON "chat_messages"("conversation_id");

-- AddForeignKey for conversations
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for chat_messages
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter content_briefs
ALTER TABLE "content_briefs" ADD COLUMN "auto_gen_started_at" TIMESTAMP(3);
ALTER TABLE "content_briefs" ADD COLUMN "creationMode" "CreationMode";
ALTER TABLE "content_briefs" ADD COLUMN "render_mode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "content_briefs" ADD COLUMN "selectedStyleAt" TIMESTAMP(3);
ALTER TABLE "content_briefs" ADD COLUMN "selectedStyleId" TEXT;
ALTER TABLE "content_briefs" ADD COLUMN "sourceImageKeys" JSONB;
ALTER TABLE "content_briefs" ADD COLUMN "sourceVideoUrl" TEXT;
ALTER TABLE "content_briefs" ADD COLUMN "textPrompt" TEXT;

-- Alter plan_generation_inputs
ALTER TABLE "plan_generation_inputs" ADD COLUMN "stylePreference" JSONB;

-- Alter projects (conversations table now exists)
ALTER TABLE "projects" ADD COLUMN "conversation_id" TEXT;
CREATE INDEX "projects_conversation_id_idx" ON "projects"("conversation_id");
ALTER TABLE "projects" ADD CONSTRAINT "projects_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Alter publish_jobs
ALTER TABLE "publish_jobs" ADD COLUMN "accountId" TEXT;
ALTER TABLE "publish_jobs" ADD COLUMN "matrixBatchId" TEXT;
ALTER TABLE "publish_jobs" ADD COLUMN "scheduledAt" TIMESTAMP(3);
CREATE INDEX "publish_jobs_matrixBatchId_idx" ON "publish_jobs"("matrixBatchId");
CREATE INDEX "publish_jobs_scheduledAt_idx" ON "publish_jobs"("scheduledAt");

-- Alter publish_queue_items
CREATE UNIQUE INDEX "publish_queue_items_videoVariantId_key" ON "publish_queue_items"("videoVariantId");

-- Alter video_variants
ALTER TABLE "video_variants" ADD COLUMN "styleConTags" JSONB;
ALTER TABLE "video_variants" ADD COLUMN "styleLabel" TEXT;
ALTER TABLE "video_variants" ADD COLUMN "styleProTags" JSONB;
