/**
 * dependency-direction.spec.ts —— Frontend dependency direction 不变量看护
 *
 * 落地依据：thinning plan §3.1 single-track / §3.4 no production dual-run /
 *           §7.1-2 frontend allowed/forbidden responsibilities
 *           README §"看护机制 — 五类硬规则" 第 2 类（依赖方向规则）
 *
 * 5 类前端依赖方向不变量（**thinning plan scope: agent-playground 治理域**）：
 *
 *   D1. 层级单向（top-down）：
 *       app/ → components/ → hooks/ → lib/features/ → services/ → lib/utils/
 *       下层永不 import 上层；任何上行 import 即红。
 *
 *   D2. 无回流：
 *       - services/ 永不 import hooks/ / components/ / app/
 *       - hooks/ 永不 import app/ / components/
 *       - lib/ 永不 import app/ / hooks/ / components/ / services/
 *
 *   D3. Feature 隔离：
 *       lib/features/<X> 不得 import 自 lib/features/<Y>（X !== Y）
 *
 *   D4. Truth source 单入口（mission detail）：
 *       getMissionDetailView API call 仅允许在 hooks/features/useMissionDetailView 内出现；
 *       任何 components/ / app/ / 其他 hook 直接调用即红。
 *
 *   D5. agent-playground 页面 / 组件无 raw fetch：
 *       app/agent-playground/** 与 components/agent-playground/** 不得直接 fetch()；
 *       必须走 services/ 层。这是"前端不得自行重建 truth"的执行规则。
 *
 * **作用域说明**：
 *
 * D1/D2/D3 在 agent-playground 相关路径（services/agent-playground/、
 * lib/features/agent-playground/、hooks/features/useMission*、components/agent-playground/）
 * 严格执行；其他 feature（admin / ai-social / ai-simulation / 等）历史代码可能仍有
 * 上行 import，由各自演化路径治理，不阻断本 spec。
 *
 * D4/D5 全局执行（mission truth 是跨 feature 的硬约束）。
 *
 * 执行入口：CI `npm run test:ci:frontend` 全量；pre-push 无条件运行。
 */

import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_ROOT = path.resolve(__dirname, '../..');

// ── helpers: walk + import extraction ────────────────────────────────────────

function walkTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      if (ent.name === '__tests__') continue;
      if (ent.name === '__fixtures__') continue;
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
      } else if (
        ent.isFile() &&
        (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))
      ) {
        if (ent.name.endsWith('.d.ts')) continue;
        if (ent.name.endsWith('.test.ts')) continue;
        if (ent.name.endsWith('.spec.ts')) continue;
        if (ent.name.endsWith('.test.tsx')) continue;
        out.push(p);
      }
    }
  }
  return out;
}

function extractAliasImports(src: string): string[] {
  const out: string[] = [];
  const re = /from\s+['"](@\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

// ── thinning-plan scope (strict enforcement) ────────────────────────────────

/**
 * 文件路径是否属于 thinning plan 治理域 ——
 *   - services/agent-playground/**
 *   - lib/features/agent-playground/**
 *   - hooks/features/useMission*（mission detail 单点权威核心）
 *   - components/agent-playground/**（被 mission detail 页消费）
 */
function isInScope(absFile: string): boolean {
  const rel = path.relative(FRONTEND_ROOT, absFile).replace(/\\/g, '/');
  return (
    rel.startsWith('services/agent-playground/') ||
    rel.startsWith('lib/features/agent-playground/') ||
    rel.startsWith('components/agent-playground/') ||
    /^hooks\/features\/useMission/.test(rel)
  );
}

// ── D1/D2: 反向 import 检测（仅 thinning plan 治理域） ──────────────────────

const FORBIDDEN_PREFIXES: Record<string, string[]> = {
  services: ['@/app/', '@/components/', '@/hooks/', '@/contexts/', '@/stores/'],
  hooks: ['@/app/', '@/components/'],
  lib: [
    '@/app/',
    '@/components/',
    '@/hooks/',
    '@/services/',
    '@/contexts/',
    '@/stores/',
  ],
};

describe('Frontend dependency direction (thinning scope) —— D1/D2 层级单向 + 无回流', () => {
  const SCAN_LAYERS: Array<{ dir: string; layer: string }> = [
    { dir: 'services', layer: 'services' },
    { dir: 'lib', layer: 'lib' },
    { dir: 'hooks', layer: 'hooks' },
  ];

  it.each(SCAN_LAYERS)(
    '$layer/（agent-playground 治理域内）不得 import 自任何被禁前缀',
    ({ dir, layer }) => {
      const forbidden = FORBIDDEN_PREFIXES[layer] ?? [];
      const violations: string[] = [];
      const files = walkTsFiles(path.join(FRONTEND_ROOT, dir)).filter(
        isInScope
      );
      for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const imports = extractAliasImports(src);
        for (const imp of imports) {
          for (const prefix of forbidden) {
            if (imp.startsWith(prefix)) {
              const rel = path
                .relative(FRONTEND_ROOT, file)
                .replace(/\\/g, '/');
              violations.push(`${rel} → ${imp}`);
              break;
            }
          }
        }
      }
      expect(violations).toEqual([]);
    }
  );
});

// ── D3: Feature 隔离（agent-playground 不得 import 自其他 feature） ─────────

describe('Frontend dependency direction —— D3 agent-playground feature 隔离', () => {
  it('lib/features/agent-playground 不得 import 自其他 feature', () => {
    const featureDir = path.join(
      FRONTEND_ROOT,
      'lib/features/agent-playground'
    );
    const files = walkTsFiles(featureDir);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const imports = extractAliasImports(src);
      for (const imp of imports) {
        const m = /^@\/lib\/features\/([^/]+)/.exec(imp);
        if (!m) continue;
        if (m[1] !== 'agent-playground') {
          const rel = path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
          violations.push(`${rel} → ${imp}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('components/agent-playground 不得 import 自其他 feature components', () => {
    const compDir = path.join(FRONTEND_ROOT, 'components/agent-playground');
    const files = walkTsFiles(compDir);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const imports = extractAliasImports(src);
      for (const imp of imports) {
        // 仅检测跨 feature components 横向引用
        const m = /^@\/components\/([^/]+)/.exec(imp);
        if (!m) continue;
        const otherFeature = m[1];
        const isCrossFeature =
          otherFeature !== 'agent-playground' &&
          otherFeature !== 'common' &&
          otherFeature !== 'ui';
        if (isCrossFeature) {
          const rel = path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
          violations.push(`${rel} → ${imp}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── D4: Truth source 单入口（全局执行） ──────────────────────────────────────

describe('Frontend dependency direction —— D4 mission truth 单入口', () => {
  it('getMissionDetailView API 仅 useMissionDetailView 可调（其他文件禁用）', () => {
    const allowedFile = path
      .join(FRONTEND_ROOT, 'hooks/features/useMissionDetailView.ts')
      .replace(/\\/g, '/');
    const violations: string[] = [];
    const scanDirs = [
      'app',
      'components',
      'hooks',
      'lib',
      'contexts',
      'stores',
    ];
    for (const d of scanDirs) {
      const files = walkTsFiles(path.join(FRONTEND_ROOT, d));
      for (const file of files) {
        const normalized = file.replace(/\\/g, '/');
        if (normalized === allowedFile) continue;
        const src = fs.readFileSync(file, 'utf8');
        const hasImport =
          /import[^;]*\bgetMissionDetailView\b[^;]*from\s+['"]@\/services\//.test(
            src
          );
        if (hasImport) {
          const rel = path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
          violations.push(rel);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── D5: agent-playground 页面 / 组件无 raw fetch ─────────────────────────────

describe('Frontend dependency direction —— D5 agent-playground 无 raw fetch', () => {
  /**
   * Allowlist：合理的 raw fetch 例外（必须每条注明业务原因）。
   *   1. 错误上报 — 直接打 backend error-report endpoint 是 fallback 通道
   *   2. R2 off-load artifact 拉取 — sibling 路由直接走，无需 services 封装
   */
  const ALLOWLIST = new Set<string>([
    'app/agent-playground/team/[missionId]/error.tsx',
    'components/agent-playground/artifact/ArtifactReader.tsx',
  ]);

  function scanForRawFetch(scanDir: string): string[] {
    const violations: string[] = [];
    const files = walkTsFiles(path.join(FRONTEND_ROOT, scanDir));
    for (const file of files) {
      const rel = path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/[.\w]fetch\s*\(/.test(line)) return; // .fetch 之类的方法调用
        if (/\bfetch\s*\(/.test(line)) {
          violations.push(`${rel}:${i + 1}: ${trimmed}`);
        }
      });
    }
    return violations;
  }

  it('app/agent-playground/** 不得直接 fetch()', () => {
    const violations = scanForRawFetch('app/agent-playground');
    expect(violations).toEqual([]);
  });

  it('components/agent-playground/** 不得直接 fetch()', () => {
    const violations = scanForRawFetch('components/agent-playground');
    expect(violations).toEqual([]);
  });
});
