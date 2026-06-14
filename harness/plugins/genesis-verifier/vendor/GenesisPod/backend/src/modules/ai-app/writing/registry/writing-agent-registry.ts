/**
 * WritingAgentRegistry - Writing Agent 注册中心
 *
 * 核心职责：
 * - 管理 Writing Agents 的注册和发现
 * - 提供与全局 AgentRegistry 的桥接
 * - 支持动态 Agent 替换
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
// All types via facade
import type {
  LegacyIAgent as IAgent,
  AgentContext,
  AgentResult,
  AgentCapability,
  ExecutionPlan,
  AgentOutput,
  LegacyAgentEvent as AgentEvent,
} from "@/modules/ai-harness/facade";

// ==================== Writing Agent 接口 ====================

/**
 * Writing Agent 接口
 * 所有 Writing Agents 必须实现此接口
 */
export interface IWritingAgent<
  TInput = unknown,
  TOutput = unknown,
> extends IAgent<TInput, TOutput> {
  /**
   * Agent 唯一标识
   */
  readonly id: string;

  /**
   * Agent 名称
   */
  readonly name: string;

  /**
   * Agent 描述
   */
  readonly description: string;

  /**
   * Agent 能力列表
   */
  readonly capabilities: AgentCapability[];

  /**
   * 执行 Agent
   */
  execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>>;
}

/**
 * Agent 执行上下文（简化版本）
 * 用于桥接到全局 Registry
 */
export interface AgentExecutionContext {
  executionId: string;
  userId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

// ==================== Writing Agent Registry ====================

/**
 * Writing Agent 注册中心
 * 管理所有 Writing Agents 的注册、发现和桥接
 */
@Injectable()
export class WritingAgentRegistry implements OnModuleInit {
  private readonly logger = new Logger(WritingAgentRegistry.name);

  /**
   * Agent 存储（按 ID 索引）
   */
  private readonly agents = new Map<string, IWritingAgent>();

  /**
   * Agent 能力索引（按能力 ID 索引到 Agent IDs）
   */
  private readonly capabilityIndex = new Map<string, Set<string>>();

  /**
   * 模块初始化钩子
   */
  onModuleInit() {
    this.logger.log("Writing Agent Registry initialized");
  }

  // ==================== 注册管理 ====================

  /**
   * 注册一个 Writing Agent
   * @param agent 要注册的 Agent
   * @throws Error 如果 Agent ID 已存在
   */
  register(agent: IWritingAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(
        `Agent with ID '${agent.id}' is already registered. Use unregister() first to replace it.`,
      );
    }

    this.agents.set(agent.id, agent);

    // 建立能力索引
    for (const capability of agent.capabilities) {
      if (!this.capabilityIndex.has(capability.id)) {
        this.capabilityIndex.set(capability.id, new Set());
      }
      this.capabilityIndex.get(capability.id)!.add(agent.id);
    }

    this.logger.log(
      `Registered agent: ${agent.name} (${agent.id}) with ${agent.capabilities.length} capabilities`,
    );
  }

  /**
   * 批量注册 Agents
   * @param agents 要注册的 Agents 数组
   */
  registerMultiple(agents: IWritingAgent[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
    this.logger.log(`Registered ${agents.length} agents`);
  }

  /**
   * 注销一个 Agent
   * @param id Agent ID
   * @returns 是否成功注销
   */
  unregister(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) {
      this.logger.warn(`Cannot unregister: Agent '${id}' not found`);
      return false;
    }

    // 从能力索引中移除
    for (const capability of agent.capabilities) {
      const agentSet = this.capabilityIndex.get(capability.id);
      if (agentSet) {
        agentSet.delete(id);
        if (agentSet.size === 0) {
          this.capabilityIndex.delete(capability.id);
        }
      }
    }

    this.agents.delete(id);
    this.logger.log(`Unregistered agent: ${agent.name} (${id})`);
    return true;
  }

  /**
   * 替换一个 Agent（先注销再注册）
   * @param agent 新的 Agent
   */
  replace(agent: IWritingAgent): void {
    this.unregister(agent.id);
    this.register(agent);
    this.logger.log(`Replaced agent: ${agent.name} (${agent.id})`);
  }

  // ==================== 查询 ====================

  /**
   * 获取指定 Agent
   * @param id Agent ID
   * @returns Agent 实例，不存在则返回 undefined
   */
  get(id: string): IWritingAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * 获取指定 Agent（不存在则抛出错误）
   * @param id Agent ID
   * @returns Agent 实例
   * @throws Error 如果 Agent 不存在
   */
  getOrThrow(id: string): IWritingAgent {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent with ID '${id}' not found in registry`);
    }
    return agent;
  }

  /**
   * 获取所有已注册的 Agents
   * @returns Agent 数组
   */
  getAll(): IWritingAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取所有 Agent IDs
   * @returns Agent ID 数组
   */
  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 检查 Agent 是否已注册
   * @param id Agent ID
   * @returns 是否存在
   */
  has(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * 获取注册的 Agent 数量
   * @returns Agent 数量
   */
  count(): number {
    return this.agents.size;
  }

  // ==================== 能力查询 ====================

  /**
   * 获取具有特定能力的所有 Agents
   * @param capabilityId 能力 ID
   * @returns Agent 数组
   */
  getByCapability(capabilityId: string): IWritingAgent[] {
    const agentIds = this.capabilityIndex.get(capabilityId);
    if (!agentIds) {
      return [];
    }

    return Array.from(agentIds)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is IWritingAgent => agent !== undefined);
  }

  /**
   * 获取具有任意一个能力的 Agents
   * @param capabilityIds 能力 ID 数组
   * @returns Agent 数组（去重）
   */
  getByAnyCapability(capabilityIds: string[]): IWritingAgent[] {
    const agentIdSet = new Set<string>();

    for (const capabilityId of capabilityIds) {
      const agentIds = this.capabilityIndex.get(capabilityId);
      if (agentIds) {
        agentIds.forEach((id) => agentIdSet.add(id));
      }
    }

    return Array.from(agentIdSet)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is IWritingAgent => agent !== undefined);
  }

  /**
   * 获取具有所有能力的 Agents
   * @param capabilityIds 能力 ID 数组
   * @returns Agent 数组
   */
  getByAllCapabilities(capabilityIds: string[]): IWritingAgent[] {
    if (capabilityIds.length === 0) {
      return [];
    }

    // 从第一个能力开始，逐个取交集
    const firstCapabilityAgents = this.capabilityIndex.get(capabilityIds[0]);
    if (!firstCapabilityAgents) {
      return [];
    }

    const candidateIds = new Set(firstCapabilityAgents);

    // 对每个能力取交集
    for (let i = 1; i < capabilityIds.length; i++) {
      const capabilityAgents = this.capabilityIndex.get(capabilityIds[i]);
      if (!capabilityAgents) {
        return [];
      }

      // 保留交集
      for (const id of candidateIds) {
        if (!capabilityAgents.has(id)) {
          candidateIds.delete(id);
        }
      }

      if (candidateIds.size === 0) {
        return [];
      }
    }

    return Array.from(candidateIds)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is IWritingAgent => agent !== undefined);
  }

  /**
   * 列出所有可用的能力
   * @returns 能力 ID 数组
   */
  getAllCapabilities(): string[] {
    return Array.from(this.capabilityIndex.keys());
  }

  // ==================== 调试和状态 ====================

  /**
   * 获取注册表状态摘要
   */
  getStatus(): {
    agentCount: number;
    capabilityCount: number;
    agents: Array<{ id: string; name: string; capabilities: string[] }>;
  } {
    return {
      agentCount: this.agents.size,
      capabilityCount: this.capabilityIndex.size,
      agents: Array.from(this.agents.values()).map((agent) => ({
        id: agent.id,
        name: agent.name,
        capabilities: agent.capabilities.map((c) => c.id),
      })),
    };
  }

  /**
   * 打印注册表状态（用于调试）
   */
  printStatus(): void {
    const status = this.getStatus();
    this.logger.log("=== Writing Agent Registry Status ===");
    this.logger.log(`Total Agents: ${status.agentCount}`);
    this.logger.log(`Total Capabilities: ${status.capabilityCount}`);
    this.logger.log("Registered Agents:");
    for (const agent of status.agents) {
      this.logger.log(
        `  - ${agent.name} (${agent.id}): [${agent.capabilities.join(", ")}]`,
      );
    }
  }

  /**
   * 清空注册表（仅用于测试）
   */
  clear(): void {
    this.agents.clear();
    this.capabilityIndex.clear();
    this.logger.log("Registry cleared");
  }
}

// ==================== 适配器（用于桥接到全局 Registry） ====================

/**
 * Writing Agent 适配器
 * 将 Writing Agent 适配为通用的 Agent 接口，以便桥接到全局 AgentRegistry
 *
 * 注意：目前 Writing Agents 使用 BaseAgent 接口，与全局的 IPlanBasedAgent 不同
 * 此适配器为未来桥接预留，当前 Writing Agents 在 AI Writing 模块内部独立管理
 */
export class WritingAgentAdapter implements IAgent {
  constructor(private readonly writingAgent: IWritingAgent) {}

  get id(): string {
    return this.writingAgent.id;
  }

  get name(): string {
    return this.writingAgent.name;
  }

  get description(): string {
    return this.writingAgent.description;
  }

  get supportedModes() {
    return this.writingAgent.supportedModes;
  }

  get capabilities() {
    return this.writingAgent.capabilities;
  }

  get requiredTools() {
    return this.writingAgent.requiredTools;
  }

  get requiredSkills() {
    return this.writingAgent.requiredSkills;
  }

  get version() {
    return this.writingAgent.version;
  }

  /**
   * 适配执行方法
   * 将通用的 AgentInput 转换为 Writing Agent 特定的输入格式
   */
  async execute(
    input: unknown,
    context: AgentContext,
  ): Promise<AgentResult<AgentOutput>> {
    // 执行 Writing Agent，返回的结果可能是任意类型
    const result = await this.writingAgent.execute(input, context);

    // 将结果转换为 AgentOutput 格式
    return result as AgentResult<AgentOutput>;
  }

  /**
   * 流式执行（如果 Writing Agent 支持）
   */
  async *executeStream(
    input: unknown,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent, AgentResult<AgentOutput>> {
    if (!this.writingAgent.executeStream) {
      // 如果不支持流式执行，回退到普通执行
      const result = await this.execute(input, context);
      return result;
    }

    // 转发流式事件
    const generator = this.writingAgent.executeStream(input, context);
    for await (const event of generator) {
      yield event;
    }

    // 返回最终结果
    const result = await this.writingAgent.execute(input, context);
    return result as AgentResult<AgentOutput>;
  }

  /**
   * 生成执行计划（如果 Writing Agent 支持）
   */
  async plan(input: unknown, context: AgentContext): Promise<ExecutionPlan> {
    if (!this.writingAgent.plan) {
      // 如果不支持计划生成，返回空计划
      return {
        id: context.executionId,
        agentId: this.writingAgent.id,
        steps: [],
      };
    }

    return this.writingAgent.plan(input, context);
  }

  /**
   * 验证输入（如果 Writing Agent 支持）
   */
  validateInput(input: unknown): { valid: boolean; errors?: string[] } {
    if (!this.writingAgent.validateInput) {
      // 如果不支持验证，默认返回有效
      return { valid: true };
    }

    return this.writingAgent.validateInput(input);
  }
}
