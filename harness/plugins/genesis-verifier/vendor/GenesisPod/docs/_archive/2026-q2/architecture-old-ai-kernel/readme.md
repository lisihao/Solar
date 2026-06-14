# L2 AI Kernel — 内核层

> 进程管理、IPC、记忆、资源调度

## 模块路径

`backend/src/modules/ai-kernel/`

## 职责

- Mission 进程管理 (MissionExecutorService)
- 事件日志 (EventJournalService)
- 内核记忆管理 (KernelMemoryManagerService)
- 资源调度 (ResourceManagerService, KernelSchedulerService)
- 约束执行 (ConstraintEnforcementService)
- 成本归因 (CostAttributionService)
- 事件总线 (EventBusService)
- 进度追踪 (ProgressTrackerService)
- 断路器 (CircuitBreakerService)
- 能力守卫 (CapabilityGuardService)

## 设计原则

- 所有服务通过 `ai-kernel/facade` 对外暴露
- AI App 层通过 `@Optional()` 注入 Kernel 服务，实现优雅降级

---

最后更新: 2026-03-05
