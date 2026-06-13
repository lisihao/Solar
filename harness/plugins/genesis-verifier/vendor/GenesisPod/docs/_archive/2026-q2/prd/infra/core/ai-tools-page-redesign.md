# AI Tools 管理页面重构 PRD

## 文档信息

- 版本: 1.0
- 作者: PM Agent
- 创建日期: 2026-01-21
- 状态: 草稿

---

## 1. 概述

### 1.1 背景

当前 AI Tools 管理页面存在以下问题：

1. **TAB 结构冗余**：存在 "AI Capabilities" 和 "Other Tools" 两个 TAB，功能重叠，用户困惑
2. **开关功能失效**：YouTube 字幕和语音合成的开关无法开启（tool ID 不匹配）
3. **UI 不统一**：政策研究工具没有使用折叠卡片形式，与其他能力的展示风格不一致
4. **命名不清晰**：TAB 名称 "AI Capabilities" 不够直观

### 1.2 目标

1. 合并为单一 "AI Tools" TAB，简化用户体验
2. 修复 YouTube 字幕和语音合成的开关问题
3. 统一所有工具类型的展示样式（使用折叠卡片）
4. 保持 MCP Servers TAB 独立（因为这是完全不同类型的配置）

### 1.3 非目标

- 本次不涉及 MCP Servers TAB 的改动
- 不改变后端 API 结构
- 不新增工具类型

---

## 2. 问题分析

### 2.1 当前代码结构

```
frontend/components/admin/
  ToolsManagement.tsx           # 主组件，管理三个 TAB
  tools/
    CapabilitiesTab.tsx         # AI Capabilities TAB
    BuiltinToolsTab.tsx         # Other Tools TAB
    MCPMarketplaceTab.tsx       # MCP Servers TAB
    UnifiedCapabilityCard.tsx   # 能力卡片组件
    capability-mapping.ts       # 能力与 Provider 的映射定义
    ConfigureModal.tsx          # 配置弹窗
```

### 2.2 Tool ID 不匹配问题分析

**前端 capability-mapping.ts 定义：**

| 前端 Capability ID   | 前端 Provider ID          | 说明             |
| -------------------- | ------------------------- | ---------------- |
| `youtube-transcript` | `supadata`                | YouTube 字幕能力 |
| `audio-generation`   | `elevenlabs`, `googleTts` | 语音合成能力     |

**后端 tools.provider.ts 定义：**

| 后端 Tool ID         | 说明                |
| -------------------- | ------------------- |
| `audio-generation`   | 语音合成工具 (存在) |
| `youtube-transcript` | **不存在**          |

**问题根因：**

1. **YouTube 字幕**：前端定义了 `youtube-transcript` 作为能力 ID，但后端没有注册这个工具 ID。后端只有 `supadata` 作为 Provider，但 Provider 不是 Tool。
   - 当用户点击开关时，前端发送 `PATCH /admin/ai/tools/youtube-transcript`
   - 后端 `updateToolConfig` 方法尝试查找 toolId=`youtube-transcript` 但找不到

2. **语音合成**：前端定义的 `audio-generation` ID 与后端匹配，但开关逻辑依赖于 `builtinTools` 数组
   - `builtinTools` 只包含 category 在 `['information', 'content', 'data', 'code', 'integration', 'memory', 'export', 'collaboration']` 中的工具
   - `audio-generation` 的 category 是 `generation`，不在上述列表中
   - 因此 `builtinTools.find(t => t.id === 'audio-generation')` 返回 undefined

### 2.3 Other Tools TAB 冗余分析

当前 "Other Tools" TAB (BuiltinToolsTab.tsx) 显示的工具类别：

- `information`, `content`, `data`, `code`, `integration`, `memory`, `export`, `collaboration`

而 "AI Capabilities" TAB (CapabilitiesTab.tsx) 已经覆盖了：

- 搜索、提取、生成等能力

两个 TAB 存在功能重叠且分类标准不一致，造成用户困惑。

---

## 3. 解决方案

### 3.1 TAB 结构调整

**改动前：**

```
[AI Capabilities] [Other Tools] [MCP Servers]
```

**改动后：**

```
[AI Tools] [MCP Servers]
```

### 3.2 Tool ID 匹配修复

#### 方案 A：前端适配后端 (推荐)

修改前端 `capability-mapping.ts`，确保 capability ID 与后端工具 ID 匹配：

| 修改项                     | 当前值               | 修改为                               | 说明                       |
| -------------------------- | -------------------- | ------------------------------------ | -------------------------- |
| YouTube 字幕 Capability ID | `youtube-transcript` | 创建后端工具或使用 Provider 级别开关 | 需评估                     |
| 语音合成                   | `audio-generation`   | 保持不变，修改过滤逻辑               | 添加 `generation` category |

#### 方案 B：后端适配前端

在后端注册 `youtube-transcript` 工具。但这需要更多后端改动，不推荐本次迭代实现。

**本次采用方案 A**

### 3.3 UI 统一方案

将所有工具类型统一使用 `UnifiedCapabilityCard` 组件展示，包括：

1. **有 Provider 的能力**（网络搜索、网页抓取、语音合成、YouTube 字幕）
2. **独立工具**（政策研究工具：联邦公报、国会立法、白宫新闻）
3. **内置工具**（数据分析、文件处理等）

---

## 4. 详细设计

### 4.1 新的工具分类体系

将所有工具按以下类别展示：

| 类别 ID       | 类别名称   | 包含工具                               |
| ------------- | ---------- | -------------------------------------- |
| `search`      | 搜索与获取 | 网络搜索、网页抓取、YouTube 字幕       |
| `generation`  | 内容生成   | 语音合成、图像生成、文本生成、视频生成 |
| `processing`  | 数据处理   | 数据分析、数据验证、文件转换           |
| `memory`      | 知识与记忆 | 知识库、实体记忆、用户偏好             |
| `integration` | 外部集成   | 邮件、云存储、GitHub、消息推送         |
| `export`      | 导出       | PDF、DOCX、PPTX、图片                  |
| `policy`      | 政策研究   | 联邦公报、国会立法、白宫新闻           |

### 4.2 组件修改方案

#### 4.2.1 capability-mapping.ts 修改

**新增政策研究工具到 CAPABILITY_DEFINITIONS：**

```typescript
// 将 STANDALONE_TOOLS 转换为统一格式
{
  id: 'policy-research',  // 虚拟能力 ID，用于分组
  name: 'policy-research',
  displayName: '政策研究',
  description: '获取美国政府政策、法规和新闻',
  icon: 'Landmark',
  category: 'policy',
  providers: [
    {
      id: 'federal-register',
      name: '联邦公报',
      description: '搜索美国联邦公报，获取行政命令、法规和通知',
      url: 'https://www.federalregister.gov',
      noKeyRequired: true,
    },
    {
      id: 'congress-gov',
      name: '国会立法',
      description: '搜索美国国会立法，获取法案和投票记录',
      url: 'https://api.congress.gov',
      freeQuota: '5,000 requests/hour',
      secretKeyName: 'CONGRESS_GOV_API_KEY',
    },
    {
      id: 'whitehouse-news',
      name: '白宫新闻',
      description: '获取白宫新闻发布和声明',
      url: 'https://www.whitehouse.gov/news',
      noKeyRequired: true,
    },
  ],
}
```

**修复 YouTube 字幕能力 ID：**

由于后端没有 `youtube-transcript` 工具，有两个选择：

1. **选择 1**：移除能力级别的开关，只保留 Provider 级别配置
2. **选择 2**：将 `youtube-transcript` 映射到 `web-scraper` 工具（因为 YouTube 字幕实际是内容提取的一种）

**推荐选择 2**，将 YouTube 字幕归类到"内容提取"类别下，与 web-scraper 共享开关逻辑。

#### 4.2.2 CapabilitiesTab.tsx 修改

1. 移除 `STANDALONE_TOOLS` 的单独渲染逻辑
2. 添加 `policy` 类别的支持
3. 修改 `builtinTools` 过滤逻辑，包含 `generation` 类别

```typescript
// 修改前
const builtinCategories = [
  "information",
  "content",
  "data",
  "code",
  "integration",
  "memory",
  "export",
  "collaboration",
];

// 修改后
const builtinCategories = [
  "information",
  "content",
  "data",
  "code",
  "integration",
  "memory",
  "export",
  "collaboration",
  "generation", // 添加 generation 类别
];
```

#### 4.2.3 ToolsManagement.tsx 修改

1. 移除 `other-tools` TAB
2. 将 TAB 名称从 "AI Capabilities" 改为 "AI Tools"
3. 合并 `CapabilitiesTab` 和 `BuiltinToolsTab` 的功能

```typescript
// 修改前
type TabType = "capabilities" | "other-tools" | "mcp";

// 修改后
type TabType = "ai-tools" | "mcp";
```

#### 4.2.4 i18n 翻译更新

```json
{
  "admin.tools.tabs.aiTools": "AI Tools",
  "admin.tools.tabs.mcp": "MCP Servers",
  "admin.tools.categories.policy": "政策研究"
}
```

### 4.3 UI 设计说明

#### 4.3.1 统一的折叠卡片样式

所有工具类型使用 `UnifiedCapabilityCard` 组件：

```
+--------------------------------------------------+
| [Icon] 工具名称            [状态标签] [开关]     |
|        工具描述                      [展开按钮]  |
+--------------------------------------------------+
| (展开后显示 Providers 列表)                      |
| +----------------------------------------------+ |
| | [状态] Provider 名称 [Free/Active] [配置按钮]| |
| +----------------------------------------------+ |
+--------------------------------------------------+
```

#### 4.3.2 工具状态显示

| 状态            | 显示样式                                     |
| --------------- | -------------------------------------------- |
| 已启用 + 已配置 | 绿色边框，绿色图标，显示 "Ready" 标签        |
| 已启用 + 未配置 | 黄色边框，黄色图标，显示 "Needs Config" 标签 |
| 未启用          | 灰色边框，灰色图标，无标签                   |

#### 4.3.3 分类展示顺序

1. 搜索与获取 (Search)
2. 内容生成 (Generation)
3. 数据处理 (Processing)
4. 知识与记忆 (Memory)
5. 外部集成 (Integration)
6. 导出 (Export)
7. 政策研究 (Policy)

---

## 5. 任务拆分

| ID    | 任务                       | 类型 | 预估  | 依赖         | 说明                                    |
| ----- | -------------------------- | ---- | ----- | ------------ | --------------------------------------- |
| T-001 | 修改 capability-mapping.ts | 前端 | 0.5d  | -            | 添加 policy 类别，合并 STANDALONE_TOOLS |
| T-002 | 修复工具类别过滤逻辑       | 前端 | 0.5d  | T-001        | 添加 generation 到 builtinCategories    |
| T-003 | 修改 CapabilitiesTab.tsx   | 前端 | 0.5d  | T-001        | 移除 STANDALONE_TOOLS 单独渲染          |
| T-004 | 修改 ToolsManagement.tsx   | 前端 | 0.5d  | T-002, T-003 | 合并 TAB，更新命名                      |
| T-005 | 更新 i18n 翻译             | 前端 | 0.25d | T-004        | 添加新的翻译键                          |
| T-006 | 删除 BuiltinToolsTab.tsx   | 前端 | 0.25d | T-004        | 移除冗余组件                            |
| T-007 | 端到端测试                 | 测试 | 0.5d  | T-006        | 验证所有工具开关功能                    |

**总预估**：3 天

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 页面只显示两个 TAB："AI Tools" 和 "MCP Servers"
- [ ] 所有工具类型使用统一的折叠卡片样式
- [ ] 政策研究工具以折叠卡片形式展示
- [ ] YouTube 字幕开关可以正常开启/关闭
- [ ] 语音合成开关可以正常开启/关闭
- [ ] 所有其他工具开关功能正常

### 6.2 UI 验收

- [ ] 工具按类别分组展示
- [ ] 每个类别有清晰的标题
- [ ] 折叠/展开动画流畅
- [ ] 状态标签颜色正确
- [ ] 响应式布局在移动端正常显示

### 6.3 兼容性验收

- [ ] Chrome, Firefox, Safari 最新版正常
- [ ] 移动端响应式正常

---

## 7. 风险与依赖

### 7.1 风险

| 风险                         | 影响 | 缓解措施                |
| ---------------------------- | ---- | ----------------------- |
| 工具 ID 映射错误导致功能失效 | 高   | 全面测试所有工具开关    |
| i18n 缺失导致显示问题        | 中   | 添加完整的翻译 fallback |

### 7.2 依赖

| 依赖项                     | 状态   | 说明         |
| -------------------------- | ------ | ------------ |
| 后端 AI Admin API          | 已就绪 | 无需修改     |
| UnifiedCapabilityCard 组件 | 已就绪 | 复用现有组件 |

---

## 8. 附录

### 8.1 相关文件

| 文件         | 路径                                                        | 说明     |
| ------------ | ----------------------------------------------------------- | -------- |
| 主组件       | `frontend/components/admin/ToolsManagement.tsx`             | TAB 管理 |
| 能力定义     | `frontend/components/admin/tools/capability-mapping.ts`     | 工具映射 |
| 能力 TAB     | `frontend/components/admin/tools/CapabilitiesTab.tsx`       | 需修改   |
| 能力卡片     | `frontend/components/admin/tools/UnifiedCapabilityCard.tsx` | 复用     |
| 内置工具 TAB | `frontend/components/admin/tools/BuiltinToolsTab.tsx`       | 将删除   |
| 后端工具注册 | `backend/src/modules/ai-engine/tools/tools.provider.ts`     | 参考     |

### 8.2 后端工具 ID 完整列表

```
Information: web-search, web-scraper, data-fetch, rag-search, database-query,
             knowledge-graph, federal-register, congress-gov, whitehouse-news
Generation:  text-generation, image-generation, code-generation, audio-generation,
             video-generation, structured-output
Processing:  data-analysis, data-validation, data-cleaning, file-parser,
             file-conversion, document-diff, template-render
Execution:   python-executor, javascript-executor, sql-executor, shell-executor,
             container-executor, ocr-recognition
Integration: message-push, cloud-storage, github-integration, email-sender,
             calendar-integration, webhook-trigger
Memory:      short-term-memory, long-term-memory, entity-memory, knowledge-base,
             user-preferences
Export:      export-pptx, export-docx, export-pdf, export-image
Collaboration: agent-handoff, human-approval, agent-communication, task-delegation,
               consensus-mechanism, workflow-orchestration
```

### 8.3 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2026-01-21 | 初始版本 | PM Agent |

---

**最后更新**: 2026-01-21
