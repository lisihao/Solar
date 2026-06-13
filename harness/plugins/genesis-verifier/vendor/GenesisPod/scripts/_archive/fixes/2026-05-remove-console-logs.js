#!/usr/bin/env node
/**
 * 清理前端代码中的 console.log
 *
 * 规则：
 * 1. 删除所有 console.log（除了在 next.config.js 中的）
 * 2. 保留 console.error 和 console.warn
 * 3. 保留 logger.log 等工具方法
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 要排除的文件
const EXCLUDED_FILES = [
  "next.config.js", // 构建配置，需要 console.log
  "logger.ts", // logger 工具本身
];

let totalRemoved = 0;
let filesModified = 0;
const modifiedFiles = [];

/**
 * 检查文件是否应该被排除
 */
function shouldExcludeFile(filePath) {
  const fileName = path.basename(filePath);
  return EXCLUDED_FILES.includes(fileName);
}

/**
 * 移除文件中的 console.log
 */
function processFile(filePath) {
  if (shouldExcludeFile(filePath)) {
    console.log(`⊘ Skipping ${path.relative(process.cwd(), filePath)}`);
    return;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const newLines = [];
    let removedInFile = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // 检查是否是 console.log 行
      if (trimmed.startsWith("console.log(")) {
        // 检查是否在同一行结束
        if (trimmed.includes(");")) {
          // 单行 console.log，跳过这一行
          removedInFile++;
          i++;
          continue;
        } else {
          // 多行 console.log，找到结束位置
          removedInFile++;
          i++;
          while (i < lines.length) {
            const nextLine = lines[i];
            i++;
            if (nextLine.includes(");")) {
              break; // 找到结束
            }
          }
          continue;
        }
      }

      // 保留这一行
      newLines.push(line);
      i++;
    }

    if (removedInFile > 0) {
      // 清理多余的空行（超过2个连续空行）
      let result = newLines.join("\n");
      result = result.replace(/\n\n\n+/g, "\n\n");

      fs.writeFileSync(filePath, result, "utf8");
      filesModified++;
      totalRemoved += removedInFile;
      modifiedFiles.push(path.relative(process.cwd(), filePath));

      console.log(
        `✓ ${path.relative(process.cwd(), filePath)}: removed ${removedInFile} console.log`,
      );
    }
  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
  }
}

/**
 * 使用 git grep 找到所有包含 console.log 的文件
 */
function findFilesWithConsoleLogs() {
  try {
    const output = execSync('git grep -l "console\\.log(" -- frontend/', {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    // 如果没有找到文件，git grep 会返回错误
    if (error.status === 1) {
      return [];
    }
    throw error;
  }
}

// 主函数
function main() {
  console.log("🔍 Searching for files with console.log...\n");

  const files = findFilesWithConsoleLogs();

  if (files.length === 0) {
    console.log("✨ No console.log found in frontend code!");
    return;
  }

  console.log(`Found ${files.length} files with console.log\n`);
  console.log("🧹 Processing files...\n");

  files.forEach((file) => {
    const fullPath = path.join(process.cwd(), file);
    processFile(fullPath);
  });

  console.log("\n" + "=".repeat(60));
  console.log(`📊 Summary:`);
  console.log(`   Files checked: ${files.length}`);
  console.log(`   Files modified: ${filesModified}`);
  console.log(`   console.log removed: ${totalRemoved}`);
  console.log("=".repeat(60));

  if (filesModified > 0) {
    console.log("\n📝 Modified files:");
    modifiedFiles.forEach((f) => console.log(`   - ${f}`));

    console.log("\n⚠️  Next steps:");
    console.log("   1. Review the changes: git diff");
    console.log("   2. Run type-check: npm run type-check");
    console.log("   3. Test the application");
  }
}

main();
