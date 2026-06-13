/**
 * first-level-directory-structure.spec.ts
 *
 * 看护：frontend/ 第一层目录必须落在规范白名单内。
 *
 * 防止两类破坏：
 *   1. 已废弃的第一层目录复活
 *      - `types/`  → 已折叠进 `lib/types/`（全局类型归 lib，规范 02 §lib）
 *   2. 凭空新增未授权的第一层目录（如 helpers/ views/ models/ api/ 等），
 *      绕过「核心七层」模型造成结构腐化。
 *
 * 特例：`pages/` 在 Next 14.2 下不能完全删除——纯 App Router 项目 build
 *   prerender /404 + /500 时仍走 Pages Router 路径，需要 `pages/_document.tsx`
 *   + `pages/_error.tsx` 作为 fallback 骨架，否则报
 *   `<Html> should not be imported outside of pages/_document`。本看护改为
 *   严格 file-level 白名单：pages/ 内仅允许这两个文件存在。
 *
 * 规范来源：.claude/standards/02-directory-structure.md
 *   §「Frontend 第一层目录白名单与定位（看护锁定）」
 *
 * 新增合法第一层目录的正确流程：
 *   先更新规范文档白名单 + 本文件 ALLOWED_DIRS，再建目录——否则本看护拒绝。
 *
 * 执行入口（双层兜底）：
 *   - pre-push `.husky/pre-push` [0c] 步骤无条件运行本文件（不走 --changed，必触发）
 *   - CI `npm run test:ci:frontend`（全量 vitest run，必含本文件）
 */

import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_ROOT = path.resolve(__dirname, '../../');

// 规范定义的第一层目录白名单
const ALLOWED_DIRS = new Set<string>([
  // —— 核心七层（源码主体，职责互斥、依赖单向）——
  'app', // App Router 路由层
  'components', // React 组件层（ui/common/{feature}/layout）
  'lib', // 纯逻辑层（无 React / 无 HTTP，含 lib/api 基建 + lib/types）
  'services', // API 调用层（HTTP + SSE）
  'hooks', // React Hooks 层（core/domain/swr/features）
  'contexts', // React Context 层
  'stores', // Zustand 全局 store 层
  // —— 支撑目录 ——
  '__tests__', // 跨切面 / 集成测试 + fixtures（单测就近 colocated）
  'public', // Next.js 静态资源
  'scripts', // 前端工具脚本
  // —— Next 14.2 Pages Router fallback（仅 _document + _error，下方 file-level 锁）——
  'pages',
  // —— 构建产物 / 依赖（gitignore，但磁盘可能存在）——
  'node_modules',
  'coverage',
]);

// 明确禁止——这些曾存在并被有意移除，复活即视为回归
//   pages/ 不在禁列：Next 14.2 build prerender /404/500 强制需要 pages/_document
//   + pages/_error 作为 Pages Router fallback。file-level 锁见下方 PAGES_ALLOWED_FILES。
const FORBIDDEN_DIRS = new Set<string>(['types']);

// pages/ 子目录严格 file-level 白名单：只允许 Next 14.2 fallback 必需的两个文件，
//   防止有人误把业务页面塞回 pages/ 走 Pages Router (项目唯一路由层是 app/)。
const PAGES_ALLOWED_FILES = new Set<string>(['_document.tsx', '_error.tsx']);

// 核心七层（必须全部存在）
const SEVEN_LAYERS = [
  'app',
  'components',
  'lib',
  'services',
  'hooks',
  'contexts',
  'stores',
] as const;

/** 列出 frontend 第一层目录（忽略 . 开头的工具/隐藏目录，如 .next .turbo .vscode） */
function listFirstLevelDirs(): string[] {
  return fs
    .readdirSync(FRONTEND_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

/** 纯函数：找出不在白名单内的目录（供白盒断言 + 反向证据共用） */
function findUnexpected(dirs: string[]): string[] {
  return dirs.filter((d) => !ALLOWED_DIRS.has(d));
}

/** 纯函数：找出复活的已废弃目录 */
function findRevivedForbidden(dirs: string[]): string[] {
  return dirs.filter((d) => FORBIDDEN_DIRS.has(d));
}

/** 列出 pages/ 下不在白名单的文件（业务页面禁回 Pages Router） */
function listUnauthorizedPagesEntries(): string[] {
  const pagesDir = path.join(FRONTEND_ROOT, 'pages');
  if (!fs.existsSync(pagesDir)) return [];
  return fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((n) => !PAGES_ALLOWED_FILES.has(n));
}

describe('frontend 第一层目录结构看护 — 白盒（真实文件系统）', () => {
  it('不存在未授权的第一层目录', () => {
    const unexpected = findUnexpected(listFirstLevelDirs());
    if (unexpected.length > 0) {
      throw new Error(
        `发现未授权的第一层目录：[${unexpected.join(', ')}]\n` +
          `→ 若为合法新增：先在 .claude/standards/02-directory-structure.md 白名单 + 本测试 ALLOWED_DIRS 登记，再建目录。\n` +
          `→ 若误建：把内容移动到对应的核心七层目录后删除空目录。`
      );
    }
    expect(unexpected).toEqual([]);
  });

  it('已废弃目录不得复活（types/ 已并入 lib/types/）', () => {
    const revived = findRevivedForbidden(listFirstLevelDirs());
    if (revived.length > 0) {
      throw new Error(
        `检测到已废弃的第一层目录复活：[${revived.join(', ')}]\n` +
          `→ types/：全局类型归 lib/types/。`
      );
    }
    expect(revived).toEqual([]);
  });

  it('pages/ 只允许 _document.tsx + _error.tsx（Next 14.2 Pages Router fallback）', () => {
    const unauthorized = listUnauthorizedPagesEntries();
    if (unauthorized.length > 0) {
      throw new Error(
        `pages/ 出现未授权条目：[${unauthorized.join(', ')}]\n` +
          `→ pages/ 仅作为 Next 14.2 build prerender /404 /500 的 Pages Router fallback,\n` +
          `   只允许 _document.tsx + _error.tsx。业务路由必须归 app/。`
      );
    }
    expect(unauthorized).toEqual([]);
  });

  it('核心七层目录齐全', () => {
    const dirs = new Set(listFirstLevelDirs());
    const missing = SEVEN_LAYERS.filter((d) => !dirs.has(d));
    if (missing.length > 0) {
      throw new Error(`缺失核心七层目录：[${missing.join(', ')}]`);
    }
    expect(missing).toEqual([]);
  });
});

describe('frontend 第一层目录结构看护 — 反向证据（证明检测逻辑非空操作）', () => {
  it('REVERSE: 检测逻辑能抓出任意未授权目录', () => {
    const synthetic = ['app', 'components', '__definitely_not_allowed__'];
    expect(findUnexpected(synthetic)).toContain('__definitely_not_allowed__');
  });

  it('REVERSE: 检测逻辑能抓出 types/ 复活', () => {
    expect(findRevivedForbidden(['lib', 'types', 'app'])).toEqual(['types']);
  });

  it('REVERSE: pages/ 不再被视为复活目录（Next 14.2 fallback 例外）', () => {
    // pages/ 现在是合法的支撑目录（仅作 _document/_error fallback）
    expect(findRevivedForbidden(['app', 'pages'])).toEqual([]);
    expect(findUnexpected(['app', 'pages'])).toEqual([]);
  });

  it('SANITY: 完全合规的目录集合不报任何违规', () => {
    const clean = [...SEVEN_LAYERS, '__tests__', 'public', 'scripts', 'pages'];
    expect(findUnexpected(clean)).toEqual([]);
    expect(findRevivedForbidden(clean)).toEqual([]);
  });
});
