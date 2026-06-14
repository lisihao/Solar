# 11 · Capability Discovery（v1 · **已作废**）

> **本文档 v1 版本已作废。**  
> **请移步**：[11-target-architecture.md](./11-target-architecture.md)（v2 · 单 harness 目标架构）+ [12-target-migration-plan.md](./12-target-migration-plan.md)（迁移计划）

## 为什么作废

本 v1 版本成文于 2026-04-23 上午，描述"L2 通用环境发现 + L3 harness-local reconciler"的**两 harness 并存**架构。当天审视后确认：

- 目标架构是**单 harness 在 L2**，L3 只写 spec，不自造 Agent 运行时
- v1 的"L3 harness-local reconciler 依赖 HarnessAgentRegistry" 违反目标架构
- v1 的"两 harness 并存"是过渡态，不是终态，不该进入设计文档

因此本文档**重写**为 11-target-architecture.md（v2）+ 12-target-migration-plan.md，分别承担"终态定义"和"执行计划"职责。本文件仅保留作为废弃标记，不作为任何实施依据。
