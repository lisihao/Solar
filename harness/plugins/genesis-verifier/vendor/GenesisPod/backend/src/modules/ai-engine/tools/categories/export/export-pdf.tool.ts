/**
 * Export PDF Tool
 * PDF 导出工具 - 复用 DocumentExportService
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import { ExportOrchestratorService } from "@/common/export";
import { ExportFormat } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

export interface ExportPDFInput {
  /**
   * 文档标题
   */
  title: string;

  /**
   * 文档内容（Markdown 格式）
   */
  content: string;

  /**
   * 页面尺寸
   * @default 'A4'
   */
  pageSize?: "A4" | "A3" | "Letter" | "Legal";

  /**
   * 页边距（毫米）
   */
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };

  /**
   * 作者
   */
  author?: string;

  /**
   * 公司名称
   */
  company?: string;
}

export interface ExportPDFOutput {
  /**
   * 文件名
   */
  filename: string;

  /**
   * MIME 类型
   */
  mimeType: string;

  /**
   * 文件大小（字节）
   */
  size: number;

  /**
   * Base64 编码的文件内容
   */
  base64Content: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class ExportPDFTool extends BaseTool<ExportPDFInput, ExportPDFOutput> {
  readonly id = "export-pdf";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "export";
  readonly tags = ["export", "document", "pdf", "print"];
  readonly name = "导出 PDF";
  readonly description =
    "将内容导出为 PDF 文件。输入 Markdown 格式的内容，自动转换为高质量的 PDF 文档。支持自定义页面大小和边距。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "文档标题",
      },
      content: {
        type: "string",
        description:
          "文档内容，使用 Markdown 格式，支持标题（# ## ###）、段落、列表（- *）等",
      },
      pageSize: {
        type: "string",
        enum: ["A4", "A3", "Letter", "Legal"],
        description: "页面尺寸，默认为 A4",
      },
      margins: {
        type: "object",
        properties: {
          top: {
            type: "number",
            description: "上边距（毫米）",
          },
          right: {
            type: "number",
            description: "右边距（毫米）",
          },
          bottom: {
            type: "number",
            description: "下边距（毫米）",
          },
          left: {
            type: "number",
            description: "左边距（毫米）",
          },
        },
        description: "页边距配置",
      },
      author: {
        type: "string",
        description: "作者名称",
      },
      company: {
        type: "string",
        description: "公司名称",
      },
    },
    required: ["title", "content"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "生成的文件名",
      },
      mimeType: {
        type: "string",
        description: "文件 MIME 类型",
      },
      size: {
        type: "number",
        description: "文件大小（字节）",
      },
      base64Content: {
        type: "string",
        description: "Base64 编码的文件内容",
      },
      success: {
        type: "boolean",
        description: "导出是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
    },
  };

  constructor(private readonly exportOrchestrator: ExportOrchestratorService) {
    super();
    // defaultTimeout set in class property // 90 秒超时（PDF 生成需要 puppeteer）
  }

  validateInput(input: ExportPDFInput) {
    if (
      typeof input.title !== "string" ||
      input.title.trim().length === 0 ||
      typeof input.content !== "string" ||
      input.content.trim().length === 0
    ) {
      return false;
    }

    // 验证页面尺寸
    if (
      input.pageSize &&
      !["A4", "A3", "Letter", "Legal"].includes(input.pageSize)
    ) {
      return false;
    }

    // 验证边距
    if (input.margins) {
      const { top, right, bottom, left } = input.margins;
      if (
        (top !== undefined && (typeof top !== "number" || top < 0)) ||
        (right !== undefined && (typeof right !== "number" || right < 0)) ||
        (bottom !== undefined && (typeof bottom !== "number" || bottom < 0)) ||
        (left !== undefined && (typeof left !== "number" || left < 0))
      ) {
        return false;
      }
    }

    return true;
  }

  protected async doExecute(
    input: ExportPDFInput,
    context: ToolContext,
  ): Promise<ExportPDFOutput> {
    const { title, content } = input;

    try {
      // 使用统一导出模块创建导出任务
      const job = await this.exportOrchestrator.createExportJob(
        context.userId || "system",
        {
          source: {
            type: "RAW",
            content,
            contentType: "markdown",
            title,
          },
          format: ExportFormat.PDF,
        },
      );

      // 等待导出完成（轮询）
      let result = job;
      const maxWait = 60000; // 60秒超时
      const startTime = Date.now();

      while (
        result.status !== "COMPLETED" &&
        result.status !== "FAILED" &&
        Date.now() - startTime < maxWait
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await this.exportOrchestrator.getJobStatus(
          job.jobId,
          context.userId || "system",
        );
      }

      if (result.status === "COMPLETED" && result.downloadUrl) {
        return {
          filename: result.fileName || `${title}.pdf`,
          mimeType: "application/pdf",
          size: result.fileSize || 0,
          base64Content: "", // 下载 URL 模式，不返回 base64
          success: true,
        };
      } else {
        return {
          filename: "",
          mimeType: "",
          size: 0,
          base64Content: "",
          success: false,
          error: result.error || "Export timed out",
        };
      }
    } catch (error) {
      return {
        filename: "",
        mimeType: "",
        size: 0,
        base64Content: "",
        success: false,
        error: error instanceof Error ? error.message : "Export failed",
      };
    }
  }
}
