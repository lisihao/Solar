import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { NotificationPresetsService } from "./presets/notification-presets.service";

/**
 * 业务模块 emit 的"任务完成"事件 payload 标准。
 * 模块通过 `notification.task-completed` 事件名 + kind 字段区分类型。
 */
export interface TaskCompletedNotificationPayload {
  kind: "research" | "writing" | "office-slides";
  userId: string;
  /** 任务/mission/project 的主键，用于点击跳转 */
  refId: string;
  /** 二级关联 id（如 writing 的 projectId、research 的 topicId） */
  parentId?: string;
  /** 给用户看的标题 */
  title: string;
  /** kind=writing 用，标识任务子类型（continue-story / full-story 等） */
  missionType?: string;
  /** 数值指标（评分 / 字数 / 页数 等） */
  metrics?: {
    reviewScore?: number;
    totalWords?: number;
    pageCount?: number;
    completedTasks?: number;
    totalTasks?: number;
  };
}

/**
 * NotificationEventListener
 *
 * 业务模块（research / writing / office）走自有 SocketIO emit，**没上 EventBus**，
 * 所以 NotificationBroadcastAdapter 那条路接不到它们。这里通过 NestJS 的 EventEmitter2
 * 标准 `@OnEvent` 接收业务模块 fire-and-forget emit 的 `notification.task-completed` 事件。
 *
 * 业务模块在 mission 完成时只需一行：
 *   this.eventEmitter.emit("notification.task-completed", {
 *     kind: "research", userId, refId: missionId, parentId: topicId, title,
 *     metrics: { completedTasks, totalTasks },
 *   });
 *
 * 失败模式：所有 handler 内 try/catch 只 log，不抛错（通知不能阻塞业务流）。
 */
@Injectable()
export class NotificationEventListener {
  private readonly log = new Logger(NotificationEventListener.name);

  constructor(private readonly presets: NotificationPresetsService) {}

  @OnEvent("notification.task-completed")
  async handleTaskCompleted(
    payload: TaskCompletedNotificationPayload,
  ): Promise<void> {
    if (!payload?.userId || !payload?.refId) {
      this.log.debug(
        `Skipping notification.task-completed: missing userId/refId (kind=${payload?.kind})`,
      );
      return;
    }

    try {
      switch (payload.kind) {
        case "research":
          // ★ 2026-05-12: parentId = topicId（mission-execution.service.ts 已传），
          //   preset 用它构造 /ai-insights/topic/{topicId} 真实路由；不传则退回
          //   /ai-insights/topic-research 列表页。
          await this.presets.notifyResearchCompleted({
            userId: payload.userId,
            researchId: payload.refId,
            researchTitle: payload.title || payload.refId,
            topicId: payload.parentId,
          });
          return;

        case "writing":
          await this.presets.notifyWritingTaskCompleted({
            userId: payload.userId,
            projectId: payload.parentId ?? payload.refId,
            missionId: payload.refId,
            projectName: payload.title || payload.refId,
            missionType: payload.missionType ?? "写作任务",
            appBasePath: "/ai-writing/projects",
            relatedType: "writing-mission",
            totalWords: payload.metrics?.totalWords,
          });
          return;

        case "office-slides":
          await this.presets.notifyOfficeSlidesCompleted({
            userId: payload.userId,
            missionId: payload.refId,
            title: payload.title || payload.refId,
            appBasePath: "/ai-office/slides",
            relatedType: "slides-mission",
            pageCount: payload.metrics?.pageCount,
          });
          return;

        default: {
          // exhaustive guard — kind 加了新值时编译期捕获
          const _never: never = payload.kind;
          this.log.debug(`Unknown task-completed kind: ${String(_never)}`);
        }
      }
    } catch (err) {
      this.log.warn(
        `Failed to persist notification for kind=${payload.kind} ref=${payload.refId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
