import { parseExpression } from "cron-parser";

/**
 * 计算下一次 cron 触发时间。
 *
 * - 5 段 cron 表达式（不含秒）
 * - from 不传则用 now
 * - 解析失败时返回 null（caller 应跳过该 topic 或重置为默认）
 */
export function computeNextCronTick(
  cronExpr: string,
  from: Date = new Date(),
): Date | null {
  try {
    const it = parseExpression(cronExpr, { currentDate: from });
    return it.next().toDate();
  } catch {
    return null;
  }
}
