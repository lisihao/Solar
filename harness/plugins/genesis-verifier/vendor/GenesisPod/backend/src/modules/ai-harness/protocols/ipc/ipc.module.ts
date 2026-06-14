/**
 * Runtime IPC Module
 *
 * 提供 AI Engine runtime 层的进程间通信能力：
 * - EventBusService: 进程内事件总线
 * - MessageBusService: Agent-to-Agent 消息总线
 * - ProgressTrackerService: 进度追踪
 * - MessagePersistenceService: 消息持久化
 * - AgentLifecycleProtocolService: Agent 生命周期协议
 *
 * 本模块是 @Global()。
 */

import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { EventBusService } from "./event-bus.service";
import { MessageBusService } from "./message-bus.service";
import { ProgressTrackerService } from "./progress-tracker.service";
import { MessagePersistenceService } from "./message-persistence.service";
import { AgentLifecycleProtocolService } from "./agent-lifecycle-protocol.service";

const RUNTIME_IPC_PROVIDERS = [
  EventBusService,
  MessageBusService,
  ProgressTrackerService,
  MessagePersistenceService,
  AgentLifecycleProtocolService,
];

@Global()
@Module({
  imports: [PrismaModule],
  providers: RUNTIME_IPC_PROVIDERS,
  exports: RUNTIME_IPC_PROVIDERS,
})
export class RuntimeIpcModule {}
