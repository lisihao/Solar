/**
 * 版本对比Diff工具
 * 用于比较文档版本之间的差异
 */

export type DiffType = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface DiffChange {
  type: DiffType;
  section: string; // slide ID or chapter ID
  sectionTitle: string; // 显示标题
  oldContent?: string;
  newContent?: string;
  changes: Array<{
    type: 'text' | 'structure' | 'metadata';
    description: string;
    oldValue?: string;
    newValue?: string;
  }>;
}

export interface VersionComparison {
  oldVersion: {
    id: string;
    timestamp: Date;
    title: string;
  };
  newVersion: {
    id: string;
    timestamp: Date;
    title: string;
  };
  changes: DiffChange[];
  stats: {
    added: number;
    modified: number;
    deleted: number;
    unchanged: number;
  };
  summary: string;
}

/**
 * 比较两个版本的PPT内容
 */
export function comparePPTVersions(
  oldContent: string,
  newContent: string,
  oldVersionMeta: { id: string; timestamp: Date; title: string },
  newVersionMeta: { id: string; timestamp: Date; title: string }
): VersionComparison {
  // 解析PPT slides
  const oldSlides = parsePPTSlides(oldContent);
  const newSlides = parsePPTSlides(newContent);

  const changes: DiffChange[] = [];
  const stats = {
    added: 0,
    modified: 0,
    deleted: 0,
    unchanged: 0,
  };

  // 创建slide映射（基于标题）
  const oldSlideMap = new Map(oldSlides.map((s) => [s.title, s]));
  const newSlideMap = new Map(newSlides.map((s) => [s.title, s]));

  // 检查新增和修改的slides
  newSlides.forEach((newSlide, index) => {
    const oldSlide = oldSlideMap.get(newSlide.title);

    if (!oldSlide) {
      // 新增的slide
      changes.push({
        type: 'added',
        section: `slide-${index + 1}`,
        sectionTitle: newSlide.title,
        newContent: newSlide.content,
        changes: [
          {
            type: 'structure',
            description: '新增幻灯片',
            newValue: newSlide.title,
          },
        ],
      });
      stats.added++;
    } else {
      // 比较内容
      const slideChanges = compareSlideContent(
        oldSlide.content,
        newSlide.content
      );

      if (slideChanges.length > 0) {
        changes.push({
          type: 'modified',
          section: `slide-${index + 1}`,
          sectionTitle: newSlide.title,
          oldContent: oldSlide.content,
          newContent: newSlide.content,
          changes: slideChanges,
        });
        stats.modified++;
      } else {
        stats.unchanged++;
      }
    }
  });

  // 检查删除的slides
  oldSlides.forEach((oldSlide, index) => {
    if (!newSlideMap.has(oldSlide.title)) {
      changes.push({
        type: 'deleted',
        section: `slide-${index + 1}`,
        sectionTitle: oldSlide.title,
        oldContent: oldSlide.content,
        changes: [
          {
            type: 'structure',
            description: '删除幻灯片',
            oldValue: oldSlide.title,
          },
        ],
      });
      stats.deleted++;
    }
  });

  // 生成摘要
  const summary = generateDiffSummary(stats);

  return {
    oldVersion: oldVersionMeta,
    newVersion: newVersionMeta,
    changes,
    stats,
    summary,
  };
}

/**
 * 比较两个版本的文档内容
 */
export function compareDocVersions(
  oldContent: string,
  newContent: string,
  oldVersionMeta: { id: string; timestamp: Date; title: string },
  newVersionMeta: { id: string; timestamp: Date; title: string }
): VersionComparison {
  // 解析文档章节
  const oldChapters = parseDocChapters(oldContent);
  const newChapters = parseDocChapters(newContent);

  const changes: DiffChange[] = [];
  const stats = {
    added: 0,
    modified: 0,
    deleted: 0,
    unchanged: 0,
  };

  // 创建章节映射
  const oldChapterMap = new Map(oldChapters.map((c) => [c.title, c]));
  const newChapterMap = new Map(newChapters.map((c) => [c.title, c]));

  // 检查新增和修改的章节
  newChapters.forEach((newChapter, index) => {
    const oldChapter = oldChapterMap.get(newChapter.title);

    if (!oldChapter) {
      changes.push({
        type: 'added',
        section: `chapter-${index + 1}`,
        sectionTitle: newChapter.title,
        newContent: newChapter.content,
        changes: [
          {
            type: 'structure',
            description: '新增章节',
            newValue: newChapter.title,
          },
        ],
      });
      stats.added++;
    } else {
      const chapterChanges = compareTextContent(
        oldChapter.content,
        newChapter.content
      );

      if (chapterChanges.length > 0) {
        changes.push({
          type: 'modified',
          section: `chapter-${index + 1}`,
          sectionTitle: newChapter.title,
          oldContent: oldChapter.content,
          newContent: newChapter.content,
          changes: chapterChanges,
        });
        stats.modified++;
      } else {
        stats.unchanged++;
      }
    }
  });

  // 检查删除的章节
  oldChapters.forEach((oldChapter, index) => {
    if (!newChapterMap.has(oldChapter.title)) {
      changes.push({
        type: 'deleted',
        section: `chapter-${index + 1}`,
        sectionTitle: oldChapter.title,
        oldContent: oldChapter.content,
        changes: [
          {
            type: 'structure',
            description: '删除章节',
            oldValue: oldChapter.title,
          },
        ],
      });
      stats.deleted++;
    }
  });

  const summary = generateDiffSummary(stats);

  return {
    oldVersion: oldVersionMeta,
    newVersion: newVersionMeta,
    changes,
    stats,
    summary,
  };
}

/**
 * 解析PPT slides
 */
function parsePPTSlides(
  content: string
): Array<{ title: string; content: string }> {
  const slides: Array<{ title: string; content: string }> = [];

  // 按 --- 分割slides
  const slideParts = content.split(/\n---\n/);

  slideParts.forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;

    // 提取标题（## 第X页：标题）
    const titleMatch = trimmed.match(/^##\s+第?\d*页?[：:]\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '未命名';

    slides.push({
      title,
      content: trimmed,
    });
  });

  return slides;
}

/**
 * 解析文档章节
 */
function parseDocChapters(
  content: string
): Array<{ title: string; content: string }> {
  const chapters: Array<{ title: string; content: string }> = [];

  // 按 ## 分割章节
  const parts = content.split(/\n(?=##\s)/);

  parts.forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const titleMatch = trimmed.match(/^##\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '未命名';

    chapters.push({
      title,
      content: trimmed,
    });
  });

  return chapters;
}

/**
 * 比较slide内容
 */
function compareSlideContent(oldContent: string, newContent: string) {
  const changes: Array<{
    type: 'text' | 'structure' | 'metadata';
    description: string;
    oldValue?: string;
    newValue?: string;
  }> = [];

  // 简单的行级对比
  const oldLines = oldContent.split('\n').filter((l) => l.trim());
  const newLines = newContent.split('\n').filter((l) => l.trim());

  // 检查可视化标记变化
  const oldVisuals = extractVisualMarkers(oldContent);
  const newVisuals = extractVisualMarkers(newContent);

  if (oldVisuals !== newVisuals) {
    changes.push({
      type: 'metadata',
      description: '可视化类型变更',
      oldValue: oldVisuals || '无',
      newValue: newVisuals || '无',
    });
  }

  // 检查内容长度变化
  if (Math.abs(oldLines.length - newLines.length) > 2) {
    changes.push({
      type: 'structure',
      description: '内容结构调整',
      oldValue: `${oldLines.length}行`,
      newValue: `${newLines.length}行`,
    });
  }

  // 检查关键内容变化
  const oldText = oldContent.replace(/<!--.*?-->/g, '').trim();
  const newText = newContent.replace(/<!--.*?-->/g, '').trim();

  if (oldText !== newText) {
    const similarity = calculateSimilarity(oldText, newText);
    if (similarity < 0.8) {
      changes.push({
        type: 'text',
        description: '内容大幅修改',
        oldValue: oldText.substring(0, 100) + '...',
        newValue: newText.substring(0, 100) + '...',
      });
    } else if (similarity < 1.0) {
      changes.push({
        type: 'text',
        description: '内容微调',
      });
    }
  }

  return changes;
}

/**
 * 比较文本内容
 */
function compareTextContent(oldContent: string, newContent: string) {
  const changes: Array<{
    type: 'text' | 'structure' | 'metadata';
    description: string;
    oldValue?: string;
    newValue?: string;
  }> = [];

  const oldText = oldContent.trim();
  const newText = newContent.trim();

  if (oldText !== newText) {
    const similarity = calculateSimilarity(oldText, newText);

    if (similarity < 0.5) {
      changes.push({
        type: 'text',
        description: '内容重写',
        oldValue: `${oldText.length}字符`,
        newValue: `${newText.length}字符`,
      });
    } else if (similarity < 0.9) {
      changes.push({
        type: 'text',
        description: '内容修改',
      });
    } else {
      changes.push({
        type: 'text',
        description: '内容微调',
      });
    }
  }

  return changes;
}

/**
 * 提取可视化标记
 */
function extractVisualMarkers(content: string): string | null {
  const match = content.match(/<!--\s*(FLOW|CHART:\w+|MATRIX)\s*-->/);
  return match ? match[1] : null;
}

/**
 * 计算文本相似度（简单版）
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (text1 === text2) return 1.0;
  if (!text1 || !text2) return 0.0;

  const longer = text1.length > text2.length ? text1 : text2;
  const shorter = text1.length > text2.length ? text2 : text1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(text1, text2);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein距离算法
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * 生成diff摘要
 */
function generateDiffSummary(stats: {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}): string {
  const parts: string[] = [];

  if (stats.added > 0) parts.push(`新增${stats.added}项`);
  if (stats.modified > 0) parts.push(`修改${stats.modified}项`);
  if (stats.deleted > 0) parts.push(`删除${stats.deleted}项`);
  if (stats.unchanged > 0) parts.push(`${stats.unchanged}项未变`);

  return parts.join(', ') || '无变化';
}

/**
 * 获取diff类型的颜色类名
 */
export function getDiffColor(type: DiffType): string {
  const colors = {
    added: 'bg-green-50 border-l-4 border-green-500 text-green-900',
    modified: 'bg-yellow-50 border-l-4 border-yellow-500 text-yellow-900',
    deleted: 'bg-red-50 border-l-4 border-red-500 text-red-900',
    unchanged: 'bg-gray-50 border-l-4 border-gray-300 text-gray-700',
  };
  return colors[type];
}

/**
 * 获取diff类型的图标
 */
export function getDiffIcon(type: DiffType): string {
  const icons = {
    added: '➕',
    modified: '✏️',
    deleted: '➖',
    unchanged: '✓',
  };
  return icons[type];
}
