/**
 * Runtime Journal Module
 *
 * 提供 AI Engine runtime 层的事件日志与检查点能力：
 * - EventJournalService: 事件 journal（Prisma 持久化）
 * - CheckpointManager: 执行检查点管理
 *
 * 本模块是 @Global()，所有其他模块无需显式 import 即可注入这些 service。
 */

import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { EventJournalService } from "./event-journal.service";
import { CheckpointManager } from "./checkpoint-manager";

const RUNTIME_JOURNAL_PROVIDERS = [EventJournalService, CheckpointManager];

@Global()
@Module({
  imports: [PrismaModule],
  providers: RUNTIME_JOURNAL_PROVIDERS,
  exports: RUNTIME_JOURNAL_PROVIDERS,
})
export class RuntimeJournalModule {}
