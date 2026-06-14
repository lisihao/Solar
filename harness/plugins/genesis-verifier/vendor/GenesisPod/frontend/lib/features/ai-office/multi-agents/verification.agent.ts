/**
 * VerificationAgent - 内容验证器
 * 负责验证生成内容的准确性，标注置信度和提供改进建议
 *
 * @module ai-agents/verification
 */

import type { Resource } from '@/lib/types/ai-office';

import { logger } from '@/lib/utils/logger';
import { getAuthHeader } from '@/lib/utils/auth';
export type VerificationStatus =
  | 'verified'
  | 'uncertain'
  | 'unsupported'
  | 'conflicting';

export interface VerificationBadge {
  section: string; // 章节/页面标识
  status: VerificationStatus;
  confidence: number; // 置信度 0-1
  issues?: string[]; // 问题列表
  suggestions?: string[]; // 改进建议
}

export interface VerificationResult {
  // 整体置信度
  confidence: number;

  // 章节级别的验证标记
  badges: VerificationBadge[];

  // 全局改进建议
  suggestions: string[];

  // 发现的问题
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    description: string;
    location?: string;
  }>;

  // 验证摘要
  summary: string;

  // 验证时间戳
  verifiedAt: Date;
}

interface VerificationInput {
  content: string;
  sources: Resource[];
  documentType?: 'ppt' | 'doc' | 'article';
}

export class VerificationAgent {
  private model: string;

  constructor(model: string = 'grok') {
    this.model = model;
  }

  /**
   * 验证生成的内容
   */
  async verify(input: VerificationInput): Promise<VerificationResult> {
    try {
      const prompt = this.buildPrompt(
        input.content,
        input.sources,
        input.documentType
      );

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
          temperature: 0.1, // 极低温度保证准确性
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Verification API failed: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content from VerificationAgent');
      }

      // 解析验证结果
      const verification = this.parseResponse(content);
      return {
        ...verification,
        verifiedAt: new Date(),
      };
    } catch (error) {
      logger.error('VerificationAgent error:', error);

      // 降级策略：返回基础验证
      return this.getFallbackVerification(input.content);
    }
  }

  /**
   * 构建系统提示词
   */
  private getSystemPrompt(): string {
    return `你是专业的内容验证专家。你的职责是：
1. 验证生成内容与参考资源的一致性
2. 识别不支持的陈述或错误引用
3. 检测内容中的矛盾或逻辑问题
4. 评估各章节的置信度
5. 提供改进建议

验证标准：
- verified: 有明确证据支持
- uncertain: 部分支持或证据不足
- unsupported: 缺乏证据支持
- conflicting: 与资源冲突

你必须返回严格的JSON格式。`;
  }

  /**
   * 构建验证提示词
   */
  private buildPrompt(
    content: string,
    sources: Resource[],
    documentType?: string
  ): string {
    const sourceSummaries = sources
      .map((s, i) => {
        const title =
          s.resourceType === 'youtube_video'
            ? s.metadata.title
            : s.resourceType === 'academic_paper'
              ? s.metadata.title
              : s.metadata.title;
        const abstract =
          s.resourceType === 'academic_paper'
            ? s.metadata.abstract
            : s.resourceType === 'web_page' && s.metadata.description
              ? s.metadata.description
              : null;
        const authors =
          s.resourceType === 'academic_paper'
            ? s.metadata.authors.map((a) => a.name).join(', ')
            : null;

        return `
资源 ${i + 1}: ${title}
${abstract && typeof abstract === 'string' ? `摘要: ${abstract.substring(0, 300)}` : ''}
${authors ? `作者: ${authors}` : ''}
`;
      })
      .join('\n');

    // 根据文档类型调整内容分割
    let sections: string[];
    if (documentType === 'ppt' && content.includes('---')) {
      sections = content.split('---').map((s, i) => `Slide ${i + 1}`);
    } else if (content.includes('##')) {
      const matches = content.match(/## .+/g);
      sections = matches || ['全文'];
    } else {
      sections = ['全文'];
    }

    return `验证以下生成内容的准确性：

【生成内容】
${content.substring(0, 3000)}${content.length > 3000 ? '...(已截断)' : ''}

【参考资源】
${sourceSummaries}

【内容结构】
检测到 ${sections.length} 个章节/页面: ${sections.slice(0, 10).join(', ')}${sections.length > 10 ? '...' : ''}

请交叉验证内容与资源，返回JSON格式的验证结果：
{
  "confidence": 0.0-1.0,
  "badges": [
    {
      "section": "章节/页面标识",
      "status": "verified|uncertain|unsupported|conflicting",
      "confidence": 0.0-1.0,
      "issues": ["问题1", "问题2"],
      "suggestions": ["建议1"]
    }
  ],
  "suggestions": [
    "全局改进建议1",
    "全局改进建议2"
  ],
  "issues": [
    {
      "severity": "high|medium|low",
      "description": "问题描述",
      "location": "位置（可选）"
    }
  ],
  "summary": "验证摘要"
}

重点关注：
1. 数据/统计数字是否有来源支持
2. 因果关系陈述是否有证据
3. 专业术语使用是否准确
4. 是否存在过度推断

只返回JSON，不要其他内容。`;
  }

  /**
   * 解析AI响应
   */
  private parseResponse(
    content: string
  ): Omit<VerificationResult, 'verifiedAt'> {
    try {
      const parsed = JSON.parse(content);
      return this.validateVerification(parsed);
    } catch (error) {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validateVerification(parsed);
      }
      throw new Error('Failed to parse verification response');
    }
  }

  /**
   * 验证并规范化验证结果
   */
  private validateVerification(
    raw: unknown
  ): Omit<VerificationResult, 'verifiedAt'> {
    const r = raw as Record<string, unknown>;
    const validStatuses: VerificationStatus[] = [
      'verified',
      'uncertain',
      'unsupported',
      'conflicting',
    ];

    return {
      confidence:
        typeof r.confidence === 'number'
          ? Math.max(0, Math.min(1, r.confidence))
          : 0.7,
      badges: Array.isArray(r.badges)
        ? r.badges.map((b) => {
            const badge = b as Record<string, unknown>;
            return {
              section: (badge.section as string) || '未知',
              status: validStatuses.includes(badge.status as VerificationStatus)
                ? (badge.status as VerificationStatus)
                : 'uncertain',
              confidence:
                typeof badge.confidence === 'number'
                  ? Math.max(0, Math.min(1, badge.confidence))
                  : 0.7,
              issues: Array.isArray(badge.issues)
                ? badge.issues.filter((i) => typeof i === 'string')
                : undefined,
              suggestions: Array.isArray(badge.suggestions)
                ? badge.suggestions.filter((s) => typeof s === 'string')
                : undefined,
            };
          })
        : [],
      suggestions: Array.isArray(r.suggestions)
        ? r.suggestions.filter((s) => typeof s === 'string')
        : [],
      issues: Array.isArray(r.issues)
        ? r.issues.map((i) => {
            const issue = i as Record<string, unknown>;
            return {
              severity: ['high', 'medium', 'low'].includes(
                issue.severity as string
              )
                ? (issue.severity as 'high' | 'medium' | 'low')
                : 'medium',
              description: (issue.description as string) || '',
              location: issue.location as string | undefined,
            };
          })
        : [],
      summary: (r.summary as string) || '验证完成',
    };
  }

  /**
   * 降级方案：基础验证
   */
  private getFallbackVerification(content: string): VerificationResult {
    // 简单的章节检测
    const sections =
      content.split('---').length > 1
        ? content.split('---').map((_, i) => `Slide ${i + 1}`)
        : ['全文'];

    return {
      confidence: 0.6,
      badges: sections.slice(0, 5).map((section) => ({
        section,
        status: 'uncertain',
        confidence: 0.6,
      })),
      suggestions: ['建议人工审核生成内容', '验证数据来源'],
      issues: [],
      summary: '自动验证不可用，建议人工审核',
      verifiedAt: new Date(),
    };
  }

  /**
   * 获取验证摘要（用于UI显示）
   */
  static getVerificationSummary(result: VerificationResult): string {
    const total = result.badges.length;
    const verified = result.badges.filter(
      (b) => b.status === 'verified'
    ).length;
    const uncertain = result.badges.filter(
      (b) => b.status === 'uncertain'
    ).length;
    const issues = result.badges.filter(
      (b) => b.status === 'unsupported' || b.status === 'conflicting'
    ).length;

    const parts: string[] = [];

    if (verified > 0) parts.push(`✅ ${verified}个已验证`);
    if (uncertain > 0) parts.push(`⚠️ ${uncertain}个待确认`);
    if (issues > 0) parts.push(`❌ ${issues}个问题`);

    parts.push(`整体置信度${Math.round(result.confidence * 100)}%`);

    return parts.join(', ');
  }

  /**
   * 获取状态对应的颜色类名
   */
  static getStatusColor(status: VerificationStatus): string {
    const colors = {
      verified: 'text-green-600 bg-green-50 border-green-200',
      uncertain: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      unsupported: 'text-red-600 bg-red-50 border-red-200',
      conflicting: 'text-orange-600 bg-orange-50 border-orange-200',
    };
    return colors[status];
  }

  /**
   * 获取状态对应的图标
   */
  static getStatusIcon(status: VerificationStatus): string {
    const icons = {
      verified: '✅',
      uncertain: '⚠️',
      unsupported: '❌',
      conflicting: '⚡',
    };
    return icons[status];
  }

  /**
   * 获取状态对应的文字
   */
  static getStatusText(status: VerificationStatus): string {
    const texts = {
      verified: '已验证',
      uncertain: '待确认',
      unsupported: '无证据',
      conflicting: '有冲突',
    };
    return texts[status];
  }
}
