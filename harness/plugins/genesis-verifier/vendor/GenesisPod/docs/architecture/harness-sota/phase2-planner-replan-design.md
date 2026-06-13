# 阶段二设计：动态规划接线（T6 LLM Planner + T7 自适应 Replan）

> 来源：ai-harness vs 业界 SOTA 差距评估 G1「造好却没接线」。teams-collab 评分 5.0（最低）。
> 本文是**实现前设计稿**，按 CLAUDE.md「架构决策必须确认」等批准后再动 orchestrator。
> 所有行号基于 `origin/main`（已核实 origin/main 的增量提交未触及本文涉及文件）。

## 1. 目标与可验证标准

| 项  | 目标                                                   | 强成功标准                                                                                                                  |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| T6  | `plan()` 在高复杂度任务上调用 LLM 分解，而非纯静态模板 | 集成测试：高复杂度 intent → `plan.steps` 来自 LLM 分解且依赖图合法；LLM 失败/低复杂度 → 回落静态 workflow，mission 仍可执行 |
| T7  | `replan()` 结果真正应用到运行中的 DAG                  | 测试：步骤失败且有 pending 依赖 → replan 后 `plan.steps` 被改写且依赖合法；replan 次数超上限 → 停止重规划而非死循环         |

## 2. 现状（已核实，file:line）

### plan() 是静态模板（`teams/orchestrator/teams-mission-orchestrator.ts:977-1058`）

- 纯遍历 `team.workflow.steps` 生成 `ExecutionStep[]`，再追加 `review`(1018-1030) + `delivery`(1033-1044)。
- **零** LLM 调用。

### decomposeTask() 完整实现但零 live 调用点

- `teams/base/leader-llm-adapter.ts:83-169`：LLM 驱动，返回 `SubTask[]`，**自带兜底**（catch → 返回单个默认 subtask，154-168）。
- `Leader.decomposeTask()` 包装在 `teams/base/member.ts:214`，但 orchestrator 的 `plan()`/`executePlan()` 从不调用。

### replan() 算了就扔（`teams-mission-orchestrator.ts:1298-1349`）

- `shouldReplan()`(1330) 正确返回布尔；`replan()`(1336) 算出 `ReplanResult`（addedSteps/removedSteps/modifiedSteps），但 1344-1347 是 TODO，结果被丢弃。
- 位置：在 step 执行失败的 catch 路径内（1293 `step_failed` 之后）。

### executePlan 调度模型（关键，决定 T7 可行性）（`1074-1121`）

```
while (completedSteps.size < plan.steps.length) {
  const executableSteps = plan.steps.filter(
    (step) => !completedSteps.has(step.id) &&
              step.dependencies.every((dep) => completedSteps.has(dep)));
  if (executableSteps.length === 0 && completedSteps.size < plan.steps.length)
    throw "Deadlock detected";
  ...
}
```

**每个 tick 重新 filter `plan.steps`、终止条件读 `plan.steps.length`** → 运行中改写 `plan.steps` 会在下一 tick 自动被拾取。这是 T7 干净可行的前提。

### 类型

- `ExecutionStep`：`{id, name, description, executor, type, dependencies: string[], estimatedDuration, estimatedCost, timeout?}`
- `SubTask`：`{id, parentTaskId, description, suggestedRole, dependencies: string[](subtask id), estimatedDuration(ms), priority}`
- `ReplanResult`：`{replanned, addedSteps: ReplanStep[], removedSteps: string[], modifiedSteps: {stepId, changes}[], reasoning}`

## 3. T6 设计：把 decomposeTask 接进 plan()

### ⚠️ 实现前必处理的前置条件（核实新发现）

1. **`leader.availableRoles` 生产中从未被填充**——`setAvailableRoles()` 仅在测试中调用（`teams/base/member.ts:190`，唯一 caller 是 `member.spec.ts`）。`Leader.decomposeTask(task)` 只接收 task、内部读 `this.availableRoles`，为空时 LLM 只会得到默认 `["researcher"]`。**强证据：此 LLM 规划路径从未真正在生产跑过。** → plan() 必须先 `leader.setAvailableRoles([...new Set(team.members.map(m => m.role.id))])` 再 decompose。
2. **`team.leader` 类型是 `ITeamMember`**（`team.interface.ts:111`），`decomposeTask`/`setAvailableRoles` 在 `ILeader` 上 → 需类型守卫（`"decomposeTask" in team.leader`）窄化。
3. `member.role` 是 `IRole` 对象（非字符串）→ 取 RoleId 用 `m.role.id`。
4. `SubTask.suggestedRole` 来自 LLM 自由字符串 → executor 解析 `getMembersByRole(suggestedRole)` 空则兜底 leader（已在映射表）。

### 触发条件（保守，默认不改变现有行为）

- 仅当 `intent.complexity.overall === "high"` **且** 环境 flag `HARNESS_DYNAMIC_PLANNING === "true"`（默认 off，灰度）时走 LLM 分解。
- 其余一律走现有静态 `workflow.steps`（零行为变更）。

### 流程（插在 `plan()` 的 985 行之后，替换静态循环的来源）

```
1. if (!dynamicEnabled || intent.complexity.overall !== "high") → 现有静态路径
2. const subtasks = await team.leader.decomposeTask(taskInput, availableRoles, persona)
3. if (subtasks.length <= 1) → 回落静态路径
   （decomposeTask 兜底返回单 subtask，等于"没分解成功"，静态 workflow 更丰富）
4. steps = subtasks.map(mapSubTaskToExecutionStep)   // 见下表
5. 照常追加 review + delivery（依赖指向所有叶子 step）
```

### SubTask → ExecutionStep 映射

| ExecutionStep 字段  | 来源                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `subtask.id`（保持一致，使 dependencies 直接可用）                                                                                                                                                                                                |
| `name`              | `subtask.description` 截断，或 `子任务 ${i+1}`                                                                                                                                                                                                    |
| `description`       | `subtask.description`                                                                                                                                                                                                                             |
| `executor`          | `team.getMembersByRole(subtask.suggestedRole)[0]?.id ?? team.leader.id`（角色解析失败兜底 leader）                                                                                                                                                |
| `type`              | `"task"`（**风险已排除**：`executeStepFull`(1466+) 按 `executor` + `executor.skills` 分派，**不读 step.type**；`mapStepType`(2515-2519) 仅产出 `"review"`/`"task"`。动态步骤设 `type:"task"` + 解析好 `executor` 即与静态 task 步骤执行路径一致） |
| `dependencies`      | `subtask.dependencies`（已是 subtask id == step id）                                                                                                                                                                                              |
| `estimatedDuration` | `subtask.estimatedDuration`                                                                                                                                                                                                                       |
| `estimatedCost`     | `this.estimateStepCost(duration, constraints.cost.modelPreference)`                                                                                                                                                                               |
| `timeout`           | 复用静态步骤的默认 timeout 策略                                                                                                                                                                                                                   |

### Fallback（多层，保证不退化）

- decomposeTask 内部已 catch → 单 subtask；plan() 再判 `<=1` 回落静态。
- 任意映射异常 → try/catch 整体回落静态 workflow + `logger.warn`。
- flag 默认 off → 现网零影响。

### T6 验证

- 单测：高复杂度 + flag on + mock decomposeTask 返回 3 subtask → `plan.steps` = 3 + review + delivery，依赖合法。
- 单测：decomposeTask 返回单 subtask / 抛错 → `plan.steps` == 静态 workflow。
- 单测：flag off → 永远静态。

## 4. T7 设计：应用 replanResult 到运行中的 DAG

### 应用算法（替换 1344-1347 的 TODO）

```
// 防抖：每个 mission 限 N 次 replan
if (state.replanCount >= MAX_REPLANS) {           // MAX_REPLANS = 2，建议
  logger.warn("replan budget exhausted");
} else {
  state.replanCount++;
  // 1. 删除（仅允许删未开始的步骤，禁止删 completed/running）
  const removable = replanResult.removedSteps.filter(
    (id) => !completedSteps.has(id) && !state.currentSteps.includes(id));
  plan.steps = plan.steps.filter((s) => !removable.includes(s.id));
  // 2. 修改（仅 pending 步骤）
  replanResult.modifiedSteps.forEach((m) => { /* 应用 m.changes 到对应 step */ });
  // 3. 新增（id 唯一；dependencies 必须引用现存 step）
  const valid = replanResult.addedSteps.filter(
    (s) => !plan.steps.some((e) => e.id === s.id) &&
           s.dependencies.every((d) => plan.steps.some((e) => e.id === d) || completedSteps.has(d)));
  plan.steps.push(...valid.map(toExecutionStep));
  // 4. 重新校验依赖图（无环、无悬空依赖）→ 不合法则回滚本次 replan
  this.validatePlanDependencies(plan.steps);   // 若无此方法则实现期补
  yield this.createEvent("plan_revised", missionId, { added, removed, reason });
}
```

### 安全约束（血的教训对齐）

- **禁止删除 completed/running 步骤**（破坏 completedSteps 计数与 intermediateOutputs）。
- **新增步骤依赖必须可达**，否则触发 executePlan 的 `Deadlock detected`(1120)。
- **replan 预算上限**（`MAX_REPLANS`，存 `state.replanCount`）防 fail→replan→fail 无限循环。
- 由于 executePlan 是 ready-set 重评估循环，mutation 下一 tick 自动生效，**无需重启循环**。

### T7 验证

- 单测：step 失败 + 有 pending 依赖 → replan 后 `plan.steps` 含 addedSteps、不含 removable，依赖合法，下一 tick 调度新步骤。
- 单测：replanResult 试图删 completed 步骤 → 被过滤，不影响计数。
- 单测：连续失败触发 replan 超过 MAX_REPLANS → 停止 replan，不死循环。
- 单测：addedSteps 带悬空依赖 → 校验拦截 / 回滚，不进入 deadlock。

## 5. 风险与回滚

- ~~最大风险：动态 step 的 type 分派~~ **已排除**（核实 `executeStepFull:1466+` 按 `executor`+`executor.skills` 分派，不读 step.type；`mapStepType:2515` 仅产 review/task）。动态步骤设 `type:"task"` + 解析 `executor` 即可正常执行。
- **次风险**：executor 解析——`getMembersByRole(suggestedRole)` 在 LLM 给出团队不存在的角色时返回空，已兜底 `team.leader.id`。
- **回滚**：T6 flag 默认 off；T7 在失败 catch 内、受 MAX_REPLANS 限制，且 `validatePlanDependencies` 不过即回滚本次 replan。两者均不改变 flag-off / 无 replanner 时的现网行为。
- 两项独立可分别 PR：T6 一个 PR（plan 主路径，flag 灰度），T7 一个 PR（replan 应用）。

## 6. 决策（默认值，可推翻）

1. **触发策略**：`intent.complexity.overall === "high"` + `HARNESS_DYNAMIC_PLANNING` flag（默认 off 灰度）。理由：最小化现网影响 + 只在真正复杂任务上花 LLM 分解成本。
2. **MAX_REPLANS = 2**。理由：覆盖"失败→换路→再失败一次"，超此即应人工/终态，防抖。
3. **T7 v1 仅支持 add/remove**。`ReplanResult.modifiedSteps.changes` 当前是自由文本 `string`，无法机械 apply；modify 路径**留待**把 `changes` 结构化为 `{field, value}` 后的 T7 v2。v1 先落 add/remove（已能解决"失败步骤的 pending 依赖需重排"的主用例）。

---

**实现顺序**：T6（flag 灰度）独立 PR → 验证 → T7 v1（add/remove）独立 PR。
均从干净 `origin/main` 切分支，避免重蹈"基底落后 12 提交"的坑。
