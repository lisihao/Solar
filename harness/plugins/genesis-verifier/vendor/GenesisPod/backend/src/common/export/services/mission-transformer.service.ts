/**
 * Mission Transformer Service
 * 将 AI Teams 任务数据转换为统一导出格式
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  UnifiedContent,
  ContentSection,
  ContentMetadata,
  Appendix,
  TableRow,
  ListItem,
  Reference,
} from "../types/unified-content";
import { APP_CONFIG } from "../../config/app.config";
import { marked } from "marked";
import {
  TeamMission,
  AgentTask,
  TopicAIMember,
  MissionStatus,
  AgentTaskStatus,
  TaskPriority,
  TaskType,
  AgentPlaygroundMission,
} from "@prisma/client";

// 扩展类型，包含关联数据
interface TeamMissionWithRelations extends TeamMission {
  leader: TopicAIMember;
  tasks: AgentTaskWithRelations[];
}

interface AgentTaskWithRelations extends AgentTask {
  assignedTo: TopicAIMember;
}

// 统计数据接口
interface MissionStatistics {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  failedTasks: number;
  completionRate: number;
  totalRevisions: number;
  averageRevisions: number;
  durationMinutes: number;
  participantCount: number;
  participantContributions: ParticipantContribution[];
}

interface ParticipantContribution {
  name: string;
  displayName: string;
  aiModel: string;
  taskCount: number;
  completedCount: number;
  percentage: number;
}

@Injectable()
export class MissionTransformerService {
  private readonly logger = new Logger(MissionTransformerService.name);
  private sectionCounter = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将 mission 转换为 UnifiedContent 格式
   *
   * ★ 2026-05-02 (#7 报告下载公共能力): 同时支持 TeamMission 与 AgentPlaygroundMission
   * 两种模型 —— 先在 AgentPlaygroundMission 表查找，命中则走 playground 专用路径
   * （从 reportFull.content.fullMarkdown 提取 markdown 渲染），否则走原有 TeamMission
   * 路径（任务 + 子任务 + 统计 + 附录）。前端无需关心后端是哪种 mission，对齐 TI 同款体验。
   *
   * @param missionId 任务 ID（playground 与 teams 不重合，依次尝试即可）
   * @param simplifiedMode 简化模式，只导出核心结果（仅 TeamMission 路径）
   */
  async transform(
    missionId: string,
    simplifiedMode = false,
  ): Promise<UnifiedContent> {
    this.logger.debug(
      `Transforming mission: ${missionId}, simplified: ${simplifiedMode}`,
    );
    this.sectionCounter = 0;

    // ★ 优先尝试 playground mission（playground 路径），命中即返回
    const playgroundMission =
      await this.prisma.agentPlaygroundMission.findUnique({
        where: { id: missionId },
      });
    if (playgroundMission) {
      return this.transformPlaygroundMission(playgroundMission);
    }

    // 1. 获取任务及其关联数据
    const mission = await this.fetchMissionWithRelations(missionId);

    // 3. 构建元数据
    const metadata = this.buildMetadata(mission);

    // 简化模式：只包含核心结果
    if (simplifiedMode && mission.finalResult) {
      const sections: ContentSection[] = [
        {
          id: this.nextSectionId(),
          type: "heading",
          content: mission.title,
          level: 1,
        },
        {
          id: this.nextSectionId(),
          type: "paragraph",
          content: mission.description,
        },
        {
          id: this.nextSectionId(),
          type: "heading",
          content: "任务成果",
          level: 1,
        },
        ...this.parseMarkdown(mission.finalResult),
      ];

      return {
        metadata,
        cover: {
          showCover: true,
        },
        sections,
      };
    }

    // 2. 计算统计数据
    const stats = this.calculateStatistics(mission);

    // 4. 构建各部分内容
    const sections: ContentSection[] = [
      ...this.buildExecutiveSummary(mission, stats),
      ...this.buildObjectivesSection(mission),
      ...this.buildStatisticsSection(stats),
      ...this.buildFinalResultSection(mission),
      ...this.buildTeamExecutionSection(mission, stats),
      ...this.buildTaskDetailsSection(mission),
    ];

    // 5. 构建附录
    const appendices = this.buildAppendices(mission);

    return {
      metadata,
      cover: {
        showCover: true,
      },
      tableOfContents: {
        enabled: true,
        maxDepth: 2,
        title: "目录",
      },
      sections,
      appendices: appendices.length > 0 ? appendices : undefined,
    };
  }

  /**
   * ★ 2026-05-02 (#7): playground mission 专用转换路径
   *
   * playground mission 与 TeamMission 模型完全不同：
   *   - 没有 tasks[] / leader（playground 是 8-stage 单线程 pipeline）
   *   - 报告主体在 reportFull JSON 里（ReportArtifact v2: content.fullMarkdown + citations + figures）
   *   - dimensions 是 JSON 数组 [{id, name, rationale, ...}]
   *
   * 转换策略：
   *   - 元数据：title = reportTitle || topic, author = "AI Playground", date = completedAt
   *   - 主体：解析 fullMarkdown 为 sections（继承 marked lexer 已有能力）
   *   - 引用：从 reportFull.citations 抽出 references[]
   *   - 附录：从 reportFull.factTable 生成事实表附录（如有）
   */
  private transformPlaygroundMission(
    mission: AgentPlaygroundMission,
  ): UnifiedContent {
    const reportFull = (mission.reportFull as Record<string, unknown>) ?? {};
    const content = (reportFull.content ?? {}) as { fullMarkdown?: string };
    // ★ 2026-05-26 WYSIWYG 修复 (PDF / HTML 编辑模式回退路径)：
    //   旧 mission.reportFull 是 v1 shape（{title, summary, sections:[{heading,body}], conclusion}）
    //   时 content.fullMarkdown / reportFull.fullMarkdown 都缺，原回退到 reportSummary
    //   只拿到摘要，导致 PDF / HTML 编辑模式（WYSIWYG body 太大 fallback 或后端直接走编辑模式）
    //   导出主体严重缺失。这里直接 inline 同 backend/projectArtifact 的 v1→v2 markdown 拼接
    //   逻辑，保证编辑模式也能拿到完整 markdown（与 UI ContinuousReader 所见对齐）。
    const fullMarkdown =
      content.fullMarkdown ||
      (reportFull.fullMarkdown as string | undefined) ||
      this.buildMarkdownFromV1(reportFull) ||
      mission.reportSummary ||
      "";

    // 元数据
    const title =
      mission.reportTitle ||
      (typeof mission.topic === "string"
        ? mission.topic
        : "AI Playground 报告");
    const metadata: ContentMetadata = {
      title,
      subtitle: "AI Agent Playground 任务报告",
      author: "AI Playground",
      organization: APP_CONFIG.brand.fullName,
      date: mission.completedAt || mission.startedAt,
      tags: ["AI Playground", "Mission Report", mission.depth],
      language: mission.language || "zh-CN",
    };

    // 主体 sections —— 解析 markdown
    const sections: ContentSection[] = fullMarkdown.trim()
      ? this.parseMarkdown(fullMarkdown)
      : [
          {
            id: this.nextSectionId(),
            type: "callout",
            content:
              "报告内容为空。可能 mission 尚未生成 reportFull，或处于失败状态。",
            calloutType: "warning",
          },
        ];

    // 引用 —— 从 reportFull.citations 抽出
    const citationsRaw = (reportFull.citations as unknown[]) ?? [];
    const references: Reference[] = [];
    for (let i = 0; i < citationsRaw.length; i++) {
      const c = citationsRaw[i];
      if (!c || typeof c !== "object") continue;
      const cit = c as Record<string, unknown>;
      const ref: Reference = {
        id: typeof cit.index === "number" ? cit.index : i + 1,
        title:
          (cit.title as string) || (cit.url as string) || `Reference ${i + 1}`,
      };
      if (typeof cit.url === "string") ref.url = cit.url;
      if (typeof cit.author === "string") ref.author = cit.author;
      if (typeof cit.publishedDate === "string")
        ref.publishedDate = cit.publishedDate;
      if (typeof cit.snippet === "string") ref.snippet = cit.snippet;
      if (typeof cit.domain === "string") ref.domain = cit.domain;
      references.push(ref);
    }

    // 附录 —— factTable（事实表，对齐 TI 同款）
    const factTable = (reportFull.factTable as unknown[]) ?? [];
    const appendices: Appendix[] = [];
    if (Array.isArray(factTable) && factTable.length > 0) {
      const factRows = factTable
        .filter(
          (f): f is Record<string, unknown> => !!f && typeof f === "object",
        )
        .slice(0, 100); // 防止超大
      const headerLine = "| 主题 | 关键事实 | 引用 |";
      const sepLine = "| --- | --- | --- |";
      const bodyLines = factRows.map((f) => {
        const subject = (f.subject as string) || "-";
        const fact = (f.fact as string) || "-";
        const cites = Array.isArray(f.citations)
          ? (f.citations as unknown[]).join(", ")
          : "-";
        return `| ${subject} | ${fact} | ${cites} |`;
      });
      appendices.push({
        id: "playground-fact-table",
        title: "事实表（Reconciler 抽取）",
        content: [headerLine, sepLine, ...bodyLines].join("\n"),
        type: "text",
      });
    }

    return {
      metadata,
      cover: { showCover: true },
      tableOfContents: { enabled: true, maxDepth: 3, title: "目录" },
      sections,
      references: references.length > 0 ? references : undefined,
      appendices: appendices.length > 0 ? appendices : undefined,
    };
  }

  /**
   * v1 ResearchReport → markdown 拼接（mirror artifact.projector.normalizeV1ToV2 的
   * fullMarkdown 部分，但不构造 v2 全 schema —— 仅为 mission-transformer 编辑模式回退用）。
   * common/export 不能直接 import ai-app/playground/projectors 模块（反向依赖），
   * 故在此 duplicate 该简单逻辑（v1 shape 是稳定契约）。
   */
  private buildMarkdownFromV1(reportFull: Record<string, unknown>): string {
    const title = (reportFull.title as string | undefined) ?? "研究报告";
    const summary = (reportFull.summary as string | undefined) ?? "";
    const sectionsRaw = reportFull.sections;
    const sections = Array.isArray(sectionsRaw)
      ? (sectionsRaw as Array<{ heading?: string; body?: string }>)
      : [];
    const conclusion = (reportFull.conclusion as string | undefined) ?? "";
    if (!summary && sections.length === 0 && !conclusion) return "";

    const parts: string[] = [];
    if (summary) {
      parts.push(`# ${title}\n\n${summary}\n`);
    } else {
      parts.push(`# ${title}\n`);
    }
    sections.forEach((s, i) => {
      const heading = (s?.heading ?? `章节 ${i + 1}`).toString().trim();
      const body = (s?.body ?? "").toString().trim();
      parts.push(`\n## ${heading}\n\n${body}\n`);
    });
    if (conclusion) {
      parts.push(`\n## 结论\n\n${conclusion.trim()}\n`);
    }
    return parts.join("");
  }

  /**
   * 获取任务及其关联数据
   */
  private async fetchMissionWithRelations(
    missionId: string,
  ): Promise<TeamMissionWithRelations> {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: {
            assignedTo: true,
          },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!mission) {
      throw new NotFoundException(`Mission not found: ${missionId}`);
    }

    return mission as TeamMissionWithRelations;
  }

  /**
   * 计算任务统计数据
   */
  private calculateStatistics(
    mission: TeamMissionWithRelations,
  ): MissionStatistics {
    const tasks = mission.tasks || [];

    // 任务状态计数
    const statusCounts = {
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
    };

    tasks.forEach((task) => {
      switch (task.status) {
        case "COMPLETED":
          statusCounts.completed++;
          break;
        case "IN_PROGRESS":
          statusCounts.inProgress++;
          break;
        case "PENDING":
        case "BLOCKED":
        case "AWAITING_REVIEW":
        case "REVISION_NEEDED":
          statusCounts.pending++;
          break;
        case "CANCELLED":
          statusCounts.failed++;
          break;
      }
    });

    // 修订统计
    const totalRevisions = tasks.reduce(
      (sum, t) => sum + (t.revisionCount || 0),
      0,
    );
    const averageRevisions =
      tasks.length > 0 ? totalRevisions / tasks.length : 0;

    // 时长计算
    let durationMinutes = 0;
    if (mission.startedAt) {
      const endTime = mission.completedAt || new Date();
      durationMinutes = Math.round(
        (endTime.getTime() - mission.startedAt.getTime()) / 60000,
      );
    }

    // 参与者贡献统计
    const participantMap = new Map<
      string,
      {
        name: string;
        displayName: string;
        aiModel: string;
        taskCount: number;
        completedCount: number;
      }
    >();

    tasks.forEach((task) => {
      const participant = task.assignedTo;
      const key = participant.id;

      if (!participantMap.has(key)) {
        participantMap.set(key, {
          name: participant.agentName || participant.displayName,
          displayName: participant.displayName,
          aiModel: participant.aiModel,
          taskCount: 0,
          completedCount: 0,
        });
      }

      const entry = participantMap.get(key)!;
      entry.taskCount++;
      if (task.status === "COMPLETED") {
        entry.completedCount++;
      }
    });

    const participantContributions: ParticipantContribution[] = Array.from(
      participantMap.values(),
    )
      .map((p) => ({
        ...p,
        percentage:
          tasks.length > 0 ? Math.round((p.taskCount / tasks.length) * 100) : 0,
      }))
      .sort((a, b) => b.taskCount - a.taskCount);

    return {
      totalTasks: tasks.length,
      completedTasks: statusCounts.completed,
      inProgressTasks: statusCounts.inProgress,
      pendingTasks: statusCounts.pending,
      failedTasks: statusCounts.failed,
      completionRate:
        tasks.length > 0
          ? Math.round((statusCounts.completed / tasks.length) * 100)
          : 0,
      totalRevisions,
      averageRevisions: Math.round(averageRevisions * 10) / 10,
      durationMinutes,
      participantCount: participantMap.size,
      participantContributions,
    };
  }

  /**
   * 构建元数据
   */
  private buildMetadata(mission: TeamMissionWithRelations): ContentMetadata {
    return {
      title: mission.title,
      subtitle: "AI Teams 任务执行报告",
      author: mission.leader.agentName || mission.leader.displayName,
      organization: APP_CONFIG.brand.fullName,
      date: mission.completedAt || mission.createdAt,
      tags: [
        "AI Teams",
        "Mission Report",
        this.getMissionStatusLabel(mission.status),
      ],
      language: "zh-CN",
    };
  }

  /**
   * 构建执行摘要部分
   */
  private buildExecutiveSummary(
    mission: TeamMissionWithRelations,
    stats: MissionStatistics,
  ): ContentSection[] {
    const sections: ContentSection[] = [];

    // 标题
    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "执行摘要",
      level: 1,
    });

    // 状态提示
    sections.push({
      id: this.nextSectionId(),
      type: "callout",
      content: `任务状态: ${this.getMissionStatusLabel(mission.status)}`,
      calloutType: this.getStatusCalloutType(mission.status),
    });

    // 关键指标
    const keyPoints: ListItem[] = [
      {
        content: `共执行 **${stats.totalTasks}** 项子任务，完成率 **${stats.completionRate}%**`,
      },
      {
        content: `AI团队 **${stats.participantCount}** 名成员协作，总耗时 **${this.formatDuration(stats.durationMinutes)}**`,
      },
      {
        content: `任务修订 **${stats.totalRevisions}** 次，平均每任务 **${stats.averageRevisions}** 次`,
      },
    ];

    if (stats.failedTasks > 0) {
      keyPoints.push({
        content: `有 **${stats.failedTasks}** 项任务执行失败，需关注`,
      });
    }

    sections.push({
      id: this.nextSectionId(),
      type: "list",
      items: keyPoints,
      ordered: false,
    });

    // 任务描述
    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "任务描述",
      level: 2,
    });

    sections.push({
      id: this.nextSectionId(),
      type: "paragraph",
      content: mission.description,
    });

    return sections;
  }

  /**
   * 构建目标部分
   */
  private buildObjectivesSection(
    mission: TeamMissionWithRelations,
  ): ContentSection[] {
    const sections: ContentSection[] = [];

    if (mission.objectives && mission.objectives.length > 0) {
      sections.push({
        id: this.nextSectionId(),
        type: "heading",
        content: "任务目标",
        level: 2,
      });

      sections.push({
        id: this.nextSectionId(),
        type: "list",
        items: mission.objectives.map((obj) => ({ content: obj })),
        ordered: true,
      });
    }

    if (mission.constraints && mission.constraints.length > 0) {
      sections.push({
        id: this.nextSectionId(),
        type: "heading",
        content: "约束条件",
        level: 2,
      });

      sections.push({
        id: this.nextSectionId(),
        type: "list",
        items: mission.constraints.map((c) => ({ content: c })),
        ordered: false,
      });
    }

    if (mission.deliverables && mission.deliverables.length > 0) {
      sections.push({
        id: this.nextSectionId(),
        type: "heading",
        content: "期望交付物",
        level: 2,
      });

      sections.push({
        id: this.nextSectionId(),
        type: "list",
        items: mission.deliverables.map((d) => ({ content: d })),
        ordered: false,
      });
    }

    return sections;
  }

  /**
   * 构建统计部分
   */
  private buildStatisticsSection(stats: MissionStatistics): ContentSection[] {
    const sections: ContentSection[] = [];

    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "执行统计",
      level: 1,
    });

    // 总体统计表格
    const statsRows: TableRow[] = [
      { cells: ["总任务数", String(stats.totalTasks), "分解后的子任务总数"] },
      {
        cells: [
          "已完成",
          String(stats.completedTasks),
          `完成率 ${stats.completionRate}%`,
        ],
      },
      {
        cells: ["进行中", String(stats.inProgressTasks), "当前执行中的任务"],
      },
      { cells: ["待处理", String(stats.pendingTasks), "等待执行的任务"] },
      {
        cells: ["失败/取消", String(stats.failedTasks), "执行失败或被取消"],
      },
      {
        cells: [
          "总修订次数",
          String(stats.totalRevisions),
          `平均 ${stats.averageRevisions} 次/任务`,
        ],
      },
      {
        cells: [
          "执行时长",
          this.formatDuration(stats.durationMinutes),
          `共 ${stats.durationMinutes} 分钟`,
        ],
      },
      {
        cells: ["参与成员", String(stats.participantCount), "AI团队成员数"],
      },
    ];

    sections.push({
      id: this.nextSectionId(),
      type: "table",
      headers: ["指标", "数值", "说明"],
      rows: statsRows,
    });

    // 成员贡献表格
    if (stats.participantContributions.length > 0) {
      sections.push({
        id: this.nextSectionId(),
        type: "heading",
        content: "成员贡献",
        level: 2,
      });

      sections.push({
        id: this.nextSectionId(),
        type: "table",
        headers: ["成员", "AI模型", "任务数", "完成数", "贡献占比"],
        rows: stats.participantContributions.map((p) => ({
          cells: [
            p.name,
            p.aiModel,
            String(p.taskCount),
            String(p.completedCount),
            `${p.percentage}%`,
          ],
        })),
      });
    }

    return sections;
  }

  /**
   * 构建最终结果部分（解析 finalResult markdown）
   */
  private buildFinalResultSection(
    mission: TeamMissionWithRelations,
  ): ContentSection[] {
    const sections: ContentSection[] = [];

    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "核心发现与结论",
      level: 1,
    });

    if (!mission.finalResult) {
      sections.push({
        id: this.nextSectionId(),
        type: "callout",
        content: this.getNoResultMessage(mission.status),
        calloutType: "info",
      });
      return sections;
    }

    // 解析 markdown 并转换为 sections
    const parsedSections = this.parseMarkdown(mission.finalResult);
    sections.push(...parsedSections);

    return sections;
  }

  /**
   * 构建团队执行报告部分
   */
  private buildTeamExecutionSection(
    mission: TeamMissionWithRelations,
    stats: MissionStatistics,
  ): ContentSection[] {
    const sections: ContentSection[] = [];

    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "团队执行报告",
      level: 1,
    });

    // 任务状态分布
    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "任务状态分布",
      level: 2,
    });

    sections.push({
      id: this.nextSectionId(),
      type: "table",
      headers: ["状态", "数量", "占比"],
      rows: [
        {
          cells: [
            "已完成",
            String(stats.completedTasks),
            `${this.calcPercentage(stats.completedTasks, stats.totalTasks)}%`,
          ],
        },
        {
          cells: [
            "进行中",
            String(stats.inProgressTasks),
            `${this.calcPercentage(stats.inProgressTasks, stats.totalTasks)}%`,
          ],
        },
        {
          cells: [
            "待处理",
            String(stats.pendingTasks),
            `${this.calcPercentage(stats.pendingTasks, stats.totalTasks)}%`,
          ],
        },
        {
          cells: [
            "失败",
            String(stats.failedTasks),
            `${this.calcPercentage(stats.failedTasks, stats.totalTasks)}%`,
          ],
        },
      ],
    });

    // 执行总结
    if (mission.summary) {
      sections.push({
        id: this.nextSectionId(),
        type: "heading",
        content: "执行总结",
        level: 2,
      });

      const summaryParsed = this.parseMarkdown(mission.summary);
      sections.push(...summaryParsed);
    }

    return sections;
  }

  /**
   * 构建任务明细部分
   */
  private buildTaskDetailsSection(
    mission: TeamMissionWithRelations,
  ): ContentSection[] {
    const sections: ContentSection[] = [];

    sections.push({
      id: this.nextSectionId(),
      type: "heading",
      content: "任务执行明细",
      level: 1,
    });

    if (mission.tasks.length === 0) {
      sections.push({
        id: this.nextSectionId(),
        type: "callout",
        content: "暂无子任务",
        calloutType: "info",
      });
      return sections;
    }

    sections.push({
      id: this.nextSectionId(),
      type: "paragraph",
      content: "以下为各子任务的执行概要，详细结果请参见附录。",
    });

    // 任务概要表格
    const taskRows: TableRow[] = mission.tasks.map((task, index) => ({
      cells: [
        String(index + 1),
        task.title,
        task.assignedTo.agentName || task.assignedTo.displayName,
        this.getTaskStatusLabel(task.status),
        String(task.revisionCount),
        task.completedAt ? this.formatDateTime(task.completedAt) : "-",
      ],
    }));

    sections.push({
      id: this.nextSectionId(),
      type: "table",
      headers: ["#", "任务标题", "执行者", "状态", "修订次数", "完成时间"],
      rows: taskRows,
    });

    return sections;
  }

  /**
   * 构建附录（详细任务结果）
   */
  private buildAppendices(mission: TeamMissionWithRelations): Appendix[] {
    const appendices: Appendix[] = [];

    mission.tasks.forEach((task, index) => {
      if (task.result || task.leaderFeedback) {
        const content = this.formatTaskAppendixContent(task);

        appendices.push({
          id: `task-${task.id}`,
          title: `任务 ${index + 1}: ${task.title}`,
          content,
          type: "text",
        });
      }
    });

    return appendices;
  }

  /**
   * 格式化任务附录内容
   */
  private formatTaskAppendixContent(task: AgentTaskWithRelations): string {
    const parts: string[] = [];

    // 任务元数据
    parts.push(
      `**执行者**: ${task.assignedTo.agentName || task.assignedTo.displayName}`,
    );
    parts.push(`**状态**: ${this.getTaskStatusLabel(task.status)}`);
    parts.push(`**优先级**: ${this.getTaskPriorityLabel(task.priority)}`);
    parts.push(`**类型**: ${this.getTaskTypeLabel(task.taskType)}`);
    parts.push(`**修订次数**: ${task.revisionCount}`);
    parts.push("");

    // 任务描述
    parts.push("**任务描述**:");
    parts.push(task.description);
    parts.push("");

    // 执行结果
    if (task.result) {
      parts.push("**执行结果**:");
      parts.push(task.result);
      parts.push("");
    }

    // 负责人反馈
    if (task.leaderFeedback) {
      parts.push("**负责人反馈**:");
      parts.push(task.leaderFeedback);
      parts.push("");
    }

    // 时间信息
    if (task.startedAt) {
      parts.push(`**开始时间**: ${this.formatDateTime(task.startedAt)}`);
    }
    if (task.completedAt) {
      parts.push(`**完成时间**: ${this.formatDateTime(task.completedAt)}`);
    }

    return parts.join("\n");
  }

  // ==================== Markdown 解析 ====================

  /**
   * 解析 Markdown 为 ContentSection 数组
   */
  private parseMarkdown(markdown: string): ContentSection[] {
    const sections: ContentSection[] = [];
    const tokens = marked.lexer(markdown);

    for (const token of tokens) {
      const section = this.tokenToSection(token);
      if (section) {
        sections.push(section);
      }
    }

    return sections;
  }

  /**
   * 将 marked token 转换为 ContentSection
   */
  private tokenToSection(token: {
    type: string;
    text?: string;
    depth?: number;
    ordered?: boolean;
    items?: unknown[];
    header?: Array<{ text: string }>;
    rows?: Array<Array<{ text: string }>>;
    lang?: string;
  }): ContentSection | null {
    switch (token.type) {
      case "heading":
        return {
          id: this.nextSectionId(),
          type: "heading",
          content: token.text,
          level: Math.min((token.depth || 1) + 1, 6), // 偏移 1 级，保持在父标题下
        };

      case "paragraph":
        return {
          id: this.nextSectionId(),
          type: "paragraph",
          content: token.text,
        };

      case "list":
        return {
          id: this.nextSectionId(),
          type: "list",
          ordered: token.ordered,
          items: token.items
            ? this.parseListItems(
                token.items as Array<{ text: string; items?: unknown[] }>,
              )
            : undefined,
        };

      case "table":
        return {
          id: this.nextSectionId(),
          type: "table",
          headers: token.header?.map((h) => h.text),
          rows: token.rows?.map((row) => ({
            cells: row.map((cell) => cell.text),
          })),
        };

      case "code":
        return {
          id: this.nextSectionId(),
          type: "code",
          content: token.text,
          codeLanguage: token.lang || undefined,
        };

      case "blockquote":
        return {
          id: this.nextSectionId(),
          type: "quote",
          content: token.text,
        };

      case "hr":
        return {
          id: this.nextSectionId(),
          type: "divider",
        };

      default:
        return null;
    }
  }

  /**
   * 解析列表项（递归）
   */
  private parseListItems(
    items: Array<{ text: string; items?: unknown[] }>,
  ): ListItem[] {
    return items.map((item) => ({
      content: item.text,
      children: item.items
        ? this.parseListItems(
            item.items as Array<{ text: string; items?: unknown[] }>,
          )
        : undefined,
    }));
  }

  // ==================== 工具方法 ====================

  /**
   * 生成下一个 section ID
   */
  private nextSectionId(): string {
    this.sectionCounter++;
    return `section-${this.sectionCounter}`;
  }

  /**
   * 格式化日期时间
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * 格式化时长
   */
  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  }

  /**
   * 计算百分比
   */
  private calcPercentage(value: number, total: number): number {
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }

  /**
   * 获取任务状态标签
   */
  private getMissionStatusLabel(status: MissionStatus): string {
    const labels: Record<MissionStatus, string> = {
      PENDING: "待开始",
      PLANNING: "规划中",
      IN_PROGRESS: "执行中",
      PAUSED: "已暂停",
      REVIEW: "审核中",
      COMPLETED: "已完成",
      FAILED: "执行失败",
      CANCELLED: "已取消",
    };
    return labels[status] || status;
  }

  /**
   * 获取子任务状态标签
   */
  private getTaskStatusLabel(status: AgentTaskStatus): string {
    const labels: Record<AgentTaskStatus, string> = {
      PENDING: "待开始",
      IN_PROGRESS: "进行中",
      BLOCKED: "被阻塞",
      AWAITING_REVIEW: "等待审核",
      REVISION_NEEDED: "需修改",
      COMPLETED: "已完成",
      CANCELLED: "已取消",
    };
    return labels[status] || status;
  }

  /**
   * 获取任务优先级标签
   */
  private getTaskPriorityLabel(priority: TaskPriority): string {
    const labels: Record<TaskPriority, string> = {
      CRITICAL: "紧急",
      HIGH: "高优先级",
      MEDIUM: "中优先级",
      LOW: "低优先级",
    };
    return labels[priority] || priority;
  }

  /**
   * 获取任务类型标签
   */
  private getTaskTypeLabel(taskType: TaskType): string {
    const labels: Record<TaskType, string> = {
      RESEARCH: "调研分析",
      DESIGN: "设计规划",
      IMPLEMENTATION: "执行实现",
      REVIEW: "审查检验",
      DOCUMENTATION: "文档编写",
      COORDINATION: "协调沟通",
      CREATIVE: "创意发想",
      SYNTHESIS: "综合整理",
    };
    return labels[taskType] || taskType;
  }

  /**
   * 获取状态对应的 callout 类型
   */
  private getStatusCalloutType(
    status: MissionStatus,
  ): "info" | "warning" | "success" | "error" {
    switch (status) {
      case "COMPLETED":
        return "success";
      case "FAILED":
      case "CANCELLED":
        return "error";
      case "PAUSED":
        return "warning";
      default:
        return "info";
    }
  }

  /**
   * 获取无结果时的提示消息
   */
  private getNoResultMessage(status: MissionStatus): string {
    switch (status) {
      case "COMPLETED":
        return "任务已完成，但未生成最终结论。请查看各子任务的执行结果。";
      case "PENDING":
      case "PLANNING":
        return "任务尚未开始执行，暂无结论可展示。";
      case "IN_PROGRESS":
        return "任务正在执行中，最终结论将在完成后生成。";
      case "PAUSED":
        return "任务已暂停，请恢复执行后查看结论。";
      case "FAILED":
        return "任务执行失败，未能生成最终结论。";
      case "CANCELLED":
        return "任务已取消。";
      default:
        return "暂无结论内容。";
    }
  }
}
