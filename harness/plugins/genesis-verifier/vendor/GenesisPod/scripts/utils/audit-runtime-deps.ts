#!/usr/bin/env tsx
/**
 * audit-runtime-deps —— 防 PR-DR2-FU2 handlebars MODULE_NOT_FOUND 复发
 *
 * 背景：动态 `await import("handlebars")` tsc 不验包是否真在 deps，
 * 本地走 workspace hoist 假阳性通过，Railway prod-only install 才暴露。
 *
 * 规则：扫 backend/src/**\/*.ts 里的 import / require / dynamic import 字面量，
 * 提取所有外部包名（去掉 . / @/ / node: prefix），对照 backend/package.json
 * dependencies + 已知 NestJS @nestjs/* monorepo 包，找出 declare 漏的包。
 *
 * 退出码：
 * - 0：无漏声明
 * - 1：发现至少一个未在 dependencies 的外部包
 *
 * 用法：
 *   npx tsx scripts/utils/audit-runtime-deps.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const BACKEND_PKG = JSON.parse(
  readFileSync(join(ROOT, "backend", "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const ROOT_PKG = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

// Allow root-level deps (workspaces 自然 hoist)
const KNOWN_DEPS = new Set<string>([
  ...Object.keys(BACKEND_PKG.dependencies ?? {}),
  ...Object.keys(BACKEND_PKG.devDependencies ?? {}),
  ...Object.keys(ROOT_PKG.dependencies ?? {}),
  ...Object.keys(ROOT_PKG.devDependencies ?? {}),
]);

/**
 * 已知 transitive 安全包：NestJS / Prisma / 其他 ecosystem 自带，prod install
 * 也会装到 node_modules（走 explicit dep 的依赖图）。这些不需要显式声明。
 *
 * 注意：把包加进这里之前要确认 npm install --omit=dev 后 node_modules/<pkg>
 * 真存在，否则 prod 会复发 MODULE_NOT_FOUND。
 */
const KNOWN_TRANSITIVES = new Set<string>([
  // NestJS @nestjs/platform-express 自带
  "express",
  "multer",
  // @nestjs/jwt 自带
  "jsonwebtoken",
  // @nestjs/schedule 自带
  "cron",
  // 各 NestJS 包共用
  "json-schema",
  // 常见生态包（评估并加 / 移除）
  "ajv",
  "ajv-formats",
  "diff",
  "dockerode",
  "domhandler",
  "glob",
  "jszip",
  "mongodb",
  "rxjs",
  "tslib",
]);

// Node 内建模块（不在 package.json 但合法）
const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "crypto",
  "stream",
  "buffer",
  "events",
  "http",
  "https",
  "url",
  "util",
  "os",
  "child_process",
  "process",
  "querystring",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "zlib",
  "assert",
  "constants",
  "dns",
  "dgram",
  "domain",
  "module",
  "net",
  "perf_hooks",
  "punycode",
  "readline",
  "vm",
  "worker_threads",
  "async_hooks",
  "v8",
]);

// 匹配字面量包名（import "xxx" / require("xxx") / import("xxx")）
const IMPORT_RE =
  /(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "__tests__" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      yield* walk(full);
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      yield full;
    }
  }
}

function extractPackageName(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("@/")) return null; // 项目内 alias
  if (spec.startsWith("node:")) return null;
  if (spec.includes("${")) return null; // template literal 动态字符串误匹配，跳过
  if (NODE_BUILTINS.has(spec)) return null;
  // @scope/pkg 或 pkg；子路径 pkg/foo/bar 只取首段
  let pkg: string;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    pkg = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  } else {
    pkg = spec.split("/")[0];
  }
  // 二次检查首段是否是 Node 内建（如 "fs/promises" → first=fs）
  if (NODE_BUILTINS.has(pkg)) return null;
  return pkg;
}

function main(): void {
  const srcDir = join(ROOT, "backend", "src");
  const missing = new Map<string, Set<string>>(); // pkg → files

  for (const file of walk(srcDir)) {
    const content = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const spec = m[1];
      const pkg = extractPackageName(spec);
      if (!pkg) continue;
      if (KNOWN_DEPS.has(pkg)) continue;
      if (KNOWN_TRANSITIVES.has(pkg)) continue;
      if (!missing.has(pkg)) missing.set(pkg, new Set());
      missing.get(pkg)!.add(file.replace(ROOT, "").replace(/\\/g, "/"));
    }
  }

  if (missing.size === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[audit-runtime-deps] OK — all backend imports declared in package.json`,
    );
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(
    `[audit-runtime-deps] ✘ ${missing.size} package(s) imported but NOT declared in backend/package.json or root package.json:\n`,
  );
  const sorted = Array.from(missing.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [pkg, files] of sorted) {
    // eslint-disable-next-line no-console
    console.error(`  ✘ ${pkg}`);
    const fileList = Array.from(files).slice(0, 3);
    for (const f of fileList) {
      // eslint-disable-next-line no-console
      console.error(`      ${f}`);
    }
    if (files.size > 3) {
      // eslint-disable-next-line no-console
      console.error(`      ...(${files.size - 3} more)`);
    }
  }
  // eslint-disable-next-line no-console
  console.error(`\n修复：把缺失包加入 backend/package.json dependencies。`);
  process.exit(1);
}

main();
