#!/usr/bin/env tsx
//
// Mission Detail Discipline Audit (蓝图 §9.5 / §9.6 守护)
//
// 扫描 frontend/app/<feature>/.../page.tsx，确保 mission 详情类页面：
//   M1 不再自写"页面级 mission shell"（headerHero + 左 panel 360 + tab strip）
//      → 必须 import MissionDetailFrame from '@/components/common/mission-detail'
//   M2 不再自写 fixed inset-0 modal 弹层（必须用 Modal / ModalShell / SideDrawer / DrawerShell）
//   M3 不再自写"阶段格子 grid"作 stage stepper（必须用 StageStepper）
//   M4 不再自写"页面级 tab strip"（必须用 canonical Tabs / MissionDetailFrame 自带）
//
// 与 audit-ui-discipline 互补：那个看全站 UI primitives 治理，本 audit 聚焦
// mission detail 页面族（playground / social / radar / writing / topic-insights /
// office mission 详情）。
//
// 用法：
//   tsx scripts/utils/audit-mission-detail-discipline.ts
//   tsx scripts/utils/audit-mission-detail-discipline.ts --update-baseline

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const FRONTEND_ROOT = join(process.cwd(), 'frontend');
const ARGS = new Set(process.argv.slice(2));
const UPDATE_BASELINE = ARGS.has('--update-baseline');
const STRICT = ARGS.has('--strict');

const BASELINE_PATH = (() => {
  const idx = process.argv.indexOf('--baseline');
  return idx > 0
    ? process.argv[idx + 1]
    : 'docs/_archive/mission-detail-discipline-baseline.json';
})();

/** 候选 mission detail 页面（feature mission 详情路由模式） */
const MISSION_DETAIL_PATH_PATTERNS = [
  /\/frontend\/app\/agent-playground\/team\/\[missionId\]\/page\.tsx$/,
  /\/frontend\/app\/ai-social\/[^/]+\/[^/]+\/page\.tsx$/,
  /\/frontend\/app\/ai-radar\/topic\/\[topicId\]\/runs\/\[runId\]\/page\.tsx$/,
  /\/frontend\/app\/ai-writing\/[^/]+\/page\.tsx$/,
  /\/frontend\/app\/ai-topic-insights\/[^/]+\/page\.tsx$/,
  /\/frontend\/app\/ai-office\/missions\/[^/]+\/page\.tsx$/,
];

interface Violation {
  rule: string;
  file: string;
  line: number;
  snippet: string;
}

const EXCLUDE_PATTERNS = [
  'node_modules',
  '.next',
  'components/common/mission-detail/', // canonical 自身
  'components/ui/', // primitives
  '__tests__',
  '.test.',
  '.spec.',
  '.stories.',
];

function shouldSkip(file: string): boolean {
  const norm = file.split(sep).join('/');
  return EXCLUDE_PATTERNS.some((p) => norm.includes(p));
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(tsx|jsx)$/.test(e.name)) continue;
    const parent = (e as unknown as { parentPath?: string }).parentPath ?? dir;
    const full = join(parent, e.name);
    if (shouldSkip(full)) continue;
    out.push(full);
  }
  return out;
}

function isMissionDetailPage(file: string): boolean {
  const norm = file.split(sep).join('/');
  return MISSION_DETAIL_PATH_PATTERNS.some((p) => p.test(norm));
}

function hasImport(src: string, symbol: string): boolean {
  const re = new RegExp(
    `import\\s+(?:[^;]*\\{[^}]*\\b${symbol}\\b[^}]*\\}|\\b${symbol}\\b)[^;]*from`,
    'm'
  );
  return re.test(src);
}

function findLine(src: string, marker: string | RegExp): number {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (
      typeof marker === 'string'
        ? lines[i].includes(marker)
        : marker.test(lines[i])
    ) {
      return i + 1;
    }
  }
  return 0;
}

function snippet(src: string, line: number): string {
  if (!line) return '';
  const l = src.split('\n')[line - 1] ?? '';
  return l.trim().slice(0, 120);
}

/**
 * M1: mission detail 页面必须 import MissionDetailFrame
 * （否则就是自写 header + left panel + tabs 那套 shell）
 */
function checkM1(file: string, src: string): Violation[] {
  if (!isMissionDetailPage(file)) return [];
  if (hasImport(src, 'MissionDetailFrame')) return [];
  return [
    {
      rule: 'M1-MissionDetailFrame-Required',
      file: relative(process.cwd(), file),
      line: findLine(src, /export\s+default/),
      snippet: snippet(src, findLine(src, /export\s+default/)),
    },
  ];
}

/**
 * M2: 任何 page.tsx 都不许内联 fixed inset-0 z-N 自写弹层 backdrop
 * （feature 模块可以自写，但 mission detail 页面族不行 —— 必须用 canonical）
 */
function checkM2(file: string, src: string): Violation[] {
  if (!isMissionDetailPage(file)) return [];
  // 已用 Modal / ModalShell / SideDrawer / DrawerShell 之一即视为合规
  if (
    hasImport(src, 'Modal') ||
    hasImport(src, 'ModalShell') ||
    hasImport(src, 'SideDrawer') ||
    hasImport(src, 'DrawerShell')
  ) {
    // 仍要确认没有自写裸 fixed inset-0
    const re = /fixed\s+inset-0[^"`]*z-(?:40|50)/;
    if (!re.test(src)) return [];
  }
  const re = /fixed\s+inset-0[^"`]*z-(?:40|50)/;
  const m = re.exec(src);
  if (!m) return [];
  const line = findLine(src, re);
  return [
    {
      rule: 'M2-CanonicalDialog-Required',
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

/**
 * M3: mission detail 页面如果出现"阶段格子 grid"（grid-cols-N + 多个 ring-1
 * + ✓/⟳/✗ 文本标记）应该用 StageStepper
 */
function checkM3(file: string, src: string): Violation[] {
  if (!isMissionDetailPage(file)) return [];
  if (hasImport(src, 'StageStepper')) return [];
  // 简单启发式：同一文件出现 ✓ ⟳ ✗ 三种状态字符 + grid-cols 共现，疑似自写 stepper
  const hasMarks = /[✓⟳✗○]/.test(src) && /grid-cols-\d+/.test(src);
  if (!hasMarks) return [];
  const line = findLine(src, /grid-cols-\d+/);
  return [
    {
      rule: 'M3-StageStepper-Suggested',
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

/**
 * M4: mission detail 页面不许自写"页级 tab strip"（border-b + 多个 onClick 切
 * tab 字面量）。必须用 canonical <Tabs> 或 MissionDetailFrame 自带 tab。
 */
function checkM4(file: string, src: string): Violation[] {
  if (!isMissionDetailPage(file)) return [];
  if (hasImport(src, 'Tabs')) return []; // 用了 canonical
  if (hasImport(src, 'MissionDetailFrame')) return []; // Frame 自带 Tabs
  // 启发式：多次出现 activeTab === '字面量' + 可点击 button
  const setterMatches = src.match(/setActiveTab\s*\(\s*['"][^'"]+['"]\s*\)/g);
  if (!setterMatches || setterMatches.length < 2) return [];
  const line = findLine(src, /setActiveTab\(/);
  return [
    {
      rule: 'M4-Tabs-Required',
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

interface Baseline {
  generatedAt: string;
  counts: Record<string, number>;
  violations: Violation[];
}

function loadBaseline(): Baseline | null {
  const p = join(process.cwd(), BASELINE_PATH);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Baseline;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(FRONTEND_ROOT)) {
    console.error(`[audit:mission-detail] frontend root not found: ${FRONTEND_ROOT}`);
    process.exit(1);
  }
  const files = await walkDir(FRONTEND_ROOT);
  const all: Violation[] = [];
  for (const file of files) {
    let src: string;
    try {
      src = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    all.push(
      ...checkM1(file, src),
      ...checkM2(file, src),
      ...checkM3(file, src),
      ...checkM4(file, src)
    );
  }

  const counts: Record<string, number> = {};
  for (const v of all) counts[v.rule] = (counts[v.rule] ?? 0) + 1;

  const summary = {
    generatedAt: new Date().toISOString(),
    counts,
    violations: all,
  };

  if (UPDATE_BASELINE) {
    const out = JSON.stringify(summary, null, 2);
    await writeFile(join(process.cwd(), BASELINE_PATH), out, 'utf8');
    console.log(
      `[audit:mission-detail] baseline updated: ${BASELINE_PATH} (${all.length} violations)`
    );
    return;
  }

  // 报告
  if (all.length === 0) {
    console.log('[audit:mission-detail] OK · 0 violations');
    return;
  }

  console.log(`[audit:mission-detail] ${all.length} violations`);
  for (const [rule, n] of Object.entries(counts)) {
    console.log(`  ${rule}: ${n}`);
  }
  console.log('');
  for (const v of all.slice(0, 50)) {
    console.log(`  ${v.rule}  ${v.file}:${v.line}`);
    console.log(`    ${v.snippet}`);
  }
  if (all.length > 50) console.log(`  ... +${all.length - 50} more`);

  // 与 baseline 比对（不劣化原则）
  const baseline = loadBaseline();
  if (baseline) {
    let regressed = false;
    for (const [rule, n] of Object.entries(counts)) {
      const prev = baseline.counts[rule] ?? 0;
      if (n > prev) {
        console.log(`\n[REGRESSION] ${rule}: ${prev} → ${n}`);
        regressed = true;
      }
    }
    if (regressed) {
      console.log(
        '\n基线劣化：请用 canonical 组件改写新违规，或经用户批准后跑 audit:mission-detail-baseline 留痕。'
      );
      process.exit(1);
    }
  } else if (STRICT) {
    process.exit(1);
  }
}

void main();
