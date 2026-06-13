/**
 * component-placement.spec.ts
 *
 * 看护：components/ 的 ui/ vs common/ 归属边界（防止 common/ 沦为垃圾场）。
 *
 * 规范来源：.claude/standards/02-directory-structure.md §components 三层判断
 *   - components/ui/     = 无业务的设计系统（primitive + app-agnostic composite：
 *                          cards / page-header-hero / tables 原语 / dialogs 通用 / states / nav / form …）
 *   - components/common/ = 跨 feature 的「业务/领域」组件，按 concern 子目录组织
 *                          （citations / mission-detail / selectors / 领域 badges …）
 *   - components/{feature}/ = 单 feature 专属
 *
 * 防止三类腐化（都是 2026-05-21 用户震怒暴露的真实漏洞）：
 *   1. 卡片 / 页头等纯 UI primitive 漂进 common/（cards、asset-card、page-header-hero 已收回 ui/）
 *   2. common/ 根直接堆散落 .tsx（应进 concern 子目录）——存量已 grandfather 冻结，禁新增
 *   3. 凭空在 ui/ 或 common/ 新增未登记的 concern 目录，绕过边界造成结构腐化
 *
 * 新增合法 concern 目录 / 根文件的正确流程：
 *   先更新规范 02 + 本文件白名单，再建——否则本看护拒绝（= 评审闸门）。
 *
 * 执行入口（双层兜底）：
 *   - pre-push `.husky/pre-push` [0c]（无条件全量跑，不走 --changed）
 *   - CI `npm run test:ci:frontend`
 *
 * 注：卡片**组件**级归属（cards/asset-card 只许在 ui/cards）另由 audit R15 在 pre-push [4/6] 焊死，
 *     与本结构看护互为belt-and-suspenders。
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPONENTS_ROOT = path.resolve(__dirname, '../../components');

// ui/ = 设计系统（无业务）。新增 primitive concern 目录前先登记。
const UI_ALLOWED_DIRS = new Set<string>([
  'animations',
  'badges',
  'cards',
  'collapsible',
  'content',
  'dialogs',
  'feedback',
  'form',
  'nav',
  'page-header-hero',
  'pagination',
  'primitives',
  'progress',
  'states',
  'table',
  'tabs',
  'tag',
  'viewers',
]);

// common/ = 跨 feature 业务/领域组件（按 concern 子目录）。新增 concern 前先登记。
const COMMON_ALLOWED_DIRS = new Set<string>([
  'actions',
  'agent-inspector',
  'ai-organizer',
  'ai-text-edit',
  'annotations',
  'asset-detail-layout',
  'badges',
  'brand',
  'byok',
  'callouts',
  'chart-viewer',
  'citations',
  'comments',
  'credits',
  'dialogs',
  'drawers',
  'editors',
  'inputs',
  'leader-chat',
  'markdown-viewer',
  'mission-detail',
  'missions',
  'model-config',
  'report-viewer',
  'report-workspace',
  'resource-lists',
  'selectors',
  'skills',
  'switchers',
  'sync',
  'tables',
  'team-topology',
  'views',
]);

// 卡片 / 页头是纯 UI primitive，已收回 ui/——禁止在 common/ 复活这些目录。
const FORBIDDEN_IN_COMMON = new Set<string>([
  'cards',
  'asset-card',
  'page-header-hero',
]);

// common/ 根散落 .tsx 存量冻结（grandfather）：不许再新增；存量逐步归位到 concern 子目录。
const COMMON_ROOT_LOOSE_GRANDFATHER = new Set<string>([
  'ChunkErrorHandler.tsx',
  'ClientDate.tsx',
  'ErrorBoundary.tsx',
  'SignInPrompt.tsx',
  'ThemeApplier.tsx',
]);

function listDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '__tests__')
    .map((e) => e.name);
}

function listLooseTsx(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
    .map((e) => e.name);
}

// 纯函数（白盒断言 + 反向证据共用）
const findUnregisteredDirs = (dirs: string[], allow: Set<string>): string[] =>
  dirs.filter((d) => !allow.has(d));
const findForbidden = (dirs: string[], forbidden: Set<string>): string[] =>
  dirs.filter((d) => forbidden.has(d));
const findUngrandfatheredFiles = (
  files: string[],
  allow: Set<string>
): string[] => files.filter((f) => !allow.has(f));

describe('components 归属边界看护 — 白盒（真实文件系统）', () => {
  it('ui/ 下无未登记的 concern 目录', () => {
    const unexpected = findUnregisteredDirs(
      listDirs(path.join(COMPONENTS_ROOT, 'ui')),
      UI_ALLOWED_DIRS
    );
    if (unexpected.length > 0) {
      throw new Error(
        `components/ui/ 下发现未登记目录：[${unexpected.join(', ')}]\n` +
          `→ 合法新增：先在规范 02 §components + 本测试 UI_ALLOWED_DIRS 登记，再建。`
      );
    }
    expect(unexpected).toEqual([]);
  });

  it('common/ 下无未登记的 concern 目录', () => {
    const unexpected = findUnregisteredDirs(
      listDirs(path.join(COMPONENTS_ROOT, 'common')),
      COMMON_ALLOWED_DIRS
    );
    if (unexpected.length > 0) {
      throw new Error(
        `components/common/ 下发现未登记目录：[${unexpected.join(', ')}]\n` +
          `→ 纯 UI primitive 应放 ui/；跨 feature 业务组件登记到本测试 COMMON_ALLOWED_DIRS 再建。`
      );
    }
    expect(unexpected).toEqual([]);
  });

  it('common/ 不得复活已收回 ui/ 的卡片/页头目录', () => {
    const revived = findForbidden(
      listDirs(path.join(COMPONENTS_ROOT, 'common')),
      FORBIDDEN_IN_COMMON
    );
    if (revived.length > 0) {
      throw new Error(
        `components/common/ 出现应在 ui/ 的目录：[${revived.join(', ')}]\n` +
          `→ cards / asset-card / page-header-hero 是纯 UI primitive，归 components/ui/。`
      );
    }
    expect(revived).toEqual([]);
  });

  it('common/ 根不得新增散落 .tsx（存量已冻结，新组件进 concern 子目录）', () => {
    const ungrandfathered = findUngrandfatheredFiles(
      listLooseTsx(path.join(COMPONENTS_ROOT, 'common')),
      COMMON_ROOT_LOOSE_GRANDFATHER
    );
    if (ungrandfathered.length > 0) {
      throw new Error(
        `components/common/ 根出现新散落文件：[${ungrandfathered.join(', ')}]\n` +
          `→ 跨 feature 组件请放进 concern 子目录（如 dialogs/ selectors/ ...），不要堆在 common/ 根。`
      );
    }
    expect(ungrandfathered).toEqual([]);
  });

  it('ui/ 根保持无散落 .tsx（一切在 concern 子目录）', () => {
    const loose = listLooseTsx(path.join(COMPONENTS_ROOT, 'ui'));
    if (loose.length > 0) {
      throw new Error(
        `components/ui/ 根出现散落文件：[${loose.join(', ')}]\n` +
          `→ ui primitive 一律进 concern 子目录（cards/ states/ primitives/ ...）。`
      );
    }
    expect(loose).toEqual([]);
  });
});

describe('components 归属边界看护 — 反向证据（证明检测非空操作）', () => {
  it('REVERSE: 抓出 ui/ 未登记目录', () => {
    expect(
      findUnregisteredDirs(['cards', '__bogus__'], UI_ALLOWED_DIRS)
    ).toEqual(['__bogus__']);
  });

  it('REVERSE: 抓出 common/ 复活 cards/asset-card/page-header-hero', () => {
    expect(
      findForbidden(['citations', 'cards', 'asset-card'], FORBIDDEN_IN_COMMON)
    ).toEqual(['cards', 'asset-card']);
  });

  it('REVERSE: 抓出 common/ 根新散落文件', () => {
    expect(
      findUngrandfatheredFiles(
        ['ClientDate.tsx', '__NewLoose__.tsx'],
        COMMON_ROOT_LOOSE_GRANDFATHER
      )
    ).toEqual(['__NewLoose__.tsx']);
  });

  it('SANITY: 合规集合不报违规', () => {
    expect(findUnregisteredDirs(['cards', 'states'], UI_ALLOWED_DIRS)).toEqual(
      []
    );
    expect(
      findForbidden(['citations', 'selectors'], FORBIDDEN_IN_COMMON)
    ).toEqual([]);
  });
});
