# Workspace AI Reporting – Implementation Task List

本文档整理按照阶段执行的详细任务，供团队落地 Workspace AI Reporting 功能时参考。编号为建议顺序，可根据实际进展调整。

---

## Phase 0 · 准备

1. **创建工作分支 & Feature Flag**
   - 新建 Git 分支（示例 `feature/workspace-ai-reporting`）。
   - 预留前后端/AI 服务使用的环境变量 `WORKSPACE_AI_V2_ENABLED`，实现统一的功能开关。
2. **模板配置草稿**
   - 在代码库中新建模板配置目录（例如 `configs/templates/`），为四个模板写入占位 JSON 文件。

## Phase 1 · 数据库与后端基础

3. **扩展 Prisma Schema**
   - 新增 `Workspace` / `WorkspaceResource` / `WorkspaceTask` / `ReportTemplate` 模型与关联字段，补充 `WorkspaceStatus`、`TaskStatus` 枚举。
   - 更新 `Report` 模型以关联 Workspace 与 Task。
   - 生成并验证 migration。
4. **模板 Seed 脚本**
   - 实现模板初始化脚本，导入四个内置模板。
5. **Backend DTO & 类型定义**
   - 定义 Workspace/Task/Template 相关 DTO、错误码、限流信息。
6. **Workspace Controller/Service 骨架**
   - 创建模块文件夹，落地 `POST /workspaces`, `GET /workspaces/:id` 的基础逻辑。
7. **WorkspaceTask Service 骨架**
   - 实现 `POST /workspaces/:id/tasks`、`GET /workspaces/:id/tasks/:taskId` 基础流程，先使用 mock 状态。
8. **ReportTemplate Service**
   - 加载模板配置并提供 `GET /report-templates` 接口。

## Phase 2 · AI 服务基础

9. **AI 服务任务模型**
   - 在 `ai-service` 创建任务存储结构（内存/Redis），定义任务 payload/状态类型。
10. **AI Service Endpoints**
    - 实现 `POST /api/v1/ai/workspace-tasks` 与 `GET /api/v1/ai/workspace-tasks/:id`，返回模拟状态。
11. **模板加载器**
    - AI 服务读取模板配置，与后端共用 Schema。

## Phase 3 · 后端与 AI 联通

12. **AI Client in Backend**
    - 实现与 AI 服务通信的 client，并在 WorkspaceTask Service 中调用。
13. **任务状态轮询**
    - 后端实现轮询机制或定时任务，更新 RUNNING 任务的状态。
14. **报告生成逻辑**
    - 使用任务结果填充模板，更新 `ReportsService.generateReport` 并写入 Workspace/Task 关联。

## Phase 4 · AI Pipeline 完整实现

15. **资源抽取器**
    - AI 服务按照资源类型生成结构化摘要，减少 token 使用。
16. **分析与模板填充**
    - 编排 Grok/GPT-4，生成符合 JSON Schema 的结果，处理 JSON 校验失败。
17. **成本 & 错误处理**
    - 记录模型、token、耗时，并返回标准化错误信息。

## Phase 5 · 前端实现

18. **API Client & Hook**
    - 实现 `useWorkspace` 等 hooks，封装与后端交互。
19. **Workspace UI 重构**
    - 设计资源列表、任务卡、配置抽屉、状态日志、结果预览等组件。
20. **报告预览与生成流程**
    - 渲染结构化结果，调用 `generateReport` 并跳转 Library。
21. **Library 集成**
    - 新增 Workspace 报告分类/标签，展示报告来源。

## Phase 6 · 测试与安全

22. **后端测试**
    - Service/Controller 单元与集成测试，覆盖限流与权限。
23. **AI 服务测试**
    - Pipeline 单元测试，JSON Schema 校验、失败重试。
24. **前端测试**
    - 组件测试与 E2E 流程（Playwright）。
25. **安全与限流**
    - 权限验证、限流压测、日志脱敏验证。
26. **监控与文档**
    - 配置监控指标、更新 README/部署文档、准备灰度方案。

---

团队可根据此列表在任务管理工具中创建对应事项，并对每项任务分配负责人与预计工期。
