import { Injectable, Logger } from "@nestjs/common";

export interface ContentCheckResult {
  passed: boolean;
  score: number;
  issues: ContentIssue[];
  suggestions: string[];
}

export interface ContentIssue {
  type: "forbidden_word" | "sensitive_topic" | "format_issue" | "length_issue";
  severity: "error" | "warning" | "info";
  message: string;
  position?: { start: number; end: number };
}

@Injectable()
export class ContentCheckerService {
  private readonly logger = new Logger(ContentCheckerService.name);

  // 基础违禁词列表（实际应从数据库或配置加载）
  private readonly forbiddenWords: string[] = [
    // 这里添加实际的违禁词
  ];

  async check(content: string): Promise<ContentCheckResult> {
    this.logger.log("Checking content compliance");
    const issues: ContentIssue[] = [];
    const suggestions: string[] = [];

    // 1. 检查违禁词
    const forbiddenIssues = this.checkForbiddenWords(content);
    issues.push(...forbiddenIssues);

    // 2. 检查内容长度
    const lengthIssues = this.checkContentLength(content);
    issues.push(...lengthIssues);

    // 3. 检查格式问题
    const formatIssues = this.checkFormat(content);
    issues.push(...formatIssues);

    // 计算得分
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

    // 生成建议
    if (errorCount > 0) {
      suggestions.push("请修正内容中的违规词汇后再发布");
    }
    if (warningCount > 0) {
      suggestions.push("建议优化标记为警告的内容以提高发布成功率");
    }

    return {
      passed: errorCount === 0,
      score,
      issues,
      suggestions,
    };
  }

  private checkForbiddenWords(content: string): ContentIssue[] {
    const issues: ContentIssue[] = [];

    for (const word of this.forbiddenWords) {
      const index = content.indexOf(word);
      if (index !== -1) {
        issues.push({
          type: "forbidden_word",
          severity: "error",
          message: `发现违禁词: ${word}`,
          position: { start: index, end: index + word.length },
        });
      }
    }

    return issues;
  }

  private checkContentLength(content: string): ContentIssue[] {
    const issues: ContentIssue[] = [];

    if (content.length < 100) {
      issues.push({
        type: "length_issue",
        severity: "warning",
        message: "内容过短，建议至少100字以提高阅读体验",
      });
    }

    if (content.length > 20000) {
      issues.push({
        type: "length_issue",
        severity: "error",
        message: "内容超过平台限制（20000字），请精简内容",
      });
    }

    return issues;
  }

  private checkFormat(content: string): ContentIssue[] {
    const issues: ContentIssue[] = [];

    // 检查是否有连续多个换行
    if (/\n{4,}/.test(content)) {
      issues.push({
        type: "format_issue",
        severity: "info",
        message: "发现多个连续空行，建议优化排版",
      });
    }

    return issues;
  }
}
