# TDD

测试驱动开发模式。

**功能**: $ARGUMENTS

## TDD 循环

```
┌─────────────────────────────────────────────┐
│  1. [Red]    编写失败的测试用例              │
│  2. [Verify] 运行测试确认失败                │
│  3. [Green]  编写最小实现代码                │
│  4. [Verify] 运行测试确认通过                │
│  5. [Refactor] 重构代码，保持测试通过        │
│  6. [Commit] 提交代码                        │
└─────────────────────────────────────────────┘
```

## 执行流程

### Step 1: 编写测试

```typescript
describe("FeatureName", () => {
  it("should do something when condition", async () => {
    // Arrange
    const input = createTestInput();

    // Act
    const result = await feature.process(input);

    // Assert
    expect(result).toEqual(expectedOutput);
  });
});
```

### Step 2: 验证测试失败

```bash
npm run test:quick
# 确认测试失败，原因是功能未实现
```

### Step 3: 最小实现

- 只写让测试通过的最少代码
- 不要提前优化
- 不要添加未测试的功能

### Step 4: 验证测试通过

```bash
npm run test:quick
# 确认所有测试通过
```

### Step 5: 重构

- 消除重复代码
- 改善命名
- 提取函数/类
- 保持测试通过

## 测试文件位置

```
frontend/
├── __tests__/           # 前端测试
├── components/__tests__/ # 组件测试

backend/
├── src/**/*.spec.ts     # 单元测试
├── test/                # E2E 测试
```

## 测试工具

| 层级     | 工具                  |
| -------- | --------------------- |
| 单元测试 | Jest/Vitest           |
| 组件测试 | React Testing Library |
| E2E 测试 | Playwright            |
| API 测试 | Supertest             |

## 自愈规则

- 测试失败时，自动分析原因并修复
- 循环直到测试通过
- 不询问用户中间状态

## 我会帮助你

按照 TDD 流程：先写测试，再写实现，最后重构。
