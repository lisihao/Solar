import { Injectable } from "@nestjs/common";
import type { MissionResult } from "@/modules/ai-harness/facade";
import type { WritingMissionInput } from "./writing-mission.types";

/**
 * Writing Text Processor Service
 *
 * Pure stateless text processing utilities extracted from WritingMissionService.
 * None of these methods depend on injected services.
 */
@Injectable()
export class WritingTextProcessorService {
  /**
   * 将数字转换为中文数字
   */
  numberToChinese(num: number): string {
    const chineseNums = [
      "零",
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八",
      "九",
      "十",
    ];
    if (num <= 10) return chineseNums[num];
    if (num < 20) return "十" + (num === 10 ? "" : chineseNums[num - 10]);
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const ones = num % 10;
      return chineseNums[tens] + "十" + (ones === 0 ? "" : chineseNums[ones]);
    }
    return num.toString();
  }

  /**
   * 统计中英文字数
   */
  countWords(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    return chineseChars + englishWords;
  }

  /**
   * 从章节内容中提取标题
   * 支持多种格式:
   * - 第X章 标题
   * - 第X章：标题
   * - 第X章: 标题
   * - # 第X章 标题
   * - ### 第X章 第X回 标题
   */
  extractChapterTitle(content: string, chapterNumber: number): string {
    // 获取第一行
    const firstLine = content.split(/[\n\r]/)[0]?.trim() || "";

    // 移除开头的 markdown 标记 (# ## ### 等)
    const cleanLine = firstLine.replace(/^#+\s*/, "");

    // 尝试多种匹配模式
    const patterns = [
      // 格式: 第X章：标题 或 第X章: 标题
      /^第[一二三四五六七八九十百千\d]+章[：:]\s*(.+)$/,
      // 格式: 第X章 第X回 标题
      /^第[一二三四五六七八九十百千\d]+章\s+第[一二三四五六七八九十百千\d]+回\s+(.+)$/,
      // 格式: 第X章 标题 (标题不以"第"开头)
      /^第[一二三四五六七八九十百千\d]+章\s+([^第].+)$/,
    ];

    for (const pattern of patterns) {
      const match = cleanLine.match(pattern);
      if (match && match[1]) {
        const title = match[1].trim();
        // 确保标题不为空且不只是章节号
        if (title && !title.match(/^第[一二三四五六七八九十百千\d]+[章回]$/)) {
          return title;
        }
      }
    }

    // 如果匹配失败但有内容，尝试提取第X章后面的所有内容作为标题
    const generalMatch = cleanLine.match(
      /^第[一二三四五六七八九十百千\d]+章\s*[：:\s]*(.+)$/,
    );
    if (generalMatch && generalMatch[1]) {
      const extracted = generalMatch[1].trim();
      // 检查是否是 "第X回 标题" 格式
      const huiWithTitle = extracted.match(
        /^(第[一二三四五六七八九十百千\d]+回)\s+(.+)$/,
      );
      if (huiWithTitle && huiWithTitle[2]) {
        // 有标题，返回标题部分
        return huiWithTitle[2].trim();
      }
      // 检查是否只有 "第X回" - 尝试从后续行找标题
      const huiOnly = extracted.match(/^第[一二三四五六七八九十百千\d]+回$/);
      if (huiOnly) {
        // 尝试从第二行或第三行获取有意义的标题
        const lines = content.split(/[\n\r]/).filter((l) => l.trim());
        for (let i = 1; i < Math.min(lines.length, 4); i++) {
          const line = lines[i].trim();
          // 跳过空行和太短的行
          if (line.length < 4) continue;
          // 跳过以特殊字符开头的行
          if (/^[#*\-\d]/.test(line)) continue;
          // 找到一个合适的标题行（取前20个字符作为标题）
          const titleCandidate = line
            .substring(0, 20)
            .replace(/[，。！？].*$/, "");
          if (titleCandidate.length >= 4) {
            return titleCandidate;
          }
        }
        // 如果找不到合适的标题，使用第X回格式
        return extracted;
      }
      // 其他情况，移除可能的"第X回"前缀
      const withoutHui = extracted.replace(
        /^第[一二三四五六七八九十百千\d]+回\s*/,
        "",
      );
      if (withoutHui && withoutHui.length > 0) {
        return withoutHui;
      }
      // 如果移除后为空但原始提取不为空，返回原始提取
      if (extracted && extracted.length > 0) {
        return extracted;
      }
    }

    // 最终回退：使用默认标题
    return `第${chapterNumber}章`;
  }

  /**
   * 从 MissionResult 中提取备用内容（当 JSON 解析失败时）
   */
  extractFallbackContent(
    result: MissionResult,
    input: WritingMissionInput,
  ): string | undefined {
    // 尝试从任何 deliverable 中提取内容
    if (result.deliverables && result.deliverables.length > 0) {
      for (const deliverable of result.deliverables) {
        // 尝试从各种格式提取内容
        if (deliverable.content) {
          // JSON 格式的 deliverable
          if (typeof deliverable.content === "object") {
            const content = deliverable.content as Record<string, unknown>;

            // 尝试提取 outputs 数组中的任何输出
            if (Array.isArray(content.outputs)) {
              for (const output of content.outputs) {
                if (typeof output === "object" && output !== null) {
                  const obj = output as Record<string, unknown>;
                  // 从 output 字段提取
                  if (
                    typeof obj.output === "string" &&
                    obj.output.length > 100
                  ) {
                    // 过滤掉模拟的输出
                    if (!obj.output.includes("(simulated)")) {
                      return obj.output;
                    }
                  }
                }
                // 直接是字符串
                if (typeof output === "string" && output.length > 100) {
                  if (!output.includes("(simulated)")) {
                    return output;
                  }
                }
              }
            }
          }

          // 直接是字符串内容
          if (
            typeof deliverable.content === "string" &&
            deliverable.content.length > 100
          ) {
            return deliverable.content;
          }
        }
      }
    }

    // 从 summary 构建基础内容（最后的尝试）
    if (result.summary && !result.summary.includes("失败")) {
      return `# ${input.userPrompt}\n\n${result.summary}\n\n（AI 团队正在努力创作中，请稍后刷新查看完整内容...）`;
    }

    return undefined;
  }

  /**
   * 从生成内容中提取摘要
   */
  extractSummaryFromContent(content: string): string {
    // 截取前500字作为简单摘要
    const maxLength = 500;
    const cleaned = content
      .replace(/\n{2,}/g, "\n") // 合并多余换行
      .trim();

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    // 尝试在句号、问号、感叹号处截断
    const truncated = cleaned.slice(0, maxLength);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("！"),
    );

    if (lastSentenceEnd > maxLength * 0.6) {
      return truncated.slice(0, lastSentenceEnd + 1) + "...";
    }

    return truncated + "...";
  }

  /**
   * 生成章节简单摘要（无 AI，纯文本截取）
   */
  generateChapterSummarySimple(content: string): string {
    const maxLength = 800;
    if (content.length <= maxLength) {
      return content;
    }
    // 取前 400 字和后 400 字
    const start = content.slice(0, 400);
    const end = content.slice(-400);
    return `${start}...\n...\n${end}`;
  }
}
