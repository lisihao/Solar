# 目录结构规范

**版本：** 2.0
**强制级别：** MUST
**更新日期：** 2025-12-13

---

## 核心原则

- Monorepo 结构 - 前端、后端、AI服务统一管理
- 分组模块化 - 按领域分组，组内模块化
- 清晰的分层 - API层、业务层、数据层明确分离
- 一致的命名 - ai-\* 前缀统一AI相关模块
- 易于导航 - 新开发者能快速找到代码

---

## 项目总体结构

```
genesis/
├── frontend/                          <- Next.js 前端服务
├── backend/                           <- NestJS 后端服务
├── ai-service/                        <- Python AI服务
├── .claude/                           <- 规范和配置
│   ├── standards/                     <- 规范文档库
│   ├── tools/                         <- 自动化工具
│   ├── agents/                        <- AI Agent 配置
│   └── config/                        <- 项目配置
└── docs/                              <- 项目文档
```

---

## Backend 目录结构 (NestJS)

### 分组模块架构

后端采用**分组模块化**架构，将模块按业务领域分为5个组：

```
backend/src/
├── main.ts                            <- 应用入口
├── app.module.ts                      <- 根模块
├── app.controller.ts                  <- 健康检查
│
├── common/                            <- 共享代码
│   ├── prisma/                        <- Prisma ORM 服务
│   ├── graph/                         <- 知识图谱服务 (PostgreSQL CTE)
│   ├── rawdata/                       <- 原始数据服务 (PostgreSQL JSONB)
│   ├── ai-orchestration/              <- AI 调度服务
│   ├── streaming/                     <- SSE 流式响应
│   ├── content-processing/            <- 内容处理服务
│   ├── filters/                       <- 异常过滤器
│   ├── guards/                        <- 守卫
│   ├── interceptors/                  <- 拦截器
│   ├── pipes/                         <- 管道
│   └── decorators/                    <- 装饰器
│
└── modules/                           <- 业务模块（按领域分组）
    ├── ai/                            <- AI 模块组
    ├── content/                       <- 内容模块组
    ├── core/                          <- 核心模块组
    ├── data-services/                 <- 数据服务模块组
    └── integrations/                  <- 集成模块组
```

### AI 模块组 (modules/ai/)

所有AI相关功能，统一使用 ai- 前缀：

```
modules/ai/
├── ai-core/                           <- AI 核心服务
├── ai-agents/                         <- AI Agent 管理
├── ai-ask/                            <- AI 问答会话
├── ai-image/                          <- AI 图像生成
├── ai-office/                         <- AI Office (文档/PPT)
│   ├── ai-office.module.ts
│   ├── ai-office.controller.ts
│   ├── ai-office.service.ts
│   ├── ppt/                           <- PPT 生成子模块
│   └── dto/
├── ai-simulation/                     <- AI 模拟推演
├── ai-studio/                         <- AI Studio 项目
└── ai-teams/                          <- AI 团队协作
```

### Content 模块组 (modules/content/)

```
modules/content/
├── collections/                       <- 收藏集
├── comments/                          <- 评论
├── explore/                           <- 探索 (含 YouTube)
├── feed/                              <- 信息流
├── notes/                             <- 笔记
├── reports/                           <- 报告
├── resources/                         <- 资源管理
└── workspace/                         <- 工作空间
```

### Core 模块组 (modules/core/)

```
modules/core/
├── admin/                             <- 管理后台
├── auth/                              <- 认证授权
└── storage/                           <- 文件存储
```

### Data Services 模块组 (modules/data-services/)

```
modules/data-services/
├── blog-collection/                   <- 博客采集
├── crawler/                           <- 爬虫服务
├── data-collection/                   <- 数据采集
├── data-management/                   <- 数据管理
├── knowledge-graph/                   <- 知识图谱
└── recommendations/                   <- 推荐服务
```

### Integrations 模块组 (modules/integrations/)

```
modules/integrations/
├── proxy/                             <- 代理服务
└── wechat-work/                       <- 企业微信
```

---

## Frontend 目录结构 (Next.js)

> **2026-05-20 重写**：旧版规范与实际代码严重背离（规范定 `shared/` 实践走 `common/`、
> 列了不存在的 `ai-studio`、未定义最大的 `common/` 与 `services/`）。本版以既成事实
> 为准重新定义边界，作为整改与新代码的唯一权威。

### 七大顶层目录职责（必须严格遵守）

| 目录                    | 职责                                                                                                                                          | 禁止                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `components/ui/`        | 无业务设计系统：primitive + app-agnostic composite（Button/Dialog/**cards**/**page-header-hero**/table/states/nav/form 等），可在任何项目复用 | 含任何 feature 业务逻辑 / API 调用              |
| `components/common/`    | **跨 feature 复用**的业务/领域组件（citations/mission-detail/selectors 等），**按 concern 子目录组织，根目录禁堆散落文件**                    | 单 feature 专属组件 / 纯 UI primitive（归 ui/） |
| `components/{feature}/` | 单 feature 专属组件（`ai-social`/`ai-radar`/`admin`/`explore`/`library`...）                                                                  | 被其他 feature import（要复用就上提 common）    |
| `components/layout/`    | 全局布局（AppShell/Sidebar/MobileNav）                                                                                                        | feature 局部布局                                |
| `lib/`                  | **纯逻辑**：无 React、无 HTTP。derive/transform/parse/格式化/常量/类型                                                                        | `fetch`/`axios`/任何网络调用、React hook        |
| `services/`             | **所有 API 调用**：HTTP 客户端 + SSE 流 + 各 feature 的 API service                                                                           | 纯逻辑（放 lib）、React hook（放 hooks）        |
| `hooks/`                | React hooks（`core` 通用 / `domain` 业务 / `swr` 数据 / `features` 复合 / `utils` 工具 hook）；**禁止散落在 `hooks/` 根**                     | 非 hook 的纯函数（放 lib）、`hooks/` 根的散文件 |
| `contexts/`             | React Context（全局跨树状态，如 AuthContext）                                                                                                 | 能用 props/Zustand 解决的局部状态               |
| `stores/`               | Zustand 全局 store                                                                                                                            | 单组件本地 state                                |

### lib vs services 边界（最易混淆，必读）

```
判断："这段代码发网络请求吗？"
  发 → services/{feature}/*.ts        （HTTP/SSE，如 ai-social/task-api.ts）
  不发 → "它依赖 React 吗？"
          依赖 → hooks/                （useXxx）
          不依赖 → lib/{feature}/*.ts  （纯逻辑，如 ai-social/derive-social-stages.ts）

通用层：
  lib/api/      → 通用 HTTP 客户端 + SSE 基建（被 services 复用）
  lib/utils/    → 跨 feature 纯工具（auth/config/common/格式化）
  lib/constants/ lib/types/ → 全局常量 / 类型
```

> **反模式**：`lib/{feature}/` 和 `services/{feature}/` 同时存在且职责混乱（同 feature 逻辑横跨两处）。
> 正确：feature 的 API 全进 `services/{feature}/`，纯逻辑全进 `lib/{feature}/`，不交叉。

### lib/ 分层：feature 单独出来 + platform 留根（2026-05-20 更新）

> **背景**：业务（feature）与平台（platform）在 `lib/` 根混平铺 → 乱、无规则。
> **决策：feature 业务纯逻辑全部收进 `lib/features/{feature}/`；platform（①②）留在 `lib/` 根。**
> 一眼规则：在 `features/` 下 = 业务；在 `lib/` 根（非 features/）= 平台。每个 lib 内容必属下列三层之一：

| 层                  | 含义                                      | 判定                             | 现有成员                                                                                                                |
| ------------------- | ----------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ① 全局平台          | 全站基建 / 全局物                         | 名字即固定四桶                   | `api/`（唯一允许 HTTP 基建）`utils/`（跨 feature 纯工具）`constants/` `types/`                                          |
| ② 跨 feature 技术库 | **无业务**的可复用"小框架"，≥2 feature 用 | 不绑任何 feature，是技术能力     | `markdown/` `annotation/` `cache/` `storage/` `workers/` `animations/` `design/` `templates/` `text-selection/` `i18n/` |
| ③ feature 纯逻辑    | 单 feature 的 derive/transform/parse      | **归 `lib/features/{feature}/`** | `features/ai-social/` `features/agent-playground/` `features/ai-office/` `features/admin/` `features/notion/` …         |

```
新建 lib 文件该放哪？
  1. 是全站基建（HTTP/工具/常量/类型）？     → ① api / utils / constants / types
  2. 无业务、多 feature 复用的技术能力？      → ② lib/{tech}/（如 markdown、cache）
  3. 只服务单一 feature 的纯逻辑？            → ③ lib/features/{feature}/
  （都不发网络、都不依赖 React——否则见上方 lib vs services / hooks 判定）
```

> **已知豁免**：`lib/i18n/i18n-context.tsx` 含 React Context，严格说违反"lib 无 React"，
> 但全站以 `@/lib/i18n` 引用、迁移 churn 大，作为历史既成事实保留，不作为新代码先例。
> **强制**：feature 纯逻辑必须归 `lib/features/{feature}/`，**不得散落在 `lib/` 根与 platform 平铺**。
> platform（①②）留 `lib/` 根，无需再套 `lib/platform/`——根上非 `features/` 的目录即 platform。
>
> **③ 生成产物豁免**：`lib/generated/`（`changelog.json` 被 `lib/utils/changelog.ts` import、
> 构建期 `ai-app-docs/` 被 `next.config.js` bundle）属生成产物，原地保留并列入看护白名单，
> 不算 feature 也不算技术库。`byok/`、`wiki/` 同 ② 技术库白名单（看护 `ALLOWED_LIB_ROOT` 已含）。

### components 三层判断

```
新组件该放哪？
  1. 无任何业务、纯展示 primitive？        → components/ui/
  2. 多个 feature 都会用的业务组件？        → components/common/{concern}/
  3. 只有一个 feature 用？                  → components/{feature}/
  4. 全局布局骨架？                         → components/layout/

复用升级路径：feature 专属组件被第 2 个 feature 需要时，
立即上提 components/common/，不允许复制粘贴第二份。
```

> **归属边界铁律（2026-05-21，卡片乱放事故后立）**：
>
> - **纯 UI primitive / app-agnostic composite → `components/ui/{concern}/`**（cards、page-header-hero 都是；已从 common/ 收回）。卡片**只**许在 `components/ui/cards/`（audit **R15** 焊死）。
> - **`common/` 必须按 concern 子目录组织，根目录禁堆散落 `.tsx`**（存量 grandfather 冻结，禁新增）。
> - **新增 `ui/` 或 `common/` 的 concern 目录前，先在看护测试白名单登记**（= 评审闸门），否则 pre-push 拒推。
> - 看护：`frontend/__tests__/protection-net/component-placement.spec.ts`（pre-push `[0c]` + CI）+ `audit-ui-discipline` R15（pre-push `[4/6]`）。**规则只写文档没用——必须有机器守护，否则必漂移。**

### App Router 结构

```
frontend/app/
├── page.tsx           <- 首页
├── layout.tsx         <- 根布局
├── api/               <- API Routes (BFF 代理 / rewrite 见 next.config.js)
├── {feature}/         <- 每个 feature 一个路由段（ai-social/ai-radar/...）
│   ├── layout.tsx     <- feature 级 layout（包 AppShell）
│   └── {sub}/page.tsx <- 子路由
└── auth/              <- 认证页面
```

> **page.tsx 规范**：page 只做路由 + 取参 + 渲染顶层组件，业务逻辑放
> `components/{feature}/XxxPage.tsx`。feature 级 `layout.tsx` 统一包 `AppShell`，
> 子页面不重复包（见 ai-social/ai-radar layout 模式）。
>
> **agent 团队 mission 类功能**（ai-teams/ai-social/ai-radar/ai-insights/agent-playground/ai-writing…）
> 的列表层 + 详情/执行层呈现，统一遵循 [21-agent-teams-presentation.md](21-agent-teams-presentation.md)
> （模板源 = agent-playground：事件流 → 纯派生 → 共享 mission-detail 框架）。

### 第一层目录白名单与定位（看护锁定）

> **2026-05-20 新增**：第一层目录已被自动化看护锁定。新增/删除第一层目录前**必须先改本白名单 + 看护测试**，否则 pre-push 拒推。历史偏差 `types/`（已并入 `lib/types/`）、`pages/`（已删，纯 App Router）已清除。

第一层**仅允许**以下三类目录，白名单之外一律拒绝：

#### A. 核心七层（源码主体，依赖单向 `app → components → hooks/stores/contexts → services → lib`）

| 目录          | 定位                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `app/`        | App Router 路由层：`page.tsx`（只取参+渲染）/ `layout.tsx`（包 AppShell）/ `api/`（BFF 代理） |
| `components/` | React 组件层（三层：`ui` / `common` / `{feature}` / `layout`）                                |
| `lib/`        | 纯逻辑层（无 React、无 HTTP；含 `lib/api` 唯一 HTTP 基建 + `lib/types` 全局类型）             |
| `services/`   | API 调用层（所有 HTTP + SSE，按 `{feature}/api.ts` 组织）                                     |
| `hooks/`      | React Hooks 层（`core` / `domain` / `swr` / `features` / `utils`；禁止散落在 `hooks/` 根）    |
| `contexts/`   | React Context 层（全局跨树状态，如 AuthContext）                                              |
| `stores/`     | Zustand 全局 store 层（按 feature 切片）                                                      |

#### B. 支撑目录

| 目录         | 定位                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/` | **仅放跨切面 / 元测试**：① protection-net 元测试（lint / config / 目录结构）② **跨模块**集成 / 契约测试。**任何只测单一模块的测试（含 fixture 驱动的回归套件）必须 colocated** 到 `{module}/__tests__/`，其 fixture 也随之 colocated（如 `lib/agent-playground/__tests__/__fixtures__/`） |
| `public/`    | Next.js 静态资源                                                                                                                                                                                                                                                                          |
| `scripts/`   | 前端工具脚本                                                                                                                                                                                                                                                                              |

#### C. 构建产物 / 依赖（gitignore，非源码）

`node_modules/`、`coverage/`、`.next/` —— 磁盘存在但不纳入规范。

> **测试放置判断**：「这个测试只测某一个模块吗？」是 → colocated 到该模块旁（`lib/agent-playground/__tests__/` 等）；否（跨模块 / fixture 语料 / 元测试）→ 顶层 `__tests__/`。

#### 看护机制（不可绕过）

1. **看护测试** `frontend/__tests__/protection-net/first-level-directory-structure.spec.ts`：读真实第一层目录比对 `ALLOWED_DIRS` 白名单 + 禁止 `types`/`pages` 复活，含反向证据。
2. **pre-push 无条件拦截** `.husky/pre-push` `[0c]` 步骤独立全量跑该测试。⚠️ 不能依赖 `[3/6]` 的 `vitest run --changed`——目录增删不在 vitest 依赖图里，`--changed` 抓不到。
3. **CI 全量兜底** `npm run test:ci:frontend` 必含该测试。

> **新增合法第一层目录的流程**：先在本白名单 + 测试 `ALLOWED_DIRS` 登记，再建目录。

---

## AI Service 目录结构 (Python/FastAPI)

```
ai-service/
├── main.py                            <- FastAPI 应用入口
├── routers/                           <- API 路由
│   ├── ai.py                          <- AI 通用路由
│   ├── report.py                      <- 报告生成
│   ├── trend.py                       <- 趋势分析
│   └── workspace.py                   <- 工作空间
├── services/                          <- 业务逻辑
│   ├── ai_orchestrator.py             <- AI 服务编排
│   ├── grok_client.py                 <- Grok API 客户端
│   ├── openai_client.py               <- OpenAI 客户端
│   └── trend_analysis.py              <- 趋势分析
├── models/                            <- 数据模型
├── configs/                           <- 配置文件
├── utils/                             <- 工具函数
└── requirements.txt                   <- Python 依赖
```

---

## 命名规范

### 模块命名

| 类型     | 规范      | 示例                          |
| -------- | --------- | ----------------------------- |
| AI 模块  | ai-{功能} | ai-office, ai-teams, ai-core  |
| 内容模块 | {功能}    | reports, resources, workspace |
| 数据服务 | {功能}    | crawler, data-collection      |
| 集成模块 | {平台}    | wechat-work, proxy            |

### 文件命名

| 类型          | 规范                 | 示例                      |
| ------------- | -------------------- | ------------------------- |
| NestJS 模块   | {name}.module.ts     | ai-office.module.ts       |
| NestJS 控制器 | {name}.controller.ts | ai-office.controller.ts   |
| NestJS 服务   | {name}.service.ts    | ai-office.service.ts      |
| React 组件    | {Name}.tsx           | SlideEditor.tsx           |
| 工具函数      | {name}.ts            | context-builder.ts        |
| 测试文件      | {name}.spec.ts       | ai-office.service.spec.ts |

---

## 导入路径规范

### Backend 相对路径

```typescript
// 模块内部导入
import { SomeService } from "./some.service";

// 同组模块导入
import { AuthModule } from "../auth/auth.module";

// 跨组模块导入
import { ReportsModule } from "../../content/reports/reports.module";

// 公共模块导入
import { PrismaService } from "../../../common/prisma/prisma.service";
```

### Frontend 路径别名

```typescript
// 使用 @/ 别名
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { config } from "@/lib/utils/config";
import { getAuthTokens } from "@/lib/utils/auth";
```

---

## 添加新功能的规范

### 添加新的 AI 模块

```bash
# 1. 创建模块目录
mkdir -p backend/src/modules/ai/ai-{name}

# 2. 创建必要文件
touch ai-{name}.module.ts
touch ai-{name}.controller.ts
touch ai-{name}.service.ts

# 3. 在 app.module.ts 中导入
# 4. 创建对应前端页面和组件
```

### 添加新的前端业务模块

```bash
# 1. 在 lib/ 下创建业务逻辑目录
mkdir -p frontend/lib/{name}

# 2. 在 components/ 下创建组件目录
mkdir -p frontend/components/{name}

# 3. 在 app/ 下创建页面
mkdir -p frontend/app/{name}
```

---

## 检查清单

提交代码前检查：

- [ ] 模块放在正确的分组目录下
- [ ] AI 相关模块使用 ai- 前缀
- [ ] 导入路径使用正确的相对路径
- [ ] 新模块已在 app.module.ts 中注册
- [ ] 测试文件与源代码在同一目录
- [ ] Python 包目录有 **init**.py
- [ ] 前端使用 @/ 路径别名

---

## 常见问题

### Q: 新功能应该放在哪个分组？

按照这个优先级判断：

1. 是否是 AI 功能？-> modules/ai/
2. 是否是内容管理？-> modules/content/
3. 是否是数据采集/处理？-> modules/data-services/
4. 是否是第三方集成？-> modules/integrations/
5. 是否是核心基础设施？-> modules/core/

### Q: 前端工具函数放哪里？

- 特定业务逻辑 -> lib/{业务名}/
- 通用工具 -> lib/utils/
- API 调用 -> lib/api/

### Q: 跨模块依赖如何处理？

- 尽量减少跨组依赖
- 必要时通过 common/ 共享服务
- 使用事件驱动解耦

---

**记住：** 好的目录结构让项目易于理解和维护。分组模块化设计让代码组织清晰，新开发者能快速上手！
