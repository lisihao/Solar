/* eslint-disable */
const path = require("path");
const data = require(
  path.join(__dirname, "../../coverage/coverage-summary.json"),
);

const aiAppModules = [
  "agent-playground",
  "ask",
  "byok",
  "contracts",
  "explore",
  "feedback",
  "image",
  "library",
  "management",
  "office",
  "planning",
  "research",
  "simulation",
  "social",
  "teams",
  "topic-insights",
  "writing",
];

const stats = {};
for (const mod of aiAppModules) {
  stats[mod] = {
    files: 0,
    lines: { total: 0, covered: 0 },
    stmts: { total: 0, covered: 0 },
    fns: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
  };
}

for (const [filepath, fileData] of Object.entries(data)) {
  if (filepath === "total") continue;
  const norm = filepath.split(path.sep).join("/");
  const m = norm.match(/modules\/ai-app\/([^/]+)\//);
  if (!m) continue;
  const mod = m[1];
  if (!stats[mod]) continue;
  const s = stats[mod];
  s.files++;
  s.lines.total += fileData.lines.total;
  s.lines.covered += fileData.lines.covered;
  s.stmts.total += fileData.statements.total;
  s.stmts.covered += fileData.statements.covered;
  s.fns.total += fileData.functions.total;
  s.fns.covered += fileData.functions.covered;
  s.branches.total += fileData.branches.total;
  s.branches.covered += fileData.branches.covered;
}

const fmt = (cov, tot) =>
  tot === 0 ? "—" : `${((100 * cov) / tot).toFixed(1)}%`;
const rows = [];
for (const [mod, s] of Object.entries(stats)) {
  const stmtPct = s.stmts.total ? (100 * s.stmts.covered) / s.stmts.total : 0;
  rows.push({
    mod,
    files: s.files,
    line: fmt(s.lines.covered, s.lines.total),
    stmt: fmt(s.stmts.covered, s.stmts.total),
    fn: fmt(s.fns.covered, s.fns.total),
    br: fmt(s.branches.covered, s.branches.total),
    stmtCnt: `${s.stmts.covered}/${s.stmts.total}`,
    sortKey: stmtPct,
  });
}
rows.sort((a, b) => a.sortKey - b.sortKey);

console.log("| Module | Files | Stmts | Stmt% | Line% | Fn% | Branch% |");
console.log("|--------|-------|-------|-------|-------|-----|---------|");
for (const r of rows) {
  console.log(
    `| ${r.mod} | ${r.files} | ${r.stmtCnt} | ${r.stmt} | ${r.line} | ${r.fn} | ${r.br} |`,
  );
}

let totals = {
  files: 0,
  stmts: { total: 0, covered: 0 },
  lines: { total: 0, covered: 0 },
  fns: { total: 0, covered: 0 },
  branches: { total: 0, covered: 0 },
};
for (const s of Object.values(stats)) {
  totals.files += s.files;
  totals.stmts.total += s.stmts.total;
  totals.stmts.covered += s.stmts.covered;
  totals.lines.total += s.lines.total;
  totals.lines.covered += s.lines.covered;
  totals.fns.total += s.fns.total;
  totals.fns.covered += s.fns.covered;
  totals.branches.total += s.branches.total;
  totals.branches.covered += s.branches.covered;
}
console.log("");
console.log(
  `TOTAL ai-app: ${totals.files} files | stmt ${fmt(totals.stmts.covered, totals.stmts.total)} (${totals.stmts.covered}/${totals.stmts.total}) | line ${fmt(totals.lines.covered, totals.lines.total)} | fn ${fmt(totals.fns.covered, totals.fns.total)} | branch ${fmt(totals.branches.covered, totals.branches.total)}`,
);
