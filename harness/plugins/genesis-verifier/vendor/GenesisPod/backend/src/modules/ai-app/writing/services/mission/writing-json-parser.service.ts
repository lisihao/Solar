import { Injectable, Logger } from "@nestjs/common";
import { WritingTextProcessorService } from "./writing-text-processor.service";

/**
 * WritingJsonParserService
 *
 * Pure JSON parsing utilities extracted from WritingMissionService.
 * All methods parse LLM response strings and return structured objects.
 * No external service dependencies.
 */
@Injectable()
export class WritingJsonParserService {
  readonly logger = new Logger(WritingJsonParserService.name);
  private readonly textProcessor = new WritingTextProcessorService();

  /**
   * 解析大纲 JSON
   */
  public parseOutlineJSON(
    content: string,
    totalVolumes: number,
    totalChapters: number,
  ): {
    bookTitle: string;
    core: { summary: string; genre: string; theme: string };
    volumes: Array<{
      title: string;
      conflict: string;
      plot: string;
      emotion: string;
    }>;
    chapters: Array<{
      volumeIndex: number;
      title: string;
      plot: string;
      keyPoint: string;
    }>;
  } {
    let parsed: {
      bookTitle?: string;
      core?: { summary?: string; genre?: string; theme?: string };
      volumes?: Array<{
        title?: string;
        conflict?: string;
        plot?: string;
        emotion?: string;
      }>;
      chapters?: Array<{
        volumeIndex?: number;
        title?: string;
        plot?: string;
        keyPoint?: string;
      }>;
    } | null = null;

    try {
      // 1. 先移除 markdown 代码块包装 (```json ... ``` 或 ``` ... ```)
      const cleanContent = content
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // 2. 尝试找到 JSON 对象（从第一个 { 到最后一个 }）
      const firstBrace = cleanContent.indexOf("{");
      const lastBrace = cleanContent.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleanContent.substring(firstBrace, lastBrace + 1);
        parsed = JSON.parse(jsonStr);
        this.logger.log(
          `[parseOutlineJSON] Successfully parsed JSON, bookTitle: ${parsed?.bookTitle || "(none)"}, chapters: ${parsed?.chapters?.length || 0}`,
        );
      } else {
        this.logger.warn(
          `[parseOutlineJSON] No valid JSON structure found in response (length: ${content.length})`,
        );
        // ★ 也打印内容预览帮助诊断
        this.logger.warn(
          `[parseOutlineJSON] Content preview (no JSON): ${content.slice(0, 500)}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `[parseOutlineJSON] Failed to parse outline JSON: ${(e as Error).message}`,
      );
      // 打印前500字符帮助诊断
      this.logger.warn(
        `[parseOutlineJSON] Content preview (parse error): ${content.slice(0, 500)}`,
      );
    }

    // 生成默认卷结构
    const chaptersPerVolume = Math.ceil(totalChapters / totalVolumes);
    const defaultVolumes = Array.from({ length: totalVolumes }, (_, i) => ({
      title: `第${this.textProcessor.numberToChinese(i + 1)}卷`,
      conflict: "待定",
      plot: "待定",
      emotion: "待定",
    }));

    // 生成默认章节结构（使用空标题，让前端显示"第X章"）
    const defaultChapters = Array.from({ length: totalChapters }, (_, i) => ({
      volumeIndex: Math.floor(i / chaptersPerVolume),
      title: "", // 空标题，前端会只显示"第X章"
      plot: "", // 空大纲
      keyPoint: "",
    }));

    // 如果没有解析到任何内容，返回默认结构
    if (!parsed) {
      return {
        bookTitle: "",
        core: { summary: "待定", genre: "待定", theme: "待定" },
        volumes: defaultVolumes,
        chapters: defaultChapters,
      };
    }

    // 提取书名（清理书名号）
    let bookTitle = parsed.bookTitle || "";
    bookTitle = bookTitle
      .replace(/^[《【「『]/, "")
      .replace(/[》】」』]$/, "")
      .trim();

    // 合并解析结果和默认结构
    const core = {
      summary: parsed.core?.summary || "待定",
      genre: parsed.core?.genre || "待定",
      theme: parsed.core?.theme || "待定",
    };

    // 日志：记录核心字段解析结果
    this.logger.log(
      `[parseOutlineJSON] Core parsed - theme: "${core.theme}", genre: "${core.genre}", summary: "${core.summary?.slice(0, 50)}..."`,
    );

    // 使用解析的卷，如果不足则补充默认卷
    const parsedVolumes = (parsed.volumes || []).map((v, i) => ({
      title: v.title || `第${this.textProcessor.numberToChinese(i + 1)}卷`,
      conflict: v.conflict || "待定",
      plot: v.plot || "待定",
      emotion: v.emotion || "待定",
    }));
    const volumes =
      parsedVolumes.length >= totalVolumes
        ? parsedVolumes.slice(0, totalVolumes)
        : [...parsedVolumes, ...defaultVolumes.slice(parsedVolumes.length)];

    // 使用解析的章节，如果不足则补充默认章节
    const parsedChapters = (parsed.chapters || []).map((c, i) => {
      // 清理标题 - 如果标题只是"第X章"格式，视为无效
      let title = c.title || "";
      const originalTitle = title; // 保存原始标题用于调试

      if (title.match(/^第[一二三四五六七八九十百千\d]+[章回]$/)) {
        title = ""; // 纯章节号视为空标题
      }
      // 从标题中提取实际内容（如"第一章：暗流涌动" -> "暗流涌动"）
      title = title
        .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
        .trim();

      // 调试：如果原始标题非空但清理后为空，记录日志
      if (originalTitle && !title && i < 5) {
        this.logger.warn(
          `[parseOutlineJSON] Chapter ${i + 1} title cleaned to empty: "${originalTitle}"`,
        );
      }

      return {
        volumeIndex: c.volumeIndex ?? Math.floor(i / chaptersPerVolume),
        title: title, // 可能为空，前端会只显示"第X章"
        plot: c.plot || "",
        keyPoint: c.keyPoint || "",
      };
    });

    // 检查是否所有章节标题都为空（可能是解析问题）
    const titledChapters = parsedChapters.filter((c) => c.title);
    if (parsedChapters.length > 0 && titledChapters.length === 0) {
      this.logger.warn(
        `[parseOutlineJSON] WARNING: All ${parsedChapters.length} chapter titles are empty! Raw chapters: ${JSON.stringify(parsed.chapters?.slice(0, 3))}`,
      );
    } else {
      this.logger.log(
        `[parseOutlineJSON] ${titledChapters.length}/${parsedChapters.length} chapters have titles`,
      );
    }

    // ★ 关键：确保章节数量至少达到 totalChapters
    let chapters = parsedChapters;
    if (parsedChapters.length < totalChapters) {
      this.logger.warn(
        `Parsed chapters (${parsedChapters.length}) < expected (${totalChapters}), supplementing...`,
      );
      // 补充缺少的章节（使用空值，让前端只显示"第X章"）
      const supplementChapters = defaultChapters
        .slice(parsedChapters.length)
        .map((_, i) => {
          const actualIndex = parsedChapters.length + i;
          return {
            volumeIndex: Math.floor(actualIndex / chaptersPerVolume),
            title: "", // 空标题
            plot: "", // 空大纲
            keyPoint: "",
          };
        });
      chapters = [...parsedChapters, ...supplementChapters];
    }

    this.logger.log(
      `Outline parsed: ${chapters.length} chapters (expected: ${totalChapters}), bookTitle: ${bookTitle || "(none)"}`,
    );

    return { bookTitle, core, volumes, chapters };
  }

  /**
   * 解析世界观设定
   */
  public parseWorldSettings(content: string): Record<string, unknown> {
    try {
      // 1. 先移除 markdown 代码块包装
      const cleanContent = content
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // 2. 尝试找到 JSON 对象
      const firstBrace = cleanContent.indexOf("{");
      const lastBrace = cleanContent.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleanContent.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        this.logger.log(
          `[parseWorldSettings] Successfully parsed, characters: ${(parsed.characters as unknown[])?.length || 0}`,
        );
        return parsed;
      }
      this.logger.warn(
        `[parseWorldSettings] No valid JSON structure found (length: ${content.length})`,
      );
    } catch (e) {
      this.logger.warn(
        `[parseWorldSettings] Failed to parse: ${(e as Error).message}`,
      );
      this.logger.warn(
        `[parseWorldSettings] Content preview: ${content.slice(0, 300)}`,
      );
    }
    return { world: {}, characters: [], factions: [], terminology: [] };
  }

  /**
   * 解析一致性检查结果
   */
  public parseConsistencyCheckResult(content: string): {
    passed: boolean;
    score: number;
    issues: Array<{
      type: string;
      severity: string;
      description: string;
      location: string;
      fix: string;
    }>;
  } {
    try {
      // 1. 清理 markdown 代码块
      let cleaned = content.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      // 2. 尝试直接解析（如果整体是有效 JSON）
      try {
        const directParsed = JSON.parse(cleaned);
        if (typeof directParsed === "object" && directParsed !== null) {
          return this.normalizeConsistencyResult(directParsed);
        }
      } catch {
        // 继续尝试其他方法
      }

      // 3. 提取第一个完整的 JSON 对象（使用括号匹配）
      const jsonStr = this.extractFirstJsonObject(cleaned);
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        return this.normalizeConsistencyResult(parsed);
      }
    } catch (e) {
      this.logger.warn(
        `Failed to parse consistency check result: ${(e as Error).message}`,
      );
      // 输出内容预览以便调试
      this.logger.debug(`Content preview: ${content.slice(0, 500)}...`);
    }
    return { passed: true, score: 100, issues: [] };
  }

  /**
   * 提取第一个完整的 JSON 对象
   */
  public extractFirstJsonObject(content: string): string | null {
    const firstBrace = content.indexOf("{");
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") {
          depth++;
        } else if (char === "}") {
          depth--;
          if (depth === 0) {
            return content.substring(firstBrace, i + 1);
          }
        }
      }
    }

    return null;
  }

  /**
   * 标准化一致性检查结果
   */
  public normalizeConsistencyResult(parsed: Record<string, unknown>): {
    passed: boolean;
    score: number;
    issues: Array<{
      type: string;
      severity: string;
      description: string;
      location: string;
      fix: string;
    }>;
  } {
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return {
      passed: typeof parsed.passed === "boolean" ? parsed.passed : true,
      score: typeof parsed.score === "number" ? parsed.score : 100,
      issues: issues.map((issue: Record<string, unknown>) => ({
        type: String(issue.type || "unknown"),
        severity: String(issue.severity || "warning"),
        description: String(issue.description || ""),
        location: String(issue.location || ""),
        fix: String(issue.fix || ""),
      })),
    };
  }

  /**
   * 解析修复验证结果
   */
  public parseVerificationResult(content: string): {
    allFixed: boolean;
    verifications: Array<{
      issueIndex: number;
      fixed: boolean;
      evidence: string;
    }>;
  } {
    try {
      // 清理 markdown 代码块
      let cleaned = content.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      // 尝试直接解析
      try {
        const directParsed = JSON.parse(cleaned);
        if (typeof directParsed === "object" && directParsed !== null) {
          return this.normalizeVerificationResult(directParsed);
        }
      } catch {
        // 继续尝试其他方法
      }

      // 提取第一个完整的 JSON 对象
      const jsonStr = this.extractFirstJsonObject(cleaned);
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        return this.normalizeVerificationResult(parsed);
      }
    } catch (e) {
      this.logger.warn(
        `Failed to parse verification result: ${(e as Error).message}`,
      );
    }
    return { allFixed: true, verifications: [] };
  }

  /**
   * 标准化验证结果
   */
  public normalizeVerificationResult(parsed: Record<string, unknown>): {
    allFixed: boolean;
    verifications: Array<{
      issueIndex: number;
      fixed: boolean;
      evidence: string;
    }>;
  } {
    const verifications = Array.isArray(parsed.verifications)
      ? parsed.verifications
      : [];
    return {
      allFixed: typeof parsed.allFixed === "boolean" ? parsed.allFixed : true,
      verifications: verifications.map((v: Record<string, unknown>) => ({
        issueIndex: typeof v.issueIndex === "number" ? v.issueIndex : 0,
        fixed: typeof v.fixed === "boolean" ? v.fixed : true,
        evidence: String(v.evidence || ""),
      })),
    };
  }

  /**
   * 尝试修复截断的 JSON
   */
  public tryRepairTruncatedJson(jsonStr: string): string {
    // 首先检查 JSON 是否已经有效
    try {
      JSON.parse(jsonStr);
      return jsonStr; // 已经有效，直接返回
    } catch {
      // 继续修复
    }

    // 统计未闭合的括号
    let openBraces = 0; // {
    let openBrackets = 0; // [
    let inString = false;
    let escapeNext = false;

    for (const char of jsonStr) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") openBraces++;
      else if (char === "}") openBraces--;
      else if (char === "[") openBrackets++;
      else if (char === "]") openBrackets--;
    }

    // 如果在字符串内截断，需要先闭合字符串
    if (inString) {
      // 找到最后一个完整的属性值结束位置
      // 尝试找到最后一个 " 前的内容
      const lastQuoteIndex = jsonStr.lastIndexOf('"');
      if (lastQuoteIndex > 0) {
        // 截断到最后一个引号，然后添加闭合引号
        jsonStr = jsonStr.slice(0, lastQuoteIndex + 1);
        // 重新计算括号
        openBraces = 0;
        openBrackets = 0;
        inString = false;
        escapeNext = false;
        for (const char of jsonStr) {
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === "\\") {
            escapeNext = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (char === "{") openBraces++;
          else if (char === "}") openBraces--;
          else if (char === "[") openBrackets++;
          else if (char === "]") openBrackets--;
        }
      }
    }

    // 移除末尾可能的不完整内容（如悬挂的逗号、冒号等）
    jsonStr = jsonStr.replace(/[,:\s]+$/, "");

    // 添加缺失的闭合括号
    let closing = "";
    for (let i = 0; i < openBrackets; i++) {
      closing += "]";
    }
    for (let i = 0; i < openBraces; i++) {
      closing += "}";
    }

    const repaired = jsonStr + closing;

    // 再次验证
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // 修复失败，返回原字符串让后续逻辑处理
      return jsonStr;
    }
  }
}
