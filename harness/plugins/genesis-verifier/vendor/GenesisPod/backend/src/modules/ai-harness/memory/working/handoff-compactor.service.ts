/**
 * HandoffCompactorService —— Stage 间 handoff payload token 估算 + 自动压缩
 *
 * 历史：from ai-app/{app}/services/mission/lifecycle/mission-state.service
 *      （PR-5 standardize consumer 2026-05-04 上提到 harness/memory/working）
 *
 * 设计：
 *   • 纯函数原语：estimateTokens + compressIfNeeded，无 DI 真实依赖
 *   • 跨 ai-app 复用：任何 stage A → stage B 大 payload 场景都能用
 *   • CN/EN 混合 token 密度按 2.0 chars/token 估算（中文 1.7 + safety margin）
 *   • 超 50K tokens 自动调 compress（裁列表头 / 截字段长度）
 *   • 与 todo P0#1 token 压缩机制 contract 对齐
 */

import { Injectable, Logger } from "@nestjs/common";

const HANDOFF_TOKEN_LIMIT = 50_000;
// ★ P1-A (2026-04-29): 中文密度 ≈ 1.7 chars/token (tiktoken o200k 实测)，
// 英文 ≈ 4 chars/token；纯中文 / 中英混合按 2.5 估算 + 20% safety margin（=2.0）
// 防止低估导致 50K 阈值不触发 → handoff 实际爆 LLM context。
const CHARS_PER_TOKEN = 2.0;

@Injectable()
export class HandoffCompactorService {
  private readonly log = new Logger(HandoffCompactorService.name);

  /** Phase P17-1: 上限暴露给上层调用（如 stage 预检） */
  readonly handoffTokenLimit = HANDOFF_TOKEN_LIMIT;

  /**
   * 估算 payload tokens（粗估：JSON 序列化字符数 / 3.5）
   */
  estimateTokens(payload: unknown): number {
    if (payload == null) return 0;
    if (typeof payload === "string") {
      return Math.ceil(payload.length / CHARS_PER_TOKEN);
    }
    return Math.ceil(JSON.stringify(payload).length / CHARS_PER_TOKEN);
  }

  /**
   * 检查 handoff payload 是否超限。超限时返回压缩后的版本。
   *
   * 当前压缩策略（简化）：
   *   - researcherResults：每个 finding 的 evidence 截到 200 字符
   *   - findings 数组限制每 dim 前 6 个
   *   - 单 dim summary 截到 500 字符
   *
   * 未来 P2 升级：用 LLM 真做 summarize（多花 ~5K tokens 但能压成 1/5）
   */
  compressIfNeeded<T>(payload: T, label: string): T {
    const tokens = this.estimateTokens(payload);
    if (tokens <= HANDOFF_TOKEN_LIMIT) return payload;
    const compressed = this.compress(payload);
    const afterTokens = this.estimateTokens(compressed);
    // ★ 2026-05-13 P2-#7: compress 后仍超限才是真异常 → warn；正常压缩到位的
    //   常态走 debug 不污染监控。原版每次都打 warn，noise 高。
    if (afterTokens > HANDOFF_TOKEN_LIMIT) {
      this.log.warn(
        `[MissionState] ${label} handoff still over limit after compress: ${tokens}→${afterTokens} > ${HANDOFF_TOKEN_LIMIT}`,
      );
    } else {
      this.log.debug(
        `[MissionState] ${label} handoff compressed ${tokens}→${afterTokens} tokens (limit ${HANDOFF_TOKEN_LIMIT})`,
      );
    }
    return compressed as T;
  }

  /**
   * 递归压缩：
   *  - 顶层数组 → slice(12) + 递归 compressItem
   *  - 对象 → 每个 value 递归 compressItem
   *  - 长字符串 → 截 1500
   *
   * ★ 2026-05-13 P2-#7 修复：compressItem 现在递归进 nested array/object。
   *   原版只 trim 顶层 object 的 string 字段，nested `findings: [...]` 数组
   *   直接 pass-through，所以 116K tokens 的 researcherResults 压缩后基本没变。
   */
  private compress(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      // 顶层数组（researcherResults / 类似列表）
      return obj.slice(0, 12).map((item) => this.compressItem(item));
    }
    if (obj && typeof obj === "object") {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        r[k] = this.compressItem(v);
      }
      return r;
    }
    if (typeof obj === "string" && obj.length > 1500) {
      return obj.slice(0, 1500) + "…(truncated)";
    }
    return obj;
  }

  private compressItem(item: unknown): unknown {
    if (Array.isArray(item)) {
      // 嵌套数组（findings / sources / 列表）→ 截前 6 个 + 每条递归压
      return item.slice(0, 6).map((x) => this.compressItem(x));
    }
    if (item && typeof item === "object") {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (typeof v === "string" && v.length > 500) {
          r[k] = v.slice(0, 500) + "…";
        } else if (Array.isArray(v) || (v && typeof v === "object")) {
          // ★ 递归进 nested array / object（之前 bug：直接 pass-through）
          r[k] = this.compressItem(v);
        } else {
          r[k] = v;
        }
      }
      return r;
    }
    if (typeof item === "string" && item.length > 1500) {
      return item.slice(0, 1500) + "…";
    }
    return item;
  }
}
