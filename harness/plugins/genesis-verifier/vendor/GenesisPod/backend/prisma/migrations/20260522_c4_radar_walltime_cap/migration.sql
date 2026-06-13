-- C4/G5 (2026-05-22): radar_runs wall_time_ms 改名 wall_time_cap_ms
-- 消二义:wallTimeMs 在 radar 是「配置上限」、在 social/playground 是「实测耗时」。
-- radar 的「实测耗时」已是 duration_ms(不二义,保留)。本次仅把 radar 的「上限」列
-- 改成语义清晰的 wall_time_cap_ms。无双写:单脚本原地切换,最终态只保 wall_time_cap_ms。
--
-- ★ 修正(G11):本迁移(20260522)按字典序先于 20260523_radar_mission_lifecycle 重放,
--   而 wall_time_ms 实际由 20260523 创建。fresh replay 时此处旧列尚不存在,故用 guarded
--   rename(列存在才改名),避免裸 RENAME 在 fresh DB 上失败;20260523 已改为直接 ensure
--   wall_time_cap_ms。既有库(旧列已存在)走改名分支;两条路径最终态都只有 wall_time_cap_ms。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'radar_runs' AND column_name = 'wall_time_ms'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'radar_runs' AND column_name = 'wall_time_cap_ms'
  ) THEN
    ALTER TABLE "radar_runs" RENAME COLUMN "wall_time_ms" TO "wall_time_cap_ms";
  END IF;
END $$;

-- 清理任何残留旧列(既有库曾走错误顺序致两列并存时)。wall-time cap 是配置上限,
-- 每次 run 由 resolveRadarMissionWallTimeMs 重算写入,丢弃旧列数据安全(无双写残留)。
ALTER TABLE "radar_runs" DROP COLUMN IF EXISTS "wall_time_ms";
