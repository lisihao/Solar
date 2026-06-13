/**
 * QuietHours 共享时间窗口工具（PR-DR1a R1 reuse 整改）
 *
 * 来源：原 `NotificationService.timeInWindow` + `NotificationPreferenceService.timeInWindow`
 * 两处逐字重复实现 → 单源到此（feedback_no_dual_sources）
 *
 * 行为契约：
 * - "HH:mm" 时间窗口包含判断
 * - 支持跨午夜（如 22:00..06:00 → 23:00 在内 / 05:00 在内 / 12:00 外）
 * - start === end → 视为关闭（不在任何时间段内）
 * - 解析失败 → false（不抛，让 caller 走默认非静默路径）
 *
 * 当前实现按 UTC 比较；W5 加 user.timezone 后改成 luxon `setZone(tz).toFormat('HH:mm')` 对比。
 */
export class QuietHoursUtil {
  /**
   * 判断 now 是否落在 [startStr, endStr) 时间窗口内（按 UTC）。
   */
  static timeInWindow(now: Date, startStr: string, endStr: string): boolean {
    const startMin = QuietHoursUtil.parseHHMMToMinutes(startStr);
    const endMin = QuietHoursUtil.parseHHMMToMinutes(endStr);
    if (startMin === null || endMin === null) return false;
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (startMin === endMin) return false;
    if (startMin < endMin) {
      return nowMin >= startMin && nowMin < endMin;
    }
    // 跨午夜
    return nowMin >= startMin || nowMin < endMin;
  }

  static parseHHMMToMinutes(s: string): number | null {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }
}
