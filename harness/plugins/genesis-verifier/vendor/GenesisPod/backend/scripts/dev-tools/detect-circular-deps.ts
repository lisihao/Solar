#!/usr/bin/env tsx
/**
 * 循环依赖检测脚本
 *
 * 功能：
 * 1. 扫描所有 .module.ts 文件
 * 2. 解析 imports 数组
 * 3. 构建模块依赖图
 * 4. 检测所有循环
 * 5. 检查循环中是否都使用了 forwardRef
 *
 * 使用：npx tsx scripts/detect-circular-deps.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";

interface ModuleInfo {
  name: string;
  filePath: string;
  imports: Array<{
    moduleName: string;
    hasForwardRef: boolean;
    line: number;
  }>;
}

interface Cycle {
  path: string[];
  missingForwardRef: Array<{ from: string; to: string; line: number }>;
}

// 扫描所有模块文件
function findModuleFiles(srcDir: string): string[] {
  return glob.sync("**/*.module.ts", {
    cwd: srcDir,
    absolute: true,
    ignore: ["**/node_modules/**", "**/*.spec.ts", "**/*.test.ts"],
  });
}

// 解析模块文件，提取 imports
function parseModuleFile(filePath: string): ModuleInfo | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // 提取模块名
  const classMatch = content.match(/export\s+class\s+(\w+Module)/);
  if (!classMatch) return null;

  const moduleName = classMatch[1];
  const imports: ModuleInfo["imports"] = [];

  // 查找 @Module 装饰器中的 imports
  const moduleDecoratorMatch = content.match(
    /@Module\s*\(\s*\{[\s\S]*?imports\s*:\s*\[([\s\S]*?)\]/,
  );
  if (!moduleDecoratorMatch) {
    return { name: moduleName, filePath, imports: [] };
  }

  const importsContent = moduleDecoratorMatch[1];

  // 解析每个 import
  // 匹配: ModuleName, forwardRef(() => ModuleName), 等
  const importPatterns = [
    // forwardRef(() => ModuleName)
    /forwardRef\s*\(\s*\(\)\s*=>\s*(\w+Module)\s*\)/g,
    // 直接模块名
    /(?<!\w)(\w+Module)(?!\w)/g,
  ];

  // 先找所有 forwardRef 的模块
  const forwardRefModules = new Set<string>();
  const forwardRefPattern = /forwardRef\s*\(\s*\(\)\s*=>\s*(\w+Module)\s*\)/g;
  let match;
  while ((match = forwardRefPattern.exec(importsContent)) !== null) {
    forwardRefModules.add(match[1]);
  }

  // 找所有模块名
  const modulePattern = /(?:forwardRef\s*\(\s*\(\)\s*=>\s*)?(\w+Module)/g;
  const seenModules = new Set<string>();

  while ((match = modulePattern.exec(importsContent)) !== null) {
    const importedModule = match[1];
    if (importedModule === moduleName) continue; // 跳过自引用
    if (seenModules.has(importedModule)) continue;
    seenModules.add(importedModule);

    // 找到这行在文件中的位置
    const lineIndex = lines.findIndex(
      (line) =>
        line.includes(importedModule) &&
        (line.includes("imports") ||
          line.includes("forwardRef") ||
          /^\s*\w+Module/.test(line.trim())),
    );

    imports.push({
      moduleName: importedModule,
      hasForwardRef: forwardRefModules.has(importedModule),
      line: lineIndex + 1,
    });
  }

  return { name: moduleName, filePath, imports };
}

// 构建依赖图
function buildDependencyGraph(modules: ModuleInfo[]): Map<string, ModuleInfo> {
  const graph = new Map<string, ModuleInfo>();
  for (const mod of modules) {
    graph.set(mod.name, mod);
  }
  return graph;
}

// 检测循环 (DFS)
function findCycles(graph: Map<string, ModuleInfo>): Cycle[] {
  const cycles: Cycle[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(moduleName: string): void {
    if (recursionStack.has(moduleName)) {
      // 找到循环
      const cycleStartIndex = pathStack.indexOf(moduleName);
      if (cycleStartIndex !== -1) {
        const cyclePath = [...pathStack.slice(cycleStartIndex), moduleName];

        // 检查循环中哪些边缺少 forwardRef
        const missingForwardRef: Cycle["missingForwardRef"] = [];
        for (let i = 0; i < cyclePath.length - 1; i++) {
          const from = cyclePath[i];
          const to = cyclePath[i + 1];
          const fromModule = graph.get(from);
          if (fromModule) {
            const imp = fromModule.imports.find((i) => i.moduleName === to);
            if (imp && !imp.hasForwardRef) {
              missingForwardRef.push({ from, to, line: imp.line });
            }
          }
        }

        cycles.push({ path: cyclePath, missingForwardRef });
      }
      return;
    }

    if (visited.has(moduleName)) return;

    visited.add(moduleName);
    recursionStack.add(moduleName);
    pathStack.push(moduleName);

    const moduleInfo = graph.get(moduleName);
    if (moduleInfo) {
      for (const imp of moduleInfo.imports) {
        if (graph.has(imp.moduleName)) {
          dfs(imp.moduleName);
        }
      }
    }

    pathStack.pop();
    recursionStack.delete(moduleName);
  }

  for (const moduleName of graph.keys()) {
    visited.clear();
    recursionStack.clear();
    pathStack.length = 0;
    dfs(moduleName);
  }

  // 去重（同一个循环可能被检测多次）
  const uniqueCycles = new Map<string, Cycle>();
  for (const cycle of cycles) {
    const key = [...cycle.path].sort().join("->");
    if (!uniqueCycles.has(key) || cycle.missingForwardRef.length > 0) {
      uniqueCycles.set(key, cycle);
    }
  }

  return Array.from(uniqueCycles.values());
}

// 检查 barrel export 问题
function checkBarrelExports(
  modules: ModuleInfo[],
): Array<{ module: string; file: string; line: number }> {
  const issues: Array<{ module: string; file: string; line: number }> = [];

  for (const mod of modules) {
    const content = fs.readFileSync(mod.filePath, "utf-8");
    const lines = content.split("\n");

    // 检查是否有从 barrel export 导入模块的情况
    // 例如: import { AiEngineModule } from "../../ai-engine"
    const barrelImportPattern =
      /import\s*\{[^}]*Module[^}]*\}\s*from\s*["']([^"']+)["']/g;
    let match;

    while ((match = barrelImportPattern.exec(content)) !== null) {
      const importPath = match[1];
      // 如果路径不以 .module 结尾，可能是 barrel export
      if (
        importPath.includes("/ai-engine") &&
        !importPath.includes(".module") &&
        !importPath.includes("/index")
      ) {
        const lineIndex = lines.findIndex((line) => line.includes(match[0]));
        issues.push({
          module: mod.name,
          file: mod.filePath,
          line: lineIndex + 1,
        });
      }
    }
  }

  return issues;
}

// 主函数
async function main() {
  console.log("🔍 扫描模块依赖...\n");

  const srcDir = path.join(__dirname, "..", "src");
  const moduleFiles = findModuleFiles(srcDir);

  console.log(`找到 ${moduleFiles.length} 个模块文件\n`);

  // 解析所有模块
  const modules: ModuleInfo[] = [];
  for (const file of moduleFiles) {
    const info = parseModuleFile(file);
    if (info && info.imports.length > 0) {
      modules.push(info);
    }
  }

  console.log(`解析了 ${modules.length} 个有 imports 的模块\n`);

  // 构建依赖图
  const graph = buildDependencyGraph(modules);

  // 检测循环
  console.log("=".repeat(60));
  console.log("循环依赖检测");
  console.log("=".repeat(60));

  const cycles = findCycles(graph);
  const problematicCycles = cycles.filter(
    (c) => c.missingForwardRef.length > 0,
  );

  if (problematicCycles.length === 0) {
    console.log("\n✅ 未发现缺少 forwardRef 的循环依赖\n");
  } else {
    console.log(`\n❌ 发现 ${problematicCycles.length} 个有问题的循环:\n`);

    for (const cycle of problematicCycles) {
      console.log(`循环路径: ${cycle.path.join(" → ")}`);
      console.log("缺少 forwardRef 的边:");
      for (const missing of cycle.missingForwardRef) {
        const mod = graph.get(missing.from);
        const relativePath = mod
          ? path.relative(srcDir, mod.filePath)
          : "unknown";
        console.log(`  - ${missing.from} → ${missing.to}`);
        console.log(`    文件: ${relativePath}`);
      }
      console.log("");
    }
  }

  // 检查 barrel export
  console.log("=".repeat(60));
  console.log("Barrel Export 检查");
  console.log("=".repeat(60));

  const barrelIssues = checkBarrelExports(modules);

  if (barrelIssues.length === 0) {
    console.log("\n✅ 未发现 barrel export 导入模块的问题\n");
  } else {
    console.log(`\n⚠️  发现 ${barrelIssues.length} 个 barrel export 问题:\n`);
    for (const issue of barrelIssues) {
      const relativePath = path.relative(srcDir, issue.file);
      console.log(`  - ${issue.module}`);
      console.log(`    文件: ${relativePath}:${issue.line}`);
    }
    console.log("");
  }

  // 总结
  console.log("=".repeat(60));
  console.log("总结");
  console.log("=".repeat(60));

  const totalIssues = problematicCycles.length + barrelIssues.length;
  if (totalIssues === 0) {
    console.log("\n✅ 所有检查通过！\n");
    process.exit(0);
  } else {
    console.log(`\n❌ 发现 ${totalIssues} 个问题需要修复\n`);
    process.exit(1);
  }
}

main().catch(console.error);
