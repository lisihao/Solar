# Mission UI 能力化架构（基线方案 v1）

> 状态：**基线 / 待实施**　·　创建：2026-06-08　·　范围：前端 Mission 详情 UI 的能力化、组件化、乐高化
>
> 关联：[ui-components.md](ui-components.md)、[agent-team-ui-unification.md](agent-team-ui-unification.md)、
> `docs/features/one-person-company-os/design.md`（市场沉淀）、`.claude/standards/22-frontend-ui-component-governance.md`。

---

## 0. 定位与原则

> **把 playground 的 UI 从"应用私有的页面拼装"，升级为"按能力类型沉淀的 UI Kit + 归一化数据契约"，
> 让前端呈现和后端 pipeline 一样可复用、可注册、可上架。前后端两条腿对称：后端沉淀"怎么跑"，前端沉淀"怎么看"。**

**四条原则：**

1. **一份定义，处处一致** —— UI 由契约喂养，不靠人工对齐（"完全一致"是契约保证的）。
2. **按能力类型分层，不按应用分层** —— 深度洞察 / 写作叙事是"能力"，不是"playground 的私货"。
3. **UI 不是第 5 种市场原语，是能力的呈现面** —— 它绑在 workflow / mission-type 能力上随之上架，不单开货架（守四货架 MECE）。
4. **乐高：能力 = 执行 + 契约 + 呈现** 三件套，可分别替换、组合复用。

---

## 1. 现状审视（为什么要做）

| 问题                   | 结论                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI 是否标准化          | **半标准化**。外壳层（`MissionDetailFrame` / `RoleCard` / `MissionTaskList` / `StageStepper` / `Tabs`）已下沉到 `common/`；**面板层未标准化**——散在 `agent-playground/` 私有命名空间。                    |
| 要素是否组件化         | **组件化但归错层 + 重复造**。面板是独立组件但放在应用私有目录；公司 mission 用不了，只能在 `MissionReportView` 里重写 `ScoreRing`/`ReferencesPanel`/`FactTablePanel`/`CostPanel` → 两套并存、长得不一样。 |
| 能否构建能力级 UI 组件 | **能，且这正是欠的债**。深度洞察的 UI 要素全部存在，缺的是"打包成能力组件 + 归一化契约"。                                                                                                                 |

**根因**：L3 面板直接吃 playground 私有数据形状（WebSocket 事件流 / 14 阶段 artifact / MissionView），无归一化契约 → 别处接不进来 → 重写。这是标准 22「复用优先」的同款治理欠债。

---

## 2. 四层 UI 架构（基线骨架）

```
L1 primitives      components/ui/                     原子：Tabs/Button/Modal/Table/Badge/EmptyState
L2 mission shell    components/common/mission-detail/  领域无关 mission 外壳：Frame/TaskList/RoleCard/
                    components/common/team-topology/    StageStepper/ActionGroup/Topology（任何 mission · 已下沉）
L3 capability       components/missions/<type>/panels/  某类 mission 的面板：评分/维度/报告/引用/事实/算力…
   panels
L4 capability       components/missions/<type>/         成品组件：<DeepInsightMissionDetail data/>
   detail             <Type>MissionDetail.tsx           组装 L2 壳 + L3 面板，唯一对外入口
        ▲
        │ 由归一化契约喂养
        ▼
契约/适配  components/missions/<type>/contract.ts      <Type>MissionView 类型 + fromX() 适配器
```

**关键**：L4 是唯一对外入口，只吃契约。应用页退化成 `取数 → adapter → <DeepInsightMissionDetail data={view} />`。

---

## 3. 归一化数据契约（乐高的凸点 / 插槽）

分两层，避免每个 mission 类型各写一套：

```ts
// L2 契约：所有 mission 通用（壳层吃）
interface BaseMissionView {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  createdAt?: number;
  team: TeamTopologyView; // 喂 TeamTopologyCanvas
  steps: MissionStep[]; // 喂 MissionTaskList
  usage?: ComputeUsage; // 喂算力面板
  actions?: MissionAction[]; // 喂 ActionGroup
}

// L3 契约：深度洞察扩展（深度洞察面板吃）
interface DeepInsightMissionView extends BaseMissionView {
  score?: { value: number; verdict: "approve" | "revise" | "reject" };
  dimensions: string[];
  report?: string; // markdown 正文
  references: Reference[];
  facts: Fact[];
  reviewNotes: string[];
}
```

**适配器（谁产出契约谁负责）：**

- `fromPlaygroundMissionView(wsMissionView)` → `DeepInsightMissionView`（支持 live：每次事件 re-adapt → L4 re-render）
- `fromCompanyMissionResult(MissionReportResult)` → `DeepInsightMissionView`（静态结果）

→ playground 事件流 / 公司 deepdive 结果，**两种数据源、同一套 UI**。

---

## 4. 公共能力化：前端 MissionKit 注册表

像后端 registry 一样可注册、可发现、可解析：

```ts
interface MissionKit {
  type: string; // "deep-insight" | "writing" | ...
  label: string;
  DetailComponent: React.FC<{ data: unknown }>; // L4 成品
}
const MISSION_KITS: Record<string, MissionKit> = {
  "deep-insight": {
    type: "deep-insight",
    label: "深度洞察",
    DetailComponent: DeepInsightMissionDetail,
  },
};
export function resolveMissionKit(type: string): MissionKit | undefined;
```

任何页面 `resolveMissionKit(type).DetailComponent` 即可渲染，不依赖 playground。新增能力 = 注册表加一行。

---

## 5. 市场能力化：UI Kit 随能力上架

**一个能力 = 执行 + 契约 + 呈现，三件套打包上架。** 给已有工作流 SKU 加呈现面：

```
WorkflowCatalogItem {                ← 已有（工作流市场 SKU，id === MissionPipelineRegistry 解析键）
  id, name, stages, roles, ...
+ missionType: "deep-insight"        ← 新增：声明用哪个 MissionKit 呈现
}
```

闭环：

```
用户采用「深度洞察」工作流 SKU
  ├─ 执行：sourceListingId → MissionPipelineRegistry → 真 pipeline（已做）
  └─ 呈现：SKU.missionType → resolveMissionKit → <DeepInsightMissionDetail>（本案）
= 招来即跑、跑完即有配套界面、且与 playground 完全一致
```

**为什么 UI 不单开第 5 货架**：UI 是能力的呈现面，不是独立原语（没 pipeline 的 UI 对董事长无价值）→ 绑在 workflow / mission-type SKU 上随之分发，不污染四货架。

---

## 6. 目录基线（按组件类型分层）

```
components/
  ui/                    类型:primitive    原子
  common/                类型:shell/layout/state   领域无关复合
    mission-detail/  team-topology/  states/ ...
  missions/              类型:capability   ★ 新增层
    _shared/             跨类型复用面板（通用 CostPanel / StepList…）
    deep-insight/        contract.ts · DeepInsightMissionDetail.tsx · registry 入口 · panels/* · left/*
    writing/             （未来）
    registry.ts          MissionKit 注册表
  <app>/                 类型:glue   只剩"取数 + 适配 + 渲染 L4"
```

`agent-playground/panels|artifact` 中**可复用的**迁入 `missions/deep-insight/`；**纯运行态调试**（RawEventLog 等）留原地。公司 `MissionReportView` 重复实现删除，改调 L4。

---

## 7. 落地路径（先深度洞察打透，再模板复制）

| 阶段            | 内容                                                                   | 验收                                                       |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| **P1 立契约**   | `missions/deep-insight/contract.ts` + 两个 adapter                     | 两端数据都能映成 `DeepInsightMissionView`；`type-check` 绿 |
| **P2 下沉面板** | 可复用面板迁入 `deep-insight/panels`，合并公司重复版                   | 面板零重复、零 playground 私有依赖                         |
| **P3 出成品**   | `DeepInsightMissionDetail`（L4）+ MissionKit 注册                      | 单组件吃契约渲染全貌                                       |
| **P4 两端接入** | 公司 `/missions` + playground 页改调 L4，删 `MissionReportView` 重复码 | 两处一致；`type-check` 绿                                  |
| **P5 接市场**   | `WorkflowCatalogItem` 加 `missionType`，前端按 kit 渲染                | 采用深度洞察工作流 → 跑 + 看一体                           |
| **P6 模板化**   | 写作叙事按同模板出 `missions/writing/`                                 | 加能力 = 加一包 + 注册一行                                 |

---

## 8. 与后端沉淀的对称（设计自洽性）

| 维度   | 后端（已做）                                | 前端（本案）                        |
| ------ | ------------------------------------------- | ----------------------------------- |
| 沉淀物 | agent / skill / tool / pipeline             | mission UI kit（L3 面板 + L4 成品） |
| 注册表 | MissionPipelineRegistry / SpecAgentRegistry | MissionKit registry                 |
| 契约   | SKU id = 解析键                             | 归一化 MissionView                  |
| 复用   | 多 app 共用 pipeline                        | 多 app 共用 UI kit                  |
| 上架   | 工作流 / Agent 市场 SKU                     | 随 workflow SKU 带 `missionType`    |
| 乐高   | 能力 = pipeline                             | 能力 = pipeline + contract + uiKit  |

---

**维护者**：Claude Code　·　**基线版本**：v1（2026-06-08）
