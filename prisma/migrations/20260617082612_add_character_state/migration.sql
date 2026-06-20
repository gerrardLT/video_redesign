-- CreateTable
CREATE TABLE "character_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "character_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_states_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shot_group_characters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shot_group_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "character_state_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shot_group_characters_shot_group_id_fkey" FOREIGN KEY ("shot_group_id") REFERENCES "shot_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shot_group_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shot_group_characters_character_state_id_fkey" FOREIGN KEY ("character_state_id") REFERENCES "character_states" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_shot_group_characters" ("character_id", "created_at", "id", "shot_group_id") SELECT "character_id", "created_at", "id", "shot_group_id" FROM "shot_group_characters";
DROP TABLE "shot_group_characters";
ALTER TABLE "new_shot_group_characters" RENAME TO "shot_group_characters";
CREATE INDEX "shot_group_characters_shot_group_id_idx" ON "shot_group_characters"("shot_group_id");
CREATE INDEX "shot_group_characters_character_id_idx" ON "shot_group_characters"("character_id");
CREATE UNIQUE INDEX "shot_group_characters_shot_group_id_character_id_key" ON "shot_group_characters"("shot_group_id", "character_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "character_states_character_id_idx" ON "character_states"("character_id");
