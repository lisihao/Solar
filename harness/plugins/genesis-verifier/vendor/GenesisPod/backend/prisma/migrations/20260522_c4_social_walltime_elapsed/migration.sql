-- C4/G5 (2026-05-22): social_missions wall_time_ms 改名 elapsed_wall_time_ms
-- social 的该列是「实测耗时」。改成语义清晰的 elapsed_wall_time_ms(与 radar 的 cap 列对称)。
-- 无双写:单脚本原地切换,最终态只保 elapsed_wall_time_ms。
--
-- ★ 修正(G11):本迁移(20260522_c4_social...)按字典序先于 20260522_social_mission(建表),
--   fresh replay 时 social_missions 尚不存在,裸 RENAME 会因表不存在而失败。改 guarded rename
--   (列存在才改名,fresh 上 no-op);建表脚本(social_mission / ensure)已直接建 elapsed_wall_time_ms。
--   既有库(旧列存在)走改名分支;两条路径最终态都只有 elapsed_wall_time_ms。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'social_missions' AND column_name = 'wall_time_ms'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'social_missions' AND column_name = 'elapsed_wall_time_ms'
  ) THEN
    ALTER TABLE "social_missions" RENAME COLUMN "wall_time_ms" TO "elapsed_wall_time_ms";
  END IF;
END $$;

-- 清理任何残留旧列(既有库曾走错误顺序致两列并存时)。elapsed 是实测耗时,
-- 旧列残留无并行写入价值,丢弃安全(无双写)。
ALTER TABLE "social_missions" DROP COLUMN IF EXISTS "wall_time_ms";
