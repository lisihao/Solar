-- HARNESS-SEC-001: 为 harness_checkpoints 加 owner_user_id 归属列 + 索引。
-- resume/replay/fork 按属主过滤，防跨租户读他人 agent 断点（envelope 含对话/工具结果/产物）。
-- 可空：系统/匿名断点（envelope.userId 缺失）允许为 NULL。
ALTER TABLE "harness_checkpoints" ADD COLUMN "owner_user_id" VARCHAR(64);
CREATE INDEX "harness_checkpoints_owner_user_id_idx" ON "harness_checkpoints"("owner_user_id");
