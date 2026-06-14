#!/usr/bin/env tsx
/**
 * Capability Index Generator + Drift Guard
 *
 * 从代码（唯一真相源）抽取全栈四层的公共可复用能力，生成机器/Agent 可读的
 * `docs/architecture/capabilities.json` 索引。其他 Agent 写代码前先查这份索引，
 * 复用已有 canonical 能力，避免重复造轮子。
 *
 * 四层来源：
 *   frontend  → frontend/components/ui/**（canonical 组件）+ hooks/core,hooks/domain + lib/design/tokens
 *   harness   → backend/src/modules/ai-harness/facade/index.ts（L2.5 唯一门面）
 *   engine    → backend/src/modules/ai-engine/facade/index.ts（L2 唯一门面）
 *   platform  → backend/src/modules/platform/facade/index.ts（L1 唯一门面）
 *
 * 抽取方式：TypeScript 编译器 API（AST 级），正确处理 `export *` 递归、
 * `export { A as B, type C }` 重导出、本地声明、default 导出。
 *
 * 用法：
 *   tsx scripts/utils/generate-capabilities.ts           # 看护：重新生成并 diff committed JSON，漂移则 exit 1
 *   tsx scripts/utils/generate-capabilities.ts --write    # 更新：把索引写回 capabilities.json
 *   tsx scripts/utils/generate-capabilities.ts --check    # 显式看护（等同默认）
 *
 * 看护语义（与 audit:capability:update 同套路）：
 *   新增/删除/重命名任一公共能力 → committed JSON 与代码不一致 → exit 1，提示 `npm run capabilities:update`。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const WRITE = ARGS.has("--write");
const OUT = join(ROOT, "docs", "architecture", "capabilities.json");

type Layer = "frontend" | "harness" | "engine" | "platform";

interface Capability {
  /** 导出符号名（复用时按此名引用） */
  name: string;
  /** value=运行时值/服务/类/函数/常量；type=类型/接口；namespace=命名空间导出 */
  kind: "value" | "type" | "namespace";
  layer: Layer;
  /** 子域：后端取 facade 重导出路径首段，前端取 ui 子目录 / hooks / design-tokens */
  domain: string;
  /** 声明所在源文件（相对仓库根，正斜杠） */
  source: string;
  /** 直接可用的导入语句 */
  import: string;
}

// ─────────────────────────────────────────────────────────────
// 通用 AST 抽取
// ─────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function relRoot(abs: string): string {
  return toPosix(relative(ROOT, abs));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * 解析模块说明符到磁盘文件（.ts/.tsx/index.ts/index.tsx）。
 * 支持相对路径与 `@/` 别名（backend → backend/src，frontend → frontend）。
 */
function resolveModule(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) {
    base = resolve(dirname(fromFile), spec);
  } else if (spec.startsWith("@/")) {
    const aliasRoot = toPosix(fromFile).includes("/backend/")
      ? join(ROOT, "backend", "src")
      : join(ROOT, "frontend");
    base = join(aliasRoot, spec.slice(2));
  } else {
    return null; // 外部包，跳过
  }
  const cands = [
    base + ".ts",
    base + ".tsx",
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  return !!(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function isDefaultExport(node: ts.Node): boolean {
  return !!(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

interface RawExport {
  name: string;
  kind: "value" | "type" | "namespace";
  /** 声明所在文件 */
  source: string;
  /** 若来自 `export ... from "spec"`，记 spec 首段供 domain 推断 */
  fromSpec?: string;
}

/**
 * 抽取一个文件的导出符号。
 * @param followStar 是否递归进入 `export * from "..."`（后端 facade 需要，前端单文件不需要）
 */
function collectExports(
  file: string,
  followStar: boolean,
  visited = new Set<string>(),
): RawExport[] {
  if (visited.has(file)) return [];
  visited.add(file);

  const sf = parse(file);
  const out: RawExport[] = [];
  const src = relRoot(file);

  for (const stmt of sf.statements) {
    // export { a, b as c, type d } [from "spec"]   /   export * [as ns] from "spec"
    if (ts.isExportDeclaration(stmt)) {
      const spec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : undefined;

      if (!stmt.exportClause) {
        // export * from "spec"
        if (followStar && spec) {
          const target = resolveModule(file, spec);
          if (target) {
            for (const e of collectExports(target, followStar, visited)) {
              out.push({ ...e, fromSpec: e.fromSpec ?? spec });
            }
          }
        }
        continue;
      }

      // 重导出 `... from "spec"` → 记真实声明文件为 source（domain 由此推断）
      let declSrc = src;
      if (spec) {
        const t = resolveModule(file, spec);
        if (t) declSrc = relRoot(t);
      }

      if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as NS from "spec"
        out.push({
          name: stmt.exportClause.name.text,
          kind: "namespace",
          source: declSrc,
          fromSpec: spec,
        });
        continue;
      }

      // named exports
      for (const el of stmt.exportClause.elements) {
        out.push({
          name: el.name.text,
          kind: stmt.isTypeOnly || el.isTypeOnly ? "type" : "value",
          source: declSrc,
          fromSpec: spec,
        });
      }
      continue;
    }

    // export const/let/var ...
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          out.push({ name: d.name.text, kind: "value", source: src });
        }
      }
      continue;
    }

    // export function / class
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      out.push({ name: stmt.name.text, kind: "value", source: src });
      continue;
    }

    // export interface / type / enum
    if (
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt)
    ) {
      out.push({
        name: stmt.name.text,
        kind: ts.isEnumDeclaration(stmt) ? "value" : "type",
        source: src,
      });
      continue;
    }

    // export default function/class Named (匿名 default 跳过——无稳定复用名)
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      isDefaultExport(stmt) &&
      stmt.name
    ) {
      out.push({ name: stmt.name.text, kind: "value", source: src });
      continue;
    }

    // export default <Identifier>
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) {
        out.push({
          name: stmt.expression.text,
          kind: "value",
          source: src,
        });
      }
      continue;
    }
  }

  return out;
}

function firstSegment(spec: string | undefined): string {
  if (!spec) return "facade";
  const cleaned = spec.replace(/^(\.\.?\/)+/, "").replace(/^@\//, "");
  return cleaned.split("/")[0] || "facade";
}

/** 后端 domain：取真实声明文件在 ai-harness/ai-engine/platform 下的聚合段 */
function backendDomain(source: string, fallbackSpec?: string): string {
  let m = source.match(
    /\/modules\/(?:ai-harness|ai-engine|platform)\/([^/]+)\//,
  );
  if (m) return m[1];
  m = source.match(/backend\/src\/(common|config)\//);
  if (m) return m[1];
  return firstSegment(fallbackSpec);
}

// ─────────────────────────────────────────────────────────────
// 后端 facade（engine / harness / platform）
// ─────────────────────────────────────────────────────────────

const FACADES: { layer: Layer; file: string; importPath: string }[] = [
  {
    layer: "harness",
    file: "backend/src/modules/ai-harness/facade/index.ts",
    importPath: "@/modules/ai-harness/facade",
  },
  {
    layer: "engine",
    file: "backend/src/modules/ai-engine/facade/index.ts",
    importPath: "@/modules/ai-engine/facade",
  },
  {
    layer: "platform",
    file: "backend/src/modules/platform/facade/index.ts",
    importPath: "@/modules/platform/facade",
  },
];

function collectBackend(): Capability[] {
  const caps: Capability[] = [];
  for (const f of FACADES) {
    const abs = join(ROOT, f.file);
    if (!existsSync(abs)) {
      console.error(`[capabilities] facade 缺失: ${f.file}`);
      continue;
    }
    const seen = new Set<string>();
    for (const e of collectExports(abs, /* followStar */ true)) {
      if (seen.has(e.name)) continue; // 同名导出去重（取首次）
      seen.add(e.name);
      caps.push({
        name: e.name,
        kind: e.kind,
        layer: f.layer,
        domain: backendDomain(e.source, e.fromSpec),
        source: e.source,
        import: `import { ${e.name} } from "${f.importPath}";`,
      });
    }
  }
  return caps;
}

// ─────────────────────────────────────────────────────────────
// 前端（components/ui + hooks + design tokens）
// ─────────────────────────────────────────────────────────────

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, acc);
    } else if (
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx") &&
      !full.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** frontend/components/ui/cards/asset-card/AssetCard.tsx → @/components/ui/cards/asset-card/AssetCard */
function aliasFromSource(src: string): string {
  return (
    "@/" +
    src.replace(/^frontend\//, "").replace(/\.(tsx?|ts)$/, "")
  );
}

function uiDomain(src: string): string {
  // frontend/components/ui/<domain>/...
  const m = src.match(/^frontend\/components\/ui\/([^/]+)\//);
  return m ? m[1] : "ui";
}

function collectFrontend(): Capability[] {
  const caps: Capability[] = [];
  const push = (e: RawExport, domain: string) => {
    caps.push({
      name: e.name,
      kind: e.kind,
      layer: "frontend",
      domain,
      source: e.source,
      import: `import { ${e.name} } from "${aliasFromSource(e.source)}";`,
    });
  };

  // 1) canonical UI 组件
  for (const file of walk(join(ROOT, "frontend", "components", "ui"))) {
    for (const e of collectExports(file, /* followStar */ false)) {
      push(e, uiDomain(relRoot(file)));
    }
  }

  // 2) 公共 hooks（core 全量 + domain 下 useXxx）
  for (const sub of ["core", "domain"]) {
    for (const file of walk(join(ROOT, "frontend", "hooks", sub))) {
      const rel = relRoot(file);
      if (rel.endsWith("/index.ts")) continue; // barrel 只是 re-export，跳过避免重复
      for (const e of collectExports(file, false)) {
        if (!/^use[A-Z]/.test(e.name)) continue; // 只收 hook
        push(e, `hooks-${sub}`);
      }
    }
  }

  // 3) 设计 token
  const tokens = join(ROOT, "frontend", "lib", "design", "tokens.ts");
  if (existsSync(tokens)) {
    for (const e of collectExports(tokens, false)) {
      push(e, "design-tokens");
    }
  }

  return caps;
}

// ─────────────────────────────────────────────────────────────
// 装配 + 看护
// ─────────────────────────────────────────────────────────────

function build(): { document: object; caps: Capability[] } {
  // 按 layer|name 去重：barrel index 与声明文件重复导出同名符号时，优先保留声明文件
  const dedup = new Map<string, Capability>();
  for (const c of [...collectBackend(), ...collectFrontend()]) {
    const key = `${c.layer}|${c.name}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, c);
      continue;
    }
    const prevIsBarrel = /\/index\.tsx?$/.test(prev.source);
    const curIsBarrel = /\/index\.tsx?$/.test(c.source);
    if (prevIsBarrel && !curIsBarrel) dedup.set(key, c);
  }

  const caps = [...dedup.values()].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer < b.layer ? -1 : 1;
    if (a.domain !== b.domain) return a.domain < b.domain ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const byLayer: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const c of caps) {
    byLayer[c.layer] = (byLayer[c.layer] ?? 0) + 1;
    const key = `${c.layer}/${c.domain}`;
    byDomain[key] = (byDomain[key] ?? 0) + 1;
  }

  const document = {
    $schema: "./capabilities.schema.json",
    note: "AUTO-GENERATED by scripts/utils/generate-capabilities.ts — 勿手改。新增/删除公共能力后跑 `npm run capabilities:update`。Agent 复用入口见 .claude/skills/capability-map/SKILL.md",
    sources: FACADES.map((f) => f.file).concat([
      "frontend/components/ui/**",
      "frontend/hooks/{core,domain}/**",
      "frontend/lib/design/tokens.ts",
    ]),
    totals: { all: caps.length, byLayer, byDomain },
    capabilities: caps,
  };

  return { document, caps };
}

function serialize(doc: object): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

function main() {
  const { document, caps } = build();
  const next = serialize(document);

  if (WRITE) {
    writeFileSync(OUT, next, "utf8");
    console.log(
      `[capabilities] 已写入 ${relRoot(OUT)} — 共 ${caps.length} 条能力`,
    );
    return;
  }

  // 看护模式（默认 / --check）
  if (!existsSync(OUT)) {
    console.error(
      `[capabilities] 索引文件不存在: ${relRoot(OUT)}\n  请先运行: npm run capabilities:update`,
    );
    process.exit(1);
  }

  const current = readFileSync(OUT, "utf8");
  if (current === next) {
    console.log(`[capabilities] 索引与代码一致 ✓（${caps.length} 条能力）`);
    return;
  }

  // 计算漂移摘要
  const parsePrev = JSON.parse(current) as { capabilities?: Capability[] };
  const prevKeys = new Set(
    (parsePrev.capabilities ?? []).map((c) => `${c.layer}|${c.name}`),
  );
  const nextKeys = new Set(caps.map((c) => `${c.layer}|${c.name}`));
  const added = [...nextKeys].filter((k) => !prevKeys.has(k));
  const removed = [...prevKeys].filter((k) => !nextKeys.has(k));

  console.error("============================================================");
  console.error("  [capabilities] 能力索引漂移：代码与 capabilities.json 不一致");
  console.error("============================================================");
  if (added.length)
    console.error(
      `  新增 ${added.length} 项: ${added.slice(0, 20).join(", ")}${added.length > 20 ? " …" : ""}`,
    );
  if (removed.length)
    console.error(
      `  移除 ${removed.length} 项: ${removed.slice(0, 20).join(", ")}${removed.length > 20 ? " …" : ""}`,
    );
  if (!added.length && !removed.length)
    console.error("  元数据变更（path/kind/domain/import 等），无新增/删除符号");
  console.error("");
  console.error("  修复: npm run capabilities:update  然后提交 capabilities.json");
  console.error("============================================================");
  process.exit(1);
}

main();
