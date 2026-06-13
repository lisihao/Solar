/**
 * Mock implementation of marked for Jest tests
 *
 * marked is an ESM module that causes issues with Jest.
 * This mock provides a simple implementation that works in tests.
 */

function marked(markdown) {
  // Simple mock: just return the markdown as-is wrapped in a paragraph
  return `<p>${markdown}</p>`;
}

// Mock the parse method
marked.parse = function (markdown) {
  return `<p>${markdown}</p>`;
};

// Mock other commonly used methods
marked.parseInline = function (markdown) {
  return markdown;
};

marked.setOptions = function (_options) {
  return marked;
};

marked.use = function (_extension) {
  return marked;
};

/**
 * Mock lexer – returns a minimal token array parsed from the markdown string.
 * Supports: heading (#), paragraph, hr (---), unordered list (- item),
 * ordered list (1. item), code (```lang), blockquote (> text).
 * This is sufficient for unit tests that check section shapes.
 */
marked.lexer = function (markdown) {
  if (!markdown || typeof markdown !== "string") return [];
  const tokens = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        depth: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) {
      tokens.push({ type: "hr" });
      i++;
      continue;
    }

    // Code block
    const codeStart = line.match(/^```(\w*)$/);
    if (codeStart) {
      const lang = codeStart[1] || "";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      tokens.push({ type: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      tokens.push({ type: "blockquote", text: line.slice(2) });
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push({ text: lines[i].slice(2), items: [] });
        i++;
      }
      tokens.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\d+\.\s/, ""), items: [] });
        i++;
      }
      tokens.push({ type: "list", ordered: true, items });
      continue;
    }

    // Table (| col | col |)
    if (
      line.startsWith("|") &&
      lines[i + 1] &&
      /^\|[-|: ]+\|$/.test(lines[i + 1])
    ) {
      const headers = line
        .split("|")
        .filter((c) => c.trim())
        .map((c) => ({ text: c.trim() }));
      i += 2; // skip separator
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i]
          .split("|")
          .filter((c) => c.trim())
          .map((c) => ({ text: c.trim() }));
        rows.push(cells);
        i++;
      }
      tokens.push({ type: "table", header: headers, rows });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (default)
    tokens.push({ type: "paragraph", text: line.trim() });
    i++;
  }

  return tokens;
};

module.exports = { marked };
module.exports.marked = marked;
module.exports.default = marked;
