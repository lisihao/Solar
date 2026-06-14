import { Module } from "@nestjs/common";
import { KeyHealthModule } from "@/modules/platform/credentials/governance/key-health/key-health.module";
import { KeyResolverModule } from "../key-resolver/key-resolver.module";
import { KeyExecutorService } from "./key-executor.service";

/**
 * KeyExecutorModule — 提供 KeyExecutorService 作为统一的 key 调用入口。
 *
 * caller（ai-chat / embedding / rerank / tools）import 此 module 即可。
 * 默认 KeyHealthModule + KeyResolverModule 完整链路自动可用。
 */
@Module({
  imports: [KeyHealthModule, KeyResolverModule],
  providers: [KeyExecutorService],
  exports: [KeyExecutorService],
})
export class KeyExecutorModule {}
