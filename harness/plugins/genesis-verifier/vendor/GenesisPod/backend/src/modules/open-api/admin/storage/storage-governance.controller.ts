import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Headers,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import {
  StorageGovernanceService,
  StorageStats,
  CleanupResult,
  DatabaseAnalysis,
  NodeMemoryStats,
  SystemMemoryStats,
} from "@/modules/platform/storage/governance/storage-governance.service";
import { safeCompare } from "@/common/utils/crypto.utils";
import { Public } from "@/common/decorators/public.decorator";

@ApiTags("Storage")
@Public()
@Controller("storage")
export class StorageGovernanceController {
  private readonly logger = new Logger(StorageGovernanceController.name);
  private readonly adminKey: string;

  constructor(
    private readonly storageService: StorageGovernanceService,
    private readonly configService: ConfigService,
  ) {
    const adminKey = this.configService.get<string>("STORAGE_ADMIN_KEY");
    if (!adminKey) {
      throw new Error(
        "STORAGE_ADMIN_KEY environment variable is required but not set. " +
          "Set it in your .env file to enable storage admin operations.",
      );
    }
    this.adminKey = adminKey;
  }

  /**
   * Validate admin key using constant-time comparison
   */
  private validateKey(key: string): void {
    if (!safeCompare(key, this.adminKey)) {
      throw new BadRequestException("Invalid admin key");
    }
  }

  /**
   * Get comprehensive storage statistics
   */
  @Get("stats")
  async getStorageStats(
    @Headers("x-admin-key") key: string,
  ): Promise<StorageStats> {
    this.validateKey(key);
    this.logger.log("Getting storage statistics");
    return this.storageService.getStorageStats();
  }

  /**
   * Cleanup old images (keep latest 20 unbookmarked per user)
   */
  @Post("cleanup/images")
  async cleanupImages(
    @Headers("x-admin-key") key: string,
    @Query("keepPerUser") keepPerUser?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const keep = keepPerUser ? parseInt(keepPerUser, 10) : 20;
    this.logger.log(`Cleaning up images, keeping ${keep} per user`);
    return this.storageService.cleanupImages(keep);
  }

  /**
   * Delete ALL images
   */
  @Delete("images/all")
  async deleteAllImages(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Deleting all images");
    return this.storageService.deleteAllImages();
  }

  /**
   * Cleanup old raw data
   */
  @Post("cleanup/raw-data")
  async cleanupRawData(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 30;
    this.logger.log(`Cleaning up raw data older than ${days} days`);
    return this.storageService.cleanupOldRawData(days);
  }

  /**
   * Delete ALL raw data (both processed and pending)
   */
  @Delete("raw-data/all")
  async deleteAllRawData(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Deleting all raw data");
    return this.storageService.deleteAllRawData();
  }

  /**
   * Cleanup old collection tasks
   */
  @Post("cleanup/collection-tasks")
  async cleanupCollectionTasks(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 7;
    this.logger.log(`Cleaning up collection tasks older than ${days} days`);
    return this.storageService.cleanupOldCollectionTasks(days);
  }

  /**
   * Cleanup old import tasks
   */
  @Post("cleanup/import-tasks")
  async cleanupImportTasks(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 7;
    this.logger.log(`Cleaning up import tasks older than ${days} days`);
    return this.storageService.cleanupOldImportTasks(days);
  }

  /**
   * Cleanup expired metadata cache
   */
  @Post("cleanup/metadata")
  async cleanupMetadata(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Cleaning up expired metadata cache");
    return this.storageService.cleanupExpiredMetadata();
  }

  /**
   * Cleanup old user activities
   */
  @Post("cleanup/user-activities")
  async cleanupUserActivities(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 30;
    this.logger.log(`Cleaning up user activities older than ${days} days`);
    return this.storageService.cleanupOldUserActivities(days);
  }

  /**
   * Cleanup old Ask AI sessions
   */
  @Post("cleanup/ask-sessions")
  async cleanupAskSessions(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 30;
    this.logger.log(`Cleaning up Ask AI sessions older than ${days} days`);
    return this.storageService.cleanupOldAskSessions(days);
  }

  /**
   * Cleanup old office documents (PPT)
   */
  @Post("cleanup/office-documents")
  async cleanupOfficeDocuments(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 7;
    this.logger.log(`Cleaning up office documents older than ${days} days`);
    return this.storageService.cleanupOldOfficeDocuments(days);
  }

  /**
   * Delete ALL office documents (PPT)
   */
  @Delete("office-documents/all")
  async deleteAllOfficeDocuments(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Deleting all office documents");
    return this.storageService.deleteAllOfficeDocuments();
  }

  /**
   * Cleanup old slides (sessions, checkpoints, team data)
   */
  @Post("cleanup/slides")
  async cleanupSlides(
    @Headers("x-admin-key") key: string,
    @Query("daysOld") daysOld?: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    const days = daysOld ? parseInt(daysOld, 10) : 7;
    this.logger.log(`Cleaning up slides older than ${days} days`);
    return this.storageService.cleanupOldSlides(days);
  }

  /**
   * Delete ALL slides data (sessions, checkpoints, team executions)
   */
  @Delete("slides/all")
  async deleteAllSlides(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Deleting all slides data");
    return this.storageService.deleteAllSlides();
  }

  /**
   * Cleanup a specific knowledge base and all its associated data
   */
  @Post("cleanup/knowledge-base")
  async cleanupKnowledgeBase(
    @Headers("x-admin-key") key: string,
    @Query("id") knowledgeBaseId: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    if (!knowledgeBaseId) {
      throw new BadRequestException("Knowledge base ID is required");
    }
    this.logger.log(`Cleaning up knowledge base: ${knowledgeBaseId}`);
    return this.storageService.cleanupKnowledgeBase(knowledgeBaseId);
  }

  /**
   * Cleanup orphaned RAG data (embeddings, chunks without valid parents)
   */
  @Post("cleanup/orphaned-rag")
  async cleanupOrphanedRagData(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Cleaning up orphaned RAG data");
    return this.storageService.cleanupOrphanedRagData();
  }

  /**
   * Delete ALL knowledge base data (use with caution!)
   */
  @Delete("knowledge-base/all")
  async deleteAllKnowledgeBaseData(
    @Headers("x-admin-key") key: string,
  ): Promise<CleanupResult> {
    this.validateKey(key);
    this.logger.log("Deleting all knowledge base data");
    return this.storageService.deleteAllKnowledgeBaseData();
  }

  /**
   * Run full cleanup (all categories)
   */
  @Post("cleanup/all")
  async runFullCleanup(@Headers("x-admin-key") key: string): Promise<{
    success: boolean;
    results: CleanupResult[];
    totalDeleted: number;
    totalFreedMB: number;
  }> {
    this.validateKey(key);
    this.logger.log("Running full storage cleanup");
    return this.storageService.runFullCleanup();
  }

  /**
   * Get REAL database table sizes (PostgreSQL system views)
   * This shows actual disk usage, not estimates
   */
  @Get("database-analysis")
  async getDatabaseAnalysis(
    @Headers("x-admin-key") key: string,
  ): Promise<DatabaseAnalysis> {
    this.validateKey(key);
    this.logger.log("Analyzing database table sizes");
    return this.storageService.getDatabaseAnalysis();
  }

  /**
   * Run VACUUM to reclaim space after deletions
   */
  @Post("vacuum")
  async vacuumDatabase(
    @Headers("x-admin-key") key: string,
  ): Promise<{ success: boolean; message: string }> {
    this.validateKey(key);
    this.logger.log("Running VACUUM ANALYZE on database");
    return this.storageService.vacuumDatabase();
  }

  /**
   * Run VACUUM FULL on all major tables to reclaim disk space
   * WARNING: This locks tables during operation - use during low traffic
   */
  @Post("vacuum-full-all")
  async vacuumFullAll(@Headers("x-admin-key") key: string): Promise<{
    success: boolean;
    message: string;
    results: Array<{
      table: string;
      beforeMB: number;
      afterMB: number;
      freedMB: number;
    }>;
    totalFreedMB: number;
  }> {
    this.validateKey(key);
    this.logger.log("Running VACUUM FULL on all major tables");
    return this.storageService.vacuumFullAll();
  }

  /**
   * Run VACUUM FULL on a specific table to reclaim space to OS
   * WARNING: This locks the table exclusively during operation
   */
  @Post("vacuum-full")
  async vacuumFullTable(
    @Headers("x-admin-key") key: string,
    @Query("table") tableName: string,
  ): Promise<{
    success: boolean;
    message: string;
    beforeMB?: number;
    afterMB?: number;
  }> {
    this.validateKey(key);
    if (!tableName) {
      throw new BadRequestException("Table name is required");
    }
    this.logger.log(`Running VACUUM FULL on ${tableName}`);
    return this.storageService.vacuumFullTable(tableName);
  }

  /**
   * Force checkpoint to clean WAL logs
   */
  @Post("cleanup-wal")
  async cleanupWAL(
    @Headers("x-admin-key") key: string,
  ): Promise<{ success: boolean; message: string }> {
    this.validateKey(key);
    this.logger.log("Running CHECKPOINT to cleanup WAL");
    return this.storageService.cleanupWAL();
  }

  /**
   * Get full disk usage breakdown including WAL, TOAST, etc.
   */
  @Get("disk-usage")
  async getFullDiskUsage(@Headers("x-admin-key") key: string): Promise<{
    totalDiskMB: number;
    databaseSizeMB: number;
    tableDataMB: number;
    indexesMB: number;
    toastMB: number;
    walEstimateMB: number;
    otherMB: number;
    breakdown: Array<{ category: string; sizeMB: number; percentage: number }>;
  }> {
    this.validateKey(key);
    this.logger.log("Getting full disk usage breakdown");
    return this.storageService.getFullDiskUsage();
  }

  /**
   * Get Node.js process memory statistics
   */
  @Get("node-memory")
  getNodeMemoryStats(@Headers("x-admin-key") key: string): NodeMemoryStats {
    this.validateKey(key);
    this.logger.log("Getting Node.js memory stats");
    return this.storageService.getNodeMemoryStats();
  }

  /**
   * Get system (OS) memory statistics
   */
  @Get("system-memory")
  getSystemMemoryStats(@Headers("x-admin-key") key: string): SystemMemoryStats {
    this.validateKey(key);
    this.logger.log("Getting system memory stats");
    return this.storageService.getSystemMemoryStats();
  }
}
