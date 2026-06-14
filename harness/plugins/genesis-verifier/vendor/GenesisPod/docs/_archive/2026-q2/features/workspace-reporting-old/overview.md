# Workspace AI Reporting – Detailed Design

整理角色：产品经理（PM）、系统架构师（Arch）、AI 工程师（AI）、前端负责人（FE）、后端负责人（BE）、QA、蓝军安全（Sec）

---

## 1. 背景与目标（PM）

- **目标**：在 Workspace 中实现“多资源分析 → 模板化报告输出”的闭环功能，支持 2–10 个资源组合分析，生成四类核心报告模板并沉淀到 Library。
- **用户价值**：帮助研究者/工程师/产品经理从多来源内容中快速对比分析与提炼洞察，提升知识沉淀效率。
- **成功指标**
  - 报告生成成功率 ≥ 60%。
  - 用户从选择资源到保存报告耗时 ≤ 5 分钟（P75）。
  - 报告保存率 ≥ 40%，重复利用率 ≥ 20%。
  - 任务失败率 < 10%，失败时提供明确重试提示。

---

## 2. 需求范围（PM）

- Workspace 支持展示已选资源、任务卡片（对比分析、综合摘要、关键洞察、关联差异）。
- 用户可配置模型/问题并启动 AI 任务，实时查看进度与日志。
- AI 生成结构化结果 → 预览 → 选择模板生成正式报告 → 保存至 Library → 支持导出 Markdown/PDF。
- 后台记录任务、模板、报告关系，可查询历史任务与报告。
- 具备基础限流（单用户最大并发 3、每小时 20 次）。
- 不包含：自定义模板上传、协作批注、自动数据刷新等高级特性。

---

## 3. 用户旅程（PM）

1. 从 Feed 或 Library 选择 2–10 个资源加入 Workspace。
2. 打开 Workspace：左侧资源列表，中间任务卡片，右侧任务日志/AI 会话。
3. 选择任务 → 配置模型与问题 → 启动任务。
4. 任务执行中显示进度（状态/队列位置/估时）。
5. 任务成功后展示结构化结果预览。
6. 点击“生成报告”→ 选择模板 → 输入标题/备注 → 生成并保存。
7. 在 Library “Workspace 报告”分类中查看、导出或重新生成。

---

## 4. 数据模型设计（Arch）

新增/调整 Prisma 模型：

```prisma
enum WorkspaceStatus { ACTIVE ARCHIVED }
enum TaskStatus { PENDING RUNNING SUCCESS FAILED }

model Workspace {
  id            String   @id @default(uuid())
  userId        String
  status        WorkspaceStatus @default(ACTIVE)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  resources     WorkspaceResource[]
  tasks         WorkspaceTask[]
  reports       Report[]
}

model WorkspaceResource {
  id           String   @id @default(uuid())
  workspaceId  String
  resourceId   String
  metadata     Json?
  createdAt    DateTime @default(now())
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  resource     Resource  @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, resourceId])
}

model WorkspaceTask {
  id            String    @id @default(uuid())
  workspaceId   String
  templateId    String
  model         String
  status        TaskStatus @default(PENDING)
  queuePosition Int?
  estimatedTime Int?
  startedAt     DateTime?
  finishedAt    DateTime?
  parameters    Json?
  result        Json?
  error         Json?
  cost          Json?
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  template      ReportTemplate @relation(fields: [templateId], references: [id])
  reports       Report[]
}

model ReportTemplate {
  id           String   @id
  name         String
  category     String
  version      Int
  description  String?
  schema       Json
  promptConfig Json
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  tasks        WorkspaceTask[]
}

model Report {
  id          String   @id @default(uuid())
  ...
  workspaceId String?
  taskId      String?
  workspace   Workspace?     @relation(fields: [workspaceId], references: [id])
  task        WorkspaceTask? @relation(fields: [taskId], references: [id])
}
```

---

## 5. 系统架构与流程（Arch）

1. 前端 Workspace 调用后端 `POST /workspaces` 创建/更新工作区。
2. 用户配置任务，前端 `POST /workspaces/:id/tasks` → 后端记录任务（PENDING）并调用 AI 服务 `POST /ai/workspace-tasks`。
3. AI 服务异步执行，后端轮询或接收回调更新任务状态（RUNNING→SUCCESS/FAILED），记录结果和成本。
4. 前端轮询 `GET /workspaces/:id/tasks/:taskId` 获取状态。
5. 任务成功后前端调用 `POST /reports/generate`（携带 taskId/模板参数）生成报告并保存。
6. Library 页面按 workspaceId 分类展示报告，支持导出 Markdown/PDF。

---

## 6. AI 流水线设计（AI）

- **步骤**
  1. 资源抽取：按类型生成结构化摘要，降低 token 消耗。
  2. 分析合成：根据模板类别使用对应提示词，输出结构化 JSON。
  3. 结构校验：执行 JSON Schema 验证；若失败按 `failureRecovery` 提示重试（最多两次）。
  4. 成本记录：记录模型、token 数、耗时。
  5. 返回结果：写入任务表 `result` 字段供前端预览与报告生成。

- **模型策略**
  - 默认组合：Grok 负责抽取/初步分析，GPT‑4 生成最终报告。
  - 失败策略：Grok 失败时可回退到 GPT‑4；若 GPT‑4 仍失败则标记任务失败并返回错误信息。

- **模板配置示例**

```json
{
  "id": "comparison.v1",
  "name": "生成对比分析",
  "category": "comparison",
  "version": 1,
  "description": "比较多个资源的关键差异与共性",
  "schema": { "...": "JSON Schema 略" },
  "promptConfig": {
    "extract": "针对以下资源生成结构化摘要...",
    "analysis": "请比较这些资源，围绕创新、优势、限制、适用场景...",
    "generate": "输出符合 schema 的 JSON，不要多余文本。",
    "validationHints": [
      "确保 comparisonTable 至少包含三个维度",
      "每个 insight 包含 resourceId 字段"
    ],
    "failureRecovery": [
      { "type": "json_error", "prompt": "你的 JSON 格式有误..." },
      { "type": "missing_field", "prompt": "结果缺少 {field} 字段..." }
    ]
  }
}
```

---

## 7. 前端设计（FE）

- **页面结构**
  - 左侧：资源列表（checkbox、全选、清空、类型标识）。
  - 中部：任务卡片（四种模板），卡片含描述与预计耗时。
  - 配置抽屉：选择模型、输入自定义问题、确认资源范围。
  - 右侧：任务日志时间线与 AI 聊天入口（沿用现有组件）。
  - 底部：操作区——生成报告、重试、查看历史。

- **关键组件**
  - `WorkspaceTaskCard`、`TaskConfigDrawer`、`TaskStatusTimeline`、`ReportPreviewRenderer`、`WorkspaceHistoryList`。
  - `useWorkspace` hook：负责加载工作区、创建任务、轮询状态、处理错误。

- **交互要点**
  - 任务创建即显示 PENDING 状态，周期轮询后端。
  - 任务成功后启用“生成报告”按钮并展示预览。
  - 报告生成成功后提供跳转至 Library 或继续生成的选项。

---

## 8. 后端接口（BE）

| Method & Path                              | 描述            | 请求                                           | 响应/备注                                                             |
| ------------------------------------------ | --------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/v1/workspaces`                  | 创建/更新工作区 | `{ resourceIds: string[] }`                    | 工作区 DTO                                                            |
| `GET /api/v1/workspaces/:id`               | 获取详情        | –                                              | 包含资源、任务状态                                                    |
| `PATCH /api/v1/workspaces/:id`             | 增删资源        | `{ addResourceIds?, removeResourceIds? }`      | 更新后的工作区                                                        |
| `DELETE /api/v1/workspaces/:id`            | 归档            | –                                              | success                                                               |
| `POST /api/v1/workspaces/:id/tasks`        | 创建任务        | `{ templateId, model, question?, overrides? }` | `{ taskId }`，含限流校验                                              |
| `GET /api/v1/workspaces/:id/tasks/:taskId` | 查询任务状态    | –                                              | `{ status, progress, queuePosition, estimatedTime, result?, error? }` |
| `POST /api/v1/reports/generate`            | 生成报告        | `{ taskId, templateId, title?, notes? }`       | Report DTO                                                            |
| `GET /api/v1/report-templates`             | 模板列表        | `?category`                                    | 模板数组                                                              |

- 限流：每用户并发 3、每小时 20 次，返回 429/`retryAfter`。
- 权限：确认 workspace.userId 与资源归属匹配。
- 日志：记录任务生命周期、模型、耗时、token。

---

## 9. QA 测试计划（QA）

- 功能测试：资源操作、四种模板任务成功流程、异常流程（资源不足、限流、AI 失败、JSON 校验失败）。
- API 测试：DTO 合规、错误码、限流提示。
- 前端 E2E：资源选择 → 任务执行 → 报告生成 → Library 查看/导出。
- 性能测试：并发任务耗时与成功率。
- 回归测试：确保现有报告生成、Library 功能不受影响。

---

## 10. 安全要求（Sec）

- 权限控制：所有 workspace/task/report API 验证 userId，阻止越权。
- 日志脱敏：不记录原文内容，prompt/response 做截断或哈希。
- 限流策略：后端与 AI 服务双层控制（可配置）。
- Prompt 注入防护：对用户输入进行转义，并在 prompt 中标记“以下为用户提供内容”。
- 数据存储最小化：必要时对敏感结果加密或脱敏存储。
- 上线前完成安全回归测试。

---

## 11. 任务列表（按角色）

**架构 / DevOps**

1. 更新 Prisma schema 与迁移脚本（含模板 seed）。
2. 输出 OpenAPI / TS DTO。
3. 设计 AI 服务通信（超时/重试），确定轮询策略。
4. 配置限流、日志脱敏、监控指标。
5. 更新部署脚本、feature flag、监控仪表。

**后端开发**

1. Workspace Controller/Service + DTO。
2. WorkspaceTask Service：创建任务、状态更新、AI 调度。
3. ReportTemplate Service：加载模板、模板 API。
4. 报告生成逻辑：根据 task.result 填充并保存。
5. 单元测试、集成测试、限流与权限验证。

**AI 服务开发**

1. 任务队列/状态管理（可先用内存/Redis）。
2. 模板加载器与 Prompt 生成器。
3. 抽取/分析/生成 pipeline。
4. JSON Schema 校验与重试逻辑。
5. REST API (`POST` 创建任务、`GET` 查询状态、`POST` 预览)。
6. 模型调用封装、token 成本记录。
7. 单元测试、监控与日志脱敏。

**前端开发**

1. `useWorkspace` hook 封装 API。
2. Workspace UI 改版：资源列表、任务卡、配置抽屉、状态日志。
3. 轮询任务状态、错误提示、进度展示。
4. 结果预览渲染（按模板组件化）。
5. 报告生成流程与 Library 集成（新增 Workspace 报告分类）。
6. 组件测试与 Playwright E2E。

**QA**

1. 功能/接口/性能用例编写。
2. 自动化测试脚本（Playwright/CI）。
3. 回归测试、缺陷跟踪、上线验收报告。

**安全**

1. 权限审计 checklist。
2. 日志脱敏方案验证。
3. 限流策略压测与验证。
4. 发布前安全审查。

---

## 12. 时间线建议

- **Week 1**：Kickoff、设计确认、schema/API 完成、模板配置。
- **Week 2-3**：前端/后端/AI 并行开发、联调。
- **Week 4**：QA 测试、灰度发布、监控调整。
- **Beta 阶段**：feature flag 控制，监测成功率与成本后再全量上线。

---

## 13. 里程碑与验收

- **M1 (Week1 End)**：迁移脚本、模板配置、API 契约、前端原型完成。
- **M2 (Week3 Mid)**：任务闭环（资源 → AI → 预览）跑通。
- **M3 (Week4)**：报告保存/导出、QA 通过、安全检查通过。
- **Final**：Beta 发布，成功率 ≥ 60%，关键指标稳定。

---

此文档用于指导 Workspace AI Reporting 基线实现，可配合任务管理工具分解后续工作。
