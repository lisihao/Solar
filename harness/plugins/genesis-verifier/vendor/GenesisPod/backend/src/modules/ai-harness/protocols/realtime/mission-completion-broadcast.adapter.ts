import { Injectable, Logger } from "@nestjs/common";
import type { IBroadcastAdapter, DomainEvent } from "@/common/events";
import { NotificationPresetsService } from "@/modules/platform/facade";

/**
 * MissionCompletionBroadcastAdapter
 *
 * 把任意业务模块 emit 的 `<domain>.mission:completed` DomainEvent 桥接成持久化通知。
 *
 * 通用（零业务名）设计：
 *   - 事件类型用后缀 `.mission:completed` 匹配，不硬编码具体业务前缀
 *   - 通知所需的 missionTitle / appBasePath / relatedType 全部由 **emit 侧放进 payload**
 *     （platform/harness 不感知任何具体业务模块的路由）
 *   - 写库失败只记日志，不抛错（业务流不能被通知层拖垮）
 *
 * 落点：ai-harness/protocols/realtime —— 它持有 EventBus（本层），向下依赖 platform 的
 * NotificationPresetsService 合法（L2.5→L1）；generic 后无业务唯一名，不触发 base-layer
 * 业务泄漏看护（layer-boundaries R0-A5）。与 socket-broadcast.adapter / LoggerBroadcastAdapter 同位。
 */
@Injectable()
export class MissionCompletionBroadcastAdapter implements IBroadcastAdapter {
  readonly id = "mission-completion-notify";
  private readonly log = new Logger(MissionCompletionBroadcastAdapter.name);

  constructor(private readonly presets: NotificationPresetsService) {}

  accepts(event: DomainEvent): boolean {
    return event.type.endsWith(".mission:completed");
  }

  async broadcast(event: DomainEvent): Promise<void> {
    const userId = event.scope?.userId;
    const missionId = event.scope?.missionId;
    if (!userId || !missionId) {
      this.log.debug(
        `Skipping ${event.type}: missing userId/missionId in scope`,
      );
      return;
    }

    const payload = event.payload as
      | {
          leaderSigned?: boolean;
          reviewScore?: number;
          missionTitle?: string;
          /** 业务侧应用根路径（如 "/<app>/missions"）—— emit 侧注入，platform 不感知 */
          appBasePath?: string;
          /** relatedType —— emit 侧注入（数据字段，不参与命名校验） */
          relatedType?: string;
        }
      | undefined;

    // 拒签的 mission（leaderSigned=false）虽走 markCompleted 但不应通知"已完成"
    if (payload?.leaderSigned === false) {
      this.log.debug(
        `Skipping ${event.type} for ${missionId}: leader did not sign`,
      );
      return;
    }

    // 业务路由必须由 emit 侧提供；缺失则跳过（避免拼出错误/404 的 actionUrl）
    if (!payload?.appBasePath || !payload?.relatedType) {
      this.log.debug(
        `Skipping ${event.type} for ${missionId}: payload missing appBasePath/relatedType`,
      );
      return;
    }

    try {
      await this.presets.notifyMissionCompleted({
        userId,
        missionId,
        missionTitle: payload.missionTitle?.trim()?.slice(0, 200) || missionId,
        appBasePath: payload.appBasePath,
        relatedType: payload.relatedType,
        reviewScore: payload.reviewScore,
      });
    } catch (err) {
      // 只记日志：通知失败绝不影响业务流
      this.log.warn(
        `Failed to persist notification for ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
