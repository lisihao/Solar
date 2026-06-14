/**
 * AI Engine - Content Filter
 * 内容过滤器实现
 */

/**
 * 过滤结果
 */
export interface FilterResult {
  /**
   * 是否通过
   */
  passed: boolean;

  /**
   * 被过滤的内容
   */
  filtered?: string;

  /**
   * 违规项
   */
  violations: FilterViolation[];

  /**
   * 风险评分 (0-1)
   */
  riskScore: number;

  /**
   * 类别评分
   */
  categoryScores: Record<string, number>;
}

/**
 * 过滤违规
 */
export interface FilterViolation {
  /**
   * 违规类别
   */
  category: string;

  /**
   * 违规类型
   */
  type: string;

  /**
   * 违规内容
   */
  content: string;

  /**
   * 严重程度
   */
  severity: "low" | "medium" | "high" | "critical";

  /**
   * 位置
   */
  position?: {
    start: number;
    end: number;
  };
}

/**
 * 过滤配置
 */
export interface FilterConfig {
  /**
   * 启用的类别
   */
  categories?: FilterCategory[];

  /**
   * 严重程度阈值
   */
  severityThreshold?: "low" | "medium" | "high" | "critical";

  /**
   * 风险评分阈值
   */
  riskThreshold?: number;

  /**
   * 是否过滤（替换违规内容）
   */
  filterContent?: boolean;

  /**
   * 替换字符
   */
  replacementChar?: string;

  /**
   * 自定义规则
   */
  customRules?: FilterRule[];
}

/**
 * 过滤类别
 */
export type FilterCategory =
  | "hate" // 仇恨言论
  | "violence" // 暴力内容
  | "sexual" // 色情内容
  | "harassment" // 骚扰
  | "self-harm" // 自残
  | "illegal" // 非法内容
  | "pii" // 个人信息
  | "spam" // 垃圾信息
  | "prompt-injection"; // 提示词注入

/**
 * 过滤规则
 */
export interface FilterRule {
  id: string;
  name: string;
  category: FilterCategory;
  pattern: string | RegExp;
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "filter" | "warn";
}

/**
 * 内容过滤器
 * 注意：使用工厂模式注册，不需要 @Injectable() 装饰器
 */
export class ContentFilter {
  private config: Required<FilterConfig>;
  private rules: FilterRule[] = [];

  private static readonly DEFAULT_CONFIG: Required<FilterConfig> = {
    categories: ["hate", "violence", "illegal", "pii", "prompt-injection"],
    severityThreshold: "medium",
    riskThreshold: 0.7,
    filterContent: true,
    replacementChar: "*",
    customRules: [],
  };

  constructor(config?: FilterConfig) {
    this.config = { ...ContentFilter.DEFAULT_CONFIG, ...config };
    this.initializeRules();
  }

  /**
   * 初始化内置规则
   */
  private initializeRules(): void {
    // PII 规则
    this.rules.push(
      {
        id: "pii-email",
        name: "Email Address",
        category: "pii",
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        severity: "medium",
        action: "filter",
      },
      {
        id: "pii-phone",
        name: "Phone Number",
        category: "pii",
        pattern:
          /(?:\+?86)?1[3-9]\d{9}|\+?1?\s*\(?[0-9]{3}\)?[-.\s]*[0-9]{3}[-.\s]*[0-9]{4}/g,
        severity: "medium",
        action: "filter",
      },
      {
        id: "pii-id-card",
        name: "ID Card Number",
        category: "pii",
        pattern: /\d{17}[\dXx]|\d{15}/g,
        severity: "high",
        action: "filter",
      },
      {
        id: "pii-credit-card",
        name: "Credit Card Number",
        category: "pii",
        pattern: /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g,
        severity: "critical",
        action: "block",
      },
    );

    // 提示词注入规则
    this.rules.push(
      {
        id: "injection-ignore",
        name: "Ignore Instructions",
        category: "prompt-injection",
        pattern:
          /ignore\s+(previous|all|above)\s+(instructions?|prompts?|rules?)/gi,
        severity: "high",
        action: "block",
      },
      {
        id: "injection-override",
        name: "Override System",
        category: "prompt-injection",
        pattern: /override\s+(system|safety|security)/gi,
        severity: "high",
        action: "block",
      },
      {
        id: "injection-jailbreak",
        name: "Jailbreak Attempt",
        category: "prompt-injection",
        pattern: /(?:DAN|jailbreak|bypass\s+(?:filter|safety|restriction))/gi,
        severity: "critical",
        action: "block",
      },
    );

    // 添加自定义规则
    this.rules.push(...this.config.customRules);
  }

  /**
   * 过滤内容
   */
  filter(content: string): FilterResult {
    const violations: FilterViolation[] = [];
    const categoryScores: Record<string, number> = {};
    let filteredContent = content;

    // 应用所有规则
    for (const rule of this.rules) {
      // 跳过未启用的类别
      if (!this.config.categories.includes(rule.category)) {
        continue;
      }

      const pattern =
        typeof rule.pattern === "string"
          ? new RegExp(rule.pattern, "gi")
          : rule.pattern;

      const matches = content.matchAll(pattern);

      for (const match of matches) {
        const violation: FilterViolation = {
          category: rule.category,
          type: rule.name,
          content: match[0],
          severity: rule.severity,
          position: {
            start: match.index || 0,
            end: (match.index || 0) + match[0].length,
          },
        };

        violations.push(violation);

        // 更新类别评分
        const severityWeight = this.getSeverityWeight(rule.severity);
        categoryScores[rule.category] = Math.max(
          categoryScores[rule.category] || 0,
          severityWeight,
        );

        // 过滤内容
        if (this.config.filterContent && rule.action !== "warn") {
          filteredContent = filteredContent.replace(
            match[0],
            this.config.replacementChar.repeat(match[0].length),
          );
        }
      }
    }

    // 计算总体风险评分
    const riskScore = Object.values(categoryScores).reduce(
      (max, score) => Math.max(max, score),
      0,
    );

    // 判断是否通过
    const passed = this.evaluateResult(violations, riskScore);

    return {
      passed,
      filtered: filteredContent !== content ? filteredContent : undefined,
      violations,
      riskScore,
      categoryScores,
    };
  }

  /**
   * 获取严重程度权重
   */
  private getSeverityWeight(severity: FilterViolation["severity"]): number {
    switch (severity) {
      case "low":
        return 0.25;
      case "medium":
        return 0.5;
      case "high":
        return 0.75;
      case "critical":
        return 1.0;
    }
  }

  /**
   * 评估结果
   */
  private evaluateResult(
    violations: FilterViolation[],
    riskScore: number,
  ): boolean {
    // 检查风险评分
    if (riskScore > this.config.riskThreshold) {
      return false;
    }

    // 检查严重程度阈值
    const thresholdWeight = this.getSeverityWeight(
      this.config.severityThreshold,
    );
    const hasBlockingViolation = violations.some(
      (v) => this.getSeverityWeight(v.severity) >= thresholdWeight,
    );

    return !hasBlockingViolation;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: FilterRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index === -1) {
      return false;
    }
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
