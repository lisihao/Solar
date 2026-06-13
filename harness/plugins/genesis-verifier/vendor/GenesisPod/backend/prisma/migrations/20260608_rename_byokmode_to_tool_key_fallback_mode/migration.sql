-- 命名订正：byokMode 实际只控制【工具】key 的平台兜底（不管模型/技能），
-- 改名为 toolKeyFallbackMode，更名副其实。重命名枚举类型 + 列，数据原样保留。
ALTER TYPE "ByokMode" RENAME TO "ToolKeyFallbackMode";
ALTER TABLE "users" RENAME COLUMN "byok_mode" TO "tool_key_fallback_mode";
