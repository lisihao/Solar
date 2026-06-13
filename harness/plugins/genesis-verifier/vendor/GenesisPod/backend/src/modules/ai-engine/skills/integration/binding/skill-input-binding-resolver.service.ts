/**
 * AI Engine - Declarative Input Binding Resolver
 *
 * 根据 SKILL.md frontmatter 中的 inputs 声明，
 * 从 SkillOutputManager / globalContext / task.input 中自动提取数据。
 * 替代 SlidesTeamMember.buildSkillInput() 的 87 行 switch/case。
 */

import { Injectable } from "@nestjs/common";
import { SkillInputBinding } from "../../types/skill-md.types";

export interface BindingContext {
  /** SkillOutputManager or compatible map with get<T>(key) */
  outputManager?: { get<T>(key: string): T | undefined };
  /** 全局上下文 (globalContext) */
  context?: Record<string, unknown>;
  /** 任务直接输入 (task.input) */
  input?: Record<string, unknown>;
  /** 兼容: previousOutputs plain object */
  previousOutputs?: Record<string, unknown>;
}

/**
 * 声明式输入绑定解析器
 *
 * 解析规则:
 * - 无前缀:    SkillOutputManager.get(key) → from: "task-decomposition"
 * - context.:  globalContext[path]          → from: "context.sourceText"
 * - input.:    task.input[path]            → from: "input.targetPages"
 */
@Injectable()
export class InputBindingResolver {
  /**
   * 解析所有绑定声明, 返回合并后的输入对象
   */
  resolve(
    bindings: Record<string, SkillInputBinding>,
    ctx: BindingContext,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [name, binding] of Object.entries(bindings)) {
      const value = this.resolveOne(binding.from, ctx);

      if (binding.required && value === undefined) {
        throw new Error(
          `Required input binding "${name}" (from: "${binding.from}") not found`,
        );
      }

      if (value !== undefined) {
        resolved[name] = value;
      }
    }

    return resolved;
  }

  private resolveOne(from: string, ctx: BindingContext): unknown {
    // context.xxx → 从全局上下文读取
    if (from.startsWith("context.")) {
      const path = from.slice("context.".length);
      return this.getByPath(ctx.context, path);
    }

    // input.xxx → 从任务直接输入读取
    if (from.startsWith("input.")) {
      const path = from.slice("input.".length);
      return this.getByPath(ctx.input, path);
    }

    // 无前缀 → 从 SkillOutputManager 读取 (回退到 previousOutputs)
    if (ctx.outputManager) {
      const value = ctx.outputManager.get(from);
      if (value !== undefined) return value;
    }

    // 兼容: 尝试从 previousOutputs 读取
    if (ctx.previousOutputs) {
      return ctx.previousOutputs[from] ?? ctx.previousOutputs[`slides-${from}`];
    }

    return undefined;
  }

  private getByPath(
    obj: Record<string, unknown> | undefined,
    path: string,
  ): unknown {
    if (!obj) return undefined;
    return path.split(".").reduce<unknown>((curr, key) => {
      if (curr && typeof curr === "object") {
        return (curr as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }
}
