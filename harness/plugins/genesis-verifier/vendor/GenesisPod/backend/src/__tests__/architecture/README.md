# 架构看护规则 (Architecture Guard Rules)

> 本目录用 jest spec 落地 [ARCHITECTURE_RULES.md](../../../../docs/architecture/ARCHITECTURE_RULES.md)
> 的 6 层 + 8 硬规则。任何架构违规先被 spec 接住；改不掉只能登记
> [EXCEPTIONS.md](../../../../docs/architecture/EXCEPTIONS.md)。

---

## 1. 子目录组织（6 层 → 子目录）

| 子目录                 | 对应规则                                 | 干嘛                                                                  |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `layer-1-topology/`    | 第 1-2 层 拓扑 + 依赖方向                | ai-app → harness → engine → infra 单向 / facade 穿透 / DI 边界        |
| `layer-3-authority/`   | 第 3 层 权威（canonical truth）          | mission view 单一真相、event 契约、agent-team facade                  |
| `layer-4-vocabulary/`  | 第 4 层 词汇纯净 + 硬规则 #2/#3          | harness/engine 不出现 app-specific 业务词                             |
| `layer-6-durability/`  | 第 6 层 持久 + 可观察 + 硬规则 #6        | projector 是纯函数、replay 幂等                                       |
| `layer-7-uplift-gate/` | 上提门 + 硬规则 #7                       | harness 新文件必须 ≥2 mission app consumer                            |
| `model-capability/`    | 横向：model / capability / safety domain | aimodelconfig 单源、provider chain shape、pricing、seed governance 等 |
| `runtime-contracts/`   | 横向：runtime / plugin / protection-net  | snapshot contract、plugin 系统、protection-net、consistency           |

> 第 5 层（前端封闭）→ 实际 spec 在 `frontend/__tests__/` 下，不放本目录。
> 第 8 层（例外登记）→ `docs/architecture/EXCEPTIONS.md`，不是 spec。

每个子目录可放一个本地 `README.md` 说明该层规则细节（可选）。

---

## 2. 命名规范

| 命名段               | 用途                                          | 示例                                           |
| -------------------- | --------------------------------------------- | ---------------------------------------------- |
| `*.spec.ts`          | 普通架构断言（永久守护）                      | `vocab-purity.spec.ts`                         |
| `*.contract.spec.ts` | 现状契约快照（随路线图阶段更新/删除）         | `aimodelconfig-single-source.contract.spec.ts` |
| `*-baseline.spec.ts` | 含 baseline 的过渡态 spec（注入 EXEMPT 列表） | `harness-uplift-gate.spec.ts`                  |

> contract spec 单独有 [CONTRACT_README.md](./CONTRACT_README.md) 流程文档，看 baseline 更新约定。

---

## 3. 增 / 改 spec 的流程

### 增 spec（新的架构规则）

1. **先改 [ARCHITECTURE_RULES.md](../../../../docs/architecture/ARCHITECTURE_RULES.md)** —— 明确规则属于哪一层、什么 check、什么时候 fail
2. **决定子目录** —— 按上面 6 层表选位置；落不进 6 层就开新子目录（先在 PR 讨论）
3. **写 spec** —— 路径常量必须用相对 `__dirname`：

   ```typescript
   // architecture/<layer>/foo.spec.ts → backend/
   const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");
   ```

4. **跑 spec** —— 通常会 fail（存量违规）。两条路：
   - (a) 修代码让 spec 过
   - (b) 在 [EXCEPTIONS.md](../../../../docs/architecture/EXCEPTIONS.md) 登记例外 + spec 内加 `EXEMPT_PATHS`
5. **PR description 标 `[arch-rule-added]`**

### 改 spec（放松 / 收紧 / 移除）

| 动作                | PR description 标          | 强制内容                                |
| ------------------- | -------------------------- | --------------------------------------- |
| 放松 / 移除某个断言 | `[arch-rule-loosened]`     | 必须解释为什么不再需要 + 是否有替代规则 |
| 加严某个断言        | `[arch-rule-strengthened]` | 必须列出可能受影响的代码 + 修复方案     |
| 加例外条目          | `[arch-exception]`         | 5 字段必填（见 EXCEPTIONS.md）          |
| 删例外              | `[arch-exception-removed]` | 必须先实际修了，再删例外                |

---

## 4. 例外（EXEMPT_PATHS）规范

> 例外不是"灰名单"——是已登记、有移除期限、有责任人的合法偏离。

- **spec 内** 用 `EXEMPT_PATHS: ReadonlySet<string>` 维护例外
- **EXCEPTIONS.md** 同步必须有对应 E### 条目（5 字段：位置 / 违反规则 / 为什么允许 / 负责人 / 移除截止）
- spec 加例外的 PR 必须同时改 EXCEPTIONS.md，否则 reviewer 直接 reject
- 自动审计：未来可加 `architecture-exceptions-consistency.spec.ts` 比对 spec 内 EXEMPT_PATHS 与 EXCEPTIONS.md 引用一致

---

## 5. 存量 spec 迁移完成（2026-05-27）

所有 25 个原 flat 文件已迁入对应子目录，目录扁平化为 0。**新 spec 必须按 6-layer
结构归位**。当前布局（28 spec 全部归类完毕）：

```
__tests__/architecture/
├── README.md                ← 本文件
├── CONTRACT_README.md       ← *.contract.spec.ts baseline 更新流程
├── layer-1-topology/        (3) 单向依赖 + DI 边界
│   ├── layer-boundaries.spec.ts
│   ├── module-di-wiring.spec.ts
│   └── no-app-cross-coupling.spec.ts
├── layer-3-authority/       (7) canonical truth + event/facade contract
│   ├── agent-team-facade-contract.spec.ts
│   ├── agent-team-layout.spec.ts
│   ├── canonical-view-pattern.spec.ts
│   ├── mission-app-conformance.spec.ts
│   ├── mission-contract-guards.spec.ts
│   ├── playground-event-contract.spec.ts
│   └── playground-frontend-contract.spec.ts
├── layer-4-vocabulary/      (2) 词汇纯净
│   ├── infer-is-reasoning-callers.contract.spec.ts
│   └── vocab-purity.spec.ts
├── layer-6-durability/      (1) projector purity
│   └── projector-purity.spec.ts
├── layer-7-uplift-gate/     (1) harness ≥2 consumer
│   └── harness-uplift-gate.spec.ts
├── model-capability/        (10) model / capability / pricing / safety
│   ├── aimodelconfig-single-source.contract.spec.ts
│   ├── audit-capability-anti-patterns.spec.ts
│   ├── capability-provider-string-match.contract.spec.ts
│   ├── evidence-budget-contract.spec.ts
│   ├── model-capability-catalog-shape.contract.spec.ts
│   ├── model-policy-funnel.spec.ts
│   ├── no-hardcoded-pricing.spec.ts
│   ├── provider-default-chains-shape.contract.spec.ts
│   ├── seed-governance.spec.ts
│   └── structured-output-strategy-readers.contract.spec.ts
└── runtime-contracts/       (4) snapshot / plugin / protection-net / consistency
    ├── c5-c6-snapshot-contract.spec.ts
    ├── consistency.spec.ts
    ├── plugin-system.spec.ts
    └── protection-net.spec.ts
```

### 加 spec 时的相对路径模板

```typescript
// architecture/<layer>/foo.spec.ts → backend/src
const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");
// import 字符串同理，比 architecture/<spec>.ts 多一段 ..
import { Foo } from "../../../modules/ai-engine/llm/...";
```

---

## 6. 自动化（未来）

待补：

- `architecture-exceptions-consistency.spec.ts` —— 比对 `EXEMPT_PATHS` 与 `EXCEPTIONS.md` 条目
- `architecture-rules-coverage.spec.ts` —— 比对 `ARCHITECTURE_RULES.md` 每条规则是否有对应 spec
- pre-push hook：`npm run verify:arch` 跑全部 `__tests__/architecture/**/*.spec.ts`

---

**最后更新**：2026-05-27
**关联文档**：[ARCHITECTURE_RULES.md](../../../../docs/architecture/ARCHITECTURE_RULES.md) · [EXCEPTIONS.md](../../../../docs/architecture/EXCEPTIONS.md) · [CONTRACT_README.md](./CONTRACT_README.md)
