# 扩展治理与定制代码审计（W18/W19 前置）

**日期**：2026-05-02  
**范围**：`backend/src/modules/ai-engine`、`backend/src/modules/ai-harness`、相关 `ai-app/open-api` 接入层  
**目的**：在 W18/W19 命名规范波次前，先锁定扩展契约、定制代码识别规则、整改优先级，避免“把错误的东西换个更规范的名字继续保留”。

---

## 1. 结论

当前代码库已经具备扩展雏形，但还没有形成“必须经由受控扩展点进入系统”的硬约束。

主要风险不是目录不够整齐，而是：

- **扩展入口未完全收敛**：仍存在 harness 侧自有 skill 体系与 engine 主注册中心并存。
- **memory 相关能力存在反向注册与双轨 checkpoint**：说明状态语义和能力语义还没完全拆开。
- **定制/实验残留较多**：文件命名碎片和业务定制代码仍大量存在，如果不先做审计，W18/W19 只会做“表面命名整理”。

结论性建议：

1. `W18/W19` 前先把“扩展治理”定成 MUST。
2. 先做 `plugin-ready contracts`，不做完整插件平台。
3. 先做“定制代码识别与归位”，再做大规模命名对齐。

---

## 2. 首轮扫描结果

### 2.1 命名碎片信号

对 `backend/src/modules` 扫描得到：

| 模式           | 数量 | 含义                          |
| -------------- | ---: | ----------------------------- |
| `supplemental` |  107 | 典型“补丁式测试/分支覆盖残留” |
| `extra`        |   29 | 典型“额外分支覆盖/临时补档”   |
| `legacy`       |    7 | 历史兼容或未清理残留          |
| `temp`         |   63 | 临时语义，需人工复核          |
| `custom`       |    3 | 自定义特判残留                |

总计：**206 个高疑似碎片命名文件**。

### 2.2 engine / harness 中的领域定制信号

对 `ai-engine`、`ai-harness` 路径中带明显业务词的文件名扫描（如 `research`、`simulation`、`image`、`topic`、`slides`、`office`、`playground`、`wechat`、`xiaohongshu`）得到：

- **53 个候选文件**

这不代表它们全部违规，但意味着这些文件必须逐个判断是：

- 通用内核
- 领域装配
- 业务定制
- 实验/兼容残留

---

## 3. 必须落地的扩展契约

以下内容应在后续标准文档中写成 **MUST**，并最终由 ESLint / 架构测试 / pre-push / CI 共同强制。

### 3.1 允许的扩展点

新增能力只能进入以下受控扩展点：

- `ai-engine/tools/`
- `ai-engine/skills/`
- `ai-engine/llm/providers/`
- `ai-harness/protocols/`
- `ai-harness/memory/`

### 3.2 禁止事项

- 禁止新增第二个 `ToolRegistry`
- 禁止新增第二个主线 `SkillRegistry`
- 禁止新增第二套 checkpoint 主契约
- 禁止在 `facade/abstractions/registry/` 中塞入业务定制能力
- 禁止在 `ai-app` 外部新增只服务单一业务的“伪通用”组件

### 3.3 plugin-ready 最小契约

所有新增扩展能力必须同时满足：

1. 有 manifest 或等价 metadata
2. 有统一 registry 注册点
3. 有 facade 暴露路径或明确禁止外部访问
4. 有架构测试覆盖其归属边界

最小契约草案：

```ts
interface ExtensionManifest {
  id: string;
  version: string;
  owner: string;
  kind: "tool" | "skill" | "provider" | "protocol" | "memory";
  entry: string;
  public: boolean;
}
```

---

## 4. 定制代码识别规则

后续整改一律按以下分类处理。

### 4.1 A 类：通用内核型

满足以下条件中的多数：

- 不依赖具体业务词汇
- 存在多个调用方
- 脱离具体 app 仍成立
- 具备稳定抽象语义

例：

- `ToolRegistry`
- `SkillRegistry`
- `CheckpointStore`
- `EmbeddingService`

要求：

- 保留在 `engine/harness`
- 补抽象接口、测试、导出边界

### 4.2 B 类：领域装配型

满足以下条件中的多数：

- 面向某个 bounded context，但仍不是单一页面/单一玩法私有逻辑
- 属于 app 或 harness 的领域装配

例：

- `research-team.config.ts`
- `slides-team.config.ts`
- `topic-team-orchestrator.service.ts`

要求：

- 保留在对应领域目录
- 文件名必须体现领域
- 禁止沉入通用 `abstractions/registry/facade`

### 4.3 C 类：业务定制型

满足以下任一条件即可判为高疑似：

- 文件名含明确业务词，且只服务一个产品线
- 只有一个 importer，且 importer 属于单一 app 业务流
- 内部硬编码特定 role / stage / team / mission 语义
- 迁入 engine/harness 后仍保留“来源于某业务线”的注释和耦合

处理：

- 下沉回 `ai-app/<domain>/`
- 或保留在 `ai-harness/<domain-like subtree>/`，但必须加领域前缀并提供 ADR

### 4.4 D 类：实验/兼容残留

识别信号：

- `supplemental`
- `extra`
- `legacy`
- `temp`
- `bridge`
- 注释含 `temporary` / `deprecated` / `experimental`

处理：

- 合并回主文件
- 明确标记 `experimental/` 或 `deprecated/`
- 给出移除波次

---

## 5. 当前高优先级发现

### F1. harness 仍保留独立 built-in skill 注册体系

证据：

- `ai-harness/agents/builtin-skills/skill.registry.ts`
- `ai-harness/harness.module.ts`
- `ai-harness/agents/learning/skill-learning-coordinator.ts`

现状：

- `BuiltInReActSkillRegistry` 仍作为 runtime 内部注册表存在
- `SkillActivator` 通过 fallback 连接到 engine 主注册表
- learning coordinator 仍直接写入 harness built-in registry

判断：

- 这是“过渡态可接受，但不是长期终态”
- 对扩展治理而言，属于**双 skill 源并存**

整改建议：

1. 明确主线 `SkillRegistry` 只有 engine 一个。
2. harness built-in registry 降格为 `BuiltInSkillCatalog` 或 `BuiltinSkillSource`。
3. learning coordinator 不再直接写 harness registry，改走 engine skill registration contract。

优先级：`P0`

### F2. memory tools 通过 onModuleInit 反向注册进 engine ToolRegistry

证据：

- `ai-harness/memory/working/memory.module.ts`
- `ai-harness/memory/tools/short-term-memory.tool.ts`
- `ai-harness/memory/tools/long-term-memory.tool.ts`

现状：

- harness memory 模块在 `onModuleInit()` 中执行：
  - `toolRegistry.register(this.shortTermMemoryTool)`
  - `toolRegistry.register(this.longTermMemoryTool)`

判断：

- 这说明“memory 作为工具能力”与“memory 作为 harness 运行时语义”还没彻底分离
- 反向注册不是长期稳定的扩展机制

整改建议：

1. 定义 `MemoryToolProvider` 或 `ToolPluginManifest(kind='memory')`
2. 由 engine 接纳 memory tool provider，而不是 harness 在 module init 中直接塞入 registry
3. 明确 memory tool 是 engine surface，memory state 是 harness semantics

优先级：`P0`

### F3. checkpoint 仍存在双轨主语义

证据：

- `ai-harness/memory/checkpoint/checkpoint.service.ts`
- `ai-harness/memory/state-checkpoint/checkpoint.service.ts`

现状：

- 一个是 agent execution checkpoint
- 一个是 mission/job checkpoint
- 两者目前仍是两套主服务

判断：

- 允许实现分层，但不允许主契约分裂
- 当前最缺的是统一 store contract / scope model / snapshot taxonomy

整改建议：

1. 统一顶层命名：`CheckpointStore` / `CheckpointScope`
2. 区分 scope：`agent` / `mission` / `session`
3. 保留不同 service 实现，但共享一套主 contract

优先级：`P0`

### F4. engine facade abstractions 中存在明显领域词汇

证据：

- `ai-engine/facade/abstractions/research.interface.ts`
- `ai-engine/facade/abstractions/simulation.interface.ts`

判断：

- `facade/abstractions` 是高稳定面，不适合持续堆叠 app 领域接口
- 这些文件未必错误，但属于“是否把 app 领域依赖倒灌回 engine facade”的高风险点

整改建议：

1. 复核这两个接口是否真属于 engine 稳定契约
2. 若只服务某单一 app，应迁回 app 侧 port/interface
3. 若是跨 app 共享场景，重命名为能力导向接口，而不是 `research/simulation` 领域导向接口

优先级：`P1`

### F5. engine 中仍有从业务线沉淀上来的候选能力，需逐个复核是否真正通用

证据：

- `ai-engine/content/figure/figure-extractor.service.ts`
- `ai-engine/tools/categories/processing/template-render.tool.ts`

现状：

- `figure-extractor.service.ts` 明确保留“来源于 topic-insights”的注释
- 这类文件可能已经通用，也可能只是“单业务工具上浮”

判断：

- 不能因为“有第二个调用方”就自动判为内核
- 必须检查：是否业务无关、是否通用输入输出、是否无领域硬编码

整改建议：

按以下顺序复核：

1. 是否只依赖通用 `ToolRegistry` / `content` / `llm` 抽象
2. 是否没有 topic-insights 专有语义
3. 是否有 2 个以上独立 bounded context 调用

优先级：`P1`

### F6. harness 中存在带业务语义色彩的协作残留，需确认是否真属内核

证据：

- `ai-harness/teams/collaboration/todo/todo.service.ts`
- `ai-harness/lifecycle/manager/mission-executor.service.ts`
- `ai-harness/agents/builtin-skills/built-in/leader-mid-mission-assess/SKILL.md`
- `ai-harness/agents/builtin-skills/built-in/mece-mission-planning/SKILL.md`
- `ai-harness/agents/builtin-skills/built-in/multi-judge-mission-review/SKILL.md`

判断：

- `mission` 可以是 harness 核心语义
- 但 `leader-mid-mission-assess`、`multi-judge-mission-review` 这类命名已经接近业务流程/玩法层

整改建议：

1. 核心语义保留：`mission`, `checkpoint`, `handoff`, `runner`
2. 玩法型 skill 下沉为 built-in skill packs，避免伪装成 runtime core
3. `teams/collaboration/todo` 需确认是否属于通用协作原语，否则下沉到 app 团队域

优先级：`P1`

### F7. 测试碎片化严重，W19 前必须先收敛命名策略

证据：

- 大量 `*supplemental.spec.ts`
- 大量 `*extra*.spec.ts`
- 少量 `*.legacy.spec.ts`

判断：

- 这是当前最明显的“目录整齐但维护性差”的表现
- W19 不能只做 rename，必须先定归并策略

整改建议：

1. 允许的测试后缀只保留：
   - `*.spec.ts`
   - `*.integration.spec.ts`
   - `*.e2e-spec.ts`
2. `supplemental/extra` 优先合并回主 spec
3. 无法合并的测试需改名并说明测试层级

优先级：`P0`

---

## 6. 执行模板

后续每发现一个候选文件，都按以下模板登记。

| 字段         | 内容                                                |
| ------------ | --------------------------------------------------- |
| 文件         | 路径                                                |
| 当前归属     | ai-engine / ai-harness / ai-app / open-api          |
| 候选分类     | A 通用内核 / B 领域装配 / C 业务定制 / D 实验残留   |
| 识别依据     | 命名 / importer 数量 / 业务词 / 注释来源 / 依赖方向 |
| 是否允许保留 | 是 / 否 / 待定                                      |
| 整改动作     | 保留补契约 / 下沉归位 / 合并 / 删除 / ADR 例外      |
| 优先级       | P0 / P1 / P2                                        |
| 目标波次     | W18 / W19 / W20+                                    |

---

## 7. 建议的后续动作

### 7.1 W18 前必须做

1. 新增标准文档：`plugin + memory extension contracts`
2. 把本审计文档作为 W18/W19 输入清单
3. 先定“允许的测试命名后缀”
4. 先定“唯一主线注册中心”和“唯一主 checkpoint contract”

### 7.2 W19 前必须做

1. 先清理 `supplemental/extra/legacy` 命名碎片
2. 再做 harness 命名规范对齐
3. 同步更新 ESLint / architecture spec / pre-push 规则

### 7.3 W20+ 再做

1. `plugin-ready` manifest 与注册契约
2. memory 跨层 contract
3. 定制 pack / built-in pack / marketplace 的清晰分层

---

## 8. 本次建议纳入后续自动化看护的规则

建议新增以下看护：

- `extension-boundaries.spec.ts`
  - 禁止新增第二个主线 registry
  - 禁止扩展能力绕过 manifest/registry

- `memory-boundaries.spec.ts`
  - 禁止 `memory` 子树中继续扩散业务定制文件
  - 检查 checkpoint 主契约唯一性

- `customization-audit.spec.ts`
  - 扫描 `supplemental|extra|legacy|temp`
  - 扫描 `ai-engine/ai-harness` 中高风险业务词
  - 输出告警或直接 fail

---

## 9. 审计结论摘要

当前最该做的不是“继续移动目录”，而是先把以下三件事变成硬约束：

1. **扩展必须走受控扩展点**
2. **定制代码不能继续伪装成通用内核**
3. **memory / checkpoint / skill 注册不能再多轨并存**

否则 W18/W19 之后，目录会更规范，但结构债会更难看见，也更难清理。

