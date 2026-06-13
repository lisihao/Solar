-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('INITIAL', 'DAILY_CHECKIN', 'TASK_REWARD', 'REFERRAL_BONUS', 'ADMIN_GRANT', 'COMPENSATION', 'AI_ASK', 'AI_STUDIO', 'AI_TEAMS', 'AI_OFFICE', 'AI_CODING', 'AI_SIMULATION', 'EXPIRATION', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 10000,
    "total_earned" INTEGER NOT NULL DEFAULT 10000,
    "total_spent" INTEGER NOT NULL DEFAULT 0,
    "gift_balance" INTEGER NOT NULL DEFAULT 0,
    "gift_expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "today_spent" INTEGER NOT NULL DEFAULT 0,
    "today_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "module_type" TEXT,
    "operation_type" TEXT,
    "reference_id" TEXT,
    "token_count" INTEGER,
    "model_name" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_rules" (
    "id" TEXT NOT NULL,
    "module_type" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "base_credits" INTEGER NOT NULL,
    "token_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "model_multipliers" JSONB NOT NULL DEFAULT '{}',
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_checkins" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "checkin_date" DATE NOT NULL,
    "credits_earned" INTEGER NOT NULL,
    "streak_days" INTEGER NOT NULL DEFAULT 1,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_user_id_key" ON "credit_accounts"("user_id");

-- CreateIndex
CREATE INDEX "credit_accounts_user_id_idx" ON "credit_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_idempotency_key_key" ON "credit_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_transactions_account_id_created_at_idx" ON "credit_transactions"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions"("type");

-- CreateIndex
CREATE INDEX "credit_transactions_module_type_operation_type_idx" ON "credit_transactions"("module_type", "operation_type");

-- CreateIndex
CREATE UNIQUE INDEX "credit_rules_module_type_operation_type_key" ON "credit_rules"("module_type", "operation_type");

-- CreateIndex
CREATE UNIQUE INDEX "daily_checkins_account_id_checkin_date_key" ON "daily_checkins"("account_id", "checkin_date");

-- CreateIndex
CREATE INDEX "daily_checkins_account_id_checkin_date_idx" ON "daily_checkins"("account_id", "checkin_date" DESC);

-- CreateIndex
CREATE INDEX "daily_checkins_ip_address_checkin_date_idx" ON "daily_checkins"("ip_address", "checkin_date");

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
