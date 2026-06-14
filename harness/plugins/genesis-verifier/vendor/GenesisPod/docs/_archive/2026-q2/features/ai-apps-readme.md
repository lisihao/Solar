# AI Apps - 应用模块总览

> GenesisPod 的九大 AI 应用模块，覆盖问答、研究、创作、编程、模拟等全方位场景

**最后更新**: 2026-01-15
**版本**: v2.0

---

## 模块索引

| 模块                                         | 代码目录            | 文档                                         | 说明                                | 状态      |
| -------------------------------------------- | ------------------- | -------------------------------------------- | ----------------------------------- | --------- |
| [AI Ask](ai-ask/readme.md)                   | `ai-app/ask`        | [readme.md](ai-ask/readme.md)                | 智能问答 + RAG 知识库               | ✅ 生产   |
| [AI Studio](ai-studio/readme.md)             | `ai-app/research`   | [readme.md](ai-studio/readme.md)             | 三种研究模式（Topic/Deep/Notebook） | ✅ 生产   |
| [AI Teams](ai-teams/readme.md)               | `ai-app/teams`      | [readme.md](ai-teams/readme.md)              | 多 Agent 协作辩论                   | ✅ 生产   |
| [AI Office](ai-office/readme.md)             | `ai-app/office`     | [多篇文档](ai-office/)                       | PPT/文档生成                        | ✅ 生产   |
| [AI Coding](ai-coding/ai-coding-overview.md) | `ai-app/coding`     | [readme.md](ai-coding/ai-coding-overview.md) | 多 Agent 代码生成                   | ✅ 生产   |
| [AI Writing](ai-writing/readme.md)           | `ai-app/writing`    | [readme.md](ai-writing/readme.md)            | 长篇小说创作                        | 🚧 开发中 |
| [AI Simulation](ai-simulation/readme.md)     | `ai-app/simulation` | [readme.md](ai-simulation/readme.md)         | 商业博弈模拟                        | ✅ 生产   |
| [AI Image](ai-image/readme.md)               | `ai-app/image`      | [readme.md](ai-image/readme.md)              | 图像生成和品牌管理                  | ✅ 生产   |
| [RAG](rag/readme.md)                         | `ai-app/rag`        | [readme.md](rag/readme.md)                   | 知识库管理和检索                    | ✅ 生产   |

---

## 模块分类

### 💬 对话与问答

#### AI Ask

- **定位**: ChatGPT 式智能问答
- **特色**: 多模型支持 + RAG 知识库 + 工具调用
- **适用**: 日常问答、知识库查询、项目咨询
- **时长**: 秒级

**快速开始**:

```bash
# 创建会话并提问
curl -X POST /api/v1/ai-ask/sessions -d '{"title": "测试会话"}'
curl -X POST /api/v1/ai-ask/sessions/SESSION_ID/messages \
  -d '{"content": "你好，请介绍一下 GenesisPod"}'
```

---

### 🔬 研究与分析

#### AI Studio

- **定位**: 深度研究工作室
- **特色**: 三种研究模式（Topic/Deep/Notebook）
- **适用**: 市场调研、学术研究、技术分析
- **时长**: 分钟级到小时级

**研究模式对比**:
| 模式 | 时长 | 适用场景 |
|------|------|---------|
| Topic Research | 2-5 分钟 | 快速了解某个主题 |
| Deep Research | 10-60 分钟 | 深入研究复杂问题 |
| Notebook Research | 1-3 分钟 | 基于文档的研究 |

**快速开始**:

```bash
# Topic Research
curl -X POST /api/v1/research/topics \
  -d '{
    "name": "AI 伦理",
    "dimensions": ["技术发展", "伦理挑战", "监管政策"]
  }'
```

#### AI Teams

- **定位**: 多视角辩论和团队协作
- **特色**: 红蓝对抗、任务编排、实时协作
- **适用**: 方案评估、头脑风暴、决策支持
- **时长**: 分钟级

**快速开始**:

```bash
# 创建话题并邀请 Agent 辩论
curl -X POST /api/v1/ai-teams/topics \
  -d '{"name": "产品优先级讨论", "description": "讨论下个季度的功能优先级"}'
```

#### AI Simulation

- **定位**: 商业博弈模拟器
- **特色**: 红蓝对抗、多方博弈、视角切换
- **适用**: 战略推演、竞品分析、风险评估
- **时长**: 分钟级到小时级

**快速开始**:

```bash
# 创建竞争场景
curl -X POST /api/v1/ai-simulation/scenarios \
  -d '{
    "name": "电商大战",
    "industry": "E-commerce",
    "companies": [...],
    "agents": [...]
  }'
```

---

### ✍️ 内容创作

#### AI Writing

- **定位**: 长篇小说创作系统
- **特色**: Story Bible + 一致性引擎 + 并行写作
- **适用**: 小说、剧本、长篇内容创作
- **状态**: 🚧 开发中

**核心理念**:

```
Story Bible（设定圣经）
    ↓
Consistency Engine（一致性引擎）
    ↓
Parallel Writing（并行写作）
```

#### AI Office

- **定位**: AI 办公套件
- **特色**: PPT 生成、文档生成、模板系统
- **适用**: 商业演示、报告生成、文档制作
- **时长**: 分钟级

**快速开始**:

```bash
# 生成 PPT
curl -X POST /api/v1/ai-office/slides/generate \
  -d '{
    "topic": "2026 年度总结",
    "pages": 15,
    "style": "business"
  }'
```

#### AI Image

- **定位**: 智能图像生成平台
- **特色**: 多模型支持 + 品牌套件 + 信息图生成
- **适用**: 营销素材、品牌设计、数据可视化
- **时长**: 秒级

**快速开始**:

```bash
# 生成图像
curl -X POST /api/v1/ai-image/generate \
  -d '{
    "prompt": "科技感的产品海报",
    "model": "imagen4",
    "brandKitId": "brand-xxx"
  }'
```

---

### 💻 编程与开发

#### AI Coding

- **定位**: 多 Agent 代码生成流水线
- **特色**: PM → Architect → Engineer → QA 协作
- **适用**: 项目生成、代码实现、原型开发
- **时长**: 分钟级到小时级

**Agent 流水线**:

```
PM Agent (需求分析)
    ↓
Architect Agent (系统设计)
    ↓
PM Lead Agent (任务分解)
    ↓
Engineer Agent (代码实现)
    ↓
QA Agent (质量保证)
```

**快速开始**:

```bash
# 创建项目
curl -X POST /api/v1/ai-coding/projects \
  -d '{
    "name": "Todo App",
    "description": "一个简单的待办事项应用",
    "techStack": {"frontend": "React", "backend": "Node.js"}
  }'
```

---

### 🗂️ 知识管理

#### RAG

- **定位**: 检索增强生成系统
- **特色**: 多源导入 + HyDE + Rerank
- **适用**: 知识库构建、文档问答、企业知识管理
- **集成**: 为 AI Ask、AI Teams 提供检索能力

**快速开始**:

```bash
# 创建知识库
curl -X POST /api/v1/rag/knowledge-bases \
  -d '{"name": "技术文档库"}'

# 上传文档
curl -X POST /api/v1/rag/knowledge-bases/KB_ID/documents/upload \
  -F "file=@document.pdf"

# RAG 查询
curl -X POST /api/v1/rag/query \
  -d '{
    "query": "如何配置数据库？",
    "knowledgeBaseIds": ["kb-xxx"],
    "options": {"topK": 5, "useRerank": true}
  }'
```

---

## 技术架构

### 统一底层：AI Engine

所有 AI Apps 都基于 **AI Engine** 提供的核心能力：

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Engine（核心能力层）                                         │
│  ├── LLM Factory: 多模型统一接口                                 │
│  ├── Image Factory: 图像生成接口                                │
│  ├── Tools Registry: 工具注册和调用                             │
│  ├── Agent Orchestration: Agent 编排                            │
│  └── Teams Collaboration: 团队协作机制                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  AI Apps（应用层）                                               │
│  Ask | Studio | Teams | Office | Coding | Writing | ...         │
└─────────────────────────────────────────────────────────────────┘
```

详细文档: [AI Engine 架构](../../architecture/ai-engine.md)

---

## 模块间协作

### 1. AI Ask + RAG

```
用户提问 → RAG 检索知识库 → 注入上下文 → AI Ask 回答
```

### 2. AI Teams + AI Studio

```
创建研究话题 → 邀请 Agent 团队 → 多视角辩论 → 生成研究报告
```

### 3. AI Office + AI Image

```
生成 PPT → 需要配图 → 调用 AI Image 生成 → 插入幻灯片
```

### 4. AI Coding + AI Teams

```
项目需求讨论（AI Teams） → 形成共识 → 启动代码生成（AI Coding）
```

---

## 使用场景示例

### 场景 1: 竞品分析报告

```
1. AI Studio (Topic Research)
   - 输入: "分析竞品 A、B、C"
   - 输出: 多维度分析报告

2. AI Teams
   - 创建话题: "竞品分析讨论"
   - 邀请 Agent: Marketing、Product、Tech
   - 输出: 多视角观点和共识

3. AI Office
   - 输入: 报告内容
   - 输出: 精美 PPT

4. AI Image
   - 生成: 对比图、信息图
   - 应用: 品牌套件
```

### 场景 2: 技术方案调研

```
1. RAG
   - 上传: 技术文档、论文
   - 构建: 技术知识库

2. AI Ask
   - 提问: "这几种方案的优劣势是什么？"
   - 检索: RAG 知识库
   - 回答: 基于文档的分析

3. AI Coding
   - 输入: 选定的技术方案
   - 输出: 原型代码
```

### 场景 3: 商业推演

```
1. AI Simulation
   - 创建: 市场竞争场景
   - 配置: 红蓝对抗 Agent
   - 运行: 5 回合推演
   - 输出: 策略建议

2. AI Office
   - 生成: 推演报告 PPT
   - 插入: 推演结果图表
```

---

## 开发路线图

### Q1 2026 (已完成)

- [x] AI Ask 基础功能
- [x] AI Studio Topic Research
- [x] AI Teams 基础协作
- [x] AI Office PPT 生成
- [x] AI Coding 流水线
- [x] AI Simulation 红蓝对抗
- [x] AI Image 基础生成
- [x] RAG 知识库系统

### Q2 2026 (进行中)

- [ ] AI Writing 完整实现
- [ ] AI Studio Deep Research 优化
- [ ] AI Teams Mission 增强
- [ ] AI Office 文档生成
- [ ] AI Coding GitHub 集成
- [ ] AI Simulation 多方博弈

### Q3 2026 (计划中)

- [ ] AI Apps 统一工作台
- [ ] 跨应用工作流编排
- [ ] 协作和分享增强
- [ ] 移动端支持
- [ ] 企业版功能

---

## 相关文档

- [AI Engine 架构](../../architecture/ai-engine.md)
- [项目规则](../../project-rules.md)
- [API 文档](../../api/readme.md)
- [部署指南](../../guides/deployment/readme.md)

---

## 贡献指南

### 添加新的 AI App

1. **代码模块**: 在 `backend/src/modules/ai-app/` 创建新目录
2. **文档**: 在 `docs/features/ai-apps/` 创建对应文档
3. **遵循规范**:
   - 使用 AI Engine 提供的能力
   - 遵循统一的 API 风格
   - 提供完整的文档
4. **更新索引**: 更新本文档的模块索引表

### 文档规范

- 文件名: `readme.md`（小写）
- 包含章节:
  - 概述
  - 系统架构
  - 功能模块
  - API 接口
  - 数据模型
  - 使用指南
  - 相关文档

详见: [文档专家 Agent 规范](../../.claude/agents/documentation-expert.md)

---

## 常见问题

### Q: 如何选择合适的 AI App？

**A**: 根据需求场景选择:

- 快速问答 → AI Ask
- 深度研究 → AI Studio
- 团队决策 → AI Teams
- 文档生成 → AI Office
- 代码生成 → AI Coding
- 战略推演 → AI Simulation
- 内容创作 → AI Writing
- 图像生成 → AI Image

### Q: 各模块如何收费？

**A**: 基于积分系统，不同操作消耗不同积分:

- 普通对话: 10 积分
- RAG 查询: 15 积分
- 深度研究: 50-200 积分
- 代码生成: 100-500 积分

详见: [积分系统说明](../../guides/credits-system.md)

### Q: 如何集成到自己的应用？

**A**: 所有模块提供 REST API 和 WebSocket API:

1. 注册账号获取 API Token
2. 参考各模块的 API 文档
3. 使用 SDK（可选）

---

**最后更新**: 2026-01-15
**维护者**: Genesis Team
