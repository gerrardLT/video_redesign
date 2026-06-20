-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "monthly_credits" INTEGER NOT NULL,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "privileges" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "subscription_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "renewal_type" TEXT NOT NULL DEFAULT 'AUTO',
    "contract_id" TEXT,
    "pay_method" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME NOT NULL,
    "last_renewal_date" DATETIME,
    "total_credits_granted" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "subscription_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "subscription_records_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscription_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "paid_at" DATETIME,
    "expire_at" DATETIME NOT NULL,
    "fail_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "subscription_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "subscription_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "subscription_orders_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "subscription_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_credit_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "order_id" TEXT,
    "project_id" TEXT,
    "subscription_order_id" TEXT,
    "action" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "remark" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "credit_ledger_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "credit_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "package_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "credit_ledger_subscription_order_id_fkey" FOREIGN KEY ("subscription_order_id") REFERENCES "subscription_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_credit_ledger" ("action", "amount", "balance_after", "created_at", "id", "job_id", "order_id", "project_id", "remark", "user_id") SELECT "action", "amount", "balance_after", "created_at", "id", "job_id", "order_id", "project_id", "remark", "user_id" FROM "credit_ledger";
DROP TABLE "credit_ledger";
ALTER TABLE "new_credit_ledger" RENAME TO "credit_ledger";
CREATE INDEX "credit_ledger_user_id_idx" ON "credit_ledger"("user_id");
CREATE INDEX "credit_ledger_job_id_idx" ON "credit_ledger"("job_id");
CREATE INDEX "credit_ledger_order_id_idx" ON "credit_ledger"("order_id");
CREATE INDEX "credit_ledger_project_id_idx" ON "credit_ledger"("project_id");
CREATE INDEX "credit_ledger_subscription_order_id_idx" ON "credit_ledger"("subscription_order_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
