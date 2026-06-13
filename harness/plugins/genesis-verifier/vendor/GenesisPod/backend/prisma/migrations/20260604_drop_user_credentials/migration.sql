-- W5: 退役 user_credentials 过渡表（PR-3 形态）。
-- 背景：用户工具 BYOK key 已（P4）收敛到 user-scoped secrets/secret_keys；user_credentials
--       不再被写入，读路径已下线（user-secrets.service / user-tools.service 改读 secrets）。
-- 安全护栏：若线上仍有行（已确认 0），迁移直接报错中止，绝不静默丢用户密钥。
--           如未来真有残留行，须先按 consolidation plan §6 W5 runbook 反向迁移到 secrets 再 DROP。
DO $$
DECLARE cnt bigint;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_credentials') THEN
    SELECT COUNT(*) INTO cnt FROM "user_credentials";
    IF cnt > 0 THEN
      RAISE EXCEPTION 'user_credentials 仍有 % 行，DROP 中止：先按 W5 runbook 迁移到 user-scoped secrets', cnt;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "user_credentials";
