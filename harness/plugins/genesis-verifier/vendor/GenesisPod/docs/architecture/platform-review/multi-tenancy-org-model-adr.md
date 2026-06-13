# ADR: 账户与租户模型 —— 推迟 Organization，收口既有 User + Topic + Visibility 模型

> **状态**: **Decided（推迟 Organization 层；以既有模型为准）**
> **日期**: 2026-05-30（2026-05-30 修订：撤回先前"新建 Organization 模型"提案）
> **决策人**: 架构评审
> **背景**: [分层架构评审 G1](./2026-05-30-layered-audit.md) 把"多租户缺位"列为 critical。复审发现该判断**部分失真**——把"匹配 B2B 定位"误当成"模型有缺陷"。
> **核心结论**: 既有账户体系**自洽且基本完整**，真正缺的是**一致地执行已有模型**，不是新增 Organization 实体。遵循 CLAUDE.md 反过度抽象红线（只用一次/尚不存在的需求不抽象）。

---

## 1. 决策摘要（TL;DR）

**不新建 `Organization`/`OrganizationMember`。** 既有 Schema 已有一套刻意设计、自洽的租户三轴：

- **归属** = `userId`（每个资源都有）
- **访问控制/共享** = `ContentVisibility { PRIVATE | SHARED | PUBLIC }`
- **协作团队边界** = `Topic` + `TopicMember { role: OWNER/ADMIN/MEMBER/GUEST, @@unique([topicId,userId]) }`
- **子分组** = `workspaceId`

近期工作是**收口与强制执行这套已有模型**（堵 IDOR、让 visibility 真正生效、消除概念重叠），**而非引入平行租户层**。`Organization` 推迟到出现明确触发条件（见 §6）再做，且因迁移可随时进行，**推迟零成本**。

---

## 2. 撤回先前提案的理由（诚实记录）

先前版本提议新建 `Organization` + `OrganizationMember` + RBAC + 席位池，对标 OpenAI/WorkOS。复审实读 `models.prisma` 后否决，因为**我提议"新建"的东西大多已经存在**：

| 先前提议新建                           | 代码中已存在（实读确认）                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OrganizationMember(role)` 席位 + 角色 | `TopicMember { userId, role: TopicRole(OWNER/ADMIN/MEMBER/GUEST), @@unique([topicId,userId]) }`（models.prisma:1732） |
| 租户级共享可见性                       | `ContentVisibility { PRIVATE / SHARED / PUBLIC }`，注释"SHARED=所有者+同工作区/协作者可见"（models.prisma:7037）      |
| 协作团队边界                           | `Topic { visibility, members[], aiMembers[], knowledgeBases[], missions: TeamMission[] }`（models.prisma:1696）       |
| 子分组                                 | `workspaceId`（`AgentPlaygroundMission:9933` / `Workspace`）                                                          |

`AgentPlaygroundMission` 本身即带 `userId + visibility + workspaceId?`（models.prisma:9928-9933）。**设计意图齐全**——新增 Organization 是典型的"为尚不存在的需求做抽象"，违反项目红线。

---

## 3. 既有模型现状（实读确认，判定：自洽）

```
User { id, role: UserRole(平台级 super-admin) }          // 平台运维角色，与租户角色正交

# 归属轴
所有业务资源 { userId / createdById }                     // 个人归属

# 访问控制轴
ContentVisibility { PRIVATE | SHARED | PUBLIC }           // 资源可见性
AgentPlaygroundMission { userId, visibility, workspaceId? }

# 协作团队轴
Topic { createdById, visibility, type }                   // 团队/群组 = 协作边界
TopicMember { topicId, userId, role: OWNER/ADMIN/MEMBER/GUEST }  // ★ 成员+角色已存在
TeamMission { topicId, createdById }                      // mission 归属 Topic（多人）
TopicKnowledgeBase / TopicInvitation / TopicJoinRequest / VoteProposal  // 完整协作套件

# 计费 / 密钥轴
CreditAccount { userId @unique }                          // 每用户计费（谁用谁付）
Secret { userId? }                                        // 二态：null=系统 / userId=个人 BYOK
```

**判定**：作为一个"个人账户 + 可共享 + 可组队（Topic）"的模型，这是**自洽**的。两级（User + Topic）覆盖了个人使用与团队协作两种场景。

---

## 4. 真正缺的：执行一致性，不是新实体

> 以下都是"收口已有模型"，**不引入 Organization**。

### Gap-1 · ownership / visibility 未被强制执行（真 bug = IDOR）— P0

- **问题**：端点大多 `where:{ id, userId }`——既**漏了 `SHARED`**（visibility 功能实际没生效），又有端点**完全不校验归属**（横向越权）。
- **修法**：抽一个 `assertResourceAccess(resource, requester)` 统一判定：`own` ∨ (`SHARED` ∧ requester 是相关 `TopicMember`) ∨ `PUBLIC`；写操作要求 own 或 Topic 内足够 `TopicRole`。查不到/无权即 **404**。**全部用既有 `TopicMember` + `ContentVisibility`，零新表。**
- **验证**：B 用户访问 A 的 PRIVATE 资源→404；SHARED 且同 Topic→可读；新增 e2e 断言。

### Gap-2 · `workspaceId` 悬空（半截透传）— P1

- **问题**：写入但从不作过滤条件，悬空误导（评审 G6 也提到）。
- **修法（二选一，需 §5 决策）**：(A) 作为 user 内子分组一致使用（所有相关读写带 `workspaceId` 过滤）；(B) 若无产品需求则**删除**该列与透传。**默认倾向 (B) 删除**，除非 workspace 是明确在用的功能。

### Gap-3 · 概念重叠（真正的 MECE 问题）— P1

- **问题**：三个 grouping 概念重叠——`Workspace`（per-user，装 resources/tasks/reports）、`Topic`（multi-user，装 missions/KB）、mission 上的 `workspaceId` 列。
- **修法**：确立 **`Topic` 为 canonical 协作/共享边界**，`Workspace` 收敛为纯个人内容夹（或并入 Topic），`workspaceId` 按 Gap-2 处理。理清后补一条 doc 说明"何时用 Topic、何时用 Workspace"。

### Gap-4 · RAG 检索隔离 fail-closed — P1

- **修法**：`SimilaritySearchOptions` 过滤按 `userId + visibility + topic.knowledgeBases` 强制下推，缺失即拒（不全库返回）。**仍用既有边界**，不加 tenant 列。

### Gap-5 · 计费边界写明（不是改模型）— P0（纯文档/契约）

- **现状自洽**：`CreditAccount` per-user + TeamMission "谁发起谁付费"（`createdById`）。
- **修法**：把这条规则**明确写进契约/standards**（"team mission 由发起人账户扣费"），消除隐含假设。**只有当产品要"团队统一付费/席位"时才需要计费池**——那是 Organization 的触发点（§6），现在不做。

---

## 5. 需产品确认的唯一一点（不阻塞 P0）

`workspaceId` / `Workspace` 是否是在用的功能？

- **是** → Gap-2 走 (A) 一致使用 + Gap-3 明确 Workspace 与 Topic 分工。
- **否** → Gap-2 走 (B) 删除半截透传，Topic 作为唯一协作边界。

> 这不阻塞 P0（IDOR 修复用 userId+visibility+TopicMember，与 workspace 决策无关）。

---

## 6. Organization 何时才真正需要（推迟的触发条件）

**仅当出现以下具体场景，才引入 Organization 层**：

> 一个**法律实体（公司）需要统一拥有 / 集中计费 / 集中 admin / SSO / 席位管理**，跨越多个用户和多个 Topic。

典型信号：第一个 B2B 企业客户要求"公司账单一张、IT 集中管成员、SSO 登录、按席位购买"。在此之前，**User + Topic(visibility/member) 足够**。

**推迟为何零成本**：届时用 expand → backfill → contract 迁移随时可做——给相关表加可空 `organizationId`、把每个用户的资源回填到其"个人组织"、再焊死。模型设计上 `Organization` 会**坐在 `Topic` 之上**（Org 拥有多个 Topic + 集中计费/admin），而非取代 `TopicMember`——既有协作轴继续复用。

> 触发前不写任何 Organization 代码。本节仅为"未来真要做时不踩坑"的备忘，不构成当前工作项。

---

## 7. 与整改方案的映射（已相应缩小）

| 阶段 | 工作                                                                          | 对应整改方案                                          |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| P0   | Gap-1 IDOR：`assertResourceAccess`（own/SHARED+TopicMember/PUBLIC）查不到 404 | [RP-P0-2](./2026-05-30-remediation-plan.md)           |
| P0   | Gap-5 计费规则写进契约（纯文档）                                              | [RP-P0-2 附带](./2026-05-30-remediation-plan.md)      |
| P1   | Gap-2/3 `workspaceId` 收口 + Workspace/Topic 概念去重                         | [RP-P1-1（已缩小）](./2026-05-30-remediation-plan.md) |
| P1   | Gap-4 RAG fail-closed（按既有边界）                                           | [RP-P1-1](./2026-05-30-remediation-plan.md)           |
| —    | Organization 模型                                                             | **推迟，无工作项**（触发见 §6）                       |

---

## 8. 成功标准（可验证）

1. 跨用户访问他人 PRIVATE 资源 → 404 + 审计留痕；SHARED 且同 Topic → 可读。
2. `workspaceId` 要么处处作过滤、要么不存在——无悬空列。
3. `Topic` / `Workspace` 分工有明确 doc，无重叠歧义。
4. RAG 检索缺访问上下文 → fail-closed 拒绝，不全库返回。
5. team mission 扣费方在契约中明确（发起人账户）。
6. **零新增租户实体**（无 Organization/OrganizationMember）。
