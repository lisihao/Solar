-- 彻底下线 custom-agents 功能（用户决策 2026-06-08）：删除其私有表 + 全部数据。
-- 该功能（用户自建 agent 向导 + 发布 + launch）已被 company OS / marketplace 取代，
-- 前后端代码已移除（见 commit ce3d03925）。本迁移删表，数据**永久丢失、不可恢复**。
DROP TABLE IF EXISTS "custom_agent_launches";
DROP TABLE IF EXISTS "custom_agent_definitions";
