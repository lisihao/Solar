-- 工具 BYOK 策略：存量用户拉齐为 FALLBACK（工具默认走平台兜底 key，开箱即用）。
--
-- 背景：schema 的 User.byokMode 默认已是 FALLBACK，新用户开箱即平台提供工具 key。
-- 但 schema 默认还是 STRICT 的年代创建的老用户，其 byok_mode 行值仍是 STRICT，
-- 导致工具显示「未配置 Key」。本迁移把这些存量用户补齐为 FALLBACK。
--
-- 重要：byokMode 仅影响【工具】key 解析（tool-key-resolver / user-tools）。
-- LLM 模型不读 byokMode，始终严格 BYOK（pickBYOKModelForUser 带 userId 时绝不回退 admin），
-- 故本迁移不影响模型策略——模型仍需用户自配。
UPDATE "users" SET "byok_mode" = 'FALLBACK' WHERE "byok_mode" = 'STRICT';
