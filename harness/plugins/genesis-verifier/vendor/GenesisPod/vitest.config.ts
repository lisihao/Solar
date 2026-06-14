/**
 * 根 vitest 配置 — 防"在根目录直跑 vitest 扫错文件"。
 *
 * P35 (2026-05-24): 解决以下假失败:
 *   1. .claude/worktrees/** 内大量 spec 被扫入(都是历史 sub-agent worktree 残留)
 *   2. backend/ 用 Jest 不是 Vitest,vitest 跑后端 spec → "describe is not defined"
 *
 * 正确入口:
 *   - 前端:cd frontend && npm test(用 frontend/vitest.config.ts)
 *   - 后端 architecture:npm run verify:arch(根 wire,实际跑 backend jest)
 *   - 后端全测:cd backend && npm test
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      ".claude/worktrees/**", // 排除所有 sub-agent worktree(历史残留 + 当前活跃 agent 不参与根测试)
      "backend/**", // backend 用 Jest 不是 Vitest,根 vitest 不应扫
      "frontend/**", // frontend 有自己的 vitest.config.ts,cd frontend 跑
      "dist/**",
      ".next/**",
    ],
  },
});
