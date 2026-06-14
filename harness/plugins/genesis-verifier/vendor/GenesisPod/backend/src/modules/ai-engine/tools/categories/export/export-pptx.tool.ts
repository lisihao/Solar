/**
 * Export PPTX Tool
 * PPTX 导出工具 - 复用 DocumentExportService
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

export interface ExportPPTXInput {
  /**
   * 演示文稿标题
   */
  title: string;

  /**
   * 幻灯片内容（Markdown 格式）
   */
  content: string;

  /**
   * 模板 ID
   */
  templateId?: string;

  /**
   * 作者
   */
  author?: string;

  /**
   * 公司名称
   */
  company?: string;
}

export interface ExportPPTXOutput {
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
export class ExportPPTXTool extends BaseTool<
  ExportPPTXInput,
  ExportPPTXOutput
> {
  readonly id = "export-pptx";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "export";
  readonly tags = ["export", "presentation", "pptx", "powerpoint", "slides"];
  readonly name = "导出 PPTX";
  readonly description =
    "将内容导出为 PowerPoint (PPTX) 文件。输入 Markdown 格式的内容，自动转换为幻灯片格式。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "演示文稿标题",
      },
      content: {
        type: "string",
        description: "幻灯片内容，使用 Markdown 格式，用 # 分隔幻灯片",
      },
      templateId: {
        type: "string",
        description: "模板 ID（可选）",
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
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: ExportPPTXInput) {
    return (
      typeof input.title === "string" &&
      input.title.trim().length > 0 &&
      typeof input.content === "string" &&
      input.content.trim().length > 0
    );
  }

  protected async doExecute(
    input: ExportPPTXInput,
    context: ToolContext,
  ): Promise<ExportPPTXOutput> {
    const { title, content, templateId } = input;

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
          format: ExportFormat.PPTX,
          templateId,
        },
      );

      // 等待导出完成（轮询）
      let result = job;
      const maxWait = 30000; // 30秒超时
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
          filename: result.fileName || `${title}.pptx`,
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
