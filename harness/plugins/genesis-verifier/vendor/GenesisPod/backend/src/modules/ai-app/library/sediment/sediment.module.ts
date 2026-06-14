import { Module } from "@nestjs/common";

import { NotesModule } from "../notes/notes.module";
import { MissionSedimentService } from "./mission-sediment.service";

/**
 * SedimentModule —— mission 完成沉淀进应用内库（notes）的共享能力。
 * playground / company 两个消费侧 import 本模块，注入 MissionSedimentService 对称复用。
 */
@Module({
  imports: [NotesModule],
  providers: [MissionSedimentService],
  exports: [MissionSedimentService],
})
export class SedimentModule {}
