# W2 埋点下发材料（11 模块 emit 白名单 + payload 字段表）

> 用途：W2 启动时随白名单一并下发给 sub-agent，**防猜测**（评审 should-fix + Sub-Agent 红线：prompt 必须附接口/字段定义）。
> 状态：草案，含 3 个待解决缺口（见 §3）。点位由探子实读定位（行号会随代码变动，启动前复核）。

## 0. 统一约定（纠正探子自造名）

- **事件名统一为 `user.event`**，不要自造 `user.message.created` 之类。区分靠 payload 的 `module` + `action` 字段。
- emit 形态（fire-and-forget）：
  ```typescript
  void this.eventEmitter?.emit("user.event", {
    userId,
    module: "ai-xxx",
    action: "started", // 见字典
    resourceType: "XxxMission",
    resourceId,
    topicKey,
    success,
  });
  ```
- **必须在 prisma 写入成功之后** emit（确保 DB 已持久化）。
- payload 类型从 `common/observability/user-event.types.ts` import（W1 产出）。

## 1. 侵入度修正（重要）

W2 不是"每处加一行"。多数 service **未注入 EventEmitter2**，需先在构造函数加 `@Optional() private readonly eventEmitter?: EventEmitter2`（参考 `ai-app/feedback/` 已有用法、`office/slides-repository.ts:139` 的 `@Optional()` 范式）。

| 已有 EventEmitter2（直接 emit）                                   | 需加构造函数注入                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| ai-office(slides-repository)、topic-insights(orchestrator/report) | ai-teams、ai-writing、ai-ask、ai-image、ai-social、library |

> 仍属低风险机械改动，但白名单与 diff 审查必须覆盖"构造函数 + emit 行"两处，且**不得改其它构造逻辑**。

## 2. 点位表（mission/产物/动作落库点）

| 模块                | 文件:行                                                     | 方法                                       | action              | 可取字段                                             | 已有 EE2          |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------ | ------------------- | ---------------------------------------------------- | ----------------- |
| ai-research         | research/…/mission-execution.service.ts:1372                | resumeExecutionForNewTask                  | started(EXECUTING)  | missionId, topicId, userId(via topic.userId)         | **是**(L88)       |
| ai-research         | mission-execution.service.ts:1016                           | finalizeMission                            | completed           | missionId, topicId, userId                           | **是**            |
| ai-research         | mission-execution.service.ts:1577                           | continueExecution catch                    | failed              | missionId, topicId(已 include)                       | **是**            |
| ai-research         | mission-lifecycle.service.ts:475 / 332 / 515                | executePlanningAsync / createMission catch | started/failed      | missionId, topicId, userId                           | 否(需注入)        |
| ai-teams            | teams/…/mission-lifecycle.service.ts:1204                   | startMission                               | started             | mission.id, mission.topicId                          | 否                |
| ai-teams            | teams/…/team-mission.service.ts:3347                        | completeMission                            | completed           | missionId, mission.topicId, userId(需从 ctx)         | 否                |
| ai-teams            | team-mission.service.ts:1269 / 3461                         | catch 块                                   | failed              | mission.id, topicId                                  | 否                |
| ai-writing          | writing/…/writing-mission-lifecycle.service.ts:224/227/290  | 状态更新点                                 | started/failed      | projectId, userId                                    | 否                |
| ai-office           | office/…/slides-repository.ts:227                           | setMissionStatus                           | started             | missionId                                            | **是**(@Optional) |
| ai-office           | slides-repository.ts:339 / 321                              | completeMission / updateMissionError       | completed/failed    | missionId, userId(347行 select)                      | **是**            |
| topic-insights      | topic-insights/…/topic-team-orchestrator.service.ts:457     | initializeMission                          | started             | missionId(mid), topicId, userId(需从 ctx)            | **是**            |
| topic-insights      | report-synthesis.service.ts:148 / report-data.service.ts:69 | createDraftReport                          | completed           | topicId, version                                     | **是**            |
| ai-ask              | ask/ai-ask.service.ts:402                                   | 用户消息 create                            | started(仅辅助活跃) | session.userId, userMessage.id, sessionId(→topicKey) | 否(ctor:84)       |
| ai-image            | image/generation/generation.service.ts:764                  | GeneratedImage create                      | completed           | userId(可空), savedImage.id, prompt(→topicKey)       | 否(ctor:71)       |
| ai-social           | social/mission/services/publish-executor.service.ts:178     | 发布状态更新                               | published/failed    | content.userId, contentId, status枚举                | 否(ctor:27)       |
| library(Collection) | library/collections/collections.service.ts:93               | create                                     | saved               | userId, collection.id, name(→topicKey)               | 否                |
| library(Note)       | library/notes/notes.service.ts:67                           | create                                     | saved               | userId, note.id, note.resourceId                     | 否                |
| explore             | **未实现**                                                  | —                                          | viewed/shared       | —                                                    | —                 |

## 3. 待解决缺口（W2 启动前必须 close）

1. ~~ai-research 行号缺失~~ **已 close**：mission-execution.service.ts:1372(started)/1016(completed)/1577(failed) 均已注入 EE2 可直接 emit；mission-lifecycle.service.ts:475/332/515 需注入。已补进 §2 表。注意 research 也是按状态跃迁，topicKey 可用 topicId。
2. **explore 是空缺口** — `prisma.userActivity.create` 在代码中无调用（只有 schema）。explore 的 viewed/shared 埋点需**新建落库逻辑**，不属"纯 emit"，**单列为 W2-b**（或随 W5 前端浏览埋点一起做），不混入 W2-a 的机械 emit 批次。
3. **ai-office 落点澄清** — 探子定位到 `slides-repository.ts`（Slides 子能力），需确认运营要的 office 产出口径是 OfficeDocument 还是 SlidesMission；若两者都要，点位各自独立。**W2 前与 PRD §4.2 office 行对齐**。

## 4. W2 分批建议（控制 blast radius）

- **W2-a**（已有 EE2，最低风险）：ai-office、topic-insights —— 直接加 emit，先验证范式跑通。
- **W2-b**（需加构造函数注入）：ai-teams、ai-writing、ai-ask、ai-image、ai-social、library —— 逐模块白名单 + diff。
- **W2-c**（需新建逻辑）：ai-research(补点位后)、explore(UserActivity 落库) —— 单独处理。
- 每批：sub-agent prompt 附本文 §0 约定 + 该模块点位行 + payload 字段表 + 白名单（仅该模块的 service 文件）；完成后主 Agent 逐文件 diff，确认只动了构造函数注入 + emit 行。
