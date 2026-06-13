# GenesisPod 全面测试方案

**制定日期**: 2026-02-06
**基准版本**: commit 33ae0e03 (main)
**测试框架**: Backend Jest 29.5 / Frontend Vitest 4.0.8
**参考基线**: comprehensive-combination-test-2026-01-25.md (已验证 19/19 通过)

---

## 目录

- [一、测试策略总览](#一测试策略总览)
- [二、功能测试（单模块全面覆盖）](#二功能测试单模块全面覆盖)
- [三、组合功能测试（跨模块 & 多维度组合）](#三组合功能测试跨模块--多维度组合)
- [四、性能测试（全面覆盖）](#四性能测试全面覆盖)
- [五、DFX 质量属性测试](#五dfx-质量属性测试)
- [六、业界最佳实践审视](#六业界最佳实践审视)
- [七、测试执行计划](#七测试执行计划)
- [八、验收标准与退出准则](#八验收标准与退出准则)

---

## 一、测试策略总览

### 1.1 覆盖维度矩阵

| 维度               | 描述                                   | 预估用例数 | 优先级 |
| ------------------ | -------------------------------------- | ---------- | ------ |
| **单功能测试**     | 每个模块每个 API/页面的基础验证        | ~220       | P0     |
| **组合功能测试**   | 同模块内功能排列组合                   | ~120       | P0     |
| **跨模块集成测试** | 模块间数据流和交互                     | ~60        | P0     |
| **端到端场景测试** | 真实用户完整业务流程                   | ~30        | P1     |
| **边界条件测试**   | 极端输入、空值、超大值、竞态           | ~50        | P1     |
| **性能基准测试**   | 响应时间、吞吐量、并发能力             | ~40        | P1     |
| **DFX 质量测试**   | 可用性/可靠性/安全性/可维护性/可观测性 | ~80        | P1     |
| **业界最佳实践**   | OWASP/WCAG/12-Factor/混沌工程          | ~30        | P2     |
| **总计**           |                                        | **~630**   |        |

### 1.2 测试分层策略

```
┌─────────────────────────────────────────────────┐
│  E2E 测试 (Playwright / Manual)  ~30 cases     │  ← 用户视角完整流程
├─────────────────────────────────────────────────┤
│  API 集成测试 (supertest)        ~60 cases     │  ← Controller→Service→DB 链路
├─────────────────────────────────────────────────┤
│  Service 单元测试 (Jest/Vitest)  ~400 cases    │  ← 核心业务逻辑
├─────────────────────────────────────────────────┤
│  组件/Hook 测试 (Vitest + RTL)   ~80 cases     │  ← 前端交互逻辑
├─────────────────────────────────────────────────┤
│  性能 & DFX 测试                  ~60 cases     │  ← 非功能质量属性
└─────────────────────────────────────────────────┘
```

### 1.3 测试环境

| 环境                  | 用途       | 数据库             | 配置               |
| --------------------- | ---------- | ------------------ | ------------------ |
| **Local Unit**        | 单元测试   | Mock / In-Memory   | `NODE_ENV=test`    |
| **Local Integration** | 集成测试   | 本地 PostgreSQL    | `test/.env.test`   |
| **Staging**           | E2E / 性能 | Railway PostgreSQL | Railway Preview    |
| **Production**        | 冒烟测试   | 生产数据库(只读)   | Railway Production |

---

## 二、功能测试（单模块全面覆盖）

### 2.1 AI Engine 核心层

#### 2.1.1 AiChatService（LLM 调用核心）

| 测试ID      | 测试项                       | 测试类型 | 预期结果                   | 优先级 |
| ----------- | ---------------------------- | -------- | -------------------------- | ------ |
| ENG-LLM-001 | chat() 基本调用 - 单轮对话   | Unit     | 返回完整响应               | P0     |
| ENG-LLM-002 | chat() 流式调用 - SSE 输出   | Unit     | 逐 chunk 返回              | P0     |
| ENG-LLM-003 | chat() + TaskProfile 映射    | Unit     | temperature/maxTokens 正确 | P0     |
| ENG-LLM-004 | chat() 模型降级 - 主模型失败 | Unit     | 自动切换备选模型           | P0     |
| ENG-LLM-005 | chat() 重试机制 - 429 限流   | Unit     | 指数退避重试               | P0     |
| ENG-LLM-006 | chat() 重试机制 - 500 错误   | Unit     | 最多重试3次                | P1     |
| ENG-LLM-007 | chat() 超时处理              | Unit     | 超时后返回错误             | P1     |
| ENG-LLM-008 | chat() 空 messages 参数      | Unit     | 抛出参数校验错误           | P1     |
| ENG-LLM-009 | chat() JSON 输出模式         | Unit     | 返回合法 JSON              | P1     |
| ENG-LLM-010 | chat() 多模型串行调用        | Unit     | 各自独立响应               | P2     |

#### 2.1.2 TaskProfileMapperService

| 测试ID      | 测试项                               | 测试类型 | 预期结果            | 优先级 |
| ----------- | ------------------------------------ | -------- | ------------------- | ------ |
| ENG-TPM-001 | creativity=deterministic → temp=0.1  | Unit     | 精确映射            | P0     |
| ENG-TPM-002 | creativity=low → temp=0.3            | Unit     | 精确映射            | P0     |
| ENG-TPM-003 | creativity=medium → temp=0.7         | Unit     | 精确映射            | P0     |
| ENG-TPM-004 | creativity=high → temp=0.9           | Unit     | 精确映射            | P0     |
| ENG-TPM-005 | outputLength=minimal → maxTokens=500 | Unit     | 精确映射            | P0     |
| ENG-TPM-006 | outputLength=short → maxTokens=1500  | Unit     | 精确映射            | P0     |
| ENG-TPM-007 | outputLength=medium → maxTokens=4000 | Unit     | 精确映射            | P0     |
| ENG-TPM-008 | outputLength=long → maxTokens=8000   | Unit     | 精确映射            | P0     |
| ENG-TPM-009 | reasoning 模型 token 计算            | Unit     | 特殊逻辑正确        | P0     |
| ENG-TPM-010 | 无 TaskProfile 时默认值              | Unit     | 使用合理默认        | P1     |
| ENG-TPM-011 | 无效 creativity 值                   | Unit     | 回退到默认          | P1     |
| ENG-TPM-012 | modelType 映射验证                   | Unit     | 各 AIModelType 正确 | P1     |

#### 2.1.3 ModelFallbackService

| 测试ID      | 测试项             | 测试类型 | 预期结果                   | 优先级 |
| ----------- | ------------------ | -------- | -------------------------- | ------ |
| ENG-MFB-001 | 获取降级模型列表   | Unit     | 返回有序备选               | P0     |
| ENG-MFB-002 | 主模型不可用时降级 | Unit     | 切换到下一优先级           | P0     |
| ENG-MFB-003 | 所有模型不可用     | Unit     | 抛出 NoAvailableModel 错误 | P0     |
| ENG-MFB-004 | 降级后恢复主模型   | Unit     | 熔断器恢复后重新启用       | P1     |

#### 2.1.4 CircuitBreakerService

| 测试ID     | 测试项                      | 测试类型 | 预期结果     | 优先级 |
| ---------- | --------------------------- | -------- | ------------ | ------ |
| ENG-CB-001 | CLOSED 状态 - 正常调用      | Unit     | 请求正常通过 | P0     |
| ENG-CB-002 | CLOSED→OPEN - 连续失败触发  | Unit     | 超阈值后断开 | P0     |
| ENG-CB-003 | OPEN 状态 - 拒绝请求        | Unit     | 快速失败     | P0     |
| ENG-CB-004 | OPEN→HALF_OPEN - 超时恢复   | Unit     | 定时允许试探 | P0     |
| ENG-CB-005 | HALF_OPEN→CLOSED - 试探成功 | Unit     | 恢复正常     | P0     |
| ENG-CB-006 | HALF_OPEN→OPEN - 试探失败   | Unit     | 重新断开     | P1     |
| ENG-CB-007 | 多模型独立熔断器            | Unit     | 互不影响     | P1     |

#### 2.1.5 Memory 子系统

| 测试ID      | 测试项                              | 测试类型 | 预期结果        | 优先级 |
| ----------- | ----------------------------------- | -------- | --------------- | ------ |
| ENG-MEM-001 | ShortTermMemory - 写入读取          | Unit     | CRUD 正常       | P0     |
| ENG-MEM-002 | ShortTermMemory - 过期清理          | Unit     | TTL 后自动清除  | P1     |
| ENG-MEM-003 | LongTermMemory - 持久化存储         | Unit     | 写入 DB 成功    | P0     |
| ENG-MEM-004 | LongTermMemory - 按用户隔离         | Unit     | 用户间不可见    | P0     |
| ENG-MEM-005 | LongTermMemory - 关键词检索         | Unit     | 语义匹配        | P1     |
| ENG-MEM-006 | ConversationMemory - 消息追加       | Unit     | 按序存储        | P0     |
| ENG-MEM-007 | ConversationMemory - 上下文窗口截断 | Unit     | 超 token 时截断 | P1     |
| ENG-MEM-008 | InMemoryStore - LRU 淘汰            | Unit     | 超容量淘汰最旧  | P2     |

#### 2.1.6 Orchestration 编排层

| 测试ID      | 测试项                             | 测试类型 | 预期结果       | 优先级 |
| ----------- | ---------------------------------- | -------- | -------------- | ------ |
| ENG-ORC-001 | SequentialExecutor - 顺序执行      | Unit     | 按序完成       | P0     |
| ENG-ORC-002 | ParallelExecutor - 并行执行        | Unit     | 并行完成       | P0     |
| ENG-ORC-003 | DAGExecutor - 依赖图执行           | Unit     | 拓扑排序正确   | P0     |
| ENG-ORC-004 | FunctionCallingExecutor - 工具调用 | Unit     | 正确解析和执行 | P0     |
| ENG-ORC-005 | ExecutionStateManager - 状态持久化 | Unit     | 断点续传       | P1     |
| ENG-ORC-006 | CheckpointManager - 保存恢复       | Unit     | 状态完整还原   | P1     |
| ENG-ORC-007 | TaskDecomposer - 任务拆分          | Unit     | 拆分合理       | P1     |
| ENG-ORC-008 | TokenBudget - 预算控制             | Unit     | 超预算拒绝     | P1     |
| ENG-ORC-009 | ContextCompression - 上下文压缩    | Unit     | 信息不丢失     | P2     |
| ENG-ORC-010 | IntentDetection - 意图识别         | Unit     | 分类准确       | P2     |

#### 2.1.7 Constraint 约束层

| 测试ID      | 测试项                        | 测试类型 | 预期结果       | 优先级 |
| ----------- | ----------------------------- | -------- | -------------- | ------ |
| ENG-CST-001 | CostController - 费用追踪     | Unit     | 精确计费       | P0     |
| ENG-CST-002 | CostController - 超限拒绝     | Unit     | 达限额后拒绝   | P0     |
| ENG-CST-003 | RateLimiter - 频率限制        | Unit     | 超频拒绝       | P0     |
| ENG-CST-004 | RateLimiter - 滑动窗口        | Unit     | 窗口内计数正确 | P1     |
| ENG-CST-005 | GuardrailsPipeline - 管道执行 | Unit     | 全部通过才放行 | P1     |

#### 2.1.8 Tools & Skills

| 测试ID     | 测试项                    | 测试类型 | 预期结果         | 优先级 |
| ---------- | ------------------------- | -------- | ---------------- | ------ |
| ENG-TL-001 | ToolRegistry - 注册工具   | Unit     | 注册成功         | P0     |
| ENG-TL-002 | ToolRegistry - 按名称查找 | Unit     | 返回正确工具     | P0     |
| ENG-TL-003 | ToolRegistry - 未注册工具 | Unit     | 返回 null / 错误 | P1     |
| ENG-SK-001 | SkillRegistry - 注册技能  | Unit     | 注册成功         | P0     |
| ENG-SK-002 | SkillRegistry - 动态加载  | Unit     | 运行时加载       | P1     |

#### 2.1.9 AIEngineFacade

| 测试ID      | 测试项                   | 测试类型 | 预期结果             | 优先级 |
| ----------- | ------------------------ | -------- | -------------------- | ------ |
| ENG-FAC-001 | Facade.chat() - 统一入口 | Unit     | 委托到 AiChatService | P0     |
| ENG-FAC-002 | Facade 自动计费集成      | Unit     | 调用后扣减积分       | P0     |
| ENG-FAC-003 | Facade 错误包装          | Unit     | 统一错误格式         | P1     |

---

### 2.2 AI App 应用层

#### 2.2.1 AI Ask（智能问答）

| 测试ID  | 测试项                   | 测试类型 | 预期结果         | 优先级 |
| ------- | ------------------------ | -------- | ---------------- | ------ |
| ASK-001 | 单模型纯对话 (Grok)      | E2E      | 正常响应         | P0     |
| ASK-002 | 单模型纯对话 (Claude)    | E2E      | 正常响应         | P0     |
| ASK-003 | 单模型纯对话 (GPT-4o)    | E2E      | 正常响应         | P0     |
| ASK-004 | 单模型纯对话 (Gemini)    | E2E      | 正常响应         | P0     |
| ASK-005 | 单模型纯对话 (DeepSeek)  | E2E      | 正常响应         | P0     |
| ASK-006 | 单模型纯对话 (Qwen)      | E2E      | 正常响应         | P0     |
| ASK-007 | Mixture 模式 - 4模型并行 | E2E      | 各模型独立响应   | P0     |
| ASK-008 | 联网搜索开启             | E2E      | 引用实时信息     | P0     |
| ASK-009 | 知识库绑定问答           | E2E      | 基于知识库回答   | P0     |
| ASK-010 | 文件上传 (txt/pdf/md)    | E2E      | 文件内容参与对话 | P0     |
| ASK-011 | 图片上传 (png/jpg)       | E2E      | 视觉模型识别     | P1     |
| ASK-012 | 消息引用回复             | E2E      | 引用上下文正确   | P1     |
| ASK-013 | 新建对话                 | E2E      | 清空上下文       | P0     |
| ASK-014 | 历史对话恢复             | E2E      | 上下文完整       | P0     |
| ASK-015 | 删除对话                 | E2E      | 成功删除         | P1     |
| ASK-016 | 对话标题自动生成         | E2E      | 首轮后生成       | P1     |
| ASK-017 | 复制回复内容             | E2E      | 剪贴板正确       | P2     |
| ASK-018 | 代码高亮渲染             | E2E      | 语法高亮正确     | P2     |
| ASK-019 | 流式输出中断(Stop)       | E2E      | 立即停止         | P1     |
| ASK-020 | 模型切换后继续对话       | E2E      | 上下文连贯       | P1     |

#### 2.2.2 AI Research（深度研究）

| 测试ID  | 测试项                      | 测试类型    | 预期结果        | 优先级 |
| ------- | --------------------------- | ----------- | --------------- | ------ |
| RES-001 | 创建研究专题                | Integration | 专题入库        | P0     |
| RES-002 | 维度管理 CRUD               | Integration | 增删改查正常    | P0     |
| RES-003 | 单维度刷新/研究             | Integration | 触发研究任务    | P0     |
| RES-004 | 全维度批量研究              | Integration | 并行执行        | P0     |
| RES-005 | 研究进度 WebSocket 推送     | Integration | 实时进度        | P0     |
| RES-006 | 研究报告生成                | Integration | Markdown 报告   | P0     |
| RES-007 | 报告审查工作流              | Integration | 审查→修改→发布  | P1     |
| RES-008 | 报告导出 PDF                | Integration | PDF 可下载      | P1     |
| RES-009 | 研究来源引用追踪            | Integration | 来源可溯        | P1     |
| RES-010 | DataSourceRouter 路由       | Unit        | 正确选择数据源  | P0     |
| RES-011 | ResearchLeader 规划         | Unit        | 输出合理计划    | P0     |
| RES-012 | ResearchReviewer 审查       | Unit        | 质量评分合理    | P1     |
| RES-013 | EvidenceManager 证据管理    | Unit        | 去重+可信度     | P1     |
| RES-014 | PromptSanitizer 注入防护    | Unit        | 过滤恶意输入    | P0     |
| RES-015 | MissionExecution 任务执行   | Unit        | 生命周期正确    | P0     |
| RES-016 | MissionHealthCheck 健康检查 | Unit        | 卡住任务超时    | P1     |
| RES-017 | 协作者管理                  | Integration | 添加/移除协作者 | P2     |
| RES-018 | 研究中断续传                | Integration | checkpoint 恢复 | P1     |

#### 2.2.3 AI Teams（多 Agent 协作）

| 测试ID  | 测试项                    | 测试类型    | 预期结果                    | 优先级 |
| ------- | ------------------------- | ----------- | --------------------------- | ------ |
| TMS-001 | 创建团队                  | Integration | 团队入库                    | P0     |
| TMS-002 | 添加 Agent 成员           | Integration | 成员注册                    | P0     |
| TMS-003 | 配置 Agent 角色           | Integration | 角色生效                    | P0     |
| TMS-004 | 发起讨论任务              | Integration | 任务分发                    | P0     |
| TMS-005 | 顺序讨论模式              | Integration | 按序发言                    | P0     |
| TMS-006 | 辩论模式 (正反方)         | Integration | 观点对立                    | P0     |
| TMS-007 | Leader 主持模式           | Integration | Leader 引导                 | P1     |
| TMS-008 | 投票决策机制              | Unit        | 共识算法正确                | P0     |
| TMS-009 | 投票结果 - MAJORITY       | Unit        | >50% 通过                   | P0     |
| TMS-010 | 投票结果 - SUPERMAJORITY  | Unit        | >66.7% 通过（注意浮点精度） | P0     |
| TMS-011 | 投票结果 - UNANIMOUS      | Unit        | 100% 通过                   | P0     |
| TMS-012 | delegateTask() 任务委派   | Unit        | 子任务分发                  | P1     |
| TMS-013 | 讨论导出报告              | Integration | 报告完整                    | P1     |
| TMS-014 | 团队模板（预设团队）      | Integration | 28 个预设可用               | P2     |
| TMS-015 | 混合模型 Agent 配置       | Integration | 各 Agent 独立模型           | P1     |
| TMS-016 | MissionOrchestrator 编排  | Unit        | 任务生命周期                | P0     |
| TMS-017 | ContextCompression 长文本 | Unit        | 压缩不丢信息                | P1     |
| TMS-018 | ContextRouter 路由        | Unit        | 上下文正确分发              | P1     |

#### 2.2.4 AI Writing（AI 写作）

| 测试ID  | 测试项                   | 测试类型    | 预期结果        | 优先级 |
| ------- | ------------------------ | ----------- | --------------- | ------ |
| WRT-001 | 新建写作项目             | Integration | 项目创建        | P0     |
| WRT-002 | 生成大纲                 | Integration | 大纲结构完整    | P0     |
| WRT-003 | 单章节 AI 扩写           | Integration | 内容生成        | P0     |
| WRT-004 | 并行多章节写作           | Integration | 并行完成        | P0     |
| WRT-005 | Story Bible 管理         | Integration | 角色/世界观一致 | P1     |
| WRT-006 | 一致性检查               | Unit        | 检测矛盾        | P1     |
| WRT-007 | CheckpointService 断点   | Unit        | 写入恢复正确    | P0     |
| WRT-008 | ChapterDependency 依赖   | Unit        | 依赖图正确      | P1     |
| WRT-009 | QualityGate 质量门       | Unit        | 低质量拦截      | P1     |
| WRT-010 | StyleTemplate 风格模板   | Unit        | 三层配置生效    | P2     |
| WRT-011 | 导出 Word/PDF            | Integration | 格式正确        | P1     |
| WRT-012 | 写作进度 WebSocket       | Integration | 实时推送        | P1     |
| WRT-013 | 超长写作 (50万字+)       | Integration | 不中断不丢失    | P1     |
| WRT-014 | TemporalConflictAnalyzer | Unit        | 时间线矛盾检测  | P2     |
| WRT-015 | ConsistencyEngine        | Unit        | 全局一致性      | P1     |

#### 2.2.5 AI Office（文档/PPT 生成）

| 测试ID  | 测试项                  | 测试类型    | 预期结果     | 优先级 |
| ------- | ----------------------- | ----------- | ------------ | ------ |
| OFC-001 | 创建 PPT 任务           | Integration | 任务创建     | P0     |
| OFC-002 | PPT 规划 (SlidesLeader) | Unit        | 页面规划合理 | P0     |
| OFC-003 | 团队协作生成 PPT        | Integration | 协作完成     | P0     |
| OFC-004 | PPT Checkpoint 保存     | Unit        | 断点可恢复   | P0     |
| OFC-005 | PPT 导出                | Integration | 文件可下载   | P1     |
| OFC-006 | PPT 健康检查            | Unit        | 卡住任务检测 | P1     |
| OFC-007 | AI 编辑单页             | Integration | 内容更新     | P1     |
| OFC-008 | 数据导入 (CSV/Excel)    | Integration | 数据可视化   | P2     |

#### 2.2.6 AI Image（图像生成）

| 测试ID  | 测试项               | 测试类型    | 预期结果     | 优先级 |
| ------- | -------------------- | ----------- | ------------ | ------ |
| IMG-001 | 文本生成图片         | Integration | 图片生成     | P0     |
| IMG-002 | Prompt 增强          | Unit        | 优化后更详细 | P1     |
| IMG-003 | 品牌套件管理         | Integration | CRUD 正常    | P1     |
| IMG-004 | 图片导出 (PNG/SVG)   | Integration | 格式正确     | P1     |
| IMG-005 | 信息图生成           | Integration | 内容+设计    | P2     |
| IMG-006 | 3 位 AI 专家协作模式 | Integration | 协作完成     | P1     |

#### 2.2.7 AI Social（社交内容）

| 测试ID  | 测试项         | 测试类型    | 预期结果 | 优先级 |
| ------- | -------------- | ----------- | -------- | ------ |
| SOC-001 | 生成社交帖文   | Integration | 内容生成 | P1     |
| SOC-002 | 发布队列管理   | Integration | 排队发布 | P1     |
| SOC-003 | MCP 客户端集成 | Unit        | 调用正确 | P2     |

#### 2.2.8 AI RAG（检索增强）

| 测试ID  | 测试项               | 测试类型    | 预期结果   | 优先级 |
| ------- | -------------------- | ----------- | ---------- | ------ |
| RAG-001 | 文档上传 + Embedding | Integration | 向量化成功 | P0     |
| RAG-002 | 语义检索             | Integration | 相关度排序 | P0     |
| RAG-003 | URL 抓取入库         | Integration | 内容提取   | P1     |
| RAG-004 | 微信导入             | Integration | 文章解析   | P2     |
| RAG-005 | 大文档分块           | Unit        | 语义完整   | P1     |

---

### 2.3 Content 内容管理层

#### 2.3.1 Resources（资源库/知识库）

| 测试ID    | 测试项                  | 测试类型    | 预期结果   | 优先级 |
| --------- | ----------------------- | ----------- | ---------- | ------ |
| RES-R-001 | 知识库 CRUD             | Integration | 增删改查   | P0     |
| RES-R-002 | 资源上传 (PDF/URL/手动) | Integration | 多来源支持 | P0     |
| RES-R-003 | 资源去重                | Unit        | 重复检测   | P1     |
| RES-R-004 | 资源搜索                | Integration | 全文检索   | P1     |
| RES-R-005 | 收藏夹管理              | Integration | CRUD       | P2     |
| RES-R-006 | Google Drive 同步       | Integration | 双向同步   | P2     |

#### 2.3.2 Explore（内容发现）

| 测试ID  | 测试项           | 测试类型    | 预期结果 | 优先级 |
| ------- | ---------------- | ----------- | -------- | ------ |
| EXP-001 | YouTube 视频解析 | Integration | 字幕提取 | P1     |
| EXP-002 | 书签收藏         | Integration | URL 保存 | P1     |
| EXP-003 | 批量导入到知识库 | Integration | 批量成功 | P1     |

---

### 2.4 Core 基础设施层

#### 2.4.1 Auth（认证授权）

| 测试ID   | 测试项         | 测试类型 | 预期结果        | 优先级 |
| -------- | -------------- | -------- | --------------- | ------ |
| AUTH-001 | JWT 签发       | Unit     | token 有效      | P0     |
| AUTH-002 | JWT 验证       | Unit     | 有效 token 通过 | P0     |
| AUTH-003 | JWT 过期处理   | Unit     | 返回 401        | P0     |
| AUTH-004 | JWT Guard 拦截 | Unit     | 无 token 拒绝   | P0     |
| AUTH-005 | 用户权限校验   | Unit     | 角色匹配        | P1     |

#### 2.4.2 Credits（积分计费）

| 测试ID  | 测试项           | 测试类型    | 预期结果 | 优先级 |
| ------- | ---------------- | ----------- | -------- | ------ |
| CRD-001 | 积分扣减         | Unit        | 金额正确 | P0     |
| CRD-002 | 积分不足拒绝     | Unit        | 友好提示 | P0     |
| CRD-003 | 积分记录查询     | Integration | 历史正确 | P1     |
| CRD-004 | 不同模型计费规则 | Unit        | 规则匹配 | P0     |

#### 2.4.3 Admin（管理后台）

| 测试ID  | 测试项       | 测试类型    | 预期结果 | 优先级 |
| ------- | ------------ | ----------- | -------- | ------ |
| ADM-001 | 用户列表管理 | Integration | CRUD     | P1     |
| ADM-002 | AI 诊断工具  | Integration | 状态正确 | P1     |
| ADM-003 | 模型配置管理 | Integration | 配置生效 | P1     |

---

### 2.5 前端组件/Hook 测试

#### 2.5.1 Core Hooks

| 测试ID    | 测试项                   | 测试类型 | 预期结果     | 优先级 |
| --------- | ------------------------ | -------- | ------------ | ------ |
| FE-HK-001 | useApiGet - 加载状态     | Unit     | loading→data | P0     |
| FE-HK-002 | useApiGet - 错误处理     | Unit     | error 状态   | P0     |
| FE-HK-003 | useApiGet - 缓存命中     | Unit     | 不重复请求   | P1     |
| FE-HK-004 | useStream - SSE 接收     | Unit     | 逐块接收     | P0     |
| FE-HK-005 | useStream - 断线重连     | Unit     | 自动重连     | P1     |
| FE-HK-006 | useAsyncOperation - 防抖 | Unit     | 防重复提交   | P1     |

#### 2.5.2 Domain Hooks

| 测试ID    | 测试项                  | 测试类型 | 预期结果     | 优先级 |
| --------- | ----------------------- | -------- | ------------ | ------ |
| FE-DM-001 | useAISocial - 社交内容  | Unit     | 状态管理正确 | P1     |
| FE-DM-002 | useSocialSWR - 数据获取 | Unit     | SWR 缓存正确 | P1     |

#### 2.5.3 Stores

| 测试ID    | 测试项                  | 测试类型 | 预期结果      | 优先级 |
| --------- | ----------------------- | -------- | ------------- | ------ |
| FE-ST-001 | aiTeamsStore - 状态变更 | Unit     | 状态一致      | P0     |
| FE-ST-002 | aiTeamsStore - 异步操作 | Unit     | 加载/错误状态 | P1     |

#### 2.5.4 关键页面组件

| 测试ID    | 测试项                                 | 测试类型 | 预期结果         | 优先级 |
| --------- | -------------------------------------- | -------- | ---------------- | ------ |
| FE-CP-001 | ResearchTimeline - 渲染                | Unit     | 不崩溃           | P0     |
| FE-CP-002 | ResearchTimeline - 空数据              | Unit     | 空状态展示       | P0     |
| FE-CP-003 | ResearchTimeline - 数组安全            | Unit     | undefined 不崩溃 | P0     |
| FE-CP-004 | TopicContentPanel - 渲染               | Unit     | 不崩溃           | P0     |
| FE-CP-005 | TopicContentPanel - wsEvents=undefined | Unit     | 不崩溃           | P0     |
| FE-CP-006 | HierarchicalSummaryTab                 | Unit     | 层级展示         | P1     |
| FE-CP-007 | StoryAnalysisDashboard                 | Unit     | 数据可视化       | P1     |
| FE-CP-008 | TimelineConflictPanel                  | Unit     | 冲突展示         | P1     |

---

## 三、组合功能测试（跨模块 & 多维度组合）

### 3.1 AI Ask 功能组合矩阵

#### 3.1.1 模型 × 功能正交组合

> 基于 1.25 测试已验证 Grok 基础组合，本次扩展到全模型。

| 测试ID      | 模型     | 联网 | 知识库 | 文件 | 引用 | Mixture | 预期             | 优先级 |
| ----------- | -------- | ---- | ------ | ---- | ---- | ------- | ---------------- | ------ |
| CMB-ASK-001 | Grok     | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P0     |
| CMB-ASK-002 | Claude   | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P0     |
| CMB-ASK-003 | GPT-4o   | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P0     |
| CMB-ASK-004 | Gemini   | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P1     |
| CMB-ASK-005 | DeepSeek | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P1     |
| CMB-ASK-006 | Qwen     | ✅   | ✅     | ✅   | ✅   | ❌      | 全功能单模型     | P1     |
| CMB-ASK-007 | Mix      | ✅   | ✅     | ✅   | ✅   | ✅      | 完整Mixture      | P0     |
| CMB-ASK-008 | Any      | ✅   | ❌     | ✅   | ❌   | ❌      | 联网+文件        | P1     |
| CMB-ASK-009 | Any      | ❌   | ✅     | ✅   | ✅   | ❌      | 知识库+文件+引用 | P1     |
| CMB-ASK-010 | Mix      | ❌   | ✅     | ✅   | ✅   | ✅      | Mix+知识库+文件  | P1     |

#### 3.1.2 文件类型 × 模型组合

| 测试ID     | 文件类型     | 模型    | 预期          | 优先级 |
| ---------- | ------------ | ------- | ------------- | ------ |
| CMB-FT-001 | .txt         | Grok    | 文本解析      | P1     |
| CMB-FT-002 | .pdf         | Claude  | PDF 解析      | P0     |
| CMB-FT-003 | .md          | GPT-4o  | Markdown 解析 | P1     |
| CMB-FT-004 | .py/.js/.ts  | Grok    | 代码解析      | P1     |
| CMB-FT-005 | .json        | Any     | JSON 结构解析 | P1     |
| CMB-FT-006 | .png/.jpg    | GPT-4o  | 图片识别      | P1     |
| CMB-FT-007 | 混合(3+文件) | Mixture | 多文件+多模型 | P1     |
| CMB-FT-008 | .csv         | Any     | 表格数据解析  | P2     |

#### 3.1.3 对话上下文 × 功能切换组合

| 测试ID      | 场景            | 操作序列                      | 预期         | 优先级 |
| ----------- | --------------- | ----------------------------- | ------------ | ------ |
| CMB-CTX-001 | 模型切换        | Grok→Claude→GPT→继续          | 上下文连贯   | P0     |
| CMB-CTX-002 | 功能切换        | 纯对话→开联网→关联网→开知识库 | 上下文连贯   | P0     |
| CMB-CTX-003 | 单→Mix          | 单模型5轮→切Mix→继续          | 上下文保持   | P0     |
| CMB-CTX-004 | Mix→单          | Mix 3轮→切单模型→继续         | 上下文保持   | P0     |
| CMB-CTX-005 | 历史恢复+功能   | 恢复历史→开联网→问            | 上下文+联网  | P1     |
| CMB-CTX-006 | 深度多轮        | 20+ 轮连续对话                | 不丢失不退化 | P1     |
| CMB-CTX-007 | 文件→知识库切换 | 上传文件→切知识库→问          | 不混淆来源   | P1     |

### 3.2 跨模块集成组合

#### 3.2.1 知识库 → AI Ask 链路

| 测试ID     | 场景                | 操作序列                          | 验证点         | 优先级 |
| ---------- | ------------------- | --------------------------------- | -------------- | ------ |
| INT-KA-001 | 新建知识库→Ask      | Library创建→上传文档→Ask绑定→提问 | 内容可检索     | P0     |
| INT-KA-002 | 多文档跨文档问答    | 上传 5+ 文档→跨文档提问           | 综合回答       | P0     |
| INT-KA-003 | 知识库更新→Ask 同步 | 新增文档→Ask 立即可用             | 实时同步       | P0     |
| INT-KA-004 | 删除知识库→Ask 降级 | 删除→Ask 尝试绑定                 | 友好提示       | P1     |
| INT-KA-005 | 空知识库问答        | 创建空库→Ask 绑定→提问            | 降级为通用回答 | P1     |

#### 3.2.2 Explore → Library → Ask 链路

| 测试ID      | 场景                | 操作序列                     | 验证点     | 优先级 |
| ----------- | ------------------- | ---------------------------- | ---------- | ------ |
| INT-ELA-001 | 收藏→知识库→问答    | 收藏资源→导入Library→Ask问答 | 全链路通   | P0     |
| INT-ELA-002 | YouTube→知识库→问答 | 视频字幕→Library→Ask         | 字幕可问答 | P1     |
| INT-ELA-003 | 批量收藏→知识库     | 多资源→批量导入              | 批量成功   | P1     |

#### 3.2.3 Research → Library/Ask 链路

| 测试ID      | 场景                   | 操作序列                  | 验证点         | 优先级 |
| ----------- | ---------------------- | ------------------------- | -------------- | ------ |
| INT-RLA-001 | 研究报告→知识库        | Research完成→导出→Library | 报告入库       | P1     |
| INT-RLA-002 | 知识库→Research 数据源 | 选择知识库→发起研究       | 知识库作为来源 | P1     |
| INT-RLA-003 | Research 引用→Ask 深入 | Research来源→Ask追问      | 来源可追问     | P2     |

#### 3.2.4 Teams × Research × Writing 链路

| 测试ID      | 场景               | 操作序列                           | 验证点       | 优先级 |
| ----------- | ------------------ | ---------------------------------- | ------------ | ------ |
| INT-TRW-001 | 团队讨论→研究→写作 | Teams讨论→Research深入→Writing成文 | 全链路数据流 | P1     |
| INT-TRW-002 | 研究→团队评审      | Research结果→Teams评审讨论         | 内容作为输入 | P1     |
| INT-TRW-003 | 写作→知识库→问答   | Writing完成→Library→Ask            | 内容可问答   | P2     |

#### 3.2.5 Auth × 所有模块 链路

| 测试ID       | 场景             | 操作序列              | 验证点   | 优先级 |
| ------------ | ---------------- | --------------------- | -------- | ------ |
| INT-AUTH-001 | 未登录访问各 API | 无 token 请求所有 API | 全部 401 | P0     |
| INT-AUTH-002 | 过期 token 访问  | 过期 JWT 请求         | 全部 401 | P0     |
| INT-AUTH-003 | 积分不足调用 AI  | 积分=0 发起请求       | 友好拒绝 | P0     |

### 3.3 端到端完整场景

| 测试ID  | 场景               | 完整流程                                | 验收标准       | 优先级 |
| ------- | ------------------ | --------------------------------------- | -------------- | ------ |
| E2E-001 | 从零到深度研究报告 | Ask预研→Research规划→执行→报告→PDF      | 报告完整有引用 | P0     |
| E2E-002 | 知识库全流程       | Explore发现→收藏→Library导入→Ask问答    | 端到端无缝     | P0     |
| E2E-003 | 多 Agent 协作决策  | 创建团队→配Agent→讨论→投票→结论报告     | 结论完整       | P0     |
| E2E-004 | AI 辅助长篇写作    | 新建→大纲→扩写→一致性检查→导出          | 内容连贯       | P1     |
| E2E-005 | PPT 全流程         | 创建→规划→协作生成→编辑→导出            | PPT 可用       | P1     |
| E2E-006 | 多模型对比研究     | Mixture问→对比→选最佳→深入追问          | 差异明显       | P1     |
| E2E-007 | 新用户引导流程     | 注册→首次使用Ask→使用Research→使用Teams | 流程顺畅       | P1     |
| E2E-008 | 图文内容创作       | Research素材→Image生成→Writing成文      | 图文并茂       | P2     |

---

## 四、性能测试（全面覆盖）

### 4.1 响应时间基准

| 测试ID      | 场景                | 测试条件      | P50基准 | P90基准 | P99基准 | 优先级 |
| ----------- | ------------------- | ------------- | ------- | ------- | ------- | ------ |
| PERF-RT-001 | Ask 首次响应 (TTFB) | 单模型短问题  | <2s     | <3s     | <5s     | P0     |
| PERF-RT-002 | Ask 流式完成        | 200字回复     | <10s    | <15s    | <20s    | P0     |
| PERF-RT-003 | Mixture 首响应      | 4模型并行     | <3s     | <5s     | <8s     | P0     |
| PERF-RT-004 | 联网搜索响应        | 搜索+AI       | <5s     | <8s     | <12s    | P0     |
| PERF-RT-005 | 知识库检索          | 10文档知识库  | <3s     | <5s     | <8s     | P0     |
| PERF-RT-006 | 知识库检索          | 100文档知识库 | <5s     | <8s     | <12s    | P1     |
| PERF-RT-007 | 文件上传处理        | 1MB 文件      | <5s     | <10s    | <15s    | P1     |
| PERF-RT-008 | 文件上传处理        | 10MB 文件     | <15s    | <25s    | <40s    | P2     |
| PERF-RT-009 | Teams 任务启动      | 4 Agent       | <3s     | <5s     | <8s     | P1     |
| PERF-RT-010 | Research 规划生成   | 新研究        | <8s     | <12s    | <18s    | P1     |
| PERF-RT-011 | Research 单维度研究 | 中等复杂度    | <30s    | <45s    | <60s    | P1     |
| PERF-RT-012 | 历史对话列表加载    | 100+ 对话     | <1s     | <2s     | <3s     | P0     |
| PERF-RT-013 | 页面首次加载 (FCP)  | 首次访问      | <2s     | <3s     | <5s     | P0     |
| PERF-RT-014 | 页面可交互 (TTI)    | 首次访问      | <3s     | <5s     | <7s     | P0     |
| PERF-RT-015 | PPT 生成完成        | 10页 PPT      | <60s    | <90s    | <120s   | P1     |
| PERF-RT-016 | Embedding 处理      | 1000 字文档   | <3s     | <5s     | <8s     | P1     |

### 4.2 并发能力测试

| 测试ID      | 场景                    | 并发数  | 预期     | 度量指标       | 优先级 |
| ----------- | ----------------------- | ------- | -------- | -------------- | ------ |
| PERF-CC-001 | 同时 Ask 请求           | 3       | 各自正常 | 无超时、无 502 | P0     |
| PERF-CC-002 | 同时 Ask + Teams        | 2+1     | 各自正常 | 无互相阻塞     | P0     |
| PERF-CC-003 | 同用户多标签页          | 3       | 各自独立 | 无数据串扰     | P0     |
| PERF-CC-004 | Mixture 4模型并发       | 4       | 全部返回 | 无遗漏         | P0     |
| PERF-CC-005 | 多用户同时 Ask          | 10      | 各自正常 | QPS 不退化     | P1     |
| PERF-CC-006 | Research + Writing 同时 | 2       | 各自完成 | 无资源竞争     | P1     |
| PERF-CC-007 | WebSocket 连接          | 20      | 全部在线 | 无断连         | P1     |
| PERF-CC-008 | 数据库连接池压力        | 50 请求 | 不超限   | 连接复用       | P2     |

### 4.3 吞吐量测试

| 测试ID      | 场景              | 负载        | 基准            | 优先级 |
| ----------- | ----------------- | ----------- | --------------- | ------ |
| PERF-TP-001 | Ask API 吞吐      | 持续 1 分钟 | >20 req/min     | P1     |
| PERF-TP-002 | Research API 吞吐 | 持续 1 分钟 | >5 tasks/min    | P1     |
| PERF-TP-003 | 知识库检索吞吐    | 持续 1 分钟 | >30 queries/min | P1     |
| PERF-TP-004 | 文件上传吞吐      | 10 文件队列 | 全部成功        | P2     |

### 4.4 大数据量测试

| 测试ID      | 场景         | 数据量    | 预期         | 优先级 |
| ----------- | ------------ | --------- | ------------ | ------ |
| PERF-BD-001 | 知识库文档数 | 100+ 文档 | 检索正常     | P1     |
| PERF-BD-002 | 对话历史数   | 500+ 对话 | 列表加载 <3s | P1     |
| PERF-BD-003 | 单对话消息数 | 100+ 消息 | 不崩溃不截断 | P1     |
| PERF-BD-004 | 研究专题数   | 50+ 专题  | 列表正常     | P2     |
| PERF-BD-005 | 写作章节数   | 50+ 章节  | 导航正常     | P2     |
| PERF-BD-006 | Teams 成员数 | 10+ Agent | 讨论正常     | P2     |

### 4.5 资源消耗监控

| 测试ID      | 场景       | 监控项     | 阈值            | 优先级 |
| ----------- | ---------- | ---------- | --------------- | ------ |
| PERF-RS-001 | 空闲状态   | 后端内存   | <512MB          | P1     |
| PERF-RS-002 | 高峰请求   | 后端内存   | <1GB            | P1     |
| PERF-RS-003 | 长时间运行 | 内存泄漏   | 24h 内增长 <10% | P1     |
| PERF-RS-004 | 高峰请求   | CPU 利用率 | <80%            | P1     |
| PERF-RS-005 | 高峰请求   | DB 连接数  | 不超限          | P1     |
| PERF-RS-006 | WebSocket  | 连接内存   | 每连接 <5MB     | P2     |

---

## 五、DFX 质量属性测试

### 5.1 可用性 (Usability)

| 测试ID    | 测试项       | 验收标准                            | 方法       | 优先级 |
| --------- | ------------ | ----------------------------------- | ---------- | ------ |
| DFX-U-001 | 首次使用引导 | 新用户 3 分钟内完成首次 Ask         | 可用性测试 | P1     |
| DFX-U-002 | 导航清晰度   | 主菜单 → 目标页面 ≤ 2 次点击        | 走查       | P1     |
| DFX-U-003 | 操作反馈     | Loading / Success / Error 三态明确  | 走查       | P0     |
| DFX-U-004 | 错误恢复     | 错误后提供重试/返回操作             | 异常测试   | P0     |
| DFX-U-005 | 快捷键支持   | Enter 发送 / Esc 取消 / Ctrl+K 搜索 | 功能测试   | P2     |
| DFX-U-006 | 帮助文档     | 关键功能有 Tooltip/帮助说明         | 走查       | P2     |
| DFX-U-007 | 一致性       | 同类操作交互模式一致                | 走查       | P1     |
| DFX-U-008 | 无障碍表单   | 表单字段有 label / 必填有标识       | 走查       | P2     |

### 5.2 可靠性 (Reliability)

| 测试ID    | 测试项               | 验收标准                 | 方法     | 优先级 |
| --------- | -------------------- | ------------------------ | -------- | ------ |
| DFX-R-001 | 页面刷新恢复         | 刷新后状态不丢失         | 功能测试 | P0     |
| DFX-R-002 | 浏览器后退           | 状态正确恢复             | 功能测试 | P0     |
| DFX-R-003 | 网络中断             | 不白屏、有友好提示       | 异常测试 | P0     |
| DFX-R-004 | API 500 错误         | 友好提示、可重试         | 异常测试 | P0     |
| DFX-R-005 | API 超时             | 超时提示、可重试         | 异常测试 | P0     |
| DFX-R-006 | 长时间空闲           | Session 不过期或自动刷新 | 场景测试 | P1     |
| DFX-R-007 | 数据持久化           | 对话/项目不丢失          | 场景测试 | P0     |
| DFX-R-008 | WebSocket 断线重连   | 自动重连 + 消息补发      | 异常测试 | P0     |
| DFX-R-009 | 流式中断恢复         | 流式传输中断后可恢复     | 异常测试 | P1     |
| DFX-R-010 | 并发写入冲突         | 乐观锁/最后写入赢        | 并发测试 | P1     |
| DFX-R-011 | 任务幂等性           | 重复提交不产生副作用     | 功能测试 | P1     |
| DFX-R-012 | Graceful Degradation | 外部 API 不可用时降级    | 故障注入 | P1     |

### 5.3 安全性 (Security)

| 测试ID    | 测试项           | 验收标准                           | 方法     | 优先级 |
| --------- | ---------------- | ---------------------------------- | -------- | ------ |
| DFX-S-001 | XSS 防护         | `<script>alert(1)</script>` 不执行 | 注入测试 | P0     |
| DFX-S-002 | SQL 注入防护     | `' OR 1=1 --` 不生效               | 注入测试 | P0     |
| DFX-S-003 | Prompt 注入防护  | 恶意 prompt 被过滤                 | 注入测试 | P0     |
| DFX-S-004 | CSRF 防护        | 跨站请求被拒绝                     | 安全测试 | P0     |
| DFX-S-005 | 越权访问         | 用户 A 不能访问用户 B 数据         | 权限测试 | P0     |
| DFX-S-006 | JWT Token 安全   | Token 不可伪造                     | 安全测试 | P0     |
| DFX-S-007 | 文件上传安全     | 可执行文件被拒绝                   | 安全测试 | P0     |
| DFX-S-008 | 文件上传大小限制 | 超大文件被拒绝                     | 边界测试 | P1     |
| DFX-S-009 | API 速率限制     | 短时大量请求被限流                 | 负载测试 | P1     |
| DFX-S-010 | 敏感数据不外泄   | API 不返回密码/密钥                | 审查     | P0     |
| DFX-S-011 | HTTPS 强制       | HTTP 自动跳转 HTTPS                | 配置检查 | P0     |
| DFX-S-012 | 错误信息不泄露   | 500 错误不暴露堆栈                 | 异常测试 | P0     |
| DFX-S-013 | 依赖安全审计     | `npm audit` 无高危漏洞             | 工具扫描 | P1     |
| DFX-S-014 | SSRF 防护        | URL 抓取不允许内网地址             | 安全测试 | P1     |
| DFX-S-015 | 路径遍历防护     | `../../etc/passwd` 被拒绝          | 注入测试 | P1     |

### 5.4 可维护性 (Maintainability)

| 测试ID    | 测试项              | 验收标准                           | 方法                    | 优先级 |
| --------- | ------------------- | ---------------------------------- | ----------------------- | ------ |
| DFX-M-001 | 代码覆盖率          | 整体 ≥50% (Phase1)                 | `npm run test:coverage` | P0     |
| DFX-M-002 | TypeScript 严格模式 | 无 `any` 类型                      | `npm run type-check`    | P0     |
| DFX-M-003 | Lint 检查           | 0 error, <10 warning               | `npm run lint`          | P0     |
| DFX-M-004 | 构建成功            | 全量构建无错误                     | `npm run build`         | P0     |
| DFX-M-005 | 循环依赖检测        | 无循环依赖                         | 工具检测                | P1     |
| DFX-M-006 | 模块边界清晰        | 无跨层直接调用                     | 代码审查                | P1     |
| DFX-M-007 | 日志规范            | 使用 NestJS Logger, 无 console.log | Grep 检查               | P1     |
| DFX-M-008 | 配置外部化          | 无硬编码 model/temperature         | Grep 检查               | P0     |

### 5.5 可观测性 (Observability)

| 测试ID    | 测试项       | 验收标准                      | 方法     | 优先级 |
| --------- | ------------ | ----------------------------- | -------- | ------ |
| DFX-O-001 | 请求链路追踪 | AI 调用有 traceId             | 日志审查 | P1     |
| DFX-O-002 | 结构化日志   | JSON 格式、含 timestamp/level | 日志审查 | P1     |
| DFX-O-003 | 错误日志完整 | 含 stack trace + context      | 异常测试 | P1     |
| DFX-O-004 | AI 调用计量  | 模型/token/费用可查           | 功能测试 | P1     |
| DFX-O-005 | 健康检查端点 | `/health` 返回服务状态        | API 测试 | P0     |
| DFX-O-006 | 任务进度可视 | Research/Writing 进度实时可查 | 功能测试 | P1     |

### 5.6 响应式设计 (Responsiveness)

| 测试ID     | 设备/分辨率              | 测试页面    | 验收标准     | 优先级 |
| ---------- | ------------------------ | ----------- | ------------ | ------ |
| DFX-RD-001 | 桌面 1920×1080           | 全部页面    | 布局正常     | P0     |
| DFX-RD-002 | 桌面 1366×768            | 全部页面    | 布局正常     | P0     |
| DFX-RD-003 | 平板横向 1024×768        | 全部页面    | 自适应       | P1     |
| DFX-RD-004 | 平板竖向 768×1024        | 全部页面    | 自适应       | P1     |
| DFX-RD-005 | 手机 375×667 (iPhone SE) | Ask/Explore | 基本可用     | P2     |
| DFX-RD-006 | 手机 414×896 (iPhone 11) | Ask/Explore | 基本可用     | P2     |
| DFX-RD-007 | 4K 3840×2160             | 全部页面    | 不模糊不溢出 | P2     |

### 5.7 兼容性 (Compatibility)

| 测试ID     | 测试项         | 环境    | 验收标准     | 优先级 |
| ---------- | -------------- | ------- | ------------ | ------ |
| DFX-CP-001 | Chrome 最新版  | Desktop | 全功能正常   | P0     |
| DFX-CP-002 | Firefox 最新版 | Desktop | 核心功能正常 | P1     |
| DFX-CP-003 | Safari 最新版  | macOS   | 核心功能正常 | P1     |
| DFX-CP-004 | Edge 最新版    | Desktop | 核心功能正常 | P1     |
| DFX-CP-005 | Chrome Mobile  | Android | 基本可用     | P2     |
| DFX-CP-006 | Safari Mobile  | iOS     | 基本可用     | P2     |

---

## 六、业界最佳实践审视

### 6.1 OWASP Top 10 安全审计

| 审计项         | OWASP 编号 | 检查内容                 | 当前状态       | 建议                                |
| -------------- | ---------- | ------------------------ | -------------- | ----------------------------------- |
| 注入攻击       | A03:2021   | SQL/NoSQL/OS/Prompt 注入 | 待审计         | Prisma 参数化查询 + PromptSanitizer |
| 认证失败       | A07:2021   | 弱密码/会话管理          | JWT 已实现     | 增加 refresh token 机制             |
| 敏感数据暴露   | A02:2021   | API 返回敏感字段         | 待审计         | DTO 白名单过滤                      |
| XML/JSON 注入  | A03:2021   | 外部实体注入             | 待审计         | 输入校验                            |
| 访问控制       | A01:2021   | 越权访问                 | JWT Guard      | 增加资源级 RBAC                     |
| 安全配置       | A05:2021   | 默认配置/调试接口        | 待审计         | 生产环境禁用 debug                  |
| XSS            | A03:2021   | 存储型/反射型 XSS        | React 默认转义 | CSP 头配置                          |
| 不安全反序列化 | A08:2021   | JSON/YAML 反序列化       | 待审计         | class-validator 严格校验            |
| 已知漏洞组件   | A06:2021   | npm 依赖漏洞             | 待审计         | `npm audit fix`                     |
| 日志&监控不足  | A09:2021   | 安全事件日志             | 部分实现       | 增加安全事件审计日志                |

### 6.2 12-Factor App 审视

| 因素                 | 描述             | 当前状态                | 建议              |
| -------------------- | ---------------- | ----------------------- | ----------------- |
| I. Codebase          | 一份代码多次部署 | ✅ Git + Railway        | -                 |
| II. Dependencies     | 显式声明依赖     | ✅ package.json         | 锁定版本          |
| III. Config          | 配置存于环境变量 | ✅ .env + Railway       | 无硬编码          |
| IV. Backing Services | 附加资源可替换   | ✅ PostgreSQL           | -                 |
| V. Build/Release/Run | 严格分离         | ✅ Railway CI/CD        | -                 |
| VI. Processes        | 无状态进程       | ⚠️ WebSocket 有状态     | Redis 共享状态    |
| VII. Port Binding    | 自包含服务       | ✅ NestJS HTTP          | -                 |
| VIII. Concurrency    | 进程模型横向扩展 | ⚠️ 单实例               | PM2 Cluster       |
| IX. Disposability    | 快速启停         | ✅                      | 优雅关闭          |
| X. Dev/Prod Parity   | 环境一致         | ⚠️ SQLite vs PostgreSQL | 统一用 PostgreSQL |
| XI. Logs             | 日志作为事件流   | ✅ stdout               | 集中日志          |
| XII. Admin Processes | 管理任务一次性   | ✅ Prisma Migrate       | -                 |

### 6.3 测试金字塔评估

```
当前状态:
                    ┌──────┐
                    │ E2E  │  5 (不足)
                   ┌┤ 测试 ├┐
                   │└──────┘│
                  ┌┤ 集成   ├┐  ~10 (不足)
                  │┤ 测试   ├│
                 ┌┤└────────┘├┐
                 │┤  单元    ├│  ~86 (主力)
                 ││  测试    ││
                 └┤──────────├┘
                  └──────────┘

目标状态:
                    ┌──────┐
                    │ E2E  │  20~30
                   ┌┤ 测试 ├┐
                   │└──────┘│
                  ┌┤ 集成   ├┐  50~80
                  │┤ 测试   ├│
                 ┌┤└────────┘├┐
                 │┤  单元    ├│  200~300
                 ││  测试    ││
                 └┤──────────├┘
                  └──────────┘
```

**差距分析**:

- 单元测试: 86 → 目标 200+ (增加 AiChatService、Writing、Office 覆盖)
- 集成测试: ~10 → 目标 50+ (增加 Controller→Service→DB 链路测试)
- E2E 测试: 5 → 目标 20+ (增加 Playwright 自动化)
- 前端测试: 10 → 目标 80+ (关键组件覆盖严重不足)

### 6.4 混沌工程审视

| 测试项          | 描述              | 方法          | 优先级 |
| --------------- | ----------------- | ------------- | ------ |
| 外部 API 不可用 | LLM API 全部宕机  | Mock 500 响应 | P1     |
| 数据库连接断开  | PostgreSQL 不可达 | 断开 DB 连接  | P1     |
| 内存压力        | 内存逼近上限      | 大量并发请求  | P2     |
| 网络延迟        | 网络延迟 5s+      | tc netem 模拟 | P2     |
| 磁盘空间不足    | 写入失败          | 模拟磁盘满    | P2     |

### 6.5 API 设计最佳实践审视

| 审视项       | 检查内容              | 当前状态      | 建议                 |
| ------------ | --------------------- | ------------- | -------------------- |
| RESTful 规范 | URL 命名、HTTP 方法   | ⚠️ 部分不规范 | 统一 RESTful         |
| 版本控制     | API 版本号            | ❌ 未实现     | /api/v1/ 前缀        |
| 分页规范     | cursor vs offset      | ✅ offset     | 大数据量用 cursor    |
| 错误格式统一 | 统一错误响应          | ⚠️ 部分统一   | 全局 ExceptionFilter |
| 请求校验     | DTO + class-validator | ✅            | -                    |
| 响应格式统一 | 统一包装              | ⚠️            | 统一 { data, meta }  |
| 文档化       | Swagger/OpenAPI       | ⚠️ 部分       | 全量 Swagger 注解    |

### 6.6 前端测试最佳实践审视

| 审视项       | 检查内容           | 当前状态           | 建议            |
| ------------ | ------------------ | ------------------ | --------------- |
| 组件测试覆盖 | 关键组件有测试     | ❌ 严重不足 (10个) | P0 组件补测试   |
| Hook 测试    | 自定义 Hook 测试   | ⚠️ 3/20+           | 核心 Hook 补充  |
| Store 测试   | Zustand Store 测试 | ⚠️ 1/5+            | 核心 Store 补充 |
| 快照测试     | UI 回归检测        | ❌ 无              | 关键页面快照    |
| 视觉回归     | 像素级对比         | ❌ 无              | Chromatic/Percy |
| Mock 规范    | API Mock 统一      | ⚠️                 | MSW 统一 Mock   |
| 异步测试     | waitFor/act 使用   | ✅                 | -               |

---

## 七、测试执行计划

### 7.1 分阶段执行

#### Phase 1: 基础夯实 (Week 1-2)

**目标**: 单元测试覆盖率达 50%，核心模块 P0 用例全部通过

| 任务                          | 用例数  | 负责 | 工具             |
| ----------------------------- | ------- | ---- | ---------------- |
| AI Engine 单元测试补全        | ~40     | 开发 | Jest             |
| AI Ask/Research 集成测试      | ~20     | 开发 | Jest + supertest |
| 前端 P0 组件测试              | ~15     | 开发 | Vitest + RTL     |
| 安全基础检查 (XSS/SQL/Prompt) | ~10     | 开发 | 手动 + 自动化    |
| **小计**                      | **~85** |      |                  |

#### Phase 2: 集成拓展 (Week 3-4)

**目标**: 集成测试覆盖率达 70%，跨模块组合测试通过

| 任务                | 用例数   | 负责 | 工具             |
| ------------------- | -------- | ---- | ---------------- |
| 跨模块集成组合测试  | ~60      | 开发 | Jest + supertest |
| AI Ask 功能组合矩阵 | ~30      | QA   | 手动/Playwright  |
| 性能基准建立        | ~15      | 开发 | k6 / Artillery   |
| DFX 可靠性测试      | ~15      | QA   | 手动 + 故障注入  |
| **小计**            | **~120** |      |                  |

#### Phase 3: 端到端 & 深度 (Week 5-6)

**目标**: E2E 场景通过，性能达标，DFX 无 P0 缺陷

| 任务            | 用例数  | 负责 | 工具          |
| --------------- | ------- | ---- | ------------- |
| E2E 场景自动化  | ~20     | QA   | Playwright    |
| 性能负载测试    | ~20     | 开发 | k6            |
| DFX 安全审计    | ~15     | 安全 | OWASP ZAP     |
| 响应式 & 兼容性 | ~12     | QA   | 浏览器矩阵    |
| 边界条件 & 混沌 | ~20     | 开发 | 手动 + 自动化 |
| **小计**        | **~87** |      |               |

#### Phase 4: 业界对标 & 持续改进 (Week 7+)

**目标**: 覆盖率 85%，全部最佳实践审视完成

| 任务               | 用例数   | 负责 | 工具        |
| ------------------ | -------- | ---- | ----------- |
| 覆盖率提升到 85%   | ~100     | 开发 | Jest/Vitest |
| OWASP 完整审计     | ~10      | 安全 | 工具 + 手动 |
| 12-Factor 差距修复 | ~5       | 架构 | 代码审查    |
| 测试金字塔平衡     | ~30      | 全员 | 各类工具    |
| **小计**           | **~145** |      |             |

### 7.2 执行优先级总览

#### P0 - 必须通过（阻断发布）

- [ ] ENG-LLM-001~005 (AiChatService 核心)
- [ ] ENG-CB-001~005 (熔断器状态机)
- [ ] ENG-MEM-001,003,004,006 (Memory 核心)
- [ ] ENG-ORC-001~004 (编排器核心)
- [ ] ENG-CST-001~003 (约束核心)
- [ ] ASK-001~010,013,014 (Ask 核心功能)
- [ ] RES-001~006,010,011,014,015 (Research 核心)
- [ ] TMS-001~008,016 (Teams 核心)
- [ ] WRT-001~004,007 (Writing 核心)
- [ ] CMB-ASK-001~003,007 (Ask 组合)
- [ ] CMB-CTX-001~004 (上下文组合)
- [ ] INT-KA-001~003 (知识库→Ask)
- [ ] INT-AUTH-001~003 (认证链路)
- [ ] E2E-001~003 (核心 E2E)
- [ ] DFX-S-001~007,010~012 (安全 P0)
- [ ] DFX-R-001~005,007,008 (可靠性 P0)
- [ ] DFX-M-001~004,008 (可维护性 P0)
- [ ] PERF-RT-001~005,012~014 (性能 P0)
- [ ] PERF-CC-001~004 (并发 P0)

#### P1 - 重要（影响体验）

- [ ] 剩余 AI Engine 单元测试
- [ ] ASK 其余模型组合
- [ ] Research/Writing/Office 完整集成
- [ ] 性能吞吐量 & 大数据量
- [ ] DFX 可用性 & 可观测性
- [ ] 跨模块完整链路
- [ ] E2E 全场景

#### P2 - 一般（可接受缺陷）

- [ ] 文件类型完整矩阵
- [ ] 响应式手机适配
- [ ] 混沌工程
- [ ] 视觉回归
- [ ] API 版本控制

### 7.3 测试命令速查

```bash
# =================== 单元测试 ===================
# 全量后端测试
npm run test:backend

# 快速后端测试（跳过慢速测试）
npm run test:quick:backend

# 指定模块测试
cd backend && npx jest ai-chat.service --verbose

# 后端覆盖率
npm run test:coverage:backend

# 全量前端测试
npm run test:frontend

# 前端覆盖率
npm run test:coverage:frontend

# =================== 集成/E2E 测试 ===================
# 后端 E2E
cd backend && npm run test:e2e

# =================== 验证命令 ===================
# 快速验证（类型 + 测试）
npm run verify:quick

# 完整验证（Lint + 类型 + 测试 + 构建）
npm run verify:full

# 智能变更验证
npm run verify:changed

# =================== 静态检查 ===================
# TypeScript 类型检查
npm run type-check

# Lint 检查
npm run lint

# npm 安全审计
cd backend && npm audit
cd frontend && npm audit
```

---

## 八、验收标准与退出准则

### 8.1 发布验收标准

| 维度                     | 标准         | 阈值            |
| ------------------------ | ------------ | --------------- |
| **P0 用例通过率**        | 全部通过     | 100%            |
| **P1 用例通过率**        | 绝大部分通过 | ≥ 95%           |
| **P2 用例通过率**        | 大部分通过   | ≥ 80%           |
| **代码覆盖率** (Phase 1) | 整体覆盖     | ≥ 50%           |
| **代码覆盖率** (Phase 3) | 整体覆盖     | ≥ 85%           |
| **P0 Bug 数**            | 无遗留       | 0               |
| **P1 Bug 数**            | 少量可接受   | ≤ 3             |
| **性能基准**             | P90 达标     | 全部通过        |
| **安全审计**             | 无高危漏洞   | 0 High/Critical |

### 8.2 质量门禁

```
PR 合入检查:
├── ✅ TypeScript 类型检查通过
├── ✅ Lint 检查通过
├── ✅ 单元测试全部通过
├── ✅ 覆盖率不低于阈值
├── ✅ 构建成功
└── ✅ 无新增安全漏洞

Release 检查:
├── ✅ 全部 P0 测试通过
├── ✅ E2E 冒烟测试通过
├── ✅ 性能基准达标
├── ✅ 安全审计通过
└── ✅ 无 P0 遗留 Bug
```

### 8.3 测试报告模板

每次测试执行后生成报告:

```markdown
# 测试执行报告 - [日期]

## 概览

- 执行环境: [local/staging/production]
- 执行范围: [P0/P1/Full]
- 总用例数: X
- 通过: X | 失败: X | 跳过: X | 阻塞: X
- 通过率: X%

## 新发现缺陷

| ID  | 严重程度 | 模块 | 描述 | 状态 |
| --- | -------- | ---- | ---- | ---- |

## 覆盖率变化

| 模块 | 上次 | 本次 | 变化 |
| ---- | ---- | ---- | ---- |

## 性能基准对比

| 指标 | 上次 | 本次 | 变化 |
| ---- | ---- | ---- | ---- |

## 风险评估

- ...

## 下一步计划

- ...
```

---

## 附录

### A. 与 2026-01-25 基线对比

| 维度         | 1.25 基线 | 本方案   | 增量                                         |
| ------------ | --------- | -------- | -------------------------------------------- |
| 单功能测试   | ~150      | ~220     | +70 (新增 AI Engine/Writing/Office 深度覆盖) |
| 组合功能测试 | ~80       | ~120     | +40 (新增全模型正交矩阵)                     |
| 跨模块集成   | ~40       | ~60      | +20 (新增 Auth/Credits 链路)                 |
| E2E 场景     | ~20       | ~30      | +10 (新增 PPT/图文创作)                      |
| 边界条件     | ~30       | ~50      | +20 (新增并发/竞态/大数据量)                 |
| 性能测试     | ~15       | ~40      | +25 (新增吞吐/资源/大数据)                   |
| DFX 测试     | -         | ~80      | +80 (全新维度)                               |
| 最佳实践     | -         | ~30      | +30 (全新维度)                               |
| **总计**     | **~335**  | **~630** | **+295**                                     |

### B. 关键风险清单

| 风险                                | 影响             | 缓解措施                  |
| ----------------------------------- | ---------------- | ------------------------- |
| 前端组件测试严重不足 (10/200+)      | 回归风险高       | Phase 1 补齐 P0 组件      |
| ResearchTimeline 0% 覆盖 (1072行)   | 研究页面崩溃风险 | 优先补 17+ 测试           |
| TopicContentPanel 0% 覆盖 (2000+行) | 详情页崩溃风险   | 优先补 20+ 测试           |
| SUPERMAJORITY 浮点精度问题          | 投票结果不正确   | 修复 66.67% vs 0.667 比较 |
| WebSocket 有状态                    | 横向扩展受限     | Redis Pub/Sub 共享        |
| E2E 测试自动化不足                  | 回归检测慢       | Playwright 自动化         |
| 无视觉回归测试                      | UI 样式回归      | Chromatic/Percy           |

### C. 工具链推荐

| 用途                | 推荐工具                        | 说明           |
| ------------------- | ------------------------------- | -------------- |
| 单元测试 (Backend)  | Jest + @nestjs/testing          | 已使用         |
| 单元测试 (Frontend) | Vitest + @testing-library/react | 已使用         |
| E2E 测试            | Playwright                      | 已配置         |
| 性能测试            | k6 / Artillery                  | k6 已在文档中  |
| 安全扫描            | OWASP ZAP / npm audit           | 推荐增加       |
| API Mock            | MSW (Mock Service Worker)       | 推荐前端统一   |
| 视觉回归            | Chromatic / Percy               | 推荐新增       |
| 覆盖率追踪          | Codecov / Coveralls             | 推荐 CI 集成   |
| 变异测试            | Stryker                         | 验证测试有效性 |
| 契约测试            | Pact                            | 前后端接口契约 |

---

**文档版本**: 1.0
**制定日期**: 2026-02-06
**制定人**: Claude Code
**审核人**: 待审核
**下次更新**: Phase 1 完成后
