#!/usr/bin/env tsx
/**
 * Scripts Structure Guard — backend/scripts 顶层整洁度看护
 *
 * 背景：backend/scripts 顶层曾堆积 23 个未归类脚本（backfill / 一次性诊断 /
 * mojibake 修复等），README 规范形同虚设。本看护把"顶层禁止散落文件"焊死，
 * 杜绝再次漂移。
 *
 * 规则：
 *   1. 顶层（backend/scripts/ 直属）只允许白名单文件，其余文件必须放进子目录分类。
 *   2. 子目录命名必须在已知类别内（防止随手新建 misc/ tmp/ 之类垃圾桶目录）。
 *
 * 新增脚本：放进对应子目录（见 README）。确属新类别 → 先改本看护的 ALLOWED_DIRS。
 *
 * 用法：
 *   npm run audit:scripts            # 看护：违规 exit 1
 *   tsx scripts/dev-tools/audit-scripts-structure.ts
 */

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SCRIPTS_ROOT = resolve(__dirname, "..");

// 顶层允许的文件（非目录）。其余一律要求归类到子目录。
const ALLOWED_TOP_FILES = new Set(["README.md"]);

// 顶层允许的子目录（业界标准类别词；新增类别需在此登记）。
const ALLOWED_DIRS = new Set([
  "_archive", // 历史/一次性脚本归档
  "ci", // CI 专用脚本
  "db", // 数据库种子/夹具
  "dev-tools", // 开发/审计工具
  "devops", // 构建/部署/容器入口
  "maintenance", // 数据与基础设施运维
  "thumbnails", // 缩略图生成
]);

interface Violation {
  kind: "loose-file" | "unknown-dir";
  name: string;
  hint: string;
}

function main() {
  const entries = readdirSync(SCRIPTS_ROOT);
  const violations: Violation[] = [];

  for (const name of entries) {
    const full = join(SCRIPTS_ROOT, name);
    const isDir = statSync(full).isDirectory();

    if (isDir) {
      if (!ALLOWED_DIRS.has(name)) {
        violations.push({
          kind: "unknown-dir",
          name: `${name}/`,
          hint: "未登记的类别目录——并入已有类别，或在 audit-scripts-structure.ts 的 ALLOWED_DIRS 登记",
        });
      }
      continue;
    }

    if (!ALLOWED_TOP_FILES.has(name)) {
      violations.push({
        kind: "loose-file",
        name,
        hint: "顶层禁止散落脚本——移入 dev-tools/devops/maintenance/db/_archive 等对应子目录",
      });
    }
  }

  if (violations.length === 0) {
    console.log(
      `[audit:scripts] backend/scripts 顶层整洁 ✓（仅 ${[...ALLOWED_TOP_FILES].join(", ")} + 已登记子目录）`,
    );
    return;
  }

  console.error("============================================================");
  console.error("  [audit:scripts] backend/scripts 顶层结构违规");
  console.error("============================================================");
  for (const v of violations) {
    console.error(`  ✘ ${v.name}`);
    console.error(`      → ${v.hint}`);
  }
  console.error("");
  console.error(
    "  分类规范见 backend/scripts/README.md。一次性/诊断脚本用完移入 _archive/。",
  );
  console.error("============================================================");
  process.exit(1);
}

main();
