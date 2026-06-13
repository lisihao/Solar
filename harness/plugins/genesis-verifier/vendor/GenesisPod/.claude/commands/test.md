# Run Tests

执行项目测试并分析结果。

$ARGUMENTS

## 测试命令

根据参数选择执行：

- **无参数**: `npm run test:quick` (快速测试)
- **full**: `npm run verify:full` (完整验证)
- **frontend**: `npm run verify:frontend` (前端验证)
- **backend**: `npm run verify:backend` (后端验证)
- **file path**: `npm test -- <path>` (指定文件)

## 执行流程

1. 运行指定的测试命令
2. 分析测试输出和覆盖率
3. 如果测试失败：
   - 分析失败原因
   - 自动尝试修复
   - 重新运行验证
4. 测试通过后报告结果

## 失败处理

- **类型错误**: 修复类型定义
- **断言失败**: 检查实现是否正确
- **超时**: 检查异步操作和 mock
- **导入错误**: 检查路径和依赖

## 输出格式

```
✅ 测试通过: X passed, 0 failed
📊 覆盖率: statements X%, branches X%, functions X%, lines X%
⚠️ 建议: [如果有]
```
