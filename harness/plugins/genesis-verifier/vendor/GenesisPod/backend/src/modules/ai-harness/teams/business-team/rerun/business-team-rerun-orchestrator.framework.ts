/**
 * BusinessAgentTeam — Mission Rerun Orchestrator Framework（P5 Wave 1，2026-05-24）
 *
 * @migrated-from ai-app/playground/services/mission/rerun/mission-rerun-orchestrator.service.ts
 *
 * 抽出 A 路线 mission rerun（创建新 mission）编排骨架。业务方实现 hook 即可获得
 * "rerun guard + status 白名单 + ownership + checkpoint clone + emit + fire-and-forget"
 * 全套机制。
 *
 * 机制（framework）：
 *   - assertSourceMissionRerunnable: rerunGuard.ensureRerunable + 白名单 status 校验
 *   - newMissionId 生成（randomUUID）
 *   - ownership.assign + checkpoint clone（incremental mode）
 *   - emit mission:manual-rerun-from-todo
 *   - fire-and-forget orchestratorRun + 错误 log
 *
 * 业务（hooks）：
 *   - rerunGuard / sourceMissionResolver / extractStatus / extractTopic
 *   - rerunnableStatuses 白名单（completed/failed/quality-failed/cancelled 等）
 *   - cloneInput / runMission / assignOwnership / cloneCheckpoint
 *   - emit / eventNames / streamNamespace
 */

import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  MissionRerunOrchestratorHooks,
  MissionRerunRequest,
  MissionRerunResult,
} from "./abstractions/rerun-orchestrator.contract";
import { RERUN_TOPIC_LIMIT_DEFAULT } from "./abstractions/rerun-orchestrator.contract";

export abstract class BusinessTeamRerunOrchestratorFramework<
  TSourceMission,
  TInput,
  TTodoBody,
> {
  protected readonly log: Logger;

  constructor(
    protected readonly hooks: MissionRerunOrchestratorHooks<
      TSourceMission,
      TInput,
      TTodoBody
    >,
    namespace: string,
  ) {
    this.log = new Logger(`${namespace}-rerun-orchestrator`);
  }

  /**
   * Source mission rerun 前置校验（业务方调 framework）。
   *
   *   1. rerunGuard.ensureRerunable（in-flight + zombie cleanup）
   *   2. sourceMissionResolver（含 ownership）
   *   3. status 白名单
   */
  protected async assertSourceMissionRerunnable(
    sourceMissionId: string,
    userId: string,
  ): Promise<TSourceMission> {
    await this.hooks.rerunGuard.ensureRerunable(sourceMissionId, userId);

    const original = await this.hooks.sourceMissionResolver(
      sourceMissionId,
      userId,
    );
    if (!original) {
      throw new ForbiddenException(`mission ${sourceMissionId} not found`);
    }
    const status = this.hooks.extractStatus(original);
    if (!this.hooks.rerunnableStatuses.includes(status)) {
      throw new BadRequestException(
        `Source mission cannot be rerun from status "${status}" — must be one of: ${this.hooks.rerunnableStatuses.join(", ")}`,
      );
    }
    return original;
  }

  /**
   * Full mission rerun：复用 source mission 配置，可选 checkpoint clone。
   *
   * Note: protected method — 业务子类可暴露自己签名的 `rerunFullMission`（controller
   * 习惯 (id, userId, mode) 三参；framework 接受 request 对象），通过 `this[...]` 调本核心。
   */
  protected async rerunFullMissionFrameworkCore(
    request: Pick<MissionRerunRequest, "sourceMissionId" | "userId" | "mode">,
  ): Promise<MissionRerunResult> {
    const { sourceMissionId, userId } = request;
    const mode = request.mode ?? "incremental";

    const original = await this.assertSourceMissionRerunnable(
      sourceMissionId,
      userId,
    );

    const input = this.hooks.cloneInput(original, {
      inheritFromMissionId:
        mode === "incremental" ? sourceMissionId : undefined,
    });

    const newMissionId = randomUUID();
    this.hooks.assignOwnership(newMissionId, userId);

    if (mode === "incremental" && this.hooks.cloneCheckpoint) {
      const cloned = await this.hooks
        .cloneCheckpoint(sourceMissionId, newMissionId)
        .catch(() => false);
      if (cloned) {
        this.log.log(
          `[rerun:${mode}] mission ${newMissionId} resumed from ${sourceMissionId} checkpoint + inheritFromMissionId set`,
        );
      } else {
        this.log.log(
          `[rerun:${mode}] mission ${newMissionId} no checkpoint to clone, but inheritFromMissionId set`,
        );
      }
    } else {
      this.log.log(
        `[rerun:${mode}] mission ${newMissionId} fresh restart from ${sourceMissionId}`,
      );
    }

    void this.hooks
      .runMission(newMissionId, input, userId)
      .catch((err: unknown) => {
        this.log.error(
          `mission ${newMissionId} (rerun of ${sourceMissionId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return {
      missionId: newMissionId,
      streamNamespace: this.hooks.streamNamespace,
    };
  }

  /**
   * Todo rerun：复用 source mission 配置 + emit mission:manual-rerun-from-todo。
   *
   * 业务方负责 todoBody schema（origin / scope / dimensionRef / chapterIndex 等）。
   * Framework 透传 payload 给 emit（业务 emit 实现把字段平铺写入 audit event）。
   *
   * Note: 改名为 `rerunFromTodoFrameworkCore` 避免与业务子类自定义 `rerunFromTodo`
   * （业务 schema：`{ sourceMissionId, userId, todoId, body }`）签名冲突。业务子类
   * 内部调 super.rerunFromTodoFrameworkCore 注入 buildEmitPayload + topicOverride。
   */
  protected async rerunFromTodoFrameworkCore(
    request: MissionRerunRequest<TTodoBody> & {
      readonly todoId: string;
      readonly todoBody: TTodoBody;
    },
    /** business 决定 todoBody → payload 平铺（origin/scope/... 字段映射） */
    buildEmitPayload: (body: TTodoBody) => Record<string, unknown>,
    /** business 决定 todoBody → topic override（如 trim 末尾 / focused topic） */
    extractTopicOverride?: (
      body: TTodoBody,
      sourceTopic: string,
    ) => string | undefined,
    /** topic 长度上限（默认 200） */
    topicLimit: number = RERUN_TOPIC_LIMIT_DEFAULT,
  ): Promise<MissionRerunResult> {
    const { sourceMissionId, userId, todoId, todoBody } = request;

    const original = await this.assertSourceMissionRerunnable(
      sourceMissionId,
      userId,
    );

    const sourceTopic = this.hooks.extractTopic(original);
    const topicOverride = extractTopicOverride
      ? extractTopicOverride(todoBody, sourceTopic)
      : sourceTopic.slice(0, topicLimit);

    const input = this.hooks.cloneInput(original, {
      topic: topicOverride,
    });

    const newMissionId = randomUUID();
    this.hooks.assignOwnership(newMissionId, userId);

    await this.hooks.emit({
      type: this.hooks.eventNames.manualRerunFromTodo,
      missionId: newMissionId,
      userId,
      payload: {
        sourceMissionId,
        sourceTodoId: todoId,
        ...buildEmitPayload(todoBody),
      },
    });

    void this.hooks
      .runMission(newMissionId, input, userId)
      .catch((err: unknown) => {
        this.log.error(
          `mission ${newMissionId} (rerun-todo ${todoId} of ${sourceMissionId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return {
      missionId: newMissionId,
      streamNamespace: this.hooks.streamNamespace,
    };
  }
}
