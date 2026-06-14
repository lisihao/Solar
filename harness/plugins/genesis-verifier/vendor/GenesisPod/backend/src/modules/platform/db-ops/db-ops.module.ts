import { Module } from "@nestjs/common";
import { DbOpsService } from "./db-ops.service";
import { DataRetentionService } from "./data-retention.service";
import { PrismaModule } from "../../../common/prisma/prisma.module";

// HTTP 层（DbOpsController，admin/tables）已上提到 open-api/admin（System HTTP → L4），
// service 留 L1 platform。
@Module({
  imports: [PrismaModule],
  providers: [DbOpsService, DataRetentionService],
  exports: [DbOpsService, DataRetentionService],
})
export class DbOpsModule {}
