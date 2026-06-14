/**
 * SpecAgentRegistry — L2 声明式 spec agent 注册表
 *
 * 目标架构 v2：所有 AI App 把自己的 IAgentSpec → SpecBasedAgent → 注册这里。
 * RuntimeEnvironmentService 通过本 registry 发现 spec-driven agent 的 id。
 *
 * 独立于 legacy `AgentRegistry<IPlanBasedAgent>`：后者面向 plan-execute 模型，
 * 本 registry 面向 single-shot LLM + Zod schema 模型。长期可合并，短期分立。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { SpecBasedAgent } from "./spec-based-agent";

@Injectable()
export class SpecAgentRegistry {
  private readonly logger = new Logger(SpecAgentRegistry.name);
  private readonly agents = new Map<string, SpecBasedAgent>();

  register(agent: SpecBasedAgent): void {
    if (this.agents.has(agent.id)) {
      this.logger.warn(`Agent already registered: ${agent.id}, skipping`);
      return;
    }
    this.agents.set(agent.id, agent);
    this.logger.log(`Registered spec agent: ${agent.id}`);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * 取出 spec-based agent。泛型参数用于调用方 type-narrow——
   * registry 内部是 any-input/any-output，返回时由 caller 声明期望类型。
   */
  get<TInput = unknown, TOutput = unknown>(
    id: string,
  ): SpecBasedAgent<TInput, TOutput> | undefined {
    return this.agents.get(id) as SpecBasedAgent<TInput, TOutput> | undefined;
  }

  getAllIds(): string[] {
    return [...this.agents.keys()];
  }

  clear(): void {
    this.agents.clear();
  }

  size(): number {
    return this.agents.size;
  }
}
