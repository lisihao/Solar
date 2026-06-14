#!/usr/bin/env node
/**
 * Build-time asset copier — fallback for nest-cli asset glob misses.
 *
 * 背景：Railway 部署在 2026-04-30 报 `Duty file not found:
 * /app/dist/modules/ai-app/agent-playground/agents/leader/duties/plan.md`，
 * 即便 nest-cli.json 已声明 `**\/duties/*.md` 为 asset glob。本地 `nest build`
 * 复制成功，Railway Docker build 缺失 — 怀疑 nest-cli watchAssets / glob
 * 在 Railway clean build context 下表现不一致。
 *
 * 这个脚本作为 build 末尾的兜底：把所有应进 dist 的非 .ts 资源（duty md /
 * skill md / strategies md / presets json / soul md）按相对路径镜像到 dist。
 *
 * 幂等：已存在的目标文件比较 mtime，相同则跳过。
 */
const fs = require("fs");
const path = require("path");

// ★ 2026-06-07：scripts-reorg 把本脚本从 scripts/ 移到 scripts/devops/，深度 +1，
//   原 `__dirname/..`（= scripts/）算出 ROOT 错成 /app/scripts → dist 找不到 → 部署
//   构建必挂。须上溯两级到 backend 根（/app）。
const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const PATTERNS = [
  /\/duties\/[^/]+\.md$/, // duty markdown
  /\/[^/]+\.skill\.md$/, // skill md
  /\/SKILL\.md$/, // top-level SKILL.md
  /\/strategies\/[^/]+\.md$/, // strategy md
  /\/presets\/[^/]+\.json$/, // preset json
  /\/soul\.md$/, // agent soul
  /\/common\/seed\/data\/[^/]+\.json$/, // SeedSyncService data files
  /\/email\/templates\/[^/]+\.hbs$/, // FU2-B: Handlebars 邮件模板
];

let copied = 0;
let skipped = 0;

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

if (!fs.existsSync(DIST)) {
  console.error(
    `[copy-build-assets] dist not found at ${DIST}; nest build might have failed.`,
  );
  process.exit(1);
}

walk(SRC, (file) => {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  if (!PATTERNS.some((p) => p.test("/" + rel))) return;
  const target = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let needCopy = true;
  if (fs.existsSync(target)) {
    const sStat = fs.statSync(file);
    const tStat = fs.statSync(target);
    if (tStat.mtimeMs >= sStat.mtimeMs && tStat.size === sStat.size) {
      needCopy = false;
    }
  }
  if (needCopy) {
    fs.copyFileSync(file, target);
    copied++;
  } else {
    skipped++;
  }
});

console.log(
  `[copy-build-assets] copied=${copied} skipped=${skipped} (src=${SRC}, dist=${DIST})`,
);
