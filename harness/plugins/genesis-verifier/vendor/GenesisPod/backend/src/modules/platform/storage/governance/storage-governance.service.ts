import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import * as os from "os";
import { STORAGE_SIZE_ESTIMATES } from "./catalogs/storage-size-estimate.catalog";
import {
  VACUUM_FULL_ALLOWED_TABLES,
  VACUUM_FULL_BATCH_TABLES,
} from "./catalogs/vacuum-target.catalog";

// Node.js 内存统计接口
export interface NodeMemoryStats {
  heapUsed: number; // MB
  heapTotal: number; // MB
  heapUsedPercent: number;
  rss: number; // MB - 常驻内存
  external: number; // MB - C++ 对象内存
  arrayBuffers: number; // MB
  uptime: number; // 秒
  pid: number;
  nodeVersion: string;
  status: "healthy" | "warning" | "critical";
  warnings: string[];
}

// 系统内存统计接口
export interface SystemMemoryStats {
  totalMemory: number; // GB
  freeMemory: number; // GB
  usedMemory: number; // GB
  usedPercent: number;
  platform: string;
  cpuCount: number;
  loadAverage: number[];
  hostname: string;
  status: "healthy" | "warning" | "critical";
}

export interface StorageCategory {
  name: string;
  displayName: string;
  count: number;
  estimatedSizeMB: number;
  description: string;
  cleanupRecommendation?: string;
  canCleanup: boolean;
}

export interface StorageStats {
  totalCategories: number;
  totalRecords: number;
  estimatedTotalSizeMB: number;
  categories: StorageCategory[];
  recommendations: string[];
}

export interface CleanupResult {
  success: boolean;
  category: string;
  deletedCount: number;
  freedSizeMB: number;
  message: string;
}

export interface TableSize {
  tableName: string;
  rowCount: number;
  totalSizeMB: number;
  dataSizeMB: number;
  indexSizeMB: number;
  toastSizeMB: number; // TOAST is for large text/json data
}

export interface DatabaseAnalysis {
  totalDatabaseSizeMB: number;
  tables: TableSize[];
  largestTables: TableSize[];
  recommendations: string[];
}

@Injectable()
export class StorageGovernanceService {
  private readonly logger = new Logger(StorageGovernanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure raw_data rows that already have a resourceId are marked as processed.
   * This keeps stats accurate and allows cleanupOldRawData to work.
   */
  private async ensureLinkedRawDataProcessed(): Promise<number> {
    try {
      const updated = await this.prisma.$queryRawUnsafe<
        Array<{ updated: number }>
      >(`
        UPDATE raw_data
        SET is_processed = TRUE,
            processed_at = COALESCE(processed_at, updated_at, created_at)
        WHERE resource_id IS NOT NULL
          AND (is_processed = FALSE OR processed_at IS NULL)
        RETURNING 1 as updated
      `);

      const updatedCount = Array.isArray(updated) ? updated.length : 0;
      if (updatedCount > 0) {
        this.logger.log(
          `Marked ${updatedCount} linked raw_data rows as processed`,
        );
      }
      return updatedCount;
    } catch (error) {
      this.logger.warn("Failed to mark linked raw data as processed:", error);
      return 0;
    }
  }

  /**
   * Get comprehensive storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    const categories: StorageCategory[] = [];
    const recommendations: string[] = [];

    // 1. Generated Images
    const imageStats = await this.getImageStats();
    categories.push(imageStats);
    if (imageStats.cleanupRecommendation) {
      recommendations.push(imageStats.cleanupRecommendation);
    }

    // 2. Raw Data
    const rawDataStats = await this.getRawDataStats();
    categories.push(rawDataStats);
    if (rawDataStats.cleanupRecommendation) {
      recommendations.push(rawDataStats.cleanupRecommendation);
    }

    // 3. Resources
    const resourceStats = await this.getResourceStats();
    categories.push(resourceStats);

    // 4. Notes
    const noteStats = await this.getNoteStats();
    categories.push(noteStats);

    // 5. Research Project Sources
    const sourceStats = await this.getResearchSourceStats();
    categories.push(sourceStats);

    // 6. Collection Tasks
    const taskStats = await this.getCollectionTaskStats();
    categories.push(taskStats);
    if (taskStats.cleanupRecommendation) {
      recommendations.push(taskStats.cleanupRecommendation);
    }

    // 7. Import Tasks
    const importTaskStats = await this.getImportTaskStats();
    categories.push(importTaskStats);
    if (importTaskStats.cleanupRecommendation) {
      recommendations.push(importTaskStats.cleanupRecommendation);
    }

    // 8. Parsed Metadata (cached)
    const metadataStats = await this.getParsedMetadataStats();
    categories.push(metadataStats);
    if (metadataStats.cleanupRecommendation) {
      recommendations.push(metadataStats.cleanupRecommendation);
    }

    // 9. Deduplication Records
    const dedupStats = await this.getDeduplicationStats();
    categories.push(dedupStats);

    // 10. Data Quality Metrics
    const qualityStats = await this.getDataQualityStats();
    categories.push(qualityStats);

    // 11. User Activities
    const activityStats = await this.getUserActivityStats();
    categories.push(activityStats);
    if (activityStats.cleanupRecommendation) {
      recommendations.push(activityStats.cleanupRecommendation);
    }

    // 12. Topic Messages
    const messageStats = await this.getTopicMessageStats();
    categories.push(messageStats);

    // 13. Office Documents (PPT)
    const officeDocStats = await this.getOfficeDocumentStats();
    categories.push(officeDocStats);
    if (officeDocStats.cleanupRecommendation) {
      recommendations.push(officeDocStats.cleanupRecommendation);
    }

    // 14. Users
    const userStats = await this.getUserStats();
    categories.push(userStats);

    // 15. Comments
    const commentStats = await this.getCommentStats();
    categories.push(commentStats);

    // 16. Ask Sessions
    const askSessionStats = await this.getAskSessionStats();
    categories.push(askSessionStats);
    if (askSessionStats.cleanupRecommendation) {
      recommendations.push(askSessionStats.cleanupRecommendation);
    }

    // 17. Topics (AI Groups)
    const topicStats = await this.getTopicStats();
    categories.push(topicStats);

    // 18. Workspaces
    const workspaceStats = await this.getWorkspaceStats();
    categories.push(workspaceStats);

    // 19. Reports
    const reportStats = await this.getReportStats();
    categories.push(reportStats);

    // 20. Debate Sessions
    const debateStats = await this.getDebateStats();
    categories.push(debateStats);

    // 21. Brand Kits
    const brandKitStats = await this.getBrandKitStats();
    categories.push(brandKitStats);

    // 22. AI Slides
    const slidesStats = await this.getSlidesStats();
    categories.push(slidesStats);
    if (slidesStats.cleanupRecommendation) {
      recommendations.push(slidesStats.cleanupRecommendation);
    }

    // 23. Knowledge Base (RAG) - CRITICAL: This was missing and caused storage discrepancy!
    // child_embeddings table stores vector data which can consume significant space
    const knowledgeBaseStats = await this.getKnowledgeBaseStats();
    categories.push(knowledgeBaseStats);
    if (knowledgeBaseStats.cleanupRecommendation) {
      recommendations.push(knowledgeBaseStats.cleanupRecommendation);
    }

    // Calculate totals
    const totalRecords = categories.reduce((sum, cat) => sum + cat.count, 0);
    const estimatedTotalSizeMB = categories.reduce(
      (sum, cat) => sum + cat.estimatedSizeMB,
      0,
    );

    return {
      totalCategories: categories.length,
      totalRecords,
      estimatedTotalSizeMB: Math.round(estimatedTotalSizeMB * 100) / 100,
      categories,
      recommendations,
    };
  }

  // ========== Individual Stats Methods ==========

  private async getImageStats(): Promise<StorageCategory> {
    const total = await this.prisma.generatedImage.count();
    const bookmarked = await this.prisma.generatedImage.count({
      where: { isBookmarked: true },
    });
    const unbookmarked = total - bookmarked;

    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.generatedImages) / 1024;

    let cleanupRecommendation: string | undefined;
    if (unbookmarked > 100) {
      cleanupRecommendation = `${unbookmarked} unbookmarked images can be cleaned up to save ~${Math.round((unbookmarked * STORAGE_SIZE_ESTIMATES.generatedImages) / 1024)}MB`;
    }

    return {
      name: "generatedImages",
      displayName: "AI Generated Images",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${bookmarked} bookmarked, ${unbookmarked} unbookmarked`,
      cleanupRecommendation,
      canCleanup: unbookmarked > 0,
    };
  }

  private async getRawDataStats(): Promise<StorageCategory> {
    // Make sure linked raw data rows are marked as processed
    await this.ensureLinkedRawDataProcessed();

    const total = await this.prisma.rawData.count();
    const processed = await this.prisma.rawData.count({
      where: { isProcessed: true },
    });
    const unprocessed = total - processed;

    // Get by source breakdown
    const bySource = await this.prisma.rawData.groupBy({
      by: ["source"],
      _count: true,
    });

    const sourceBreakdown = bySource
      .map((s) => `${s.source}: ${s._count}`)
      .join(", ");

    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.rawData) / 1024;

    let cleanupRecommendation: string | undefined;
    // Old processed data (>30 days) can be cleaned
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const oldProcessed = await this.prisma.rawData.count({
      where: {
        isProcessed: true,
        processedAt: { lt: thirtyDaysAgo },
      },
    });
    if (oldProcessed > 50) {
      cleanupRecommendation = `${oldProcessed} processed raw data records older than 30 days can be archived`;
    }

    return {
      name: "rawData",
      displayName: "Raw Data Collection",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${processed} processed, ${unprocessed} pending. Sources: ${sourceBreakdown || "none"}`,
      cleanupRecommendation,
      canCleanup: oldProcessed > 0,
    };
  }

  private async getResourceStats(): Promise<StorageCategory> {
    const total = await this.prisma.resource.count();

    // Get by type breakdown
    const byType = await this.prisma.resource.groupBy({
      by: ["type"],
      _count: true,
    });

    const typeBreakdown = byType
      .map((t) => `${t.type}: ${t._count}`)
      .join(", ");

    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.resources) / 1024;

    return {
      name: "resources",
      displayName: "Resources",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: typeBreakdown || "No resources",
      canCleanup: false, // Resources are core data, shouldn't be auto-cleaned
    };
  }

  private async getNoteStats(): Promise<StorageCategory> {
    const total = await this.prisma.note.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.notes) / 1024;

    return {
      name: "notes",
      displayName: "User Notes",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} notes from all users`,
      canCleanup: false,
    };
  }

  private async getResearchSourceStats(): Promise<StorageCategory> {
    const total = await this.prisma.researchProjectSource.count();

    // Get by source type
    const byType = await this.prisma.researchProjectSource.groupBy({
      by: ["sourceType"],
      _count: true,
    });

    const typeBreakdown = byType
      .map((t) => `${t.sourceType}: ${t._count}`)
      .join(", ");

    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.researchProjectSources) / 1024;

    return {
      name: "researchProjectSources",
      displayName: "Research Project Sources",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: typeBreakdown || "No sources",
      canCleanup: false,
    };
  }

  private async getCollectionTaskStats(): Promise<StorageCategory> {
    const total = await this.prisma.collectionTask.count();

    // Get by status
    const byStatus = await this.prisma.collectionTask.groupBy({
      by: ["status"],
      _count: true,
    });

    const statusBreakdown = byStatus
      .map((s) => `${s.status}: ${s._count}`)
      .join(", ");

    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.collectionTasks) / 1024;

    // Old completed/failed tasks (>7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oldTasks = await this.prisma.collectionTask.count({
      where: {
        status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
        completedAt: { lt: sevenDaysAgo },
      },
    });

    let cleanupRecommendation: string | undefined;
    if (oldTasks > 20) {
      cleanupRecommendation = `${oldTasks} completed/failed collection tasks older than 7 days can be cleaned`;
    }

    return {
      name: "collectionTasks",
      displayName: "Collection Tasks",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: statusBreakdown || "No tasks",
      cleanupRecommendation,
      canCleanup: oldTasks > 0,
    };
  }

  private async getImportTaskStats(): Promise<StorageCategory> {
    const total = await this.prisma.importTask.count();

    const byStatus = await this.prisma.importTask.groupBy({
      by: ["status"],
      _count: true,
    });

    const statusBreakdown = byStatus
      .map((s) => `${s.status}: ${s._count}`)
      .join(", ");

    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.importTasks) / 1024;

    // Old completed tasks (>7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oldTasks = await this.prisma.importTask.count({
      where: {
        status: { in: ["SUCCESS", "FAILED", "CANCELLED"] },
        completedAt: { lt: sevenDaysAgo },
      },
    });

    let cleanupRecommendation: string | undefined;
    if (oldTasks > 50) {
      cleanupRecommendation = `${oldTasks} completed import tasks older than 7 days can be cleaned`;
    }

    return {
      name: "importTasks",
      displayName: "Import Tasks",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: statusBreakdown || "No tasks",
      cleanupRecommendation,
      canCleanup: oldTasks > 0,
    };
  }

  private async getParsedMetadataStats(): Promise<StorageCategory> {
    const total = await this.prisma.parsedMetadata.count();

    // Expired metadata
    const expired = await this.prisma.parsedMetadata.count({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.parsedMetadata) / 1024;

    let cleanupRecommendation: string | undefined;
    if (expired > 0) {
      cleanupRecommendation = `${expired} expired metadata cache entries can be cleaned`;
    }

    return {
      name: "parsedMetadata",
      displayName: "Parsed Metadata Cache",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total - expired} active, ${expired} expired`,
      cleanupRecommendation,
      canCleanup: expired > 0,
    };
  }

  private async getDeduplicationStats(): Promise<StorageCategory> {
    const total = await this.prisma.deduplicationRecord.count();
    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.deduplicationRecords) / 1024;

    return {
      name: "deduplicationRecords",
      displayName: "Deduplication Records",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} deduplication records`,
      canCleanup: false,
    };
  }

  private async getDataQualityStats(): Promise<StorageCategory> {
    const total = await this.prisma.dataQualityMetric.count();
    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.dataQualityMetrics) / 1024;

    return {
      name: "dataQualityMetrics",
      displayName: "Data Quality Metrics",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} quality metrics`,
      canCleanup: false,
    };
  }

  private async getUserActivityStats(): Promise<StorageCategory> {
    const total = await this.prisma.userActivity.count();

    // Old activities (>30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const oldActivities = await this.prisma.userActivity.count({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });

    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.userActivities) / 1024;

    let cleanupRecommendation: string | undefined;
    if (oldActivities > 1000) {
      cleanupRecommendation = `${oldActivities} user activity records older than 30 days can be archived`;
    }

    return {
      name: "userActivities",
      displayName: "User Activities",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total - oldActivities} recent, ${oldActivities} older than 30 days`,
      cleanupRecommendation,
      canCleanup: oldActivities > 0,
    };
  }

  private async getTopicMessageStats(): Promise<StorageCategory> {
    const total = await this.prisma.topicMessage.count();
    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.topicMessages) / 1024;

    return {
      name: "topicMessages",
      displayName: "AI Group Messages",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} messages across all topics`,
      canCleanup: false,
    };
  }

  private async getOfficeDocumentStats(): Promise<StorageCategory> {
    const totalDocs = await this.prisma.officeDocument.count();
    const totalVersions = await this.prisma.officeDocumentVersion.count();

    // Get by type breakdown
    const byType = await this.prisma.officeDocument.groupBy({
      by: ["type"],
      _count: true,
    });

    const typeBreakdown = byType
      .map((t) => `${t.type}: ${t._count}`)
      .join(", ");

    const estimatedSizeMB =
      (totalDocs * STORAGE_SIZE_ESTIMATES.officeDocuments +
        totalVersions * STORAGE_SIZE_ESTIMATES.officeDocumentVersions) /
      1024;

    // Old documents (>7 days) can be cleaned
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oldDocs = await this.prisma.officeDocument.count({
      where: {
        createdAt: { lt: sevenDaysAgo },
      },
    });

    let cleanupRecommendation: string | undefined;
    if (oldDocs > 10) {
      cleanupRecommendation = `${oldDocs} PPT documents older than 7 days can be cleaned`;
    }

    return {
      name: "officeDocuments",
      displayName: "Office Documents (PPT)",
      count: totalDocs,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${totalDocs} documents, ${totalVersions} versions. Types: ${typeBreakdown || "none"}`,
      cleanupRecommendation,
      canCleanup: totalDocs > 0,
    };
  }

  private async getUserStats(): Promise<StorageCategory> {
    const total = await this.prisma.user.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.users) / 1024;

    return {
      name: "users",
      displayName: "Users",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} registered users`,
      canCleanup: false,
    };
  }

  private async getCommentStats(): Promise<StorageCategory> {
    const total = await this.prisma.comment.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.comments) / 1024;

    return {
      name: "comments",
      displayName: "Comments",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} comments on resources`,
      canCleanup: false,
    };
  }

  private async getAskSessionStats(): Promise<StorageCategory> {
    const totalSessions = await this.prisma.askSession.count();
    const totalMessages = await this.prisma.askMessage.count();
    const estimatedSizeMB =
      (totalSessions * STORAGE_SIZE_ESTIMATES.askSessions +
        totalMessages * STORAGE_SIZE_ESTIMATES.askMessages) /
      1024;

    // Old sessions (>30 days) can be cleaned
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const oldSessions = await this.prisma.askSession.count({
      where: { updatedAt: { lt: thirtyDaysAgo } },
    });

    let cleanupRecommendation: string | undefined;
    if (oldSessions > 50) {
      cleanupRecommendation = `${oldSessions} AI chat sessions older than 30 days can be cleaned`;
    }

    return {
      name: "askSessions",
      displayName: "Ask AI Sessions",
      count: totalSessions,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${totalSessions} sessions, ${totalMessages} messages`,
      cleanupRecommendation,
      canCleanup: oldSessions > 0,
    };
  }

  private async getTopicStats(): Promise<StorageCategory> {
    const total = await this.prisma.topic.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.topics) / 1024;

    return {
      name: "topics",
      displayName: "AI Groups (Topics)",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} AI group conversations`,
      canCleanup: false,
    };
  }

  private async getWorkspaceStats(): Promise<StorageCategory> {
    const total = await this.prisma.workspace.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.workspaces) / 1024;

    return {
      name: "workspaces",
      displayName: "Workspaces",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} user workspaces`,
      canCleanup: false,
    };
  }

  private async getReportStats(): Promise<StorageCategory> {
    const total = await this.prisma.report.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.reports) / 1024;

    return {
      name: "reports",
      displayName: "Reports",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} generated reports`,
      canCleanup: false,
    };
  }

  private async getDebateStats(): Promise<StorageCategory> {
    const total = await this.prisma.debateSession.count();
    const estimatedSizeMB =
      (total * STORAGE_SIZE_ESTIMATES.debateSessions) / 1024;

    return {
      name: "debateSessions",
      displayName: "Debate Sessions",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} AI debate sessions`,
      canCleanup: false,
    };
  }

  private async getBrandKitStats(): Promise<StorageCategory> {
    const total = await this.prisma.brandKit.count();
    const estimatedSizeMB = (total * STORAGE_SIZE_ESTIMATES.brandKits) / 1024;

    return {
      name: "brandKits",
      displayName: "Brand Kits",
      count: total,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${total} brand kits`,
      canCleanup: false,
    };
  }

  private async getSlidesStats(): Promise<StorageCategory> {
    const totalSessions = await this.prisma.slidesSession.count();
    const totalCheckpoints = await this.prisma.slidesCheckpoint.count();

    // Try to get team execution count (table may not exist yet)
    let totalTeamExecutions = 0;
    let totalTeamLogs = 0;
    try {
      totalTeamExecutions = await this.prisma.slidesTeamExecution.count();
      totalTeamLogs = await this.prisma.slidesTeamLog.count();
    } catch {
      // Tables may not exist yet
    }

    const estimatedSizeMB =
      (totalSessions * STORAGE_SIZE_ESTIMATES.slidesSessions +
        totalCheckpoints * STORAGE_SIZE_ESTIMATES.slidesCheckpoints +
        totalTeamExecutions * STORAGE_SIZE_ESTIMATES.slidesTeamExecutions +
        totalTeamLogs * STORAGE_SIZE_ESTIMATES.slidesTeamLogs) /
      1024;

    // Old sessions (>7 days) can be cleaned
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oldSessions = await this.prisma.slidesSession.count({
      where: { updatedAt: { lt: sevenDaysAgo } },
    });

    let cleanupRecommendation: string | undefined;
    if (oldSessions > 5 || totalCheckpoints > 100) {
      cleanupRecommendation = `${oldSessions} sessions older than 7 days, ${totalCheckpoints} checkpoints can be cleaned`;
    }

    return {
      name: "slides",
      displayName: "AI Slides",
      count: totalSessions,
      estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
      description: `${totalSessions} sessions, ${totalCheckpoints} checkpoints, ${totalTeamExecutions} executions`,
      cleanupRecommendation,
      canCleanup: totalSessions > 0 || totalCheckpoints > 0,
    };
  }

  /**
   * Get Knowledge Base (RAG) storage statistics
   * This includes embeddings which can be a major storage consumer!
   */
  private async getKnowledgeBaseStats(): Promise<StorageCategory> {
    try {
      // Count all RAG-related records
      const totalKnowledgeBases = await this.prisma.knowledgeBase.count();
      const totalDocuments = await this.prisma.knowledgeBaseDocument.count();
      const totalParentChunks = await this.prisma.parentChunk.count();
      const totalChildChunks = await this.prisma.childChunk.count();
      const totalEmbeddings = await this.prisma.childEmbedding.count();

      // Get embedding dimensions breakdown for accurate size calculation
      let embeddingSizeMB = 0;
      try {
        const dimensionGroups = await this.prisma.childEmbedding.groupBy({
          by: ["dimensions"],
          _count: true,
        });

        for (const group of dimensionGroups) {
          // Each dimension is 4 bytes (float32), plus ~20% JSONB overhead
          const bytesPerEmbedding = group.dimensions * 4 * 1.2;
          embeddingSizeMB += (group._count * bytesPerEmbedding) / (1024 * 1024);
        }
      } catch {
        // Fallback to estimate if groupBy fails
        embeddingSizeMB =
          (totalEmbeddings * STORAGE_SIZE_ESTIMATES.childEmbeddings) / 1024;
      }

      // Calculate total estimated size
      const documentSizeMB =
        (totalDocuments * STORAGE_SIZE_ESTIMATES.knowledgeBaseDocuments) / 1024;
      const parentChunkSizeMB =
        (totalParentChunks * STORAGE_SIZE_ESTIMATES.parentChunks) / 1024;
      const childChunkSizeMB =
        (totalChildChunks * STORAGE_SIZE_ESTIMATES.childChunks) / 1024;
      const kbSizeMB =
        (totalKnowledgeBases * STORAGE_SIZE_ESTIMATES.knowledgeBases) / 1024;

      const totalEstimatedSizeMB =
        kbSizeMB +
        documentSizeMB +
        parentChunkSizeMB +
        childChunkSizeMB +
        embeddingSizeMB;

      // Build description
      const description = [
        `${totalKnowledgeBases} knowledge bases`,
        `${totalDocuments} documents`,
        `${totalParentChunks} parent chunks`,
        `${totalChildChunks} child chunks`,
        `${totalEmbeddings} embeddings (~${Math.round(embeddingSizeMB)}MB)`,
      ].join(", ");

      // Cleanup recommendation for orphaned data
      let cleanupRecommendation: string | undefined;
      if (totalEmbeddings > 10000) {
        cleanupRecommendation = `Large embedding storage detected (~${Math.round(embeddingSizeMB)}MB). Consider archiving unused knowledge bases.`;
      }

      return {
        name: "knowledgeBase",
        displayName: "Knowledge Base (RAG)",
        count: totalDocuments,
        estimatedSizeMB: Math.round(totalEstimatedSizeMB * 100) / 100,
        description,
        cleanupRecommendation,
        canCleanup: totalKnowledgeBases > 0,
      };
    } catch (error) {
      this.logger.warn("Failed to get knowledge base stats:", error);
      return {
        name: "knowledgeBase",
        displayName: "Knowledge Base (RAG)",
        count: 0,
        estimatedSizeMB: 0,
        description: "Unable to fetch stats",
        canCleanup: false,
      };
    }
  }

  // ========== Cleanup Methods ==========

  /**
   * Cleanup old unbookmarked images
   */
  async cleanupImages(keepPerUser: number = 20): Promise<CleanupResult> {
    try {
      // Get all users with images (including null userId)
      const userImages = await this.prisma.generatedImage.groupBy({
        by: ["userId"],
        _count: true,
      });

      let totalDeleted = 0;
      let totalFreedKB = 0;

      for (const userGroup of userImages) {
        // Get unbookmarked images for this user (or null user), oldest first
        // Prisma requires special handling for null values
        const userIdFilter =
          userGroup.userId === null ? { equals: null } : userGroup.userId;

        const unbookmarked = await this.prisma.generatedImage.findMany({
          where: {
            userId: userIdFilter,
            isBookmarked: false,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        // Keep only the latest 'keepPerUser' unbookmarked images
        const toDelete = unbookmarked.slice(
          0,
          Math.max(0, unbookmarked.length - keepPerUser),
        );

        if (toDelete.length > 0) {
          await this.prisma.generatedImage.deleteMany({
            where: {
              id: { in: toDelete.map((img) => img.id) },
            },
          });
          totalDeleted += toDelete.length;
          totalFreedKB +=
            toDelete.length * STORAGE_SIZE_ESTIMATES.generatedImages;
        }
      }

      return {
        success: true,
        category: "generatedImages",
        deletedCount: totalDeleted,
        freedSizeMB: Math.round((totalFreedKB / 1024) * 100) / 100,
        message: `Cleaned up ${totalDeleted} old images, freed ~${Math.round(totalFreedKB / 1024)}MB`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup images:", error);
      return {
        success: false,
        category: "generatedImages",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete ALL images
   */
  async deleteAllImages(): Promise<CleanupResult> {
    try {
      const count = await this.prisma.generatedImage.count();
      await this.prisma.generatedImage.deleteMany();

      return {
        success: true,
        category: "generatedImages",
        deletedCount: count,
        freedSizeMB:
          Math.round(
            ((count * STORAGE_SIZE_ESTIMATES.generatedImages) / 1024) * 100,
          ) / 100,
        message: `Deleted all ${count} images`,
      };
    } catch (error) {
      this.logger.error("Failed to delete all images:", error);
      return {
        success: false,
        category: "generatedImages",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old raw data
   */
  async cleanupOldRawData(daysOld: number = 30): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Sync processed flag before deletion
      await this.ensureLinkedRawDataProcessed();

      const result = await this.prisma.rawData.deleteMany({
        where: {
          isProcessed: true,
          processedAt: { lt: cutoffDate },
        },
      });

      return {
        success: true,
        category: "rawData",
        deletedCount: result.count,
        freedSizeMB:
          Math.round(
            ((result.count * STORAGE_SIZE_ESTIMATES.rawData) / 1024) * 100,
          ) / 100,
        message: `Cleaned up ${result.count} processed raw data records older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup raw data:", error);
      return {
        success: false,
        category: "rawData",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete ALL raw data (both processed and pending)
   */
  async deleteAllRawData(): Promise<CleanupResult> {
    try {
      const count = await this.prisma.rawData.count();
      await this.prisma.rawData.deleteMany();

      return {
        success: true,
        category: "rawData",
        deletedCount: count,
        freedSizeMB:
          Math.round(((count * STORAGE_SIZE_ESTIMATES.rawData) / 1024) * 100) /
          100,
        message: `Deleted all ${count} raw data records`,
      };
    } catch (error) {
      this.logger.error("Failed to delete all raw data:", error);
      return {
        success: false,
        category: "rawData",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old collection tasks
   */
  async cleanupOldCollectionTasks(daysOld: number = 7): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.collectionTask.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
          completedAt: { lt: cutoffDate },
        },
      });

      return {
        success: true,
        category: "collectionTasks",
        deletedCount: result.count,
        freedSizeMB:
          Math.round(
            ((result.count * STORAGE_SIZE_ESTIMATES.collectionTasks) / 1024) *
              100,
          ) / 100,
        message: `Cleaned up ${result.count} completed collection tasks older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup collection tasks:", error);
      return {
        success: false,
        category: "collectionTasks",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old import tasks
   */
  async cleanupOldImportTasks(daysOld: number = 7): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.importTask.deleteMany({
        where: {
          status: { in: ["SUCCESS", "FAILED", "CANCELLED"] },
          completedAt: { lt: cutoffDate },
        },
      });

      return {
        success: true,
        category: "importTasks",
        deletedCount: result.count,
        freedSizeMB:
          Math.round(
            ((result.count * STORAGE_SIZE_ESTIMATES.importTasks) / 1024) * 100,
          ) / 100,
        message: `Cleaned up ${result.count} completed import tasks older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup import tasks:", error);
      return {
        success: false,
        category: "importTasks",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup expired metadata cache
   */
  async cleanupExpiredMetadata(): Promise<CleanupResult> {
    try {
      const result = await this.prisma.parsedMetadata.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      return {
        success: true,
        category: "parsedMetadata",
        deletedCount: result.count,
        freedSizeMB:
          Math.round(
            ((result.count * STORAGE_SIZE_ESTIMATES.parsedMetadata) / 1024) *
              100,
          ) / 100,
        message: `Cleaned up ${result.count} expired metadata cache entries`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup metadata:", error);
      return {
        success: false,
        category: "parsedMetadata",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old user activities
   */
  async cleanupOldUserActivities(daysOld: number = 30): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.userActivity.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      return {
        success: true,
        category: "userActivities",
        deletedCount: result.count,
        freedSizeMB:
          Math.round(
            ((result.count * STORAGE_SIZE_ESTIMATES.userActivities) / 1024) *
              100,
          ) / 100,
        message: `Cleaned up ${result.count} user activity records older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup user activities:", error);
      return {
        success: false,
        category: "userActivities",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old Ask AI sessions
   */
  async cleanupOldAskSessions(daysOld: number = 30): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // First delete messages from old sessions
      const messagesToDelete = await this.prisma.askMessage.deleteMany({
        where: {
          session: {
            updatedAt: { lt: cutoffDate },
          },
        },
      });

      // Then delete the sessions
      const result = await this.prisma.askSession.deleteMany({
        where: {
          updatedAt: { lt: cutoffDate },
        },
      });

      const freedSizeMB =
        (result.count * STORAGE_SIZE_ESTIMATES.askSessions +
          messagesToDelete.count * STORAGE_SIZE_ESTIMATES.askMessages) /
        1024;

      return {
        success: true,
        category: "askSessions",
        deletedCount: result.count,
        freedSizeMB: Math.round(freedSizeMB * 100) / 100,
        message: `Cleaned up ${result.count} sessions and ${messagesToDelete.count} messages older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup Ask sessions:", error);
      return {
        success: false,
        category: "askSessions",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old office documents (PPT)
   */
  async cleanupOldOfficeDocuments(daysOld: number = 7): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Get count before deletion
      const docsToDelete = await this.prisma.officeDocument.count({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      const versionsToDelete = await this.prisma.officeDocumentVersion.count({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      // Delete resource refs first (due to foreign keys)
      await this.prisma.officeDocumentResourceRef.deleteMany({
        where: {
          document: {
            createdAt: { lt: cutoffDate },
          },
        },
      });

      // Delete versions
      await this.prisma.officeDocumentVersion.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      // Delete documents
      await this.prisma.officeDocument.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      const freedKB =
        docsToDelete * STORAGE_SIZE_ESTIMATES.officeDocuments +
        versionsToDelete * STORAGE_SIZE_ESTIMATES.officeDocumentVersions;

      return {
        success: true,
        category: "officeDocuments",
        deletedCount: docsToDelete,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Cleaned up ${docsToDelete} documents and ${versionsToDelete} versions older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup office documents:", error);
      return {
        success: false,
        category: "officeDocuments",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete ALL office documents
   */
  async deleteAllOfficeDocuments(): Promise<CleanupResult> {
    try {
      const docsCount = await this.prisma.officeDocument.count();
      const versionsCount = await this.prisma.officeDocumentVersion.count();

      // Delete in correct order due to foreign keys
      await this.prisma.officeDocumentResourceRef.deleteMany();
      await this.prisma.officeDocumentVersion.deleteMany();
      await this.prisma.officeDocument.deleteMany();

      const freedKB =
        docsCount * STORAGE_SIZE_ESTIMATES.officeDocuments +
        versionsCount * STORAGE_SIZE_ESTIMATES.officeDocumentVersions;

      return {
        success: true,
        category: "officeDocuments",
        deletedCount: docsCount,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Deleted all ${docsCount} documents and ${versionsCount} versions`,
      };
    } catch (error) {
      this.logger.error("Failed to delete all office documents:", error);
      return {
        success: false,
        category: "officeDocuments",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup old slides sessions and checkpoints
   */
  async cleanupOldSlides(daysOld: number = 7): Promise<CleanupResult> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Get counts before deletion
      const sessionsToDelete = await this.prisma.slidesSession.count({
        where: { updatedAt: { lt: cutoffDate } },
      });

      const checkpointsToDelete = await this.prisma.slidesCheckpoint.count({
        where: {
          session: { updatedAt: { lt: cutoffDate } },
        },
      });

      // Try to delete team data (tables may not exist)
      let teamExecutionsDeleted = 0;
      let teamLogsDeleted = 0;
      try {
        const logsResult = await this.prisma.slidesTeamLog.deleteMany({
          where: {
            execution: {
              createdAt: { lt: cutoffDate },
            },
          },
        });
        teamLogsDeleted = logsResult.count;

        const execResult = await this.prisma.slidesTeamExecution.deleteMany({
          where: {
            createdAt: { lt: cutoffDate },
          },
        });
        teamExecutionsDeleted = execResult.count;
      } catch {
        // Tables may not exist
      }

      // Delete checkpoints first (due to foreign key)
      await this.prisma.slidesCheckpoint.deleteMany({
        where: {
          session: { updatedAt: { lt: cutoffDate } },
        },
      });

      // Delete sessions
      await this.prisma.slidesSession.deleteMany({
        where: { updatedAt: { lt: cutoffDate } },
      });

      const freedKB =
        sessionsToDelete * STORAGE_SIZE_ESTIMATES.slidesSessions +
        checkpointsToDelete * STORAGE_SIZE_ESTIMATES.slidesCheckpoints +
        teamExecutionsDeleted * STORAGE_SIZE_ESTIMATES.slidesTeamExecutions +
        teamLogsDeleted * STORAGE_SIZE_ESTIMATES.slidesTeamLogs;

      return {
        success: true,
        category: "slides",
        deletedCount: sessionsToDelete,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Cleaned up ${sessionsToDelete} sessions, ${checkpointsToDelete} checkpoints, ${teamExecutionsDeleted} executions older than ${daysOld} days`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup slides:", error);
      return {
        success: false,
        category: "slides",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete ALL slides data (sessions, checkpoints, team executions)
   */
  async deleteAllSlides(): Promise<CleanupResult> {
    try {
      const sessionsCount = await this.prisma.slidesSession.count();
      const checkpointsCount = await this.prisma.slidesCheckpoint.count();

      // Try to delete team data first (tables may not exist)
      let teamExecutionsCount = 0;
      let teamLogsCount = 0;
      try {
        teamLogsCount = await this.prisma.slidesTeamLog.count();
        teamExecutionsCount = await this.prisma.slidesTeamExecution.count();
        await this.prisma.slidesTeamLog.deleteMany();
        await this.prisma.slidesTeamExecution.deleteMany();
      } catch {
        // Tables may not exist
      }

      // Delete in correct order due to foreign keys
      await this.prisma.slidesCheckpoint.deleteMany();
      await this.prisma.slidesSession.deleteMany();

      const freedKB =
        sessionsCount * STORAGE_SIZE_ESTIMATES.slidesSessions +
        checkpointsCount * STORAGE_SIZE_ESTIMATES.slidesCheckpoints +
        teamExecutionsCount * STORAGE_SIZE_ESTIMATES.slidesTeamExecutions +
        teamLogsCount * STORAGE_SIZE_ESTIMATES.slidesTeamLogs;

      return {
        success: true,
        category: "slides",
        deletedCount: sessionsCount,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Deleted all ${sessionsCount} sessions, ${checkpointsCount} checkpoints, ${teamExecutionsCount} executions, ${teamLogsCount} logs`,
      };
    } catch (error) {
      this.logger.error("Failed to delete all slides:", error);
      return {
        success: false,
        category: "slides",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup a specific knowledge base and all its associated data
   * This removes documents, chunks, and embeddings
   */
  async cleanupKnowledgeBase(knowledgeBaseId: string): Promise<CleanupResult> {
    try {
      // Get counts before deletion for reporting
      const kb = await this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId },
        include: {
          _count: {
            select: {
              documents: true,
            },
          },
        },
      });

      if (!kb) {
        return {
          success: false,
          category: "knowledgeBase",
          deletedCount: 0,
          freedSizeMB: 0,
          message: `Knowledge base not found: ${knowledgeBaseId}`,
        };
      }

      // Count related data for size estimation
      const documentIds = await this.prisma.knowledgeBaseDocument.findMany({
        where: { knowledgeBaseId },
        select: { id: true },
      });

      const parentChunkCount = await this.prisma.parentChunk.count({
        where: { documentId: { in: documentIds.map((d) => d.id) } },
      });

      const childChunkCount = await this.prisma.childChunk.count({
        where: {
          parentChunk: { documentId: { in: documentIds.map((d) => d.id) } },
        },
      });

      const embeddingCount = await this.prisma.childEmbedding.count({
        where: {
          childChunk: {
            parentChunk: { documentId: { in: documentIds.map((d) => d.id) } },
          },
        },
      });

      // Delete knowledge base (cascade will handle related data)
      await this.prisma.knowledgeBase.delete({
        where: { id: knowledgeBaseId },
      });

      // Calculate freed size
      const freedKB =
        kb._count.documents * STORAGE_SIZE_ESTIMATES.knowledgeBaseDocuments +
        parentChunkCount * STORAGE_SIZE_ESTIMATES.parentChunks +
        childChunkCount * STORAGE_SIZE_ESTIMATES.childChunks +
        embeddingCount * STORAGE_SIZE_ESTIMATES.childEmbeddings;

      return {
        success: true,
        category: "knowledgeBase",
        deletedCount: kb._count.documents,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Deleted knowledge base "${kb.name}" with ${kb._count.documents} documents, ${parentChunkCount} parent chunks, ${childChunkCount} child chunks, ${embeddingCount} embeddings`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup knowledge base:", error);
      return {
        success: false,
        category: "knowledgeBase",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Cleanup orphaned RAG data (embeddings without valid child chunks, etc.)
   */
  async cleanupOrphanedRagData(): Promise<CleanupResult> {
    try {
      let totalDeleted = 0;
      let totalFreedKB = 0;

      // 1. Delete orphaned embeddings (where childChunk doesn't exist)
      // Using raw query for efficiency
      const orphanedEmbeddings = await this.prisma.$queryRawUnsafe<
        Array<{ count: string }>
      >(`
        SELECT COUNT(*)::text as count FROM child_embeddings ce
        WHERE NOT EXISTS (
          SELECT 1 FROM child_chunks cc WHERE cc.id = ce.child_chunk_id
        )
      `);
      const orphanedEmbeddingCount = parseInt(
        orphanedEmbeddings[0]?.count || "0",
        10,
      );

      if (orphanedEmbeddingCount > 0) {
        await this.prisma.$executeRawUnsafe(`
          DELETE FROM child_embeddings
          WHERE child_chunk_id NOT IN (SELECT id FROM child_chunks)
        `);
        totalDeleted += orphanedEmbeddingCount;
        totalFreedKB +=
          orphanedEmbeddingCount * STORAGE_SIZE_ESTIMATES.childEmbeddings;
      }

      // 2. Delete orphaned child chunks (where parentChunk doesn't exist)
      const orphanedChildChunks = await this.prisma.$queryRawUnsafe<
        Array<{ count: string }>
      >(`
        SELECT COUNT(*)::text as count FROM child_chunks cc
        WHERE NOT EXISTS (
          SELECT 1 FROM parent_chunks pc WHERE pc.id = cc.parent_chunk_id
        )
      `);
      const orphanedChildChunkCount = parseInt(
        orphanedChildChunks[0]?.count || "0",
        10,
      );

      if (orphanedChildChunkCount > 0) {
        await this.prisma.$executeRawUnsafe(`
          DELETE FROM child_chunks
          WHERE parent_chunk_id NOT IN (SELECT id FROM parent_chunks)
        `);
        totalDeleted += orphanedChildChunkCount;
        totalFreedKB +=
          orphanedChildChunkCount * STORAGE_SIZE_ESTIMATES.childChunks;
      }

      // 3. Delete orphaned parent chunks (where document doesn't exist)
      const orphanedParentChunks = await this.prisma.$queryRawUnsafe<
        Array<{ count: string }>
      >(`
        SELECT COUNT(*)::text as count FROM parent_chunks pc
        WHERE NOT EXISTS (
          SELECT 1 FROM knowledge_base_documents d WHERE d.id = pc.document_id
        )
      `);
      const orphanedParentChunkCount = parseInt(
        orphanedParentChunks[0]?.count || "0",
        10,
      );

      if (orphanedParentChunkCount > 0) {
        await this.prisma.$executeRawUnsafe(`
          DELETE FROM parent_chunks
          WHERE document_id NOT IN (SELECT id FROM knowledge_base_documents)
        `);
        totalDeleted += orphanedParentChunkCount;
        totalFreedKB +=
          orphanedParentChunkCount * STORAGE_SIZE_ESTIMATES.parentChunks;
      }

      return {
        success: true,
        category: "knowledgeBase",
        deletedCount: totalDeleted,
        freedSizeMB: Math.round((totalFreedKB / 1024) * 100) / 100,
        message: `Cleaned up orphaned RAG data: ${orphanedEmbeddingCount} embeddings, ${orphanedChildChunkCount} child chunks, ${orphanedParentChunkCount} parent chunks`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup orphaned RAG data:", error);
      return {
        success: false,
        category: "knowledgeBase",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete ALL knowledge base data (use with caution!)
   */
  async deleteAllKnowledgeBaseData(): Promise<CleanupResult> {
    try {
      // Get counts before deletion
      const embeddingCount = await this.prisma.childEmbedding.count();
      const childChunkCount = await this.prisma.childChunk.count();
      const parentChunkCount = await this.prisma.parentChunk.count();
      const documentCount = await this.prisma.knowledgeBaseDocument.count();
      const kbCount = await this.prisma.knowledgeBase.count();

      // Delete in correct order due to foreign keys
      await this.prisma.childEmbedding.deleteMany();
      await this.prisma.childChunk.deleteMany();
      await this.prisma.parentChunk.deleteMany();
      await this.prisma.knowledgeBaseDocument.deleteMany();
      // Also clean up related tables
      await this.prisma.knowledgeBaseMember.deleteMany();
      await this.prisma.knowledgeBaseSource.deleteMany();
      await this.prisma.knowledgeBase.deleteMany();

      const freedKB =
        embeddingCount * STORAGE_SIZE_ESTIMATES.childEmbeddings +
        childChunkCount * STORAGE_SIZE_ESTIMATES.childChunks +
        parentChunkCount * STORAGE_SIZE_ESTIMATES.parentChunks +
        documentCount * STORAGE_SIZE_ESTIMATES.knowledgeBaseDocuments +
        kbCount * STORAGE_SIZE_ESTIMATES.knowledgeBases;

      return {
        success: true,
        category: "knowledgeBase",
        deletedCount: kbCount,
        freedSizeMB: Math.round((freedKB / 1024) * 100) / 100,
        message: `Deleted all knowledge base data: ${kbCount} knowledge bases, ${documentCount} documents, ${parentChunkCount} parent chunks, ${childChunkCount} child chunks, ${embeddingCount} embeddings`,
      };
    } catch (error) {
      this.logger.error("Failed to delete all knowledge base data:", error);
      return {
        success: false,
        category: "knowledgeBase",
        deletedCount: 0,
        freedSizeMB: 0,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get REAL database table sizes using PostgreSQL system views
   * This shows actual disk usage, not estimates
   */
  async getDatabaseAnalysis(): Promise<DatabaseAnalysis> {
    try {
      // Get total database size using $queryRawUnsafe for better compatibility
      const dbSizeResult = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >("SELECT pg_database_size(current_database())::text as size");

      const totalDatabaseSizeMB =
        Number(dbSizeResult[0]?.size || 0) / (1024 * 1024);

      // Get detailed table sizes including TOAST
      const tableSizes = await this.prisma.$queryRawUnsafe<
        Array<{
          table_name: string;
          row_estimate: string;
          total_bytes: string;
          index_bytes: string;
          table_bytes: string;
          toast_bytes: string;
        }>
      >(`
        SELECT
          c.relname as table_name,
          c.reltuples::bigint::text as row_estimate,
          pg_total_relation_size(c.oid)::text as total_bytes,
          pg_indexes_size(c.oid)::text as index_bytes,
          pg_relation_size(c.oid)::text as table_bytes,
          COALESCE(pg_relation_size(c.reltoastrelid), 0)::text as toast_bytes
        FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `);

      const tables: TableSize[] = tableSizes.map((t) => ({
        tableName: String(t.table_name),
        rowCount: parseInt(t.row_estimate, 10) || 0,
        totalSizeMB:
          Math.round((parseInt(t.total_bytes, 10) / (1024 * 1024)) * 100) / 100,
        dataSizeMB:
          Math.round((parseInt(t.table_bytes, 10) / (1024 * 1024)) * 100) / 100,
        indexSizeMB:
          Math.round((parseInt(t.index_bytes, 10) / (1024 * 1024)) * 100) / 100,
        toastSizeMB:
          Math.round((parseInt(t.toast_bytes, 10) / (1024 * 1024)) * 100) / 100,
      }));

      // Get top 5 largest tables
      const largestTables = tables.slice(0, 5);

      // Generate recommendations
      const recommendations: string[] = [];

      // Check for large TOAST data (usually means large JSON/text fields)
      const tablesWithLargeToast = tables.filter((t) => t.toastSizeMB > 10);
      if (tablesWithLargeToast.length > 0) {
        recommendations.push(
          `Tables with large TOAST data (JSON/text): ${tablesWithLargeToast.map((t) => `${t.tableName}(${t.toastSizeMB}MB)`).join(", ")}. Consider archiving old data.`,
        );
      }

      // Check for tables with high row counts
      const highRowTables = tables.filter((t) => t.rowCount > 10000);
      if (highRowTables.length > 0) {
        recommendations.push(
          `Tables with high row counts: ${highRowTables.map((t) => `${t.tableName}(${t.rowCount} rows)`).join(", ")}`,
        );
      }

      // Specific table recommendations
      const rawDataTable = tables.find((t) => t.tableName === "raw_data");
      if (rawDataTable && rawDataTable.totalSizeMB > 50) {
        recommendations.push(
          `raw_data table is ${rawDataTable.totalSizeMB}MB - consider cleaning processed records older than 30 days`,
        );
      }

      const imagesTable = tables.find(
        (t) => t.tableName === "generated_images",
      );
      if (imagesTable && imagesTable.totalSizeMB > 100) {
        recommendations.push(
          `generated_images table is ${imagesTable.totalSizeMB}MB - consider cleaning unbookmarked images`,
        );
      }

      const topicMessagesTable = tables.find(
        (t) => t.tableName === "topic_messages",
      );
      if (topicMessagesTable && topicMessagesTable.totalSizeMB > 50) {
        recommendations.push(
          `topic_messages table is ${topicMessagesTable.totalSizeMB}MB - consider implementing message archiving`,
        );
      }

      // Check child_embeddings - this is often the largest table (vector storage)
      const embeddingsTable = tables.find(
        (t) => t.tableName === "child_embeddings",
      );
      if (embeddingsTable && embeddingsTable.totalSizeMB > 50) {
        recommendations.push(
          `child_embeddings table is ${embeddingsTable.totalSizeMB}MB (vector storage) - consider archiving unused knowledge bases`,
        );
      }

      // Check if VACUUM is needed (bloat detection)
      const potentialBloat = tables.filter(
        (t) => t.dataSizeMB > 10 && t.rowCount < 1000,
      );
      if (potentialBloat.length > 0) {
        recommendations.push(
          `Potential bloat detected in: ${potentialBloat.map((t) => t.tableName).join(", ")}. Consider running VACUUM FULL.`,
        );
      }

      return {
        totalDatabaseSizeMB: Math.round(totalDatabaseSizeMB * 100) / 100,
        tables,
        largestTables,
        recommendations,
      };
    } catch (error) {
      this.logger.error("Failed to analyze database:", error);
      throw error;
    }
  }

  /**
   * Run VACUUM ANALYZE on all tables to reclaim space
   */
  async vacuumDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      // Note: VACUUM cannot run inside a transaction, so we use a separate connection
      await this.prisma.$executeRawUnsafe("VACUUM ANALYZE");
      return {
        success: true,
        message: "VACUUM ANALYZE completed successfully. Space reclaimed.",
      };
    } catch (error) {
      this.logger.error("Failed to vacuum database:", error);
      return {
        success: false,
        message: `VACUUM failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Run VACUUM FULL on a specific table to reclaim space to OS
   * WARNING: This locks the table exclusively during operation
   */
  async vacuumFullTable(tableName: string): Promise<{
    success: boolean;
    message: string;
    beforeMB?: number;
    afterMB?: number;
  }> {
    try {
      // Validate table name to prevent SQL injection
      // This whitelist includes all tables that can be safely vacuumed
      if (!VACUUM_FULL_ALLOWED_TABLES.includes(tableName as never)) {
        return {
          success: false,
          message: `Invalid table name. Allowed tables: ${VACUUM_FULL_ALLOWED_TABLES.join(", ")}`,
        };
      }

      // Get size before
      // SAFETY: tableName validated by whitelist on line 1956
      const beforeSize = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >(`SELECT pg_total_relation_size($1::regclass)::text as size`, tableName);
      const beforeMB = Number(beforeSize[0]?.size || 0) / (1024 * 1024);

      // SAFETY: tableName validated by whitelist above; VACUUM cannot use parameterized table names
      this.logger.log(`Running VACUUM FULL on ${tableName}...`);
      await this.prisma.$executeRawUnsafe(`VACUUM FULL "${tableName}"`);

      // Get size after
      const afterSize = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >(`SELECT pg_total_relation_size($1::regclass)::text as size`, tableName);
      const afterMB = Number(afterSize[0]?.size || 0) / (1024 * 1024);

      const freedMB = Math.round((beforeMB - afterMB) * 100) / 100;

      return {
        success: true,
        message: `VACUUM FULL completed on ${tableName}. Freed ${freedMB}MB (${Math.round(beforeMB * 100) / 100}MB -> ${Math.round(afterMB * 100) / 100}MB)`,
        beforeMB: Math.round(beforeMB * 100) / 100,
        afterMB: Math.round(afterMB * 100) / 100,
      };
    } catch (error) {
      this.logger.error(`Failed to vacuum full ${tableName}:`, error);
      return {
        success: false,
        message: `VACUUM FULL failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Run VACUUM FULL on all major tables to reclaim disk space
   * WARNING: This locks tables during operation - use during low traffic
   */
  async vacuumFullAll(): Promise<{
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
    const results: Array<{
      table: string;
      beforeMB: number;
      afterMB: number;
      freedMB: number;
    }> = [];
    let totalFreedMB = 0;

    try {
      // Get database size before
      const dbSizeBefore = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >("SELECT pg_database_size(current_database())::text as size");
      const dbBeforeMB = Number(dbSizeBefore[0]?.size || 0) / (1024 * 1024);

      for (const table of VACUUM_FULL_BATCH_TABLES) {
        try {
          // Get size before
          const beforeSize = await this.prisma.$queryRawUnsafe<
            Array<{ size: string }>
          >(`SELECT pg_total_relation_size('${table}')::text as size`);
          const beforeMB = Number(beforeSize[0]?.size || 0) / (1024 * 1024);

          if (beforeMB < 0.1) {
            // Skip tiny tables
            continue;
          }

          this.logger.log(
            `VACUUM FULL ${table} (${Math.round(beforeMB * 100) / 100}MB)...`,
          );
          await this.prisma.$executeRawUnsafe(`VACUUM FULL ${table}`);

          // Get size after
          const afterSize = await this.prisma.$queryRawUnsafe<
            Array<{ size: string }>
          >(`SELECT pg_total_relation_size('${table}')::text as size`);
          const afterMB = Number(afterSize[0]?.size || 0) / (1024 * 1024);
          const freedMB = Math.round((beforeMB - afterMB) * 100) / 100;

          results.push({
            table,
            beforeMB: Math.round(beforeMB * 100) / 100,
            afterMB: Math.round(afterMB * 100) / 100,
            freedMB,
          });
          totalFreedMB += freedMB;
        } catch (tableError) {
          this.logger.warn(`Failed to vacuum ${table}: ${tableError}`);
        }
      }

      // Get database size after
      const dbSizeAfter = await this.prisma.$queryRawUnsafe<
        Array<{ size: string }>
      >("SELECT pg_database_size(current_database())::text as size");
      const dbAfterMB = Number(dbSizeAfter[0]?.size || 0) / (1024 * 1024);
      const actualFreed = Math.round((dbBeforeMB - dbAfterMB) * 100) / 100;

      return {
        success: true,
        message: `VACUUM FULL completed. Database: ${Math.round(dbBeforeMB)}MB -> ${Math.round(dbAfterMB)}MB (freed ${actualFreed}MB)`,
        results,
        totalFreedMB: actualFreed,
      };
    } catch (error) {
      this.logger.error("Failed to vacuum full all:", error);
      return {
        success: false,
        message: `VACUUM FULL ALL failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        results,
        totalFreedMB,
      };
    }
  }

  /**
   * Force checkpoint and clean WAL to reduce disk usage
   */
  async cleanupWAL(): Promise<{ success: boolean; message: string }> {
    try {
      // Force a checkpoint to flush WAL to disk
      await this.prisma.$executeRawUnsafe("CHECKPOINT");

      // Get WAL stats before
      const walBefore = await this.prisma.$queryRawUnsafe<
        Array<{ wal_bytes: string }>
      >(
        "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::text as wal_bytes",
      );

      this.logger.log(
        `WAL position: ${Number(walBefore[0]?.wal_bytes || 0) / (1024 * 1024)}MB`,
      );

      return {
        success: true,
        message: `CHECKPOINT completed. WAL logs flushed. Note: Railway volume may not shrink immediately - this prevents future growth.`,
      };
    } catch (error) {
      this.logger.error("Failed to cleanup WAL:", error);
      return {
        success: false,
        message: `WAL cleanup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get full disk usage breakdown including WAL, system tables, etc.
   */
  async getFullDiskUsage(): Promise<{
    totalDiskMB: number;
    databaseSizeMB: number;
    tableDataMB: number;
    indexesMB: number;
    toastMB: number;
    walEstimateMB: number;
    otherMB: number;
    breakdown: Array<{ category: string; sizeMB: number; percentage: number }>;
  }> {
    try {
      // Get total database size
      const dbSize = await this.prisma.$queryRawUnsafe<Array<{ size: string }>>(
        "SELECT pg_database_size(current_database())::text as size",
      );
      const databaseSizeMB = Number(dbSize[0]?.size || 0) / (1024 * 1024);

      // Get all table sizes with TOAST
      const tableSizes = await this.prisma.$queryRawUnsafe<
        Array<{
          table_bytes: string;
          index_bytes: string;
          toast_bytes: string;
        }>
      >(`
        SELECT
          SUM(pg_relation_size(c.oid))::text as table_bytes,
          SUM(pg_indexes_size(c.oid))::text as index_bytes,
          SUM(COALESCE(pg_relation_size(c.reltoastrelid), 0))::text as toast_bytes
        FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
          AND c.relkind = 'r'
      `);

      const tableDataMB =
        Number(tableSizes[0]?.table_bytes || 0) / (1024 * 1024);
      const indexesMB = Number(tableSizes[0]?.index_bytes || 0) / (1024 * 1024);
      const toastMB = Number(tableSizes[0]?.toast_bytes || 0) / (1024 * 1024);

      // Calculate WAL and other overhead
      const accountedMB = tableDataMB + indexesMB + toastMB;
      const walEstimateMB = Math.max(0, databaseSizeMB - accountedMB);

      // Railway volume is larger than database - the difference is filesystem overhead
      // We can't query this directly, but we can report what we know

      const breakdown = [
        {
          category: "Table Data",
          sizeMB: Math.round(tableDataMB * 100) / 100,
          percentage: Math.round((tableDataMB / databaseSizeMB) * 100),
        },
        {
          category: "Indexes",
          sizeMB: Math.round(indexesMB * 100) / 100,
          percentage: Math.round((indexesMB / databaseSizeMB) * 100),
        },
        {
          category: "TOAST (Large Objects)",
          sizeMB: Math.round(toastMB * 100) / 100,
          percentage: Math.round((toastMB / databaseSizeMB) * 100),
        },
        {
          category: "WAL/System/Other",
          sizeMB: Math.round(walEstimateMB * 100) / 100,
          percentage: Math.round((walEstimateMB / databaseSizeMB) * 100),
        },
      ];

      return {
        totalDiskMB: 406, // From Railway dashboard - hardcoded for now
        databaseSizeMB: Math.round(databaseSizeMB * 100) / 100,
        tableDataMB: Math.round(tableDataMB * 100) / 100,
        indexesMB: Math.round(indexesMB * 100) / 100,
        toastMB: Math.round(toastMB * 100) / 100,
        walEstimateMB: Math.round(walEstimateMB * 100) / 100,
        otherMB: Math.round((406 - databaseSizeMB) * 100) / 100,
        breakdown,
      };
    } catch (error) {
      this.logger.error("Failed to get full disk usage:", error);
      throw error;
    }
  }

  /**
   * Run all cleanup operations
   */
  async runFullCleanup(): Promise<{
    success: boolean;
    results: CleanupResult[];
    totalDeleted: number;
    totalFreedMB: number;
  }> {
    const results: CleanupResult[] = [];

    // Run all cleanup operations
    results.push(await this.cleanupImages(20));
    results.push(await this.cleanupOldRawData(30));
    results.push(await this.cleanupOldCollectionTasks(7));
    results.push(await this.cleanupOldImportTasks(7));
    results.push(await this.cleanupExpiredMetadata());
    results.push(await this.cleanupOldUserActivities(30));
    results.push(await this.cleanupOldAskSessions(30));
    results.push(await this.cleanupOldOfficeDocuments(7));
    results.push(await this.cleanupOldSlides(7));

    const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
    const totalFreedMB = results.reduce((sum, r) => sum + r.freedSizeMB, 0);

    return {
      success: results.every((r) => r.success),
      results,
      totalDeleted,
      totalFreedMB: Math.round(totalFreedMB * 100) / 100,
    };
  }

  /**
   * Get Node.js process memory statistics
   */
  getNodeMemoryStats(): NodeMemoryStats {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
    const heapTotalMB = memUsage.heapTotal / (1024 * 1024);
    const heapUsedPercent = (heapUsedMB / heapTotalMB) * 100;

    const warnings: string[] = [];
    let status: "healthy" | "warning" | "critical" = "healthy";

    if (heapUsedPercent > 90) {
      status = "critical";
      warnings.push("Heap usage exceeds 90%, consider restarting the service");
    } else if (heapUsedPercent > 75) {
      status = "warning";
      warnings.push("Heap usage exceeds 75%, monitor closely");
    }

    const rssMB = memUsage.rss / (1024 * 1024);
    if (rssMB > 512) {
      if (status === "healthy") status = "warning";
      warnings.push(
        `RSS memory is ${Math.round(rssMB)}MB, may indicate memory leak`,
      );
    }

    return {
      heapUsed: Math.round(heapUsedMB * 100) / 100,
      heapTotal: Math.round(heapTotalMB * 100) / 100,
      heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
      rss: Math.round(rssMB * 100) / 100,
      external: Math.round((memUsage.external / (1024 * 1024)) * 100) / 100,
      arrayBuffers:
        Math.round((memUsage.arrayBuffers / (1024 * 1024)) * 100) / 100,
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      status,
      warnings,
    };
  }

  /**
   * Get system (OS) memory statistics
   */
  getSystemMemoryStats(): SystemMemoryStats {
    const totalMem = os.totalmem() / (1024 * 1024 * 1024); // GB
    const freeMem = os.freemem() / (1024 * 1024 * 1024);
    const usedMem = totalMem - freeMem;
    const usedPercent = (usedMem / totalMem) * 100;

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (usedPercent > 90) {
      status = "critical";
    } else if (usedPercent > 80) {
      status = "warning";
    }

    return {
      totalMemory: Math.round(totalMem * 100) / 100,
      freeMemory: Math.round(freeMem * 100) / 100,
      usedMemory: Math.round(usedMem * 100) / 100,
      usedPercent: Math.round(usedPercent * 100) / 100,
      platform: os.platform(),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg().map((l) => Math.round(l * 100) / 100),
      hostname: os.hostname(),
      status,
    };
  }
}
