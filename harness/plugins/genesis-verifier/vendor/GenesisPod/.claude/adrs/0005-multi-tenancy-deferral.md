# ADR-0005: 多租户隔离 —— 推迟 Organization 层，以既有 User + Topic + Visibility 为租户模型

> **创建日期**: 2026-05-30
> **作者**: 架构评审（P0 整改）
> **状态**: 已接受 (Accepted)

---

## 上下文

2026-05-30 分层架构评审（整体成熟度 6.5/10）把"多租户缺位"列为 critical：`userId` 是全栈唯一隔离单元，多个面向资源端点只校验登录不校验归属（IDOR）。初稿提议新建 `Organization` + `OrganizationMember` + RBAC + 席位池（对标 OpenAI/WorkOS）。

复审实读 `prisma/schema/models.prisma` 后发现：提议"新建"的能力大多已存在——`TopicMember`(userId + role + 唯一约束) 即成员/角色、`ContentVisibility`(PRIVATE/SHARED/PUBLIC) 即访问控制轴、`Topic` 即协作边界、`workspaceId` 即子分组。新建 Organization 是"为尚不存在的需求做抽象"，违反 CLAUDE.md 反过度抽象红线。

## 决策

**不新建 Organization/OrganizationMember 层。** 以既有 `User(归属) + ContentVisibility(访问控制) + Topic/TopicMember(协作边界) + workspaceId(子分组)` 为租户模型。P0 范围内只做"一致执行已有模型"：

- 收口 IDOR：所有 mission 读端点统一 `assertReadAccess`(own ∨ PUBLIC，否则 404)，写/删/预算端点 own-only。（已实现）
- 真正缺的是执行一致性，不是新实体。

**Organization 层推迟**，触发条件：出现一个法律实体（公司）需要统一拥有/集中计费/集中 admin/SSO/席位 跨多个用户和 Topic。届时用 expand→backfill→contract 迁移引入 `organizationId`（坐在 Topic 之上，不取代 TopicMember），推迟零成本。

## 残留（未在 P0 落地，待后续）

- SHARED 协作读：`AgentPlaygroundMission` 无 `topicId` 列，SHARED 暂按 PRIVATE 处理（不杜撰数据源）；落 topicId + 注入 isTopicMember 后激活。
- L1 计费/密钥/配额仍 user-scoped；org 维度待触发条件出现。

### `workspaceId` 状态澄清（PG-01，2026-05-31 platform-review wave1）

`AgentPlaygroundMission.workspaceId` **写入但读路径/授权不消费**：所有读端点仅按 `userId` 过滤，`assertReadAccess` 只判 `own ∨ PUBLIC`。本次评审确认这是「写了不用」的列，易被误当作已生效的隔离边界。**决策（用户拍板）**：保留该列但在 schema 字段显式标注为 **future-reserved**（`///` 注释），当前隔离粒度 = **user 级**（自洽且安全，非owner→404 已运行时验证）。

workspace 级共享读尚无明确产品需求；落地时按 expand→backfill→contract：补 `mission ↔ workspace` 成员关系 + 把读端点谓词改为 `(userId OR workspaceId ∈ 用户所属 workspace)`，与上方 Organization 触发条件解耦（workspace 级共享可先于 Org 层出现）。

## 参考资料

- [详细 ADR：多租户 Org 模型决策](../../docs/architecture/platform-review/multi-tenancy-org-model-adr.md)
- [分层架构评审报告 G1](../../docs/architecture/platform-review/2026-05-30-layered-audit.md)
- [整改方案 RP-P1-1](../../docs/architecture/platform-review/2026-05-30-remediation-plan.md)

## 变更历史

| 日期       | 版本 | 变更内容 | 作者     |
| ---------- | ---- | -------- | -------- |
| 2026-05-30 | 1.0  | 初始版本 | 架构评审 |
