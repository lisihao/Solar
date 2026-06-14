/**
 * Commitlint Configuration
 *
 * 遵循 Conventional Commits 规范
 * https://www.conventionalcommits.org/
 *
 * 格式: <type>(<scope>): <subject>
 *
 * 示例:
 * - feat(resources): add thumbnail generation
 * - fix(auth): resolve token expiration issue
 * - docs(api): update API documentation
 * - test(resources): add unit tests for service layer
 */

module.exports = {
  extends: ["@commitlint/config-conventional"],

  rules: {
    // Type枚举
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新功能
        "fix", // Bug修复
        "docs", // 文档变更
        "style", // 代码格式（不影响代码运行的变动）
        "refactor", // 重构（既不是新增功能，也不是修复bug）
        "perf", // 性能优化
        "test", // 增加测试
        "build", // 构建过程或辅助工具的变动
        "ci", // CI配置文件和脚本的变动
        "chore", // 其他不修改src或test的变动
        "revert", // 回滚之前的commit
      ],
    ],

    // Type必须小写
    "type-case": [2, "always", "lower-case"],

    // Type不能为空
    "type-empty": [2, "never"],

    // Scope必须小写
    "scope-case": [2, "always", "lower-case"],

    // Subject不能为空
    "subject-empty": [2, "never"],

    // Subject不能以句号结尾
    "subject-full-stop": [2, "never", "."],

    // Subject case：允许 acronyms（PR-DR2 / R5 / API / TS 等业务术语 / 大写缩写）
    // 仅禁完整 sentence-case / start-case / pascal-case（开头大写字母 + camelCase
    // 风格），upper-case 拿掉 — 中文 subject + 业务大写缩写本来就误判
    "subject-case": [
      2,
      "never",
      ["sentence-case", "start-case", "pascal-case"],
    ],

    // Header最大长度100字符
    "header-max-length": [2, "always", 100],

    // Body每行最大长度100字符
    "body-max-line-length": [2, "always", 100],

    // Footer每行最大长度100字符
    "footer-max-line-length": [2, "always", 100],
  },

  // 自定义scope
  prompt: {
    scopes: [
      "resources",
      "users",
      "auth",
      "collections",
      "learning-paths",
      "ai-service",
      "api",
      "frontend",
      "backend",
      "prisma",
      "mongodb",
      "config",
      "deps",
      "ci",
      "docs",
    ],
  },
};
