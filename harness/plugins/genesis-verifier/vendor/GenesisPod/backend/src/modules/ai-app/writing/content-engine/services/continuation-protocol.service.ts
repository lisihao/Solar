/**
 * 续写协议处理服务
 * Continuation Protocol Handler Service
 *
 * 核心职责：
 * 1. 检测内容是否需要续写
 * 2. 管理续写状态
 * 3. 构建续写 Prompt
 * 4. 合并续写结果
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ContinuationState,
  ContinuationDetectionResult,
  ContinuationStopCondition,
  ContinuationPromptOptions,
  ContinuationConfig,
  MergeOptions,
  DEFAULT_CONTINUATION_CONFIG,
} from "../interfaces";
import {
  hasContinuationMarker,
  hasCompletionMarker,
  hasStructuredEnding,
  hasIncompleteSentence,
} from "../constants";

@Injectable()
export class ContinuationProtocolService {
  private readonly logger = new Logger(ContinuationProtocolService.name);

  /** 续写状态存储 (taskId -> state) */
  private stateStore = new Map<string, ContinuationState>();

  /**
   * 检测内容是否需要续写
   */
  detectContinuation(
    content: string,
    expected: {
      minWords?: number;
      hasStructuredEnd?: boolean;
    },
    _config: ContinuationConfig = DEFAULT_CONTINUATION_CONFIG,
  ): ContinuationDetectionResult {
    const trimmedContent = content.trim();
    const wordCount = this.countWords(trimmedContent);

    // 1. 首先检查是否有完成标记
    const completion = hasCompletionMarker(trimmedContent);
    if (completion.found) {
      this.logger.debug(`Completion marker found: ${completion.marker}`);
      return {
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "内容已完成",
        confidence: 0.95,
      };
    }

    // 2. 检查显式续写标记
    const continuation = hasContinuationMarker(trimmedContent);
    if (continuation.found) {
      this.logger.debug(`Continuation marker found: ${continuation.marker}`);
      return {
        needsContinuation: true,
        reason: "explicit_marker",
        detectedMarker: continuation.marker,
        completedPortion: this.estimateCompletedPortion(
          wordCount,
          expected.minWords,
        ),
        lastCheckpoint: this.extractLastCheckpoint(trimmedContent),
        confidence: 0.95,
      };
    }

    // 3. 检查内容长度
    if (expected.minWords && wordCount < expected.minWords * 0.7) {
      this.logger.debug(
        `Content too short: ${wordCount} < ${expected.minWords * 0.7}`,
      );
      return {
        needsContinuation: true,
        reason: "short_content",
        completedPortion: wordCount / expected.minWords,
        lastCheckpoint: this.extractLastCheckpoint(trimmedContent),
        confidence: 0.8,
      };
    }

    // 4. 检查句子完整性
    const incomplete = hasIncompleteSentence(trimmedContent);
    if (incomplete.incomplete) {
      this.logger.debug(`Incomplete sentence detected: ${incomplete.pattern}`);
      return {
        needsContinuation: true,
        reason: "incomplete_sentence",
        completedPortion: this.estimateCompletedPortion(
          wordCount,
          expected.minWords,
        ),
        lastCheckpoint: this.extractLastCheckpoint(trimmedContent),
        confidence: 0.7,
      };
    }

    // 5. 检查结构化结尾
    if (expected.hasStructuredEnd && !hasStructuredEnding(trimmedContent)) {
      return {
        needsContinuation: true,
        reason: "no_ending_marker",
        completedPortion: this.estimateCompletedPortion(
          wordCount,
          expected.minWords,
        ),
        lastCheckpoint: this.extractLastCheckpoint(trimmedContent),
        confidence: 0.6,
      };
    }

    // 内容完整
    return {
      needsContinuation: false,
      completedPortion: 1,
      lastCheckpoint: "内容已完成",
      confidence: 0.9,
    };
  }

  /**
   * 初始化续写状态
   */
  initState(
    taskId: string,
    initialContent: string,
    expected: {
      totalWords: number;
      maxContinuations?: number;
    },
  ): ContinuationState {
    const state: ContinuationState = {
      taskId,
      needsContinuation: true,
      reason: "short_content",
      completedPortion: 0,
      lastCheckpoint: this.extractLastCheckpoint(initialContent),
      continuationCount: 1,
      maxContinuations: expected.maxContinuations || 5,
      accumulatedResult: initialContent,
      expectedTotalWords: expected.totalWords,
      currentTotalWords: this.countWords(initialContent),
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
    };

    this.stateStore.set(taskId, state);
    this.logger.log(`Initialized continuation state for task: ${taskId}`);

    return state;
  }

  /**
   * 更新续写状态
   */
  updateState(
    taskId: string,
    newContent: string,
    detectionResult: ContinuationDetectionResult,
  ): ContinuationState {
    const existingState = this.stateStore.get(taskId);

    if (!existingState) {
      throw new Error(`No continuation state found for task: ${taskId}`);
    }

    // 合并新内容
    const mergedContent = this.mergeResults(
      existingState.accumulatedResult,
      newContent,
      { removeOverlap: true },
    );

    const updatedState: ContinuationState = {
      ...existingState,
      needsContinuation: detectionResult.needsContinuation,
      reason: detectionResult.reason || existingState.reason,
      completedPortion: detectionResult.completedPortion,
      lastCheckpoint: detectionResult.lastCheckpoint,
      continuationCount: existingState.continuationCount + 1,
      accumulatedResult: mergedContent,
      currentTotalWords: this.countWords(mergedContent),
      lastUpdatedAt: new Date(),
    };

    this.stateStore.set(taskId, updatedState);

    this.logger.log(
      `Updated continuation state: ${taskId}, count: ${updatedState.continuationCount}`,
    );

    return updatedState;
  }

  /**
   * 获取续写状态
   */
  getState(taskId: string): ContinuationState | undefined {
    return this.stateStore.get(taskId);
  }

  /**
   * 清理续写状态
   */
  clearState(taskId: string): void {
    this.stateStore.delete(taskId);
    this.logger.debug(`Cleared continuation state for task: ${taskId}`);
  }

  /**
   * 检查是否应该停止续写
   */
  shouldStopContinuation(state: ContinuationState): ContinuationStopCondition {
    // 1. 检测到完成
    if (!state.needsContinuation) {
      return {
        shouldStop: true,
        reason: "completed",
        details: "内容已完成，检测到完成标记或结构化结尾",
      };
    }

    // 2. 达到最大续写次数
    if (state.continuationCount >= state.maxContinuations) {
      return {
        shouldStop: true,
        reason: "max_continuations",
        details: `已达到最大续写次数 (${state.maxContinuations})`,
      };
    }

    // 3. 达到足够长度
    if (state.currentTotalWords >= state.expectedTotalWords * 0.95) {
      return {
        shouldStop: true,
        reason: "sufficient_length",
        details: `已达到预期字数 (${state.currentTotalWords}/${state.expectedTotalWords})`,
      };
    }

    // 继续
    return {
      shouldStop: false,
      reason: "completed",
      details: "需要继续续写",
    };
  }

  /**
   * 构建续写 Prompt
   */
  buildContinuationPrompt(
    state: ContinuationState,
    options: ContinuationPromptOptions,
  ): string {
    const contextWindowSize = options.contextWindowSize || 500;

    // 获取累积内容的最后部分作为上下文
    const lastPortion = state.accumulatedResult.slice(-contextWindowSize);

    // 计算剩余字数
    const remainingWords = Math.max(
      0,
      state.expectedTotalWords - state.currentTotalWords,
    );

    let prompt = `## 续写任务

你正在续写之前未完成的内容。请从断点处继续，保持风格一致。

### 原始任务
**${options.taskTitle}**

${options.taskDescription}

### 已完成部分（最后 ${contextWindowSize} 字作为上下文）
---
${lastPortion}
---

### 断点位置
${state.lastCheckpoint}

### 续写要求
- 还需完成约 **${remainingWords}** 字
- 续写次数：${state.continuationCount}/${state.maxContinuations}
- 直接从断点处继续，**不要重复已有内容**
- 保持人物设定、情节走向、写作风格一致
`;

    if (options.styleReminder) {
      prompt += `\n### 风格提醒\n${options.styleReminder}\n`;
    }

    prompt += `
### 完成标记
- 如果本次产出后任务完成，在结尾标注：**[COMPLETED]**
- 如果仍需继续，在结尾标注：**[CONTINUATION_NEEDED]**

请开始续写：
`;

    return prompt;
  }

  /**
   * 合并续写结果
   */
  mergeResults(
    previousResult: string,
    newResult: string,
    options: MergeOptions = {},
  ): string {
    const {
      removeOverlap = true,
      overlapWindowSize = 100,
      addSeparator = false,
      separator = "\n\n",
    } = options;

    let processedNew = newResult.trim();

    // 移除续写标记
    processedNew = processedNew
      .replace(/\[CONTINUATION_NEEDED\]/gi, "")
      .replace(/\[COMPLETED\]/gi, "")
      .replace(/未完待续/g, "")
      .replace(/待续/g, "")
      .trim();

    // 检测并移除重叠部分
    if (removeOverlap && previousResult.length > overlapWindowSize) {
      const previousEnd = previousResult.slice(-overlapWindowSize);

      // 尝试在新内容中找到重叠
      for (let len = overlapWindowSize; len >= 20; len -= 10) {
        const searchPattern = previousEnd.slice(-len);
        const overlapIndex = processedNew.indexOf(searchPattern);

        if (overlapIndex !== -1 && overlapIndex < len * 1.5) {
          // 找到重叠，从重叠结束位置开始
          processedNew = processedNew.slice(
            overlapIndex + searchPattern.length,
          );
          this.logger.debug(`Removed ${len} chars of overlap`);
          break;
        }
      }
    }

    // 合并
    if (addSeparator) {
      return previousResult + separator + processedNew;
    }

    // 智能连接：检查是否需要添加空格或换行
    const previousEndsWithPunctuation = /[。！？.!?\n]$/.test(previousResult);
    const newStartsWithPunctuation = /^[，,。！？.!?]/.test(processedNew);

    if (previousEndsWithPunctuation || newStartsWithPunctuation) {
      return previousResult + processedNew;
    }

    return previousResult + processedNew;
  }

  /**
   * 获取最终结果
   */
  getFinalResult(taskId: string): string | null {
    const state = this.stateStore.get(taskId);
    if (!state) return null;

    // 清理最终结果中的标记
    return state.accumulatedResult
      .replace(/\[CONTINUATION_NEEDED\]/gi, "")
      .replace(/\[COMPLETED\]/gi, "")
      .replace(/未完待续/g, "")
      .trim();
  }

  // ============ 私有方法 ============

  /**
   * 统计字数
   */
  private countWords(text: string): number {
    // 移除空白字符后计算长度（中文按字符计算）
    return text.replace(/\s/g, "").length;
  }

  /**
   * 估算已完成比例
   */
  private estimateCompletedPortion(
    currentWords: number,
    expectedWords?: number,
  ): number {
    if (!expectedWords) return 0.5;
    return Math.min(1, currentWords / expectedWords);
  }

  /**
   * 提取最后检查点
   */
  private extractLastCheckpoint(content: string): string {
    const trimmed = content.trim();

    // 尝试找到最后一个完整的段落或句子
    const lastParagraph = trimmed.split(/\n\n/).pop() || "";
    const lastSentence =
      lastParagraph.match(/[^。！？.!?]*[。！？.!?]/g)?.pop() || "";

    if (lastSentence) {
      // 截取最后50个字符
      return lastSentence.slice(-50);
    }

    // 如果没有找到完整句子，返回最后50个字符
    return trimmed.slice(-50);
  }
}
