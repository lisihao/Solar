# Arch Audit - 全量架构审计 (v2.0 - 12 维度)

对整个代码库进行深度 12 维度架构合规扫描，生成持久化审计报告：

$ARGUMENTS

## 12 维度评分模型（满分 100 分）

| #   | 维度                | 分值 | 检查内容                                                     |
| --- | ------------------- | ---- | ------------------------------------------------------------ |
| 1   | Facade 边界         | 15   | ai-app/mcp/public-api 对 ai-engine 的 import 必须通过 facade |
| 2   | 依赖方向            | 8    | 无反向依赖、无跨 App 直接依赖、模块隔离                      |
| 3   | LLM 调用规范        | 8    | 无硬编码 model/temperature/maxTokens、无直接 SDK             |
| 4   | 注册与生命周期      | 5    | onModuleInit 注册模式、forwardRef 合理性                     |
| 5   | **API 设计质量**    | 10   | DTO validation、Swagger 注解、Auth Guard、限流               |
| 6   | **错误处理健壮性**  | 10   | 无静默 catch、异常一致性、WebSocket 错误处理                 |
| 7   | 代码健康度          | 10   | any 类型、文件体积、@ts-ignore、console.log、品牌名          |
| 8   | **数据库与 Schema** | 8    | FK 索引对齐、命名规范、迁移对齐、JSON 字段注释               |
| 9   | **安全态势**        | 10   | safeCompare、SQL 注入防护、密钥管理、CORS                    |
| 10  | **测试与 QA**       | 8    | 测试文件比、Controller spec 覆盖、关键路径测试               |
| 11  | **可观测性**        | 4    | Logger 一致性、健康检查端点、Trace 覆盖                      |
| 12  | **配置与依赖**      | 4    | ConfigService 采用率、ESLint 覆盖、依赖健康                  |

**加粗** = v2.0 新增维度

## 输出

审计报告保存至：`docs/audit/architecture-audit-YYYY-MM-DD.md`

包含：

- 12 维度评分明细
- 评分模型迁移说明（v1.0 → v2.0）
- 按模块汇总的违规明细
- 架构债务优先级矩阵（P0-P3）
- 与上次审计的对比趋势
- 具体行动项清单

## 执行时机

- 每月定期执行，建立健康趋势
- 重大重构完成后验证效果
- Release 前确保架构合规

## 注意

全量 12 维度扫描耗时较长，建议在非紧急场景使用。
日常快速检查请使用 `/arch-guard`（8 项检查，秒级响应）。
