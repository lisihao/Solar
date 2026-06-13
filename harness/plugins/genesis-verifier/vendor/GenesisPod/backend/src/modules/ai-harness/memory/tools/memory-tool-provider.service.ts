import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
import { ShortTermMemoryTool } from "./short-term-memory.tool";
import { LongTermMemoryTool } from "./long-term-memory.tool";

/**
 * Registers harness-owned memory tools into the shared tool discovery surface.
 *
 * This keeps registration logic out of the Nest module class and makes the
 * bridge explicit. The longer-term target is a formal tool-provider contract.
 */
@Injectable()
export class MemoryToolProviderService implements OnModuleInit {
  private readonly logger = new Logger(MemoryToolProviderService.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly shortTermMemoryTool: ShortTermMemoryTool,
    private readonly longTermMemoryTool: LongTermMemoryTool,
  ) {}

  onModuleInit() {
    this.toolRegistry.register(this.shortTermMemoryTool);
    this.toolRegistry.register(this.longTermMemoryTool);
    this.logger.log(
      "[MemoryToolProviderService] Registered harness-side memory tools: short-term-memory, long-term-memory",
    );
  }
}



