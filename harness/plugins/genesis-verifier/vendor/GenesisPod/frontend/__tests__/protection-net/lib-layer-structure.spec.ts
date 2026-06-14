/**
 * lib-layer-structure.spec.ts
 *
 * 看护：frontend/lib/ 必须遵守「feature 单独出来 + platform 留根」
 *   规范来源：.claude/standards/02-directory-structure.md §「lib/ 分层」
 *   - lib/ 根只允许：features/ ∪ ① 全局平台(api/utils/constants/types) ∪ ② 技术库白名单
 *     ∪ ③ 生成产物(generated：changelog.json + 构建期 ai-app-docs，被 changelog.ts /
 *     next.config.js 消费，非空壳，原地保留)
 *   - feature 业务纯逻辑必须在 lib/features/{feature}/，不得散在 lib/ 根
 *
 * ⚠ 迁移开关 MIGRATION_DONE：
 *   - 迁移前 = false：只跑「反向证据」(证明检测逻辑非空操作)，真实文件系统断言 skip，
 *     不阻断共享测试套件（彼时 ai-social/ 等仍在 lib/ 根属预期中间态）。
 *   - 执行 Agent 迁移完成后 = true：真实文件系统断言生效，成为永久回归看护。
 *     这正是本任务的「done」信号——翻 true 且全绿 = 迁移合规。
 *
 * 执行入口：CI `npm run test:ci:frontend` 全量；pre-push `.husky/pre-push` [0c] 无条件运行。
 */

import * as fs from 'fs';
import * as path from 'path';

const LIB_ROOT = path.resolve(__dirname, '../../lib');

// ── 迁移完成开关（执行 Agent 迁完改 true）──────────────────────────────
const MIGRATION_DONE = true;

// lib/ 根白名单
const PLATFORM_GLOBAL = ['api', 'utils', 'constants', 'types', 'missions']; // ①（missions 见蓝图 §9.5,共享 mission view 派生)
const PLATFORM_TECH = [
  'markdown',
  'annotation',
  'cache',
  'storage',
  'workers',
  'animations',
  'design',
  'templates',
  'text-selection',
  'i18n',
  'wiki',
  'byok',
]; // ②
const PLATFORM_GENERATED = ['generated']; // ③ 生成产物（changelog / 构建期 docs）
const ALLOWED_LIB_ROOT = new Set<string>([
  'features',
  ...PLATFORM_GLOBAL,
  ...PLATFORM_TECH,
  ...PLATFORM_GENERATED,
]);

// 这些 feature 目录必须在 lib/features/ 下，出现在 lib/ 根即回归
const FEATURE_DIRS = [
  'ai-social',
  'agent-playground',
  'ai-office',
  'admin',
  'ai-writing',
  'ai-simulation',
  'explore',
  'notion',
  'notifications',
];

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

/** 纯函数：lib/ 根里不在白名单的目录 */
function findUnexpectedRoot(dirs: string[]): string[] {
  return dirs.filter((d) => !ALLOWED_LIB_ROOT.has(d));
}

/** 纯函数：feature 目录残留在 lib/ 根 */
function findFeatureAtRoot(dirs: string[]): string[] {
  return dirs.filter((d) => FEATURE_DIRS.includes(d));
}

const liveIt = MIGRATION_DONE ? it : it.skip;

describe('lib 分层看护 — 真实文件系统（迁移完成后启用）', () => {
  liveIt('lib/ 根不含未授权目录（只允许 features ∪ 平台白名单）', () => {
    const unexpected = findUnexpectedRoot(listDirs(LIB_ROOT));
    if (unexpected.length > 0) {
      throw new Error(
        `lib/ 根出现未授权目录：[${unexpected.join(', ')}]\n` +
          `→ feature 逻辑应进 lib/features/{feature}/；新技术库需先登记标准 02 §lib ② 白名单`
      );
    }
    expect(unexpected).toEqual([]);
  });

  liveIt('feature 目录不得留在 lib/ 根（必须在 lib/features/）', () => {
    const leaked = findFeatureAtRoot(listDirs(LIB_ROOT));
    if (leaked.length > 0) {
      throw new Error(
        `feature 目录仍在 lib/ 根：[${leaked.join(', ')}]\n` +
          `→ git mv 到 lib/features/{feature}/ 并把 @/lib/${leaked[0]} 改为 @/lib/features/${leaked[0]}`
      );
    }
    expect(leaked).toEqual([]);
  });

  liveIt('lib/features/ 存在且非空', () => {
    expect(listDirs(path.join(LIB_ROOT, 'features')).length).toBeGreaterThan(0);
  });

  liveIt('lib/generated/ 作为生成产物原地保留且在白名单内', () => {
    // generated 非空壳：changelog.json 被 lib/utils/changelog.ts import，
    // ai-app-docs 被 next.config.js 构建期 bundle。属 ③ 平台生成产物，原地保留。
    expect(ALLOWED_LIB_ROOT.has('generated')).toBe(true);
    expect(findUnexpectedRoot(['generated'])).toEqual([]);
  });
});

describe('lib 分层看护 — 反向证据（证明检测逻辑非空操作）', () => {
  it('REVERSE: 能抓出 lib/ 根的未授权目录', () => {
    expect(findUnexpectedRoot(['features', 'api', '__bogus__'])).toEqual([
      '__bogus__',
    ]);
  });

  it('REVERSE: 能抓出 feature 残留在 lib/ 根', () => {
    expect(
      findFeatureAtRoot(['features', 'utils', 'agent-playground'])
    ).toEqual(['agent-playground']);
  });

  it('SANITY: 合规集合不报任何违规', () => {
    const clean = [
      'features',
      ...PLATFORM_GLOBAL,
      ...PLATFORM_TECH,
      ...PLATFORM_GENERATED,
    ];
    expect(findUnexpectedRoot(clean)).toEqual([]);
    expect(findFeatureAtRoot(clean)).toEqual([]);
  });
});
