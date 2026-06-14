/**
 * AI Slides V5.0 - AI Edit Service
 *
 * Service for AI-powered editing capabilities:
 * - Fix Layout: Automatically fix layout issues (overflow, overlap, alignment)
 * - Polish Content: Polish content to match overall style
 * - Fact Check: Verify factual accuracy of content
 */

import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  LayoutFixerSkill,
  LayoutFixerInput,
} from "../skills/layout-fixer.skill";
import {
  ContentPolisherSkill,
  ContentPolisherInput,
  StyleGuide,
} from "../skills/content-polisher.skill";
import {
  FactCheckerSkill,
  FactCheckerInput,
} from "../skills/fact-checker.skill";
import type { SkillContext } from "@/modules/ai-harness/facade";

// ============================================
// Types
// ============================================

/**
 * Polish content options
 */
export interface PolishOptions {
  /** Style guide to follow */
  styleGuide?: StyleGuide;
  /** Target tone */
  targetTone?: "formal" | "casual" | "technical" | "friendly";
  /** Language */
  language?: "zh" | "en";
}

/**
 * Chat edit result
 */
export interface ChatEditResult {
  success: boolean;
  updatedHtml: string;
  reply: string;
}

/**
 * Fix layout result
 */
export interface FixLayoutResult {
  success: boolean;
  originalHtml: string;
  fixedHtml: string;
  issuesFound: number;
  issuesFixed: number;
  criticalIssues: number;
}

/**
 * Polish content result
 */
export interface PolishContentResult {
  success: boolean;
  pagesPolished: number;
  totalChanges: number;
  pages: Array<{
    index: number;
    title: string;
    content: string;
  }>;
}

/**
 * Fact check result
 */
export interface FactCheckResult {
  success: boolean;
  totalClaims: number;
  verifiedCount: number;
  disputedCount: number;
  needsCitationCount: number;
  overallCredibility: number;
  pageResults: Array<{
    pageIndex: number;
    overallScore: number;
    credibilityLevel: string;
    claimsCount: number;
  }>;
}

/**
 * Page data from mission
 */
interface MissionPage {
  index: number;
  title?: string;
  html?: string;
  content?: string;
  [key: string]: unknown;
}

// ============================================
// Service
// ============================================

@Injectable()
export class AIEditService {
  private readonly logger = new Logger(AIEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly aiFacade: ChatFacade,
    @Optional() private readonly layoutFixerSkill: LayoutFixerSkill,
    @Optional() private readonly contentPolisherSkill: ContentPolisherSkill,
    @Optional() private readonly factCheckerSkill: FactCheckerSkill,
  ) {}

  // ============================================
  // Chat Edit
  // ============================================

  /**
   * Apply a user's natural-language instruction to edit a specific slide page
   * @param sessionOrMissionId - Session or Mission ID
   * @param pageIndex - 0-based array index of the page
   * @param instruction - User's edit instruction in natural language
   * @param userId - Authenticated user
   */
  async chatEdit(
    sessionOrMissionId: string,
    pageIndex: number,
    instruction: string,
    userId: string,
  ): Promise<ChatEditResult> {
    this.logger.log(
      `[chatEdit] Session/Mission: ${sessionOrMissionId}, Page: ${pageIndex}`,
    );

    if (!this.aiFacade) {
      throw new InternalServerErrorException("AI facade is not available");
    }

    const missionId = await this.resolveMissionId(sessionOrMissionId, userId);

    const mission = await this.prisma.slidesMission.findFirst({
      where: { id: missionId, userId },
    });

    if (!mission) {
      throw new NotFoundException(`Mission not found: ${missionId}`);
    }

    let pages = (mission.pages as MissionPage[]) || [];

    // Fallback: if mission.pages is empty (e.g. after checkpoint restore without sync),
    // load pages from the latest checkpoint state
    if (pages.length === 0) {
      const latestCheckpoint = await this.prisma.slidesCheckpoint.findFirst({
        where: { sessionId: mission.sessionId },
        orderBy: { createdAt: "desc" },
      });
      const checkpointPages = (
        latestCheckpoint?.stateJson as { pages?: MissionPage[] } | null
      )?.pages;
      if (checkpointPages?.length) {
        pages = checkpointPages;
        this.logger.warn(
          `[chatEdit] mission.pages empty, fell back to checkpoint state (${pages.length} pages)`,
        );
      }
    }

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new BadRequestException(
        `Page index ${pageIndex} is out of range (0-${pages.length - 1})`,
      );
    }

    const page = pages[pageIndex];
    const currentHtml = (page.html as string) || (page.content as string) || "";

    if (!currentHtml) {
      throw new BadRequestException(
        `Page ${pageIndex} has no HTML content to edit`,
      );
    }

    const systemPrompt = `你是幻灯片 HTML 编辑助手。用户提供幻灯片 HTML 和修改指令。

任务：
1. 理解修改指令
2. 对 HTML 进行精准修改
3. 输出完整修改后 HTML 和修改摘要

规则：
- 保持幻灯片整体布局、尺寸（1280×720px）和样式不变
- 只修改用户要求的部分，其余内容保持原样
- 必须输出完整的 HTML 文件（不是片段）
- 严格按照以下格式输出，不要其他内容`;

    const userPrompt = `修改指令：${instruction}

当前幻灯片 HTML：
\`\`\`html
${currentHtml}
\`\`\`

输出格式：
1. 先输出修改后完整 HTML（用 \`\`\`html ... \`\`\` 包裹）
2. 然后输出修改摘要（用 <SUMMARY>...具体说明修改了什么...</SUMMARY> 包裹，简洁1-2句）`;

    const response = await this.aiFacade.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      modelType: AIModelType.CHAT_FAST,
      taskProfile: {
        creativity: "low",
        outputLength: "long",
      },
    });

    // Extract HTML from response
    const htmlMatch = response.content.match(/```html\s*([\s\S]*?)\s*```/);
    const updatedHtml = htmlMatch ? htmlMatch[1].trim() : currentHtml;

    // Extract SUMMARY from response
    const summaryMatch = response.content.match(
      /<SUMMARY>([\s\S]*?)<\/SUMMARY>/,
    );
    const reply = summaryMatch
      ? summaryMatch[1].trim()
      : `已将第 ${pageIndex + 1} 页按您的指令修改完成。`;

    // Save updated HTML to DB
    if (updatedHtml && updatedHtml !== currentHtml) {
      pages[pageIndex] = {
        ...(pages[pageIndex] as object),
        html: updatedHtml,
      } as MissionPage;

      await this.prisma.slidesMission.update({
        where: { id: missionId },
        data: { pages: pages as unknown as object },
      });

      this.logger.debug(
        `[chatEdit] Updated page ${pageIndex} in mission ${missionId}`,
      );
    }

    return { success: true, updatedHtml, reply };
  }

  // ============================================
  // Fix Layout
  // ============================================

  /**
   * Fix layout issues on a specific page
   * @param missionId - Mission ID
   * @param pageIndex - Page index (0-based)
   * @returns Fix result with original and fixed HTML
   */
  async fixLayout(
    missionId: string,
    pageIndex: number,
    userId: string,
  ): Promise<FixLayoutResult> {
    this.logger.log(`[fixLayout] Mission: ${missionId}, Page: ${pageIndex}`);

    if (!this.layoutFixerSkill) {
      throw new InternalServerErrorException(
        "Layout fixer skill is not available. Please check skill registration.",
      );
    }

    // Validate input
    if (pageIndex < 0) {
      throw new BadRequestException("Page index must be a non-negative number");
    }

    // Get the page HTML from the mission
    const page = await this.getPageHtml(missionId, pageIndex, userId);

    const context = this.createSkillContext(
      "layout-fixer",
      "fix-layout",
      missionId,
    );
    const input: LayoutFixerInput = {
      html: page.html,
      pageIndex,
    };

    const result = await this.layoutFixerSkill.execute(input, context);

    if (!result.success || !result.data) {
      this.logger.warn(`[fixLayout] Failed: ${result.error?.message}`);
      return {
        success: false,
        originalHtml: page.html,
        fixedHtml: page.html,
        issuesFound: 0,
        issuesFixed: 0,
        criticalIssues: 0,
      };
    }

    // Update the mission pages with fixed HTML
    if (result.data.fixedHtml !== page.html) {
      await this.updatePageHtml(
        missionId,
        pageIndex,
        result.data.fixedHtml,
        userId,
      );
    }

    return {
      success: true,
      originalHtml: result.data.originalHtml,
      fixedHtml: result.data.fixedHtml,
      issuesFound: result.data.stats.totalIssues,
      issuesFixed: result.data.stats.fixedIssues,
      criticalIssues: result.data.stats.criticalIssues,
    };
  }

  // ============================================
  // Polish Content
  // ============================================

  /**
   * Polish content for all pages in a mission
   * @param missionId - Mission ID
   * @param options - Polish options (style guide, tone, etc.)
   * @returns Polish result with updated pages
   */
  async polishContent(
    missionId: string,
    options: PolishOptions,
    userId: string,
  ): Promise<PolishContentResult> {
    this.logger.log(`[polishContent] Mission: ${missionId}`);

    if (!this.contentPolisherSkill) {
      throw new InternalServerErrorException(
        "Content polisher skill is not available. Please check skill registration.",
      );
    }

    // Get all pages from the mission
    const pages = await this.getPages(missionId, userId);

    const context = this.createSkillContext(
      "content-polisher",
      "polish-content",
      missionId,
    );
    const input: ContentPolisherInput = {
      pages: pages.map((p) => ({
        index: p.index,
        title: p.title,
        content: p.content,
      })),
      styleGuide: options.styleGuide,
      targetTone: options.targetTone,
      language: options.language,
    };

    const result = await this.contentPolisherSkill.execute(input, context);

    if (!result.success || !result.data) {
      this.logger.warn(`[polishContent] Failed: ${result.error?.message}`);
      return {
        success: false,
        pagesPolished: 0,
        totalChanges: 0,
        pages: pages.map((p) => ({
          index: p.index,
          title: p.title,
          content: p.content,
        })),
      };
    }

    // Update pages with polished content
    for (const polishedPage of result.data.pages) {
      await this.updatePageContent(
        missionId,
        polishedPage.index,
        polishedPage.content,
        userId,
      );
    }

    return {
      success: true,
      pagesPolished: result.data.stats.pagesPolished,
      totalChanges: result.data.stats.totalChanges,
      pages: result.data.pages.map((p) => ({
        index: p.index,
        title: p.title,
        content: p.content,
      })),
    };
  }

  // ============================================
  // Fact Check
  // ============================================

  /**
   * Perform fact check on all pages in a mission
   * @param missionId - Mission ID
   * @param strictMode - Whether to use strict verification
   * @returns Fact check results
   */
  async factCheck(
    missionId: string,
    strictMode: boolean,
    userId: string,
  ): Promise<FactCheckResult> {
    this.logger.log(`[factCheck] Mission: ${missionId}, Strict: ${strictMode}`);

    if (!this.factCheckerSkill) {
      throw new InternalServerErrorException(
        "Fact checker skill is not available. Please check skill registration.",
      );
    }

    // Get all pages from the mission
    const pages = await this.getPages(missionId, userId);

    const context = this.createSkillContext(
      "fact-checker",
      "fact-check",
      missionId,
    );
    const input: FactCheckerInput = {
      pages: pages.map((p) => ({
        index: p.index,
        title: p.title,
        content: p.content,
      })),
      strictMode,
    };

    const result = await this.factCheckerSkill.execute(input, context);

    if (!result.success || !result.data) {
      this.logger.warn(`[factCheck] Failed: ${result.error?.message}`);
      return {
        success: false,
        totalClaims: 0,
        verifiedCount: 0,
        disputedCount: 0,
        needsCitationCount: 0,
        overallCredibility: 0,
        pageResults: [],
      };
    }

    return {
      success: true,
      totalClaims: result.data.summary.totalClaims,
      verifiedCount: result.data.summary.verifiedCount,
      disputedCount: result.data.summary.disputedCount,
      needsCitationCount: result.data.summary.needsCitationCount,
      overallCredibility: result.data.summary.overallCredibility,
      pageResults: result.data.results.map((r) => ({
        pageIndex: r.pageIndex,
        overallScore: r.overallScore,
        credibilityLevel: r.credibilityLevel,
        claimsCount: r.claims.length,
      })),
    };
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Resolve mission ID from session ID or mission ID
   * If the input looks like a session ID (has a corresponding session), find the latest mission
   */
  private async resolveMissionId(
    idOrSessionId: string,
    userId: string,
  ): Promise<string> {
    // First, check if it's a direct mission ID
    const directMission = await this.prisma.slidesMission.findFirst({
      where: { id: idOrSessionId, userId },
    });

    if (directMission) {
      return directMission.id;
    }

    // If not a direct mission, try to find the latest mission for this session
    const latestMission = await this.prisma.slidesMission.findFirst({
      where: {
        sessionId: idOrSessionId,
        userId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (latestMission) {
      this.logger.log(
        `[resolveMissionId] Resolved session ${idOrSessionId} to mission ${latestMission.id}`,
      );
      return latestMission.id;
    }

    throw new NotFoundException(
      `No mission found for ID or session: ${idOrSessionId}`,
    );
  }

  /**
   * Get page HTML from mission
   */
  private async getPageHtml(
    missionId: string,
    pageIndex: number,
    userId: string,
  ): Promise<{ html: string; title: string }> {
    // Resolve mission ID (supports both missionId and sessionId)
    const resolvedMissionId = await this.resolveMissionId(missionId, userId);

    const mission = await this.prisma.slidesMission.findFirst({
      where: {
        id: resolvedMissionId,
        userId,
      },
    });

    if (!mission) {
      throw new NotFoundException(`Mission not found: ${missionId}`);
    }

    const pages = (mission.pages as MissionPage[]) || [];
    const page = pages.find((p) => p.index === pageIndex);

    if (!page) {
      throw new NotFoundException(
        `Page ${pageIndex} not found in mission ${missionId}`,
      );
    }

    return {
      html: page.html || page.content || "",
      title: page.title || `Page ${pageIndex + 1}`,
    };
  }

  /**
   * Get all pages from mission
   */
  private async getPages(
    missionId: string,
    userId: string,
  ): Promise<Array<{ index: number; title: string; content: string }>> {
    // Resolve mission ID (supports both missionId and sessionId)
    const resolvedMissionId = await this.resolveMissionId(missionId, userId);

    const mission = await this.prisma.slidesMission.findFirst({
      where: {
        id: resolvedMissionId,
        userId,
      },
    });

    if (!mission) {
      throw new NotFoundException(`Mission not found: ${missionId}`);
    }

    const pages = (mission.pages as MissionPage[]) || [];

    return pages.map((p) => ({
      index: p.index,
      title: p.title || `Page ${p.index + 1}`,
      content: p.html || p.content || "",
    }));
  }

  /**
   * Update page HTML in mission
   */
  private async updatePageHtml(
    missionId: string,
    pageIndex: number,
    newHtml: string,
    userId: string,
  ): Promise<void> {
    const mission = await this.prisma.slidesMission.findFirst({
      where: {
        id: missionId,
        userId,
      },
    });

    if (!mission) {
      this.logger.warn(`[updatePageHtml] Mission not found: ${missionId}`);
      return;
    }

    const pages = (mission.pages as MissionPage[]) || [];
    const pageIdx = pages.findIndex((p) => p.index === pageIndex);

    if (pageIdx === -1) {
      this.logger.warn(
        `[updatePageHtml] Page ${pageIndex} not found in mission ${missionId}`,
      );
      return;
    }

    pages[pageIdx].html = newHtml;

    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: { pages: pages as unknown as object },
    });

    this.logger.debug(
      `[updatePageHtml] Updated page ${pageIndex} in mission ${missionId}`,
    );
  }

  /**
   * Update page content in mission
   */
  private async updatePageContent(
    missionId: string,
    pageIndex: number,
    newContent: string,
    userId: string,
  ): Promise<void> {
    await this.updatePageHtml(missionId, pageIndex, newContent, userId);
  }

  /**
   * Create skill context
   */
  private createSkillContext(
    skillId: string,
    operation: string,
    missionId: string,
  ): SkillContext {
    return {
      executionId: `${operation}-${missionId}-${Date.now()}`,
      skillId,
      domain: "slides",
      sessionId: missionId,
      createdAt: new Date(),
      metadata: {
        operation,
        missionId,
      },
    };
  }
}
