# 010. 全自驱 Agent Team 的 HITL 采用阶段边界 gate

**日期**: 2026-06-04
**状态**: 已采纳

## 背景

自驱执行中用户需要中途干预（暂停/审批/追加指令）。两种粒度：阶段边界（stage-gate）vs token 级硬杀。审视核实：`ReActLoop` 内层无流式路径，token 级中断要动内层循环、撞反向洞察 #1/#2，回归风险高；而项目已有可复用的阻塞审批原语。

## 决策

1. v1 采用**阶段边界 gate**：`MissionPipelineOrchestrator.run()`（纯顺序 for 循环）阶段间插 `await` 控制信号。token 级硬杀推迟 v1.5。
2. **P4a（单 pod）复用既有** `ai-engine/tools/.../human-approval.tool.ts:waitForHumanResponse()`（DB 持久 + 真阻塞 + 超时兜底）+ `harness/lifecycle/human-approval-admin.service.ts` 应答侧。
3. **P4b（跨 pod）**新增 Redis pub/sub 控制信道 + DB 持久（现 EventBus 仅进程内）。
4. **超时降级**：gate 默认 10min → 配置决定 auto-reject 或挂 PAUSED。
5. reject 回退**复用 business-team checkpoint/rerun**；append 经 `PromptInjectionDetector.check()` + `sanitizePromptInput()` 后注入 `CrossStageState`。

## 理由

- 阶段边界已满足"看到不对→停/改/继续"，避免高风险内层改造。
- 复用既有审批原语显著降低 P4 工作量与风险。

## 影响

- 正面：低风险、可增量（P4a→P4b）、复用成熟原语。
- 负面：中断粒度为 stage（秒级），非即时；跨 pod 需新基础设施（P4b）。

## 替代方案

- token 级硬杀 v1 → 否决：动 ReActLoop 内层、撞反向洞察 #1/#2、回归风险高。
- 从零建 HITL 阻塞设施 → 否决：已有 `waitForHumanResponse` 可复用。
