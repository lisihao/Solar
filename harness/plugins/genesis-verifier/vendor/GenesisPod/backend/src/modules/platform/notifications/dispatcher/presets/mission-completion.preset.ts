import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { buildAppUrl, buildBrandSubject, escapeHtml } from "./preset-shared";

/**
 * MissionCompletionPreset —— PR-DR1b F3 整改：替代旧
 * EmailNotificationPresetsService.sendMissionCompletionNotification
 *
 * 与旧 service 区别:
 * - userId 入口（dispatcher 走偏好矩阵 + capabilities + 双 channel）
 * - 默认走 email + site（MISSION_COMPLETED 默认策略）
 * - 旧版仅发 email，新版同时落 site 通知（站内 inbox 也能看到，无双源）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §11.1b F3
 */
@Injectable()
export class MissionCompletionPreset {
  private readonly log = new Logger(MissionCompletionPreset.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async notify(params: {
    userId: string;
    missionId: string;
    missionTitle: string;
    reportUrl: string;
    summary?: string;
    completedAt?: Date;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true },
    });
    if (!user) {
      this.log.warn(`mission completion: user not found id=${params.userId}`);
      return;
    }
    const completedAt = params.completedAt ?? new Date();
    const html = this.renderHtml({ ...params, completedAt });
    await this.dispatcher.dispatch(user.id, {
      type: "MISSION_COMPLETED",
      title: buildBrandSubject(`Mission Complete: ${params.missionTitle}`),
      message: `Mission "${params.missionTitle}" completed${params.summary ? ` — ${params.summary}` : ""}`,
      link: params.reportUrl,
      emailContext: { html },
      metadata: {
        missionId: params.missionId,
        completedAt: completedAt.toISOString(),
      },
    });
  }

  private renderHtml(p: {
    missionTitle: string;
    reportUrl: string;
    summary?: string;
    completedAt: Date;
  }): string {
    const fullUrl = buildAppUrl(this.config, p.reportUrl);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:white;margin:0">Mission Complete</h1>
  </div>
  <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#1e293b;margin:0 0 10px">${escapeHtml(p.missionTitle)}</h2>
    <p style="color:#64748b;font-size:14px">Completed at: ${p.completedAt.toLocaleString("en-CA")}</p>
    ${p.summary ? `<div style="background:#f0fdf4;padding:20px;border-left:4px solid #22c55e;margin:20px 0"><h3 style="color:#166534;margin:0 0 10px;font-size:14px">Summary</h3><p style="margin:0;color:#15803d;white-space:pre-wrap">${escapeHtml(p.summary.slice(0, 500))}${p.summary.length > 500 ? "..." : ""}</p></div>` : ""}
    <div style="text-align:center;margin-top:25px">
      <a href="${fullUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;text-decoration:none;border-radius:8px;font-weight:600">View Report</a>
    </div>
  </div>
</body></html>`;
  }
}
