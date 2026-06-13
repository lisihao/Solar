# Tool Recall 子文档（D1, D5）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §1.1 / §3.3 / §3.4 / §10 Q1 Q2 / §13 P0
> **优先级**：P0（必须随基线实现）

---

## 1. 问题域

把"Researcher 该用哪些工具"这件事的决定权从**编译期硬编码 spec.tools**搬到**运行时动态召回 + Leader hint + Agent 自决**，使：

- 系统对 ToolRegistry CRUD 自动跟进，不需要改 spec
- Leader 按 dim 性质给 hint，但不强制（业界主流 retrieval+self-decide）
- Researcher 在召回子集内每 iter 自由选

---

## 2. 输入 / 输出契约

### 2.1 Spec 层（编译期声明）

```typescript
@DefineAgent({
  toolCategories: readonly string[];  // ★ 取代 tools: string[]
  // 不再写具体 id，不再随 ToolRegistry 漂移
})
```

### 2.2 RunOptions 入参（边界 1）

```typescript
toolRecallHint?: {
  categories?: readonly string[];   // 可收窄 spec.toolCategories
  excludeIds?: readonly string[];   // 黑名单
  preferIds?: readonly string[];    // 弱推荐（catalog 标 ★）
};
```

### 2.3 Leader 输出（每 dim 携带 hint）

```typescript
dim.toolHint = {
  categories: string[];     // 必填 1+
  preferIds?: string[];     // 可选
};
```

### 2.4 RunResult 出参（trace）

```typescript
toolsCatalogSnapshot: readonly string[];  // 本次实际给 LLM 看的工具 id 集
```

### 2.5 IAgentEvent 新增

```typescript
{ type: 'tools_recalled', payload: { recalledIds, categories, source: 'spec'|'hint' } }
```

---

## 3. ToolRegistry 元数据扩展

```typescript
interface ToolMetadata {
  id: string;
  category: ToolCategory; // ★ 必填
  sideEffect: "none" | "idempotent" | "destructive"; // D14
  requiredEntitlements?: string[]; // D13 ToolACL
  description: string;
  inputSchema: JSONSchema;
  invocationExample: string;
}

interface ToolRegistry {
  tryGet(id: string): Tool | undefined;
  listByCategory(categories: readonly string[]): Tool[]; // ★ 新增
  listAll(): Tool[];
}
```

**改造范围**：

- 每个工具 class 加 `category` 字段（一次性人工归类，~50 工具）
- ToolRegistry 加 `listByCategory()` + 内部建二级索引

---

## 4. Tool Recall 五步流程（AgentRunner.collectAugmentBlocks 内）

```
Step 1. 基础召回
  pool = ToolRegistry.listByCategory(spec.toolCategories)

Step 2. hint 收窄（如有）
  if (opts.toolRecallHint?.categories) {
    pool = pool.filter(t => hint.categories.includes(t.category))
  }

Step 3. 黑名单减去
  pool = pool.filter(t => !hint.excludeIds?.includes(t.id))

Step 4. ToolACL 过滤（D13，p1）
  pool = pool.filter(t => userEntitlements ⊇ t.requiredEntitlements)

Step 5. preferIds 标注
  catalog.render: 给 hint.preferIds 加 ★ recommended 注释
```

输出：`recalledIds = pool.map(t => t.id)` →

- 注入 `<available_tools>` block
- 写入 `IAgentIdentity.tools`（决定 ToolInvoker 可调用集）
- emit `tools_recalled` 事件

---

## 5. 安全闸

| 校验                                         | 不通过的处理                         |
| -------------------------------------------- | ------------------------------------ |
| `spec.toolCategories` 必须非空               | 抛 DefineAgentMissingError           |
| `hint.categories` 必须 ⊆ spec.toolCategories | 越界部分静默丢弃，记 warning         |
| `hint.preferIds` 必须 ∈ recalledIds          | 越界部分静默丢弃                     |
| `hint.excludeIds` 任意值合法                 | 直接生效                             |
| recalledIds 为空                             | 抛 InsufficientToolsError，fail-fast |

---

## 6. 关键决策

| 决策                                     | 取值                                               |
| ---------------------------------------- | -------------------------------------------------- |
| spec.tools 兼容性                        | 保留向后兼容：spec.tools 存在时直接当 recalledIds  |
| Leader 是否能强制 Researcher 用某 id     | 不能，preferIds 是弱引导，Researcher 仍可不用      |
| 召回上限                                 | 单次召回 ≤ 30 工具（避免 catalog 撑爆 prompt）     |
| 是否在 hint 缺失时 fallback 到 spec 全集 | 是（user 没给 hint 时按 spec.toolCategories 召回） |

---

## 7. 实现要点

- ToolCategory enum 字符串集中定义，避免漂移
- `category` 字段在每个工具 class 顶部，与 id 同位置
- ToolRegistry.listByCategory 用 `Map<category, Tool[]>` 二级索引，O(1) 查
- catalog 渲染保持 §1.1 现有格式（id + description + inputSchema + invocationExample），preferIds 仅追加 `// ★ recommended` 行

---

## 8. 验收标准

- 增删一个工具，所有 spec 不需要改，下次 run 自动生效
- Leader hint 命中时，Researcher 看到的 catalog 严格收窄
- Leader hint 缺失时，Researcher 看到 spec.toolCategories 全集
- recalledIds 为空时 fail-fast，不进 ReActLoop
- emit `tools_recalled` 含完整 recalledIds + source

---

## 9. 风险 / 边界

- 工具 category 归类可能有歧义（如 `web-scraper` 既是 information 也可视为 processing）→ 单一归属，按主用途
- Leader 给的 hint 与 spec.toolCategories 不交集时召回为空 → 安全闸抛 InsufficientToolsError
- preferIds 可能与 LLM 实际选择不一致（弱引导本意）→ 不做校验
