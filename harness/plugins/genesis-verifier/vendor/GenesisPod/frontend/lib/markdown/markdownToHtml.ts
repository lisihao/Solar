import TurndownService from 'turndown';

// Initialize Turndown for HTML to Markdown conversion
export const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Process inline markdown (bold, italic, links, code)
export function processInlineMarkdown(text: string): string {
  return (
    text
      // Code (inline) - must come before bold/italic to preserve backticks
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold and italic combined
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Links [text](url)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )
  );
}

// Comprehensive markdown to HTML converter (for TipTap)
export function markdownToHtml(markdown: string): string {
  // First normalize and clean the markdown
  const normalized = markdown
    .replace(/\r\n/g, '\n') // Normalize Windows line endings
    // Fix accumulated backslashes before periods (from Turndown escaping round-trips)
    // Pattern: number followed by one or more \\ then period → number + period
    .replace(/(\d)\\+\./g, '$1.') // Remove all backslashes between digit and period
    .replace(/\\#/g, '#') // Remove escaped hash symbols (common from AI output)
    .replace(/\\-/g, '-') // Remove escaped dashes
    .replace(/\\\*/g, '*') // Remove escaped asterisks
    .replace(/\\\[/g, '[') // Remove escaped brackets
    .replace(/\\\]/g, ']')
    .replace(/\\\./g, '.') // Remove escaped periods
    .replace(/\n{3,}/g, '\n\n') // Collapse 3+ newlines to 2
    .trim();

  // Process line by line for better control
  const lines = normalized.split('\n');
  const processedLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;

  for (const line of lines) {
    const processed = line;

    // Headers (h1-h6) - must be at start of line
    const headerMatch = processed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      // Close any open list
      if (inList) {
        processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }
      processedLines.push(
        `<h${level}>${processInlineMarkdown(content)}</h${level}>`
      );
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(processed.trim()) || /^\*{3,}$/.test(processed.trim())) {
      if (inList) {
        processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }
      processedLines.push('<hr>');
      continue;
    }

    // Unordered list item
    const ulMatch = processed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      processedLines.push(`<li>${processInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = processed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      processedLines.push(`<li>${processInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    // Close list if we hit a non-list line
    if (inList && processed.trim()) {
      processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
      listType = null;
    }

    // Empty line
    if (!processed.trim()) {
      processedLines.push('');
      continue;
    }

    // Regular paragraph
    processedLines.push(`<p>${processInlineMarkdown(processed)}</p>`);
  }

  // Close any remaining list
  if (inList) {
    processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  // Join and clean up
  const html = processedLines
    .join('\n')
    .replace(/<\/p>\n<p>/g, '</p><p>') // Remove newlines between paragraphs
    .replace(/<p>\s*<\/p>/g, '') // Remove empty paragraphs
    .replace(/\n+/g, ''); // Remove remaining newlines

  return html || '<p></p>';
}
