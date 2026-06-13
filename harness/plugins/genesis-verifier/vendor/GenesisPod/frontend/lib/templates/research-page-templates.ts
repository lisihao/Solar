/**
 * Research Page模板系统
 * 结构化研究文档格式，适用于学术研究和深度分析
 */

import { logger } from '@/lib/utils/logger';

export interface ResearchPageSection {
  id: string;
  title: string;
  description: string;
  aiPrompt: string;
  required: boolean;
  order: number;
}

export interface ResearchPageTemplate {
  id: string;
  name: string;
  nameCn: string;
  category: 'academic' | 'industry' | 'technical';
  description: string;
  sections: ResearchPageSection[];
  style: {
    citationStyle: 'apa' | 'mla' | 'chicago' | 'ieee';
    showPageNumbers: boolean;
    showTableOfContents: boolean;
    abstractRequired: boolean;
  };
}

/**
 * 学术研究模板
 */
const academicResearchTemplate: ResearchPageTemplate = {
  id: 'academic-research',
  name: 'Academic Research',
  nameCn: '学术研究报告',
  category: 'academic',
  description: '标准学术研究论文格式，适用于科研项目和学术发表',
  sections: [
    {
      id: 'abstract',
      title: 'Abstract',
      description: '研究摘要',
      aiPrompt:
        '生成简洁的研究摘要（150-250字），包含：研究背景、研究问题、主要方法、关键发现、结论意义',
      required: true,
      order: 1,
    },
    {
      id: 'introduction',
      title: 'Introduction',
      description: '引言与研究背景',
      aiPrompt:
        '撰写引言部分：介绍研究领域背景、现有研究不足、本研究的动机和目标、研究问题定义、论文结构概览',
      required: true,
      order: 2,
    },
    {
      id: 'literature-review',
      title: 'Literature Review',
      description: '文献综述',
      aiPrompt:
        '系统回顾相关文献：按主题分类总结现有研究、识别研究空白、分析理论框架、突出本研究的创新点',
      required: true,
      order: 3,
    },
    {
      id: 'methodology',
      title: 'Methodology',
      description: '研究方法',
      aiPrompt:
        '详细描述研究方法：研究设计、数据来源、分析方法、实验设置（如适用）、评估指标',
      required: true,
      order: 4,
    },
    {
      id: 'results',
      title: 'Results',
      description: '研究结果',
      aiPrompt:
        '呈现研究结果：数据分析结果、统计显著性、可视化图表、关键发现的客观描述',
      required: true,
      order: 5,
    },
    {
      id: 'discussion',
      title: 'Discussion',
      description: '讨论与分析',
      aiPrompt:
        '深入讨论：解释研究结果的意义、与现有文献的关系、研究局限性、未来研究方向',
      required: true,
      order: 6,
    },
    {
      id: 'conclusion',
      title: 'Conclusion',
      description: '结论',
      aiPrompt: '总结全文：重申研究问题、主要发现、理论贡献、实践意义、结束语',
      required: true,
      order: 7,
    },
    {
      id: 'references',
      title: 'References',
      description: '参考文献',
      aiPrompt:
        '列出所有引用的参考文献，按学术规范格式化（基于所选citation style）',
      required: true,
      order: 8,
    },
  ],
  style: {
    citationStyle: 'apa',
    showPageNumbers: true,
    showTableOfContents: true,
    abstractRequired: true,
  },
};

/**
 * 产业研究模板
 */
const industryResearchTemplate: ResearchPageTemplate = {
  id: 'industry-research',
  name: 'Industry Research',
  nameCn: '产业研究报告',
  category: 'industry',
  description: '商业和产业分析报告格式，适用于市场调研和行业分析',
  sections: [
    {
      id: 'executive-summary',
      title: 'Executive Summary',
      description: '执行摘要',
      aiPrompt: '生成高管摘要：核心发现、关键数据、战略建议、行动要点（1-2页）',
      required: true,
      order: 1,
    },
    {
      id: 'industry-overview',
      title: 'Industry Overview',
      description: '行业概况',
      aiPrompt: '概述行业现状：市场规模、增长趋势、主要参与者、价值链分析',
      required: true,
      order: 2,
    },
    {
      id: 'market-analysis',
      title: 'Market Analysis',
      description: '市场分析',
      aiPrompt: '深入市场分析：细分市场、目标客户、竞争格局、SWOT分析',
      required: true,
      order: 3,
    },
    {
      id: 'competitive-landscape',
      title: 'Competitive Landscape',
      description: '竞争态势',
      aiPrompt: '分析竞争环境：主要竞争对手、市场份额、差异化策略、竞争优势',
      required: true,
      order: 4,
    },
    {
      id: 'trends-insights',
      title: 'Trends & Insights',
      description: '趋势洞察',
      aiPrompt: '识别关键趋势：技术创新、消费者行为变化、监管环境、未来机遇',
      required: true,
      order: 5,
    },
    {
      id: 'recommendations',
      title: 'Strategic Recommendations',
      description: '战略建议',
      aiPrompt: '提出战略建议：行动计划、投资建议、风险评估、实施路线图',
      required: true,
      order: 6,
    },
  ],
  style: {
    citationStyle: 'chicago',
    showPageNumbers: true,
    showTableOfContents: true,
    abstractRequired: false,
  },
};

/**
 * 技术分析模板
 */
const technicalAnalysisTemplate: ResearchPageTemplate = {
  id: 'technical-analysis',
  name: 'Technical Analysis',
  nameCn: '技术分析报告',
  category: 'technical',
  description: '技术深度分析文档，适用于技术评估和架构设计',
  sections: [
    {
      id: 'overview',
      title: 'Technical Overview',
      description: '技术概览',
      aiPrompt: '技术背景介绍：技术栈、应用场景、核心目标、文档结构',
      required: true,
      order: 1,
    },
    {
      id: 'architecture',
      title: 'System Architecture',
      description: '系统架构',
      aiPrompt: '描述系统架构：整体架构图、核心组件、数据流、技术选型理由',
      required: true,
      order: 2,
    },
    {
      id: 'implementation',
      title: 'Implementation Details',
      description: '实现细节',
      aiPrompt: '详细实现说明：关键算法、数据结构、性能优化、代码示例',
      required: true,
      order: 3,
    },
    {
      id: 'evaluation',
      title: 'Performance Evaluation',
      description: '性能评估',
      aiPrompt: '性能分析：基准测试、性能指标、瓶颈分析、优化建议',
      required: true,
      order: 4,
    },
    {
      id: 'comparison',
      title: 'Comparative Analysis',
      description: '对比分析',
      aiPrompt: '技术对比：与其他方案比较、优势劣势、适用场景、选型建议',
      required: false,
      order: 5,
    },
    {
      id: 'future-work',
      title: 'Future Work',
      description: '未来工作',
      aiPrompt: '展望未来：改进方向、扩展计划、技术演进、路线图',
      required: true,
      order: 6,
    },
  ],
  style: {
    citationStyle: 'ieee',
    showPageNumbers: true,
    showTableOfContents: true,
    abstractRequired: false,
  },
};

/**
 * 所有Research Page模板
 */
export const RESEARCH_PAGE_TEMPLATES: ResearchPageTemplate[] = [
  academicResearchTemplate,
  industryResearchTemplate,
  technicalAnalysisTemplate,
];

/**
 * 根据ID获取模板
 */
export function getResearchPageTemplateById(id: string): ResearchPageTemplate {
  const template = RESEARCH_PAGE_TEMPLATES.find((t) => t.id === id);
  if (!template) {
    logger.warn(`Research Page template "${id}" not found, using default`);
    return academicResearchTemplate;
  }
  return template;
}

/**
 * 根据类别获取模板
 */
export function getResearchPageTemplatesByCategory(
  category: ResearchPageTemplate['category']
): ResearchPageTemplate[] {
  return RESEARCH_PAGE_TEMPLATES.filter((t) => t.category === category);
}

/**
 * 获取所有模板
 */
export function getAllResearchPageTemplates(): ResearchPageTemplate[] {
  return RESEARCH_PAGE_TEMPLATES;
}

/**
 * 生成Research Page的Markdown结构
 */
export function generateResearchPageStructure(
  template: ResearchPageTemplate,
  title: string
): string {
  const sections = template.sections
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      return `## ${section.title}

<!-- Section: ${section.id} -->
<!-- Prompt: ${section.aiPrompt} -->

_此部分将由AI根据选中的资源生成..._

`;
    })
    .join('\n');

  return `# ${title}

${template.style.abstractRequired ? '**Abstract**: _待生成_\n\n' : ''}${template.style.showTableOfContents ? '## Table of Contents\n\n_自动生成_\n\n---\n\n' : ''}${sections}
---

## Metadata

- **Template**: ${template.nameCn} (${template.name})
- **Category**: ${template.category}
- **Citation Style**: ${template.style.citationStyle.toUpperCase()}
- **Generated**: ${new Date().toLocaleDateString('zh-CN')}
`;
}
