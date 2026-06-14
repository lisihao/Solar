/**
 * Intent Detection Service
 *
 * 意图检测服务（AI Engine 核心能力层）
 * 基于关键词和规则检测用户意图，选择合适的上下文策略
 *
 * 这是领域无关的通用能力，可被任何 AI App 复用：
 * - AI Teams：辩论/总结/分析意图
 * - AI Ask：问答/搜索意图
 * - AI Office：生成/编辑意图
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  UserIntent,
  ContextStrategy,
  IntentDetectionConfig,
  IntentDetectionResult,
  IIntentDetectionService,
} from "./intent.types";

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<Omit<IntentDetectionConfig, "customRules">> = {
  newSessionKeywords: [
    "新对话",
    "新会话",
    "重新开始",
    "new chat",
    "new session",
    "start over",
    "辩论",
    "辩一下",
    "辩一辩",
    "辩题",
    "思辨",
    "红蓝",
    "正方反方",
    "PK",
    "对决",
  ],
  summarizeKeywords: [
    "总结",
    "归纳",
    "概括",
    "summary",
    "summarize",
    "小结",
    "综述",
  ],
  generateKeywords: [
    "生成",
    "输出",
    "创建",
    "画图",
    "生成图",
    "输出图",
    "信息图",
    "图表",
    "可视化",
    "image",
    "picture",
    "diagram",
    "chart",
    "infographic",
    "generate",
    "create",
  ],
  analyzeKeywords: [
    "分析",
    "评价",
    "评估",
    "对比",
    "analyze",
    "compare",
    "evaluate",
    "assess",
  ],
  continueKeywords: [
    "继续",
    "接着",
    "然后呢",
    "还有呢",
    "更多",
    "详细",
    "展开",
    "深入",
    "go on",
    "continue",
    "more",
    "elaborate",
  ],
  referenceKeywords: [
    "上面",
    "之前",
    "刚才",
    "这些",
    "那些",
    "他们的",
    "你们的",
    "观点",
    "结论",
    "论点",
    "above",
    "previous",
    "these",
    "earlier",
  ],
};

@Injectable()
export class IntentDetectionService implements IIntentDetectionService {
  private readonly logger = new Logger(IntentDetectionService.name);
  private config: IntentDetectionConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 检测用户意图
   */
  detectIntent(
    content: string,
    metadata?: Record<string, unknown>,
  ): IntentDetectionResult {
    const contentLower = content.toLowerCase();

    // 1. 先检查自定义规则
    if (this.config.customRules) {
      for (const rule of this.config.customRules) {
        if (rule.condition(content, metadata)) {
          return {
            intent: rule.intent,
            strategy: this.selectStrategy(rule.intent),
            confidence: 0.9,
            matchedKeywords: ["custom_rule"],
          };
        }
      }
    }

    // 2. 检测新会话意图
    const newSessionMatch = this.matchKeywords(
      contentLower,
      this.config.newSessionKeywords || DEFAULT_CONFIG.newSessionKeywords,
    );
    if (newSessionMatch.matched) {
      // 检查是否有多个 @mention（辩论场景）
      const mentionCount = (metadata?.mentionedCount as number) || 0;
      if (
        mentionCount >= 2 ||
        newSessionMatch.keywords.some((k) =>
          [
            "辩论",
            "辩一下",
            "辩一辩",
            "辩题",
            "思辨",
            "红蓝",
            "正方反方",
            "pk",
            "对决",
          ].includes(k.toLowerCase()),
        )
      ) {
        return {
          intent: UserIntent.START_NEW_SESSION,
          strategy: ContextStrategy.ISOLATED,
          confidence: 0.85,
          matchedKeywords: newSessionMatch.keywords,
        };
      }
    }

    // 3. 检测总结意图
    const summarizeMatch = this.matchKeywords(
      contentLower,
      this.config.summarizeKeywords || DEFAULT_CONFIG.summarizeKeywords,
    );
    if (summarizeMatch.matched) {
      return {
        intent: UserIntent.SUMMARIZE,
        strategy: ContextStrategy.REFERENCE_RECENT,
        confidence: 0.8,
        matchedKeywords: summarizeMatch.keywords,
      };
    }

    // 4. 检测生成意图
    const generateMatch = this.matchKeywords(
      contentLower,
      this.config.generateKeywords || DEFAULT_CONFIG.generateKeywords,
    );
    if (generateMatch.matched) {
      return {
        intent: UserIntent.GENERATE,
        strategy: ContextStrategy.REFERENCE_RECENT,
        confidence: 0.8,
        matchedKeywords: generateMatch.keywords,
      };
    }

    // 5. 检测分析意图
    const analyzeMatch = this.matchKeywords(
      contentLower,
      this.config.analyzeKeywords || DEFAULT_CONFIG.analyzeKeywords,
    );
    if (analyzeMatch.matched) {
      return {
        intent: UserIntent.ANALYZE,
        strategy: ContextStrategy.REFERENCE_RECENT,
        confidence: 0.8,
        matchedKeywords: analyzeMatch.keywords,
      };
    }

    // 6. 检测继续意图
    const continueMatch = this.matchKeywords(
      contentLower,
      this.config.continueKeywords || DEFAULT_CONFIG.continueKeywords,
    );
    if (continueMatch.matched) {
      return {
        intent: UserIntent.CONTINUE,
        strategy: ContextStrategy.STANDARD,
        confidence: 0.75,
        matchedKeywords: continueMatch.keywords,
      };
    }

    // 7. 检测引用意图（需要结合其他动作）
    const referenceMatch = this.matchKeywords(
      contentLower,
      this.config.referenceKeywords || DEFAULT_CONFIG.referenceKeywords,
    );
    if (referenceMatch.matched) {
      // 有引用关键词，根据具体动作判断
      if (generateMatch.matched) {
        return {
          intent: UserIntent.GENERATE,
          strategy: ContextStrategy.REFERENCE_RECENT,
          confidence: 0.85,
          matchedKeywords: [
            ...referenceMatch.keywords,
            ...generateMatch.keywords,
          ],
        };
      }
      if (summarizeMatch.matched) {
        return {
          intent: UserIntent.SUMMARIZE,
          strategy: ContextStrategy.REFERENCE_RECENT,
          confidence: 0.85,
          matchedKeywords: [
            ...referenceMatch.keywords,
            ...summarizeMatch.keywords,
          ],
        };
      }
      return {
        intent: UserIntent.ANALYZE,
        strategy: ContextStrategy.REFERENCE_RECENT,
        confidence: 0.7,
        matchedKeywords: referenceMatch.keywords,
      };
    }

    // 8. 默认：普通对话
    return {
      intent: UserIntent.GENERAL_CHAT,
      strategy: ContextStrategy.STANDARD,
      confidence: 0.5,
    };
  }

  /**
   * 根据意图选择上下文策略
   */
  selectStrategy(intent: UserIntent): ContextStrategy {
    switch (intent) {
      case UserIntent.START_NEW_SESSION:
        return ContextStrategy.ISOLATED;

      case UserIntent.SUMMARIZE:
      case UserIntent.GENERATE:
      case UserIntent.ANALYZE:
        return ContextStrategy.REFERENCE_RECENT;

      case UserIntent.CONTINUE:
      case UserIntent.GENERAL_CHAT:
      default:
        return ContextStrategy.STANDARD;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IntentDetectionConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.log("[updateConfig] Configuration updated");
  }

  /**
   * 匹配关键词
   */
  private matchKeywords(
    content: string,
    keywords: string[],
  ): { matched: boolean; keywords: string[] } {
    const matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      if (content.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    return {
      matched: matchedKeywords.length > 0,
      keywords: matchedKeywords,
    };
  }
}
