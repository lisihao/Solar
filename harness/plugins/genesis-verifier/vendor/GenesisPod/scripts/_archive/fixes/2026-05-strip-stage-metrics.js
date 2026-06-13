#!/usr/bin/env node
/**
 * Strip `await deps.emit({ type: "agent-playground.stage:metrics", ... })[.catch(...)]?;`
 * blocks from stage files. Uses character-level brace/paren depth tracking to find
 * exact block boundaries (anchored on the await/deps token before the type marker).
 *
 * Usage: node strip-stage-metrics.js <file>...
 */
const fs = require('fs');

const MARKER = '"agent-playground.stage:metrics"';

function findEmitStart(text, markerIdx) {
  // Walk backwards from markerIdx to find `await deps` or just `deps.emit(`
  // The opening token is one of:
  //   - `await deps\n  .emit({` (multi-line)
  //   - `await deps.emit({`     (single-line)
  // We anchor on the opening `(` of the .emit call, then find the `await` (or
  // start of statement) before it. We require the marker to be inside the `(...)`.
  // Strategy: walk backwards, count `(` and `)`. Find the unmatched `(` immediately
  // before the marker — that's the .emit( opener. Then walk back to find `await`
  // or beginning of line/statement.
  let depth = 0;
  let i = markerIdx;
  while (i >= 0) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        // Found the opening paren of .emit(
        // Walk back over `.emit` and any whitespace to find `deps`
        // Then back to start of statement (`await` or line start)
        // Find start of statement: scan back to a `;` or `{` or beginning of file.
        let j = i - 1;
        while (j >= 0 && /[\s.]/.test(text[j])) j--;
        // j is now at last char of `deps` (likely `s`)
        // continue back to find `await` (preceded by space) or start of line
        // Conservative: scan to nearest `\n` then forward over leading whitespace
        let lineStart = text.lastIndexOf('\n', i) + 1;
        // From lineStart, the line should look like:
        //   `    await deps` (multi-line) → start = lineStart
        //   `    await deps.emit({` (single-line) → start = lineStart
        // But if there's another statement on same line we'd be wrong. Stage files
        // don't do that; assume start = lineStart.
        return lineStart;
      } else {
        depth--;
      }
    }
    i--;
  }
  return -1;
}

function findEmitEnd(text, markerIdx) {
  // Walk forwards from markerIdx, tracking `(` and `)` depth (we're already inside
  // the `.emit(` so depth starts at 1). When depth returns to 0, we've passed `)`.
  // After that: skip optional `.catch(...)`, then mandatory `;`.
  let depth = 1; // already inside .emit(
  let i = markerIdx;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    i++;
  }
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++;
  // Optional .catch(...)
  if (text.slice(i, i + 6) === '.catch') {
    i += 6;
    while (i < text.length && /\s/.test(text[i])) i++;
    // Expect `(`
    if (text[i] === '(') {
      let cdepth = 1;
      i++;
      while (i < text.length && cdepth > 0) {
        const ch = text[i];
        if (ch === '(') cdepth++;
        else if (ch === ')') cdepth--;
        i++;
      }
    }
  }
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++;
  // Expect `;`
  if (text[i] === ';') i++;
  // Skip trailing newline + leading whitespace on next line (so we don't leave blank line)
  if (text[i] === '\n') i++;
  return i;
}

function stripFile(text) {
  let out = text;
  while (true) {
    const idx = out.indexOf(MARKER);
    if (idx === -1) break;
    const start = findEmitStart(out, idx);
    const end = findEmitEnd(out, idx + MARKER.length);
    if (start === -1 || end === -1 || end <= start) {
      console.error(
        `[skip] could not find boundaries for marker at ${idx} (start=${start}, end=${end})`,
      );
      // Replace just the marker so we don't loop forever
      out = out.slice(0, idx) + 'STRIP_FAILED' + out.slice(idx + MARKER.length);
      continue;
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

const files = process.argv.slice(2);
let totalRemoved = 0;
for (const f of files) {
  const before = fs.readFileSync(f, 'utf8');
  const after = stripFile(before);
  const diff = before.length - after.length;
  if (diff > 0) {
    fs.writeFileSync(f, after);
    console.log(`${f}: -${diff} chars`);
    totalRemoved += diff;
  } else if (after !== before) {
    fs.writeFileSync(f, after); // STRIP_FAILED markers
    console.log(`${f}: WARN — strip failed (markers replaced with STRIP_FAILED)`);
  }
}
console.log(`Total removed: ${totalRemoved} chars`);
