# Open API 目录结构规范（L4 系统/对外 API 网关）

**版本：** 2.0（2026-06-03 信任边界 MECE 重组）
**强制级别：** MUST
**生效日期：** 2026-06-03
**维护者：** Claude Code
**看护：** `backend/src/__tests__/architecture/layer-4-vocabulary/open-api-structure.spec.ts`（进 `verify:arch`）

> 本规范定义 `modules/open-api/`（L4）的子目录划分与命名。与 [16-ai-engine-harness-structure.md](16-ai-engine-harness-structure.md) 配套：HTTP 入口只属 L4 open-api 与 L3 ai-app；engine/harness/platform 不开 HTTP。
> 权威迁移图见 [docs/architecture/platform-review/2026-06-03-open-api-recursive-mece-attribution.md](../../docs/architecture/platform-review/2026-06-03-open-api-recursive-mece-attribution.md)。

---

## 一、定位

`open-api` = **不属于任何单一产品域的 HTTP 边界**。它承载：对第三方/机器的契约、跨域的第一方能力、平台运营与基建握手。它是**薄 HTTP 层**：controller 只做 HTTP 适配 + 鉴权 + 委派下层 service，**不含业务逻辑**（业务在 ai-app / ai-engine / ai-harness / platform 的 service 里）。

> **与 ai-app(L3) 的边界（两步 MECE 判据）**：
>
> 1. 端点是否属于**恰好一个产品域**（research / writing / teams业务 / ask / image / library / explore / office / social / simulation / topic-insights / ai-planning / radar / agent-playground / custom-agents / feedback）？
>    - 是 → 归 `ai-app/<该域>`（管理端点即该域的 admin 控制器）。
> 2. 否（跨域 / 平台级 / engine级 / harness级）→ 归 `open-api`，再按**调用方信任边界**落唯一一个区。

## 二、顶层 = 单轴「调用方信任边界」（4 区，MECE）

| 目录          | 放什么                              | 调用方 / 鉴权                           |
| ------------- | ----------------------------------- | --------------------------------------- |
| **external/** | 非第一方的对外契约 / 协议           | 第三方 / 机器，API-key / 协议 / 签名    |
| **admin/**    | 第一方运营，**仅跨域 / 平台级**治理 | 操作员，`AdminGuard` + `/admin/*`       |
| **system/**   | 平台基建 / 握手，**零业务**         | 平台自身 / 匿名（auth 握手、metrics）   |
| **user/**     | 第一方登录用户，**跨域通用能力**    | 登录用户 `JwtAuthGuard`（非单一产品域） |

### 区内子目录（受 spec 看护）

```
open-api/
├── external/   a2a · mcp · rest（对外 REST facade）· webhooks
├── admin/      providers · byok · secrets · billing · credits(admin) · quota · permissions ·
│               settings · monitoring · observability · logs · cache · db-ops · storage ·
│               approvals · notifications(admin) · eval · consolidation · kernel · harness ·
│               agent(harness AgentConfig) · ai(tools/skills/MCP 治理) · recommendations ·
│               dashboard · mcp(网关监控) · services · 根容器
├── system/     auth · metrics
└── user/       credits · notifications · agents · skills · ai
```

### 消歧问句

1. **属于某个产品域吗？** 是 → `ai-app/<域>`（不进 open-api）。
2. **第三方/机器吗？**（API-key/协议/签名）是 → `external/`。
3. **运营管平台/他人 + AdminGuard 吗？** 是 → `admin/`（且必须是跨域/平台级；单域治理回到第 1 步下沉）。
4. **平台握手/基建、零业务吗？**（auth/metrics）是 → `system/`。
5. 否则（登录用户的跨域自助/通用能力）→ `user/`。

## 三、铁律（MUST，spec 看护）

1. **顶层目录 ∈ `{external, admin, system, user}`** —— 信任边界单轴，禁止协议/资源轴混入顶层。
2. **区内子目录受控** —— `external ⊆ {a2a,mcp,rest,webhooks}`；`system ⊆ {auth,metrics}`（零业务）；`user ⊆ {credits,notifications,agents,skills,ai}`。
3. **admin 仅跨域/平台级** —— `admin/` 禁含任一产品域目录（research/knowledge/teams/...）；单域治理必须 `sink-to-domain` 到 `ai-app/<域>`。
4. **所有 `/admin/*` 路由唯一收在 `open-api/admin/`** —— 禁散落。
5. **薄网关** —— open-api controller 禁直接注入 `PrismaService` / 内嵌业务逻辑（下沉下层 service）。
6. **协议族用子目录分面** —— `external/mcp/{server,bridge,gateway,...}`、`external/a2a/{rpc,server}`，不平级散开。
7. **同名 class 全项目唯一** —— 跨区/跨层同名概念须带受众前缀消歧（如 `AiController`(user) vs `AiAdminController`(admin)；admin 版 teams 须 `AITeamsAdminController`）。

## 四、整改进度（收缩 ALLOWLIST，搬一个删一行）

- **T1 顶层移区（已落地 2026-06-03）**：`a2a/mcp/public/webhooks → external/{a2a,mcp,rest,webhooks}`；`agents/skills/ai → user/`；`system/{credits,notifications} → user/`；`system` 仅留 auth/metrics。**路由 URL 不变（非破坏）**。
- **T3 跨层下沉（已落地 2026-06-03，路由 URL 不变）**：
  - 顶层 `teams/`（`TeamsController`，mission HTTP）→ 已下沉 `ai-app/teams`，TeamsApiModule 折叠进 `AiTeamsModule`。**open-api 顶层 4 区已硬焊**。
  - `admin/research/templates` → `ai-app/research`；`admin/knowledge` → `ai-app/library/knowledge-graph`；`admin/ai-teams` → `ai-app/teams`（已改名 `AITeamsAdminController` 消歧）。
  - 这些下沉控制器**保留原 admin/\* 路由 URL（非破坏）**，物理归域；其 admin 路由在律1 `ADMIN_SCATTER_ALLOWLIST` 登记（单域治理归域 vs admin 路由收口的权衡）。
- **仍待办（独立 PR）**：路由 URL 规整（`admin/research/templates` 等 admin 前缀是否随域改）需确认别名策略后单独执行（破坏外部契约）。

## 五、参考

- 权威迁移图：[2026-06-03-open-api-recursive-mece-attribution.md](../../docs/architecture/platform-review/2026-06-03-open-api-recursive-mece-attribution.md)
- [16-ai-engine-harness-structure.md](16-ai-engine-harness-structure.md) App vs System、HTTP 接口面
