/**
 * AI Engine - Tool Output Spill Storage Service
 *
 * 当 tool 输出超过 maxResultSizeChars 阈值时，将完整内容异步上传到 object storage，
 * 返回 spillPath 供模型引用。模型 + 下游消费方可通过 retrieve() 拿到完整内容。
 *
 * 落盘路径格式：tool-output-spill/{toolUseId}-{timestamp}.txt
 *
 * 依赖 ObjectStorageService（uploadText / downloadText），由 StorageModule 提供。
 * 如果 storage 不可用（isEnabled() === false），spill 会降级为直接返回截断字符串，
 * 不抛错，保证 tool invoke 链路稳定。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ObjectStorageService } from "@/modules/platform/storage/object-store/object-storage.service";

export interface SpillResult {
  /** object storage key（前缀 tool-output-spill/） */
  spillPath: string;
  /** 上传是否成功；false 时 spillPath 是占位符 */
  success: boolean;
}

@Injectable()
export class ToolOutputSpillStorageService {
  private readonly logger = new Logger(ToolOutputSpillStorageService.name);

  constructor(
    @Optional() private readonly storageService?: ObjectStorageService,
  ) {}

  /**
   * 将完整 tool 输出上传到 object storage。
   *
   * @param args.toolUseId   工具调用唯一 ID（对应 ToolContext.executionId 或 callId）
   * @param args.content     完整原始输出字符串
   * @param args.mimeType    MIME 类型，默认 text/plain; charset=utf-8
   */
  async spill(args: {
    toolUseId: string;
    content: string;
    mimeType?: string;
  }): Promise<SpillResult> {
    const key = `tool-output-spill/${args.toolUseId}-${Date.now()}.txt`;
    const mimeType = args.mimeType ?? "text/plain; charset=utf-8";

    if (!this.storageService?.isEnabled()) {
      this.logger.warn(
        `[spill_skipped] storage not available, toolUseId=${args.toolUseId}`,
      );
      return { spillPath: key, success: false };
    }

    try {
      const result = await this.storageService.uploadText(
        args.content,
        key,
        mimeType,
      );
      if (!result.success) {
        this.logger.warn(
          `[spill_upload_failed] toolUseId=${args.toolUseId} error=${result.error ?? "unknown"}`,
        );
        return { spillPath: key, success: false };
      }

      this.logger.debug(
        `[spill_ok] toolUseId=${args.toolUseId} key=${key} bytes=${Buffer.byteLength(args.content, "utf-8")}`,
      );
      return { spillPath: key, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[spill_error] toolUseId=${args.toolUseId} err=${msg}`);
      return { spillPath: key, success: false };
    }
  }

  /**
   * 从 object storage 检索已落盘的 tool 输出。
   *
   * @param spillPath  spill() 返回的 spillPath
   * @returns 完整内容字符串，或 null（storage 不可用 / 对象不存在）
   */
  async retrieve(spillPath: string): Promise<string | null> {
    if (!this.storageService?.isEnabled()) {
      this.logger.warn(
        `[retrieve_skipped] storage not available, spillPath=${spillPath}`,
      );
      return null;
    }

    try {
      return await this.storageService.downloadText(spillPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[retrieve_error] spillPath=${spillPath} err=${msg}`);
      return null;
    }
  }
}
