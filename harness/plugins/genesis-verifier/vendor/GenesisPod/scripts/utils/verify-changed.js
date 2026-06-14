#!/usr/bin/env node

/**
 * 智能变更检测验证脚本
 *
 * 根据 git diff 检测变更的文件，只运行相关的验证任务
 * 使用方法: npm run verify:changed
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getChangedFiles() {
  try {
    // 检查未暂存的变更
    const unstaged = execSync("git diff --name-only", { encoding: "utf-8" })
      .split("\n")
      .filter(Boolean);

    // 检查已暂存的变更
    const staged = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
    })
      .split("\n")
      .filter(Boolean);

    // 合并并去重
    return [...new Set([...unstaged, ...staged])];
  } catch (e) {
    log("Warning: Unable to get git diff, running full verification", "yellow");
    return null;
  }
}

function runCommand(name, cmd, cwd = process.cwd()) {
  log(`\n[${name}]`, "cyan");

  const startTime = Date.now();
  const result = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    cwd,
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  if (result.status === 0) {
    log(`✓ ${name} passed (${duration}s)`, "green");
    return true;
  } else {
    log(`✗ ${name} failed (${duration}s)`, "red");
    return false;
  }
}

function main() {
  log("\n========================================", "blue");
  log("  GenesisPod - 智能变更验证", "blue");
  log("========================================\n", "blue");

  const changedFiles = getChangedFiles();

  if (changedFiles === null) {
    // 无法获取变更，运行完整验证
    log("Running full verification...", "yellow");
    const success = runCommand("Full Validation", "npm run verify:quick");
    process.exit(success ? 0 : 1);
  }

  if (changedFiles.length === 0) {
    log("No changes detected. Nothing to verify.", "green");
    process.exit(0);
  }

  log(`Detected ${changedFiles.length} changed file(s):`, "cyan");
  changedFiles.slice(0, 10).forEach((f) => log(`  - ${f}`));
  if (changedFiles.length > 10) {
    log(`  ... and ${changedFiles.length - 10} more`);
  }

  // 分析变更类型
  const hasFrontendChanges = changedFiles.some((f) =>
    f.startsWith("frontend/"),
  );
  const hasBackendChanges = changedFiles.some((f) => f.startsWith("backend/"));
  const hasPrismaChanges = changedFiles.some((f) =>
    f.includes("prisma/schema.prisma"),
  );
  const hasAiServiceChanges = changedFiles.some((f) =>
    f.startsWith("ai-service/"),
  );
  const hasRootChanges = changedFiles.some(
    (f) => !f.includes("/") || f.startsWith("scripts/"),
  );

  const tasks = [];

  // Prisma 变更
  if (hasPrismaChanges) {
    tasks.push({
      name: "Prisma Format",
      cmd: "npx prisma format",
      cwd: path.join(process.cwd(), "backend"),
    });
    tasks.push({
      name: "Prisma Generate",
      cmd: "npx prisma generate",
      cwd: path.join(process.cwd(), "backend"),
    });
    tasks.push({
      name: "Prisma Validate",
      cmd: "npx prisma validate",
      cwd: path.join(process.cwd(), "backend"),
    });
  }

  // 后端变更
  if (hasBackendChanges || hasPrismaChanges) {
    tasks.push({
      name: "Backend Type Check",
      cmd: "npm run type-check",
      cwd: path.join(process.cwd(), "backend"),
    });
    tasks.push({
      name: "Backend Quick Test",
      cmd: "npm run test:quick",
      cwd: path.join(process.cwd(), "backend"),
    });
  }

  // 前端变更
  if (hasFrontendChanges) {
    tasks.push({
      name: "Frontend Type Check",
      cmd: "npm run type-check",
      cwd: path.join(process.cwd(), "frontend"),
    });
    tasks.push({
      name: "Frontend Test",
      cmd: "npm run test",
      cwd: path.join(process.cwd(), "frontend"),
    });
  }

  // AI 服务变更
  if (hasAiServiceChanges) {
    tasks.push({
      name: "AI Service Check",
      cmd: "python -m py_compile main.py",
      cwd: path.join(process.cwd(), "ai-service"),
    });
  }

  // 根目录配置变更
  if (hasRootChanges && !hasFrontendChanges && !hasBackendChanges) {
    log(
      "\nRoot configuration changes detected. Consider running full validation.",
      "yellow",
    );
  }

  if (tasks.length === 0) {
    log("\nNo relevant source code changes detected.", "green");
    process.exit(0);
  }

  log(`\nRunning ${tasks.length} verification task(s)...`, "cyan");

  let allPassed = true;
  const results = [];

  for (const task of tasks) {
    const passed = runCommand(task.name, task.cmd, task.cwd);
    results.push({ name: task.name, passed });
    if (!passed) {
      allPassed = false;
      // 继续运行其他任务以收集所有错误
    }
  }

  // 输出总结
  log("\n========================================", "blue");
  log("  验证结果总结", "blue");
  log("========================================\n", "blue");

  results.forEach((r) => {
    const icon = r.passed ? "✓" : "✗";
    const color = r.passed ? "green" : "red";
    log(`  ${icon} ${r.name}`, color);
  });

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  log(
    `\n${passedCount}/${totalCount} tasks passed`,
    allPassed ? "green" : "red",
  );

  if (allPassed) {
    log("\n✓ All verifications passed! Ready to commit.", "green");
  } else {
    log("\n✗ Some verifications failed. Please fix the issues above.", "red");
  }

  process.exit(allPassed ? 0 : 1);
}

main();
