export interface SectionLike {
  title: string;
  startOffset: number;
  endOffset: number;
  wordCount?: number;
  readingTimeMinutes?: number;
}

interface HeadingMatch {
  title: string;
  startOffset: number;
  bodyStartOffset: number;
}

export function normalizeSectionMarkdown(
  sectionTitle: string,
  markdown: string,
): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const canonicalHeading = `## ${sectionTitle}`;

  if (!normalized) {
    return `${canonicalHeading}\n\n`;
  }

  const lines = normalized.split("\n");
  const firstLine = lines[0]?.trim() ?? "";

  if (/^##\s+/.test(firstLine) && !/^###\s+/.test(firstLine)) {
    lines[0] = canonicalHeading;
    return `${lines.join("\n").trim()}\n`;
  }

  if (/^#{1,6}\s+/.test(firstLine)) {
    const withoutForeignHeading = lines.slice(1).join("\n").trim();
    return withoutForeignHeading
      ? `${canonicalHeading}\n\n${withoutForeignHeading}\n`
      : `${canonicalHeading}\n\n`;
  }

  return `${canonicalHeading}\n\n${normalized}\n`;
}

export function rebuildSectionLayout(
  sections: SectionLike[],
  fullMarkdown: string,
  language: "zh-CN" | "en-US",
): void {
  const normalized = fullMarkdown.replace(/\r\n/g, "\n");
  const headings = collectHeadings(normalized);
  let headingIdx = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const wantTitle = section.title.trim();
    const matchIdx = headings.findIndex(
      (heading, idx) => idx >= headingIdx && heading.title === wantTitle,
    );

    if (matchIdx < 0) {
      section.startOffset = -1;
      section.endOffset = -1;
      section.wordCount = 0;
      section.readingTimeMinutes = 0;
      continue;
    }

    const currentHeading = headings[matchIdx];
    const nextSection = sections[i + 1];
    let endOffset = normalized.length;

    if (nextSection) {
      const nextWantTitle = nextSection.title.trim();
      const nextIdx = headings.findIndex(
        (heading, idx) => idx > matchIdx && heading.title === nextWantTitle,
      );
      if (nextIdx >= 0) {
        endOffset = headings[nextIdx].startOffset;
      }
    }

    section.startOffset = currentHeading.startOffset;
    section.endOffset = endOffset;

    const bodyText = normalized.slice(
      currentHeading.bodyStartOffset,
      endOffset,
    );
    section.wordCount = countWords(bodyText, language);
    section.readingTimeMinutes = Math.max(
      1,
      Math.ceil(section.wordCount / (language === "zh-CN" ? 400 : 250)),
    );
    headingIdx = matchIdx + 1;
  }
}

export function extractSectionBodyMarkdown(
  fullMarkdown: string,
  section: Pick<SectionLike, "startOffset" | "endOffset">,
): string {
  if (
    section.startOffset < 0 ||
    section.endOffset <= section.startOffset ||
    section.startOffset >= fullMarkdown.length
  ) {
    return "";
  }

  const boundedEnd = Math.min(section.endOffset, fullMarkdown.length);
  const markdown = fullMarkdown.slice(section.startOffset, boundedEnd);
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^##\s+[^\n]+\n*/u, "")
    .trim();
}

export function extractSubstantiveSectionText(
  fullMarkdown: string,
  section: Pick<SectionLike, "startOffset" | "endOffset">,
): string {
  return extractSectionBodyMarkdown(fullMarkdown, section)
    .replace(/^#{1,6}\s+[^\n]+\n*/gmu, "")
    .replace(/^>\s*/gmu, "")
    .replace(/^\s*[-*•·—–]\s+/gmu, "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function collectHeadings(fullMarkdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let charOffset = 0;

  for (const line of fullMarkdown.split("\n")) {
    const lineWithNl = `${line}\n`;
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      headings.push({
        title: line.slice(3).trim(),
        startOffset: charOffset,
        bodyStartOffset: charOffset + lineWithNl.length,
      });
    }
    charOffset += lineWithNl.length;
  }

  return headings;
}

function countWords(text: string, language: "zh-CN" | "en-US"): number {
  if (language === "zh-CN") {
    return (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  }
  return (text.match(/\b[\w-]+\b/g) ?? []).length;
}
