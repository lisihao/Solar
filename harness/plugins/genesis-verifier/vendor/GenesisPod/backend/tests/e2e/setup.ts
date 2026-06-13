/**
 * E2E 测试全局设置
 *
 * 运行 E2E 测试前，请确保：
 * 1. 数据库服务正在运行
 * 2. 设置 DATABASE_URL 环境变量指向测试数据库
 *
 * 示例：
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/deepdive_test npm run test:e2e
 */

// 设置测试超时时间
jest.setTimeout(30000);

// 清理环境变量
process.env.NODE_ENV = "test";

// 禁用日志噪音
process.env.LOG_LEVEL = "error";

// 模拟 JWT 密钥
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-secret-key-for-e2e-testing";
}

// 全局清理
afterAll(async () => {
  // 确保所有连接关闭
  await new Promise((resolve) => setTimeout(resolve, 500));
});
