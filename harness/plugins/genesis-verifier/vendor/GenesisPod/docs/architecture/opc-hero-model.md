# 一人公司 OS · 数字员工（实现机制，原「英雄」模型）

> 2026-06-08 决策落档。把"招人→组队→配工作流→配 CEO"四步墙折叠成"录用员工 + 配模型"两步。
>
> ⚠️ **术语已迁移（2026-06-09）**：本文的「英雄」一律对应对外呈现的「**专家 Agent**」（「专家」承载专业判断力，「Agent」承载智能感；实例名用职能头衔如「深度研究专家」）。定位、术语词表、信息架构以 [product-positioning.md](./product-positioning.md) 为权威；**本文仅作底层实现机制（capability/mission/数据层/执行层）的参考**，其中的「英雄」叫法不再用于 UI。
>
> **本文为一人公司 OS 实现机制的依据**，取代 [features/one-person-company-os/design.md](../features/one-person-company-os/design.md) 中的组织/团队模型（该文 §1–§5 / §7 / §9 已降级为隐藏的进阶/兼容路；其 §6 / §10 后端映射仍有效）。

## 核心模型

**英雄 = 一个领域指挥官 capability（Leader + 内置工作流 + 自带兵种 + 技能工具）。**
用户 = 团长/CEO，只做两件事：① 收英雄 ② 给英雄配一个模型。下任务给英雄，英雄自己把兵种（Researcher/Writer/Reviewer…）拉起来干活。

底层 80% 已存在：`marketplace/capability` 中台 + `deep-insight` capability（`CapabilityRegistry.resolve(missionType)`）本质就是一个英雄；mission 的能力驱动路 `runViaCapability` 不依赖持久化团队就能跑。

## 决策（2026-06-08 用户拍板）

1. 旧的组队/招人/CEO 5-Tab：**隐藏**。
2. 单买 agent/技能/工具的进阶组件：**隐藏**（市场只露英雄）。
3. 首登：**自动送一个 deep-insight 英雄**（models 留空 → 引擎自动择优，0 配置即用）。

## 数据层

```prisma
model CompanyHero {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  capabilityId String   @map("capability_id")  // e.g. "deep-insight"
  name         String
  models       String[]                          // 模型槽（有序 fallback）
  autoFallback Boolean  @default(true) @map("auto_fallback")
  createdAt    DateTime @default(now()) @map("created_at")
  @@index([userId])
  @@map("company_heroes")
}
// CompanyMission: team_id 改可空 + 新增 hero_id（二选一）
```

旧 team/agent/workflow 表保留（兼容 + 进阶路），英雄主流程不碰。

## 执行层

```
createHeroMission(heroId, title)
  → CompanyHero → capabilityId + models[0]
  → CapabilityRegistry.resolve(capabilityId).run(input, { userId, preferredModelId, stream })
  → 兵种自动扇出 → 落 CompanyMission.result
```

v1 全英雄/兵种共用英雄的模型；后续再支持 per-兵种 override。

## API（/company，JwtAuthGuard）

- `GET /company/heroes` — 我的英雄（空则自动补 deep-insight 默认英雄）
- `POST /company/heroes` `{capabilityId}` — 收英雄
- `PATCH /company/heroes/:id` `{name?,models?,autoFallback?}`
- `DELETE /company/heroes/:id`
- `POST /company/heroes/:id/missions` `{title}` — 派单（走 capability）

## 前端

- 侧栏：我的团队→我的英雄；Agent 市场→英雄市场。
- 英雄市场：主货架=英雄（workflow listing，missionType=capabilityId），收下英雄→adoptHero(missionType)；agent/skill/tool 货架隐藏。
- 我的英雄：英雄卡列表 + 每卡一个模型下拉 + 改名 + 移除（替代旧 5-Tab）。
- 我的任务：下发弹窗"选团队"→"选英雄"；gallery + 详情（MissionDetailFrame + 组织架构图）不动。
- store：heroes + loadHeroes/adoptHero/configHero/removeHero/createHeroMission。

## 分期

1. 后端：CompanyHero 表 + 手写迁移 + heroes CRUD + 派单走 capability。
2. 前端：store + 我的英雄页 + 市场英雄货架 + 派单选英雄。
3. 收尾：默认英雄、隐藏旧 Tab、侧栏改名。
