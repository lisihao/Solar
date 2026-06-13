/**
 * ContextEnvelope — IContextEnvelope 的默认实现
 *
 * 不可变语义：所有变换返回新 envelope + diff。
 * Phase 1 只实现最小功能集；compact / priority-pruning 留给 Phase 2。
 */

import { randomUUID } from "crypto";
import type {
  IBudgetSnapshot,
  IContextEnvelope,
  IContextMessage,
  IContextMutation,
  IMemoryBinding,
  IRuntimeEnvironment,
  ISystemReminder,
} from "../abstractions";

export interface ContextEnvelopeInit {
  system: string;
  messages?: readonly IContextMessage[];
  reminders?: readonly ISystemReminder[];
  tools?: readonly string[];
  memory: IMemoryBinding;
  budget: IBudgetSnapshot;
  /** PR-J: 运行时环境快照（BYOK/credit/model 可用性） */
  runtimeEnv?: IRuntimeEnvironment;
  metadata?: Readonly<Record<string, unknown>>;
}

export class ContextEnvelope implements IContextEnvelope {
  readonly id: string;
  readonly system: string;
  readonly messages: readonly IContextMessage[];
  readonly reminders: readonly ISystemReminder[];
  readonly tools: readonly string[];
  readonly memory: IMemoryBinding;
  readonly budget: IBudgetSnapshot;
  readonly runtimeEnv?: IRuntimeEnvironment;
  readonly metadata?: Readonly<Record<string, unknown>>;

  constructor(init: ContextEnvelopeInit, id?: string) {
    this.id = id ?? randomUUID();
    this.system = init.system;
    this.messages = init.messages ?? [];
    this.reminders = init.reminders ?? [];
    this.tools = init.tools ?? [];
    this.memory = init.memory;
    this.budget = init.budget;
    this.runtimeEnv = init.runtimeEnv;
    this.metadata = init.metadata;
  }

  /** 追加消息，返回新 envelope */
  append(newMessages: readonly IContextMessage[]): IContextMutation {
    const next = new ContextEnvelope(
      {
        system: this.system,
        messages: [...this.messages, ...newMessages],
        reminders: this.reminders,
        tools: this.tools,
        memory: this.memory,
        budget: this.budget,
        runtimeEnv: this.runtimeEnv,
        metadata: this.metadata,
      },
      this.id,
    );
    return { envelope: next, diff: { addedMessages: newMessages.length } };
  }

  /** 追加 reminder，返回新 envelope */
  withReminder(
    content: string,
    priority: ISystemReminder["priority"] = "medium",
    source = "harness",
  ): IContextMutation {
    const reminder: ISystemReminder = { source, priority, content };
    const next = new ContextEnvelope(
      {
        system: this.system,
        messages: this.messages,
        reminders: [...this.reminders, reminder],
        tools: this.tools,
        memory: this.memory,
        budget: this.budget,
        runtimeEnv: this.runtimeEnv,
        metadata: this.metadata,
      },
      this.id,
    );
    return { envelope: next, diff: { addedReminders: 1 } };
  }

  /** Fork：同样内容、新 id，用于 subagent */
  fork(): IContextEnvelope {
    return new ContextEnvelope({
      system: this.system,
      messages: [...this.messages],
      reminders: [...this.reminders],
      tools: [...this.tools],
      memory: { ...this.memory },
      budget: { ...this.budget },
      runtimeEnv: this.runtimeEnv,
      metadata: this.metadata,
    });
  }
}
