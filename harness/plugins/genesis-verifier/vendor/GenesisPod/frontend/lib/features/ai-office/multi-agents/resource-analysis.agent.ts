/**
 * ResourceAnalysisAgent - 资源深度分析器
 * 负责深度分析学术论文和技术文档，提取核心观点、关键数据和可视化机会
 *
 * @module ai-agents/resource-analysis
 */

import type { Resource } from '@/lib/types/ai-office';

import { logger } from '@/lib/utils/logger';
import { getAuthHeader } from '@/lib/utils/auth';
export interface ResourceAnalysis {
  // 核心洞察
  insights: string[];

  // 关键发现
  findings: Array<{
    claim: string; // 关键发现
    evidence: string; // 支持证据
    source: string; // 来源资源
    confidence: number; // 置信度 0-1
  }>;

  // 可视化机会
  visualOpportunities: Array<{
    type: 'flow' | 'chart' | 'matrix' | 'diagram';
    description: string;
    dataHint?: string; // 数据提示
  }>;

  // 研究方法论（如果适用）
  methodology?: string;

  // 研究背景
  background?: string;

  // 整体置信度
  confidence: number;

  // 分析时间戳
  analyzedAt: Date;
}

interface AnalysisInput {
  resources: Resource[];
  focus?: string;
  analysisDepth: 'shallow' | 'deep';
}

export class ResourceAnalysisAgent {
  private model: string;

  constructor(model: string = 'grok') {
    this.model = model;
  }

  /**
   * 深度分析资源
   */
  async analyze(input: AnalysisInput): Promise<ResourceAnalysis> {
    try {
      const prompt = this.buildPrompt(
        input.resources,
        input.focus,
        input.analysisDepth
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
          temperature: 0.3, // 适中温度，保证准确性的同时允许一定创造性
          max_tokens: input.analysisDepth === 'deep' ? 4000 : 2000,
        }),
      });

      if (!response.ok) {
        throw new Error(`ResourceAnalysis API failed: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content from ResourceAnalysisAgent');
      }

      // 解析分析结果
      const analysis = this.parseResponse(content);
      return {
        ...analysis,
        analyzedAt: new Date(),
      };
    } catch (error) {
      logger.error('ResourceAnalysisAgent error:', error);

      // 降级策略：返回基础分析
      return this.getFallbackAnalysis(input.resources);
    }
  }

  /**
   * 构建系统提示词
   */
  private getSystemPrompt(): string {
    return `你是专业的科研文献分析专家。你的职责是：
1. 深度分析学术论文和技术文档
2. 提取核心观点和关键发现
3. 识别数据可视化机会
4. 评估证据的置信度
5. 返回结构化的分析结果

分析时要注意：
- 准确性优先，不要臆测
- 提取可量化的发现
- 识别适合可视化的数据
- 标注证据来源

你必须返回严格的JSON格式。`;
  }

  /**
   * 构建分析提示词
   */
  private buildPrompt(
    resources: Resource[],
    focus?: string,
    depth: 'shallow' | 'deep' = 'deep'
  ): string {
    const resourceSummaries = resources
      .map((r, i) => {
        const title =
          r.resourceType === 'youtube_video'
            ? r.metadata.title
            : r.resourceType === 'academic_paper'
              ? r.metadata.title
              : r.metadata.title;
        const type = r.resourceType;
        const abstract =
          r.resourceType === 'academic_paper'
            ? r.metadata.abstract
            : r.resourceType === 'web_page' && r.metadata.description
              ? r.metadata.description
              : '';
        const authors =
          r.resourceType === 'academic_paper'
            ? r.metadata.authors.map((a) => a.name).join(', ')
            : '';
        const year =
          r.resourceType === 'academic_paper'
            ? r.metadata.publishedAt?.getFullYear()
            : undefined;
        const contentPreview =
          r.resourceType === 'academic_paper'
            ? r.content.fullText.substring(0, 800)
            : r.resourceType === 'web_page'
              ? r.content.cleanedText.substring(0, 800)
              : '';

        return `
资源 ${i + 1}: ${title}
类型: ${type}
${abstract ? `摘要: ${abstract}` : ''}
${authors ? `作者: ${authors}` : ''}
${year ? `年份: ${year}` : ''}
${contentPreview ? `内容片段: ${contentPreview}...` : ''}
`;
      })
      .join('\n---\n');

    const depthInstruction =
      depth === 'deep'
        ? '进行深度分析，提取详细的发现和证据。'
        : '进行快速分析，提取核心观点即可。';

    return `分析以下${resources.length}篇学术/技术资源：

${resourceSummaries}

${focus ? `\n分析重点: ${focus}\n` : ''}

${depthInstruction}

请以JSON格式返回分析结果：
{
  "insights": [
    "核心观点1",
    "核心观点2",
    "核心观点3"
  ],
  "findings": [
    {
      "claim": "关键发现的陈述",
      "evidence": "支持这一发现的证据",
      "source": "来源资源标题",
      "confidence": 0.0-1.0
    }
  ],
  "visualOpportunities": [
    {
      "type": "flow|chart|matrix|diagram",
      "description": "可视化描述",
      "dataHint": "数据类型提示"
    }
  ],
  "methodology": "研究方法概述（可选）",
  "background": "研究背景概述（可选）",
  "confidence": 0.0-1.0
}

只返回JSON，不要其他内容。`;
  }

  /**
   * 解析AI响应
   */
  private parseResponse(content: string): Omit<ResourceAnalysis, 'analyzedAt'> {
    try {
      const parsed = JSON.parse(content);
      return this.validateAnalysis(parsed);
    } catch (error) {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.validateAnalysis(parsed);
      }
      throw new Error('Failed to parse analysis response');
    }
  }

  /**
   * 验证并规范化分析结果
   */
  private validateAnalysis(raw: unknown): Omit<ResourceAnalysis, 'analyzedAt'> {
    const r = raw as Record<string, unknown>;
    return {
      insights: Array.isArray(r.insights)
        ? r.insights.filter((i) => typeof i === 'string')
        : [],
      findings: Array.isArray(r.findings)
        ? r.findings.map((f: unknown) => {
            const finding = f as Record<string, unknown>;
            return {
              claim: (finding.claim as string) || '',
              evidence: (finding.evidence as string) || '',
              source: (finding.source as string) || '',
              confidence:
                typeof finding.confidence === 'number'
                  ? finding.confidence
                  : 0.7,
            };
          })
        : [],
      visualOpportunities: Array.isArray(r.visualOpportunities)
        ? r.visualOpportunities.map((v: unknown) => {
            const viz = v as Record<string, unknown>;
            return {
              type: ['flow', 'chart', 'matrix', 'diagram'].includes(
                viz.type as string
              )
                ? (viz.type as 'flow' | 'chart' | 'matrix' | 'diagram')
                : 'chart',
              description: (viz.description as string) || '',
              dataHint: viz.dataHint as string | undefined,
            };
          })
        : [],
      methodology: (r.methodology as string) || undefined,
      background: (r.background as string) || undefined,
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.7,
    };
  }

  /**
   * 降级方案：基于资源元数据生成基础分析
   */
  private getFallbackAnalysis(resources: Resource[]): ResourceAnalysis {
    const insights: string[] = [];
    const findings: ResourceAnalysis['findings'] = [];

    // 从资源标题和摘要提取基础信息
    resources.forEach((resource) => {
      const title =
        resource.resourceType === 'youtube_video'
          ? resource.metadata.title
          : resource.resourceType === 'academic_paper'
            ? resource.metadata.title
            : resource.metadata.title;

      insights.push(`研究主题：${title}`);

      const abstract =
        resource.resourceType === 'academic_paper'
          ? resource.metadata.abstract
          : resource.resourceType === 'web_page' &&
              resource.metadata.description
            ? resource.metadata.description
            : null;

      if (abstract && typeof abstract === 'string') {
        findings.push({
          claim: `来自 ${title} 的发现`,
          evidence: abstract.substring(0, 200),
          source: title,
          confidence: 0.5,
        });
      }
    });

    return {
      insights: insights.slice(0, 5),
      findings: findings.slice(0, 3),
      visualOpportunities: [
        {
          type: 'chart',
          description: '数据对比图',
        },
      ],
      background: `基于${resources.length}篇资源的分析`,
      confidence: 0.5,
      analyzedAt: new Date(),
    };
  }

  /**
   * 获取分析摘要（用于UI显示）
   */
  static getAnalysisSummary(analysis: ResourceAnalysis): string {
    const parts: string[] = [];

    if (analysis.insights.length > 0) {
      parts.push(`${analysis.insights.length}个核心洞察`);
    }

    if (analysis.findings.length > 0) {
      parts.push(`${analysis.findings.length}个关键发现`);
    }

    if (analysis.visualOpportunities.length > 0) {
      parts.push(`${analysis.visualOpportunities.length}个可视化机会`);
    }

    parts.push(`置信度${Math.round(analysis.confidence * 100)}%`);

    return parts.join(', ');
  }

  /**
   * 将分析结果转换为Prompt增强内容
   */
  static toPromptEnhancement(analysis: ResourceAnalysis): string {
    const sections: string[] = [];

    if (analysis.insights.length > 0) {
      sections.push(
        `【核心洞察】\n${analysis.insights.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`
      );
    }

    if (analysis.findings.length > 0) {
      sections.push(
        `【关键发现】\n${analysis.findings
          .map(
            (f, idx) => `${idx + 1}. ${f.claim}
   证据: ${f.evidence}
   来源: ${f.source}
   置信度: ${Math.round(f.confidence * 100)}%`
          )
          .join('\n')}`
      );
    }

    if (analysis.visualOpportunities.length > 0) {
      sections.push(
        `【可视化建议】\n${analysis.visualOpportunities.map((v, idx) => `${idx + 1}. ${v.type}: ${v.description}`).join('\n')}`
      );
    }

    if (analysis.methodology) {
      sections.push(`【研究方法】\n${analysis.methodology}`);
    }

    return sections.join('\n\n');
  }
}
