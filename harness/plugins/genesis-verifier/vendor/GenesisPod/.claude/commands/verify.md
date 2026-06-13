# Verify

验证代码质量和正确性。

$ARGUMENTS

## 验证级别

根据参数选择：

- **无参数/quick**: 快速验证 (类型检查 + 快速测试)
- **full**: 完整验证 (Lint + 类型 + 测试 + 构建)
- **frontend**: 仅前端验证
- **backend**: 仅后端验证
- **changed**: 智能检测变更并验证

## 命令映射

| 参数     | 命令                      |
| -------- | ------------------------- |
| quick    | `npm run verify:quick`    |
| full     | `npm run verify:full`     |
| frontend | `npm run verify:frontend` |
| backend  | `npm run verify:backend`  |
| changed  | `npm run verify:changed`  |

## 自愈规则

当验证失败时：

1. 分析错误信息，确定失败类型
2. 根据错误类型采取修复策略
3. 重新运行验证
4. **循环直到通过，不向用户报告中间失败**

## 修复策略

| 错误类型  | 修复策略                   |
| --------- | -------------------------- |
| 类型错误  | 修复类型定义或添加类型断言 |
| Lint 错误 | 应用 lint 修复规则         |
| 测试失败  | 修复测试或实现             |
| 构建失败  | 检查导入和依赖             |

## 禁止行为

- 不运行测试就提交代码
- 跳过类型检查
- 验证失败时询问用户是否继续
- 使用 `@ts-ignore` 或 `any` 绕过类型检查
- 注释掉失败的测试
