/**
 * AI Engine - Tool Output Truncator Middleware
 *
 * P0-3 借鉴 Anthropic Claude Code：每个 tool 自带 maxResultSizeChars 字段，
 * 超阈值自动落盘到 object storage，返回 preview + spillPath 给模型。
 *
 * 逻辑：
 *   - output.length <= maxResultSizeChars → passthrough（不落盘）
 *   - 超阈值 → 调 ToolOutputSpillStorageService.spill
 *     → 返回 { output: preview + "\n[输出超 X 字符已落盘，完整内容见 spillPath: ...]",
 *              spilled: true, spillPath, originalLength }
 *   - preview 取前 maxResultSizeChars 的 80%（留 20% 给落盘提示行）
 *   - spill 失败时降级为普通截断（不抛错，保证调用链稳定）
 *
 * 默认阈值 DEFAULT_SPILL_THRESHOLD = 30_000（对应 Anthropic Bash tool 阈值）。
 *
 * 注：本 middleware 不实现 IToolMiddleware（after hook），而是作为独立 service
 * 被 ToolInvoker 在 result 阶段显式调用，避免与 ToolPipeline 中间件顺序耦合。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ToolOutputSpillStorageService } from "../result-spill/spill-storage.service";

/** 默认落盘阈值（字符数）—— 参考 Anthropic Claude Code Bash tool */
export const DEFAULT_SPILL_THRESHOLD = 30_000;

/** preview 比例：占 maxResultSizeChars 的 80%，留 20% 给落盘提示行 */
const PREVIEW_RATIO = 0.8;

export interface TruncateResult {
  /** 返回给模型的输出（可能含落盘提示）*/
  output: string;
  /** 是否触发了落盘 */
  spilled: boolean;
  /** 落盘路径（spilled=true 时有值）*/
  spillPath?: string;
  /** 原始输出长度（字符数）*/
  originalLength: number;
}

@Injectable()
export class ToolOutputTruncatorMiddleware {
  private readonly logger = new Logger(ToolOutputTruncatorMiddleware.name);

  constructor(
    @Optional()
    private readonly spillStorage?: ToolOutputSpillStorageService,
  ) {}

  /**
   * 检查输出是否超阈值，超出时落盘并返回 preview + spillPath 提示。
   *
   * @param args.toolName           工具名称（日志用）
   * @param args.toolUseId          工具调用 ID（作为落盘文件名前缀）
   * @param args.output             原始输出字符串
   * @param args.maxResultSizeChars 阈值；传 Infinity / 0 / 负数时跳过落盘
   */
  async truncate(args: {
    toolName: string;
    toolUseId: string;
    output: string;
    maxResultSizeChars: number;
  }): Promise<TruncateResult> {
    const { toolName, toolUseId, output, maxResultSizeChars } = args;
    const originalLength = output.length;

    // 阈值无效或未超 → passthrough
    if (
      !isFinite(maxResultSizeChars) ||
      maxResultSizeChars <= 0 ||
      originalLength <= maxResultSizeChars
    ) {
      return { output, spilled: false, originalLength };
    }

    // 计算 preview 长度（80% of threshold）
    const previewLen = Math.floor(maxResultSizeChars * PREVIEW_RATIO);
    const preview = output.slice(0, previewLen);

    // 尝试落盘
    if (this.spillStorage) {
      try {
        const { spillPath, success } = await this.spillStorage.spill({
          toolUseId,
          content: output,
        });

        const suffix = success
          ? `\n[输出超 ${maxResultSizeChars} 字符已落盘，完整内容见 spillPath: ${spillPath}]`
          : `\n[输出超 ${maxResultSizeChars} 字符（共 ${originalLength} 字符），存储暂不可用，仅展示前 ${previewLen} 字符]`;

        if (success) {
          this.logger.debug(
            `[spill_triggered] tool=${toolName} toolUseId=${toolUseId} originalLength=${originalLength} spillPath=${spillPath}`,
          );
        } else {
          this.logger.warn(
            `[spill_degraded] tool=${toolName} toolUseId=${toolUseId} originalLength=${originalLength}`,
          );
        }

        return {
          output: preview + suffix,
          spilled: success,
          spillPath: success ? spillPath : undefined,
          originalLength,
        };
      } catch (err) {
        // spill 本身抛错 → 降级截断，不影响主链路
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[spill_exception] tool=${toolName} toolUseId=${toolUseId} err=${msg}`,
        );
      }
    }

    // 无 spillStorage 或 spill 异常 → 普通截断
    const fallbackSuffix = `\n[输出超 ${maxResultSizeChars} 字符（共 ${originalLength} 字符），已截断，仅展示前 ${previewLen} 字符]`;
    return {
      output: preview + fallbackSuffix,
      spilled: false,
      originalLength,
    };
  }
}
