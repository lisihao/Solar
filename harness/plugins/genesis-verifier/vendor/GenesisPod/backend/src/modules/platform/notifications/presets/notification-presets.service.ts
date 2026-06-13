import { Injectable } from "@nestjs/common";
import { NotificationService } from "../notification.service";
import { NotificationTypeDto } from "../notification.types";

@Injectable()
export class NotificationPresetsService {
  constructor(private readonly notificationService: NotificationService) {}

  async notifyJoinRequest(params: {
    topicId: string;
    topicName: string;
    applicantId: string;
    applicantName: string;
    adminUserIds: string[];
  }) {
    const { topicId, topicName, applicantId, applicantName, adminUserIds } =
      params;

    await this.notificationService.batchCreateNotifications({
      userIds: adminUserIds,
      type: NotificationTypeDto.JOIN_REQUEST,
      title: "新的加入申请",
      message: `${applicantName} 申请加入「${topicName}」`,
      actionUrl: `/topics/${topicId}/settings/members`,
      actionLabel: "查看申请",
      metadata: { topicId, applicantId, applicantName },
    });
  }

  async notifyJoinRequestResult(params: {
    userId: string;
    topicId: string;
    topicName: string;
    approved: boolean;
    reason?: string;
  }) {
    const { userId, topicId, topicName, approved, reason } = params;

    await this.notificationService.createNotification({
      userId,
      type: approved
        ? NotificationTypeDto.JOIN_APPROVED
        : NotificationTypeDto.JOIN_REJECTED,
      title: approved ? "申请已通过" : "申请未通过",
      message: approved
        ? `你加入「${topicName}」的申请已通过`
        : `你加入「${topicName}」的申请未通过${reason ? `：${reason}` : ""}`,
      actionUrl: approved ? `/topics/${topicId}` : undefined,
      actionLabel: approved ? "进入团队" : undefined,
      relatedType: "topic",
      relatedId: topicId,
      metadata: { topicId, approved, reason },
    });
  }

  async notifyInvitation(params: {
    userId: string;
    topicId: string;
    topicName: string;
    inviterName: string;
    inviteCode?: string;
  }) {
    const { userId, topicId, topicName, inviterName, inviteCode } = params;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.INVITATION,
      title: "邀请加入团队",
      message: `${inviterName} 邀请你加入「${topicName}」`,
      actionUrl: inviteCode
        ? `/invitations/${inviteCode}`
        : `/topics/${topicId}`,
      actionLabel: "查看邀请",
      relatedType: "topic",
      relatedId: topicId,
      metadata: { topicId, inviterName, inviteCode },
    });
  }

  async notifyResearchCompleted(params: {
    userId: string;
    researchId: string;
    researchTitle: string;
    /**
     * ★ 2026-05-12: 由上层业务消费方传入，用作详情页跳转主键（前端真实路由
     *   /ai-insights/topic/[topicId]）。旧 /research/[id] 在 Next.js 里无对应
     *   page，点了必 404（用户反馈 2026-05-12）。不传则回退到列表页。
     */
    topicId?: string;
  }) {
    const { userId, researchId, researchTitle, topicId } = params;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.RESEARCH_COMPLETED,
      title: "研究任务完成",
      message: `研究「${researchTitle}」已完成`,
      actionUrl: topicId
        ? `/ai-insights/topic/${topicId}`
        : `/ai-insights/topic-research`,
      actionLabel: "查看报告",
      relatedType: "research",
      relatedId: researchId,
    });
  }

  /**
   * 长任务 mission 完成通知（上层消费方按业务侧含义传 missionTitle）。
   * W4 (2026-05-05): 切到独立 MISSION_COMPLETED 枚举（schema 已迁移）；
   * appBasePath / relatedType 由消费方传入，platform 不感知具体业务路由。
   */
  async notifyMissionCompleted(params: {
    userId: string;
    missionId: string;
    missionTitle: string;
    /** 业务侧应用根路径（如 "/<app>/missions"），由上层消费方传入；platform 不感知具体业务路由 */
    appBasePath: string;
    /** relatedType 由上层消费方提供（数据字段不参与命名校验）*/
    relatedType: string;
    reviewScore?: number;
  }) {
    const {
      userId,
      missionId,
      missionTitle,
      appBasePath,
      relatedType,
      reviewScore,
    } = params;
    const scoreSuffix =
      typeof reviewScore === "number" ? `（评分 ${reviewScore}）` : "";

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.MISSION_COMPLETED,
      title: "Mission 已完成",
      message: `「${missionTitle}」已完成${scoreSuffix}`,
      // ★ 2026-05-06: 路由段 "/team/" 由消费方约定（前端真实 mission 详情路由）
      //   旧值 "/missions/" 与前端不一致导致 404；platform 不感知具体业务名
      actionUrl: `${appBasePath}/team/${missionId}`,
      actionLabel: "查看报告",
      relatedType,
      relatedId: missionId,
      metadata: { reviewScore },
    });
  }

  /**
   * 长篇写作任务完成通知（章节 / 全文）。
   * appBasePath / relatedType 由消费方传入（platform 不感知 ai-writing/* 路由命名）。
   */
  async notifyWritingTaskCompleted(params: {
    userId: string;
    projectId: string;
    missionId: string;
    projectName: string;
    missionType: string;
    /** 业务侧应用根路径（如 "/<app>/projects"），由上层消费方传入 */
    appBasePath: string;
    /** relatedType 由上层消费方提供（数据字段不参与命名校验） */
    relatedType: string;
    totalWords?: number;
  }) {
    const {
      userId,
      projectId,
      missionId,
      projectName,
      missionType,
      appBasePath,
      relatedType,
      totalWords,
    } = params;
    const wordsSuffix =
      typeof totalWords === "number" ? `（${totalWords} 字）` : "";

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.WRITING_COMPLETED,
      title: "写作任务已完成",
      message: `「${projectName}」的 ${missionType} 已生成完毕${wordsSuffix}`,
      actionUrl: `${appBasePath}/${projectId}`,
      actionLabel: "查看作品",
      relatedType,
      relatedId: missionId,
      metadata: { projectId, missionType, totalWords },
    });
  }

  /**
   * Slides 生成完成通知。
   * appBasePath / relatedType 由消费方传入（platform 不感知 ai-office/* 路由命名）。
   */
  async notifyOfficeSlidesCompleted(params: {
    userId: string;
    missionId: string;
    title: string;
    /** 业务侧应用根路径（如 "/<app>/slides"），由上层消费方传入 */
    appBasePath: string;
    /** relatedType 由上层消费方提供 */
    relatedType: string;
    pageCount?: number;
  }) {
    const { userId, missionId, title, appBasePath, relatedType, pageCount } =
      params;
    const pagesSuffix =
      typeof pageCount === "number" ? `（共 ${pageCount} 页）` : "";

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.OFFICE_COMPLETED,
      title: "Slides 生成完成",
      message: `「${title}」已生成完毕${pagesSuffix}`,
      actionUrl: `${appBasePath}/${missionId}`,
      actionLabel: "查看演示",
      relatedType,
      relatedId: missionId,
      metadata: { pageCount },
    });
  }

  async notifyCreditsLow(params: {
    userId: string;
    balance: number;
    threshold: number;
  }) {
    const { userId, balance, threshold } = params;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.CREDITS_LOW,
      title: "积分余额不足",
      message: `你的积分余额仅剩 ${balance}，低于 ${threshold}`,
      actionUrl: "/credits",
      actionLabel: "查看积分",
      metadata: { balance, threshold },
    });
  }

  /**
   * 用户提交 BYOK 密钥申请 → fan-out 到所有 admin。
   * 用户提交时不指定 provider/model（admin 未必有该 provider 可用模型，
   * 强选会卡死申请）；admin 在审批界面自由选模型授权。
   * adminUserIds 由调用方查询传入（presets 不感知 user role）。
   */
  async notifyKeyRequestSubmitted(params: {
    adminUserIds: string[];
    requestId: string;
    requesterEmail: string;
    estimatedUsage?: string | null;
  }) {
    const { adminUserIds, requestId, requesterEmail, estimatedUsage } = params;
    if (adminUserIds.length === 0) return;

    const usageSuffix = estimatedUsage ? `（用量预估：${estimatedUsage}）` : "";
    // batchCreateNotifications DTO 不支持 relatedType/relatedId，故把 requestId 放 metadata；
    // admin 端列表展示时也优先读 metadata.requestId 跳详情
    await this.notificationService.batchCreateNotifications({
      userIds: adminUserIds,
      type: NotificationTypeDto.KEY_REQUEST_SUBMITTED,
      title: "新的密钥申请",
      message: `${requesterEmail} 提交了 API Key 申请${usageSuffix}`,
      // Wave 4 (2026-05-11): key-requests 已并入 secrets 页 Tab，旧路径自动 redirect
      actionUrl: "/admin/access/secrets?tab=requests",
      actionLabel: "查看申请",
      metadata: { requestId, requesterEmail, estimatedUsage },
    });
  }

  /**
   * 用户提交新反馈 → fan-out 站内信给所有 admin（与 admin 邮件并存，邮件单独发）。
   * adminUserIds 由调用方查询传入（presets 不感知 user role，与 key-request 一致）。
   */
  async notifyFeedbackReceived(params: {
    adminUserIds: string[];
    feedbackId: string;
    feedbackType: string;
    title: string;
    requesterEmail?: string | null;
  }) {
    const { adminUserIds, feedbackId, feedbackType, title, requesterEmail } =
      params;
    if (adminUserIds.length === 0) return;

    const fromSuffix = requesterEmail ? `（来自 ${requesterEmail}）` : "";
    // batchCreateNotifications DTO 不支持 relatedType/relatedId，故把 feedbackId 放 metadata；
    // admin 端列表可优先读 metadata.feedbackId 跳详情
    await this.notificationService.batchCreateNotifications({
      userIds: adminUserIds,
      type: NotificationTypeDto.FEEDBACK_RECEIVED,
      title: "新的用户反馈",
      message: `${title}${fromSuffix}`,
      actionUrl: "/admin/feedback",
      actionLabel: "查看反馈",
      metadata: { feedbackId, feedbackType, requesterEmail },
    });
  }

  /**
   * 申请被批准，通知申请人。provider/model 来自 admin 实际授予的 assignment。
   */
  async notifyKeyRequestApproved(params: {
    userId: string;
    requestId: string;
    provider: string;
    modelId: string;
  }) {
    const { userId, requestId, provider, modelId } = params;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.KEY_REQUEST_APPROVED,
      title: "密钥申请已批准",
      message: `你的 API Key 申请已批准，可使用 ${provider} / ${modelId}`,
      actionUrl: "/me/ai?tab=keys",
      actionLabel: "查看密钥",
      relatedType: "key-request",
      relatedId: requestId,
      metadata: { requestId, provider, modelId },
    });
  }

  /**
   * 申请被拒绝，通知申请人。reject 流程无 assignment，无 provider 信息。
   */
  async notifyKeyRequestRejected(params: {
    userId: string;
    requestId: string;
    reason: string;
  }) {
    const { userId, requestId, reason } = params;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.KEY_REQUEST_REJECTED,
      title: "密钥申请未通过",
      message: `你的 API Key 申请未通过：${reason}`,
      actionUrl: "/me/ai?tab=keys",
      actionLabel: "查看详情",
      relatedType: "key-request",
      relatedId: requestId,
      metadata: { requestId, reason },
    });
  }

  /**
   * admin 在用户管理界面主动授权（无申请流程），通知被授权用户。
   * 多模型一次授权时合并成一条通知避免轰炸。
   */
  async notifyKeyGranted(params: {
    userId: string;
    assignmentIds: string[];
    modelLabels: string[];
  }) {
    const { userId, assignmentIds, modelLabels } = params;
    if (modelLabels.length === 0) return;

    const summary =
      modelLabels.length === 1
        ? modelLabels[0]
        : `${modelLabels[0]} 等 ${modelLabels.length} 个模型`;

    await this.notificationService.createNotification({
      userId,
      type: NotificationTypeDto.KEY_GRANTED,
      title: "授权已开通",
      message: `管理员已为你开通 ${summary}`,
      actionUrl: "/me/ai?tab=keys",
      actionLabel: "查看授权",
      relatedType: "key-assignment",
      relatedId: assignmentIds[0],
      metadata: { assignmentIds, modelLabels },
    });
  }

  /**
   * 版本更新通知（替代旧的 VersionUpdateBanner 横幅）。
   *
   * 调用方（CI / admin 脚本 / admin endpoint）负责按 audience 解析用户 ID 列表：
   *  - "all"     → 所有用户
   *  - "admins"  → role=ADMIN 的用户
   *  - "active"  → 近 N 天有登录的用户
   *
   * presets 层不感知用户表与 role 字段，只接 userIds。
   */
  async notifyVersionUpdate(params: {
    userIds: string[];
    version: string;
    changesCount: number;
    /** 默认 "/changelog"。可传入自定义页面（如带 anchor 的 changelog#vX.Y.Z） */
    changelogUrl?: string;
  }) {
    const { userIds, version, changesCount, changelogUrl } = params;
    if (userIds.length === 0) return;

    await this.notificationService.batchCreateNotifications({
      userIds,
      type: NotificationTypeDto.UPDATE,
      title: `v${version} 新版本上线`,
      message: `本次更新包含 ${changesCount} 项变更`,
      actionUrl: changelogUrl ?? "/changelog",
      actionLabel: "查看更新日志",
      metadata: { version, changesCount },
    });
  }
}
