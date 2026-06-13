/**
 * canonical-mission-truth.spec.ts —— frontend mission truth 单点权威看护
 *
 * 落地依据：thinning plan §3.1 single-track / §3.4 no production dual-run /
 *           §7.1 forbidden responsibilities / §7.3 fate of derive files
 *
 * 不变量（编译期/lint 之外的运行时保险）：
 *
 *   T1. 删除的 truth deriver 文件不得 resurrected（防"死灰复燃"）
 *   T2. agent-playground/team/[missionId]/page.tsx 必使用 useMissionDetailView
 *   T3. mission detail page 不得 import getMissionDetail 作为主 truth 来源
 *   T4. mission-presentation.types.ts 文件名替代旧 derive-shapes.ts（重命名收口）
 *   T5. mission-todo.types.ts 文件名替代旧 todo-ledger-shapes.ts
 *
 * 执行入口：CI `npm run test:ci:frontend` 全量；pre-push 无条件运行。
 *
 * 五类硬规则映射（user 提议的看护机制）：
 *   - "禁止回流规则" ← T1
 *   - "authority 规则" ← T2/T3
 *   - "目录规则" ← T4/T5
 */

import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = path.join(
  FRONTEND_ROOT,
  'app/agent-playground/team/[missionId]/page.tsx'
);
const LIB_PLAYGROUND = path.join(
  FRONTEND_ROOT,
  'lib/features/agent-playground'
);

describe('Canonical mission truth — frontend single-source guards', () => {
  // ── T1: 禁止回流规则 ─────────────────────────────────────────────────────
  describe('T1: 删除的 truth deriver 不得 resurrected', () => {
    const DELETED_FILES = [
      'derive.ts',
      'todo-ledger.ts',
      'synthesize-artifact.ts',
      'view-to-derived.shim.ts',
      // 旧命名（已 rename 到 mission-*.types.ts）
      'derive-shapes.ts',
      'todo-ledger-shapes.ts',
    ];

    it.each(DELETED_FILES)('%s 不得存在（W7/W8 已删除）', (filename) => {
      const filePath = path.join(LIB_PLAYGROUND, filename);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  // ── T2/T3: authority 规则 ────────────────────────────────────────────────
  describe('T2/T3: mission detail page 单点权威 = useMissionDetailView', () => {
    const pageSrc = fs.existsSync(PAGE_PATH)
      ? fs.readFileSync(PAGE_PATH, 'utf8')
      : '';

    it('page.tsx import useMissionDetailView（canonical view truth）', () => {
      expect(pageSrc).toMatch(
        /from\s+['"]@\/hooks\/features\/useMissionDetailView['"]/
      );
    });

    it('page.tsx 不再直接 import getMissionDetail（已 W1 切除）', () => {
      // 只允许 import 类型 MissionDetail，不允许 import 函数 getMissionDetail
      const importsGetMissionDetail = /import[^;]*\bgetMissionDetail\b/m.test(
        pageSrc
      );
      expect(importsGetMissionDetail).toBe(false);
    });

    it('page.tsx 不再直接 import listResumableMissions（已 W1 切除）', () => {
      const importsListResumable = /import[^;]*\blistResumableMissions\b/m.test(
        pageSrc
      );
      expect(importsListResumable).toBe(false);
    });

    it('page.tsx 不再 import viewToDerivedShim（已 W8 删除）', () => {
      const importsShim = /viewToDerivedShim/.test(pageSrc);
      expect(importsShim).toBe(false);
    });
  });

  // ── T4/T5: 目录规则（renamed file presence） ─────────────────────────────
  describe('T4/T5: rename 收口（mission-presentation.types / mission-todo.types）', () => {
    it('mission-presentation.types.ts 存在（替代 derive-shapes.ts）', () => {
      const filePath = path.join(
        LIB_PLAYGROUND,
        'mission-presentation.types.ts'
      );
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('mission-todo.types.ts 存在（替代 todo-ledger-shapes.ts）', () => {
      const filePath = path.join(LIB_PLAYGROUND, 'mission-todo.types.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ── ESLint 规则锁（防 .eslintrc 配置被回退） ──────────────────────────────
  describe('ESLint 禁止 truth import', () => {
    const eslintPath = path.join(FRONTEND_ROOT, '.eslintrc.json');
    const eslintSrc = fs.existsSync(eslintPath)
      ? fs.readFileSync(eslintPath, 'utf8')
      : '';

    it('禁止 import */agent-playground/derive', () => {
      expect(eslintSrc).toMatch(/agent-playground\/derive/);
    });

    it('禁止 import */agent-playground/todo-ledger', () => {
      expect(eslintSrc).toMatch(/agent-playground\/todo-ledger/);
    });

    it('禁止 import */agent-playground/synthesize-artifact', () => {
      expect(eslintSrc).toMatch(/agent-playground\/synthesize-artifact/);
    });
  });
});

describe('Canonical mission truth — useMissionDetailView contract', () => {
  const hookPath = path.join(
    FRONTEND_ROOT,
    'hooks/features/useMissionDetailView.ts'
  );

  it('useMissionDetailView hook 文件存在', () => {
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('hook 暴露 applyRefreshHints（§6.7.3 stream → canonical refetch 桥）', () => {
    const src = fs.readFileSync(hookPath, 'utf8');
    expect(src).toMatch(/applyRefreshHints/);
  });

  it('hook 暴露 refresh（手动 refetch 入口，供 race window mitigation）', () => {
    const src = fs.readFileSync(hookPath, 'utf8');
    expect(src).toMatch(/\brefresh\b/);
  });
});
