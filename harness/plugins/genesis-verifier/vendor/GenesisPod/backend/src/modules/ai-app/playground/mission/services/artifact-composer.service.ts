/**
 * ArtifactComposerService — Canonical mission artifact composition（P0-2 服务化）
 *
 * 落地依据：thinning plan §6.6 / §6.6.2 / §6.6.4 / §B3-2.
 *
 * 取代之前的纯函数 `projectArtifact()`。差异：
 *   1. NestJS @Injectable，可注入 PrismaService + ObjectStorageService
 *   2. §6.6.4 R2 off-load 真实 fetch：reportFull = null 且 reportFullUri 非空时
 *      从 R2 拉 JSON，然后再走 v1→v2 normalize；不再仅 hasOffloadUri 推断
 *   3. async return（之前 sync pure function）；query service 在 loadInputs
 *      内 await 这次组合，结果作为 inputs.composedArtifact 喂给 projector
 *   4. §6.6.2 v1→v2 normalize 逻辑保留在 artifact.projector 模块（pure helper，
 *      不耦合 NestJS），service 调它
 *
 * 当前未做（标 TODO follow-up）：
 *   - PII scrub via ai-engine/safety facade — 等 B7 P0 PII tracking 落地后接入
 *   - R2 fetch 失败时的 retry / circuit breaker — 现在直接降级 sentinel
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import { PrismaService } from "@/common/prisma/prisma.service";
import { ObjectStorageService } from "@/modules/platform/facade";

import type { MissionDetail } from "../lifecycle/mission-store.service";
import {
  normalizeV1ToV2,
  projectArtifact,
} from "../projectors/artifact.projector";
import type { ReportArtifactV2 } from "../../api/contracts/artifact.contract";
import { isReportArtifactV2 } from "../../api/contracts/artifact.contract";
import type { EmptyArtifactSentinel } from "../../api/contracts/view-state.contract";

interface V1Report {
  title?: string;
  summary?: string;
  sections?: Array<{ heading: string; body: string; sources?: string[] }>;
  conclusion?: string;
  citations?: string[];
}

@Injectable()
export class ArtifactComposerService {
  private readonly log = new Logger(ArtifactComposerService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional：StorageModule 未 import 时 R2 fetch 路径退化为 sentinel，避免
    // playground.module 强依赖 StorageModule 触发循环。后续 wiring 完
    // R2 后此 @Optional 可去掉。
    @Optional() private readonly r2?: ObjectStorageService,
  ) {}

  /**
   * 主入口：根据 mission row 真实组合 canonical reportArtifact。
   *
   * 优先级（descending）：
   *   1. row.reportFull 非空 → 走 pure projectArtifact() 同步路径
   *   2. row.reportFull = null 但 reportFullUri 存在（off-load 已生效）：
   *      → R2 downloadText → JSON.parse → 等价 row.reportFull 走 projectArtifact 逻辑
   *   3. R2 fetch 失败 / 无 URI → sentinel
   *
   * @returns 同步 / 异步均返回 union；caller 必须 await
   */
  async composeArtifactView(
    row: MissionDetail,
  ): Promise<ReportArtifactV2 | EmptyArtifactSentinel> {
    // Path 1: inline reportFull
    if (row.reportFull != null) {
      return projectArtifact(row);
    }

    // Path 2: off-load
    const uri = await this.lookupReportFullUri(row.id);
    if (!uri) {
      return projectArtifact(row); // sentinel via pure path
    }

    const fetched = await this.fetchOffloadedReportFull(row.id, uri);
    if (!fetched) {
      this.log.warn(
        `[composeArtifactView ${row.id}] off-load fetch returned null; falling back to sentinel`,
      );
      return {
        kind: "empty-artifact",
        reason: "v1-needs-normalization",
      };
    }

    // 把 fetched JSON 当作 row.reportFull 走 normalize
    if (isReportArtifactV2(fetched)) return fetched;
    if (typeof fetched === "object") {
      const v1 = fetched as V1Report;
      if (v1.sections || v1.summary || v1.title) {
        return normalizeV1ToV2(v1);
      }
    }
    return { kind: "empty-artifact", reason: "v1-needs-normalization" };
  }

  /**
   * 查 reportFullUri（MissionDetail 未暴露此字段，service 直接走 prisma select）。
   * 返回 null 表示无 off-load 痕迹（reportFull 真的就是空）。
   */
  private async lookupReportFullUri(missionId: string): Promise<string | null> {
    try {
      const row = await this.prisma.agentPlaygroundMission.findUnique({
        where: { id: missionId },
        select: { reportFullUri: true, reportFullSize: true },
      });
      if (!row) return null;
      if (row.reportFullUri && row.reportFullSize && row.reportFullSize > 0) {
        return row.reportFullUri;
      }
      return null;
    } catch (err: unknown) {
      this.log.warn(
        `[lookupReportFullUri ${missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * 从 R2 拉 JSON。失败返回 null（caller 降级 sentinel）。
   */
  private async fetchOffloadedReportFull(
    missionId: string,
    uri: string,
  ): Promise<unknown | null> {
    if (!this.r2) {
      this.log.warn(
        `[fetchOffloadedReportFull ${missionId}] ObjectStorageService not wired into PlaygroundModule; off-load fetch unavailable, returning null`,
      );
      return null;
    }
    // §6.6.4 假设 uri 是 R2 key（可能带 `r2://` 前缀，去掉以适配 downloadText）
    const key = uri.startsWith("r2://") ? uri.slice("r2://".length) : uri;
    try {
      const text = await this.r2.downloadText(key);
      if (!text) return null;
      return JSON.parse(text) as unknown;
    } catch (err: unknown) {
      this.log.warn(
        `[fetchOffloadedReportFull ${missionId} key=${key}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
