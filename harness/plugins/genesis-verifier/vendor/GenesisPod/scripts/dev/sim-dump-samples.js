/* 抽取仿真样本：每个 mission 的 H2/H3/H4 列表，便于评审 */
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
  let dim = 0;
  let chap = 0;
  const lines = md.split('\n');
  let inFence = false;
  let underDim = false;
  let lastDim = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^(```|~~~)/.test(ln.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    let m = ln.match(/^(##\s+)(.+)$/);
    if (m) {
      const c = stripPfx(m[2]);
      if (isSupp(c)) {
        lines[i] = m[1] + c;
        underDim = false; lastDim = null;
        continue;
      }
      if (matchDim(c, dimNames)) {
        dim++; chap = 0; underDim = true;
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

async function main() {
  const targets = ['ddc90bfd-e919-4896-b254-cc6091b93ad5','c195035f-d6fd-4dae-a9a0-d5176048e4e6','1520783d-75f6-41ac-82cc-2a541b454c20','4940b78d-a4a1-4a70-985d-1a2eba4f578e'];
  for (const id of targets) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT report_full->'content'->>'fullMarkdown' as md, report_full->'sections' as secs FROM agent_playground_missions WHERE id = '${id}'`,
    );
    const md = r[0].md;
    const dimNames = (r[0].secs || []).filter((s) => s.type === 'dimension').map((s) => s.title);
    const out = renumber(md, dimNames);
    const headings = out.split('\n').filter((l) => /^#{2,4}\s+/.test(l));
    console.log('============================================================');
    console.log(`Mission: ${id}`);
    console.log(`dimNames (${dimNames.length}):`, dimNames);
    console.log(`H2 count: ${headings.filter((h) => /^##\s+/.test(h)).length}, H3: ${headings.filter((h) => /^###\s+/.test(h)).length}, H4: ${headings.filter((h) => /^####\s+/.test(h)).length}`);
    console.log('--- All H2 ---');
    headings.filter((h) => /^##\s+/.test(h)).forEach((h, i) => console.log(`  ${i+1}. ${h.slice(0, 100)}`));
    console.log('--- First 8 H3 (dim=1 + dim=2 head) ---');
    headings.filter((h) => /^###\s+/.test(h)).slice(0, 8).forEach((h) => console.log(`     ${h.slice(0, 100)}`));
    console.log('--- First 5 H4 ---');
    headings.filter((h) => /^####\s+/.test(h)).slice(0, 5).forEach((h) => console.log(`        ${h.slice(0, 100)}`));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
