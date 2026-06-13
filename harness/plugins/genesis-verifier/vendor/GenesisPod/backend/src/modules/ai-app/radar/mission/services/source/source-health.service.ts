import { Injectable, Logger } from "@nestjs/common";
import { RadarSourceHealth } from "@prisma/client";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RADAR_SCHEDULER_DEFAULTS } from "../../../runtime/radar.constants";

/**
 * Source 健康度跟踪：
 *
 * 成功一次 → consecutiveFailures=0, health=HEALTHY, lastFetchAt=now
 * 失败一次 → consecutiveFailures++, cooldownUntil = now + exponential
 *           失败 1 次 cooldown=60s, 2 次 4min, 3 次 16min, 4+ 1h
 *           consecutiveFailures >= threshold → health=FAILING + 24h cooldown
 *           否则 health=DEGRADED
 *
 * cooldown 解释：S1 source-resolve stage 加载 enabled 且 cooldownUntil <= now 的 source；
 * cooldownUntil > now 的 source 这一轮不参与采集（其他 source 不受影响）。
 */
@Injectable()
export class SourceHealthService {
  private readonly log = new Logger(SourceHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async markSuccess(sourceId: string): Promise<void> {
    await this.prisma.radarSource.update({
      where: { id: sourceId },
      data: {
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFetchAt: new Date(),
        lastError: null,
        health: RadarSourceHealth.HEALTHY,
      },
    });
  }

  async markFailure(sourceId: string, error: string): Promise<void> {
    const source = await this.prisma.radarSource.findUnique({
      where: { id: sourceId },
      select: { consecutiveFailures: true },
    });
    if (!source) return;
    const next = source.consecutiveFailures + 1;
    const threshold = RADAR_SCHEDULER_DEFAULTS.cooldownFailureThreshold;
    const health: RadarSourceHealth =
      next >= threshold
        ? RadarSourceHealth.FAILING
        : RadarSourceHealth.DEGRADED;
    const cooldownMs =
      next >= threshold
        ? 24 * 60 * 60 * 1000 // 24h
        : Math.min(60 * 1000 * Math.pow(4, next - 1), 60 * 60 * 1000);
    await this.prisma.radarSource.update({
      where: { id: sourceId },
      data: {
        consecutiveFailures: next,
        cooldownUntil: new Date(Date.now() + cooldownMs),
        lastError: this.truncate(error, 500),
        health,
      },
    });
    this.log.warn(
      `Source ${sourceId} failed (${next}/${threshold}) → health=${health}, cooldown=${Math.round(cooldownMs / 1000)}s`,
    );
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
  }
}
