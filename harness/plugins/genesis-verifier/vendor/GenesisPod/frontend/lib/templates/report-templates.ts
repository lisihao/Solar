/**
 * 报告模板配置
 */

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  minItems: number;
  maxItems: number;
  sections: string[];
  estimatedTime: string;
  model: 'grok' | 'gpt-4';
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'comparison',
    name: '对比分析',
    description: '多维度对比各素材的特点、优劣势和适用场景',
    icon: '📊',
    minItems: 2,
    maxItems: 5,
    sections: ['概述', '详细对比表', '关键洞察', '选型建议'],
    estimatedTime: '60秒',
    model: 'gpt-4', // 需要复杂推理
  },
  {
    id: 'trend',
    name: '趋势报告',
    description: '分析技术演进轨迹和未来发展方向',
    icon: '📈',
    minItems: 3,
    maxItems: 10,
    sections: ['时间轴', '关键突破', '趋势预测', '机会分析'],
    estimatedTime: '45秒',
    model: 'grok',
  },
  {
    id: 'learning-path',
    name: '学习路径',
    description: '生成由浅入深的学习计划和实践建议',
    icon: '🗺️',
    minItems: 3,
    maxItems: 8,
    sections: ['前置知识', '学习顺序', '难度分析', '实践建议'],
    estimatedTime: '50秒',
    model: 'grok',
  },
  {
    id: 'literature-review',
    name: '文献综述',
    description: '学术风格的文献综述报告',
    icon: '📝',
    minItems: 5,
    maxItems: 10,
    sections: ['研究背景', '方法演进', '结果对比', '未来方向'],
    estimatedTime: '90秒',
    model: 'gpt-4',
  },
];

/**
 * 根据ID获取模板
 */
export function getTemplateById(id: string): ReportTemplate | undefined {
  return REPORT_TEMPLATES.find((t) => t.id === id);
}

/**
 * 验证选择的资源数量是否符合模板要求
 */
export function validateResourceCount(
  template: ReportTemplate,
  count: number
): {
  valid: boolean;
  message?: string;
} {
  if (count < template.minItems) {
    return {
      valid: false,
      message: `至少需要选择 ${template.minItems} 项资源`,
    };
  }
  if (count > template.maxItems) {
    return {
      valid: false,
      message: `最多只能选择 ${template.maxItems} 项资源`,
    };
  }
  return { valid: true };
}
