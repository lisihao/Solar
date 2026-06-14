import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StorageGovernanceService } from "./governance/storage-governance.service";
import { DataRetentionScheduler } from "./governance/data-retention.scheduler";
import { ObjectStorageService } from "./object-store/object-storage.service";
import { StorageOffloadService } from "./governance/storage-offload.service";
import { StorageInventoryService } from "./governance/storage-inventory.service";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// W2-A: object storage backend plugin（@Global，提供 OBJECT_STORAGE_BACKEND_TOKEN）
import { ObjectStorageModule } from "@/plugins/storage/object-storage.module";

@Module({
  imports: [PrismaModule, ConfigModule, ObjectStorageModule],
  // StorageGovernanceController（storage/*，STORAGE_ADMIN_KEY header 鉴权的运维/清理端点）
  // 已上提到 open-api/admin（System HTTP → L4）；StorageGovernanceService 留 L1 platform 并导出。
  providers: [
    // Governance aggregate for storage admin/cleanup workflows.
    StorageGovernanceService,
    // 高增长表统一老化清理（ENABLE_DATA_RETENTION 开关，03:10 UTC）
    DataRetentionScheduler,
    // Runtime object storage orchestrator (delegates to plugin backend).
    ObjectStorageService,
    // Governance-side storage jobs.
    StorageOffloadService,
    StorageInventoryService,
  ],
  exports: [
    StorageGovernanceService,
    ObjectStorageService,
    StorageOffloadService,
    StorageInventoryService,
  ],
})
export class StorageModule {}
