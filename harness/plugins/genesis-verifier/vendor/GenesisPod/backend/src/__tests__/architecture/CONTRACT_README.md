# Contract Specs · 阶段映射 + Baseline 更新流程

> 本目录下 `*.contract.spec.ts` 是 v3.1 §0.5 阶段 0 的**现状锁定 jest spec**。
> 与一般架构边界 spec（如 `layer-boundaries.spec.ts`）不同，contract spec **预期
> 会随着 v3.1 演进路线图 A → D 阶段同步更新或删除**——它们是"现状的契约快照"，
> 不是"永恒不变的约束"。

## 1. Spec → 阶段映射表（何时该删 / 改）

| Contract Spec                                         | 锁定对象                                                                  | 阶段 → 动作                                                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aimodelconfig-dual-source.contract.spec.ts`          | 双源 `export interface AIModelConfig`（legacy + canonical），字段超集关系 | **阶段 A0（双源合并）**：删除 legacy 时本 spec 必须改为"单源" assert（删 (a)(b)(c) 改成断言 canonical 唯一），或整体删除并由新 single-source spec 替代                                        |
| `provider-default-chains-shape.contract.spec.ts`      | `PROVIDER_DEFAULT_CHAINS` 常量条目数 / 形态 / chain 长度上限              | **阶段 C（推断逻辑下沉）**：常量删除时本 spec 必须同步删除，并新建迁移目标位置的等价 shape spec（如 model-registry 内 inferStrategyChain 的契约）                                             |
| `structured-output-strategy-readers.contract.spec.ts` | 7 个 §3.x 扩展字段的"读者基线"（PropertyAccess + element-access + 解构）  | **阶段 D**：fallback / strategy 读取下沉时 `structuredOutputStrategy` / `fallbackStrategies` 部分必须同步更新读者集合。**阶段 D6**：删除 5 个 `supports_*` bool 字段时整段 `it.each` 必须删除 |
| `infer-is-reasoning-callers.contract.spec.ts`         | `inferIsReasoning(...)` 共享纯函数的直接调用方"文件 → 次数"基线           | **阶段 D（能力推断收口）**：调用方收敛到 1-2 处后本 spec 改为更严格的"最多 N 处"断言；推断逻辑迁入 model registry 后本 spec 整体删除                                                          |

> 任何 PR 让上述 spec 红 = 触发"是否在正确阶段动 contract"的强制对话——
> **不允许仅凭"调一下 baseline 就过"**。必须在 PR 描述中说明阶段归属。

## 2. Baseline 更新流程（变更 contract baseline 的强制规范）

当某 PR 合理地需要更新基线（新增/删除字段、新增/删除调用方、调整 chain 长度等），
**PR 描述必须包含以下三项**，缺一不可：

1. **阶段归属**：本变更属于 v3.1 路线图哪一阶段（A0 / B / C / D / D6 / …）。如果
   不在已规划阶段内（例如属于阶段 0 内部的合法增量），写明"阶段 0 内部增量 ·
   {reason}"。
2. **责任人**：本基线更新由谁负责后续阶段收尾（如"@xxx 负责 D6 删除 5 bool 字段
   时同步删此 it.each"）。
3. **期限**：本"中间态 baseline"预期最迟在哪个时间点 / 哪个 PR 被替换。例如
   "≤ 2026-06-30，PR-D6 合并时删除"。

### 反例（不允许）

> "微调 baseline 让 spec 重新过——结构无关变更"

→ 拒绝。任何 baseline 变更都必须能映射到阶段计划；否则说明 contract 失去意义
（不再是"现状锁"），应该走"删除 spec"流程而非"调 baseline"。

### 正例

> "PR-A0-3：合并 AIModelConfig 双源。本 PR 删除 legacy 接口，故
> `aimodelconfig-dual-source.contract.spec.ts` 的 (a)(b)(c) 三项断言失去前提，
> 同步删除本 spec 文件。阶段：A0。责任人：@xxx。期限：本 PR。"

## 3. 通用范围声明

所有 `*.contract.spec.ts` 仅扫描 **`backend/src` 运行时**：

- 排除：`__tests__/`、`node_modules/`、`dist/`、`coverage/`
- 排除文件名：`*.spec.ts` / `*.test.ts` / `*.d.ts`
- **不进入**基线：前端 admin UI 类型、Prisma schema、test fixture、文档 markdown 内
  的示例代码

如果未来需要把前端纳入同一契约（例如统一一份 AIModelConfig 类型），需新建独立
spec 并在本 README 增加一行；不要让现有 spec 跨越前后端边界。

## 4. 性能预算

contract spec 每个走全树 AST 解析，单文件预期 ≤ 5s，整套架构 spec（18 套件）
≤ 10s。如果新增 contract spec 让总耗时上涨超过 50%，必须把 `listTsFiles` +
AST 解析提到 `beforeAll` 缓存，参考
`structured-output-strategy-readers.contract.spec.ts` 的写法。

---

**最后更新**：2026-05-23（阶段 0 contract spec 评审修订引入）
