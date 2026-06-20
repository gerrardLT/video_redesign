-- AlterTable
ALTER TABLE "projects" ADD COLUMN "export_created_at" DATETIME;
ALTER TABLE "projects" ADD COLUMN "export_error" TEXT;
ALTER TABLE "projects" ADD COLUMN "export_resolution" TEXT;
ALTER TABLE "projects" ADD COLUMN "export_status" TEXT;
ALTER TABLE "projects" ADD COLUMN "export_video_url" TEXT;

-- AlterTable
ALTER TABLE "shot_groups" ADD COLUMN "gen_cover_url" TEXT;
