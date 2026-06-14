# Arch Guard - 架构看护快速检查 (v2.0 - 8 项检查)

对当前工作区的**近期变更**进行架构合规快速扫描：

$ARGUMENTS

## 8 项检查（含严重度分级）

### BLOCKS PR（阻断级 - 有违规必须修复才能合并）

| #   | 检查项      | 说明                                                    |
| --- | ----------- | ------------------------------------------------------- |
| 1   | Facade 边界 | AI App 是否绕过 AIEngineFacade 直接导入 Engine 内部路径 |
| 2   | 反向依赖    | AI Engine 是否导入了 AI App 模块                        |

### WARNING（警告级 - 应修复但不阻断合并）

| #   | 检查项                | 说明                               | NEW? |
| --- | --------------------- | ---------------------------------- | ---- |
| 3   | LLM 硬编码            | 硬编码模型名/temperature/maxTokens |      |
| 4   | 静默错误吞没          | `.catch(() => {})` 等空 catch 模式 | NEW  |
| 5   | DTO 缺少校验          | 新增 DTO 无 class-validator 装饰器 | NEW  |
| 6   | Controller 缺少 Guard | 新增端点无 @UseGuards/@Public      | NEW  |
| 7   | Schema 无迁移         | Prisma schema 变更但无迁移 SQL     | NEW  |
| 8   | ESLint 覆盖缺口       | 新增 Engine 子目录未加入限制规则   |      |

## 执行方式

```
Task({ subagent_type: "arch-guardian", prompt: "检查近期变更..." })
```

## 输出预期

- BLOCKS PR / WARNING 分级状态
- 具体违规文件、行号、违规内容
- 修复建议
- 结论：通过 / 需修复后重新检查

## 适用场景

- PR 提交前的快速自检（BLOCKS PR 级别有问题则阻断）
- 完成 AI Engine 相关功能后的即时验证
- 新增 DTO/Controller/Schema 后检查规范合规
- 新增 ai-engine 子模块后检查规则覆盖
