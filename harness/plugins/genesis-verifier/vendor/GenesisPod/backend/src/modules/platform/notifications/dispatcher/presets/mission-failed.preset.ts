import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { buildAppUrl, buildBrandSubject, escapeHtml } from "./preset-shared";

/**
 * MissionFailedPreset —— mission 失败通知（业务无关，任何 mission 型 app 可用）
 *
 * 镜像 MissionCompletionPreset，区别：
 *   - type = MISSION_FAILED（dispatcher 走偏好矩阵 + 双 channel: email + site）
 *   - 红色主题 + 失败原因 / failureCode + 「重试」入口（caller 传入 missionUrl）
 *
 * 背景：mission 失败此前仅有 WS 实时事件，用户关了 UI 就永远不知道。
 *       本 preset 让失败也能落 email + 站内 inbox（无双源，dispatcher 统一收口）。
 *       由 caller 的终态写 onWon（恰好一次，已过滤用户主动取消）fire-and-forget 触发。
 */
@Injectable()
export class MissionFailedPreset {
  private readonly log = new Logger(MissionFailedPreset.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async notify(params: {
    userId: string;
    missionId: string;
    missionTitle: string;
    /** mission 详情页（用户可在此查看诊断 + 重试） */
    missionUrl: string;
    /** 用户可读的失败原因（已是 displayMessage，预算/超时类已中文化） */
    reason: string;
    /** canonical failure code（如 BUDGET_EXHAUSTED / PROVIDER_API_ERROR），UI/排查用 */
    failureCode?: string;
    failedAt?: Date;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true },
    });
    if (!user) {
      this.log.warn(`mission failed: user not found id=${params.userId}`);
      return;
    }
    const failedAt = params.failedAt ?? new Date();
    const html = this.renderHtml({ ...params, failedAt });
    await this.dispatcher.dispatch(user.id, {
      type: "MISSION_FAILED",
      title: buildBrandSubject(`Mission Failed: ${params.missionTitle}`),
      message: `Mission "${params.missionTitle}" failed — ${params.reason}`,
      link: params.missionUrl,
      emailContext: { html },
      metadata: {
        missionId: params.missionId,
        failureCode: params.failureCode ?? "UNKNOWN",
        failedAt: failedAt.toISOString(),
      },
    });
  }

  private renderHtml(p: {
    missionTitle: string;
    missionUrl: string;
    reason: string;
    failureCode?: string;
    failedAt: Date;
  }): string {
    const fullUrl = buildAppUrl(this.config, p.missionUrl);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:white;margin:0">Mission Failed</h1>
  </div>
  <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#1e293b;margin:0 0 10px">${escapeHtml(p.missionTitle)}</h2>
    <p style="color:#64748b;font-size:14px">Failed at: ${p.failedAt.toLocaleString("en-CA")}</p>
    <div style="background:#fef2f2;padding:20px;border-left:4px solid #ef4444;margin:20px 0">
      <h3 style="color:#991b1b;margin:0 0 10px;font-size:14px">Reason${p.failureCode ? ` (${escapeHtml(p.failureCode)})` : ""}</h3>
      <p style="margin:0;color:#b91c1c;white-space:pre-wrap">${escapeHtml(p.reason.slice(0, 500))}${p.reason.length > 500 ? "..." : ""}</p>
    </div>
    <div style="text-align:center;margin-top:25px">
      <a href="${fullUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;text-decoration:none;border-radius:8px;font-weight:600">View &amp; Retry</a>
    </div>
  </div>
</body></html>`;
  }
}
