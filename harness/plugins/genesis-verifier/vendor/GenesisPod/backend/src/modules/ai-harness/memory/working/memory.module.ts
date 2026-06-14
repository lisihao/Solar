/**
 * Harness Memory Module
 *
 * Memory 是 L2.5 Harness 的一等公民（CLAUDE.md AI 架构分层规定）。
 * 本模块统一提供 harness 层所有记忆能力：
 *
 *   Runtime（agent runtime 状态）
 *   - HierarchicalMemoryCascadeService: 4 层记忆级联（org → team → project → session）
 *   - WorkingMemoryManagerService:      进程级记忆管理（基于 ProcessMemory 表）
 *
 *   Stores（基础存储）
 *   - InMemoryStore:        进程内 KV 存储原语
 *   - ConversationMemory:   对话历史
 *   - ShortTermMemoryService: session 级 TTL 存储（LRU）
 *   - LongTermMemoryService:  Prisma 持久化的长期偏好/知识
 *
 *   Coordinator（统一读写协调器）
 *   - MemoryCoordinatorService: 4 层 recall/store 协调（Memory OS）
 *
 * 本模块是 @Global()，所有其他模块无需显式 import 即可注入这些 service。
 *
 * 历史：2026-04-30 把 ai-engine/knowledge/memory/{coordinator,stores,abstractions}
 * 整体迁入 ai-harness/memory/，与 working/vector/checkpoint/indexing 平级，
 * 解决 memory 错位嵌在 knowledge 子模块下的架构债（参见 audit P1）。
 */

import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";

// Working
import { HierarchicalMemoryCascadeService } from "./hierarchical-memory-cascade.service";
import { WorkingMemoryManagerService } from "./working-memory-manager.service";
// ★ 2026-05-04 (PR-5 standardize consumer): handoff token compaction primitive
import { HandoffCompactorService } from "./handoff-compactor.service";

// Stores
import { ShortTermMemoryService } from "../stores/short-term-memory.service";
import { LongTermMemoryService } from "../stores/long-term-memory.service";
import { InMemoryStore, ConversationMemory } from "../stores/in-memory-store";

// Coordinator
import { MemoryCoordinatorService } from "../coordinator/memory-coordinator.service";

// Tools (迁自 ai-engine/tools/categories/memory，因 ESLint 单向依赖规则)
import { ShortTermMemoryTool } from "../tools/short-term-memory.tool";
import { LongTermMemoryTool } from "../tools/long-term-memory.tool";
import { MemoryToolProviderService } from "../tools/memory-tool-provider.service";

// Dream (2026-04-30 C2-step1: 从 ai-engine/planning/services/ 搬来 — 后台 memory 整合)
import { AutoDreamService } from "../consolidation/memory-consolidation.service";
import { AutoDreamSchedulerService } from "../consolidation/memory-consolidation-scheduler.service";

const inMemoryStoreFactory = {
  provide: InMemoryStore,
  useFactory: () => new InMemoryStore(),
};

const conversationMemoryFactory = {
  provide: ConversationMemory,
  useFactory: () => new ConversationMemory(),
};

const HARNESS_MEMORY_PROVIDERS = [
  // Working layer
  HierarchicalMemoryCascadeService,
  WorkingMemoryManagerService,
  HandoffCompactorService,
  // Stores
  inMemoryStoreFactory,
  conversationMemoryFactory,
  ShortTermMemoryService,
  LongTermMemoryService,
  // Coordinator (KnowledgeGraphTool 通过 @Optional 注入；它在 ai-engine/tools
  // 由 AiEngineToolsModule 提供，AiEngineModule @Global 让它全局可见，因此
  // 这里不需要重复注册。)
  MemoryCoordinatorService,
  // Tools (迁自 ai-engine/tools/categories/memory)
  ShortTermMemoryTool,
  LongTermMemoryTool,
  MemoryToolProviderService,
  // Dream (2026-04-30 C2-step1)
  AutoDreamService,
  AutoDreamSchedulerService,
];

const HARNESS_MEMORY_EXPORTS = [
  HierarchicalMemoryCascadeService,
  WorkingMemoryManagerService,
  HandoffCompactorService,
  InMemoryStore,
  ConversationMemory,
  ShortTermMemoryService,
  LongTermMemoryService,
  MemoryCoordinatorService,
  ShortTermMemoryTool,
  LongTermMemoryTool,
  AutoDreamService,
  AutoDreamSchedulerService,
];

@Global()
@Module({
  imports: [PrismaModule],
  providers: HARNESS_MEMORY_PROVIDERS,
  exports: HARNESS_MEMORY_EXPORTS,
})
export class RuntimeMemoryModule {}
