/**
 * AI Engine Facade — Base Classes
 * 轻量子模块，仅导出 Agent/Tool 基类
 *
 * ★ 此文件与 index.ts（主 barrel）分离，避免循环依赖。
 *   index.ts 加载 70+ 模块形成的 import 链会回到自身，
 *   导致 class 在 extends 时为 undefined。
 *   base-classes.ts 只导出 3 个基类，不拉入服务层，零循环风险。
 *
 * 用法：
 *   import { PlanBasedAgent } from "../../../ai-engine/facade/base-classes";
 *   import { ... } from "@/modules/ai-harness/facade";
 */

// PR-X5: BaseAgent / PlanBasedAgent moved to ai-harness/agents/base
export { BaseAgent } from "../agents/base/base-agent";
export { PlanBasedAgent } from "../agents/base/plan-based-agent";
export type { IPlanBasedAgent } from "../agents/base/plan-based-agent";
export { BaseTool } from "../../ai-engine/tools/base/base-tool";
