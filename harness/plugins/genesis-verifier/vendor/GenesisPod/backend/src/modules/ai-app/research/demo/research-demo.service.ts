import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

@Injectable()
export class ResearchDemoService {
  private readonly logger = new Logger(ResearchDemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * Verify that the project belongs to the user
   */
  private async verifyProjectOwnership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }
  }

  async listByProject(userId: string, projectId: string) {
    await this.verifyProjectOwnership(userId, projectId);

    return this.prisma.researchDemo.findMany({
      where: { projectId },
      include: {
        idea: { select: { id: true, title: true, agentRole: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(userId: string, projectId: string, demoId: string) {
    await this.verifyProjectOwnership(userId, projectId);

    const demo = await this.prisma.researchDemo.findUnique({
      where: { id: demoId, projectId },
      include: {
        idea: {
          select: {
            id: true,
            title: true,
            description: true,
            agentRole: true,
          },
        },
      },
    });
    if (!demo) throw new NotFoundException("Demo not found");
    return demo;
  }

  async createForIdea(
    userId: string,
    projectId: string,
    ideaId: string,
    title?: string,
  ) {
    await this.verifyProjectOwnership(userId, projectId);

    const idea = await this.prisma.researchIdea.findUnique({
      where: { id: ideaId, projectId },
    });
    if (!idea) throw new NotFoundException("Idea not found");

    const demo = await this.prisma.researchDemo.create({
      data: {
        ideaId,
        projectId,
        title: title || `Demo: ${idea.title}`,
        htmlContent: "",
        status: "PENDING",
      },
    });

    this.logger.log(
      `Created demo ${demo.id} for idea ${ideaId}, starting AI generation`,
    );

    // Trigger AI generation asynchronously (fire-and-forget)
    void this.generateDemoHtml(demo.id, idea);

    return demo;
  }

  /**
   * Generate self-contained HTML demo using AI.
   * Updates the demo record with generated content or error status.
   */
  private async generateDemoHtml(
    demoId: string,
    idea: {
      title: string;
      description: string;
      metadata: unknown;
    },
  ) {
    try {
      await this.prisma.researchDemo.update({
        where: { id: demoId },
        data: { status: "GENERATING" },
      });

      const meta = (idea.metadata || {}) as {
        concept?: string;
        innovationPoints?: string[];
        approach?: string;
        feasibility?: string;
        dimension?: string;
        coreInsight?: string;
        evidence?: string[];
        researchDirection?: string;
      };

      const contextParts = [
        `# ${idea.title}`,
        idea.description,
        meta.concept && `## 核心概念\n${meta.concept}`,
        meta.innovationPoints?.length &&
          `## 创新点\n${meta.innovationPoints.map((p) => `- ${p}`).join("\n")}`,
        meta.approach && `## 实现路径\n${meta.approach}`,
        meta.coreInsight && `## 核心洞察\n${meta.coreInsight}`,
        meta.evidence?.length &&
          `## 论据\n${meta.evidence.map((e) => `- ${e}`).join("\n")}`,
        meta.researchDirection && `## 研究方向\n${meta.researchDirection}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const systemPrompt = `你是一位专业的产品原型工程师。根据给定的研究创意，生成一个能够工作的产品原型（working prototype）。

## 核心规则（必须严格遵守）
1. 这是产品原型，不是 PPT 或信息展示页面
2. 必须有真实的 UI 界面（导航栏、侧边栏或标签页）
3. 必须有多个页面/视图（至少3个不同的功能界面，通过点击切换）
4. 必须有可交互的表单和操作（按钮点击有真实状态反馈）
5. 必须使用真实感的模拟数据（不要用"xxx示例"占位符，要用真实的人名、数字、内容）
6. 用户操作必须产生可见的状态变化（如列表增删、表单提交后显示成功、数据过滤等）
7. 禁止：PPT风格、静态展示卡片组、纯图表/流程图页面

## 技术要求
- 完整 HTML 文档（<!DOCTYPE html>）
- 所有 CSS inline 在 <style> 标签
- 所有 JS inline 在 <script> 标签
- 禁止外部资源（CDN/字体/图片URL）
- 使用 SVG 代替图片

## 原型类型参考（根据创意选择最合适的）
- SaaS 管理后台：左侧导航 + 列表页 + 详情页 + 新建表单
- 移动 App 界面：底部标签栏 + 多个功能页面 + 弹出面板
- 工作流工具：步骤向导 + 进度追踪 + 完成确认
- 数据分析平台：图表仪表盘 + 数据表格 + 筛选器
- 内容创作工具：编辑器 + 预览 + 发布设置

## 输出
只输出 HTML 代码，不要其他内容。不要用 markdown 代码块包裹。`;

      const result = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请为以下研究创意生成一个能够工作的产品原型：\n\n${contextParts}`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "high",
          outputLength: "long",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      // Clean up potential markdown code fences
      let htmlContent = result.content.trim();
      if (htmlContent.startsWith("```html")) {
        htmlContent = htmlContent.slice(7);
      }
      if (htmlContent.startsWith("```")) {
        htmlContent = htmlContent.slice(3);
      }
      if (htmlContent.endsWith("```")) {
        htmlContent = htmlContent.slice(0, -3);
      }
      htmlContent = htmlContent.trim();

      await this.prisma.researchDemo.update({
        where: { id: demoId },
        data: {
          htmlContent,
          status: "COMPLETED",
        },
      });

      this.logger.log(`Demo ${demoId} generated successfully`);
    } catch (error) {
      this.logger.error(`Demo generation failed for ${demoId}: ${error}`);
      try {
        await this.prisma.researchDemo.update({
          where: { id: demoId },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } catch (updateError) {
        this.logger.error(
          `Failed to update demo ${demoId} status to FAILED: ${updateError}`,
        );
      }
    }
  }

  async delete(userId: string, projectId: string, demoId: string) {
    await this.verifyProjectOwnership(userId, projectId);

    try {
      return await this.prisma.researchDemo.delete({
        where: { id: demoId, projectId },
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2025"
      ) {
        throw new NotFoundException("Demo not found");
      }
      throw error;
    }
  }
}
