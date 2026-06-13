# AI Office 2.0 产品需求文档 (PRD)

**文档版本**: 2.0
**创建日期**: 2025-11-17
**产品负责人**: Genesis Team
**目标发布**: Q1 2026

---

## 目录

1. [产品概述](#1-产品概述)
2. [产品定位与价值主张](#2-产品定位与价值主张)
3. [核心功能规格](#3-核心功能规格)
4. [技术架构设计](#4-技术架构设计)
5. [用户体验流程](#5-用户体验流程)
6. [数据模型设计](#6-数据模型设计)
7. [UI/UX设计规范](#7-uiux设计规范)
8. [实施路线图](#8-实施路线图)
9. [成功指标](#9-成功指标)

---

## 1. 产品概述

### 1.1 产品定义

**AI Office** 是一个专为科研人员和技术专家设计的智能研究助手平台，通过 Multi-Agent AI 系统支持基于深度资源的**持续迭代式报告生成**，提供完整的版本管理、模板系统和多格式导出能力。

### 1.2 核心问题

科研和技术人员在撰写论文、技术报告、演讲PPT时面临的痛点：

1. **信息过载**：需要阅读大量论文、项目文档，难以快速提炼核心观点
2. **撰写耗时**：从文献综述到最终报告，需要数天甚至数周
3. **迭代困难**：报告需要多次修改，版本管理混乱
4. **格式转换麻烦**：需要在PPT、Word、PDF之间频繁转换
5. **缺少专业模板**：学术/技术报告需要特定格式和风格

### 1.3 解决方案

AI Office 通过以下方式解决上述问题：

```
资源采集（Explore页面） → 添加到AI Office
    ↓
资源选择（ResourceList）
    ↓
AI交互（ChatPanel + Multi-Agent: Grok/ChatGPT）
    ↓
文档生成（PPT/Doc，支持智能可视化）
    ↓
持续迭代编辑（版本管理 + 局部更新 + 选中编辑）
    ↓
多格式导出（PPTX, DOCX, PDF, Markdown）
```

**基于现有实现：**

- ✅ 已有完整的三栏布局（左侧菜单 + 中间交互 + 右侧文档）
- ✅ 已有资源管理系统（ResourceList + aiOfficeStore）
- ✅ 已有AI交互系统（ChatPanel + 流式处理）
- ✅ 已有文档编辑器（DocumentEditor + 5种PPT模板）
- ✅ 已有版本管理（自动快照 + 手动保存 + 版本恢复）
- ✅ 已有任务系统（完整上下文保存与恢复）

---

## 2. 产品定位与价值主张

### 2.1 目标用户

**主要用户群体（科研/技术领域）：**

1. **研究生/博士生**
   - 需求：文献综述、学术演讲、论文撰写
   - 痛点：阅读量大、写作时间紧、格式要求严
   - 价值：快速生成文献综述，自动引用管理

2. **技术Leader/架构师**
   - 需求：技术分享、架构设计文档、技术评审PPT
   - 痛点：需要分析多个开源项目、整理技术方案
   - 价值：快速分析GitHub项目，生成技术对比报告

3. **科研人员**
   - 需求：研究报告、学术会议演讲、基金申请
   - 痛点：需要跟踪最新研究、整理实验数据
   - 价值：自动追踪arXiv论文，生成研究进展报告

### 2.2 差异化定位

| 维度         | Notion AI    | Gamma.app | Perplexity | **AI Office 2.0**               |
| ------------ | ------------ | --------- | ---------- | ------------------------------- |
| **目标用户** | 泛知识工作者 | 商务/营销 | 泛搜索用户 | **科研/技术专家**               |
| **资源集成** | Web Clipper  | 无        | Web搜索    | **arXiv/GitHub深度集成**        |
| **AI能力**   | 单模型       | 单模型    | 单模型     | **Multi-Agent（Grok+ChatGPT）** |
| **持续迭代** | 基础编辑     | 有限      | 无         | **✅ 版本管理+选中编辑**        |
| **文档类型** | Notion Page  | PPT       | 文本       | **✅ PPT+Doc+多格式导出**       |
| **模板系统** | 无           | 内置模板  | 无         | **✅ 科研/技术专业模板**        |
| **验证机制** | 无           | 无        | 基础       | **✅ Multi-Agent交叉验证**      |

### 2.3 核心价值主张

> **"从文献到演讲，一站式完成 - 让科研和技术报告的创作效率提升10倍"**

**三大核心价值：**

1. **智能理解**：Multi-Agent深度分析学术论文和技术项目，提取核心观点
2. **持续迭代**：版本管理+选中编辑，支持报告的长期演化
3. **专业输出**：科研/技术模板，符合学术和工程规范的文档

---

## 3. 核心功能规格

### 3.1 功能模块概览

```
AI Office 2.0（基于现有实现增强）
├── 资源管理模块 ✅ 已实现
│   ├── 资源添加（从Explore页面）
│   ├── 资源列表（ResourceList组件）
│   ├── 资源选择/全选/批量删除
│   ├── 资源去重（基于_id）
│   ├── 🆕 相关资源推荐（基于AI分析）
│   └── 🆕 资源分类与标签
│
├── AI交互模块 ✅ 已实现 + 增强
│   ├── ChatPanel（1615行核心逻辑）
│   ├── @资源引用系统
│   ├── 意图识别（PPT/Word/更新）
│   ├── 流式处理（SSE）
│   ├── 🆕 Multi-Agent编排
│   │   ├── CoordinatorAgent（Grok）- 任务规划
│   │   ├── ResourceAnalysisAgent（Grok）- 深度分析
│   │   ├── ContentWritingAgent（ChatGPT）- 内容生成
│   │   ├── VisualizationAgent（ChatGPT）- 图表设计
│   │   └── VerificationAgent（Grok）- 事实验证
│   └── 🆕 AI过程透明化（显示Agent工作状态）
│
├── 文档编辑模块 ✅ 已实现 + 增强
│   ├── DocumentEditor（自动保存、实时预览）
│   ├── PPT功能
│   │   ├── 5种模板（Corporate/Minimal/Modern/Creative/Academic）
│   │   ├── 6种智能可视化（FLOW/CHART/MATRIX）
│   │   ├── 幻灯片导航与缩略图
│   │   ├── 局部更新（指定页面）
│   │   └── 🆕 Slide级别选中编辑
│   ├── Doc功能
│   │   ├── Markdown编辑
│   │   └── 🆕 章节管理（目录/折叠）
│   └── 🆕 Research Page格式（结构化知识页面）
│
├── 版本管理模块 ✅ 已实现 + 增强
│   ├── 自动版本快照（ai_generation/user_edit）
│   ├── 版本历史查看
│   ├── 版本恢复
│   ├── 🆕 版本对比（Diff）
│   └── 🆕 版本分支/标签
│
├── 任务管理模块 ✅ 已实现
│   ├── 任务自动创建
│   ├── 完整上下文保存（资源+文档+对话）
│   ├── 任务恢复（完整状态恢复）
│   └── 任务列表侧边栏
│
├── 模板系统 ✅ 部分实现 + 扩展
│   ├── 已有：5种PPT模板
│   ├── 🆕 科研模板库（学术会议/论文/文献综述）
│   ├── 🆕 技术模板库（设计文档/技术分享/代码审查）
│   ├── 🆕 自定义模板编辑器
│   └── 🆕 模板市场（分享/下载）
│
└── 导出模块 ✅ 已实现
    ├── PPTX导出
    ├── DOCX导出
    ├── PDF导出
    ├── Markdown导出
    └── 🆕 HTML导出（响应式）
    └── 🆕 LaTeX导出（学术期刊）
```

**图例：**

- ✅ 已实现 - 当前系统已有完整实现
- 🆕 增强 - 基于现有实现的增强功能

---

### 3.2 功能详细规格

#### 3.2.1 资源管理系统（基于现有实现）

**现有实现概述：**

当前AI Office已有完整的资源管理系统，位于：

- 状态管理：`frontend/stores/aiOfficeStore.ts` → `useResourceStore`
- UI组件：`frontend/components/ai-office/resources/ResourceList.tsx`
- 类型定义：`frontend/types/ai-office.ts`

**核心流程：**

```
1. 用户在Explore页面浏览资源
   ↓
2. 点击资源卡片上的"AI Office"按钮
   ↓
3. 调用 useResourceStore.addResource(resource)
   ↓
4. 去重检查（基于_id）
   - 如果已存在：console.warn，不添加
   - 如果不存在：添加到resources数组
   ↓
5. 资源出现在AI Office的ResourceList中
   ↓
6. 用户可以：
   - 选择/取消选择资源（selectResource/deselectResource）
   - 全选/取消全选（toggleSelectAll）
   - 批量删除选中资源（deleteSelectedResources）
   - 单个删除资源（removeResource）
```

**现有数据模型：**

```typescript
// frontend/types/ai-office.ts
export type ResourceType =
  | "youtube_video"
  | "academic_paper"
  | "web_page"
  | "database"
  | "file";

export type ResourceStatus = "pending" | "collecting" | "collected" | "failed";

export interface Resource {
  _id: string;
  userId: string;
  resourceId: string;
  resourceType: ResourceType;
  status: ResourceStatus;

  metadata: {
    title: string;
    description?: string;
    authors?: Array<{ name: string; affiliation?: string }>;
    channel?: string; // YouTube频道
    url?: string;
    publishedAt?: string;
    duration?: number; // 视频时长
  };

  content?: {
    transcript?: string; // YouTube字幕
    summary?: string;
    fullText?: string;
  };

  aiAnalysis?: {
    summary: string;
    keyPoints: string[];
    tags?: string[];
    sentiment?: string;
  };

  collectedAt: Date;
  updatedAt: Date;
}
```

**现有Store实现：**

```typescript
// frontend/stores/aiOfficeStore.ts
interface ResourceState {
  resources: Resource[];
  selectedResourceIds: string[];
  isLoading: boolean;
  error: string | null;

  // 核心Actions
  addResource: (resource: Resource) => void;
  removeResource: (id: string) => void;
  updateResource: (id: string, updates: Partial<Resource>) => void;

  // 选择管理
  selectResource: (id: string) => void;
  deselectResource: (id: string) => void;
  clearSelection: () => void;

  // 批量操作
  deleteSelectedResources: () => void;

  // 状态重置
  resetResources: () => void;
}

// 持久化配置
persist: {
  name: 'ai-office-resource-storage',
  partialize: (state) => ({
    resources: state.resources,
    selectedResourceIds: state.selectedResourceIds,
  }),
}
```

**🆕 2.0增强功能：**

1. **相关资源推荐（新增）**

   ```typescript
   interface ResourceRecommendation {
     resourceId: string;
     relevanceScore: number; // 0-1
     reason: string; // AI生成的推荐理由
     basedOn: "content-similarity" | "user-history" | "ai-analysis";
   }

   // 在ChatPanel中集成
   useEffect(() => {
     if (currentDocument && currentDocument.content) {
       // AI分析文档内容，推荐相关资源
       const recommendations = await recommendRelatedResources({
         documentContent: currentDocument.content.markdown,
         existingResources: resources,
       });

       setRecommendations(recommendations);
     }
   }, [currentDocument]);
   ```

2. **资源分类与标签（新增）**

   ```typescript
   interface Resource {
     // 扩展现有Resource
     categories?: string[]; // ['机器学习', '自然语言处理']
     userTags?: string[]; // 用户手动添加的标签
     autoTags?: string[]; // AI自动生成的标签
   }

   // ResourceList增强：标签过滤
   const filteredResources = resources.filter(
     (r) =>
       selectedCategories.length === 0 ||
       r.categories?.some((c) => selectedCategories.includes(c)),
   );
   ```

**现有UI组件：**

```typescript
// frontend/components/ai-office/resources/ResourceList.tsx (197行)

<div className="resource-list">
  {/* 工具栏 */}
  <div className="toolbar">
    <Checkbox checked={allSelected} onChange={toggleSelectAll}>
      全选 ({selectedIds.length}/{resources.length})
    </Checkbox>
    <Button onClick={deleteSelected} disabled={selectedIds.length === 0}>
      删除选中
    </Button>
  </div>

  {/* 资源卡片列表 */}
  {resources.map(resource => (
    <ResourceCard key={resource._id}>
      <Checkbox
        checked={selectedIds.includes(resource._id)}
        onChange={() => toggleSelect(resource._id)}
      />

      <Icon type={resource.resourceType} />

      <div className="content">
        <h3>{resource.metadata.title}</h3>
        {resource.metadata.authors && (
          <Authors>{resource.metadata.authors.map(a => a.name).join(', ')}</Authors>
        )}
        <StatusBadge status={resource.status} />
      </div>

      <Button onClick={() => removeResource(resource._id)}>
        移除
      </Button>
    </ResourceCard>
  ))}
</div>
```

**保留现有实现的原因：**

1. ✅ 已有完整的资源添加流程（从Explore页面）
2. ✅ 已有健全的去重机制（基于\_id）
3. ✅ 已有完善的选择管理（单选/全选/批量删除）
4. ✅ 已有持久化存储（LocalStorage）
5. ✅ UI组件已经过优化，用户体验良好

**2.0增强策略：**

- 在现有基础上添加AI推荐功能（不破坏现有流程）
- 增加资源分类/标签系统（扩展现有数据模型）
- 优化ResourceList UI（支持过滤和搜索）
  interface ResourceRecommendation {
  id: string;
  type: 'arxiv' | 'github' | 'youtube' | 'doi' | 'web';
  url: string;

  metadata: {
  title: string;
  authors?: string[];
  publishedAt?: Date;
  abstract?: string;
  thumbnail?: string;
  };

  recommendation: {
  score: number; // 0-1相关度分数
  reason: string; // 推荐理由
  basedOn: 'url-detection' | 'content-similarity' | 'user-history';
  };

  status: 'pending' | 'accepted' | 'rejected';

  createdAt: Date;
  }

````

---

#### 3.2.2 Multi-Agent AI系统（基于现有ChatPanel增强）

**现有实现基础：**

当前AI Office已有完整的AI交互系统，位于：
- 核心组件：`frontend/components/ai-office/chat/ChatPanel.tsx`（1615行）
- API路由：`frontend/app/api/ai-office/chat/route.ts`
- 当前模型：默认使用'grok'，支持配置切换

**现有ChatPanel核心功能：**

1. ✅ **意图识别系统**（行74-193）
   ```typescript
   // 已实现的意图识别
   - 文档生成请求检测（PPT/Word/报告）
   - 更新/修改请求检测
   - 局部更新页面检测（"更新第1-3页"）
   - 新文档创建判断
````

2. ✅ **@资源引用系统**（行74-164）

   ```typescript
   // 已实现的资源引用
   - @all - 引用所有资源
   - @资源标题 - 引用特定资源
   - 自动覆盖选中资源逻辑
   ```

3. ✅ **流式处理**（行706-897）

   ```typescript
   // 已实现的SSE流式生成
   -实时接收AI输出 - 实时更新消息和文档 - 停止生成按钮;
   ```

4. ✅ **局部更新**（行898-939）
   ```typescript
   // 已实现的PPT页面级更新
   - 支持"更新第1页"、"更新第1-3页"
   - 仅替换指定页面，保持其他页面不变
   - 支持中文/阿拉伯数字页码
   ```

**🆕 2.0 Multi-Agent增强方案：**

基于现有ChatPanel，增加Multi-Agent编排层：

**Agent配置（在现有基础上扩展）：**

| Agent                     | 模型    | 职责                  | 集成方式           |
| ------------------------- | ------- | --------------------- | ------------------ |
| **CoordinatorAgent**      | Grok    | 任务规划、Agent编排   | 扩展现有意图识别   |
| **ResourceAnalysisAgent** | Grok    | 深度分析学术/技术资源 | 新增预处理步骤     |
| **ContentWritingAgent**   | ChatGPT | 撰写流畅的内容        | 使用现有流式生成   |
| **VisualizationAgent**    | ChatGPT | 设计图表和可视化      | 增强现有可视化标记 |
| **VerificationAgent**     | Grok    | 事实验证、交叉检查    | 新增后处理步骤     |

**增强后的工作流程（在现有ChatPanel基础上）：**

```typescript
// ============ 现有流程（保留） ============
// ChatPanel.tsx handleSend() - 1615行核心逻辑

// 1. 用户输入（现有）
User: "帮我生成一个关于磷酸化网络的学术演讲PPT"
   ↓
// 2. 意图识别（现有，行74-193）
const isPPTRequest = /ppt|powerpoint|演示文稿/i.test(userInput); // ✅
const isDocumentGenerationRequest = hasDocumentType && hasActionVerb; // ✅
   ↓
// 3. @资源解析（现有，行74-164）
const mentionedResourceIds = parseMentions(userInput); // ✅
const resourceIdsToUse = mentionedResourceIds.length > 0
  ? mentionedResourceIds
  : selectedResourceIds; // ✅

// ============ 2.0 Multi-Agent增强 ============

// 4. 🆕 CoordinatorAgent预处理
const agentPlan = await coordinatorAgent.plan({
  objective: isPPTRequest ? '生成学术演讲PPT' : '生成文档',
  resources: selectedResources,
  userIntent: userInput,
  existingDocument: currentDocument,
});
// 返回：{ needsResourceAnalysis: true, needsVisualization: true, ... }

// 5. 🆕 Phase 1: ResourceAnalysisAgent（如果需要）
if (agentPlan.needsResourceAnalysis) {
  const analysis = await resourceAnalysisAgent.analyze({
    resources: selectedResources,
    focus: agentPlan.focus,
  });
  // 返回：{ keyInsights, coreFindings, visualOpportunities }

  // 将分析结果注入Prompt
  enhancedPrompt += `\n\n【AI资源分析结果】\n${JSON.stringify(analysis)}`;
}

// 6. 现有流式生成（保留，使用增强后的Prompt）
const response = await fetch('/api/ai-office/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: enhancedPrompt, // ✅ 使用增强后的Prompt
    resources: selectedResources, // ✅
    documentId: targetDocumentId, // ✅
    stream: true, // ✅
    agentPlan, // 🆕 传递Agent规划
  }),
});

// 7. 流式接收（现有，行744-897）
const reader = response.body?.getReader();
let aiContent = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  aiContent += parseChunk(chunk);

  // ✅ 实时更新UI（现有）
  updateMessage(aiMessageId, { content: aiContent });
  updateDocument(targetDocumentId, {
    content: { markdown: aiContent }
  });
}

// 8. 🆕 Phase 3: VerificationAgent后处理
if (agentPlan.needsVerification) {
  const verified = await verificationAgent.verify({
    content: aiContent,
    sources: selectedResources,
  });

  // 在文档中添加验证标记
  const enhancedContent = addVerificationBadges(aiContent, verified);
  updateDocument(targetDocumentId, {
    content: { markdown: enhancedContent },
    metadata: { verificationResult: verified },
  });
}

// 9. 版本保存（现有，行908-939）
saveVersion(
  targetDocumentId,
  'auto',
  'ai_generation',
  `Multi-Agent生成：${currentDocument.title}`
); // ✅
```

**关键改进点：**

1. ✅ **保留现有流程** - ChatPanel的核心逻辑不变
2. 🆕 **增加预处理** - CoordinatorAgent规划 + ResourceAnalysisAgent分析
3. 🆕 **增强Prompt** - 将Agent分析结果注入Prompt
4. ✅ **保留流式生成** - 使用现有的SSE机制
5. 🆕 **增加后处理** - VerificationAgent验证 + 添加置信度标记

**扩展能力保留：**

```typescript
// backend/src/modules/ai/agents/agent-config.ts
export const AGENT_CONFIG = {
  models: {
    primary: {
      coordinator: "grok", // 主协调器
      reasoning: "grok", // 深度推理
      creative: "chatgpt", // 创意内容
      visual: "chatgpt", // 可视化
    },
    // 保留扩展接口
    extensions: {
      claude: { enabled: false, apiKey: "" },
      gemini: { enabled: false, apiKey: "" },
      custom: { enabled: false, endpoint: "" },
    },
  },

  // Agent注册表（支持动态添加）
  agents: [
    { name: "coordinator", model: "grok", enabled: true },
    { name: "resource-analysis", model: "grok", enabled: true },
    { name: "content-writing", model: "chatgpt", enabled: true },
    { name: "visualization", model: "chatgpt", enabled: true },
    { name: "verification", model: "grok", enabled: true },
    // 用户可以通过配置添加新Agent
  ],
};
```

---

#### 3.2.3 Research Page - 结构化知识页面

**产品理念：** 受Genspark Sparkpage启发，但更聚焦科研/技术领域

**页面结构：**

```
┌─────────────────────────────────────────────────────┐
│ Research Page: 磷酸化网络的多稳态特性                │
│ 📚 3 resources · 🤖 5 agents · ⏱️ 12 min read       │
└─────────────────────────────────────────────────────┘

┌─ 📋 Executive Summary ────────────────────────────┐
│ 磷酸化网络在细胞信号传导中展现出多稳态特性，这种  │
│ 特性使得生物系统能够实现开关式的决策...          │
│                                                    │
│ Generated by: Grok · Confidence: 92%              │
└────────────────────────────────────────────────────┘

┌─ 💡 Key Findings ─────────────────────────────────┐
│ Finding 1: 磷酸化级联反应展现双稳态              │
│ ✅ Verified by 2 agents · 95% confidence          │
│ 📄 Source: Smith et al. 2023, arXiv:2301.12345   │
│ 💬 Evidence: "实验数据显示在特定参数范围内..."   │
│                                                    │
│ Finding 2: 生物开关的分子基础                     │
│ ✅ Verified by 2 agents · 90% confidence          │
│ 📄 Source: Jones et al. 2022                      │
│                                                    │
│ Finding 3: 理论模型的预测能力                     │
│ ⚠️ Partially verified · 70% confidence            │
│ 🔍 Needs more evidence                            │
└────────────────────────────────────────────────────┘

┌─ 📊 Visual Insights ──────────────────────────────┐
│ [流程图] 磷酸化级联反应路径                       │
│ [柱状图] 不同条件下的稳态分布                     │
│ [分子图] 关键蛋白结构                             │
│ Generated by: ChatGPT                             │
└────────────────────────────────────────────────────┘

┌─ 🔬 Technical Deep Dive ──────────────────────────┐
│ [Tabs]                                            │
│ │ Methodology │ Results │ Code Examples │         │
│                                                    │
│ [Methodology Tab内容]                             │
│ 实验采用双杂交技术验证蛋白相互作用...             │
└────────────────────────────────────────────────────┘

┌─ 🎯 Actionable Insights ──────────────────────────┐
│ ✓ Recommendations:                                │
│   • 在类似系统中应用多稳态理论                    │
│   • 进一步验证边界条件                            │
│                                                    │
│ → Next Steps:                                     │
│   1. 设计新实验验证理论预测                       │
│   2. 扩展模型到其他信号通路                       │
│                                                    │
│ ? Open Questions:                                 │
│   • 多稳态在体内是否普遍存在？                    │
│   • 如何定量测量稳态转换？                        │
└────────────────────────────────────────────────────┘

┌─ Actions ─────────────────────────────────────────┐
│ [📊 生成PPT] [📄 生成Doc] [🔗 分享] [⬇️ 导出]    │
└────────────────────────────────────────────────────┘
```

**数据模型：**

```typescript
interface ResearchPage {
  id: string;
  title: string;
  query: string;

  sections: {
    summary: {
      content: string;
      generatedBy: "grok" | "chatgpt";
      confidence: number;
    };

    keyFindings: Array<{
      claim: string;
      verified: boolean;
      confidence: number;
      verifiedBy: Array<{
        agent: string;
        result: "verified" | "partial" | "rejected";
      }>;
      evidence: Array<{
        text: string;
        source: Resource;
      }>;
      contradictions?: Array<{
        text: string;
        source: Resource;
      }>;
    }>;

    visualInsights: {
      charts: ChartData[];
      diagrams: DiagramData[];
      generatedBy: string;
    };

    deepDive: {
      methodology?: string;
      results?: string;
      codeExamples?: CodeBlock[];
    };

    actionableInsights: {
      recommendations: string[];
      nextSteps: string[];
      openQuestions: string[];
    };
  };

  metadata: {
    resourcesAnalyzed: number;
    agentsInvolved: string[];
    generatedAt: Date;
    estimatedReadTime: number;
  };
}
```

**一键转换功能：**

```typescript
// 从Research Page一键生成PPT
ResearchPage → [应用模板] → PPT Document

// 或生成Doc
ResearchPage → [应用模板] → Doc Document
```

---

#### 3.2.4 持续迭代编辑系统（基于现有实现增强）

**现有实现基础：**

当前AI Office已有完整的版本管理和文档编辑系统：

- 版本管理组件：`frontend/components/ai-office/document/VersionHistory.tsx`
- 文档编辑器：`frontend/components/ai-office/document/DocumentEditor.tsx`
- 状态管理：`frontend/stores/aiOfficeStore.ts` → `useDocumentStore`

**现有版本管理功能：**

1. ✅ **自动版本快照**（已实现）

   ```typescript
   // useDocumentStore.saveVersion()
   interface DocumentVersion {
     id: string;
     timestamp: Date;
     type: "auto" | "manual";
     trigger: "ai_generation" | "user_edit" | "manual_save";
     content: any; // 完整内容快照
     metadata: {
       title: string;
       wordCount?: number;
       slideCount?: number;
       description?: string;
     };
     aiModel?: string;
   }
   ```

2. ✅ **版本操作**（已实现）
   - `saveVersion()` - 保存版本
   - `getVersions()` - 获取版本列表
   - `restoreVersion()` - 恢复版本（完全替换当前内容）
   - `deleteVersion()` - 删除版本

3. ✅ **自动触发机制**（已实现）
   - AI生成完成 → 自动保存（trigger='ai_generation'）
   - 用户手动保存 → 手动保存（trigger='manual_save'）
   - 用户编辑 → 可选自动保存（trigger='user_edit'）

**现有文档编辑功能：**

1. ✅ **自动保存**（已实现，DocumentEditor组件）

   ```typescript
   // 防抖1000ms自动保存
   useEffect(() => {
     const timer = setTimeout(() => {
       updateDocument(currentDocumentId, {
         title: title,
         content: { markdown: content },
         metadata: { wordCount: content.length },
       });
     }, 1000);
   }, [content, title]);
   ```

2. ✅ **PPT Slide编辑**（已实现）
   - 幻灯片导航（prev/next）
   - 幻灯片缩略图
   - 局部更新（指定页面）
   - 5种主题模板

3. ✅ **任务上下文保存**（已实现）
   - 完整资源列表快照
   - 完整文档内容快照
   - 完整对话历史快照
   - 完整版本历史快照

**🆕 2.0增强功能：**

##### A. 版本对比（Diff）功能

```typescript
// 新增：版本对比功能
interface VersionComparison {
  oldVersion: DocumentVersion;
  newVersion: DocumentVersion;

  changes: Array<{
    type: 'added' | 'modified' | 'deleted';
    section: string;  // slide ID or chapter ID
    oldContent?: string;
    newContent?: string;
    diff?: DiffResult;
  }>;

  stats: {
    added: number;
    modified: number;
    deleted: number;
  };
}

// 实现
function compareVersions(v1: DocumentVersion, v2: DocumentVersion): VersionComparison {
  // 使用diff算法比较内容
  // 返回详细的变更列表
}
    diff?: any;          // 详细的diff
  };

  author: 'user' | 'ai';
  message: string;        // 版本提交信息
  createdAt: Date;

  // 版本关系
  parentVersion?: string;
  branches?: string[];    // 支持分支（高级功能）
}
```

**版本管理UI：**

```
┌─ 版本历史 ─────────────────────────────────────┐
│                                                 │
│ ● v2.1 (当前)                   2025-11-17     │
│ │ 更新第3-5页的可视化                          │
│ │ By: AI (ChatGPT)                             │
│ │ [查看详情] [恢复到此版本]                    │
│ │                                               │
│ ● v2.0                          2025-11-16     │
│ │ 添加了Technical Deep Dive部分                │
│ │ By: User                                     │
│ │                                               │
│ ● v1.5                          2025-11-15     │
│ │ 修复了引用格式                               │
│ │ By: User                                     │
│ │                                               │
│ ● v1.0 (初始版本)              2025-11-14     │
│   首次生成                                      │
│   By: AI (Multi-Agent)                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

##### B. 缩略图预览

**PPT缩略图：**

```
┌─ 幻灯片缩略图 ─────────────────────────────────┐
│                                                 │
│ [Slide 1]  [Slide 2]  [Slide 3]  [Slide 4]    │
│ ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐       │
│ │Title │  │Intro │  │Flow  │  │Data  │       │
│ │Page  │  │      │  │Chart │  │Chart │       │
│ └──────┘  └──────┘  └──────┘  └──────┘       │
│   v2.1      v2.0      v2.1      v1.5          │ ← 版本标记
│                                                 │
│ [Slide 5]  [Slide 6]  [+ 新增]                │
│ ┌──────┐  ┌──────┐                            │
│ │Deep  │  │Action│                            │
│ │Dive  │  │Items │                            │
│ └──────┘  └──────┘                            │
│   v2.1      v1.0                               │
│                                                 │
└─────────────────────────────────────────────────┘

点击任一缩略图 → 跳转到该slide
右键菜单：
  - 编辑此slide
  - 删除此slide  - 插入新slide
  - 查看版本历史
  - 恢复旧版本
```

**Doc章节缩略图：**

```
┌─ 章节缩略图 ─────────────────────────────────┐
│                                               │
│ 📄 1. Introduction (v2.0)                    │
│    150 words · Last edited 2 days ago        │
│    [编辑] [查看版本]                          │
│                                               │
│ 📄 2. Background (v1.5)                      │
│    300 words · Last edited 5 days ago        │
│    [编辑] [查看版本]                          │
│                                               │
│ 📊 3. Visual Analysis (v2.1) ⭐ New!         │
│    2 charts · Last edited today              │
│    [编辑] [查看版本]                          │
│                                               │
│ 📄 4. Methodology (v1.0)                     │
│    450 words · Last edited 10 days ago       │
│    [编辑] [查看版本]                          │
│                                               │
│ [+ 添加新章节]                                │
│                                               │
└───────────────────────────────────────────────┘
```

##### C. 选中编辑（Granular Editing）

**PPT选中编辑：**

```
用户：选中Slide 3
    ↓
显示编辑面板：
┌─────────────────────────────────────────────┐
│ 编辑 Slide 3: 流程图                        │
│                                             │
│ [预览窗口]                                  │
│ ┌─────────────────────┐                    │
│ │ 磷酸化级联反应      │                    │
│ │ [流程图显示]        │                    │
│ └─────────────────────┘                    │
│                                             │
│ 编辑选项：                                  │
│ ○ 重新生成此slide（AI）                    │
│   提示词：_____________________________    │
│   [生成] [取消]                            │
│                                             │
│ ○ 手动编辑                                 │
│   标题：磷酸化级联反应                     │
│   内容：[富文本编辑器]                     │
│   可视化：[流程图编辑器]                   │
│   [保存] [取消]                            │
│                                             │
│ ○ 更新数据（保持布局）                     │
│   上传新数据：[选择文件]                   │
│   [更新] [取消]                            │
│                                             │
│ ○ 恢复到旧版本                             │
│   [v2.0] [v1.5] [v1.0]                     │
│                                             │
└─────────────────────────────────────────────┘
```

**Doc选中编辑：**

```
用户：选中Chapter 3 (Visual Analysis)
    ↓
显示编辑面板：
┌─────────────────────────────────────────────┐
│ 编辑 Chapter 3: Visual Analysis             │
│                                             │
│ [Markdown编辑器]                            │
│ ## Visual Analysis                          │
│                                             │
│ 本章分析了实验数据的可视化结果...          │
│                                             │
│ ### 3.1 数据分布                            │
│ [图表: 柱状图]                              │
│                                             │
│ ### 3.2 趋势分析                            │
│ ...                                         │
│                                             │
│ AI辅助选项：                                │
│ • [💡 AI建议] 添加更多可视化                │
│ • [📊 生成图表] 基于新数据                  │
│ • [✍️ 扩展内容] 补充分析细节                │
│ • [🔍 事实检查] 验证数据准确性              │
│                                             │
│ [保存为新版本] [保存草稿] [取消]            │
│                                             │
└─────────────────────────────────────────────┘
```

##### D. 持续丰富（Continuous Enrichment）

**场景：** 用户随着研究进展，不断添加新资源和内容

```typescript
// 持续丰富流程
Document v1.0 (基于3篇论文)
    ↓
用户添加新资源: paper4.pdf
    ↓
AI检测到新资源与Document相关
    ↓
AI提示：
┌─────────────────────────────────────────────┐
│ 💡 检测到新资源可以丰富当前文档            │
│                                             │
│ 新资源: "Advanced Phosphorylation Study"   │
│ 相关度: 93%                                 │
│                                             │
│ 建议更新：                                  │
│ • Chapter 2: 添加最新研究进展               │
│ • Chapter 4: 更新实验方法                   │
│ • 新增 Chapter 6: 未来展望                  │
│                                             │
│ [✓ 自动丰富] [手动选择] [忽略]             │
└─────────────────────────────────────────────┘
    ↓
用户点击"自动丰富"
    ↓
AI (Grok) 分析新资源，提取相关内容
    ↓
AI (ChatGPT) 将新内容整合到现有章节
    ↓
生成 Document v1.1
    ↓
显示Diff对比：
┌─────────────────────────────────────────────┐
│ 版本对比: v1.0 → v1.1                       │
│                                             │
│ Chapter 2: Background                       │
│   + 添加了最新研究进展 (3段)                │
│   ~ 更新了引用列表 (新增5篇)                │
│                                             │
│ Chapter 4: Methodology                      │
│   + 添加了新实验方法 (2段)                  │
│                                             │
│ + Chapter 6: Future Perspectives (新增)    │
│                                             │
│ [✓ 接受更新] [查看详情] [撤销]             │
└─────────────────────────────────────────────┘
```

---

#### 3.2.5 多格式文档支持

**支持的文档类型：**

##### A. PPT文档（PowerPoint）

**特性：**

1. **可编辑Slide**
   - 标题、内容、可视化都可编辑
   - 支持富文本格式
   - 支持图片、图表嵌入

2. **版本化管理**
   - 每次编辑自动创建新版本
   - 版本对比（Slide级别）
   - 一键回滚

3. **实时预览**
   - 编辑时实时看到效果
   - 支持演示模式预览

4. **智能布局**
   - AI自动选择合适的布局
   - 用户可手动调整

**数据模型：**

```typescript
interface PPTDocument extends Document {
  type: "ppt";

  content: {
    slides: Array<{
      id: string;
      order: number;
      layout: "title" | "content" | "two-column" | "visual" | "blank";

      elements: {
        title?: {
          text: string;
          style: TextStyle;
        };

        content?: {
          type: "text" | "bullet-list" | "markdown";
          data: string | string[];
          style: TextStyle;
        };

        visuals?: Array<{
          type: "chart" | "diagram" | "image" | "code";
          data: any;
          position: { x: number; y: number; width: number; height: number };
        }>;

        notes?: string; // 演讲者备注
      };

      // 版本信息
      version: string;
      lastModified: Date;
      modifiedBy: "user" | "ai";
    }>;

    theme: {
      name: string;
      colors: ColorScheme;
      fonts: FontScheme;
      template: "academic" | "tech" | "minimal" | "custom";
    };
  };

  // 缩略图缓存
  thumbnails: Map<string, string>; // slideId -> base64 image
}
```

##### B. Doc文档（Document）

**特性：**

1. **章节管理**
   - 多级标题结构
   - 自动目录生成
   - 章节折叠/展开

2. **持续编辑**
   - Markdown编辑器
   - 富文本预览
   - 实时字数统计

3. **版本化管理**
   - 章节级别版本控制
   - 内容Diff显示
   - 合并冲突处理

4. **学术特性**
   - 引用管理（BibTeX）
   - 脚注支持
   - 公式编辑（LaTeX）

**数据模型：**

```typescript
interface DocDocument extends Document {
  type: "doc";

  content: {
    chapters: Array<{
      id: string;
      order: number;
      level: 1 | 2 | 3 | 4; // h1, h2, h3, h4
      title: string;

      content: {
        markdown: string;
        html?: string; // 渲染缓存
      };

      elements: {
        text: string;
        citations?: Citation[];
        footnotes?: Footnote[];
        equations?: Equation[];
        figures?: Figure[];
        tables?: Table[];
        codeBlocks?: CodeBlock[];
      };

      metadata: {
        wordCount: number;
        readTime: number; // 预估阅读时间（分钟）
      };

      // 版本信息
      version: string;
      lastModified: Date;
      modifiedBy: "user" | "ai";
    }>;

    // 文档级元数据
    frontMatter: {
      title: string;
      authors: string[];
      abstract?: string;
      keywords?: string[];
      date?: Date;
    };

    // 引用列表
    bibliography: Citation[];

    // 样式
    style: {
      template: "ieee" | "acm" | "apa" | "custom";
      fontSize: number;
      lineSpacing: number;
    };
  };
}
```

##### C. 多格式导出

**导出支持：**

| 格式         | 用途           | 特性                                                          |
| ------------ | -------------- | ------------------------------------------------------------- |
| **PPTX**     | PowerPoint演示 | • 原生PPT格式<br>• 保留所有动画<br>• 可在PowerPoint中继续编辑 |
| **DOCX**     | Word文档       | • 原生Word格式<br>• 保留样式和格式<br>• 包含引用和脚注        |
| **PDF**      | 打印/分享      | • 不可编辑<br>• 保留排版<br>• 适合提交和分享                  |
| **Markdown** | 版本控制/协作  | • 纯文本格式<br>• Git友好<br>• 适合协作编辑                   |
| **HTML**     | Web发布        | • 响应式布局<br>• 可在线查看<br>• 支持交互式图表              |
| **LaTeX**    | 学术投稿       | • 高质量排版<br>• 适合学术期刊<br>• 包含BibTeX引用            |

**导出流程：**

```typescript
// 导出API
class DocumentExportService {
  async exportToPPTX(document: PPTDocument): Promise<Buffer> {
    // 使用 pptxgenjs 库
    const pptx = new PptxGenJS();

    for (const slide of document.content.slides) {
      const pptxSlide = pptx.addSlide();

      // 应用模板样式
      this.applyTemplate(pptxSlide, document.content.theme);

      // 添加标题
      if (slide.elements.title) {
        pptxSlide.addText(slide.elements.title.text, {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 1,
          fontSize: 32,
          bold: true,
        });
      }

      // 添加内容
      if (slide.elements.content) {
        this.addContent(pptxSlide, slide.elements.content);
      }

      // 添加可视化
      if (slide.elements.visuals) {
        for (const visual of slide.elements.visuals) {
          await this.addVisual(pptxSlide, visual);
        }
      }
    }

    return await pptx.write();
  }

  async exportToDOCX(document: DocDocument): Promise<Buffer> {
    // 使用 docx 库
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            // 标题页
            new Paragraph({
              text: document.content.frontMatter.title,
              heading: HeadingLevel.TITLE,
            }),

            // 作者
            new Paragraph({
              text: document.content.frontMatter.authors.join(", "),
            }),

            // 目录
            new TableOfContents(),

            // 章节内容
            ...this.renderChapters(document.content.chapters),
          ],
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  async exportToPDF(document: Document): Promise<Buffer> {
    // 先转为HTML，再用puppeteer转PDF
    const html = await this.exportToHTML(document);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
    });

    await browser.close();
    return pdf;
  }

  async exportToMarkdown(document: DocDocument): Promise<string> {
    let markdown = "";

    // Front matter
    markdown += "---\n";
    markdown += `title: ${document.content.frontMatter.title}\n`;
    markdown += `authors: ${document.content.frontMatter.authors.join(", ")}\n`;
    markdown += "---\n\n";

    // 章节
    for (const chapter of document.content.chapters) {
      markdown += "#".repeat(chapter.level) + " " + chapter.title + "\n\n";
      markdown += chapter.content.markdown + "\n\n";
    }

    return markdown;
  }
}
```

---

#### 3.2.6 模板系统

**核心理念：** 专业领域需要专业模板

**模板类型：**

##### A. 科研模板（Academic Templates）

**1. 学术会议演讲模板**

```yaml
name: "Academic Conference Presentation"
category: "academic"
type: "ppt"

slides:
  - layout: "title"
    required: true
    fields:
      - title: "研究标题"
      - subtitle: "会议名称"
      - authors: "作者列表"
      - affiliation: "机构"

  - layout: "outline"
    optional: true
    fields:
      - title: "Outline"
      - bullets: ["Background", "Methods", "Results", "Discussion"]

  - layout: "background"
    required: true
    fields:
      - title: "Background & Motivation"
      - content: "研究背景"
      - visual: "flow-diagram" # 建议可视化类型

  - layout: "methods"
    required: true
    fields:
      - title: "Methodology"
      - content: "研究方法"
      - visual: "flowchart"

  - layout: "results"
    required: true
    fields:
      - title: "Experimental Results"
      - visual: "charts" # 多个图表
      - notes: "关键发现"

  - layout: "discussion"
    required: true
    fields:
      - title: "Discussion"
      - bullets: ["Implications", "Limitations", "Future Work"]

  - layout: "thank-you"
    required: true
    fields:
      - title: "Thank You"
      - contact: "Email & Website"
      - acknowledgments: "致谢"

style:
  colors:
    primary: "#003366" # 深蓝（学术感）
    secondary: "#006699"
    accent: "#FF6B35"
    background: "#FFFFFF"
    text: "#333333"

  fonts:
    heading: "Times New Roman" # 学术期刊常用
    body: "Arial"
    code: "Courier New"

  layout:
    margins: { top: 0.5, bottom: 0.5, left: 0.75, right: 0.75 }
    titleSize: 32
    bodySize: 18
```

**2. 文献综述文档模板**

```yaml
name: "Literature Review"
category: "academic"
type: "doc"

structure:
  - chapter: "Abstract"
    required: true
    wordCount: { min: 150, max: 300 }

  - chapter: "Introduction"
    required: true
    subsections:
      - "Research Question"
      - "Scope and Objectives"
      - "Significance"

  - chapter: "Methodology"
    required: true
    subsections:
      - "Search Strategy"
      - "Inclusion/Exclusion Criteria"
      - "Data Extraction"

  - chapter: "Literature Review"
    required: true
    subsections:
      - "Thematic Analysis"
      - "Comparative Analysis"
      - "Gap Analysis"

  - chapter: "Discussion"
    required: true
    subsections:
      - "Key Findings"
      - "Implications"
      - "Limitations"

  - chapter: "Conclusion"
    required: true

  - chapter: "References"
    required: true
    format: "IEEE" # or APA, ACM, etc.

style:
  citationFormat: "IEEE"
  lineSpacing: 1.5
  fontSize: 12
  font: "Times New Roman"
```

##### B. 技术模板（Tech Templates）

**1. 技术分享模板**

```yaml
name: "Tech Talk"
category: "tech"
type: "ppt"

slides:
  - layout: "title"
    style: "minimal" # 技术风格更简约

  - layout: "problem"
    fields:
      - title: "The Problem"
      - bullets: ["Pain points", "Current solutions", "Why they fail"]

  - layout: "solution"
    fields:
      - title: "Our Solution"
      - architecture: "system-diagram"
      - highlights: ["Key innovations"]

  - layout: "architecture"
    fields:
      - title: "System Architecture"
      - diagram: "architecture-diagram"
      - components: ["Component descriptions"]

  - layout: "implementation"
    fields:
      - title: "Implementation Details"
      - code: true # 支持代码块
      - visual: "flowchart"

  - layout: "demo"
    fields:
      - title: "Live Demo"
      - screenshots: true
      - video: true

  - layout: "results"
    fields:
      - title: "Performance & Results"
      - charts: ["metrics", "comparisons"]

  - layout: "roadmap"
    fields:
      - title: "Roadmap"
      - timeline: true

style:
  colors:
    primary: "#1E1E1E" # 深灰（代码编辑器风格）
    secondary: "#007ACC" # VS Code蓝
    accent: "#4EC9B0" # Teal
    background: "#FFFFFF"
    codeBackground: "#F5F5F5"

  fonts:
    heading: "Segoe UI"
    body: "Segoe UI"
    code: "Fira Code" # 程序员字体
```

**2. 技术方案文档模板**

```yaml
name: "Technical Design Doc"
category: "tech"
type: "doc"

structure:
  - chapter: "Overview"
    subsections:
      - "Problem Statement"
      - "Goals and Non-Goals"
      - "Success Metrics"

  - chapter: "Background"
    subsections:
      - "Current System"
      - "Limitations"
      - "Requirements"

  - chapter: "Proposed Solution"
    subsections:
      - "High-Level Design"
      - "Detailed Design"
      - "API Specifications"
      - "Data Models"

  - chapter: "Architecture"
    includesDiagrams: true
    subsections:
      - "System Architecture"
      - "Component Interactions"
      - "Data Flow"

  - chapter: "Implementation Plan"
    subsections:
      - "Phases"
      - "Timeline"
      - "Dependencies"

  - chapter: "Testing Strategy"
    subsections:
      - "Unit Tests"
      - "Integration Tests"
      - "Performance Tests"

  - chapter: "Risks and Mitigations"

  - chapter: "Alternatives Considered"

style:
  codeHighlighting: true
  diagramTool: "mermaid"
  font: "Roboto"
```

##### C. 自定义模板

**用户可创建自定义模板：**

```typescript
interface CustomTemplate {
  metadata: {
    name: string;
    author: string;
    description: string;
    category: 'academic' | 'tech' | 'business' | 'other';
    type: 'ppt' | 'doc';
  };

  structure: {
    slides?: SlideTemplate[];
    chapters?: ChapterTemplate[];
  };

  style: {
    colors: ColorScheme;
    fonts: FontScheme;
    layout: LayoutConfig;
  };

  // AI生成提示词模板
  aiPrompts: {
    [section: string]: string;
  };
}

// 用户创建模板的UI
<TemplateBuilder>
  <Step1>选择基础模板</Step1>
  <Step2>自定义布局和样式</Step2>
  <Step3>配置AI生成规则</Step3>
  <Step4>保存并分享</Step4>
</TemplateBuilder>
```

##### D. 模板市场（未来功能）

```
┌─ 模板市场 ────────────────────────────────────┐
│                                               │
│ [🔍 搜索模板...]                              │
│                                               │
│ 热门模板                                      │
│ ┌─────────────┐  ┌─────────────┐            │
│ │ IEEE论文    │  │ ACM会议     │            │
│ │ ⭐⭐⭐⭐⭐  │  │ ⭐⭐⭐⭐    │            │
│ │ 1.2k下载    │  │ 890下载     │            │
│ └─────────────┘  └─────────────┘            │
│                                               │
│ 技术模板                                      │
│ ┌─────────────┐  ┌─────────────┐            │
│ │ 系统设计    │  │ Code Review │            │
│ │ ⭐⭐⭐⭐    │  │ ⭐⭐⭐⭐⭐  │            │
│ │ 650下载     │  │ 420下载     │            │
│ └─────────────┘  └─────────────┘            │
│                                               │
│ 我的模板                                      │
│ ┌─────────────┐                              │
│ │ 自定义模板1 │                              │
│ │ Created 3天前 │                            │
│ └─────────────┘                              │
│                                               │
│ [+ 创建新模板]                                │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 4. 技术架构设计

### 4.1 整体架构

**当前架构（基于现有实现）+ 2.0增强点：**

```
┌───────────────────────────── Frontend (Next.js) ─────────────────────────────┐
│                                                                                │
│  ┌─── Left Sidebar ───┐  ┌──── Middle Panel ────┐  ┌──── Right Panel ────┐ │
│  │                     │  │                       │  │                      │ │
│  │ • Explore         ✅│  │  Resource List      ✅│  │  Document Editor   ✅│ │
│  │ • AI Office       ✅│  │  ┌───────────────┐   │  │  ┌──────────────┐   │ │
│  │ • Settings        ✅│  │  │ Resource Cards│   │  │  │ PPT Slides   │   │ │
│  │                     │  │  │ (Checkboxes)  │   │  │  │ Navigation   │   │ │
│  │ WorkspaceLayout   ✅│  │  └───────────────┘   │  │  └──────────────┘   │ │
│  │                     │  │                       │  │                      │ │
│  │ (Sidebar.tsx)       │  │  ChatPanel          ✅│  │  MarkdownEditor    ✅│ │
│  └─────────────────────┘  │  ┌───────────────┐   │  │  Version History   ✅│ │
│                            │  │ Message List  │   │  │  Export Options    ✅│ │
│                            │  │ Input Area    │   │  └──────────────────────┘ │
│                            │  │ @mentions     │   │                            │
│                            │  └───────────────┘   │  Task Sidebar (optional) ✅│
│                            └───────────────────────┘                            │
│                                                                                 │
│  ┌───────────────────────── Zustand State Stores ✅ ────────────────────────┐ │
│  │ useResourceStore | useDocumentStore | useChatStore | useTaskStore       │ │
│  │ • addResource    | • updateDocument  | • addMessage | • addTask         │ │
│  │ • _id dedup      | • saveVersion     | • clearChat  | • restoreContext  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                          │
└──────────────────────────────────────┼──────────────────────────────────────────┘
                                       │ REST API / SSE
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                          API Routes (Next.js App Router)                         │
│                                                                                   │
│  /api/ai-office/chat (route.ts) ✅                                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  🆕 [Pre-processing] Multi-Agent Enhancement Layer (2.0新增)               │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ CoordinatorAgent (Grok)    → 任务规划、意图分析                      │  │ │
│  │  │ ResourceAnalysisAgent (Grok) → 深度分析资源、提取洞察                │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  │                                  ↓                                          │ │
│  │  ✅ [Core Stream] 现有流式生成 (保持不变)                                  │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ • 意图识别 (isPPTRequest, isUpdateRequest)                            │  │ │
│  │  │ • @资源解析 (parseMentions)                                           │  │ │
│  │  │ • Prompt增强 (格式要求 + 可视化标记 + 🆕Agent分析结果)                 │  │ │
│  │  │ • SSE流式调用 Grok/ChatGPT API                                        │  │ │
│  │  │ • 实时返回生成内容                                                    │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  │                                  ↓                                          │ │
│  │  🆕 [Post-processing] 验证与增强层 (2.0新增)                               │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ VerificationAgent (Grok) → 事实验证、置信度标记                       │  │ │
│  │  │ ContentEnhancer          → 添加引用、数据来源标注                     │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  其他API路由：                                                                   │
│  • /api/ai-office/export ✅ (PPTX/DOCX/PDF导出)                                 │
│  • /api/crawler/arxiv ✅ (arXiv采集)                                            │
│  • /api/crawler/github ✅ (GitHub采集)                                          │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                         External Services & Storage                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│  │  Grok API       │  │  ChatGPT API    │  │  PostgreSQL     │                │
│  │  (xAI)          │  │  (OpenAI)       │  │                 │                │
│  │                 │  │                 │  │ • raw_data      │                │
│  │ • Coordinator   │  │ • Content       │  │ • resources-*   │                │
│  │ • Analysis      │  │ • Visualization │  │ • templates     │                │
│  │ • Verification  │  │                 │  │                 │                │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                │
│                                                                                   │
│  🆕 扩展接口（预留）：                                                           │
│  • Claude API (可选)                                                            │
│  • Gemini API (可选)                                                            │
│  • Custom Endpoint (可选)                                                       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**架构说明：**

1. **✅ 已实现部分（保持不变）**：
   - 完整的三栏布局系统 (WorkspaceLayout.tsx)
   - Resource管理 (ResourceList.tsx + useResourceStore)
   - ChatPanel核心逻辑 (1615行，ChatPanel.tsx)
   - Document编辑器 (DocumentEditor.tsx + PPT渲染)
   - 版本管理 (VersionHistory.tsx + useDocumentStore)
   - 任务系统 (TaskList.tsx + useTaskStore)
   - API路由 (route.ts)

2. **🆕 2.0增强（在现有基础上添加）**：
   - **Pre-processing层**: 在API route中添加CoordinatorAgent和ResourceAnalysisAgent，分析用户意图和资源
   - **Prompt增强**: 将Agent分析结果注入到现有Prompt中
   - **Post-processing层**: 在内容生成后添加VerificationAgent验证和置信度标记

3. **核心设计原则**：
   - **无需重构**: 所有增强都是在现有流程的"前后"添加，不修改核心逻辑
   - **渐进增强**: Multi-Agent功能可以逐步启用，不影响现有功能
   - **兼容性**: 保持现有API接口不变，确保向后兼容

### 4.2 Multi-Agent集成设计（基于现有API Route增强）

**设计理念**: 在现有 `/api/ai-office/chat` 路由中集成Multi-Agent能力，而非构建独立的后端系统。

#### 4.2.1 API Route集成架构

```typescript
// frontend/app/api/ai-office/chat/route.ts (✅ 现有文件，添加Multi-Agent增强)

import {
  CoordinatorAgent,
  ResourceAnalysisAgent,
  VerificationAgent,
} from "@/lib/ai-agents";

export async function POST(req: Request) {
  const {
    message,
    resources,
    documentId,
    agentMode = "enhanced",
  } = await req.json();

  // ============ ✅ 现有逻辑保留 ============
  // 1. 解析用户输入
  const isPPTRequest = /ppt|powerpoint|演示/i.test(message);
  const isUpdateRequest = /更新|修改|补充/i.test(message);

  // ============ 🆕 Multi-Agent Pre-processing ============
  let agentPlan, resourceAnalysis;

  if (agentMode === "enhanced" && resources?.length > 0) {
    // Step 1: CoordinatorAgent分析意图
    const coordinator = new CoordinatorAgent("grok");
    agentPlan = await coordinator.analyze({
      userMessage: message,
      isPPT: isPPTRequest,
      isUpdate: isUpdateRequest,
      resourceCount: resources.length,
    });

    // Step 2: ResourceAnalysisAgent深度分析资源
    if (agentPlan.needsResourceAnalysis) {
      const analyzer = new ResourceAnalysisAgent("grok");
      resourceAnalysis = await analyzer.analyze({
        resources,
        focus: agentPlan.focus,
        analysisDepth: agentPlan.depth,
      });
    }
  }

  // ============ 🆕 Prompt Enhancement ============
  let enhancedPrompt = message;

  if (resourceAnalysis) {
    enhancedPrompt = `
${message}

【AI资源分析】
核心洞察: ${resourceAnalysis.insights.join("; ")}
关键发现: ${resourceAnalysis.findings.map((f) => f.claim).join("; ")}
可视化建议: ${resourceAnalysis.visualOpportunities.map((v) => v.type).join(", ")}

请基于以上分析结果生成内容。
`;
  }

  // ============ ✅ 现有流式生成（使用增强后的Prompt）============
  const response = await fetch(getAIEndpoint(agentPlan?.model || "grok"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: agentPlan?.model || "grok",
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(isPPTRequest, resources), // ✅ 现有函数
        },
        {
          role: "user",
          content: enhancedPrompt, // 🆕 使用增强后的Prompt
        },
      ],
      stream: true,
    }),
  });

  // ✅ 流式返回（现有逻辑）
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        fullContent += chunk;
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }

      // ============ 🆕 Post-processing: Verification ============
      if (agentMode === "enhanced" && agentPlan?.needsVerification) {
        const verifier = new VerificationAgent("grok");
        const verification = await verifier.verify({
          content: fullContent,
          sources: resources,
        });

        // 添加验证结果到响应
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "verification",
              confidence: verification.confidence,
              badges: verification.badges,
            })}\n\n`,
          ),
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

#### 4.2.2 Agent实现（轻量级工具函数）

**注意**: Agents实现为轻量级工具函数，不是独立的后端服务。

```typescript
// frontend/lib/ai-agents/coordinator.agent.ts (🆕 新增文件)

interface AgentPlan {
  needsResourceAnalysis: boolean;
  needsVerification: boolean;
  focus?: string;
  depth: "shallow" | "deep";
  model: "grok" | "chatgpt";
}

export class CoordinatorAgent {
  constructor(private model: string) {}

  async analyze(input: {
    userMessage: string;
    isPPT: boolean;
    isUpdate: boolean;
    resourceCount: number;
  }): Promise<AgentPlan> {
    // 使用简单的API调用Grok进行意图分析
    const response = await fetch("/api/ai/grok", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-2",
        messages: [
          {
            role: "system",
            content: "你是任务规划专家。分析用户意图，返回JSON格式的执行计划。",
          },
          {
            role: "user",
            content: `
用户消息: ${input.userMessage}
是否PPT请求: ${input.isPPT}
是否更新请求: ${input.isUpdate}
资源数量: ${input.resourceCount}

返回JSON:
{
  "needsResourceAnalysis": boolean,  // 是否需要深度分析资源
  "needsVerification": boolean,      // 是否需要验证
  "focus": string,                    // 分析重点
  "depth": "shallow|deep",           // 分析深度
  "model": "grok|chatgpt"            // 推荐使用的模型
}
`,
          },
        ],
        temperature: 0.1,
      }),
    });

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  }
}
```

```typescript
// frontend/lib/ai-agents/resource-analysis.agent.ts (🆕 新增文件)

interface ResourceAnalysis {
  insights: string[];
  findings: Array<{ claim: string; evidence: string; source: string }>;
  visualOpportunities: Array<{ type: string; description: string }>;
  confidence: number;
}

export class ResourceAnalysisAgent {
  constructor(private model: string) {}

  async analyze(input: {
    resources: Resource[];
    focus?: string;
    analysisDepth: "shallow" | "deep";
  }): Promise<ResourceAnalysis> {
    const prompt = this.buildPrompt(input.resources, input.focus);

    const response = await fetch("/api/ai/grok", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-2",
        messages: [
          {
            role: "system",
            content:
              "你是科研文献分析专家。深度分析学术论文和技术文档，提取核心观点、关键数据和研究方法。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  }

  private buildPrompt(resources: Resource[], focus?: string): string {
    return `
分析以下${resources.length}篇学术/技术资源，提取关键信息：

${resources
  .map(
    (r, i) => `
资源${i + 1}: ${r.title}
类型: ${r.type}
摘要: ${r.abstract || ""}
${r.content ? `内容: ${r.content.substring(0, 500)}...` : ""}
`,
  )
  .join("\n---\n")}

${focus ? `分析重点: ${focus}` : ""}

请以JSON格式返回：
{
  "insights": ["核心观点1", "核心观点2"],
  "findings": [{
    "claim": "关键发现",
    "evidence": "支持证据",
    "source": "资源标题"
  }],
  "visualOpportunities": [{
    "type": "flow|chart|matrix",
    "description": "可视化描述"
  }],
  "confidence": 0.95
}
`;
  }
}
```

```typescript
// frontend/lib/ai-agents/verification.agent.ts (🆕 新增文件)

interface VerificationResult {
  confidence: number;
  badges: Array<{
    section: string;
    status: "verified" | "uncertain" | "unsupported";
  }>;
  suggestions: string[];
}

export class VerificationAgent {
  constructor(private model: string) {}

  async verify(input: {
    content: string;
    sources: Resource[];
  }): Promise<VerificationResult> {
    const response = await fetch("/api/ai/grok", {
      method: "POST",
      body: JSON.stringify({
        model: "grok-2",
        messages: [
          {
            role: "system",
            content:
              "你是事实验证专家。交叉检查内容与资源的一致性，标注置信度。",
          },
          {
            role: "user",
            content: `
生成的内容:
${content}

参考资源:
${input.sources.map((r) => `- ${r.title}: ${r.abstract}`).join("\n")}

验证内容的准确性，返回JSON:
{
  "confidence": 0.0-1.0,
  "badges": [{"section": "第1页", "status": "verified"}],
  "suggestions": ["建议1"]
}
`,
          },
        ],
        temperature: 0.1,
      }),
    });

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  }
}
```

#### 4.2.3 关键设计决策

| 决策点        | 选择                | 理由                     |
| ------------- | ------------------- | ------------------------ |
| **Agent位置** | Frontend API Route  | 避免后端重构，保持轻量级 |
| **Agent形式** | 工具函数类          | 不是独立服务，易于集成   |
| **流程集成**  | Pre/Post-processing | 不修改现有核心逻辑       |
| **模型调用**  | 直接调用AI API      | 无需额外的服务层         |
| **状态管理**  | 无状态              | 每次请求独立，简化实现   |
| **渐进增强**  | agentMode参数控制   | 可选启用，向后兼容       |

#### 4.2.4 启用/禁用Multi-Agent

```typescript
// 在ChatPanel中控制
const handleSend = async () => {
  const response = await fetch("/api/ai-office/chat", {
    method: "POST",
    body: JSON.stringify({
      message: userInput,
      resources: selectedResources,
      agentMode: useMultiAgent ? "enhanced" : "basic", // 🆕 开关
    }),
  });
};
```

**优势**:

1. ✅ **无需重构**: 现有ChatPanel逻辑100%保留
2. ✅ **易于实现**: Agent是简单的工具函数，不是复杂的服务
3. ✅ **渐进增强**: 可以逐步添加Agent功能
4. ✅ **向后兼容**: agentMode='basic'时使用原有流程
5. ✅ **易于测试**: 可以单独测试每个Agent函数

### 4.3 数据库设计（基于现有架构优化）

**PostgreSQL Schema更新：**

```prisma
// prisma/schema.prisma

model Resource {
  id              String       @id @default(uuid())
  type            ResourceType
  title           String
  abstract        String?
  content         String?
  sourceUrl       String
  pdfUrl          String?
  authors         Json?
  organizations   Json?
  publishedAt     DateTime?

  // AI增强字段
  aiSummary       String?
  keyInsights     Json?
  difficultyLevel Int?
  categories      Json?
  tags            Json?
  autoTags        Json?
  qualityScore    Decimal?
  trendingScore   Decimal?

  // 关联
  rawDataId       String?      // PostgreSQL JSONB 引用

  // 新增：推荐相关
  recommendations ResourceRecommendation[]

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([type])
  @@index([qualityScore])
  @@index([createdAt])
}

// 新增：资源推荐记录
model ResourceRecommendation {
  id           String   @id @default(uuid())
  resourceId   String
  resource     Resource @relation(fields: [resourceId], references: [id])

  score        Decimal  // 相关度分数
  reason       String   // 推荐理由
  basedOn      String   // 'url-detection' | 'content-similarity' | 'user-history'

  status       String   // 'pending' | 'accepted' | 'rejected'

  userId       String?
  documentId   String?

  createdAt    DateTime @default(now())

  @@index([resourceId])
  @@index([status])
}

// 文档表（扩展）
model Document {
  id            String       @id @default(uuid())
  type          DocumentType // 'ppt' | 'doc' | 'research-page'
  title         String

  // 内容（存储在PostgreSQL JSONB）
  contentId     String       // PostgreSQL JSONB

  // 模板
  templateId    String?
  template      Template?    @relation(fields: [templateId], references: [id])

  // 版本管理
  currentVersion String      @default("v1.0")
  versions      DocumentVersion[]

  // 元数据
  metadata      Json         // 各种统计信息

  userId        String

  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([userId])
  @@index([type])
}

// 文档版本
model DocumentVersion {
  id           String    @id @default(uuid())
  documentId   String
  document     Document  @relation(fields: [documentId], references: [id])

  version      String    // 'v1.0', 'v1.1', 'v2.0'

  // 快照（存储在PostgreSQL JSONB）
  snapshotId   String    // PostgreSQL JSONB

  // 变更记录
  changes      Json      // { type, section, description, diff }

  author       String    // 'user' | 'ai' | userId
  message      String    // 版本提交信息

  parentVersion String?  // 父版本ID

  createdAt    DateTime  @default(now())

  @@index([documentId])
  @@index([version])
}

// 模板表
model Template {
  id          String     @id @default(uuid())
  name        String
  description String?
  category    String     // 'academic' | 'tech' | 'business' | 'custom'
  type        String     // 'ppt' | 'doc'

  // 模板定义（存储在PostgreSQL JSONB）
  definitionId String    // PostgreSQL JSONB

  // 预览
  thumbnailUrl String?

  // 统计
  downloadCount Int      @default(0)
  rating       Decimal?

  // 作者
  authorId     String    // 'system' | userId
  isPublic     Boolean   @default(false)

  documents    Document[]

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([category])
  @@index([type])
  @@index([isPublic])
}

enum DocumentType {
  PPT
  DOC
  RESEARCH_PAGE
}
```

**PostgreSQL 表结构:**

```sql
-- PostgreSQL: documents (主表)
-- PostgreSQL: document_contents (JSONB 存储)
{
  _id: ObjectId("..."),
  documentId: "uuid",  // 关联PostgreSQL
  type: "ppt" | "doc" | "research-page",

  // PPT内容
  slides: [
    {
      id: "slide-1",
      order: 1,
      layout: "title",
      elements: {
        title: { text: "...", style: {...} },
        content: {...},
        visuals: [...]
      },
      version: "v2.1",
      lastModified: ISODate("..."),
      modifiedBy: "user"
    }
  ],

  // 或Doc内容
  chapters: [
    {
      id: "chapter-1",
      order: 1,
      level: 1,
      title: "Introduction",
      content: {
        markdown: "...",
        html: "..."
      },
      elements: {...},
      version: "v1.5",
      lastModified: ISODate("...")
    }
  ],

  // 或Research Page内容
  sections: {
    summary: {...},
    keyFindings: [...],
    visualInsights: {...},
    deepDive: {...},
    actionableInsights: {...}
  },

  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}

-- PostgreSQL: document_versions (JSONB)
{
  _id: ObjectId("..."),
  versionId: "uuid",  // 关联PostgreSQL
  documentId: "uuid",
  version: "v2.1",

  snapshot: {
    // 完整的文档快照
    slides: [...] // 或 chapters: [...] 或 sections: {...}
  },

  thumbnails: {
    "slide-1": "base64...",
    "slide-2": "base64..."
  },

  createdAt: ISODate("...")
}

-- PostgreSQL: templates (JSONB)
{
  _id: ObjectId("..."),
  templateId: "uuid",  // 关联PostgreSQL

  metadata: {
    name: "Academic Conference Presentation",
    category: "academic",
    type: "ppt"
  },

  structure: {
    slides: [
      {
        layout: "title",
        required: true,
        fields: [...]
      },
      ...
    ]
  },

  style: {
    colors: {...},
    fonts: {...},
    layout: {...}
  },

  aiPrompts: {
    "background": "生成学术背景介绍...",
    "methods": "总结研究方法...",
    ...
  },

  createdAt: ISODate("...")
}
```

### 4.4 API设计

**核心API端点：**

```typescript
// 资源管理API
POST   /api/resources/recommend           // 智能推荐资源
GET    /api/resources/recommendations     // 获取推荐列表
POST   /api/resources/import              // 导入资源（用户决策后）
GET    /api/resources/:id                 // 获取资源详情

// Multi-Agent文档生成API
POST   /api/documents/generate             // 生成文档
GET    /api/documents/:id/stream           // SSE流式生成
POST   /api/documents/:id/enrich           // 持续丰富文档

// Research Page API
POST   /api/research-pages/generate        // 生成Research Page
GET    /api/research-pages/:id/stream      // SSE流式生成

// 文档编辑API
GET    /api/documents/:id                  // 获取文档
PATCH  /api/documents/:id/slides/:slideId  // 编辑特定slide
PATCH  /api/documents/:id/chapters/:chapterId  // 编辑特定章节
POST   /api/documents/:id/slides           // 添加新slide
DELETE /api/documents/:id/slides/:slideId  // 删除slide

// 版本管理API
GET    /api/documents/:id/versions         // 获取版本列表
GET    /api/documents/:id/versions/:version // 获取特定版本
POST   /api/documents/:id/versions         // 创建新版本
POST   /api/documents/:id/rollback/:version // 回滚到某版本

// 模板API
GET    /api/templates                      // 获取模板列表
GET    /api/templates/:id                  // 获取模板详情
POST   /api/templates                      // 创建自定义模板
POST   /api/documents/:id/apply-template   // 应用模板

// 导出API
POST   /api/documents/:id/export/pptx      // 导出PPTX
POST   /api/documents/:id/export/docx      // 导出DOCX
POST   /api/documents/:id/export/pdf       // 导出PDF
POST   /api/documents/:id/export/markdown  // 导出Markdown
POST   /api/documents/:id/export/html      // 导出HTML
```

**SSE流式生成示例：**

```typescript
// frontend/hooks/useDocumentGeneration.ts

export function useDocumentGeneration() {
  const [status, setStatus] = useState<"idle" | "generating" | "complete">(
    "idle",
  );
  const [progress, setProgress] = useState<GenerationProgress>({});

  const generateDocument = async (request: DocumentGenerationRequest) => {
    setStatus("generating");

    const eventSource = new EventSource(
      `/api/documents/generate/stream?${new URLSearchParams(request)}`,
    );

    eventSource.addEventListener("phase", (e) => {
      const data = JSON.parse(e.data);
      setProgress((prev) => ({
        ...prev,
        currentPhase: data.phase,
        currentAgent: data.agent,
      }));
    });

    eventSource.addEventListener("section-start", (e) => {
      const { sectionName } = JSON.parse(e.data);
      setProgress((prev) => ({
        ...prev,
        sections: {
          ...prev.sections,
          [sectionName]: { status: "generating", content: "" },
        },
      }));
    });

    eventSource.addEventListener("section-chunk", (e) => {
      const { sectionName, chunk } = JSON.parse(e.data);
      setProgress((prev) => ({
        ...prev,
        sections: {
          ...prev.sections,
          [sectionName]: {
            ...prev.sections[sectionName],
            content: (prev.sections[sectionName].content || "") + chunk,
          },
        },
      }));
    });

    eventSource.addEventListener("complete", (e) => {
      const { documentId } = JSON.parse(e.data);
      setStatus("complete");
      eventSource.close();
      return documentId;
    });

    eventSource.addEventListener("error", (e) => {
      console.error("Generation error:", e);
      eventSource.close();
      setStatus("idle");
    });
  };

  return { generateDocument, status, progress };
}
```

---

## 5. 用户体验流程

### 5.1 核心用户旅程

#### Journey 1: 从资源到PPT

```
1. 用户打开AI Office
   ↓
2. 粘贴arXiv链接 (https://arxiv.org/abs/2301.12345)
   ↓
3. 系统显示推荐卡片：
   ┌──────────────────────────────────┐
   │ 📄 检测到 arXiv 论文             │
   │ Multistationarity in Phospho...  │
   │ 💡 相关度: 95%                   │
   │ [✓ 添加] [✕ 忽略]               │
   └──────────────────────────────────┘
   ↓
4. 用户点击"添加" → 资源导入
   ↓
5. 用户在Chat面板输入：
   "帮我生成一个学术会议演讲PPT，主题是磷酸化网络的多稳态特性"
   ↓
6. 系统显示模板选择：
   ┌──────────────────────────────────┐
   │ 请选择模板：                     │
   │ ○ Academic Conference            │
   │ ○ Tech Talk                      │
   │ ○ 自定义模板                     │
   │ [继续]                           │
   └──────────────────────────────────┘
   ↓
7. 用户选择"Academic Conference" → 点击继续
   ↓
8. Multi-Agent开始工作（实时进度显示）：

   ┌────────────────────────────────────┐
   │ 🤖 正在生成您的演讲PPT...         │
   │                                    │
   │ ✅ 任务规划 (Grok)                │
   │    - 识别为学术演讲                │
   │    - 规划6个slides                │
   │                                    │
   │ 🔄 资源分析 (Grok) 进行中...      │
   │    - 正在分析论文核心观点          │
   │    - 提取关键实验数据              │
   │    [████████░░] 80%               │
   │                                    │
   │ ⏳ 内容生成 (ChatGPT) 等待中...   │
   │ ⏳ 可视化设计 (ChatGPT) 等待中... │
   │ ⏳ 验证 (Grok) 等待中...          │
   └────────────────────────────────────┘

   ↓ (3秒后)

   ┌────────────────────────────────────┐
   │ 🤖 正在生成您的演讲PPT...         │
   │                                    │
   │ ✅ 任务规划 (Grok)                │
   │ ✅ 资源分析 (Grok)                │
   │    - 提取了5个核心观点             │
   │    - 识别了3个可视化机会           │
   │                                    │
   │ 🔄 内容生成 (ChatGPT) 进行中...   │
   │    ✅ Slide 1: 标题页              │
   │    ✅ Slide 2: 背景介绍            │
   │    🔄 Slide 3: 研究方法            │
   │    [████░░░░░░] 40%               │
   │                                    │
   │ 🔄 可视化设计 (ChatGPT) 进行中... │
   │    ✅ 流程图: 磷酸化级联反应       │
   │    🔄 柱状图: 实验数据对比         │
   │    [██████░░░░] 60%               │
   │                                    │
   │ ⏳ 验证 (Grok) 等待中...          │
   └────────────────────────────────────┘

   ↓ (10秒后)

   ┌────────────────────────────────────┐
   │ ✅ PPT生成完成！                  │
   │                                    │
   │ 📊 6 slides · 3 visualizations    │
   │ ✅ 95% 平均置信度                 │
   │ ⏱️ 用时 12 秒                     │
   │                                    │
   │ [查看PPT] [重新生成]              │
   └────────────────────────────────────┘

   ↓
9. 用户点击"查看PPT" → 进入编辑器

   ┌─────────────────────────────────────────────┐
   │ 磷酸化网络的多稳态特性 (v1.0)              │
   │ ┌─────────────────────────────────────────┐ │
   │ │ [Slide Thumbnails]                      │ │
   │ │ [1] [2] [3] [4] [5] [6]                 │ │
   │ └─────────────────────────────────────────┘ │
   │                                             │
   │ ┌─────────────────────────────────────────┐ │
   │ │ [当前Slide 1预览]                       │ │
   │ │                                         │ │
   │ │  磷酸化网络的多稳态特性                 │ │
   │ │  Multistationarity in Phospho Networks │ │
   │ │                                         │ │
   │ │  您的名字                               │ │
   │ │  机构名称                               │ │
   │ │  2025-11-17                            │ │
   │ └─────────────────────────────────────────┘ │
   │                                             │
   │ [编辑] [演示模式] [导出] [版本历史]        │
   └─────────────────────────────────────────────┘

   ↓
10. 用户点击Slide 3缩略图 → 查看并编辑

    ┌─────────────────────────────────────────┐
    │ 编辑 Slide 3: 研究方法                  │
    │                                         │
    │ [流程图显示]                            │
    │ ┌─────┐      ┌─────┐      ┌─────┐     │
    │ │激酶 │  →  │底物 │  →  │磷酸化│     │
    │ └─────┘      └─────┘      └─────┘     │
    │                                         │
    │ 用户操作：                              │
    │ ○ 重新生成此slide                      │
    │   提示词: "添加更多实验细节"            │
    │   [生成]                                │
    │                                         │
    │ ○ 手动编辑                             │
    │   [编辑标题] [编辑内容] [编辑图表]     │
    │                                         │
    │ [保存为v1.1] [取消]                     │
    └─────────────────────────────────────────┘

    ↓
11. 用户点击"重新生成" → AI (ChatGPT)重新生成Slide 3

    ↓
12. 生成完成 → 保存为v1.1

    ┌─────────────────────────────────────────┐
    │ ✅ Slide 3 已更新 (v1.1)               │
    │                                         │
    │ 变更：                                  │
    │ • 添加了实验细节描述                    │
    │ • 更新了流程图布局                      │
    │                                         │
    │ [查看对比] [保存] [撤销]                │
    └─────────────────────────────────────────┘

    ↓
13. 用户满意 → 点击"导出" → 选择PPTX

    ↓
14. 下载PPT文件 → 完成！
```

#### Journey 2: 持续迭代报告

```
1. 用户有一个已存在的Research Page (v1.0)
   - 基于3篇论文生成

   ↓
2. 一周后，用户发现新论文
   - 粘贴新论文URL

   ↓
3. 系统推荐：
   ┌──────────────────────────────────────┐
   │ 💡 检测到可以丰富您的文档：          │
   │ "磷酸化网络研究报告 v1.0"            │
   │                                      │
   │ 新资源: "Advanced Phospho Study"     │
   │ 相关度: 93%                          │
   │                                      │
   │ 建议更新：                           │
   │ • Chapter 2: 添加最新研究进展        │
   │ • Chapter 4: 更新实验方法            │
   │                                      │
   │ [自动丰富] [手动选择] [忽略]         │
   └──────────────────────────────────────┘

   ↓
4. 用户点击"自动丰富"

   ↓
5. AI (Grok)分析新论文，AI (ChatGPT)整合内容

   ┌──────────────────────────────────────┐
   │ 🔄 正在丰富文档...                   │
   │                                      │
   │ ✅ 分析新资源 (Grok)                 │
   │ 🔄 整合到Chapter 2 (ChatGPT)         │
   │ ⏳ 整合到Chapter 4 (ChatGPT)         │
   │                                      │
   │ [进度: 60%]                          │
   └──────────────────────────────────────┘

   ↓
6. 完成后显示Diff对比

   ┌──────────────────────────────────────┐
   │ 版本对比: v1.0 → v1.1                │
   │                                      │
   │ Chapter 2: Background                │
   │ + 添加了最新研究进展 (3段)           │
   │ ~ 更新了引用列表 (新增5篇)           │
   │                                      │
   │ Chapter 4: Methodology               │
   │ + 添加了新实验方法 (2段)             │
   │                                      │
   │ [接受更新] [查看详情] [撤销]         │
   └──────────────────────────────────────┘

   ↓
7. 用户点击"接受更新" → 保存为v1.1

   ↓
8. 2周后，用户又添加2篇新论文
   - 重复上述流程 → 生成v1.2

   ↓
9. 一个月后，用户需要演讲PPT
   - 点击"生成PPT"
   - 基于v1.2的内容生成PPT

   ↓
10. 生成PPT → 用户编辑个别slides → 保存为PPT v1.0

    ↓
11. 导出PPTX → 用于会议演讲
```

### 5.2 关键交互模式

#### 交互模式1: 智能资源推荐

```tsx
// frontend/components/ai-office/resources/ResourceRecommendation.tsx

export function ResourceRecommendation({ url, onAccept, onReject }: Props) {
  const { recommendation, loading } = useResourceRecommendation(url);

  if (loading) {
    return (
      <Card>
        <Spinner /> 正在分析资源...
      </Card>
    );
  }

  return (
    <Card className="resource-recommendation">
      <CardHeader>
        <Icon type={recommendation.type} />
        <Badge>检测到 {getResourceTypeLabel(recommendation.type)}</Badge>
      </CardHeader>

      <CardBody>
        <h3>{recommendation.metadata.title}</h3>
        {recommendation.metadata.authors && (
          <Authors>{recommendation.metadata.authors.join(", ")}</Authors>
        )}
        <Abstract>{recommendation.metadata.abstract}</Abstract>

        <RelevanceScore score={recommendation.recommendation.score}>
          💡 相关度: {(recommendation.recommendation.score * 100).toFixed(0)}%
        </RelevanceScore>

        <Reason>{recommendation.recommendation.reason}</Reason>
      </CardBody>

      <CardActions>
        <Button onClick={() => onAccept(recommendation)}>✓ 添加到资源库</Button>
        <Button variant="ghost" onClick={() => onReject(recommendation)}>
          ✕ 忽略
        </Button>
      </CardActions>
    </Card>
  );
}
```

#### 交互模式2: 实时生成进度

```tsx
// frontend/components/ai-office/document/GenerationProgress.tsx

export function GenerationProgress({ progress }: Props) {
  return (
    <ProgressPanel>
      <Title>🤖 正在生成您的{progress.documentType}...</Title>

      {/* Phase列表 */}
      <PhaseList>
        {PHASES.map((phase) => (
          <PhaseItem
            key={phase}
            status={getPhaseStatus(phase, progress)}
            current={progress.currentPhase === phase}
          >
            {getPhaseStatus(phase, progress) === "complete" && "✅"}
            {getPhaseStatus(phase, progress) === "in-progress" && "🔄"}
            {getPhaseStatus(phase, progress) === "pending" && "⏳"}

            <PhaseLabel>{getPhaseLabel(phase)}</PhaseLabel>

            {progress.currentPhase === phase && progress.currentAgent && (
              <AgentBadge>{progress.currentAgent}</AgentBadge>
            )}

            {/* 详细进度 */}
            {progress.currentPhase === phase && progress.details && (
              <PhaseDetails>
                {progress.details.map((detail) => (
                  <DetailItem key={detail}>
                    {detail.status === "complete" && "✅"}
                    {detail.status === "in-progress" && "🔄"}
                    {detail.text}
                  </DetailItem>
                ))}

                {progress.percentage && (
                  <ProgressBar value={progress.percentage} />
                )}
              </PhaseDetails>
            )}
          </PhaseItem>
        ))}
      </PhaseList>

      {/* 完成状态 */}
      {progress.status === "complete" && (
        <CompletionCard>
          <SuccessIcon>✅</SuccessIcon>
          <h3>{progress.documentType}生成完成！</h3>
          <Stats>
            <Stat>
              <StatIcon>📊</StatIcon>
              <StatValue>
                {progress.stats.slideCount || progress.stats.chapterCount}
              </StatValue>
              <StatLabel>
                {progress.documentType === "ppt" ? "slides" : "chapters"}
              </StatLabel>
            </Stat>
            <Stat>
              <StatIcon>✅</StatIcon>
              <StatValue>{progress.stats.confidence}%</StatValue>
              <StatLabel>平均置信度</StatLabel>
            </Stat>
            <Stat>
              <StatIcon>⏱️</StatIcon>
              <StatValue>{progress.stats.duration}s</StatValue>
              <StatLabel>用时</StatLabel>
            </Stat>
          </Stats>

          <Actions>
            <Button primary onClick={progress.onView}>
              查看{progress.documentType}
            </Button>
            <Button onClick={progress.onRegenerate}>重新生成</Button>
          </Actions>
        </CompletionCard>
      )}
    </ProgressPanel>
  );
}
```

#### 交互模式3: 版本对比

```tsx
// frontend/components/ai-office/document/VersionComparison.tsx

export function VersionComparison({
  documentId,
  oldVersion,
  newVersion,
}: Props) {
  const { comparison, loading } = useVersionComparison(
    documentId,
    oldVersion,
    newVersion,
  );

  if (loading) return <Spinner />;

  return (
    <ComparisonView>
      <Header>
        <h2>
          版本对比: {oldVersion} → {newVersion}
        </h2>
        <CloseButton onClick={onClose} />
      </Header>

      <Summary>
        <SummaryCard type="added">
          <Icon>+</Icon>
          <Count>{comparison.stats.added}</Count>
          <Label>新增</Label>
        </SummaryCard>

        <SummaryCard type="modified">
          <Icon>~</Icon>
          <Count>{comparison.stats.modified}</Count>
          <Label>修改</Label>
        </SummaryCard>

        <SummaryCard type="deleted">
          <Icon>-</Icon>
          <Count>{comparison.stats.deleted}</Count>
          <Label>删除</Label>
        </SummaryCard>
      </Summary>

      <DiffList>
        {comparison.changes.map((change) => (
          <DiffItem key={change.id} type={change.type}>
            <DiffHeader>
              <ChangeIcon type={change.type} />
              <SectionName>{change.section}</SectionName>
              <ChangeType>{getChangeTypeLabel(change.type)}</ChangeType>
            </DiffHeader>

            {change.type === "modified" && (
              <SideBySide>
                <OldVersion>
                  <Label>旧版本 ({oldVersion})</Label>
                  <Content>{change.oldContent}</Content>
                </OldVersion>

                <NewVersion>
                  <Label>新版本 ({newVersion})</Label>
                  <Content>
                    <Diff
                      oldText={change.oldContent}
                      newText={change.newContent}
                    />
                  </Content>
                </NewVersion>
              </SideBySide>
            )}

            {change.type === "added" && (
              <AddedContent>
                <Content>{change.newContent}</Content>
              </AddedContent>
            )}

            {change.type === "deleted" && (
              <DeletedContent>
                <Content>{change.oldContent}</Content>
              </DeletedContent>
            )}
          </DiffItem>
        ))}
      </DiffList>

      <Actions>
        <Button primary onClick={() => onAccept(newVersion)}>
          ✓ 接受更新
        </Button>
        <Button onClick={() => onReject()}>✕ 撤销</Button>
        <Button variant="ghost" onClick={() => onViewDetails()}>
          查看详情
        </Button>
      </Actions>
    </ComparisonView>
  );
}
```

---

## 6. 数据模型设计

（已在4.3节详细说明，这里补充关键类型定义）

```typescript
// frontend/types/ai-office-v2.ts

// 文档生成请求
export interface DocumentGenerationRequest {
  type: "ppt" | "doc" | "research-page";
  resources: string[]; // resource IDs
  template?: string; // template ID
  prompt: string;
  focus?: string; // 分析重点
  style?: "academic" | "tech" | "business";
}

// 文档生成进度
export interface GenerationProgress {
  status: "idle" | "generating" | "complete" | "error";
  documentType: "ppt" | "doc" | "research-page";

  currentPhase:
    | "planning"
    | "analyzing"
    | "generating"
    | "verifying"
    | "synthesizing";
  currentAgent?: "grok" | "chatgpt";

  details: Array<{
    text: string;
    status: "pending" | "in-progress" | "complete";
  }>;

  percentage?: number;

  stats?: {
    slideCount?: number;
    chapterCount?: number;
    confidence: number;
    duration: number;
  };
}

// 版本对比结果
export interface VersionComparison {
  documentId: string;
  oldVersion: string;
  newVersion: string;

  stats: {
    added: number;
    modified: number;
    deleted: number;
  };

  changes: Array<{
    id: string;
    type: "added" | "modified" | "deleted";
    section: string; // slide ID or chapter ID
    oldContent?: string;
    newContent?: string;
    diff?: DiffResult;
  }>;
}

// 模板定义
export interface Template {
  id: string;
  name: string;
  description: string;
  category: "academic" | "tech" | "business" | "custom";
  type: "ppt" | "doc";

  structure: {
    slides?: SlideTemplate[];
    chapters?: ChapterTemplate[];
  };

  style: {
    colors: ColorScheme;
    fonts: FontScheme;
    layout: LayoutConfig;
  };

  aiPrompts: Record<string, string>;

  metadata: {
    author: string;
    downloads: number;
    rating: number;
    isPublic: boolean;
  };
}

export interface SlideTemplate {
  layout: "title" | "content" | "two-column" | "visual" | "blank";
  required: boolean;
  fields: Array<{
    name: string;
    type: "text" | "bullets" | "image" | "chart" | "diagram" | "code";
    placeholder?: string;
  }>;
  visual?: "flow" | "chart" | "diagram" | "image";
}

export interface ChapterTemplate {
  level: 1 | 2 | 3 | 4;
  required: boolean;
  title: string;
  subsections?: string[];
  wordCount?: { min: number; max: number };
  includesDiagrams?: boolean;
}
```

---

## 7. UI/UX设计规范（基于现有实现）

> **说明**: 本节描述当前AI Office的实际UI风格和设计模式，所有2.0新增组件应遵循此规范以保持一致性。

### 7.1 设计原则

1. **简洁现代** - 使用Tailwind CSS，保持界面干净清爽
2. **渐进式披露** - 复杂功能隐藏在高级选项中，默认简洁
3. **即时反馈** - 操作立即响应，状态及时更新（transition-colors）
4. **可恢复性** - 所有重要操作可撤销/回滚（版本管理）
5. **流畅交互** - 使用hover/focus状态，提供清晰的视觉反馈

### 7.2 色彩系统（当前实现）

**基于 Tailwind CSS + AlphaXiv 配色**

```typescript
// frontend/tailwind.config.ts
export const CURRENT_THEME = {
  // 主色系（蓝色）
  primary: {
    DEFAULT: "#3b82f6", // blue-500
    hover: "#2563eb", // blue-600
    active: "#1d4ed8", // blue-700
    light: "#60a5fa", // blue-400
    lightest: "#dbeafe", // blue-100
  },

  // 背景色
  background: {
    primary: "#ffffff", // white
    secondary: "#f9fafb", // gray-50
    tertiary: "#f3f4f6", // gray-100
  },

  // 边框色
  border: {
    light: "#f3f4f6", // gray-100
    DEFAULT: "#e5e7eb", // gray-200
    dark: "#d1d5db", // gray-300
  },

  // 文字色
  text: {
    primary: "#111827", // gray-900
    secondary: "#6b7280", // gray-600
    tertiary: "#9ca3af", // gray-500
    disabled: "#d1d5db", // gray-300
  },

  // 状态色
  success: "#10b981", // green-500
  warning: "#f59e0b", // amber-500
  error: "#ef4444", // red-500
  info: "#3b82f6", // blue-500
};
```

### 7.3 组件样式模式（当前实现）

#### 按钮样式

```tsx
// ✅ 主要按钮（已使用）- WorkspaceLayout.tsx:92
<button className="rounded-full bg-blue-600 px-5 py-3 text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl hover:scale-105 active:scale-95">
  任务列表
</button>

// ✅ 图标按钮（已使用）- ResourceList.tsx:111
<button className="flex-shrink-0 rounded p-1 transition-colors hover:bg-gray-200">
  <X className="h-4 w-4 text-gray-500" />
</button>

// ✅ 文字按钮/危险操作（已使用）- ResourceList.tsx:168
<button className="text-xs font-medium text-red-600 hover:text-red-700">
  删除选中
</button>

// ✅ 次要按钮（通用模式）
<button className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
  取消
</button>

// ✅ 禁用状态
<button
  disabled
  className="cursor-not-allowed rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-400"
>
  已禁用
</button>
```

#### 表单元素

```tsx
// ✅ Checkbox（已使用）- ResourceList.tsx:153
<input
  type="checkbox"
  className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
/>

// ✅ Text Input（通用模式）
<input
  type="text"
  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
  placeholder="输入内容..."
/>

// ✅ Textarea（通用模式）
<textarea
  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
  rows={4}
/>
```

#### 卡片与容器

```tsx
// ✅ 资源卡片（已使用）- ResourceList.tsx风格
<div className="group relative cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md">
  {/* 卡片内容 */}
</div>

// ✅ 工具栏（已使用）- ResourceList.tsx:147
<div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
  {/* 工具栏内容 */}
</div>

// ✅ 面板容器（已使用）- WorkspaceLayout.tsx:68
<div className="relative flex-shrink-0 border-r border-gray-200 bg-white">
  {/* 面板内容 */}
</div>
```

#### 状态指示器

```tsx
// ✅ 状态徽章（ResourceCard使用）
<div className="flex items-center space-x-1">
  <div className={`h-2 w-2 rounded-full ${
    status === 'collected' ? 'bg-green-500' :
    status === 'collecting' ? 'bg-yellow-500' :
    'bg-gray-400'
  }`} />
  <span className="text-xs text-gray-600">
    {statusText}
  </span>
</div>

// 🆕 进度条（新增组件应遵循此风格）
<div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
  <div
    className="h-full bg-blue-600 transition-all duration-300"
    style={{ width: `${progress}%` }}
  />
</div>

// 🆕 加载旋转器
<div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-blue-600" />
```

### 7.4 布局规范（当前实现）

```
┌──────────────────────────────────────────────────────────────┐
│ ✅ 当前实现（WorkspaceLayout.tsx）                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────┬──────────────────────────┬─────────────────┐   │
│ │ Left    │  Middle Panel            │  Right Panel    │   │
│ │ Sidebar │  (可调节 400-700px)      │  (flex-1)       │   │
│ │         │                          │                 │   │
│ │ 固定    │  ┌────────────────────┐  │  ┌───────────┐  │   │
│ │ 宽度    │  │ ResourceList       │  │  │ Document  │  │   │
│ │         │  │ (可折叠)           │  │  │ Editor    │  │   │
│ │ Explore │  └────────────────────┘  │  │           │  │   │
│ │ AI Offc │                          │  │ PPT/Doc   │  │   │
│ │ Setting │  ┌────────────────────┐  │  │ Preview   │  │   │
│ │         │  │ ChatPanel          │  │  │           │  │   │
│ │         │  │ (固定高度)         │  │  └───────────┘  │   │
│ │         │  └────────────────────┘  │                 │   │
│ │         │                          │  [可选]         │   │
│ │         │  [拖拽调节宽度]          │  TaskSidebar    │   │
│ └─────────┴──────────────────────────┴─────────────────┘   │
│                                                              │
│ bg-gray-50 (外层) | bg-white (面板) | border-gray-200      │
└──────────────────────────────────────────────────────────────┘
```

**关键布局参数（来自实际代码）**:

- Left Sidebar: 固定宽度，由Sidebar组件控制
- Middle Panel: 400px - 700px 可拖拽调节（WorkspaceLayout.tsx:68-75）
- Right Panel: flex-1 自适应剩余空间
- Task Sidebar: 384px 固定宽度（可选显示）
- 拖拽手柄: w-1 宽度，hover:bg-blue-500

### 7.5 交互模式（当前实现）

#### Hover 效果

```tsx
// ✅ 卡片悬停
hover:border-blue-300 hover:shadow-md

// ✅ 按钮悬停
hover:bg-blue-700 hover:shadow-xl hover:scale-105

// ✅ 图标按钮悬停
hover:bg-gray-200

// ✅ 文字悬停
hover:text-red-700
```

#### 过渡动画

```tsx
// ✅ 颜色过渡（最常用）
transition-colors

// ✅ 全属性过渡
transition-all

// ✅ 特定属性过渡
transition-shadow transition-transform

// ✅ 自定义时长
transition-all duration-300
```

#### 响应式间距

```tsx
// ✅ 水平间距
space-x-1 space-x-2 space-x-3 space-x-4

// ✅ 垂直间距
space-y-2 space-y-3 space-y-4

// ✅ 内边距
px-3 py-2  // 小
px-4 py-2  // 中
px-5 py-3  // 大

// ✅ 外边距
m-2 m-4 mt-4 mb-6
```

### 7.6 字体规范（当前实现）

```tsx
// ✅ 文字大小
text - xs; // 12px - 次要信息、标签
text - sm; // 14px - 正文、输入框
text - base; // 16px - 标题、强调
text - lg; // 18px - 大标题
text - xl; // 20px - 页面主标题

// ✅ 字重
font - normal; // 400 - 正文
font - medium; // 500 - 按钮、标签
font - semibold; // 600 - 小标题
font - bold; // 700 - 大标题

// ✅ 行高
leading - tight; // 紧凑
leading - normal; // 正常
leading - relaxed; // 宽松
```

### 7.7 阴影系统（当前实现）

```tsx
// ✅ 卡片阴影
shadow-sm    // 微阴影
shadow-md    // 中等阴影（hover状态）
shadow-lg    // 较大阴影（浮动按钮）
shadow-xl    // 最大阴影（hover强调）

// ✅ 使用场景
<div className="shadow-sm hover:shadow-md">  // 卡片
<button className="shadow-lg hover:shadow-xl"> // 浮动操作按钮
```

### 7.8 2.0新增组件设计指南

**所有2.0新增UI组件必须遵循以上规范**，具体包括：

1. **Multi-Agent进度显示**
   - 使用 `bg-gray-200` + `bg-blue-600` 进度条
   - 阶段文字使用 `text-sm text-gray-600`
   - 完成状态使用 `text-green-600`

2. **版本对比Diff视图**
   - 新增内容: `bg-green-50 border-l-4 border-green-500`
   - 删除内容: `bg-red-50 border-l-4 border-red-500`
   - 修改内容: `bg-yellow-50 border-l-4 border-yellow-500`

3. **Research Page结构化展示**
   - Section卡片: `border border-gray-200 rounded-lg p-4 bg-white`
   - 置信度徽章: `text-xs rounded-full px-2 py-1 bg-blue-100 text-blue-700`

4. **资源推荐卡片**
   - 基础样式继承ResourceCard
   - 推荐理由使用 `text-xs text-gray-500 italic`
   - 相关度分数使用 `text-sm font-semibold text-blue-600`

---

## 8. 实施路线图

> **重要更新**: 本节为原始规划（假设从零开始）。基于现有实现的**调整版路线图**请参见 **[§10.3 实施路线图（调整版）](#103-实施路线图调整版)**，该版本考虑了已完成的70%+功能，更符合实际情况。

---

### 8.1 原始规划（参考用）

以下为原始7阶段规划（假设从零开始，21周）。实际执行应参照§10.3的5阶段规划（13周）。

### Phase 1: 核心架构 (4周)

**目标: 建立Multi-Agent基础和基本文档生成**

**Week 1-2: Multi-Agent系统**

- [ ] Agent协调器实现
- [ ] Grok Agent集成（CoordinatorAgent, ResourceAnalysisAgent, VerificationAgent）
- [ ] ChatGPT Agent集成（ContentWritingAgent, VisualizationAgent）
- [ ] Agent通信协议
- [ ] 扩展接口设计（支持未来添加Claude、Gemini等）

**Week 3-4: 基础文档生成**

- [ ] PPT基础生成（使用默认模板）
- [ ] Doc基础生成
- [ ] Research Page MVP
- [ ] SSE流式生成
- [ ] 实时进度显示

**交付物:**

- ✅ Multi-Agent系统可工作
- ✅ 可生成基础PPT和Doc
- ✅ 实时进度反馈

---

### Phase 2: 资源管理与推荐 (3周)

**目标: 智能资源推荐系统**

**Week 5-6: 资源推荐引擎**

- [ ] URL智能检测（arXiv, GitHub, YouTube, DOI）
- [ ] 资源推荐算法（基于相关度）
- [ ] 推荐UI组件
- [ ] 用户导入决策流程

**Week 7: 相关资源发现**

- [ ] 基于内容的相似度计算
- [ ] 基于用户历史的推荐
- [ ] 推荐理由生成（AI解释）

**交付物:**

- ✅ URL粘贴 → 推荐 → 用户决策 → 导入流程
- ✅ 相关资源自动发现

---

### Phase 3: 版本管理与持续迭代 (4周)

**目标: 完整的版本控制和迭代编辑系统**

**Week 8-9: 版本管理**

- [ ] Git-like版本系统
- [ ] 版本快照存储
- [ ] 版本历史UI
- [ ] 版本对比（Diff）
- [ ] 版本回滚

**Week 10-11: 持续迭代**

- [ ] 文档丰富检测（新资源 → 建议更新）
- [ ] 增量更新（只更新相关章节）
- [ ] 缩略图生成与缓存
- [ ] 选中编辑（Slide/Chapter级别）
- [ ] AI辅助编辑（重新生成、扩展内容等）

**交付物:**

- ✅ 完整版本管理系统
- ✅ 支持长期迭代的文档
- ✅ 缩略图预览

---

### Phase 4: 模板系统 (3周)

**目标: 专业模板库和自定义能力**

**Week 12-13: 内置模板**

- [ ] 学术模板（会议演讲、文献综述、论文）
- [ ] 技术模板（技术分享、设计文档、代码审查）
- [ ] 模板应用引擎
- [ ] 模板预览

**Week 14: 自定义模板**

- [ ] 模板编辑器
- [ ] 模板保存/加载
- [ ] 模板分享（导入/导出）

**交付物:**

- ✅ 6-8个专业模板
- ✅ 用户可创建自定义模板

---

### Phase 5: 多格式导出 (2周)

**目标: 支持所有主流格式导出**

**Week 15-16: 导出功能**

- [ ] PPTX导出（pptxgenjs）
- [ ] DOCX导出（docx库）
- [ ] PDF导出（puppeteer）
- [ ] Markdown导出
- [ ] HTML导出（响应式）
- [ ] LaTeX导出（学术期刊）

**交付物:**

- ✅ 6种格式导出
- ✅ 保留样式和格式

---

### Phase 6: 优化与增强 (3周)

**目标: 性能优化和体验提升**

**Week 17: 性能优化**

- [ ] Agent并行执行优化
- [ ] 缓存策略（Agent结果缓存）
- [ ] 图片/缩略图压缩
- [ ] 数据库查询优化

**Week 18: 体验优化**

- [ ] 键盘快捷键
- [ ] 拖拽排序（Slides/Chapters）
- [ ] 批量操作
- [ ] 搜索功能（全文搜索）

**Week 19: 错误处理**

- [ ] 统一错误处理
- [ ] 友好错误提示
- [ ] 自动重试机制
- [ ] 离线支持（部分功能）

**交付物:**

- ✅ 性能提升2-3x
- ✅ 更流畅的用户体验
- ✅ 健壮的错误处理

---

### Phase 7: Beta测试 (2周)

**Week 20-21: 内部测试与修复**

- [ ] 招募10-20个beta用户（研究生、技术leader）
- [ ] 收集反馈
- [ ] 修复关键bug
- [ ] 文档和教程

**交付物:**

- ✅ Beta版本
- ✅ 用户反馈报告
- ✅ Bug修复

---

### 总计: 21周 (约5个月)

**里程碑:**

- **M1 (Week 4):** 核心架构完成，可生成基础文档
- **M2 (Week 7):** 资源推荐系统上线
- **M3 (Week 11):** 版本管理和持续迭代完成
- **M4 (Week 14):** 模板系统上线
- **M5 (Week 16):** 多格式导出完成
- **M6 (Week 19):** 优化完成，准备Beta
- **M7 (Week 21):** Beta测试完成，准备发布

---

## 9. 成功指标

### 9.1 北极星指标

**每周生成的高质量文档数（Weekly Quality Documents Generated）**

定义：

- 质量文档 = 用户评分 ≥ 4星 且 使用时长 ≥ 10分钟 的文档
- 目标：Q1结束时达到 1000 documents/week

### 9.2 关键指标树

```
📈 Weekly Quality Documents
   │
   ├─ 📚 资源管理效率
   │  ├─ 新增资源数/周: 目标 5000+
   │  ├─ 推荐接受率: 目标 > 60%
   │  ├─ 资源质量分数: 目标 > 0.75
   │  └─ 导入错误率: 目标 < 2%
   │
   ├─ 🤖 AI生成效率
   │  ├─ 平均生成时间: 目标 < 15秒
   │  ├─ 生成成功率: 目标 > 95%
   │  ├─ 平均置信度: 目标 > 0.85
   │  └─ 用户满意度(👍/👎): 目标 > 80%
   │
   ├─ 📝 持续迭代使用
   │  ├─ 平均版本数/文档: 目标 > 3
   │  ├─ 文档编辑次数/周: 目标 > 2
   │  ├─ 资源丰富采用率: 目标 > 50%
   │  └─ 版本回滚率: 目标 < 10%
   │
   ├─ 🎨 模板使用
   │  ├─ 模板应用率: 目标 > 70%
   │  ├─ 自定义模板数: 目标 > 100
   │  └─ 模板满意度: 目标 > 4.0/5
   │
   └─ 📤 导出与分享
      ├─ 导出率: 目标 > 60%
      ├─ PPTX导出占比: 目标 > 40%
      ├─ PDF导出占比: 目标 > 30%
      └─ 分享率: 目标 > 20%
```

### 9.3 用户留存指标

- **Day 1留存:** 目标 > 60%
- **Week 1留存:** 目标 > 40%
- **Month 1留存:** 目标 > 25%

### 9.4 性能指标

- **文档生成时间 (P50):** < 10秒
- **文档生成时间 (P95):** < 20秒
- **API响应时间 (P95):** < 200ms
- **页面加载时间:** < 2秒

---

## 10. 基于现有实现的2.0升级总结

### 10.1 现有实现概览（已完成的功能）

AI Office当前已经具备完整的核心功能，这是2.0升级的坚实基础：

#### ✅ 完整实现的模块（保留）

**1. 三栏布局系统**（WorkspaceLayout.tsx）

- 左侧：全局Sidebar（导航）
- 中间：MiddlePanel（资源列表 + ChatPanel）
  - 可折叠资源列表
  - 拖拽调节宽度（400-700px）
- 右侧：RightPanel（DocumentEditor）
- 可选：TaskList侧边栏（固定384px）

**2. 资源管理系统**（ResourceList.tsx + useResourceStore）

- ✅ 从Explore页面添加资源
- ✅ \_id去重检查
- ✅ 单选/全选/批量删除
- ✅ LocalStorage持久化
- ✅ 状态管理（Zustand）

**3. AI交互系统**（ChatPanel.tsx - 1615行）

- ✅ 意图识别（PPT/Word/更新）
- ✅ @资源引用系统（@all / @资源名）
- ✅ 流式处理（SSE）
- ✅ 局部更新（"更新第1-3页"）
- ✅ 文档创建决策
- ✅ 对话历史保存

**4. 文档编辑系统**（DocumentEditor.tsx）

- ✅ PPT功能
  - 5种主题模板（Corporate/Minimal/Modern/Creative/Academic）
  - 6种智能可视化（FLOW/CHART:line/pie/bar/radar/MATRIX）
  - 幻灯片导航与缩略图
  - 局部更新（指定页面）
- ✅ 自动保存（防抖1000ms）
- ✅ 实时预览
- ✅ 多格式导出（PPTX/DOCX/PDF/Markdown）

**5. 版本管理系统**（VersionHistory.tsx + useDocumentStore）

- ✅ 自动版本快照（ai_generation/user_edit/manual_save）
- ✅ 版本历史查看
- ✅ 版本恢复
- ✅ 版本删除
- ✅ 触发源记录

**6. 任务管理系统**（TaskList.tsx + useTaskStore）

- ✅ 任务自动创建
- ✅ 完整上下文保存（资源+文档+对话+版本）
- ✅ 任务恢复（完整状态恢复）
- ✅ 任务列表侧边栏
- ✅ 任务计数徽章

**7. 可视化系统**（EnhancedSlideRenderer.tsx）

- ✅ ChartRenderer（Recharts）
- ✅ FlowDiagram（SVG）
- ✅ MatrixLayout（四象限）
- ✅ 幻灯片类型识别
- ✅ 模板系统（5种PPT模板）

---

### 10.2 2.0升级重点（增强功能）

基于现有实现，2.0版本聚焦以下增强：

#### 🆕 优先级P0（立即实施）

**1. Multi-Agent编排系统**

- 在现有ChatPanel基础上添加Agent层
- 不改变现有的意图识别和流式处理
- 实现方式：

  ```typescript
  // 在handleSend()中插入
  // 1. 现有流程保留
  const isPPTRequest = /ppt/.test(userInput); // ✅ 保留
  const mentionedResources = parseMentions(userInput); // ✅ 保留

  // 2. 新增Agent预处理
  if (isComplexTask) {
    const analysis = await resourceAnalysisAgent.analyze(resources);
    enhancedPrompt += analysis; // 注入分析结果
  }

  // 3. 现有流式生成
  const response = await fetch("/api/ai-office/chat", {
    message: enhancedPrompt, // ✅ 使用增强Prompt
  }); // ✅ 保留

  // 4. 新增Agent后处理
  const verified = await verificationAgent.verify(aiContent);
  updateDocument({ metadata: { verificationResult: verified } });
  ```

**2. AI过程透明化**

- 在现有GenerationProgress基础上增强
- 显示Agent工作状态
- 实现方式：
  ```tsx
  // 扩展现有GenerationSteps
  {phase: 'analyzing', agent: 'grok', status: 'in-progress', details: '正在分析论文核心观点'}
  {phase: 'generating', agent: 'chatgpt', status: 'in-progress', details: '正在生成Slide 3'}
  {phase: 'verifying', agent: 'grok', status: 'in-progress', details: '正在验证事实'}
  ```

**3. 相关资源推荐**

- 在ChatPanel中集成推荐卡片
- 不改变现有的资源添加流程
- 实现方式：

  ```tsx
  // ChatPanel中新增
  useEffect(() => {
    if (currentDocument) {
      const recommendations = await recommendRelatedResources({
        documentContent: currentDocument.content.markdown,
        existingResources: resources,
      });
      setRecommendations(recommendations);
    }
  }, [currentDocument]);

  // UI中显示
  {
    recommendations.length > 0 && (
      <RecommendationPanel>
        {recommendations.map((rec) => (
          <RecommendationCard
            resource={rec}
            onAccept={() => addResource(rec)} // 使用现有addResource
          />
        ))}
      </RecommendationPanel>
    );
  }
  ```

#### 🆕 优先级P1（近期实施）

**4. 版本对比（Diff）功能**

- 扩展现有VersionHistory组件
- 实现方式：

  ```tsx
  // VersionHistory.tsx中新增
  <Button onClick={() => compareVersions(v1, v2)}>对比版本</Button>

  // 新组件 VersionComparison.tsx
  <VersionComparison
    oldVersion={v1}
    newVersion={v2}
    changes={calculateDiff(v1, v2)}
  />
  ```

**5. Slide级别选中编辑**

- 在现有DocumentEditor基础上增强
- 实现方式：

  ```tsx
  // DocumentEditor.tsx中新增
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number | null>(
    null,
  );

  // 点击缩略图
  <Thumbnail
    onClick={() => {
      setSelectedSlideIndex(index);
      setEditMode("slide"); // 新增编辑模式
    }}
  />;

  // 编辑面板
  {
    editMode === "slide" && (
      <SlideEditPanel
        slide={slides[selectedSlideIndex]}
        onUpdate={(updated) => updateSlide(selectedSlideIndex, updated)}
        onRegenerate={() => regenerateSlide(selectedSlideIndex)}
      />
    );
  }
  ```

**6. Research Page格式**

- 作为新的文档类型添加
- 基于现有Document数据模型扩展
- 实现方式：

  ```typescript
  // types/ai-office.ts中新增
  export type DocumentType = 'ppt' | 'article' | 'research-page'; // 新增research-page

  interface ResearchPageContent {
    sections: {
      summary: {...},
      keyFindings: [...],
      visualInsights: {...},
      deepDive: {...},
      actionableInsights: {...}
    };
  }
  ```

**7. 模板库扩展**

- 基于现有5种PPT模板
- 新增科研/技术模板
- 实现方式：

  ```typescript
  // lib/ppt-templates.ts中扩展
  export const TEMPLATES = {
    ...EXISTING_TEMPLATES, // 保留现有5种

    // 新增科研模板
    'academic-conference': {...},
    'literature-review': {...},

    // 新增技术模板
    'tech-talk': {...},
    'design-doc': {...},
  };
  ```

#### 🆕 优先级P2（长期规划）

**8. 模板编辑器**

- 允许用户自定义模板
- 新增独立页面

**9. 资源分类与标签**

- 扩展Resource数据模型
- 在ResourceList中添加过滤功能

**10. HTML/LaTeX导出**

- 扩展现有导出API
- 添加新的导出格式

---

### 10.3 实施路线图（调整版）

基于现有实现，2.0升级采用"增强而非重构"策略：

#### Phase 1: Multi-Agent核心（4周）

**Week 1-2: Agent基础架构**

- [ ] 创建Multi-Agent协调层（不影响现有ChatPanel）
- [ ] 实现CoordinatorAgent（Grok）
- [ ] 实现ResourceAnalysisAgent（Grok）
- [ ] 实现VerificationAgent（Grok）
- [ ] 在ChatPanel中集成Agent预处理

**Week 3-4: AI过程透明化**

- [ ] 扩展现有GenerationSteps数据结构
- [ ] 在ChatPanel中添加Agent状态显示
- [ ] 实时显示Agent工作进度
- [ ] 添加置信度标记UI

**交付物：**

- ✅ Multi-Agent系统可工作
- ✅ AI过程可视化
- ✅ 不破坏现有功能

---

#### Phase 2: 编辑增强（3周）

**Week 5-6: 版本对比与Slide编辑**

- [ ] 实现版本Diff算法
- [ ] 创建VersionComparison组件
- [ ] 实现Slide级别选中编辑
- [ ] 添加SlideEditPanel组件

**Week 7: 资源推荐**

- [ ] 实现相关资源推荐算法
- [ ] 在ChatPanel中集成推荐卡片
- [ ] 实现推荐接受/拒绝逻辑

**交付物：**

- ✅ 版本对比功能
- ✅ Slide选中编辑
- ✅ 资源推荐系统

---

#### Phase 3: 模板与导出（2周）

**Week 8-9: 模板库扩展**

- [ ] 添加4-6个科研/技术模板
- [ ] 实现模板预览
- [ ] （可选）模板编辑器MVP

**交付物：**

- ✅ 10+专业模板
- ✅ 模板预览功能

---

#### Phase 4: Research Page（2周）

**Week 10-11: Research Page格式**

- [ ] 扩展Document类型
- [ ] 实现ResearchPageRenderer组件
- [ ] 实现一键转换（Research Page → PPT/Doc）

**交付物：**

- ✅ Research Page功能
- ✅ 多格式转换

---

#### Phase 5: 优化与测试（2周）

**Week 12-13: 性能优化与Bug修复**

- [ ] 性能优化（Agent并行、缓存）
- [ ] 错误处理完善
- [ ] 用户测试与反馈
- [ ] Bug修复

**交付物：**

- ✅ 稳定的2.0版本
- ✅ 用户反馈报告

---

**总计：13周（约3个月）**

**里程碑：**

- **M1 (Week 4):** Multi-Agent系统上线
- **M2 (Week 7):** 编辑增强完成
- **M3 (Week 9):** 模板库扩展完成
- **M4 (Week 11):** Research Page上线
- **M5 (Week 13):** 2.0正式发布

---

### 10.4 不需要改动的部分（保留现有实现）

为了降低风险和工作量，以下部分**保持现有实现不变**：

1. ✅ **三栏布局**（WorkspaceLayout.tsx）- 功能完善，无需改动
2. ✅ **资源添加流程**（从Explore页面）- 用户习惯已形成
3. ✅ **ChatPanel核心逻辑**（意图识别、@引用、流式处理）- 稳定可靠
4. ✅ **DocumentEditor**（自动保存、实时预览）- 功能完整
5. ✅ **版本管理基础**（自动快照、恢复）- 已满足需求
6. ✅ **任务系统**（上下文保存、恢复）- 独特优势
7. ✅ **可视化系统**（6种类型）- 已经强大
8. ✅ **导出功能**（PPTX/DOCX/PDF/Markdown）- 功能完备
9. ✅ **状态管理**（Zustand Store）- 架构清晰
10. ✅ **持久化机制**（LocalStorage）- 满足当前需求

---

### 10.5 关键成功因素

**1. 渐进式增强**

- 每个新功能都基于现有实现
- 不破坏用户已习惯的工作流
- 可以逐步上线，降低风险

**2. 保持简洁**

- 不过度工程化
- 只添加真正有价值的功能
- 保持现有的优秀用户体验

**3. 充分测试**

- 每个Phase结束都进行用户测试
- 收集反馈，快速迭代
- 确保新功能不影响现有功能

**4. 文档完善**

- 更新用户文档
- 提供新功能教程
- 记录技术决策

---

## 11. 附录

### 10.1 技术栈总结

**Frontend:**

- Next.js 14
- React 18
- TypeScript
- Zustand (状态管理)
- TailwindCSS
- Recharts (图表)
- React Flow (流程图)
- Monaco Editor (代码编辑)

**Backend:**

- NestJS
- TypeScript
- PostgreSQL 16 (Prisma ORM + JSONB)
- Redis (缓存)

**AI/ML:**

- Grok API (xAI)
- ChatGPT API (OpenAI)
- 扩展接口支持：Claude API, Gemini API

**导出库:**

- pptxgenjs (PPTX)
- docx (DOCX)
- puppeteer (PDF)
- marked (Markdown → HTML)

**DevOps:**

- Docker
- GitHub Actions
- Vercel (Frontend部署)
- AWS/DigitalOcean (Backend部署)

### 10.2 API限制与成本估算

**AI API成本:**

| 操作     | 使用模型  | 平均Token | 成本/次   | 月成本(1000 docs) |
| -------- | --------- | --------- | --------- | ----------------- |
| 资源分析 | Grok      | 4000      | $0.02     | $20               |
| 内容生成 | ChatGPT-4 | 6000      | $0.12     | $120              |
| 可视化   | ChatGPT-4 | 2000      | $0.04     | $40               |
| 验证     | Grok      | 2000      | $0.01     | $10               |
| **总计** | -         | -         | **$0.19** | **$190**          |

**优化策略:**

- 缓存Agent结果（减少50%重复调用）
- 使用更便宜的模型处理简单任务
- 批量处理（减少API调用次数）

**预估月成本（1000个活跃用户）:**

- AI API: $200
- 服务器: $100
- 数据库: $50
- 存储: $30
- **总计: $380/月**

### 10.3 风险与缓解措施

| 风险           | 影响 | 概率 | 缓解措施                                                |
| -------------- | ---- | ---- | ------------------------------------------------------- |
| AI API不稳定   | 高   | 中   | • 实现重试机制<br>• 多模型备份<br>• 降级策略            |
| 生成质量不稳定 | 高   | 中   | • Multi-Agent交叉验证<br>• 用户反馈循环<br>• Prompt优化 |
| 性能问题       | 中   | 中   | • 缓存策略<br>• 异步处理<br>• CDN加速                   |
| 成本过高       | 中   | 低   | • 智能缓存<br>• 模型选择优化<br>• 用量监控              |
| 用户数据安全   | 高   | 低   | • 端到端加密<br>• 权限控制<br>• 定期审计                |

---

## 结语

AI Office 2.0 旨在成为科研和技术人员不可或缺的智能研究助手。通过 Multi-Agent 架构（Grok + ChatGPT）、智能资源推荐、持续迭代编辑、专业模板系统和多格式导出，我们为用户提供从文献到演讲的一站式解决方案。

**核心差异化:**

1. ✅ 聚焦科研/技术领域（垂直深耕）
2. ✅ Multi-Agent系统（质量与速度兼顾）
3. ✅ 持续迭代（支持长期演化）
4. ✅ 版本管理（Git-like体验）
5. ✅ 专业模板（学术/技术规范）
6. ✅ 用户控制（推荐不强制，透明可验证）

我们相信这将帮助研究人员和工程师将撰写报告的时间从数天缩短到数小时，让他们有更多时间专注于真正的研究和创新。

---

**文档版本:** 2.0
**最后更新:** 2025-11-17
**下一步:** 开始Phase 1实施 ✨
