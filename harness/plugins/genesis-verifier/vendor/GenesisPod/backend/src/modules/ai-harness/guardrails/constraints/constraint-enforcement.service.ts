/**
 * Constraint Enforcement Service
 *
 * 约束执行与校验服务（AI Engine 核心能力层）
 * - 从任务描述中提取 MUST/SHOULD/MAY 约束
 * - 校验 Agent 输出是否违反约束
 * - 生成违规报告
 *
 * 这是领域无关的通用机制，可被任何 AI App 复用：
 * - 小说创作：角色约束、时代约束
 * - 技术文档：术语一致性、格式约束
 * - 研究报告：引用规范、准确性约束
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  ConstraintSeverity,
  ExtractedConstraint,
  ConstraintViolation,
  OutputValidationResult,
  HardConstraint,
  IConstraintEnforcementService,
} from "@/modules/ai-harness/runner/executor/executor.types";

@Injectable()
export class ConstraintEnforcementService implements IConstraintEnforcementService {
  private readonly logger = new Logger(ConstraintEnforcementService.name);

  /**
   * 从文本中提取约束
   *
   * 支持的格式：
   * - "必须：钟叔不能说话"
   * - "硬性约束：所有对话需要半文半白"
   * - "禁止：不能出现现代词汇"
   */
  extractConstraints(description: string): ExtractedConstraint[] {
    const constraints: ExtractedConstraint[] = [];
    let constraintId = 0;

    // MUST 约束模式
    const mustPatterns = [
      /必须[：:]\s*(.+?)(?=[。\n]|$)/g,
      /硬性约束[：:]\s*(.+?)(?=[。\n]|$)/g,
      /禁止[：:]\s*(.+?)(?=[。\n]|$)/g,
      /不能[：:]\s*(.+?)(?=[。\n]|$)/g,
      /不可以[：:]\s*(.+?)(?=[。\n]|$)/g,
      /绝对不[：:]\s*(.+?)(?=[。\n]|$)/g,
      /严禁[：:]\s*(.+?)(?=[。\n]|$)/g,
    ];

    // SHOULD 约束模式
    const shouldPatterns = [
      /建议[：:]\s*(.+?)(?=[。\n]|$)/g,
      /应该[：:]\s*(.+?)(?=[。\n]|$)/g,
      /最好[：:]\s*(.+?)(?=[。\n]|$)/g,
      /尽量[：:]\s*(.+?)(?=[。\n]|$)/g,
    ];

    // MAY 约束模式
    const mayPatterns = [
      /可以[：:]\s*(.+?)(?=[。\n]|$)/g,
      /允许[：:]\s*(.+?)(?=[。\n]|$)/g,
    ];

    // 提取 MUST 约束
    for (const pattern of mustPatterns) {
      pattern.lastIndex = 0; // 重置 lastIndex 防止多次调用时跳过匹配
      let match;
      while ((match = pattern.exec(description)) !== null) {
        constraints.push({
          id: `HC-${String(++constraintId).padStart(3, "0")}`,
          type: "MUST",
          rule: match[1].trim(),
          source: match[0],
          confidence: 0.9,
        });
      }
    }

    // 提取 SHOULD 约束
    for (const pattern of shouldPatterns) {
      pattern.lastIndex = 0; // 重置 lastIndex
      let match;
      while ((match = pattern.exec(description)) !== null) {
        constraints.push({
          id: `SC-${String(++constraintId).padStart(3, "0")}`,
          type: "SHOULD",
          rule: match[1].trim(),
          source: match[0],
          confidence: 0.8,
        });
      }
    }

    // 提取 MAY 约束
    for (const pattern of mayPatterns) {
      pattern.lastIndex = 0; // 重置 lastIndex
      let match;
      while ((match = pattern.exec(description)) !== null) {
        constraints.push({
          id: `MC-${String(++constraintId).padStart(3, "0")}`,
          type: "MAY",
          rule: match[1].trim(),
          source: match[0],
          confidence: 0.7,
        });
      }
    }

    // 特殊模式：检测隐含约束
    this.extractImplicitConstraints(description, constraints);

    this.logger.debug(
      `[extractConstraints] Extracted ${constraints.length} constraints from description`,
    );

    return constraints;
  }

  /**
   * 提取隐含约束（如角色特性约束）
   * 注意：使用 {1,20} 限制匹配长度，防止 ReDoS 攻击
   */
  private extractImplicitConstraints(
    description: string,
    constraints: ExtractedConstraint[],
  ): void {
    // 检测 "X是哑巴" 这类隐含约束（限制实体名最多20字符，防止 ReDoS）
    const mutePattern = /(\S{1,20})[是为](哑巴|哑仆|聋哑人)/g;
    mutePattern.lastIndex = 0; // 重置 lastIndex
    let match;
    while ((match = mutePattern.exec(description)) !== null) {
      const character = match[1];
      constraints.push({
        id: `HC-IMP-${constraints.length + 1}`,
        type: "MUST",
        rule: `${character}不能说话、不能发出声音`,
        source: match[0],
        confidence: 0.95,
      });
    }

    // 检测 "X不会说话" 这类约束（限制实体名最多20字符）
    const cannotSpeakPattern = /(\S{1,20})不会说话/g;
    cannotSpeakPattern.lastIndex = 0; // 重置 lastIndex
    while ((match = cannotSpeakPattern.exec(description)) !== null) {
      const character = match[1];
      constraints.push({
        id: `HC-IMP-${constraints.length + 1}`,
        type: "MUST",
        rule: `${character}不能说话`,
        source: match[0],
        confidence: 0.95,
      });
    }

    // 检测 "X（别名）...哑仆/哑巴" 人设描述模式
    // 匹配: "钟长生（钟叔）的人设...哑仆" 或 "表面身份：...的哑仆"
    const characterSetupPattern =
      /(\S{1,10})(?:[（(](\S{1,10})[)）])?(?:的人设|人物设定)[^。]*?(哑巴|哑仆|聋哑人|不能说话|自毁声带)/g;
    characterSetupPattern.lastIndex = 0;
    while ((match = characterSetupPattern.exec(description)) !== null) {
      const mainName = match[1];
      const aliasName = match[2];
      // match[3] 是 muteType（哑巴/哑仆等），已通过模式匹配确认存在
      // 为主名和别名都生成约束
      const names = aliasName ? [mainName, aliasName] : [mainName];
      for (const name of names) {
        // 避免重复添加
        const existingRule = constraints.find(
          (c) => c.rule.includes(name) && c.rule.includes("不能说话"),
        );
        if (!existingRule) {
          constraints.push({
            id: `HC-IMP-${constraints.length + 1}`,
            type: "MUST",
            rule: `${name}不能说话、不能发出声音`,
            source: match[0],
            confidence: 0.9,
          });
        }
      }
    }

    // 检测 "表面身份：...的哑仆/哑巴" 模式
    // 使用 [^\s。的] 排除句号和"的"助词，确保只捕获角色名
    const surfaceIdentityPattern =
      /([^\s。的]{1,10})(?:[（(][^\s。的]{1,10}[)）])?[^。]*?表面身份[：:][^。]*?(哑巴|哑仆|聋哑人)/g;
    surfaceIdentityPattern.lastIndex = 0;
    while ((match = surfaceIdentityPattern.exec(description)) !== null) {
      const character = match[1];
      // 避免重复添加
      const existingRule = constraints.find(
        (c) => c.rule.includes(character) && c.rule.includes("不能说话"),
      );
      if (!existingRule) {
        constraints.push({
          id: `HC-IMP-${constraints.length + 1}`,
          type: "MUST",
          rule: `${character}不能说话、不能发出声音`,
          source: match[0],
          confidence: 0.9,
        });
      }
    }

    // 检测 "X自毁声带" 模式
    // 使用 [^\s。] 代替 \S 避免跨句匹配
    const destroyedVoicePattern = /([^\s。]{1,10})自毁声带/g;
    destroyedVoicePattern.lastIndex = 0;
    while ((match = destroyedVoicePattern.exec(description)) !== null) {
      const character = match[1];
      const existingRule = constraints.find(
        (c) => c.rule.includes(character) && c.rule.includes("不能说话"),
      );
      if (!existingRule) {
        constraints.push({
          id: `HC-IMP-${constraints.length + 1}`,
          type: "MUST",
          rule: `${character}不能说话、不能发出声音`,
          source: match[0],
          confidence: 0.95,
        });
      }
    }

    // 检测时代设定约束（限制时代名最多10字符）
    const periodPatterns = [
      {
        pattern: /背景设定[在为]?(\S{1,10}时代|古代|民国|清朝|明朝|唐朝)/g,
        era: true,
      },
      {
        pattern: /故事发生在(\S{1,10}时代|古代|民国|清朝|明朝|唐朝)/g,
        era: true,
      },
    ];

    for (const { pattern, era } of periodPatterns) {
      pattern.lastIndex = 0; // 重置 lastIndex
      while ((match = pattern.exec(description)) !== null) {
        if (era) {
          constraints.push({
            id: `HC-IMP-${constraints.length + 1}`,
            type: "MUST",
            rule: `不能出现与${match[1]}不符的现代词汇和概念`,
            source: match[0],
            confidence: 0.85,
          });
        }
      }
    }
  }

  /**
   * 校验输出是否违反约束
   */
  async validateOutput(
    output: string,
    constraints: ExtractedConstraint[] | HardConstraint[],
  ): Promise<OutputValidationResult> {
    const violations: ConstraintViolation[] = [];
    const mustConstraints = constraints.filter(
      (c): c is ExtractedConstraint | HardConstraint =>
        "type" in c ? c.type === "MUST" : c.severity === "MUST",
    );

    for (const constraint of mustConstraints) {
      const rule = constraint.rule;
      const detected = await this.detectViolation(output, rule);

      if (detected) {
        violations.push({
          constraintId: constraint.id,
          rule,
          violatingText: detected.text,
          position: detected.position,
          severity: "critical",
        });
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      checkedConstraints: mustConstraints.length,
      passedConstraints: mustConstraints.length - violations.length,
    };
  }

  /**
   * 检测单个约束是否被违反
   */
  private async detectViolation(
    output: string,
    rule: string,
  ): Promise<{ text: string; position: number } | null> {
    // 解析约束规则，提取实体和禁止动作
    const parsed = this.parseConstraintRule(rule);

    if (!parsed) {
      return null;
    }

    const { entity, forbiddenActions, isNegative } = parsed;

    if (isNegative && entity && forbiddenActions.length > 0) {
      // 检测 "X不能Y" 类型的约束
      for (const action of forbiddenActions) {
        // 构建检测模式：实体名 + 最多5个字符 + 禁止动作
        const pattern = new RegExp(`${entity}[^，。、！？]{0,5}${action}`, "g");
        const match = pattern.exec(output);
        if (match) {
          return { text: match[0], position: match.index };
        }
      }
    }

    return null;
  }

  /**
   * 解析约束规则
   */
  private parseConstraintRule(rule: string): {
    entity: string | null;
    forbiddenActions: string[];
    isNegative: boolean;
  } | null {
    // 检测 "X不能Y" 模式
    const negativePattern = /(\S+?)不能(.+)/;
    const match = rule.match(negativePattern);

    if (match) {
      const entity = match[1];
      const actionsPart = match[2];

      // 分割多个禁止动作
      const actions = actionsPart
        .split(/[、,，]/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      // 扩展动作词（如"说话" -> ["说", "道", "叫道", "喊道", "笑道"]）
      const expandedActions = this.expandActions(actions);

      return {
        entity,
        forbiddenActions: expandedActions,
        isNegative: true,
      };
    }

    // 检测其他禁止模式
    const forbidPattern = /禁止(.+)/;
    const forbidMatch = rule.match(forbidPattern);

    if (forbidMatch) {
      return {
        entity: null,
        forbiddenActions: [forbidMatch[1]],
        isNegative: true,
      };
    }

    return null;
  }

  /**
   * 扩展动作词
   */
  private expandActions(actions: string[]): string[] {
    const expanded: string[] = [];

    for (const action of actions) {
      expanded.push(action);

      // 特殊扩展：说话相关
      if (action.includes("说话") || action.includes("说")) {
        expanded.push(
          "说",
          "道",
          "叫道",
          "喊道",
          "笑道",
          "问道",
          "答道",
          "说道",
          "开口",
          "出声",
          "发声",
        );
      }

      // 特殊扩展：声音相关
      if (action.includes("发出声音") || action.includes("出声")) {
        expanded.push("出声", "发声", "喊", "叫", "吼", "嚷");
      }
    }

    return [...new Set(expanded)]; // 去重
  }

  /**
   * 生成违规报告
   */
  generateViolationReport(violations: ConstraintViolation[]): string {
    if (violations.length === 0) {
      return "未检测到约束违规。";
    }

    const lines = [`检测到 ${violations.length} 处约束违规：`, ""];

    for (let i = 0; i < violations.length; i++) {
      const v = violations[i];
      lines.push(`${i + 1}. [${v.constraintId}] ${v.rule}`);
      lines.push(`   违规内容: "${v.violatingText}"`);
      lines.push(`   位置: 字符 ${v.position}`);
      lines.push(`   严重程度: ${v.severity}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 格式化约束列表（用于 Prompt 注入）
   */
  formatConstraintsForPrompt(
    constraints: ExtractedConstraint[] | HardConstraint[],
    type: ConstraintSeverity = "MUST",
  ): string {
    const filtered = constraints.filter(
      (c): c is ExtractedConstraint | HardConstraint =>
        "type" in c ? c.type === type : c.severity === type,
    );

    if (filtered.length === 0) {
      return "";
    }

    const header =
      type === "MUST"
        ? "【硬性约束 - 违反将导致任务失败】"
        : type === "SHOULD"
          ? "【软性约束 - 建议遵循】"
          : "【参考建议】";

    const lines = [header];
    for (const c of filtered) {
      lines.push(`• ${c.id}: ${c.rule}`);
    }

    return lines.join("\n");
  }

  /**
   * 将提取的约束转换为 HardConstraint
   */
  toHardConstraints(constraints: ExtractedConstraint[]): HardConstraint[] {
    return constraints
      .filter((c) => c.type === "MUST" || c.type === "SHOULD")
      .map((c) => ({
        id: c.id,
        rule: c.rule,
        reason: c.source,
        severity: c.type as "MUST" | "SHOULD",
      }));
  }
}
