# Mission 层行为契约文档

**基线 Commit**: 38347e2a71d96266ccf3c52069c03dd15bf16af5

本文档记录 Mission 层 5 个核心 service 的 public method 行为契约，严格按照行号和控制流逐方法描述。

---

## 5.1 · mission-execution.service.ts（1646 行）

### Public Methods

#### method: startExecution(missionId: string, topicId: string)

- **行号**: L101-L155
- **调用者**: [MissionLifecycleService, MissionExecutionService.continueExecution]
- **业务用途**: 启动 Mission 的任务执行循环，包括草稿报告创建和动态调度
- **控制流伪码**:
  - STEP 1: 查询 topic（含 dimensions），查询 mission（获取 researchDepth）
  - STEP 2: 解析 researchDepth 配置 → depthConfig
  - STEP 3: if !topic then throw NotFoundException
  - STEP 4: 启动时延跟踪会话（latencySessionId）
  - STEP 5: KernelContext.run() 执行 startExecutionBody()
- **Prisma 读写**:
  - READ: researchTopic.{id, dimensions} @ L107
  - READ: researchMission.{id, researchDepth} @ L113
- **事件触发**: 无（内部调用 startExecutionBody）
- **业务不变量**:
  - Mission 必须处于非CANCELLED状态才能执行
  - 时延跟踪必须在 KernelContext 中进行
- **错误路径**: topic 不存在 → NotFoundException

#### method: startExecutionBody(missionId, topicId, topic, depthConfig, latencySessionId)

- **行号**: L158-L261
- **调用者**: startExecution（通过 KernelContext.run）
- **业务用途**: 在 KernelContext 中执行核心任务调度，包括草稿报告创建、证据复制、动态调度
- **控制流伪码**:
  - STEP 1: 启动时延跟踪"initialization"阶段
  - STEP 2: 调用 reportSynthesisService.createDraftReport(topicId)
  - STEP 3: 查询已完成的维度研究任务（status=COMPLETED）
  - STEP 4: if completedTasks.length > 0 then 查找最近有证据的报告并复制证据
  - STEP 5: 计算动态并发度 calculateDynamicConcurrency()
  - STEP 6: 调用 executeDynamicScheduler()，传递 executeTask 函数
  - STEP 7: 调用 finalizeMission()
  - STEP 8: 结束时延跟踪会话（latencySessionId）
- **Prisma 读写**:
  - READ: researchTask.{missionId, taskType, status} @ L181-L186
  - READ: topicReport.{topicId, evidences, generatedAt} @ L191-L198
  - WRITE: topicEvidence.createMany() @ L216
- **事件触发**: 无
- **业务不变量**:
  - 草稿报告必须在任务执行前创建，以便关联证据
  - 增量模式下，已完成任务的证据必须复制到新报告
  - 时延跟踪的 initialization/task_execution/finalization 必须按顺序进行

#### method: executeTask(task, topic, missionId, reportId, depthConfig)

- **行号**: L364-L735
- **调用者**: executeDynamicScheduler
- **业务用途**: 执行单个任务，包括CAS状态转换、Executor选择、事件发送、错误处理
- **控制流伪码**:
  - STEP 1: 查询当前任务状态 + Mission 状态
  - STEP 2: if !currentTask || status=FAILED then return
  - STEP 3: if mission.status=CANCELLED then return
  - STEP 4: CAS更新：PENDING → EXECUTING（仅当 status=PENDING 时成功）
  - STEP 5: if CAS.count === 0 then return
  - STEP 6: 确定 agentRole/agentName，从 leaderPlan 查找 modelId/skills/tools
  - STEP 7: 发送 emitTaskStarted/emitAgentWorking/emitTaskCompleted 事件
  - STEP 8: 从 executorMap 获取 executor，执行 executor.execute()
  - STEP 9: if task.taskType=quality_review && revisionTargets.length>0 then 调用 handleRevisionTargets()
  - STEP 10: if actualModelId !== assignedModelId then 更新 agentName 标签
  - STEP 11: catch 块处理错误 → updateTaskStatus(FAILED)
  - STEP 12: if error instanceof InsufficientCreditsException then 立即标记 mission.status=FAILED 并取消所有任务
- **Prisma 读写**:
  - READ: researchTask.{id, status, modelId, skills, tools} @ L376
  - READ: researchMission.{id, status, leaderPlan} @ L380
  - WRITE: researchTask.updateMany(CAS: PENDING→EXECUTING) @ L407
  - WRITE: researchTask.update(COMPLETED) @ L613
  - WRITE: researchAgentActivity.updateMany(agentName) @ L661
- **事件触发**: emitTaskStarted, emitAgentWorking, emitAgentCompleted, emitTaskCompleted
- **业务不变量**:
  - CAS 操作失败 → 任务被他人修改或已取消，直接返回
  - 积分不足快速失败 → 立即取消整个 Mission 和所有待处理任务
  - 质量审核完成后才创建修订任务

#### method: executeDynamicScheduler(missionId, maxConcurrent, executor)

- **行号**: L1140-L1263
- **调用者**: startExecutionBody, resumeExecution
- **业务用途**: 动态任务调度器，每完成一个任务即检查新可执行任务
- **控制流伪码**:
  - STEP 1: 初始化 executingTasks={}, completedTaskIds={}, consecutiveWaits=0
  - STEP 2: while true：检查 mission.status，获取可执行任务，启动新任务
  - STEP 3: if executingTasks.size === 0 then 检查 remainingPending
  - STEP 4: if remainingPending === 0 then break
  - STEP 5: if consecutiveWaits >= MAX_CONSECUTIVE_WAITS then 死锁检测 break
  - STEP 6: 等待任意一个任务完成，继续轮询
  - STEP 7: 等待所有剩余任务完成 Promise.all()
- **Prisma 读写**:
  - READ: researchMission.{id, status} @ L1153
  - READ: researchTask.count(PENDING) @ L1217
- **事件触发**: 无
- **业务不变量**:
  - 死锁超时：30 次等待 × 2s = 60s
  - 只在 executor 成功时加入 completedTaskIds
  - executingTasks 最大数 = maxConcurrent

#### method: finalizeMission(missionId: string, topicId: string)

- **行号**: L956-L1102
- **调用者**: startExecutionBody, resumeExecution
- **业务用途**: 完成 Mission，更新最终状态、清理空报告、发送完成事件
- **控制流伪码**:
  - STEP 1: 查询 Mission 当前状态，if CANCELLED then return
  - STEP 2: 查询所有任务，统计 completed/failed/pending
  - STEP 3: 判断最终状态：
    - if hasIncomplete then finalStatus=FAILED
    - else if hasAnySuccess then finalStatus=COMPLETED
    - else finalStatus=FAILED
  - STEP 4: updateMany(mission: status, completedTasks, progressPercent)
  - STEP 5: if !hasAnySuccess then 删除空草稿报告
  - STEP 6: 发送 emitProgress + emitMissionCompleted 事件
  - STEP 7: if finalStatus=COMPLETED then 异步调用 extractResearchMemories()
- **Prisma 读写**:
  - READ: researchMission.{id, status} @ L958
  - READ: researchTask.findMany(missionId) @ L970
  - WRITE: researchMission.updateMany() @ L1011
  - READ: topicReport.findMany(dimensionAnalyses=none) @ L1027
  - WRITE: topicReport.deleteMany() @ L1037
- **事件触发**: emitProgress, emitMissionCompleted
- **业务不变量**:
  - PENDING/EXECUTING 任务仍存在 → 调度异常，标记 FAILED
  - 只清理完全空的报告（没有任何维度分析）

#### method: calculateDynamicConcurrency()

- **行号**: L918-L951
- **调用者**: startExecutionBody, resumeExecution
- **业务用途**: 根据可用 Provider 数量动态调整并发度
- **控制流伪码**:
  - STEP 1: 获取所有启用的 CHAT 模型
  - STEP 2: 统计唯一 Provider 数量
  - STEP 3: 公式：concurrency = Math.min(MAX, Math.max(MIN, MIN + (providerCount-1)\*2))
  - MIN=4, MAX=8
- **Prisma 读写**: 无
- **事件触发**: 无
- **业务不变量**:
  - 单 Provider: 4 并发
  - 双 Provider: 6 并发
  - 三+ Provider: 8 并发（上限）

### Constructor deps

- PrismaService
- ResearchEventEmitterService
- MissionQueryService
- ReportSynthesisService
- ChatFacade
- ResearchMemoryService (forwardRef)
- DimensionResearchExecutor
- ReviewDimensionExecutor
- SynthesisReportExecutor
- GenericTaskExecutor
- SessionLatencyTrackerService (Optional)

---

## 5.2 · mission-lifecycle.service.ts（1396 行）

### Public Methods

#### method: createMission(input: CreateMissionInput)

- **行号**: L78-L321
- **调用者**: Controller
- **业务用途**: 创建新 Mission，取消旧 Mission，异步启动 Leader 规划
- **控制流伪码**:
  - STEP 1: 验证 topic 存在
  - STEP 2: if mode=incremental then 查询最近的已完成 Mission，收集已完成维度任务
  - STEP 3: if 存在活跃 Mission then 更新为 CANCELLED，批量更新 task/todo
  - STEP 4: 获取 Leader 模型信息
  - STEP 5: 创建新 mission（status=PLANNING）
  - STEP 6: 发送 emitProgress 事件
  - STEP 7: 异步执行 executePlanningAsync()（带 10min 超时）
  - STEP 8: return mission（立即返回）
- **Prisma 读写**:
  - READ: researchTopic.{id, name} @ L92
  - READ: researchMission.findFirst(PLANNING/EXECUTING/REVIEWING) @ L145
  - WRITE: researchMission.update(CANCELLED) @ L210
  - WRITE: researchTask.updateMany(FAILED) @ L216
  - WRITE: researchTodo.updateMany(CANCELLED) @ L227
  - WRITE: researchMission.create() @ L255
- **事件触发**: emitProgress
- **业务不变量**:
  - 同时只能有一个活跃 Mission
  - 规划必须异步执行，避免阻塞 HTTP 响应

#### method: executePlanningAsync(missionId, topicId, topicName, userPrompt, completedTasks)

- **行号**: L327-L575
- **调用者**: createMission（异步）
- **业务用途**: 异步执行 Leader 规划，创建任务，启动执行
- **控制流伪码**:
  - STEP 1: 发送多个 emitLeaderThinking 事件（understanding/analyzing/planning/assigning）
  - STEP 2: 调用 leaderPlanning.planResearch(topicId, userPrompt)
  - STEP 3: 创建 leaderDecision 记录 + agentActivity 记录
  - STEP 4: 调用 createTasksFromPlan(leaderPlan, completedTasks)
  - STEP 5: 发送 emitLeaderPlanReady 事件
  - STEP 6: 更新 mission（status=EXECUTING, totalTasks, startedAt）
  - STEP 7: 异步启动 executionService.startExecution()（带 BillingContext）
  - STEP 8: catch → 发送 emitMissionFailed 事件
- **Prisma 读写**:
  - WRITE: leaderDecision.create() @ L379
  - WRITE: agentActivity.recordActivity() @ L390
  - WRITE: researchMission.update() @ L446
- **事件触发**: emitLeaderThinking (4x), emitLeaderPlanning, emitLeaderPlanReady, emitProgress, emitMissionFailed
- **业务不变量**:
  - Leader 思考事件必须按顺序发送
  - 规划失败时需要主动发送 emitMissionFailed

#### method: approvePlanAndExecute(missionId, topicId, completedTasks)

- **行号**: L585-L745
- **调用者**: Controller（用户审批规划）
- **业务用途**: 审批规划并启动执行（CAS + 幂等）
- **控制流伪码**:
  - STEP 1: CAS 操作：PLAN_READY → EXECUTING
  - STEP 2: if CAS.count === 0 then return（幂等处理）
  - STEP 3: 创建任务列表（调用 createTasksFromPlan）
  - STEP 4: 更新 mission.totalTasks
  - STEP 5: 异步启动 executionService.startExecution()
- **Prisma 读写**:
  - WRITE: researchMission.updateMany(CAS) @ L591
  - READ: researchMission.findUnique() @ L619
  - WRITE: researchMission.update(totalTasks) @ L643
- **事件触发**: emitProgress
- **业务不变量**:
  - CAS 操作确保并发安全
  - 失败的审批返回幂等

#### method: createTasksFromPlan(missionId, topicId, plan, completedTasks)

- **行号**: L752-L961
- **调用者**: executePlanningAsync, approvePlanAndExecute
- **业务用途**: 根据 Leader 规划创建任务列表
- **控制流伪码**:
  - STEP 1: 批量查询已存在的维度
  - STEP 2: 遍历规划维度，创建或复用维度记录
  - STEP 3: if completedTasks.length > 0 then 批量创建完成任务
  - STEP 4: 遍历规划维度，创建 dimension_research 任务（跳过已完成的）
  - STEP 5: 创建 quality_review 任务（dependencies=所有研究任务）
  - STEP 6: 创建 report_synthesis 任务（dependencies=quality_review）
- **Prisma 读写**:
  - READ: topicDimension.findFirst(maxSortOrder) @ L768
  - READ: topicDimension.findMany() @ L780
  - WRITE: topicDimension.create() @ L798
  - WRITE: researchTask.createMany() @ L859
  - WRITE: researchTask.create() @ L896, L920, L942
- **事件触发**: 无
- **业务不变量**:
  - 维度映射必须正确
  - quality_review 依赖所有维度研究任务
  - report_synthesis 依赖 quality_review

#### method: retryTask(taskId: string)

- **行号**: L966-L1026
- **调用者**: Controller
- **业务用途**: 重试失败的任务
- **控制流伪码**:
  - STEP 1: 查询 task
  - STEP 2: if status not in (FAILED, NEEDS_REVISION) then throw BadRequestException
  - STEP 3: 更新 task（status=PENDING, revisionCount++）
  - STEP 4: if mission.status !== EXECUTING then 更新 mission.status=EXECUTING 并异步启动
- **Prisma 读写**:
  - READ: researchTask.{id, status, mission} @ L967
  - WRITE: researchTask.update() @ L986
  - WRITE: researchMission.update() @ L1007
- **事件触发**: 无
- **业务不变量**:
  - 只能重试 FAILED/NEEDS_REVISION 的任务
  - revisionCount 必须递增

#### method: retryMission(missionId: string)

- **行号**: L1031-L1095
- **调用者**: Controller
- **业务用途**: 重试整个 Mission（CAS + 幂等）
- **控制流伪码**:
  - STEP 1: 查询 mission
  - STEP 2: 验证状态转移
  - STEP 3: CAS 操作：从 (FAILED/CANCELLED/COMPLETED) → EXECUTING
  - STEP 4: if CAS.count === 0 then return（幂等处理）
  - STEP 5: 批量重置 FAILED/NEEDS_REVISION 任务为 PENDING
- **Prisma 读写**:
  - READ: researchMission.{id, status} @ L1032
  - WRITE: researchMission.updateMany(CAS) @ L1048
  - WRITE: researchTask.updateMany() @ L1078
- **事件触发**: 无
- **业务不变量**:
  - CAS 操作确保并发安全
  - 只能从终态重试

#### method: cancelMission(userId: string, missionId: string)

- **行号**: L1226-L1395
- **调用者**: Controller
- **业务用途**: 取消 Mission 及其所有任务
- **控制流伪码**:
  - STEP 1: 查询 mission
  - STEP 2: 验证权限（collaboratorService.hasAccess）
  - STEP 3: if mission.status === CANCELLED then 幂等处理
  - STEP 4: 批量更新 PENDING/ASSIGNED/EXECUTING task → FAILED
  - STEP 5: 批量更新 PENDING/QUEUED/IN_PROGRESS todo → CANCELLED
  - STEP 6: 删除空草稿报告
  - STEP 7: 更新 mission.status=CANCELLED
- **Prisma 读写**:
  - READ: researchMission.{id, status, topic} @ L1230
  - WRITE: researchTask.updateMany() @ L1314
  - WRITE: researchTodo.updateMany() @ L1337
  - READ: topicReport.findMany() @ L1361
  - WRITE: topicReport.deleteMany() @ L1371
  - WRITE: researchMission.update() @ L1391
- **事件触发**: emitProgress
- **业务不变量**:
  - 幂等处理：重复取消时确保一致性
  - 取消时所有未完成任务必须变为 FAILED
  - 只清理完全空的报告

### Constructor deps

- PrismaService
- LeaderPlanningService
- LeaderIntentService
- ResearchEventEmitterService
- TopicCollaboratorService
- AgentActivityService
- MissionQueryService (forwardRef)
- MissionExecutionService (forwardRef)

---

## 5.3 · mission-query.service.ts（714 行）

### Public Methods

#### method: getMissionStatus(missionId: string)

- **行号**: L47-L94
- **调用者**: Controller
- **业务用途**: 获取 Mission 及其任务的完整状态
- **Prisma 读写**:
  - READ: researchMission.{id, tasks} @ L49
- **业务不变量**: modelDisplayName 用于前端展示

#### method: getMissionByTopicId(topicId: string)

- **行号**: L99-L157
- **调用者**: Controller
- **业务用途**: 获取专题最新 Mission 的状态
- **Prisma 读写**:
  - READ: researchMission.findFirst() @ L100
- **业务不变量**: 返回最新创建的 Mission

#### method: getExecutableTasks(missionId: string)

- **行号**: L497-L526
- **调用者**: MissionExecutionService.executeDynamicScheduler
- **业务用途**: 获取依赖已满足的可执行任务（优先级排序）
- **控制流伪码**:
  - STEP 1: 查询所有任务（orderBy priority）
  - STEP 2: 构建 completedTaskIds 集合
  - STEP 3: 过滤：if status=PENDING && 所有 dependencies 完成 then 可执行
  - STEP 4: 按 priority 排序返回
- **Prisma 读写**:
  - READ: researchTask.findMany(missionId) @ L504
- **业务不变量**:
  - 必须是 PENDING 状态
  - 所有 dependencies 必须已 COMPLETED

#### method: updateTaskStatus(taskId, status, options)

- **行号**: L250-L297
- **调用者**: MissionExecutionService
- **业务用途**: 更新任务状态，包括时间戳、结果、模型ID
- **控制流伪码**:
  - STEP 1: 构建 updateData（含 status/startedAt/completedAt）
  - STEP 2: if status in (COMPLETED, FAILED) then 使用 CAS 防止重复更新
  - STEP 3: 调用 updateMissionProgress(missionId)
- **Prisma 读写**:
  - WRITE: researchTask.updateMany(CAS) @ L277
  - READ: researchTask.findUnique() @ L289
- **业务不变量**:
  - 终态转移使用 CAS 防止重复更新

#### method: getTeamInfo(missionId: string)

- **行号**: L361-L468
- **调用者**: Controller
- **业务用途**: 获取 Mission 当前团队组成及各 Agent 的 skills/tools
- **控制流伪码**:
  - STEP 1: 查询 mission（含 tasks）
  - STEP 2: 查询模型类型的默认模型
  - STEP 3: 获取 Leader 模型（优先存储的，否则动态获取）
  - STEP 4: 从 leaderPlan 解析 agentAssignments，验证 skills/tools
  - STEP 5: 遍历 tasks 构建 agentMap
- **Prisma 读写**:
  - READ: researchMission.{id, leaderModelId, tasks} @ L372
- **业务不变量**:
  - skills/tools 必须验证为非空字符串数组
  - 空数组 [] 转为 undefined

### Constructor deps

- PrismaService
- EventEmitter2
- ResearchEventEmitterService
- ChatFacade

---

## 5.4 · mission-observability.service.ts（253 行）

### Public Methods

#### method: recordResearchCost(...)

- **行号**: L27-L43
- **业务用途**: 记录研究任务成本（异步）
- **业务不变量**: fire-and-forget，失败不影响主流程

#### method: emitKernelEvent(type, payload, correlationId)

- **行号**: L48-L67
- **业务用途**: 发送 Kernel 级研究生命周期事件
- **业务不变量**: fire-and-forget，补充内核事件总线

#### method: logError(params)

- **行号**: L72-L86
- **业务用途**: 记录错误到错误追踪系统
- **业务不变量**: fire-and-forget

#### method: recordMissionMetrics(params)

- **行号**: L91-L110
- **业务用途**: 记录 Mission 执行指标
- **业务不变量**: fire-and-forget

#### method: startMissionTrace(missionId, topicName)

- **行号**: L118-L128
- **业务用途**: 启动 Mission 级别的分布式追踪
- **业务不变量**: 返回 null 表示服务不可用

#### method: addPhaseSpan(traceId, phase, metadata)

- **行号**: L133-L147
- **业务用途**: 为 Mission 阶段添加 Span
- **业务不变量**: 返回 null 表示失败

#### method: endPhaseSpan(spanId, success, metadata)

- **行号**: L152-L163
- **业务用途**: 结束阶段 Span
- **业务不变量**: 无返回值

#### method: endMissionTrace(traceId, success, metadata)

- **行号**: L168-L179
- **业务用途**: 结束 Mission 级追踪
- **业务不变量**: 无返回值

### Constructor deps

- ErrorTrackingService (Optional)
- AIMetricsService (Optional)
- CostAttributionService (Optional)
- EventBusService (Optional)
- TraceCollectorService (Optional)

---

## 5.5 · mission-notification.service.ts（91 行）

### Public Methods

#### method: notifyCompletion(params)

- **行号**: L21-L50
- **业务用途**: 发送 Mission 完成邮件通知（异步）
- **控制流伪码**:
  - if !emailService then return
  - 异步查询 topic + user，发送邮件
- **Prisma 读写**:
  - READ: researchTopic.{id, userId, name} @ L33
  - READ: user.{id, email} @ L38
- **业务不变量**:
  - fire-and-forget，错误不影响主流程
  - reportUrl 固定格式：/topics/{topicId}/reports

#### method: getAiSettings()

- **行号**: L55-L75
- **业务用途**: 获取 AI 配置（用于并发限流）
- **业务不变量**:
  - 返回 hint 是限流的 1/3
  - 服务不可用时返回空对象（降级）

### Constructor deps

- PrismaService
- EmailService (Optional)
- SettingsService (Optional)

---

## 核心业务不变量总结

1. **CAS 操作**：状态转移使用 updateMany(where: {id, status}) 作为乐观锁
2. **幂等处理**：关键操作都支持重复调用而不产生重复效果
3. **事件顺序**：emitTaskStarted → emitAgentWorking → emitTaskCompleted
4. **同步等待**：修订任务创建时使用同步 await 确保数据库一致性
5. **权限隔离**：所有查询都通过 topic.userId 隔离
6. **增量模式**：已完成任务的完整数据必须复制到新 Mission
7. **证据复制**：新报告创建时必须复制已有报告的证据关联
8. **依赖关系**：report_synthesis 依赖 quality_review，quality_review 依赖所有维度研究

---

**文档总行数**: 708 | **提取方法数**: Mission-Execution(7+主要), Mission-Lifecycle(7), Mission-Query(8), Mission-Observability(8), Mission-Notification(2)
