/**
 * CoordinatorAgent - 任务协调器
 * 负责分析用户意图，制定Multi-Agent执行计划
 *
 * @module ai-agents/coordinator
 */

import { logger } from '@/lib/utils/logger';
import { getAuthHeader } from '@/lib/utils/auth';

export interface AgentPlan {
  // 是否需要深度资源分析
  needsResourceAnalysis: boolean;

  // 是否需要验证
  needsVerification: boolean;

  // 分析重点
  focus?: string;

  // 分析深度
  depth: 'shallow' | 'deep';

  // 推荐使用的模型
  model: 'grok' | 'chatgpt';

  // 置信度
  confidence: number;

  // 执行计划描述
  description?: string;
}

interface CoordinatorInput {
  userMessage: string;
  isPPT: boolean;
  isUpdate: boolean;
  resourceCount: number;
  existingDocumentId?: string;
}

export class CoordinatorAgent {
  private model: string;

  constructor(model: string = 'grok') {
    this.model = model;
  }

  /**
   * 分析用户意图，生成执行计划
   */
  async analyze(input: CoordinatorInput): Promise<AgentPlan> {
    try {
      const prompt = this.buildPrompt(input);

      // BYOK: Include auth header so backend can use user's personal API key
      const response = await fetch('/api/ai/grok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          model: 'grok-2',
          messages: [
            {
              role: 'system',
              content: this.getSystemPrompt(),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1, // 低温度保证准确性
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Coordinator API failed: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content from Coordinator');
      }

      // 解析JSON响应
      const plan = this.parseResponse(content);
      return plan;
    } catch (error) {
      logger.error('CoordinatorAgent error:', error);

      // 降级策略：返回基础计划
      return this.getFallbackPlan(input);
    }
  }

  /**
   * 构建系统提示词
   */
  private getSystemPrompt(): string {
    return `你是AI Office的任务规划专家。你的职责是：
1. 分析用户的文档生成请求
2. 评估是否需要深度资源分析
3. 判断内容是否需要验证
4. 推荐合适的AI模型
5. 返回结构化的执行计划

你必须返回严格的JSON格式，不要包含任何其他文字。`;
  }

  /**
   * 构建用户提示词
   */
  private buildPrompt(input: CoordinatorInput): string {
    return `分析以下文档生成任务，返回执行计划：

用户消息: ${input.userMessage}
文档类型: ${input.isPPT ? 'PPT演示文稿' : '文档'}
操作类型: ${input.isUpdate ? '更新现有文档' : '创建新文档'}
可用资源数量: ${input.resourceCount}
${input.existingDocumentId ? `现有文档ID: ${input.existingDocumentId}` : ''}

请分析并返回JSON格式的执行计划：
{
  "needsResourceAnalysis": boolean,  // 是否需要深度分析资源（资源>2时建议true）
  "needsVerification": boolean,      // 是否需要验证（学术/技术内容建议true）
  "focus": "string",                  // 分析重点（如"学术研究"、"技术实现"、"数据分析"）
  "depth": "shallow|deep",           // 分析深度（创建用deep，更新用shallow）
  "model": "grok|chatgpt",           // 推荐模型（分析用grok，创作用chatgpt）
  "confidence": 0.0-1.0,             // 计划置信度
  "description": "string"            // 执行计划描述
}

只返回JSON，不要其他内容。`;
  }

  /**
   * 解析AI响应
   */
  private parseResponse(content: string): AgentPlan {
    try {
      // 尝试直接解析
      const parsed = JSON.parse(content);
      return this.validatePlan(parsed);
    } catch (error) {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validatePlan(parsed);
      }
      throw new Error('Failed to parse coordinator response');
    }
  }

  /**
   * 验证并规范化计划
   */
  private validatePlan(raw: unknown): AgentPlan {
    const r = raw as Record<string, unknown>;
    return {
      needsResourceAnalysis: Boolean(r.needsResourceAnalysis),
      needsVerification: Boolean(r.needsVerification),
      focus: (r.focus as string) || undefined,
      depth: r.depth === 'shallow' ? 'shallow' : 'deep',
      model: r.model === 'chatgpt' ? 'chatgpt' : 'grok',
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
      description: (r.description as string) || undefined,
    };
  }

  /**
   * 降级方案：基于规则生成计划
   */
  private getFallbackPlan(input: CoordinatorInput): AgentPlan {
    const hasResources = input.resourceCount > 0;
    const isComplex = input.resourceCount > 2;
    const isNewDocument = !input.isUpdate;

    return {
      needsResourceAnalysis: hasResources && isComplex,
      needsVerification: hasResources && isNewDocument,
      focus: input.isPPT ? '演示文稿生成' : '文档撰写',
      depth: isNewDocument ? 'deep' : 'shallow',
      model: 'grok', // 默认使用grok
      confidence: 0.6, // 降级方案置信度较低
      description: '使用规则引擎生成的降级计划',
    };
  }

  /**
   * 获取计划摘要（用于UI显示）
   */
  static getPlanSummary(plan: AgentPlan): string {
    const parts: string[] = [];

    if (plan.needsResourceAnalysis) {
      parts.push(`深度分析${plan.depth === 'deep' ? '（详细）' : '（快速）'}`);
    }

    if (plan.focus) {
      parts.push(`重点：${plan.focus}`);
    }

    if (plan.needsVerification) {
      parts.push('内容验证');
    }

    parts.push(`使用${plan.model === 'grok' ? 'Grok' : 'ChatGPT'}`);

    return parts.join(' → ');
  }
}
