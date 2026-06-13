import { Injectable, Logger } from "@nestjs/common";
import { AgentTaskStatus } from "@prisma/client";
import { MissionContextService } from "@/modules/ai-harness/facade";
import { findMemberByName } from "../utils";

/**
 * 任务分解结果项
 */
export interface TaskBreakdownItem {
  title: string;
  description: string;
  assigneeId: string;
  assigneeName?: string;
  reason?: string;
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  taskType?: string;
  dependsOn?: number[];
}

/**
 * 任务分解结果
 */
export interface TaskBreakdown {
  understanding: string;
  tasks: TaskBreakdownItem[];
  executionPlan: string;
  risks: string;
}

/**
 * 团队成员信息
 */
export interface TeamMemberInfo {
  id: string;
  agentName?: string | null;
  displayName: string;
  agentIdentity?: string | null;
  roleDescription?: string | null;
  expertiseAreas?: string[];
  workStyle?: string | null;
  aiModel: string;
}

/**
 * Mission Prompt Service
 * 负责构建各种提示词和解析 AI 响应
 */
@Injectable()
export class MissionPromptService {
  private readonly logger = new Logger(MissionPromptService.name);

  constructor(private readonly missionContextService: MissionContextService) {}

  // ==================== Leader 规划提示词 ====================

  /**
   * 构建 Leader 规划提示词
   */
  buildLeaderPlanningPrompt(
    mission: {
      title: string;
      description?: string;
      objectives?: string[];
      constraints?: string[];
      deliverables?: string[];
    },
    leader: { agentName?: string | null; displayName: string },
    teamMembers: TeamMemberInfo[],
  ): string {
    const membersInfo = teamMembers
      .map(
        (m) =>
          `- ${m.agentName || m.displayName}（${m.agentIdentity || m.roleDescription || "团队成员"}）
  擅长领域：${(m.expertiseAreas || []).join("、") || "通用"}
  工作风格：${m.workStyle || "自主型"}
  AI模型：${m.aiModel}`,
      )
      .join("\n");

    const scopeGuidance = this.buildScopeGuidance(mission);

    // 获取精确的成员名称列表，用于 Context Package 提示
    const memberNames = teamMembers.map((m) => m.agentName || m.displayName);
    const contextPackageSection =
      this.missionContextService.buildContextPackagePromptSection(memberNames);

    return `你是团队的 Leader「${leader.agentName || leader.displayName}」。

【你的团队成员】
${membersInfo}

【用户任务】
标题：${mission.title}
描述：${mission.description || ""}
${mission.objectives?.length ? `目标：${mission.objectives.join("、")}` : ""}
${mission.constraints?.length ? `约束：${mission.constraints.join("、")}` : ""}
${mission.deliverables?.length ? `期望交付物：${mission.deliverables.join("、")}` : ""}
${scopeGuidance}
${contextPackageSection}
【你的职责】
请分析任务并进行分解，输出格式如下：

## 任务理解
[2-3句话描述你对任务的理解]

## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | ... | @成员名 | ... | 高/中/低 | 无 |
| 2 | ... | @成员名 | ... | 高/中/低 | 任务1 |
（继续添加更多任务...）

## 执行计划
- 第一阶段：[并行执行的任务]
- 第二阶段：[依赖完成后执行的任务]
（根据实际情况添加更多阶段）

## 风险提示
[可能的风险和应对方案]

【注意事项】
- 根据每个成员的擅长领域进行最优分配
- **⚠️ 任务必须均匀分配给所有成员**，不要让某个成员承担过多任务
- 每个成员至少要分配到一些任务，不要闲置任何成员
- 你自己（Leader）只承担协调和审核任务，具体执行任务尽量分配给其他成员
- 确保任务依赖关系合理
- 优先利用并行执行提高效率
- 如果某个成员能力较强，可以分配稍多一点，但差距不要太大（最多 1.5 倍）`;
  }

  /**
   * 构建任务范围指导
   * 针对大型内容创作任务，明确要求一次性分解全部任务
   */
  buildScopeGuidance(mission: {
    title?: string;
    description?: string;
  }): string {
    const text = `${mission.title || ""} ${mission.description || ""}`;

    const isLargeContentTask = this.detectLargeContentTask(text);

    if (!isLargeContentTask) {
      return "";
    }

    const structureHint = this.extractStructureHint(text);

    return `
【⚠️ 极其重要：任务范围约束 - 必读】
这是一个大型内容创作任务。**你必须严格遵守以下规则，违反将导致任务失败：**

🚫 **绝对禁止的行为：**
- 禁止说"本轮只分解 X 个任务"
- 禁止说"作为起始批次"、"后续再补充"
- 禁止说"先写前几章看看效果"
- 禁止自行决定只执行部分任务

✅ **必须执行的行为：**
1. **一次性列出用户要求的所有任务** - 用户要 8 卷就分解 8 卷的全部章节
2. **完整覆盖用户需求** - 不得遗漏任何卷、章、节
3. **每个章节单独一个任务** - 不得合并多个章节为一个任务
${structureHint}
❌ 错误示例：
- "本轮预期拆出约 3-4 个章节级任务，作为后续全书连载的起始批次"
- "先完成卷一的前几章，后续再继续"

✅ 正确做法：
- 直接列出所有章节任务（如 8 卷 × 12 章 = 96 个任务）
- 任务表格必须包含用户要求的完整内容

`;
  }

  /**
   * 从描述中提取结构提示
   */
  extractStructureHint(text: string): string {
    const volumeMatch = text.match(/(\d+)\s*卷/);
    const volumeMatch2 = text.match(/([一二三四五六七八九十]+)\s*卷/);

    if (volumeMatch) {
      const volumes = parseInt(volumeMatch[1], 10);
      return `4. **用户明确要求 ${volumes} 卷** - 你必须分解全部 ${volumes} 卷的所有章节\n`;
    }

    if (volumeMatch2) {
      const chineseNum = volumeMatch2[1];
      return `4. **用户明确要求 ${chineseNum} 卷** - 你必须分解全部卷的所有章节\n`;
    }

    return "";
  }

  /**
   * 检测是否为大型内容创作任务
   */
  detectLargeContentTask(text: string): boolean {
    const contentKeywords = [
      "小说",
      "武侠",
      "奇幻",
      "玄幻",
      "科幻",
      "言情",
      "悬疑",
      "推理",
      "历史",
      "传记",
      "剧本",
      "故事",
      "连载",
      "长篇",
      "系列",
      "动漫",
      "漫画",
      "剧集",
      "课程",
      "教程",
      "专栏",
      "文章",
    ];

    const structureKeywords = [
      "卷",
      "部",
      "篇",
      "季",
      "册",
      "辑",
      "编",
      "章",
      "回",
      "集",
      "话",
      "期",
      "幕",
      "讲",
      "课",
    ];

    const quantityPattern = /(\d+)\s*(卷|部|篇|季|册|章|回|集|话|期|幕|讲|课)/;

    const hasContentKeyword = contentKeywords.some((kw) => text.includes(kw));
    const hasStructureKeyword = structureKeywords.some((kw) =>
      text.includes(kw),
    );
    const hasQuantity = quantityPattern.test(text);

    return (hasContentKeyword && hasStructureKeyword) || hasQuantity;
  }

  // ==================== 任务执行提示词 ====================

  /**
   * 构建任务执行提示词
   */
  buildTaskExecutionPrompt(
    mission: { title: string; description?: string },
    task: { title: string; description?: string; taskType?: string },
    searchContext: string = "",
  ): string {
    const MAX_SEARCH_CONTEXT_LENGTH = 4000;
    const truncatedSearchContext =
      searchContext.length > MAX_SEARCH_CONTEXT_LENGTH
        ? searchContext.substring(0, MAX_SEARCH_CONTEXT_LENGTH) +
          "\n\n...[搜索结果已截断，仅显示部分内容]"
        : searchContext;

    const searchSection = truncatedSearchContext
      ? `

【参考资料 - 联网搜索结果】
以下是通过网络搜索获取的最新相关信息，请参考这些资料完成任务：

${truncatedSearchContext}

---

`
      : "";

    return `你正在执行团队任务中的一个子任务。

【总任务背景】
标题：${mission.title}
描述：${mission.description || ""}
${searchSection}
【你的子任务】
任务名称：${task.title}
任务描述：${task.description || task.title}
任务类型：${task.taskType || "implementation"}

【要求】
请认真完成这个任务，输出完整的工作成果。
- 确保输出内容完整、专业
- 如果有参考资料，请充分利用并注明来源
- 如果需要其他成员协助，可以 @他们的名字
- 完成后会由 Leader 审核`;
  }

  /**
   * 检测任务是否需要联网搜索
   */
  needsWebSearch(
    missionTitle: string,
    missionDescription: string,
    taskTitle: string,
    taskDescription: string,
  ): boolean {
    const combinedText =
      `${missionTitle} ${missionDescription} ${taskTitle} ${taskDescription}`.toLowerCase();

    const realtimeKeywords = [
      "最新",
      "2025年",
      "2024年",
      "今年",
      "近期",
      "当前",
      "目前",
      "现在",
      "实时",
      "最近",
      "新闻",
      "动态",
      "趋势",
      "市场",
      "调研",
      "研究",
      "分析",
      "报告",
      "数据",
      "统计",
      "行业",
      "企业",
      "公司",
      "进展",
      "案例",
      "latest",
      "recent",
      "current",
      "2025",
      "2024",
      "this year",
      "market",
      "research",
      "analysis",
      "report",
      "trend",
      "news",
      "industry",
      "company",
      "enterprise",
      "case study",
    ];

    return realtimeKeywords.some((keyword) => combinedText.includes(keyword));
  }

  /**
   * 构建搜索查询词
   */
  buildSearchQuery(
    missionTitle: string,
    taskTitle: string,
    taskDescription: string,
  ): string {
    let query = taskTitle;

    if (taskDescription && taskDescription.length < 100) {
      query += " " + taskDescription;
    }

    if (!query.includes(missionTitle.substring(0, 20))) {
      const missionKeywords = missionTitle
        .replace(/[，。、！？\s]+/g, " ")
        .trim();
      if (missionKeywords.length < 50) {
        query = missionKeywords + " " + query;
      }
    }

    query = query
      .replace(/[，。、！？【】「」\[\]()（）]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (query.length > 100) {
      query = query.substring(0, 100);
    }

    return query;
  }

  // ==================== Leader 审核提示词 ====================

  /**
   * 构建 Leader 审核摘要提示词
   */
  buildSummarizeForReviewPrompt(content: string, taskTitle: string): string {
    return `请为以下创作内容生成审核摘要，帮助 Leader 评估内容质量：

【任务】${taskTitle}

【原文内容】（共${content.length}字符）
${content.substring(0, 8000)}${content.length > 8000 ? "\n...[后续内容省略]" : ""}

请输出以下结构化摘要：

## 内容概要
[用200-300字概括主要内容、情节发展、核心观点]

## 关键要素
- 主题/立意：[简述]
- 结构/逻辑：[简述是否清晰完整]
- 风格/语言：[简述文风特点]

## 亮点摘录
[摘录2-3段精彩片段，每段不超过100字]

## 潜在问题
[如有发现，列出可能需要改进的地方]`;
  }

  /**
   * 提取关键片段（用于审核）
   */
  extractKeyExcerpts(content: string): string {
    const headExcerpt = content.substring(0, 500);
    const tailExcerpt = content.substring(content.length - 500);
    return `【开篇】\n${headExcerpt}\n\n【结尾】\n${tailExcerpt}`;
  }

  /**
   * 构建 Leader 审核提示词
   */
  buildLeaderReviewPrompt(
    mission: {
      title?: string;
      description?: string;
      goals?: string;
      tasks?: Array<{
        id: string;
        status: string;
        title: string;
        result?: string | null;
        assignedTo?: { agentName?: string | null; displayName: string } | null;
      }>;
    },
    task: {
      id: string;
      title: string;
      description?: string;
      assignedTo: { agentName?: string | null; displayName: string };
    },
    taskResult: string,
  ): string {
    const MAX_RESULT_LENGTH = 2500;
    let truncatedResult: string;

    if (taskResult.length > MAX_RESULT_LENGTH) {
      const headLength = 1500;
      const tailLength = 800;
      const head = taskResult.substring(0, headLength);
      const tail = taskResult.substring(taskResult.length - tailLength);
      truncatedResult = `${head}\n\n...[中间内容已省略，原文共${taskResult.length}字符]...\n\n${tail}`;
    } else {
      truncatedResult = taskResult;
    }

    const completedTasks = (mission.tasks || [])
      .filter((t) => t.status === "COMPLETED" && t.id !== task.id && t.result)
      .slice(-2);

    const completedSummary =
      completedTasks.length > 0
        ? completedTasks
            .map((t) => {
              const resultPreview = (t.result || "").substring(0, 200);
              return `- ${t.title}（${t.assignedTo?.agentName || t.assignedTo?.displayName || "未知"}）: ${resultPreview}${(t.result?.length || 0) > 200 ? "..." : ""}`;
            })
            .join("\n")
        : "（暂无已完成任务）";

    return `你是团队 Leader，请审核以下任务产出，确保其质量和与整体任务的一致性。

【整体任务背景】
任务主题：${mission.title || "未知"}
任务描述：${mission.description || "无描述"}
${mission.goals ? `任务目标：${mission.goals}` : ""}

【本次审核任务】
任务名称：${task.title}
任务描述：${task.description || task.title}
负责人：${task.assignedTo.agentName || task.assignedTo.displayName}

【任务产出】
${truncatedResult}

【已完成的其他任务摘要】
${completedSummary}

【审核要求】
1. 评估产出是否满足任务要求，内容是否完整准确
2. 检查产出是否与整体任务主题和目标保持一致
3. 检查与其他已完成任务的风格、术语、论述角度是否协调统一
4. 如果合格，明确表示"审核通过"，并给出简短肯定
5. 如果需要修改，指出具体需要改进的内容，特别是一致性问题

请直接给出审核意见：`;
  }

  /**
   * 构建任务修订提示词
   */
  buildTaskRevisionPrompt(
    task: { title: string; description?: string; result?: string | null },
    feedback: string,
  ): string {
    const MAX_RESULT_LENGTH = 2500;
    const previousResult = task.result || "（无记录）";
    let truncatedPreviousResult: string;

    if (previousResult.length > MAX_RESULT_LENGTH) {
      const headLength = 1500;
      const tailLength = 800;
      const head = previousResult.substring(0, headLength);
      const tail = previousResult.substring(previousResult.length - tailLength);
      truncatedPreviousResult = `${head}\n\n...[中间内容已省略，原文共${previousResult.length}字符]...\n\n${tail}`;
    } else {
      truncatedPreviousResult = previousResult;
    }

    return `你之前提交的任务需要修改。

【任务信息】
任务名称：${task.title}
任务描述：${task.description || task.title}

【你之前的产出】
${truncatedPreviousResult}

【Leader 反馈】
${feedback}

【要求】
请根据 Leader 的反馈修改你的产出，输出修改后的完整内容。`;
  }

  // ==================== 最终报告构建 ====================

  /**
   * 构建完整的最终报告（不截断任何内容）
   */
  buildFinalReportWithFullContent(mission: {
    title: string;
    description?: string;
    deliverables?: string[];
    tasks?: Array<{
      status: string;
      title: string;
      result?: string | null;
      assignedTo?: { agentName?: string | null; displayName: string } | null;
    }>;
  }): {
    fullContent: string;
    summaryPrompt: string;
  } {
    const completedTasks = (mission.tasks || []).filter(
      (t) => t.status === AgentTaskStatus.COMPLETED && t.result,
    );

    const chapters = completedTasks.map((t, index) => {
      const agentName =
        t.assignedTo?.agentName || t.assignedTo?.displayName || "未知";
      return `## 第${index + 1}章：${t.title}
> 作者/负责人：${agentName}
> 字数：${(t.result || "").length} 字

${t.result || "（无内容）"}`;
    });

    const fullContent = `# ${mission.title}

${mission.description || ""}

---

${chapters.join("\n\n---\n\n")}`;

    interface TaskMeta {
      title: string;
      agent: string;
      wordCount: number;
      preview: string;
    }
    const taskMeta: TaskMeta[] = completedTasks.map((t) => ({
      title: t.title,
      agent: t.assignedTo?.agentName || t.assignedTo?.displayName || "未知",
      wordCount: (t.result || "").length,
      preview: (t.result || "").substring(0, 200) + "...",
    }));

    const taskList = taskMeta
      .map(
        (t, i) =>
          `${i + 1}. ${t.title}（${t.agent}）- ${t.wordCount}字\n   预览：${t.preview}`,
      )
      .join("\n");
    const totalWords = taskMeta.reduce((sum, t) => sum + t.wordCount, 0);
    const participants = [...new Set(taskMeta.map((t) => t.agent))].join("、");

    const summaryPrompt = `你是团队 Leader，所有子任务已完成。请根据以下信息生成执行总结（注意：完整内容已单独保存，你只需生成总结）。

【任务信息】
标题：${mission.title}
描述：${mission.description || ""}
${mission.deliverables?.length ? `期望交付物：${mission.deliverables.join("、")}` : ""}

【任务完成情况】
共完成 ${completedTasks.length} 个子任务：
${taskList}

【总字数】${totalWords} 字

请生成执行总结，包括：
1. 任务完成概述
2. 各成员贡献
3. 总体评价

格式：
## 执行总结

| 指标 | 数据 |
|------|------|
| 总任务数 | ${completedTasks.length} |
| 参与成员 | ${participants} |
| 总字数 | ${totalWords} |

[总结性评价]`;

    return { fullContent, summaryPrompt };
  }

  // ==================== 系统提示词 ====================

  /**
   * 获取 Leader 系统提示词
   */
  getLeaderSystemPrompt(leader: {
    agentName?: string | null;
    displayName: string;
    agentIdentity?: string | null;
    roleDescription?: string | null;
  }): string {
    return `你是「${leader.agentName || leader.displayName}」，团队的 Leader。
身份：${leader.agentIdentity || leader.roleDescription || "团队领导"}
职责：负责任务分解、分配、协调和整合结果。
风格：专业、清晰、有建设性。`;
  }

  /**
   * 获取 Agent 系统提示词
   */
  getAgentSystemPrompt(
    agent: {
      agentName?: string | null;
      displayName: string;
      agentIdentity?: string | null;
      roleDescription?: string | null;
      expertiseAreas?: string[];
    },
    task: { title: string },
  ): string {
    return `你是「${agent.agentName || agent.displayName}」，团队成员。
身份：${agent.agentIdentity || agent.roleDescription || "专业人员"}
擅长：${(agent.expertiseAreas || []).join("、") || "多个领域"}
当前任务：${task.title}`;
  }

  // ==================== 解析方法 ====================

  /**
   * 解析任务分解结果
   */
  parseTaskBreakdown(
    content: string,
    teamMembers: TeamMemberInfo[],
  ): TaskBreakdown {
    const tasks: TaskBreakdownItem[] = [];

    // ★ 诊断日志：记录可用的成员名称列表
    const availableMemberNames = teamMembers.map((m) => ({
      id: m.id,
      agentName: m.agentName,
      displayName: m.displayName,
      matchKey: (m.agentName || m.displayName)?.toLowerCase(),
    }));
    this.logger.debug(
      `[parseTaskBreakdown] Available members (${teamMembers.length}): ${JSON.stringify(availableMemberNames.map((m) => m.agentName || m.displayName))}`,
    );

    // 统计匹配情况
    const matchStats = {
      totalRows: 0,
      matched: 0,
      unmatched: [] as string[],
      memberTaskCount: new Map<string, number>(),
    };

    const tableMatch = content.match(
      /\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g,
    );

    if (tableMatch) {
      for (const row of tableMatch) {
        const cells = row.split("|").filter((c) => c.trim());
        if (
          cells.length >= 6 &&
          !cells[0].includes("#") &&
          !cells[0].includes("-")
        ) {
          matchStats.totalRows++;
          const title = cells[1]?.trim() || "";
          const assigneeName = cells[2]?.trim().replace("@", "") || "";
          const reason = cells[3]?.trim() || "";
          const priorityStr = cells[4]?.trim().toLowerCase() || "medium";
          const dependsStr = cells[5]?.trim() || "";

          // 使用精确匹配代替模糊匹配，避免 "@AI-Gemini (Flash) #10" 错误匹配到 "Gemini (Flash)"
          const assignee = findMemberByName(assigneeName, teamMembers);

          // ★ 诊断日志：记录匹配失败的情况
          if (!assignee && assigneeName) {
            matchStats.unmatched.push(assigneeName);
            this.logger.warn(
              `[parseTaskBreakdown] ❌ Member match FAILED: "${assigneeName}" | Available: [${availableMemberNames.map((m) => m.agentName || m.displayName).join(", ")}]`,
            );
          }

          const dependsOn: number[] = [];
          const depMatches = dependsStr.match(/\d+/g);
          if (depMatches) {
            for (const dep of depMatches) {
              dependsOn.push(parseInt(dep, 10) - 1);
            }
          }

          let priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
          if (
            priorityStr.includes("关键") ||
            priorityStr.includes("critical")
          ) {
            priority = "CRITICAL";
          } else if (
            priorityStr.includes("高") ||
            priorityStr.includes("high")
          ) {
            priority = "HIGH";
          } else if (
            priorityStr.includes("低") ||
            priorityStr.includes("low")
          ) {
            priority = "LOW";
          }

          if (title && assignee) {
            matchStats.matched++;
            const memberKey = assignee.agentName || assignee.displayName;
            matchStats.memberTaskCount.set(
              memberKey,
              (matchStats.memberTaskCount.get(memberKey) || 0) + 1,
            );

            tasks.push({
              title,
              description: title,
              assigneeId: assignee.id,
              assigneeName: assignee.agentName || assignee.displayName,
              reason,
              priority,
              taskType: "implementation",
              dependsOn,
            });
          }
        }
      }
    }

    // ★ 诊断日志：输出匹配统计摘要
    const taskDistribution = Object.fromEntries(matchStats.memberTaskCount);
    const membersWithNoTasks = teamMembers.filter(
      (m) => !matchStats.memberTaskCount.has(m.agentName || m.displayName),
    );

    this.logger.log(
      `[parseTaskBreakdown] 📊 Match Summary: ${matchStats.matched}/${matchStats.totalRows} tasks matched`,
    );
    this.logger.log(
      `[parseTaskBreakdown] 📊 Task Distribution: ${JSON.stringify(taskDistribution)}`,
    );

    if (matchStats.unmatched.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] ⚠️ Unmatched names (${matchStats.unmatched.length}): ${JSON.stringify(matchStats.unmatched)}`,
      );
    }

    if (membersWithNoTasks.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] ⚠️ Members with NO tasks (${membersWithNoTasks.length}): ${JSON.stringify(membersWithNoTasks.map((m) => m.agentName || m.displayName))}`,
      );
    }

    if (tasks.length === 0 && teamMembers.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] ⚠️ No tasks parsed, creating default task for first member`,
      );
      tasks.push({
        title: "执行任务",
        description: "完成用户请求的任务",
        assigneeId: teamMembers[0].id,
        assigneeName: teamMembers[0].agentName || teamMembers[0].displayName,
        reason: "作为团队成员执行任务",
        priority: "MEDIUM",
        taskType: "implementation",
        dependsOn: [],
      });
    }

    return {
      understanding: content.match(/## 任务理解\n([^#]+)/)?.[1]?.trim() || "",
      tasks,
      executionPlan: content.match(/## 执行计划\n([^#]+)/)?.[1]?.trim() || "",
      risks: content.match(/## 风险提示\n([^#]+)/)?.[1]?.trim() || "",
    };
  }

  /**
   * 解析审核结果
   */
  parseReviewResult(content: string): boolean {
    const lowerContent = content.toLowerCase();

    const rejectPatterns = [
      "不通过",
      "暂不通过",
      "未通过",
      "未能通过",
      "未能审核通过",
      "无法通过",
      "没有通过",
      "没通过",
      "不合格",
      "需要修改",
      "需修改",
      "请修改",
      "请重新",
      "需要改进",
      "不满足",
      "rejected",
      "not approved",
      "not passed",
      "failed",
      "needs revision",
      "revise",
      "❌",
    ];

    for (const pattern of rejectPatterns) {
      if (lowerContent.includes(pattern)) {
        return false;
      }
    }

    const approvePatterns = [
      "审核通过",
      "评审通过",
      "审批通过",
      "✅ 通过",
      "✅通过",
      "approved",
      "passed",
      "✅",
    ];

    for (const pattern of approvePatterns) {
      if (lowerContent.includes(pattern)) {
        return true;
      }
    }

    if (
      lowerContent.includes("通过") ||
      lowerContent.includes("合格") ||
      lowerContent.includes("approved")
    ) {
      const passIndex = lowerContent.indexOf("通过");
      if (passIndex > 0) {
        const beforePass = lowerContent.substring(
          Math.max(0, passIndex - 5),
          passIndex,
        );
        if (
          beforePass.includes("未") ||
          beforePass.includes("不") ||
          beforePass.includes("没") ||
          beforePass.includes("无法")
        ) {
          return false;
        }
      }
      return true;
    }

    return false;
  }
}
