/**
 * 高级 Markdown 解析器
 * 支持 Genspark 风格的可视化标记
 *
 * SECURITY: All HTML output is sanitized using DOMPurify to prevent XSS attacks
 */

import { sanitizeHtml } from '@/lib/utils/sanitize';

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

export interface FlowStep {
  id: string;
  label: string;
  description?: string;
}

export interface MatrixItem {
  quadrant: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  label: string;
  description: string;
}

export interface EnhancedSlide {
  id: string;
  title: string;
  type:
    | 'cover'
    | 'content'
    | 'flowchart'
    | 'chart'
    | 'matrix'
    | 'timeline'
    | 'comparison';
  content: string[];
  images?: string[];
  layout?:
    | 'title'
    | 'content'
    | 'image-left'
    | 'image-right'
    | 'image-full'
    | '2-column';

  // 可视化相关
  visualizationType?: 'flow' | 'chart' | 'matrix' | 'timeline';
  chartType?: 'line' | 'pie' | 'bar' | 'radar' | 'area';
  chartData?: ChartData;
  flowSteps?: FlowStep[];
  matrixItems?: MatrixItem[];

  // 原始 markdown
  rawContent: string;
}

/**
 * 解析 markdown 为增强型幻灯片
 */
export function parseMarkdownToEnhancedSlides(
  markdown: string
): EnhancedSlide[] {
  const slides: EnhancedSlide[] = [];
  const lines = markdown.split('\n');
  let currentSlide: Partial<EnhancedSlide> | null = null;
  let collectingContent = false;
  let rawContentBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测幻灯片标题
    const slideHeaderMatch = trimmed.match(
      /^#{2,4}\s*(第\s*\d+\s*页|Slide\s*\d+)[:：]?\s*(.+)/i
    );

    if (slideHeaderMatch) {
      // 保存上一张幻灯片
      if (currentSlide) {
        finalizeSlide(currentSlide, rawContentBuffer.join('\n'));
        slides.push(currentSlide as EnhancedSlide);
      }

      // 开始新幻灯片
      const titleText = slideHeaderMatch[2].trim();
      currentSlide = {
        id: `slide-${slides.length + 1}`,
        title: titleText,
        type: 'content',
        content: [],
        images: [],
        layout: 'content',
        rawContent: '',
      };
      rawContentBuffer = [line];
      collectingContent = true;

      // 检测封面页
      if (
        slides.length === 0 ||
        titleText.includes('封面') ||
        titleText.includes('标题')
      ) {
        currentSlide.type = 'cover';
      }
    } else if (trimmed === '---') {
      // 幻灯片分隔符
      if (currentSlide) {
        finalizeSlide(currentSlide, rawContentBuffer.join('\n'));
        slides.push(currentSlide as EnhancedSlide);
        currentSlide = null;
        rawContentBuffer = [];
        collectingContent = false;
      }
    } else if (currentSlide && collectingContent) {
      rawContentBuffer.push(line);

      // 检测可视化标记
      if (trimmed.startsWith('<!-- FLOW -->')) {
        currentSlide.type = 'flowchart';
        currentSlide.visualizationType = 'flow';
      } else if (trimmed.match(/<!-- CHART:(line|pie|bar|radar|area) -->/)) {
        const match = trimmed.match(/<!-- CHART:(\w+) -->/);
        if (match) {
          const chartType = match[1] as
            | 'line'
            | 'pie'
            | 'bar'
            | 'radar'
            | 'area';
          currentSlide.type = 'chart';
          currentSlide.visualizationType = 'chart';
          currentSlide.chartType = chartType;
        }
      } else if (trimmed.startsWith('<!-- MATRIX -->')) {
        currentSlide.type = 'matrix';
        currentSlide.visualizationType = 'matrix';
      } else if (trimmed.startsWith('<!-- TIMELINE -->')) {
        currentSlide.type = 'timeline';
        currentSlide.visualizationType = 'timeline';
      } else if (trimmed.startsWith('![')) {
        // 图片
        const imageMatch = trimmed.match(/!\[.*?\]\((.+?)\)/);
        if (imageMatch && currentSlide.images) {
          currentSlide.images.push(imageMatch[1]);
        }
      } else if (trimmed && !trimmed.startsWith('#')) {
        // 内容行
        currentSlide.content?.push(line);
      }
    }
  }

  // 保存最后一张幻灯片
  if (currentSlide) {
    finalizeSlide(currentSlide, rawContentBuffer.join('\n'));
    slides.push(currentSlide as EnhancedSlide);
  }

  return slides;
}

/**
 * 完成幻灯片解析，提取特定类型的数据
 */
function finalizeSlide(slide: Partial<EnhancedSlide>, rawContent: string) {
  slide.rawContent = rawContent;

  // 根据类型解析数据
  if (slide.type === 'flowchart') {
    slide.flowSteps = parseFlowSteps(slide.content || []);
  } else if (slide.type === 'chart') {
    slide.chartData = parseChartData(slide.content || [], slide.chartType);
  } else if (slide.type === 'matrix') {
    slide.matrixItems = parseMatrixItems(slide.content || []);
  }

  // 确定布局
  const hasImages = slide.images && slide.images.length > 0;
  const hasContent = slide.content && slide.content.length > 0;

  if (slide.type === 'cover') {
    slide.layout = 'title';
  } else if (!hasImages) {
    slide.layout = 'content';
  } else if (!hasContent) {
    slide.layout = 'image-full';
  } else {
    slide.layout =
      (slide.images?.length || 0) % 2 === 1 ? 'image-left' : 'image-right';
  }

  // 检测对比布局
  if (hasMultipleColumns(slide.content || [])) {
    slide.type = 'comparison';
    slide.layout = '2-column';
  }
}

/**
 * 解析流程步骤
 */
function parseFlowSteps(content: string[]): FlowStep[] {
  const steps: FlowStep[] = [];
  const stepRegex = /^(\d+)\.\s*\*?\*?(.+?)\*?\*?\s*(?:→|->)\s*(.+)/;

  for (const line of content) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    const match = trimmed.match(stepRegex);
    if (match) {
      steps.push({
        id: `step-${match[1]}`,
        label: match[2].trim(),
        description: match[3].trim(),
      });
    } else if (trimmed.match(/^\d+\./)) {
      // 简单的数字列表
      const simpleMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
      if (simpleMatch) {
        steps.push({
          id: `step-${simpleMatch[1]}`,
          label: simpleMatch[2].trim(),
        });
      }
    }
  }

  return steps;
}

/**
 * 解析图表数据
 */
function parseChartData(content: string[], chartType?: string): ChartData {
  const labels: string[] = [];
  const data: number[] = [];

  for (const line of content) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('!'))
      continue;

    // 匹配格式: "- 标签: 数值" 或 "- 标签：数值"
    const dataMatch = trimmed.match(/^-\s*(.+?)[:：]\s*(\d+\.?\d*)(%|万|亿)?/);
    if (dataMatch) {
      labels.push(dataMatch[1].trim());
      let value = parseFloat(dataMatch[2]);

      // 处理单位
      if (dataMatch[3] === '万') value *= 10000;
      if (dataMatch[3] === '亿') value *= 100000000;

      data.push(value);
    }
  }

  return {
    labels,
    datasets: [
      {
        label: chartType === 'pie' ? '占比' : '数值',
        data,
      },
    ],
  };
}

/**
 * 解析矩阵项目
 */
function parseMatrixItems(content: string[]): MatrixItem[] {
  const items: MatrixItem[] = [];
  const quadrantMap: Record<string, MatrixItem['quadrant']> = {
    '高价值 + 高难度': 'top-right',
    '高价值 + 低难度': 'top-left',
    '低价值 + 高难度': 'bottom-right',
    '低价值 + 低难度': 'bottom-left',
  };

  for (const line of content) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    // 匹配格式: "**标签：** 描述"
    const match = trimmed.match(/\*\*(.+?)[:：]\*\*\s*(.+)/);
    if (match) {
      const label = match[1].trim();
      const description = match[2].trim();
      const quadrant = quadrantMap[label] || 'top-left';

      items.push({
        quadrant,
        label,
        description,
      });
    }
  }

  return items;
}

/**
 * 检测是否有多列布局
 */
function hasMultipleColumns(content: string[]): boolean {
  let boldTitleCount = 0;

  for (const line of content) {
    if (line.trim().match(/^\*\*.+\*\*[:：]/)) {
      boldTitleCount++;
    }
  }

  return boldTitleCount >= 2;
}

/**
 * 渲染单行内容（处理markdown格式）
 * SECURITY: Output is sanitized to prevent XSS attacks
 */
export function renderMarkdownLine(line: string): string {
  const rendered = line
    .replace(/^\*\*(.+?)\*\*[:：]\s*\*\*/, '') // 移除 **标题**: **
    .replace(/^\*\*(.+?)\*\*[:：]?/, '<strong>$1</strong>') // **粗体**:
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // **粗体**
    .replace(/^-\s+/, '• ') // 列表符号
    .replace(/^\d+\.\s+/, (match) => match); // 数字列表

  // Sanitize the output to prevent XSS
  return sanitizeHtml(rendered);
}
