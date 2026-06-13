import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ImportTask, ImportTaskStatus, ResourceType } from "@prisma/client";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";
import { LINK_HEALTH } from "../../../../explore/resources/link-health.constants";
import { precheckYoutubeUrl } from "../../../../explore/resources/youtube-precheck.util";

/**
 * Import Task Processor Service
 * 负责处理PENDING状态的ImportTask，将其转换为实际的Resource记录
 *
 * 工作流程：
 * 1. 查询所有PENDING状态的ImportTask
 * 2. 对每个Task验证其metadata
 * 3. 创建对应的Resource记录
 * 4. 更新ImportTask状态为SUCCESS或FAILED
 */
@Injectable()
export class ImportTaskProcessorService {
  private readonly logger = new Logger(ImportTaskProcessorService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 处理所有PENDING的导入任务
   * 可以被定时任务或手动触发调用
   */
  async processPendingTasks(limit: number = 50): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ taskId: string; error: string }>;
  }> {
    this.logger.log(
      `Starting to process pending import tasks (limit: ${limit})`,
    );

    try {
      // 查询PENDING状态的ImportTask
      const pendingTasks = await this.prisma.importTask.findMany({
        where: {
          status: ImportTaskStatus.PENDING,
        },
        take: limit,
        orderBy: { createdAt: "asc" }, // 先进先出
      });

      this.logger.log(`Found ${pendingTasks.length} pending tasks to process`);

      if (pendingTasks.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0, errors: [] };
      }

      const results = {
        succeeded: 0,
        failed: 0,
        errors: [] as Array<{ taskId: string; error: string }>,
      };

      // 逐个处理任务
      for (const task of pendingTasks) {
        try {
          await this.processTask(task);
          results.succeeded++;
        } catch (error) {
          this.logger.error(
            `Failed to process task ${task.id}: ${getErrorMessage(error)}`,
          );
          results.failed++;
          results.errors.push({
            taskId: task.id,
            error: getErrorMessage(error),
          });

          // 更新任务为FAILED状态
          try {
            await this.prisma.importTask.update({
              where: { id: task.id },
              data: {
                status: ImportTaskStatus.FAILED,
                errorMessage: getErrorMessage(error),
                updatedAt: new Date(),
                completedAt: new Date(),
              },
            });
          } catch (updateError) {
            this.logger.warn(
              `Failed to update task status for ${task.id}: ${getErrorMessage(
                updateError,
              )}`,
            );
          }
        }
      }

      this.logger.log(
        `Processing complete: ${results.succeeded} succeeded, ${results.failed} failed`,
      );

      return {
        processed: pendingTasks.length,
        ...results,
      };
    } catch (error) {
      this.logger.error(
        `Error in processPendingTasks: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 处理单个ImportTask
   */
  private async processTask(task: ImportTask): Promise<void> {
    this.logger.debug(`Processing task: ${task.id}`);

    // 标记为PROCESSING
    await this.prisma.importTask.update({
      where: { id: task.id },
      data: {
        status: ImportTaskStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    try {
      // 验证必要的字段
      if (!task.sourceUrl || !task.resourceType) {
        throw new Error(`Invalid task data: missing sourceUrl or resourceType`);
      }

      // 检查Resource是否已存在
      const existingResource = await this.prisma.resource.findFirst({
        where: { sourceUrl: task.sourceUrl },
      });

      let resourceId: string;

      if (existingResource) {
        // 如果Resource已存在，直接关联
        this.logger.log(
          `Resource already exists for URL ${task.sourceUrl}, linking to task`,
        );
        resourceId = existingResource.id;
      } else {
        // YouTube 入库前 oEmbed 预检：400/401/404 直接放弃，不污染库存
        // 拒绝事件本身不写 lifecycle 表（resource 还没创建，没 resourceId 可绑），
        // ImportTask 表的 errorMessage 已经持久化拒绝原因，可直接查询。
        const precheck = await precheckYoutubeUrl(task.sourceUrl);
        if (precheck.verdict === "dead") {
          this.logger.warn(
            `Skipping dead YouTube URL ${task.sourceUrl} (${precheck.reason})`,
          );
          await this.prisma.importTask.update({
            where: { id: task.id },
            data: {
              status: ImportTaskStatus.FAILED,
              errorMessage: `YouTube video unavailable (${precheck.reason})`,
              updatedAt: new Date(),
              completedAt: new Date(),
            },
          });
          return;
        }

        // 创建新的Resource
        const metadata =
          task.metadata &&
          typeof task.metadata === "object" &&
          !Array.isArray(task.metadata)
            ? (task.metadata as Record<string, unknown>)
            : {};
        const title = (metadata.title as string | undefined) || task.sourceUrl;
        const abstract =
          (metadata.abstract as string | undefined) ||
          (metadata.description as string | undefined) ||
          null;

        // 预检 healthy → linkHealth=HEALTHY 入库，前端立即可见且不显示警告
        // 预检 unknown（非 YouTube 或网络错误）→ 走默认 UNKNOWN，等待 health checker
        // 注意：lastHealthCheckAt 故意保持 null —— 让 health-checker 的"24h 加速回查"
        // 队列在入库后能再确认一次，捕获"博主刚发不久就删/审核下架"的场景
        const initialHealth =
          precheck.verdict === "healthy"
            ? LINK_HEALTH.HEALTHY
            : LINK_HEALTH.UNKNOWN;

        const resource = await this.prisma.resource.create({
          data: {
            type: task.resourceType as ResourceType,
            title,
            abstract,
            sourceUrl: task.sourceUrl,
            publishedAt: new Date(),
            linkHealth: initialHealth,
            // 默认值
            upvoteCount: 0,
            viewCount: 0,
            commentCount: 0,
            qualityScore: "0",
            trendingScore: 0,
          },
        });

        resourceId = resource.id;
        this.logger.log(
          `Created new resource: ${resourceId} for task ${task.id} (linkHealth=${initialHealth})`,
        );
      }

      // 更新ImportTask为SUCCESS并关联Resource
      await this.prisma.importTask.update({
        where: { id: task.id },
        data: {
          status: ImportTaskStatus.SUCCESS,
          resourceId: resourceId,
          itemsProcessed: 1,
          itemsSaved: 1,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      this.logger.log(
        `Task ${task.id} processed successfully, linked to resource ${resourceId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing task ${task.id}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取导入任务统计
   */
  async getTaskStats(): Promise<{
    pending: number;
    processing: number;
    success: number;
    failed: number;
    total: number;
  }> {
    const [pending, processing, success, failed, total] = await Promise.all([
      this.prisma.importTask.count({
        where: { status: ImportTaskStatus.PENDING },
      }),
      this.prisma.importTask.count({
        where: { status: ImportTaskStatus.PROCESSING },
      }),
      this.prisma.importTask.count({
        where: { status: ImportTaskStatus.SUCCESS },
      }),
      this.prisma.importTask.count({
        where: { status: ImportTaskStatus.FAILED },
      }),
      this.prisma.importTask.count(),
    ]);

    return { pending, processing, success, failed, total };
  }
}
