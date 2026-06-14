# AI Engine / AI Harness 扩展治理规范

**版本：** 1.0  
**强制级别：** MUST  
**生效日期：** 2026-05-02  
**维护者：** Claude Code

---

## 一、目的

本规范用于把以下事项从“架构建议”提升为“项目必须遵守的规则”：

- 扩展能力必须经过受控扩展点进入系统
- 定制代码不得伪装成通用内核
- memory / checkpoint / skill / tool 的主契约不得多轨并存
- 目录优化必须与扩展治理同步推进，禁止只做表面 rename

本规范是 [16-ai-engine-harness-structure.md](16-ai-engine-harness-structure.md) 的补充强约束。

---

## 二、核心原则

### 规则 1：扩展必须经过受控扩展点

新增能力只能进入以下受控扩展点：

- `ai-engine/tools/`
- `ai-engine/skills/`
- `ai-engine/llm/providers/`
- `ai-harness/protocols/`
- `ai-harness/memory/`

禁止在以下位置直接塞入新增能力：

- `facade/`
- `abstractions/`
- `registry/`
- `ai-app` 之外的任意“临时通用目录”

### 规则 2：主线注册中心必须唯一

项目主线扩展注册中心必须唯一：

- `ToolRegistry`：只能有一个主线实现
- `SkillRegistry`：只能有一个主线实现
- `Checkpoint` 主契约：只能有一套顶层 contract

允许存在：

- 内部 catalog
- source provider
- adapter
- compatibility bridge

但这些都不得伪装成第二个主线 registry。

### 规则 3：定制代码必须显式归类

新增或迁移文件必须被归类为以下四类之一：

- A：通用内核
- B：领域装配
- C：业务定制
- D：实验/兼容残留

未完成归类的文件，不得作为结构重构完成项提交。

### 规则 4：目录优化必须服从能力边界

目录整改时禁止只按名字美化，不按能力边界归位。

任何目录移动都必须同时回答：

1. 它属于哪个聚合？
2. 它属于哪个扩展点？
3. 它是通用能力还是领域装配？
4. 是否需要 facade / registry / manifest / arch test 同步更新？

### 规则 5：数据库资产层与运行时持久化底座必须分层

数据库相关内容必须区分两层：

- `backend/prisma/**`：数据库资产层，只承载 schema / migrations / seed / diagnose / SQL scripts
- `backend/src/common/prisma/**`：运行时持久化底座，只承载 Prisma module / service / startup wiring

禁止：

- 把 `backend/prisma/**` 并入 `modules/platform/**`（L1 基础设施）
- 把 migrations / seed / schema 与 Nest runtime module 混放
- 让 `platform/**` 同时承担”数据库资产仓库”和”运行时基础设施模块”双重职责

---

## 三、扩展契约

### 3.1 最小扩展契约

所有新增扩展能力必须同时满足：

1. 有 manifest 或等价 metadata
2. 有统一 registry 注册点
3. 有明确 owner
4. 有 facade 暴露路径或明确声明为 internal-only
5. 有边界测试

推荐的最小契约：

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

### 3.2 Tool 扩展

新增工具必须：

- 落在 `ai-engine/tools/`
- 通过主线 `ToolRegistry` 注册
- 具备唯一 `toolId`
- 声明输入输出 schema
- 声明权限/限流/trace 元信息

禁止：

- 在 `ai-app/**` 直接实现通用工具并跨域复用
- 在 harness 侧绕过 contract 直接向主线 registry 注入工具

### 3.3 Skill 扩展

新增 skill 必须：

- 落在 `ai-engine/skills/` 或被明确声明为 built-in skill source
- 通过主线 `SkillRegistry` 或其正式 source/provider 接入
- 具备唯一 `skillId`
- 声明允许工具、输入绑定、输出约束

禁止：

- 新增第二个主线 `SkillRegistry`
- 让 runtime 内部 catalog 直接承担主线 skill registration 角色

### 3.4 Provider 扩展

新增模型 provider 必须：

- 落在 `ai-engine/llm/providers/`
- 通过 provider contract 接入
- 声明 auth / pricing / capability / routing metadata

### 3.5 Protocol 扩展

新增协议适配必须：

- 落在 `ai-harness/protocols/`，如果它本质是 tool source adapter，则落在 `ai-engine/tools/adapters/`
- 明确协议层语义，不得与业务层概念混放

### 3.6 Memory 扩展

memory 不是独立层，而是跨层状态能力轴。

新增 memory 相关能力必须先判断属于哪一类：

- `execution state`：运行态，属于 harness semantics
- `semantic memory`：召回与检索，属于 harness + engine 协作
- `persistence substrate`：底层存储，属于 infra

禁止：

- 把 memory state 与 memory tool 混成一个职责
- 继续新增第二套 checkpoint 主 contract
- 通过隐式 `onModuleInit()` 反向注册形成长期机制

---

## 四、定制代码识别与归位规则

### 4.1 A 类：通用内核

必须同时满足大多数：

- 不依赖具体业务词汇
- 被多个 bounded context 复用
- 脱离单一 app 仍成立
- 具备稳定抽象语义

允许位置：

- `ai-engine/**`
- `ai-harness/**`
- `platform/**`（L1，旧称 ai-infra）

### 4.2 B 类：领域装配

适用于：

- 某个 bounded context 的配置、组合、装配、团队定义、流程编排

允许位置：

- `ai-app/<domain>/`
- `ai-harness/<domain-aligned subtree>/`

禁止进入：

- `facade/abstractions/registry/`

### 4.3 C 类：业务定制

满足任一条件即判高疑似：

- 文件名含明确业务词，且只服务一个产品线
- 内部硬编码特定 role / stage / mission / workflow
- 只有单一业务 importer
- 带有“来源于某业务线”的历史耦合注释

要求：

- 下沉回 `ai-app/<domain>/`
- 或保留在 app 私有 subtree
- 进入 core 前必须有 ADR 证明其已通用化

### 4.4 D 类：实验/兼容残留

识别信号：

- `supplemental`
- `extra`
- `legacy`
- `temp`
- `deprecated`
- `experimental`

要求：

- 必须显式标记用途
- 必须有移除计划
- 不得无限期驻留主线目录

---

## 五、目录治理规则

### 5.1 可扩展目录

以下目录允许新增能力：

- `ai-engine/tools/`
- `ai-engine/skills/`
- `ai-engine/llm/providers/`
- `ai-harness/protocols/`
- `ai-harness/memory/`

### 5.2 半封闭目录

以下目录新增内容前必须完成人工复核：

- `ai-harness/runner/`
- `ai-harness/teams/`
- `ai-harness/lifecycle/`
- `ai-engine/content/`
- `ai-engine/knowledge/`

### 5.3 封闭目录

以下目录默认禁止随意增长新概念：

- `facade/`
- `abstractions/`
- `registry/`

在这些目录新增文件时，必须说明：

- 为什么现有结构无法承载
- 为什么不是领域装配
- 为什么不是临时兼容层

---

## 六、测试与命名强约束

### 6.1 测试后缀白名单

允许的测试文件后缀仅为：

- `*.spec.ts`
- `*.integration.spec.ts`
- `*.e2e-spec.ts`

禁止新增：

- `*supplemental.spec.ts`
- `*extra.spec.ts`
- `*legacy.spec.ts`
- 其他临时拼接式后缀

### 6.2 命名清理规则

禁止新增以下目录或文件语义：

- `temp`
- `legacy`
- `custom`（除非为产品概念本身）
- `extra`
- `supplemental`

如为过渡层，必须使用：

- `experimental/`
- `deprecated/`
- 或 ADR 中声明的显式迁移目录

---

## 七、执行门槛

以下事项为合并前必须满足的门槛：

1. 通过现有 `verify:arch`
2. 不违反 `no-restricted-imports`
3. 扩展能力已完成归类
4. 如涉及目录整改，已更新 facade / registry / importer / tests
5. 如涉及例外，已附 ADR

---

## 八、自动化看护要求

项目必须逐步补齐以下自动化看护：

- `extension-boundaries.spec.ts`
- `memory-boundaries.spec.ts`
- `customization-audit.spec.ts`

最少应覆盖：

- 禁止第二个主线 registry
- 禁止新增碎片化测试命名
- 禁止在 engine/harness 中新增明显业务定制文件而不归类
- 检查 checkpoint 主 contract 唯一性

---

## 九、与其他标准的关系

- [16-ai-engine-harness-structure.md](16-ai-engine-harness-structure.md)：定义 engine / harness MECE 结构
- [13-module-dependencies.md](13-module-dependencies.md)：定义依赖方向与循环依赖边界
- [03-naming-conventions.md](03-naming-conventions.md)：定义命名规则
- [07-testing-standards.md](07-testing-standards.md)：定义测试文件与测试层级规则

当本规范与其他文档冲突时：

1. 结构边界问题优先服从 `16`
2. 扩展治理与定制归位问题优先服从 `17`
3. 具体命名问题服从 `03`

---

## 十、整改准入原则

对于 W18/W19 及后续波次：

- 不允许只做 rename 而不清理明显结构债
- 不允许把定制代码换名后继续停留在 core
- 不允许新增临时例外而不登记

目录重组完成的判定标准不是“名字对齐”，而是：

- 归属正确
- 契约唯一
- 访问受控
- 自动化可验证
