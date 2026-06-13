/* eslint-disable */
const path = require("path");
const data = require(
  path.join(__dirname, "../../coverage/coverage-summary.json"),
);

const target = process.argv[2] || "agent-playground";
const rows = [];
for (const [filepath, fileData] of Object.entries(data)) {
  if (filepath === "total") continue;
  const norm = filepath.split(path.sep).join("/");
  const m = norm.match(/modules\/ai-app\/([^/]+)\/(.*)/);
  if (!m || m[1] !== target) continue;
  const total = fileData.statements.total;
  const covered = fileData.statements.covered;
  const uncovered = total - covered;
  rows.push({
    file: m[2],
    total,
    covered,
    uncovered,
    pct: total === 0 ? 0 : (100 * covered) / total,
  });
}
rows.sort((a, b) => b.uncovered - a.uncovered);
console.log(`Top uncovered files in ${target}:`);
console.log("file | total | uncov | pct");
for (const r of rows.slice(0, 30)) {
  console.log(`${r.file} | ${r.total} | ${r.uncovered} | ${r.pct.toFixed(0)}%`);
}
const totUncov = rows.reduce((a, b) => a + b.uncovered, 0);
const totTot = rows.reduce((a, b) => a + b.total, 0);
console.log(
  `\nTotal: ${rows.length} files, uncovered ${totUncov}/${totTot} (${((100 * totUncov) / totTot).toFixed(1)}%)`,
);
