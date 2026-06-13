-- 添加 EXPLORE 枚举值到 CreditTransactionType
DO $$
BEGIN
    ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'EXPLORE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 迁移历史误标交易：ai-engine 的 summary/insights/translate 归属到 explore
UPDATE "credit_transactions"
SET "type" = 'EXPLORE', "module_type" = 'explore'
WHERE "type" = 'ADJUSTMENT'
  AND "module_type" = 'ai-engine'
  AND "operation_type" IN ('summary', 'insights', 'translate');
