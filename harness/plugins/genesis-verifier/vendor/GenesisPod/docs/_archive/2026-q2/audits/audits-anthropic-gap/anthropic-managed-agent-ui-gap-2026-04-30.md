# Agent Playground UI vs Anthropic Managed Agent 产品形态差距审计

**审计日期**: 2026-04-30
**审计范围**: frontend/app/agent-playground/、frontend/components/agent-playground/、backend/src/modules/ai-app/agent-playground/

---

## Section 1: Mission 配置流程

### 现状交互流

```
/agent-playground (Mission 列表 card grid + 搜索)
  → 新建 → /agent-playground/team
  → DemoLauncher：
      - topic 文本框 (4-200字 + 示例快填)
      - 基础三档：研究深度 / 输出语言 / 预算档位
      - 图文开关 + 审核层级 (minimal/default/thorough/paranoid)
      - 高级（可折叠）：文风 / 长度 / 受众
      - 预算估算条 (~X tokens / ~$X / X分钟)
  → 提交 → /agent-playground/team/[missionId]
  → MissionDetailPage：WS 实时事件 / 4s polling 兜底
      5 个 Tab：tasks / collab / report / references / cost
```

来源：`frontend/app/agent-playground/page.tsx`、`team/page.tsx`、`DemoLauncher.tsx`、`team/[missionId]/page.tsx`

### 对比 claude.ai Agent 配置

| 步骤                 | claude.ai | 我们                      | 状态     |
| -------------------- | --------- | ------------------------- | -------- |
| 输入 task            | ✓         | ✓ + 8 档位参数            | **超越** |
| 自动 plan + 用户审批 | ✓         | ✗ fire-and-forget         | **缺失** |
| plan 执行前编辑      | ✓         | ✗ 仅事后 Leader Chat 追加 | **缺失** |
| Agent 参数可视化配置 | ✓         | ✗ 5 个角色硬编码          | **缺失** |
| 执行中 pause/resume  | ✓         | ✗ 只能 cancel             | **缺失** |
| Session fork         | ✓         | ✗ 仅 rerun（从头）        | **缺失** |

**关键缺口**：现在是"设置参数 → 盲跑"。Anthropic 是"输入意图 → AI plan → 用户审批 plan → 执行"。后端 `MissionCheckpointService.listResumable()` + `cloneCheckpoint()` API 已有（`agent-playground.controller.ts:77-91`），**前端无 resume 入口**。

---

## Section 2: Skill / Tool / Memory 可视化

### 2.1 Skill — 完全不可视化

每个角色的 `skills` 数组（如 `researcher.skills = ['evidence-gathering']`）硬编码在 `TeamRosterPanel.tsx:ROLE_PROFILE`（`TeamRosterPanel.tsx:696-740`）—— **是展示字符串，不是真正的 SkillRegistry 注册**（呼应 memory `project_playground_skill_disconnect.md`）。

用户无法：

- 上传 SKILL.md / .zip
- 查看当前 agent 激活的 skill 列表
- 启用/禁用 skill

### 2.2 Tool — 只读展示

`AgentInspector` 模态展示 tools（来自硬编码 `ROLE_PROFILE.tools`），不是后端动态读取。

用户无法：

- 启用/禁用 tool
- 配置 allow/ask/deny 权限
- 运行前预览 tool 调用并审批

### 2.3 Memory — 黑盒

`MemoryIndexPanel` 只展示：chunks 数量 / namespace / tags。`CapabilityMeters` 只有"N chunks 已索引"。

用户无法：

- 查看 chunks 内容
- 增删改 memory
- 语义搜索

---

## Section 3: Trace / Observability UI

### 3.1 实时性

WebSocket 事件流 + 4s polling 兜底。`derive.ts` 推导视图，无手动刷新。粒度：agent lifecycle / narrative / 工具调用 / verifier verdict。

### 3.2 粒度对比

| 能力                                  | 现状        | 文件                            |
| ------------------------------------- | ----------- | ------------------------------- |
| 12-stage stepper 实时高亮             | ✓           | `MissionFlowView.tsx:49-76`     |
| Agent last thought                    | ✓           | `TeamRosterPanel.tsx:486-498`   |
| 工具调用 + 延迟表                     | ✓ ms 精度   | `ComputeUsagePanel.tsx:432-537` |
| 模型分布 + token/cost                 | ✓ 占比柱    | `ComputeUsagePanel.tsx:153-279` |
| Stage-level token/cost                | ✓ bar chart | `ComputeUsagePanel.tsx:281-335` |
| Agent 实例耗时（iter/retry）          | ✓           | `ComputeUsagePanel.tsx:337-430` |
| 返工/浪费分析                         | ✓ **独有**  | `ComputeUsagePanel.tsx:539-643` |
| 单次 LLM call prompt/response         | ✗           | —                               |
| 单次 tool call input/output           | ✗ 只有延迟  | —                               |
| 完整 ReAct trace (thought→action→obs) | ✗ 部分      | —                               |

### 3.3 Cost 展示

`CapabilityMeters` 总成本（USD 估算 + tokens）。`ComputeUsagePanel` 按模型/阶段/工具分层。**估算按 $3/1M tokens 固定系数，不是真实 Credits**。

**对比 claude.ai**：每次 LLM call 精确 token（prompt + completion 分开）+ 实时折线图 + tool call 完整 input/output。我们工具表只有次数和延迟。

### 3.4 Raw Event Log — 死组件

`RawEventLog.tsx` 存在于 `frontend/components/agent-playground/`，但 `[missionId]/page.tsx:57-65` 的 5 个 tab 中**未引用**。**对开发者不可访问**。

---

## Section 4: 能力差距矩阵

| Anthropic UI 能力          | 现状                  | 差距   | 优先级 | 工作量                              |
| -------------------------- | --------------------- | ------ | ------ | ----------------------------------- |
| **Mission 配置**           |                       |        |        |                                     |
| task 输入 + 参数设置       | ✓ 8 档位（更丰富）    | 无     | —      | —                                   |
| **plan 预生成 + 用户审批** | **✗ fire-and-forget** | **P0** | **P1** | L（新增 S0-plan + 审批 UI）         |
| plan 执行前编辑            | ✗ 仅事后追加          | P0     | P1     | M（复用 Leader Chat）               |
| 执行中 pause/resume        | API 有，UI 缺         | P1     | P2     | **S（前端接 /missions/resumable）** |
| Session fork               | ✗                     | P2     | P3     | L                                   |
| **Agent 配置**             |                       |        |        |                                     |
| Agent 可视化编辑           | ✗ 硬编码              | P1     | P2     | L                                   |
| Skill 上传                 | ✗                     | P1     | P2     | L                                   |
| Skill 启用/禁用            | ✗                     | P1     | P2     | M                                   |
| Tool 启用/禁用             | ✗ 只读                | P1     | P2     | M                                   |
| Tool allow/ask/deny        | ✗                     | P1     | P3     | L                                   |
| **Memory**                 |                       |        |        |                                     |
| Chunks 内容浏览            | ✗ 只数量              | P1     | P2     | M                                   |
| Memory 增删改              | ✗                     | P2     | P3     | M                                   |
| Memory 语义搜索            | ✗                     | P2     | P3     | L                                   |
| **Trace**                  |                       |        |        |                                     |
| 12-stage stepper           | ✓                     | 无     | —      | —                                   |
| Agent thought              | ✓                     | 轻微   | —      | S                                   |
| LLM call prompt/response   | ✗                     | P1     | P2     | M                                   |
| Tool call input/output     | ✗                     | P1     | P2     | M                                   |
| Raw event log              | **死组件**            | P2     | P3     | **XS（挂回 tab）**                  |
| Cost 逐 call 统计          | ✗ 聚合估算            | P1     | P2     | M                                   |
| **Session**                |                       |        |        |                                     |
| Mission 列表搜索           | ✓                     | 无     | —      | —                                   |
| rename / delete            | ✓                     | 无     | —      | —                                   |
| rerun（同配置）            | ✓                     | 无     | —      | —                                   |
| 可恢复列表                 | API 有，UI 缺         | P1     | P2     | **XS**                              |
| Export markdown/csv/json   | ✓                     | 无     | —      | —                                   |

### 总结

**领先项（独有优势）**：12-stage stepper / 实时 narrative / cost 多维分层 / 返工浪费分析。

**三大主要差距**：

1. **配置前用户审批缺失** — fire-and-forget 模式 vs claude.ai 的"plan→审批→执行"，**最大产品体验差距**
2. **Agent 配置不可触达** — instructions/skills/tools 黑盒
3. **Memory 黑盒** — 只有数量，对比 claude.ai 浏览/编辑 memory 形态

**最容易快赢（XS/S）**：

- 挂回 RawEventLog tab
- Mission 列表加"可恢复"入口（接已有 `/missions/resumable`）
- TodoDetailDrawer 显示完整 thought/action/observation 三元组
