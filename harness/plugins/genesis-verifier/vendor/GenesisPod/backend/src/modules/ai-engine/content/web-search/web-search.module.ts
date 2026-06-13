/**
 * AI Engine Content · Web Search Module
 *
 * Web 搜索 egress（Tavily / Serper / DuckDuckGo + Key 轮换 + 降级 + BYOK 工具 Key）。
 * W5（2026-06-04）从 knowledge/ 迁入 content/——它是"取外部内容"的 egress 基元，
 * 与 content/fetch（URL egress）同族，非知识抽取（standards/16 §五·补）。
 */
import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
import { ToolKeyResolverModule } from "../../../platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";
import { SearchService } from "./web-search.service";

@Module({
  imports: [HttpModule, PrismaModule, SecretsModule, ToolKeyResolverModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class WebSearchModule {}
