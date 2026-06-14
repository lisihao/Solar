/**
 * Strip bullet markers from prose incorrectly formatted as list items.
 *
 * Strategy: structural analysis of bullet blocks, NOT keyword enumeration.
 *
 * Rules (applied to each consecutive bullet block):
 * 1. Single bullet → always strip (a single item is never a "list")
 * 2. 2-item block with ANY item >50 chars → strip (long sentence = prose)
 * 3. 3+ item block with ALL items >60 chars → strip (all long = prose paragraphs)
 * 4. ANY bullet has ordinal/transition marker → strip entire block
 * 5. Otherwise → keep (genuine short list)
 *
 * Handles both regular (`- text`) and indented (`  - text`) bullets.
 * Shared by chapter view and continuous view.
 */

/** Matches any bullet line — regular or indented */
const BULLET_RE = /^\s*[-*]\s+/;

export function stripProseBullets(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  // Ordinal / transition patterns (broad coverage)
  const ordinalPattern =
    /^\s*[-*]\s+\*{0,2}(?:其[一二三四五六七八九十]|第[一二三四五六七八九十百]|[一二三四五六七八九十][，,、是]|一方面|另一方面|首先|其次|再次|最后|此外|然而|因此|总之|综上|总体而言|整体来看|推论\d|结论\d|启示|但[是此]|不过|尽管|虽然)/;

  // Prose-start patterns: clearly not list items
  const proseStartPattern =
    /^\s*[-*]\s+\*{0,2}(?:对[^，,]{1,8}[来而](?:说|言)|这[一些种项意]|从[^，,]{1,8}(?:角度|层面|来看|来说|而言)|综[上合]|整体|总[的之体]|值得|需要|通过|上述|以上|换[言句]|也就是|简[而言]|具体|事实上)/;

  /** Get text length after stripping bullet marker and bold markers */
  function textLen(bullet: string): number {
    return bullet.replace(BULLET_RE, '').replace(/\*{1,2}/g, '').length;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check if this is the start of a bullet block (regular or indented)
    if (BULLET_RE.test(line)) {
      // Collect the entire consecutive bullet block
      const block: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (BULLET_RE.test(current)) {
          block.push(current);
          i++;
        } else if (current.trim() === '') {
          // Blank line — include only if next non-blank line is also a bullet
          const nextNonBlank = lines.slice(i + 1).find((l) => l.trim() !== '');
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
      const count = bulletLines.length;

      // Rule 4: ANY bullet has ordinal/transition marker → strip entire block
      const hasOrdinal = block.some((b) => ordinalPattern.test(b));
      const hasProse = block.some((b) => proseStartPattern.test(b));

      // Rule 1: Single bullet → always strip
      const isSingle = count === 1;

      // Rule 2: 2-item block with ANY item >50 chars → strip
      const isTwoLong = count === 2 && bulletLines.some((b) => textLen(b) > 50);

      // Rule 3: 3+ items ALL >60 chars → strip (all long = prose paragraphs)
      const isAllLong = count >= 3 && bulletLines.every((b) => textLen(b) > 60);

      // Rule 5: Section summary — short bullet block right after a heading
      // Always strip for visual consistency (content is expanded in prose below)
      const prevContentLine = result
        .slice()
        .reverse()
        .find((l) => l.trim() !== '');
      const isSummaryBlock =
        prevContentLine !== undefined &&
        /^#{1,4}\s/.test(prevContentLine) &&
        count >= 3 &&
        bulletLines.every((b) => textLen(b) < 50);

      if (
        hasOrdinal ||
        hasProse ||
        isSingle ||
        isTwoLong ||
        isAllLong ||
        isSummaryBlock
      ) {
        // Strip bullet markers and insert blank lines between items
        // so markdown treats them as separate paragraphs (not merged text)
        for (let j = 0; j < block.length; j++) {
          const b = block[j];
          if (BULLET_RE.test(b)) {
            // Add blank line before this item if previous result line isn't blank
            if (
              j > 0 &&
              result.length > 0 &&
              result[result.length - 1].trim() !== ''
            ) {
              result.push('');
            }
            result.push(b.replace(BULLET_RE, ''));
          } else {
            result.push(b);
          }
        }
      } else {
        // Regular list — keep as-is
        result.push(...block);
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}
