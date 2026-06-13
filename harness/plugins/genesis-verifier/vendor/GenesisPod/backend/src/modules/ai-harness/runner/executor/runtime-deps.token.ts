/**
 * Engine 端 executor 运行时依赖契约（loose duck-typed）
 *
 * 这些是 engine executor 在运行时由 ai-harness 注入的能力，engine 在此声明契约。
 * harness 端的具体类（ProgressTrackerService / CheckpointManager / TraceCollectorService）
 * 实现/匹配这些契约，并由 setter 注入到 executor。
 *
 * ★ engine 不能 import ai-harness（保持单向依赖）。
 * ★ 这里使用宽松鸭子类型签名，接受任何运行时形状兼容的实现。
 *   实际类型由 harness 端定义；engine 仅在调用面声明它"要哪几个方法"。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IProgressTracker {
  create: (...args: any[]) => any;
  start: (...args: any[]) => any;
  startPhase: (...args: any[]) => any;
  updatePhaseProgress?: (...args: any[]) => any;
  completePhase: (...args: any[]) => any;
  skipPhase: (...args: any[]) => any;
  failPhase: (...args: any[]) => any;
  complete: (...args: any[]) => any;
  fail: (...args: any[]) => any;
  cancel?: (...args: any[]) => any;
  getProgress?: (...args: any[]) => any;
  getTask?: (...args: any[]) => any;
  getActiveTasks?: (...args: any[]) => any;
  cleanup?: (...args: any[]) => any;
  onProgress?: (...args: any[]) => any;
  onComplete?: (...args: any[]) => any;
  onFail?: (...args: any[]) => any;
}

export interface ICheckpointManager {
  createCheckpoint: (...args: any[]) => any;
}

export interface ITraceCollector {
  startTrace: (...args: any[]) => any;
  addSpan: (...args: any[]) => any;
  endSpan: (...args: any[]) => any;
  endTrace: (...args: any[]) => any;
}
