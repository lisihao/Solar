#!/usr/bin/env node
/**
 * 文件命名规范检查工具
 * 用途：检查项目中的文件和目录命名是否符合 v2.1 规范
 * 规范：所有文件名必须小写（除极少数例外）
 * 使用：node scripts/check-file-naming.js [--fix]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 配置
const CONFIG = {
  // 允许的例外（仅项目根目录）
  rootExceptions: ["README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md"],

  // 检查的目录
  checkDirs: ["docs", "backend/src", "frontend", "ai-service"],

  // 排除的目录
  excludeDirs: ["node_modules", ".git", "dist", "build", ".next"],

  // React组件文件允许 PascalCase
  componentExtensions: [".tsx", ".jsx"],
};

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

// 检查结果类
class Violation {
  constructor(type, currentPath, suggestedPath, reason) {
    this.type = type; // 'file' | 'directory'
    this.currentPath = currentPath;
    this.suggestedPath = suggestedPath;
    this.reason = reason;
  }

  toString() {
    const icon = this.type === "directory" ? "📁" : "📄";
    return [
      `${icon} ${colorize(this.type.toUpperCase(), "yellow")}: ${this.currentPath}`,
      `   Reason: ${colorize(this.reason, "cyan")}`,
      `   Suggest: ${colorize(this.suggestedPath, "green")}`,
    ].join("\n");
  }
}

// 主检查器
class FileNamingChecker {
  constructor(config) {
    this.config = config;
    this.violations = [];
    this.checkedFiles = 0;
    this.checkedDirs = 0;
  }

  // 检查文件名是否需要修复
  needsRenaming(fileName, dirPath, isDirectory) {
    const relativePath = path.relative(".", path.join(dirPath, fileName));

    // 1. 检查是否是根目录例外
    const isRootException =
      this.config.rootExceptions.includes(fileName) &&
      dirPath === "." &&
      !isDirectory;

    if (isRootException) {
      return null;
    }

    // 2. React组件文件允许 PascalCase
    const ext = path.extname(fileName);
    const isComponent =
      this.config.componentExtensions.includes(ext) &&
      /^[A-Z][a-zA-Z0-9]*\.(tsx|jsx)$/.test(fileName);

    if (isComponent) {
      return null;
    }

    // 3. 检查是否全小写
    const lowerCaseFileName = fileName.toLowerCase();

    if (fileName === lowerCaseFileName) {
      return null; // 符合规范
    }

    // 4. 检查特定违规模式
    let reason = "";
    const hasUpperCase = /[A-Z]/.test(fileName);
    const hasUnderscore = /_/.test(fileName);
    const hasChinese = /[\u4e00-\u9fa5]/.test(fileName);

    if (hasUpperCase && hasUnderscore) {
      reason = "Uses UPPER_CASE (should be lowercase with hyphens)";
    } else if (hasUpperCase) {
      reason = "Contains uppercase letters (should be all lowercase)";
    } else if (hasChinese) {
      reason = "Contains Chinese characters (should use English)";
    } else {
      reason = "Non-compliant naming";
    }

    return {
      currentPath: relativePath,
      suggestedPath: path.join(path.dirname(relativePath), lowerCaseFileName),
      reason,
    };
  }

  // 遍历目录
  traverse(dir) {
    // 检查是否需要排除
    const baseName = path.basename(dir);
    if (this.config.excludeDirs.includes(baseName)) {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      console.error(
        colorize(`Error reading directory ${dir}: ${error.message}`, "red"),
      );
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.checkedDirs++;

        // 检查目录名
        const violation = this.needsRenaming(entry.name, dir, true);
        if (violation) {
          this.violations.push(
            new Violation(
              "directory",
              violation.currentPath,
              violation.suggestedPath,
              violation.reason,
            ),
          );
        }

        // 递归检查子目录
        this.traverse(fullPath);
      } else if (entry.isFile()) {
        this.checkedFiles++;

        // 检查文件名
        const violation = this.needsRenaming(entry.name, dir, false);
        if (violation) {
          this.violations.push(
            new Violation(
              "file",
              violation.currentPath,
              violation.suggestedPath,
              violation.reason,
            ),
          );
        }
      }
    }
  }

  // 运行检查
  run() {
    console.log(colorize("\n========================================", "blue"));
    console.log(colorize("  文件命名规范检查工具", "blue"));
    console.log(colorize("========================================\n", "blue"));

    console.log(
      `检查规则：所有文件名必须小写（${this.config.rootExceptions.length} 个例外）\n`,
    );

    for (const dir of this.config.checkDirs) {
      if (fs.existsSync(dir)) {
        console.log(
          `${colorize("🔍", "yellow")} 检查目录: ${colorize(dir, "cyan")}`,
        );
        this.traverse(dir);
      } else {
        console.log(`${colorize("⚠️", "yellow")} 跳过不存在的目录: ${dir}`);
      }
    }

    console.log(
      `\n已检查: ${colorize(this.checkedFiles, "cyan")} 个文件, ${colorize(this.checkedDirs, "cyan")} 个目录\n`,
    );

    return this.violations;
  }

  // 打印结果
  printResults(violations) {
    if (violations.length === 0) {
      console.log(colorize("✅ 太棒了！所有文件命名都符合规范！", "green"));
      return;
    }

    console.log(
      colorize(`\n❌ 发现 ${violations.length} 个命名违规：\n`, "red"),
    );

    // 按类型分组
    const byType = {
      file: violations.filter((v) => v.type === "file"),
      directory: violations.filter((v) => v.type === "directory"),
    };

    if (byType.directory.length > 0) {
      console.log(colorize("📁 目录命名违规：", "magenta"));
      byType.directory.forEach((v) => console.log(v.toString() + "\n"));
    }

    if (byType.file.length > 0) {
      console.log(colorize("📄 文件命名违规：", "magenta"));
      byType.file.forEach((v) => console.log(v.toString() + "\n"));
    }

    // 统计
    console.log(colorize("========================================", "blue"));
    console.log("统计信息：");
    console.log(`  目录违规: ${colorize(byType.directory.length, "red")}`);
    console.log(`  文件违规: ${colorize(byType.file.length, "red")}`);
    console.log(`  总计: ${colorize(violations.length, "red")}`);
    console.log(colorize("========================================\n", "blue"));

    // 建议
    console.log(colorize("💡 建议操作：", "yellow"));
    console.log("1. 审查上述违规清单");
    console.log("2. 运行批量重命名脚本：");
    console.log(
      colorize("   ./scripts/rename-docs-lowercase.sh --dry-run", "cyan"),
    );
    console.log("3. 确认无误后执行：");
    console.log(colorize("   ./scripts/rename-docs-lowercase.sh", "cyan"));
    console.log("4. 更新文档链接：");
    console.log(colorize("   ./scripts/update-doc-links.sh", "cyan"));
    console.log();
  }

  // 生成修复脚本
  generateFixScript(violations, outputPath = "scripts/auto-rename.sh") {
    const lines = [
      "#!/bin/bash",
      "# 自动生成的文件重命名脚本",
      "# 生成时间: " + new Date().toISOString(),
      "",
      "set -e",
      "",
      'echo "开始修复文件命名..."',
      "",
    ];

    violations.forEach((v) => {
      lines.push(`# ${v.reason}`);
      lines.push(`git mv "${v.currentPath}" "${v.suggestedPath}"`);
      lines.push("");
    });

    lines.push('echo "✅ 修复完成！"');
    lines.push('echo "请检查修改并提交："');
    lines.push('echo "  git add -A"');
    lines.push(
      'echo "  git commit -m \\"refactor: fix file naming violations\\""',
    );

    const script = lines.join("\n");
    fs.writeFileSync(outputPath, script, { mode: 0o755 });

    console.log(colorize(`\n📝 已生成修复脚本: ${outputPath}`, "green"));
    console.log(colorize("   运行脚本: ./" + outputPath, "cyan"));
  }
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");
  const shouldGenerateScript = args.includes("--generate-script");

  const checker = new FileNamingChecker(CONFIG);
  const violations = checker.run();

  checker.printResults(violations);

  if (shouldGenerateScript && violations.length > 0) {
    checker.generateFixScript(violations);
  }

  // 退出码
  process.exit(violations.length > 0 ? 1 : 0);
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { FileNamingChecker, Violation };
