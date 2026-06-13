/**
 * 续写标记常量
 * Continuation Markers Constants
 */

/**
 * 显式续写标记（需要续写）
 */
export const CONTINUATION_MARKERS: RegExp[] = [
  // 中文标记
  /未完待续/,
  /待续/,
  /\.\.\.\s*（续）/,
  /\.\.\.\s*\(续\)/,
  /【待续】/,
  /\[未完\]/,
  /（未完）/,
  /\(未完\)/,
  /下回分解/,
  /欲知后事如何/,

  // 英文标记
  /TBC/i,
  /To Be Continued/i,
  /\.\.\.\s*continued/i,
  /\[CONTINUATION_NEEDED\]/i,
  /\[CONTINUE\]/i,
  /\[TO_BE_CONTINUED\]/i,
];

/**
 * 完成标记（确认完成）
 */
export const COMPLETION_MARKERS: RegExp[] = [
  // 结构化标记
  /\[COMPLETED\]/i,
  /\[DONE\]/i,
  /\[END\]/i,
  /\[完成\]/,
  /【完成】/,
  /（完）/,
  /\(完\)/,
  /——全文完——/,
  /——完——/,
  /（全文完）/,
  /\(全文完\)/,

  // 章节结束标记
  /第.{1,5}章\s*完$/,
  /本章完$/,
  /章节结束$/,
];

/**
 * 句子未完成模式
 */
export const INCOMPLETE_SENTENCE_PATTERNS: RegExp[] = [
  // 无标点结尾
  /[^\。\！\？\.\!\?\"\"\'\'\」\』\n]$/,

  // 对话未完成
  /"[^"]*$/,
  /"[^"]*$/,
  /「[^」]*$/,
  /『[^』]*$/,

  // 动作描写中断
  /正要[^。！？\n]{0,20}$/,
  /即将[^。！？\n]{0,20}$/,
  /刚刚[^。！？\n]{0,20}$/,
  /突然[^。！？\n]{0,30}$/,
  /却发现[^。！？\n]{0,20}$/,
  /只见[^。！？\n]{0,20}$/,

  // 省略号结尾但不是完成标记
  /[^完成结束]\.\.\.\s*$/,
  /[^完成结束]……\s*$/,
];

/**
 * 结构化结尾模式（表示内容完整）
 */
export const STRUCTURED_ENDING_PATTERNS: RegExp[] = [
  // 中文完整结尾
  /。\s*$/,
  /！\s*$/,
  /？\s*$/,
  /"\s*$/,
  /"\s*$/,
  /」\s*$/,
  /』\s*$/,

  // 英文完整结尾
  /\.\s*$/,
  /\!\s*$/,
  /\?\s*$/,
  /"\s*$/,
  /'\s*$/,

  // 段落标记结尾
  /\n\s*$/,
  /---\s*$/,
  /\*\*\*\s*$/,
];

/**
 * 检测内容是否包含续写标记
 */
export function hasContinuationMarker(content: string): {
  found: boolean;
  marker?: string;
} {
  const trimmedContent = content.trim();
  const lastPortion = trimmedContent.slice(-200); // 检查最后200字符

  for (const pattern of CONTINUATION_MARKERS) {
    const match = lastPortion.match(pattern);
    if (match) {
      return { found: true, marker: match[0] };
    }
  }

  return { found: false };
}

/**
 * 检测内容是否包含完成标记
 */
export function hasCompletionMarker(content: string): {
  found: boolean;
  marker?: string;
} {
  const trimmedContent = content.trim();
  const lastPortion = trimmedContent.slice(-200);

  for (const pattern of COMPLETION_MARKERS) {
    const match = lastPortion.match(pattern);
    if (match) {
      return { found: true, marker: match[0] };
    }
  }

  return { found: false };
}

/**
 * 检测内容是否有结构化结尾
 */
export function hasStructuredEnding(content: string): boolean {
  const trimmedContent = content.trim();

  for (const pattern of STRUCTURED_ENDING_PATTERNS) {
    if (pattern.test(trimmedContent)) {
      return true;
    }
  }

  return false;
}

/**
 * 检测句子是否未完成
 */
export function hasIncompleteSentence(content: string): {
  incomplete: boolean;
  pattern?: string;
} {
  const trimmedContent = content.trim();
  const lastPortion = trimmedContent.slice(-100);

  for (const pattern of INCOMPLETE_SENTENCE_PATTERNS) {
    if (pattern.test(lastPortion)) {
      return { incomplete: true, pattern: pattern.source };
    }
  }

  return { incomplete: false };
}
