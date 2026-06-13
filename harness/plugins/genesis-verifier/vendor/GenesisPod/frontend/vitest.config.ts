import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',

    // 超时配置
    testTimeout: 10000,
    hookTimeout: 30000,

    // vmThreads requires Node 22+ for consistent vm.Module behavior.
    // CI runs Node 20, so use 'forks' there via --pool flag override.
    pool: process.env.CI ? 'forks' : 'vmThreads',

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      exclude: [
        'node_modules/',
        'vitest.setup.ts',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        'app/layout.tsx', // Next.js layout文件
        '.next/**',
      ],

      // 覆盖率阈值 - Phase 1: 50%
      // 根据测试标准文档，采用渐进式提升策略
      // Phase 1 (Week 1-2): 50%
      // Phase 2 (Week 3-6): 70%
      // Phase 3 (Week 7+): 85%
      thresholds: {
        branches: 50,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
