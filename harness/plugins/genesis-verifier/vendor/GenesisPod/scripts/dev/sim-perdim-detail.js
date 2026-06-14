/* 抽取 ddc90bfd 每个维度的所有 H3/H4 嵌套结构 + 1 个失败 mission 的逐行 H2-H4 序列 */
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
  return names.some((d) => {
    const n = d.toLowerCase().trim();
    if (!n) return false;
    if (t === n) return true;
    const p = n.slice(0, 8);
    return t.includes(p) || n.includes(t.slice(0, 8));
  });
};

function renumber(md, dimNames) {
  let dim = 0; let chap = 0;
  const lines = md.split('\n');
  let inFence = false; let underDim = false; let lastDim = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^(```|~~~)/.test(ln.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    let m = ln.match(/^(##\s+)(.+)$/);
    if (m) {
      const c = stripPfx(m[2]);
      if (isSupp(c)) { lines[i] = m[1] + c; underDim = false; lastDim = null; continue; }
      if (matchDim(c, dimNames)) { dim++; chap = 0; underDim = true; lastDim = c.toLowerCase().trim(); lines[i] = `${m[1]}${dim}. ${c}`; }
      else if (underDim && dim > 0) { chap++; lines[i] = `### ${dim}.${chap}. ${c}`; }
      else { lines[i] = m[1] + c; }
      continue;
    }
    m = ln.match(/^(###\s+)(.+)$/);
    if (m) {
      const c = stripPfx(m[2]);
      if (underDim && dim > 0) {
        if (lastDim && c.toLowerCase().trim() === lastDim) { lines[i] = ''; continue; }
        if (chap > 0) { lines[i] = `#### ${c}`; }
        else { chap++; lines[i] = `${m[1]}${dim}.${chap}. ${c}`; }
      } else { lines[i] = m[1] + c; }
      continue;
    }
    m = ln.match(/^(####\s+)(.+)$/);
    if (m) lines[i] = m[1] + stripPfx(m[2]);
  }
  return lines.join('\n');
}

async function dump(id, label) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT report_full->'content'->>'fullMarkdown' as md, report_full->'sections' as secs FROM agent_playground_missions WHERE id = '${id}'`,
  );
  const md = r[0].md;
  const dimNames = (r[0].secs || []).filter((s) => s.type === 'dimension').map((s) => s.title);
  const out = renumber(md, dimNames);
  console.log('\n============================================================');
  console.log(`${label}: ${id}`);
  console.log('============================================================');
  const headings = out.split('\n').filter((l) => /^#{2,4}\s+/.test(l));
  for (const h of headings) {
    if (/^##\s+/.test(h)) console.log(h.slice(0, 110));
    else if (/^###\s+/.test(h)) console.log('   ' + h.slice(0, 110));
    else if (/^####\s+/.test(h)) console.log('       ' + h.slice(0, 110));
  }
}

async function main() {
  await dump('ddc90bfd-e919-4896-b254-cc6091b93ad5', 'CLEAN PASS sample (10 dims, 60 chaps)');
  await dump('1520783d-75f6-41ac-82cc-2a541b454c20', 'LEGACY FAIL sample (data drift)');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
