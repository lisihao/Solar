import { NextRequest, NextResponse } from 'next/server';
import {
  CoordinatorAgent,
  ResourceAnalysisAgent,
} from '@/lib/features/ai-office/multi-agents';
import type { Resource, ResourceType } from '@/lib/types/ai-office';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

// AI Service URL - keep as separate service
const AI_SERVICE_URL = `https://${config.railway.domain}-ai-service.up.railway.app`;

// 缓存默认模型 ID（避免每次请求都查询）
let cachedDefaultModel: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 分钟缓存

/**
 * 获取系统配置的默认 CHAT 类型 AI 模型
 * 使用公开的 ai-office/models/default/text 端点（无需认证）
 */
async function getDefaultModel(): Promise<string> {
  const now = Date.now();
  if (cachedDefaultModel && now - cacheTimestamp < CACHE_TTL) {
    return cachedDefaultModel;
  }

  try {
    // 使用公开的 AI Office 端点获取默认文本模型
    const res = await fetch(`${API_BASE_URL}/ai-office/models/default/text`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const defaultModel = await res.json();
      if (defaultModel?.name) {
        cachedDefaultModel = defaultModel.name;
        cacheTimestamp = now;
        logger.debug('[AI Office] Using default model:', defaultModel.name);
        return defaultModel.name;
      }
    }
  } catch (err) {
    logger.warn('[AI Office] Failed to fetch default model:', err);
  }

  // 如果获取失败，回退到 grok（保底方案）
  logger.warn('[AI Office] Falling back to grok model');
  return 'grok';
}

/**
 * AI Office Chat API with Multi-Agent Enhancement
 * Handles AI conversations with resource context for document generation
 */
interface AIOfficeResource {
  resourceType: string;
  metadata?: {
    title?: string;
    description?: string;
    authors?: string;
    channel?: string;
    url?: string;
  };
  aiAnalysis?: {
    summary?: string;
    keyPoints?: string[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      message,
      resources = [],
      model = '', // 将从后端获取默认模型
      stream = true,
      generateDocument = false,
      isDocumentGeneration = false,
      conversationHistory = [],
      agentMode = 'basic', // 🆕 Multi-Agent mode: 'basic' | 'enhanced'
      documentId,
    } = body as {
      message: string;
      resources?: AIOfficeResource[];
      documentId?: string;
      model?: string;
      stream?: boolean;
      generateDocument?: boolean;
      isDocumentGeneration?: boolean;
      conversationHistory?: Array<{ role: string; content: string }>;
      agentMode?: 'basic' | 'enhanced';
    };

    // ============ 🆕 Multi-Agent Pre-processing ============
    let enhancedContext = '';
    let agentPlan;
    let resourceAnalysis;

    if (agentMode === 'enhanced' && resources.length > 0) {
      try {
        // Step 1: CoordinatorAgent分析意图
        const coordinator = new CoordinatorAgent(model || undefined);
        const isPPT = /ppt|powerpoint|演示|幻灯片/i.test(message);
        const isUpdate = /更新|修改|补充|重新生成/i.test(message);

        agentPlan = await coordinator.analyze({
          userMessage: message,
          isPPT,
          isUpdate,
          resourceCount: resources.length,
          existingDocumentId: documentId,
        });

        logger.debug('[Multi-Agent] Plan:', agentPlan);

        // Step 2: ResourceAnalysisAgent深度分析资源（如果需要）
        if (agentPlan.needsResourceAnalysis) {
          const analyzer = new ResourceAnalysisAgent(model || undefined);

          // 转换资源格式 (简化版本用于分析)
          const convertedResources = resources.map((r) => ({
            _id: '',
            userId: '',
            resourceId: '',
            resourceType: r.resourceType as ResourceType,
            status: 'collected' as const,
            collectedAt: new Date(),
            updatedAt: new Date(),
            url: r.metadata?.url || '',
            metadata: r.metadata || {},
            content: {},
            aiAnalysis: r.aiAnalysis || { summary: '', keyPoints: [] },
          })) as Resource[];

          resourceAnalysis = await analyzer.analyze({
            resources: convertedResources,
            focus: agentPlan.focus,
            analysisDepth: agentPlan.depth,
          });

          logger.debug('[Multi-Agent] Resource Analysis:', {
            insights: resourceAnalysis.insights.length,
            findings: resourceAnalysis.findings.length,
            confidence: resourceAnalysis.confidence,
          });

          // 将分析结果转换为增强Context
          enhancedContext =
            ResourceAnalysisAgent.toPromptEnhancement(resourceAnalysis);
        }
      } catch (error) {
        logger.error('[Multi-Agent] Pre-processing error:', error);
        // 降级到basic模式
      }
    }

    // ============ 原有逻辑：构建系统提示 ============
    // Build context from selected resources
    const baseContext = buildResourceContext(resources);

    // 合并基础context和Multi-Agent增强context
    const finalContext = enhancedContext
      ? `${baseContext}\n\n=== AI深度分析结果 ===\n${enhancedContext}`
      : baseContext;

    // 构建系统提示
    let systemPrompt = '';
    if (isDocumentGeneration || generateDocument) {
      systemPrompt = `你是一个专业的PPT创作助手，参考Genspark AI PPT的设计理念，具备逻辑理解和可视化转换能力。

## 核心能力：逻辑理解 → 可视化转换

### 第一步：分析内容逻辑类型
在生成每页内容前，先识别内容的内在逻辑：

**静态结构（组成关系）：**
- 组成要素 → 使用组织结构图/树状图布局
- 矩阵关系 → 使用2x2矩阵/四象限布局
- 层级结构 → 使用金字塔/层级图布局
- 分类对比 → 使用对比表格/左右对比布局

**动态结构（流程关系）：**
- 时间演进 → 使用时间轴/里程碑布局
- 流程步骤 → 使用流程图/步骤图布局（标注 FLOW）
- 因果关系 → 使用逻辑链/路径图布局
- 循环过程 → 使用循环图布局

**数据展示：**
- 趋势变化 → 标注 CHART:line（折线图数据）
- 占比分布 → 标注 CHART:pie（饼图数据）
- 数量对比 → 标注 CHART:bar（柱状图数据）
- 多维对比 → 标注 CHART:radar（雷达图数据）

### 第二步：应用可视化标记

**流程图标记（用于表示流程/步骤）：**
\`\`\`markdown
## 第X页：产品开发流程
<!-- FLOW -->
1. 需求分析 → 确定用户痛点
2. 原型设计 → 快速验证方案
3. 开发测试 → 迭代优化产品
4. 上线运营 → 数据驱动改进
\`\`\`

**图表数据标记（用于数据可视化）：**
\`\`\`markdown
## 第X页：市场份额分布
<!-- CHART:pie -->
- 产品A: 35%
- 产品B: 28%
- 产品C: 22%
- 其他: 15%
\`\`\`

**矩阵布局标记（用于2x2对比）：**
\`\`\`markdown
## 第X页：战略矩阵
<!-- MATRIX -->
**高价值 + 高难度：** 长期投资项目
**高价值 + 低难度：** 优先执行项目
**低价值 + 高难度：** 暂缓考虑
**低价值 + 低难度：** 快速实施
\`\`\`

## PPT设计黄金法则
1. **简洁至上**：每页3-5个要点，每个要点1行文字（最多15字）
2. **视觉层次**：主标题 > 小标题 > 要点内容
3. **逻辑可视化**：识别内容逻辑，使用合适的可视化方式
4. **专业格式**：使用"## 第X页：标题"标记幻灯片
5. **内容分布**：总页数控制在8-15页
   - 封面(1页) + 目录(1页) + 核心内容(5-10页) + 总结(1页) + 致谢(1页)

## 标准页面结构

### 封面页
\`\`\`
## 第1页：主题标题
- 副标题或核心价值主张
- 演讲者/日期/场合
\`\`\`

### 流程页（带FLOW标记）
\`\`\`
## 第X页：实施路径
<!-- FLOW -->
1. **启动阶段** → 组建团队、明确目标
2. **执行阶段** → 按计划推进、监控进度
3. **验收阶段** → 质量检验、总结经验
\`\`\`

### 数据页（带CHART标记）
\`\`\`
## 第X页：业绩增长趋势
<!-- CHART:line -->
- Q1: 100万
- Q2: 150万
- Q3: 220万
- Q4: 280万
\`\`\`

### 对比页（2列布局）
\`\`\`
## 第X页：方案对比
**方案A优势：**
- 成本低
- 实施快

**方案B优势：**
- 效果好
- 可扩展
\`\`\`

### 标准内容页
\`\`\`
## 第X页：核心观点
- 要点1：简洁表述（10-15字）
- 要点2：数据支撑（用**粗体**突出数字）
- 要点3：行动建议
\`\`\`

## 内容创作要求
- ✅ 分析内容逻辑类型（流程/数据/对比/组成等）
- ✅ 使用可视化标记（<!-- FLOW -->、<!-- CHART:type -->等）
- ✅ 专注于内容质量，使用智能可视化而非依赖图片
- ✅ 数据用**加粗**，百分比/数字清晰呈现
- ✅ 流程用数字序号和箭头（→）连接
- ✅ 对比用左右分栏或表格形式
- ❌ 不要添加图片链接（系统将根据主题智能生成配图）
- ❌ 不要长段落（超过2行）
- ❌ 不要复杂嵌套列表
- ❌ 不要说"我建议"、"你可以"等指导性语言

## 模板风格（当前可用）
- corporate（企业商务）：深色专业，适合财报/汇报
- minimal（简约现代）：黑白极简，适合产品发布
- modern（现代渐变）：时尚活力，适合科技/创业
- creative（创意活泼）：多彩个性，适合营销/品牌
- academic（学术专业）：严谨清晰，适合研究/教学

请基于用户资源和要求，深度理解内容的内在逻辑，生成具备咨询公司级别专业水准的PPT内容。`;
    }

    // ============ 原有逻辑：转发到AI服务 ============
    // Forward request to AI service (using reports/chat endpoint)
    const response = await fetch(`${AI_SERVICE_URL}/api/v1/reports/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        context: systemPrompt
          ? `${systemPrompt}\n\n${finalContext}`
          : finalContext,
        model: agentPlan?.model || model || (await getDefaultModel()), // 从配置获取默认模型
        stream,
        resources, // Pass resources array to backend
        conversationHistory, // Pass conversation history for context
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service responded with status: ${response.status}`);
    }

    // ============ 原有逻辑：流式响应 ============
    // If streaming, pass through the stream
    if (stream && response.body) {
      // 🆕 TODO: 后续可以添加VerificationAgent post-processing
      // 对于流式响应，验证可以在流结束后异步处理
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Otherwise return JSON
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('AI Office chat error:', error);
    return NextResponse.json(
      { error: 'Failed to communicate with AI service' },
      { status: 500 }
    );
  }
}

/**
 * Build context string from resources
 * Optimized to prevent context window bloat
 */
function buildResourceContext(resources: AIOfficeResource[]): string {
  if (!resources || resources.length === 0) {
    return '';
  }

  // Limit number of resources to prevent massive context
  // Prioritize first 5 resources (user selection order matters)
  const MAX_RESOURCES = 5;
  const processResources = resources.slice(0, MAX_RESOURCES);

  const contextParts = [
    `以下是用户选择的资源信息（共${resources.length}个，显示前${processResources.length}个）：\n`,
  ];

  processResources.forEach((resource, index) => {
    contextParts.push(`\n资源 ${index + 1}: ${resource.resourceType}`);

    if (resource.metadata) {
      contextParts.push(`标题: ${resource.metadata.title || '无标题'}`);

      if (resource.metadata.description) {
        // Truncate description
        const desc = resource.metadata.description;
        const truncatedDesc =
          desc.length > 200 ? desc.substring(0, 200) + '...' : desc;
        contextParts.push(`描述: ${truncatedDesc}`);
      }

      if (resource.metadata.authors) {
        contextParts.push(`作者: ${resource.metadata.authors}`);
      }
    }

    if (resource.aiAnalysis) {
      if (resource.aiAnalysis.summary) {
        // Truncate summary
        const summary = resource.aiAnalysis.summary;
        const truncatedSummary =
          summary.length > 500 ? summary.substring(0, 500) + '...' : summary;
        contextParts.push(`AI摘要: ${truncatedSummary}`);
      }

      if (
        resource.aiAnalysis.keyPoints &&
        resource.aiAnalysis.keyPoints.length > 0
      ) {
        contextParts.push('关键点:');
        // Limit to top 3 key points
        resource.aiAnalysis.keyPoints.slice(0, 3).forEach((point: string) => {
          // Truncate key point
          const truncatedPoint =
            point.length > 100 ? point.substring(0, 100) + '...' : point;
          contextParts.push(`  - ${truncatedPoint}`);
        });
      }
    }

    contextParts.push('---');
  });

  return contextParts.join('\n');
}
