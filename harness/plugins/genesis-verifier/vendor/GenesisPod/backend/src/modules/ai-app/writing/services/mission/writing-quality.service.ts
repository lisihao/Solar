/**
 * Writing Quality Service
 *
 * 负责质量检查、表达冷却和质量门禁
 * 从 WritingMissionService 拆分出来，专注于质量管理逻辑
 *
 * 注意：这是一个薄包装层，主要用于简化 WritingMissionService 的依赖
 * 实际的质量检查逻辑仍在 ExpressionMemoryService 和 WritingQualityGateService 中
 */

import { Injectable } from "@nestjs/common";
import { ExpressionMemoryService } from "../quality/expression-memory.service";
import { WritingQualityGateService } from "../quality/quality-gate.service";

@Injectable()
export class WritingQualityService {
  constructor(
    private readonly expressionMemory: ExpressionMemoryService,
    private readonly qualityGate: WritingQualityGateService,
  ) {}

  /**
   * 检查章节内容质量
   * 委托给 WritingQualityGateService
   */
  async checkChapterQuality(
    projectId: string,
    chapterId: string,
    chapterNumber: number,
    content: string,
  ) {
    return this.qualityGate.checkQualityGate(
      projectId,
      chapterId,
      chapterNumber,
      content,
    );
  }

  /**
   * 获取冷却中的表达式
   * 委托给 ExpressionMemoryService
   */
  async getCoolingExpressions(
    projectId: string,
    chapterNumber: number,
    limit: number = 200,
  ) {
    return this.expressionMemory.getCoolingExpressions(
      projectId,
      chapterNumber,
      limit,
    );
  }

  /**
   * 生成避免重复表达的提示
   * 委托给 ExpressionMemoryService
   */
  async generateAvoidancePrompt(projectId: string, chapterNumber: number) {
    return this.expressionMemory.generateAvoidancePrompt(
      projectId,
      chapterNumber,
    );
  }

  /**
   * 分析并记录章节中的表达式
   * 委托给 ExpressionMemoryService
   */
  async analyzeAndRecordExpressions(
    projectId: string,
    chapterId: string,
    chapterNumber: number,
    content: string,
  ) {
    return this.expressionMemory.analyzeAndRecordExpressions(
      projectId,
      chapterId,
      chapterNumber,
      content,
    );
  }
}
