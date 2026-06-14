// Sediment from {app} (2026-04-29) — ai-engine/llm/output/sanitization/
// 来源: ai-app/{app}/utils/sanitize-output.utils.ts
// 纯函数 utility，0 DI，0 LLM 调用。所有 ai-app 都可用。
/**
 * sanitize-output.utils.ts
 *
 * 铁墙函数：基于白名单清理 LLM 输出中的所有非正文内容。
 *
 * 设计原则：不枚举 LLM 的错误模式（无穷），而是定义什么是合格内容（有限）。
 * 不在白名单中的行一律删除。
 *
 * 在三个位置调用：
 * 1. Section Writer 输出后（第一道铁墙）
 * 2. assembleFullReport 维度拼入前（第二道铁墙）
 * 3. postProcessFinalReport 最后（第三道铁墙）
 */

/**
 * 清理 LLM 输出，只保留合格的 markdown 内容行。
 *
 * 白名单规则：
 * - 空行
 * - 标题行（# ## ### ####）
 * - chart 占位符（<!-- chart:... -->）
 * - 表格行（以 | 开头）
 * - 引用块（以 > 开头）
 * - 参考文献条目（以 [N] 开头）
 * - 分隔线（---）
 * - 中文段落（含中文字符，长度 >= 10）
 * - 中文 bullet/编号列表项
 * - 代码块内容（不处理）
 */
export function sanitizeSectionOutput(content: string): string {
  if (!content) return "";

  const lines = content.split("\n");
  const cleaned: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const t = line.trim();

    // 代码块内容不处理
    if (/^```/.test(t)) {
      inCodeBlock = !inCodeBlock;
      cleaned.push(line);
      continue;
    }
    if (inCodeBlock) {
      cleaned.push(line);
      continue;
    }

    // === 白名单判断 ===

    // 空行 — 保留
    if (t === "") {
      cleaned.push(line);
      continue;
    }

    // 标题 — 保留，但过滤掉本身是 JSON 对象的标题
    if (/^#{1,4}\s/.test(t)) {
      // 黑名单：标题以 { 开头且含 "key": 模式（JSON 泄漏到标题）
      if (/^#{1,4}\s+\{/.test(t) && /"[a-zA-Z_][\w-]*"\s*:/.test(t)) {
        continue;
      }
      cleaned.push(line);
      continue;
    }

    // chart 占位符 — 保留
    if (/^<!--/.test(t)) {
      cleaned.push(line);
      continue;
    }

    // 表格行 — 保留
    if (/^\|/.test(t) && /\|$/.test(t)) {
      cleaned.push(line);
      continue;
    }
    // 表格分隔行
    if (/^\|[-:\s|]+\|$/.test(t)) {
      cleaned.push(line);
      continue;
    }

    // 引用块 — 保留
    if (/^>\s/.test(t)) {
      cleaned.push(line);
      continue;
    }

    // 参考文献条目 — 保留
    if (/^\[\d+\]\s/.test(t)) {
      cleaned.push(line);
      continue;
    }

    // 分隔线 — 保留
    if (/^---+$/.test(t)) {
      cleaned.push(line);
      continue;
    }

    // === 黑名单判断（明确的垃圾行）===

    // JSON 属性行："key": value
    if (/"[a-zA-Z_][\w-]*"\s*:/.test(t) && !/[\u4e00-\u9fa5]{5,}/.test(t)) {
      continue;
    }

    // 孤立 JSON/markdown 符号
    if (/^[\[\]}{,]+$/.test(t)) {
      continue;
    }

    // 方括号元注释：[字数约N字] [图表引用待定] [待补充] 等
    if (/^\[(?:字数|约\d|图表|待[补定完]|TODO|NOTE|内部)/.test(t)) {
      continue;
    }

    // 字数统计行
    if (/^字数[统计：:]*[：:]?\s*约?\s*\d+\s*字/.test(t)) {
      continue;
    }

    // 圆括号元注释：（注：...）（不含...）（图表...）（内部...）（本维度约...）
    if (
      /^[（(]\s*(?:注[：:]|不含|图表|内部|此处|待补|请[参见]|说明|本维度约|本章约|本节约)/.test(
        t,
      )
    ) {
      continue;
    }

    // 内部配置说明行
    if (/^(?:\*{2})?以下是.*(?:图表|配置|证据|引用)/.test(t)) {
      continue;
    }

    // figureReference position 泄漏：position: afterparagraph_N
    if (/^position:\s*(?:after|before|end|start)/i.test(t)) {
      continue;
    }

    // Figure References 标签行
    if (
      /^(?:\*{2})?(?:Figure\s*References|figureReferences)\s*[：:\[]/i.test(t)
    ) {
      continue;
    }

    // 错误图片格式 !(url)
    if (/^!\(https?:\/\//.test(t)) {
      continue;
    }

    // 裸 URL 行（不在 markdown 链接中）
    if (/^https?:\/\/\S+$/.test(t)) {
      continue;
    }

    // 其他所有内容 → 保留
    cleaned.push(line);
  }

  // 压缩三连空行
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * 删除任何 heading（## 或 ###）后紧跟的裸 bullet list。
 *
 * 这些 bullets 通常是 LLM 对 keyPoints 的直接回显，
 * 不是正文内容。正文段落在 bullets 之后才开始。
 */
export function stripLeadingBulletLists(content: string): string {
  const lines = content.split("\n");
  const cleaned: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const t = lines[i].trim();

    // 检查是否是 heading（H2 或 H3）
    if (/^#{2,3}\s/.test(t)) {
      cleaned.push(lines[i]);
      i++;

      // 跳过空行
      while (i < lines.length && lines[i].trim() === "") {
        cleaned.push(lines[i]);
        i++;
      }

      // 检查后续是否是 3+ 连续 bullet lines
      let bulletCount = 0;
      let j = i;
      while (j < lines.length) {
        const lt = lines[j].trim();
        if (lt === "") {
          j++;
          continue;
        }
        if (/^[-*•]\s/.test(lt)) {
          bulletCount++;
          j++;
        } else {
          break;
        }
      }

      if (bulletCount >= 3) {
        // 跳过这批 bullets（包括中间的空行）
        i = j;
        // 跳过 bullets 后的空行
        while (i < lines.length && lines[i].trim() === "") {
          i++;
        }
      }
      // bulletCount < 3 的 bullet list 保留（可能是正文中合理的列表）
      continue;
    }

    cleaned.push(lines[i]);
    i++;
  }

  return cleaned.join("\n");
}

/**
 * 移除正文中任意位置的"分析性 bullet"。
 *
 * LLM 倾向于把包含因果推理、趋势判断的分析段落错误地拆成 bullet list。
 * 识别标准（两条同时满足才 strip，缺一不可）：
 *   1. 连续 3+ 条 bullet
 *   2. 所有条目文本长度 > 30 字符
 *
 * 核心逻辑：真正的专有名词列表项（Google、OpenAI、GPT-4 Turbo 等）长度均 < 25 字符；
 * 分析性判断句无论是否含技术名词（Stanford、SMAC、Raft、miRNA 等）长度必然 > 30 字符。
 * 因此单一的长度阈值足以区分两者，大小写检测反而引入误判（使 Stanford/SMAC/miRNA 等漏网）。
 *
 * 与 stripLeadingBulletLists 的区别：
 *   - stripLeadingBulletLists：只处理紧跟在标题后的 bullets（LLM 回显 keyPoints 的情形）
 *   - stripAnalyticalInlineBullets：处理正文中间的分析性 bullets（枚举拆分滥用的情形）
 */
export function stripAnalyticalInlineBullets(content: string): string {
  const BULLET_RE = /^\s*[-*]\s+/;
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!BULLET_RE.test(line)) {
      result.push(line);
      i++;
      continue;
    }

    // 收集连续 bullet block（含中间空行）
    const block: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (BULLET_RE.test(current)) {
        block.push(current);
        i++;
      } else if (current.trim() === "") {
        const nextNonBlank = lines.slice(i + 1).find((l) => l.trim() !== "");
        if (nextNonBlank && BULLET_RE.test(nextNonBlank)) {
          block.push(current);
          i++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const bulletLines = block.filter((b) => BULLET_RE.test(b));

    // 判断是否为"分析性 bullet"：长度 > 30 字符即为分析句，非专有名词列表
    const isAnalytical =
      bulletLines.length >= 3 &&
      bulletLines.every((b) => {
        const text = b
          .replace(BULLET_RE, "")
          .replace(/\*{1,2}/g, "")
          .trim();
        return text.length > 30;
      });

    if (isAnalytical) {
      // 转为段落：去掉 bullet marker，条目间插入空行
      for (let j = 0; j < block.length; j++) {
        const b = block[j];
        if (BULLET_RE.test(b)) {
          if (
            j > 0 &&
            result.length > 0 &&
            result[result.length - 1].trim() !== ""
          ) {
            result.push("");
          }
          result.push(b.replace(BULLET_RE, ""));
        } else {
          result.push(b);
        }
      }
    } else {
      result.push(...block);
    }
  }

  return result.join("\n");
}

/**
 * 清理章节开头的短句罗列块（无 bullet marker 的独行短句）
 *
 * GPT 有时将 Leader 分配的 keyPoints 逐条单独输出为短段落（无 `-`/`*` 前缀），
 * 形成：
 *   多智能体通信开销随规模急增。[5]
 *
 *   高并发下实时性常先于智能失效。[5][10]
 *
 *   弱网络会放大协同失误与任务失败。[5]
 *
 * 特征：出现在章节开头，连续 2+ 段，每段去掉引用后 ≤ 30 汉字。
 * 处理：直接删除此类"伪摘要"块，不保留。
 */
export function stripSectionOpeningShortLines(content: string): string {
  /**
   * ★ v2 重写：修复两个 bug
   * Bug1: 遇到 `#` 标题直接 break → 标题后面的短引用行检测不到
   * Bug2: 按 \n{2,} 分段 → 单换行分隔的短行被算作一个"段落"，
   *       textOnly 长度是多行合并，满足 ≤60 chars，但 stripUntil 只加 1，
   *       永远不满足 stripUntil >= 2 的条件
   *
   * 新逻辑：按 \n 逐行检测
   * 1. 跳过开头的标题行和空行（保留，不删除）
   * 2. 从第一个内容行开始，连续检测短引用行
   * 3. 连续 ≥2 行 → 全部删除，保留标题和后续正文
   */
  const SHORT_CHAR_MAX = 60;
  const MIN_STRIP_COUNT = 2;
  const MAX_CHECK = 10;

  const lines = content.split("\n");

  // 1. 找到第一个非标题、非空的内容行位置
  let contentStart = 0;
  while (contentStart < lines.length) {
    const l = lines[contentStart].trim();
    if (!l || l.startsWith("#")) {
      contentStart++;
    } else {
      break;
    }
  }

  // 2. 从 contentStart 开始，连续检测短引用行
  let shortEnd = contentStart; // 短行块结束位置（exclusive）
  let shortCount = 0;
  for (
    let i = contentStart;
    i < Math.min(lines.length, contentStart + MAX_CHECK);
    i++
  ) {
    const line = lines[i].trim();
    // 空行不中断计数（短行之间可能夹空行）
    if (!line) continue;
    // 遇到 bullet / blockquote / code 停止
    if (
      line.startsWith("-") ||
      line.startsWith("*") ||
      line.startsWith(">") ||
      line.startsWith("```")
    )
      break;

    const hasCitation = /\[\d+\]/.test(line);
    const textOnly = line.replace(/\[\d+\]/g, "").trim();

    if (
      hasCitation &&
      textOnly.length > 0 &&
      textOnly.length <= SHORT_CHAR_MAX
    ) {
      shortCount++;
      shortEnd = i + 1;
    } else {
      break;
    }
  }

  if (shortCount < MIN_STRIP_COUNT) return content;

  // 3. 保留标题行，跳过短引用块及其后的空行，拼接正文
  const headingLines = lines.slice(0, contentStart);
  let bodyStart = shortEnd;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
  const bodyLines = lines.slice(bodyStart);

  // 兜底：如果短引用块后面没有任何正文，说明整个章节只有短引用句——不删，保留原内容
  if (bodyLines.length === 0 || bodyLines.every((l) => !l.trim())) {
    return content;
  }

  return [...headingLines, ...bodyLines].join("\n").trimStart();
}

/**
 * 引用堆积拆分：单句 3+ 连续引用 → 保留前 2 个
 */
export function stripCitationStacking(content: string): string {
  return content.replace(/(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g, "$1");
}

/**
 * 营销话术替换为中性表述
 */
export function replaceMarketingLanguage(content: string): string {
  return content
    .replace(/(?:势必|必将|注定|必然)(?:引发|带来|改写|颠覆|重塑)/g, (m) =>
      m.replace(/势必|必将|注定|必然/, "可能"),
    )
    .replace(
      /(?:不可忽视|不容忽视|值得高度关注)的(?:机遇|趋势|方向|变革)/g,
      (m) => m.replace(/不可忽视|不容忽视|值得高度关注/, "值得关注"),
    );
}

/**
 * 修复 markdown 语法错误：**** 两对 bold 粘连。
 *
 * `**第一****内容**` 是 markdown 渲染错误，合并为一对 bold：`**第一，内容**`
 * 风格问题（如 **第一** 后缺逗号）由 prompt 引导 LLM 自行修正，不在后处理枚举。
 */
export function repairBrokenBoldPairs(content: string): string {
  // ****（两对 bold 粘连）是 markdown 语法错误，修复为一对 bold + 逗号
  return content.replace(/\*\*\*\*([^*\n])/g, "，$1");
}

/**
 * 修复 LLM 将过渡词误用为标题的问题。
 *
 * LLM 有时用 ### 一方面 / ### 另一方面 / ### 首先 等作为段落分隔标题，
 * 这些词是过渡连接词，不应作为章节标题渲染（会显示为紫色加粗标题）。
 * 统一降级为内联文本。
 */
export function normalizeTransitionHeadings(content: string): string {
  return content.replace(
    /^#{1,4}\s+\*{0,2}(一方面|另一方面|此外|首先|其次|再次|最后|然而|因此|总之|综上|不过|尽管|虽然|同时|接着|总结|小结)\*{0,2}[，,：:。]?\s*$/gm,
    "\n$1",
  );
}

/**
 * 去除枚举标记和引导词的多余加粗。
 *
 * 原则：加粗只保留核心观点/核心论点。
 * 以下类型不应加粗：枚举标记、过渡连接词、逻辑引导词——它们是结构词，不是核心内容。
 */
export function normalizeBoldStyle(content: string): string {
  let result = content;

  // 1. 序数枚举标记去掉 bold：**第一，** / **其一，** → 第一，
  result = result.replace(
    /\*\*(第[一二三四五六七八九十]|其[一二三四五六七八九十])[，,]?\*\*/g,
    (_, marker) => marker + "，",
  );

  // 2. 枚举连接词去掉 bold：**一是** / **二是** / **一方面** / **另一方面**
  result = result.replace(
    /\*\*([一二三四五六七八九十][是][，,：:]?|一方面[，,：:]?|另一方面[，,：:]?)\*\*/g,
    (_, marker) => marker,
  );

  // 3. 逻辑过渡词去掉 bold：**首先** / **其次** / **再次** / **最后** / **此外** / **另外** / **同时**
  result = result.replace(
    /\*\*(首先|其次|再次|最后|此外|另外|同时)[，,：:]?\*\*/g,
    (_, marker) => marker,
  );

  // 4. 正文引导词去掉加粗（语气词，不是核心术语）
  result = result.replace(
    /\*\*(这意味着|核心原因在于|值得警惕的是|值得注意的是|更关键的是|换言之|具体而言|总体而言|简言之)[，,：:]\*\*/g,
    (_, phrase) => phrase + "，",
  );

  // 5. 段落开头导语句去掉加粗：**[图表/总结引导语]**[：:] → 去掉加粗保留文字
  //    例：**图1所示的工作流程正体现了这一点**：... → 图1所示的工作流程正体现了这一点：...
  //    例：**综合现有证据，可以得出一个较明确的判断**：... → 综合...：...
  //    条件：行首加粗，加粗文本8-80字，紧跟中/英冒号
  result = result.replace(
    /^(\*\*)([^*\n]{8,80})(\*\*)([：:])/gm,
    (_, _open, text, _close, colon) => `${text}${colon}`,
  );

  return result;
}

/**
 * 将"其一/其二/其三"或"第一/第二/第三"开头的 bullet 列表转换为段落。
 *
 * 这类 bullet 是分析性枚举，不是真正的并列名词项，应写成段落行文。
 * 与 convertLongListItemsToParagraphs 区别：此函数基于语义（序数词开头），
 * 不依赖字数，能捕捉短句序数枚举。
 *
 * 处理规则：
 * 1. 检测连续 bullet 中有 ≥2 条以序数词开头
 * 2. 将该 bullet 块整体转为段落（去掉 `-` 前缀，条目间空行分隔）
 */
export function convertOrdinalBulletsToParagraphs(content: string): string {
  const BULLET_RE = /^\s*[-*]\s+/;
  const ORDINAL_RE =
    /^(其[一二三四五六七八九十]|第[一二三四五六七八九十])[，,、]/;

  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!BULLET_RE.test(line)) {
      result.push(line);
      i++;
      continue;
    }

    // 收集连续 bullet block（允许空行间隔）
    const block: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (BULLET_RE.test(cur)) {
        block.push(cur);
        i++;
      } else if (cur.trim() === "") {
        const nextNonBlank = lines.slice(i + 1).find((l) => l.trim() !== "");
        if (nextNonBlank && BULLET_RE.test(nextNonBlank)) {
          block.push(cur);
          i++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const bulletLines = block.filter((b) => BULLET_RE.test(b));
    const ordinalCount = bulletLines.filter((b) =>
      ORDINAL_RE.test(b.replace(BULLET_RE, "")),
    ).length;

    if (ordinalCount >= 2) {
      // 转段落：去掉 bullet marker，条目间插入空行
      for (let j = 0; j < block.length; j++) {
        const b = block[j];
        if (BULLET_RE.test(b)) {
          if (result.length > 0 && result[result.length - 1].trim() !== "") {
            result.push("");
          }
          result.push(b.replace(BULLET_RE, ""));
        } else {
          result.push(b);
        }
      }
    } else {
      result.push(...block);
    }
  }

  return result.join("\n");
}

/**
 * 修复序数词在 ** 外面的错误加粗位置。
 *
 * LLM 有时生成 `- 第一**类是底层基础设施**` 这类错误格式，
 * 序数词游离在加粗标记外面。将其修复为 `- **第一类**是底层基础设施`。
 *
 * 匹配模式：列表行中，中文序数词 + ** + 内容 + **
 */
export function fixOrdinalBoldPosition(content: string): string {
  return content.replace(
    /([-•]\s*)(第[一二三四五六七八九十百\d]+)\*\*([^*\n]+)\*\*/g,
    "$1**$2$3**",
  );
}

/**
 * 将超长列表项（>120字）转为段落。
 *
 * 列表项超过 120 字通常意味着内容应以段落形式呈现，而非 bullet。
 * 转换时在前方插入空行，保持段落间距。
 */
export function convertLongListItemsToParagraphs(content: string): string {
  const LONG_LIST_ITEM_THRESHOLD = 120;
  const BULLET_RE = /^([-*])\s+/;
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BULLET_RE.test(line)) {
      const text = line.replace(BULLET_RE, "");
      if (text.length > LONG_LIST_ITEM_THRESHOLD) {
        // 前面加空行（如果不是第一行且上一行非空）
        if (result.length > 0 && result[result.length - 1].trim() !== "") {
          result.push("");
        }
        result.push(text);
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

/**
 * 清理正文中的孤儿引用：引用编号 [N] 不在参考文献列表范围内则删除。
 */
export function removeOrphanCitations(
  content: string,
  maxCitationIndex: number,
): string {
  if (maxCitationIndex <= 0) return content;
  return content.replace(/\[(\d+)\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    return num > maxCitationIndex ? "" : match;
  });
}
