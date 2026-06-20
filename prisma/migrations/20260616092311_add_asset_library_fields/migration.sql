-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_assets" ("created_at", "expires_at", "file_name", "file_size", "id", "is_char_image", "project_id", "reject_reason", "sort_order", "status", "thumb_url", "type", "url", "user_id") SELECT "created_at", "expires_at", "file_name", "file_size", "id", "is_char_image", "project_id", "reject_reason", "sort_order", "status", "thumb_url", "type", "url", "user_id" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE INDEX "assets_project_id_idx" ON "assets"("project_id");
CREATE INDEX "assets_user_id_idx" ON "assets"("user_id");
CREATE INDEX "assets_user_id_category_idx" ON "assets"("user_id", "category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
