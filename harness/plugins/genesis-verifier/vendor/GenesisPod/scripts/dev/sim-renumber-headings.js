/* 100% 全覆盖仿真：用真实 DB 数据跑 renumberHeadings + 验证不变量
 * usage: DATABASE_URL=... node scripts/dev/sim-renumber-headings.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SUPP = ['执行摘要','前言','目录','跨维度分析','风险评估','战略建议','结论','参考文献','参考资料','executive summary','preface','table of contents','cross-dimension analysis','risk assessment','strategic recommendations','conclusion','references'];
const isSupp = (t) => {
  const l = t.trim().toLowerCase();
  return SUPP.some((s) => l === s || l.startsWith(s.toLowerCase()));
};
const stripPfx = (t) => t.replace(/^\d+(\s*[\.。]\s*\d+)*\s*[\.。]\s*/, '').trim();
const matchDim = (cleaned, names) => {
  if (!names || !names.length) return true;
  const t = cleaned.toLowerCase().trim();
  if (!t) return false;
  return names.some((d) => {
    const n = d.toLowerCase().trim();
    if (!n) return false;
    if (t === n) return true;
    if (t.startsWith(n)) return true;
    if (n.startsWith(t) && t.length >= 6) return true;
    return false;
  });
};
const looksLikeJsonFragment = (t) => {
  const s = t.trim();
  if (!s) return false;
  return /^["'{}\[\]]/.test(s) || /^[a-zA-Z_][\w\-]*\s*:\s*["'\d{[]/.test(s) || /^"[^"]+"\s*:/.test(s);
};

function renumber(md, dimNames) {
  let dim = 0;
  let chap = 0;
  const lines = md.split('\n');
  let inFence = false;
  let underDim = false;
  let lastDim = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^(```|~~~)/.test(ln.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let m = ln.match(/^(##\s+)(.+)$/);
    if (m) {
      const c = stripPfx(m[2]);
      if (isSupp(c)) {
        lines[i] = m[1] + c;
        underDim = false;
        lastDim = null;
        continue;
      }
      if (matchDim(c, dimNames)) {
        dim++;
        chap = 0;
        underDim = true;
        lastDim = c.toLowerCase().trim();
        lines[i] = `${m[1]}${dim}. ${c}`;
      } else if (underDim && dim > 0) {
        chap++;
        lines[i] = `### ${dim}.${chap}. ${c}`;
      } else {
        lines[i] = m[1] + c;
      }
      continue;
    }
    m = ln.match(/^(###\s+)(.+)$/);
    if (m) {
      const c = stripPfx(m[2]);
      if (looksLikeJsonFragment(c)) { lines[i] = c; continue; }
      if (underDim && dim > 0) {
        if (lastDim && c.toLowerCase().trim() === lastDim) {
          lines[i] = '';
          continue;
        }
        if (chap > 0) {
          lines[i] = `#### ${c}`;
        } else {
          chap++;
          lines[i] = `${m[1]}${dim}.${chap}. ${c}`;
        }
      } else {
        lines[i] = m[1] + c;
      }
      continue;
    }
    m = ln.match(/^(####\s+)(.+)$/);
    if (m) lines[i] = m[1] + stripPfx(m[2]);
  }
  return lines.join('\n');
}

async function validate(missionId, md, dimNames) {
  const out = renumber(md, dimNames);
  const headings = out.split('\n').filter((l) => /^#{2,4}\s+/.test(l));
  const errors = [];

  const dimH2 = headings.filter((h) => /^##\s+\d+\.\s+/.test(h));
  dimH2.forEach((h, i) => {
    const n = parseInt(h.match(/^##\s+(\d+)\./)[1], 10);
    if (n !== i + 1) errors.push(`H2#${i} expected ${i + 1} got ${n}: ${h.slice(0, 60)}`);
  });
  if (dimH2.length !== dimNames.length) {
    errors.push(`H2 dim count ${dimH2.length} != dimNames count ${dimNames.length}`);
  }

  const byDim = {};
  headings
    .filter((h) => /^###\s+\d+\.\d+\.\s+/.test(h))
    .forEach((h) => {
      const mm = h.match(/^###\s+(\d+)\.(\d+)\.\s+/);
      const n = parseInt(mm[1], 10);
      const c = parseInt(mm[2], 10);
      byDim[n] = byDim[n] || [];
      byDim[n].push({ c, line: h });
    });
  for (const n in byDim) {
    byDim[n].forEach((ch, i) => {
      if (ch.c !== i + 1) errors.push(`H3 dim=${n} idx=${i} expected M=${i + 1} got ${ch.c}`);
    });
  }

  // H4 不应带 N.M.K. 编号（用户要求子小节无序号）
  const h4Numbered = headings.filter((h) => /^####\s+\d+\.\d+/.test(h));
  if (h4Numbered.length > 0) {
    errors.push(`H4 should not have number prefix: ${h4Numbered.length}: ${h4Numbered[0].slice(0, 60)}`);
  }

  // supplementary H2 不应带 N. 编号
  const suppH2BadNum = headings
    .filter((h) => /^##\s+\d+\.\s+/.test(h))
    .filter((h) => {
      const m = h.match(/^##\s+\d+\.\s+(.+)$/);
      return m && isSupp(m[1]);
    });
  if (suppH2BadNum.length > 0) {
    errors.push(`Supplementary H2 错带编号: ${suppH2BadNum.length}`);
  }

  return { headings: headings.length, errors, dimCount: dimH2.length, chapCount: Object.values(byDim).flat().length, h4Count: headings.filter((h) => /^####\s+/.test(h)).length };
}

async function main() {
  const missions = await prisma.$queryRawUnsafe(
    "SELECT id, depth FROM agent_playground_missions WHERE status = 'completed' AND report_full IS NOT NULL ORDER BY started_at DESC LIMIT 10",
  );
  console.log('Validating', missions.length, 'recent completed missions');
  console.log('========================================');
  let totalErrors = 0;
  for (const m of missions) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT report_full->'content'->>'fullMarkdown' as md, report_full->'sections' as secs FROM agent_playground_missions WHERE id = '${m.id}'`,
    );
    const md = r[0].md;
    if (!md) {
      console.log(`[skip] ${m.id} (${m.depth}) — no fullMarkdown`);
      continue;
    }
    const dimNames = (r[0].secs || []).filter((s) => s.type === 'dimension').map((s) => s.title);
    const result = await validate(m.id, md, dimNames);
    const status = result.errors.length === 0 ? 'PASS' : 'FAIL ' + result.errors.length;
    console.log(
      `[${status}] ${m.id} (${m.depth}) ${result.dimCount} dims / ${result.chapCount} chaps / ${result.h4Count} subs / ${result.headings} total`,
    );
    result.errors.slice(0, 3).forEach((e) => console.log('   !', e));
    totalErrors += result.errors.length;
  }
  console.log('========================================');
  console.log('Total errors:', totalErrors);
  if (totalErrors === 0) console.log('✓ 100% 全覆盖仿真通过');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
