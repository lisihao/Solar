/**
 * 模型「新旧」排序基元 —— discovery 层用它保证返回的 modelId 列表 newest-first。
 *
 * 背景（根因）：一键配置（auto-configure）的代际通配 pattern（`^gpt-[4-9]`、
 * `^grok-[2-9]`、`^gemini-\d`）假定 discovery 返回的 availableIds 已按"最新在前"
 * 排序，于是 firstMatch 命中第一个匹配项即"最新代"。但 provider 的 /v1/models
 * **不保证任何顺序**（OpenAI 返回带 `created` epoch 但顺序随机；Gemini 无 created；
 * 旧实现还按字母升序排，导致 gemini-1.5 排在 gemini-2.5 前面）。结果选到旧模型。
 *
 * 这里给出统一的"新旧"判定：
 *   1. 有 `created`（OpenAI epoch 秒）→ 直接按 created 降序，最权威。
 *   2. 无 created / created 相等 → 退回**版本号语义降序**（从 id 里抽第一段
 *      `major.minor` 数字，gpt-5.4 > gpt-4o；gemini-2.5 > gemini-1.5）。
 *   3. 版本也无法比较 → 按 id 字典序降序兜底（稳定、可预测，不返回旧的在前）。
 *
 * 注意：这里只决定**同一代际族内 / 跨代际谁更新**，不做能力/质量判断；
 * pattern 已经限定了"属于哪一族"，这里只回答"哪个更新"。
 */

export interface RecencySortable {
  id: string;
  /** provider 返回的创建时间（OpenAI /v1/models 的 epoch 秒）；缺省走版本号兜底 */
  created?: number;
}

/**
 * 从 modelId 里抽出第一段版本号 `[major, minor]`。
 * 例：
 *   gpt-5.4            → [5, 4]
 *   gpt-4o-2024-05     → [4, 0]（4o 的 o 不是数字，minor 记 0；日期段不当版本）
 *   gemini-2.5-pro     → [2, 5]
 *   grok-4             → [4, 0]
 *   claude-opus-4-1    → [4, 1]
 * 抽不到数字 → null（交给上层做字典序兜底）。
 */
function extractVersion(id: string): [number, number] | null {
  // 命中第一个 "数字[.数字]" 或 "数字-数字"（代际-小版本，如 claude-opus-4-1）。
  // 仅取紧跟在非数字边界后的版本段，避免把日期戳 2024 当主版本。
  const match = id
    .toLowerCase()
    .match(/(?:^|[a-z-])(\d{1,2})(?:[.-](\d{1,2}))?(?![\d])/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isFinite(major)) return null;
  return [major, minor];
}

/** 比较两个 modelId 谁更新；返回 >0 表示 b 更新（用于 sort 降序）。 */
export function compareRecencyDesc(
  a: RecencySortable,
  b: RecencySortable,
): number {
  // 1. created 优先（仅当两者都有且不相等）
  const aCreated = typeof a.created === "number" ? a.created : undefined;
  const bCreated = typeof b.created === "number" ? b.created : undefined;
  if (
    aCreated !== undefined &&
    bCreated !== undefined &&
    aCreated !== bCreated
  ) {
    return bCreated - aCreated;
  }

  // 2. 版本号语义降序
  const aVer = extractVersion(a.id);
  const bVer = extractVersion(b.id);
  if (aVer && bVer) {
    if (aVer[0] !== bVer[0]) return bVer[0] - aVer[0];
    if (aVer[1] !== bVer[1]) return bVer[1] - aVer[1];
  } else if (aVer && !bVer) {
    return -1; // 有版本号的视为更"具体/新"，排前
  } else if (!aVer && bVer) {
    return 1;
  }

  // 3. 字典序降序兜底（稳定、可预测）
  return b.id.toLowerCase().localeCompare(a.id.toLowerCase());
}

/**
 * 把 discovered models 按"最新在前"排序（不可变，返回新数组）。
 * discovery 各 provider 分支统一调用，保证 auto-configure 的 firstMatch 真正命中最新代。
 */
export function sortByRecencyDesc<T extends RecencySortable>(models: T[]): T[] {
  return [...models].sort(compareRecencyDesc);
}
