# 基础设施文档更新日志

## 2026-01-15 - 全面刷新基础设施文档 v2.0

### 更新概述

基于最新代码库（2026-01-15），全面刷新了基础设施架构文档，确保文档与实际实现 100% 一致。

### 主要更新

#### 1. 总览文档 (`readme.md`)

**更新内容：**

- ✅ 更新技术栈版本至最新（Next.js 14.2.35, React 18.3, TanStack Query 5.28 等）
- ✅ 添加完整的技术栈表格，包含 59+ 依赖库
- ✅ 新增 AI Engine 架构图，展示数据库驱动的模型配置
- ✅ 添加前后端模块结构树，展示 59 个独立模块
- ✅ 更新设计原则，强调 PostgreSQL-First 和数据库驱动 AI 配置
- ✅ 添加部署架构说明（Docker Compose + Railway）

**新增章节：**

- 数据库驱动的 AI 配置原则
- 模块化架构详细说明
- 前端架构完整结构
- 数据流架构示例
- 实时通讯架构说明

#### 2. AI 编排文档 (`ai-llm/ai-llm-orchestration.md`)

**重大更新：**

- ✅ **完全重写**，基于实际的 `AiChatService` 实现
- ✅ 新增 TaskProfile 语义化配置详细说明
- ✅ 添加数据库驱动的模型配置架构
- ✅ 新增 Model Fallback Service 自动降级机制
- ✅ 添加 LLM Adapters 统一接口说明
- ✅ 提供完整的使用指南和最佳实践

**新增核心概念：**

1. **TaskProfile 语义化配置**

   ```typescript
   taskProfile: {
     creativity: "low",      // 替代 temperature
     outputLength: "medium", // 替代 maxTokens
   }
   ```

2. **数据库驱动模型配置**
   - 所有模型配置存储在 `AIModel` 表
   - 支持动态启用/禁用模型
   - 支持自定义模型能力（推理模型、函数调用等）

3. **模型降级策略**
   - 同 Provider 降级：GPT-5.1 → GPT-4o
   - 跨 Provider 降级：OpenAI → Anthropic
   - 基于优先级自动选择降级路径

**实际代码映射：**

- `AiChatService.chat()` - 统一聊天接口
- `TaskProfileMapperService` - 参数映射服务
- `ModelFallbackService` - 降级服务
- `AIChatLLMAdapter` - LLM 适配器

#### 3. 前端状态管理文档 (`frontend/frontend-state-management.md`)

**更新内容：**

- ✅ 更新 Providers 配置为实际代码（包含 AuthProvider, I18nProvider）
- ✅ 添加真实的 Toast Store 实现（带便捷方法）
- ✅ 新增 AI Teams Store 示例
- ✅ 新增 Settings Store 持久化示例
- ✅ 更新 QueryClient 配置为实际使用的参数

**关键更新：**

1. **统一错误处理**

   ```typescript
   mutations: {
     onError: (error: Error) => {
       toast.error('Operation Failed', error.message);
     },
   }
   ```

2. **Toast 便捷方法**

   ```typescript
   export const toast = {
     success: (title, message?) => {...},
     error: (title, message?) => {...},
   };
   ```

3. **全局 Provider 结构**
   - QueryClientProvider → I18nProvider → AuthProvider
   - 全局组件：ToastContainer, CheckinModal, InsufficientCreditsModal

#### 4. 其他文档保持更新

**保持最新的文档：**

- ✅ `frontend/frontend-nextjs-react.md` - Next.js 14 核心原理
- ✅ `backend/backend-nestjs.md` - NestJS 框架原理
- ✅ `database/database-postgresql.md` - PostgreSQL 高级特性
- ✅ `realtime/realtime-sse.md` - SSE 实时通讯

### 技术栈版本快照（2026-01-15）

| 类别     | 技术           | 版本    |
| -------- | -------------- | ------- |
| 前端框架 | Next.js        | 14.2.35 |
| UI 库    | React          | 18.3.0  |
| 类型系统 | TypeScript     | 5.3.0   |
| 状态管理 | TanStack Query | 5.28.0  |
| 状态管理 | Zustand        | 4.5.0   |
| 后端框架 | NestJS         | 10.3.0  |
| ORM      | Prisma         | 5.10.0  |
| 数据库   | PostgreSQL     | 16      |
| 实时通讯 | Socket.io      | 4.8.1   |
| AI SDK   | OpenAI         | 6.14.0  |

### 架构关键变更

#### 从硬编码到数据库驱动

**之前（硬编码）：**

```typescript
// ❌ 硬编码模型配置
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  temperature: 0.7,
  max_tokens: 4000,
});
```

**现在（数据库驱动）：**

```typescript
// ✅ 数据库驱动 + TaskProfile
const response = await this.aiChatService.chat({
  model: "gpt-4o", // 从数据库读取配置
  messages: [...],
  taskProfile: {
    creativity: "medium",
    outputLength: "medium",
  },
});
```

#### 从单一模型到多模型降级

**新增能力：**

- 自动检测模型能力（推理模型、支持流式等）
- 自动降级到备用模型
- 跨 Provider 降级支持
- 统一的错误处理和重试机制

### 文档质量提升

#### 代码引用

所有代码示例都基于实际文件：

- `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`
- `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`
- `frontend/app/providers.tsx`
- `frontend/stores/toastStore.ts`

#### 最佳实践

每个文档都包含：

- ✅ 架构图和数据流图
- ✅ 实际代码示例
- ✅ 使用指南和最佳实践
- ✅ 错误处理示例
- ✅ 性能优化建议

### 未来计划

#### 待添加文档

1. **UI 组件库文档** (`frontend/frontend-ui-components.md`)
   - Radix UI 使用指南
   - Mantine 组件集成
   - TipTap 富文本编辑器
   - BlockNote 块状编辑器

2. **多模型架构文档** (`ai-llm/ai-llm-multi-model.md`)
   - OpenAI / Anthropic / Google / xAI 适配
   - 统一的 API 接口
   - 成本追踪和优化

3. **流式响应文档** (`ai-llm/ai-llm-streaming.md`)
   - SSE 流式输出实现
   - 前端流式渲染
   - 错误处理和重连

4. **数据采集文档** (`data-collection/`)
   - Puppeteer 爬虫实现
   - Cheerio HTML 解析
   - 数据源集成（arXiv, YouTube 等）

#### 文档维护策略

1. **代码变更时同步更新**
   - 模块重构时更新架构图
   - API 变更时更新示例代码
   - 新增功能时补充文档

2. **定期审查**
   - 每季度检查文档准确性
   - 验证代码示例可执行性
   - 更新技术栈版本信息

3. **社区贡献**
   - 欢迎提交文档改进 PR
   - 欢迎补充使用案例
   - 欢迎指出文档错误

### 贡献者

- **Claude Code (GenesisPod 文档专家 Agent)** - 主要编写和维护
- **GenesisPod Team** - 代码审查和技术指导

---

**文档版本**: v2.0
**更新日期**: 2026-01-15
**下次审查**: 2026-04-15
