import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { CreditsModule } from "../../../platform/credits/credits.module";
import { CollaborationModule } from "../../../ai-harness/teams/collaboration/collaboration.module";
import { CollectionsModule } from "../collections/collections.module";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { OrganizeChatController } from "./organize-chat.controller";
import { OrganizeChatService } from "./organize-chat.service";
import {
  ORGANIZE_BOOKMARK_TOOL_PROVIDERS,
  ORGANIZE_AGENT_ROLE_ID,
  OrganizeListCollectionsTool,
  OrganizeListItemsTool,
  OrganizeCreateCollectionTool,
  OrganizeTagItemsTool,
  OrganizeMoveItemsTool,
  OrganizeSetStatusTool,
  OrganizeListSourceItemsTool,
  OrganizeAssignItemsTool,
} from "./tools/organize-bookmark-tools";

@Module({
  imports: [
    PrismaModule,
    AiEngineModule, // ToolRegistry（@Global）
    CreditsModule,
    CollaborationModule, // 与 ai-ask 同款：拿到 Chat/Tool facade DI
    CollectionsModule, // 工具薄封装 CollectionsService
  ],
  controllers: [OrganizeChatController],
  providers: [...ORGANIZE_BOOKMARK_TOOL_PROVIDERS, OrganizeChatService],
})
export class OrganizeChatModule implements OnModuleInit {
  private readonly logger = new Logger(OrganizeChatModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly listCollections: OrganizeListCollectionsTool,
    private readonly listItems: OrganizeListItemsTool,
    private readonly createCollection: OrganizeCreateCollectionTool,
    private readonly tagItems: OrganizeTagItemsTool,
    private readonly moveItems: OrganizeMoveItemsTool,
    private readonly setStatus: OrganizeSetStatusTool,
    private readonly listSourceItems: OrganizeListSourceItemsTool,
    private readonly assignItems: OrganizeAssignItemsTool,
  ) {}

  async onModuleInit() {
    const tools = [
      this.listCollections,
      this.listItems,
      this.createCollection,
      this.tagItems,
      this.moveItems,
      this.setStatus,
      this.listSourceItems,
      this.assignItems,
    ];

    // 注册到全局 ToolRegistry（register 内部对已注册者幂等跳过）
    for (const tool of tools) {
      this.toolRegistry.register(tool);
    }

    // 配 ToolConfig.allowedRoles 实现 role 隔离（仅 organize-agent 可解析到这批工具）
    try {
      for (const tool of tools) {
        await this.prisma.toolConfig.upsert({
          where: { toolId: tool.id },
          create: {
            toolId: tool.id,
            enabled: true,
            allowedRoles: [ORGANIZE_AGENT_ROLE_ID],
          },
          update: { allowedRoles: [ORGANIZE_AGENT_ROLE_ID] },
        });
      }
    } catch (err) {
      this.logger.error(
        `organize tools ToolConfig upsert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(`Registered ${tools.length} organize bookmark tools`);
  }
}
