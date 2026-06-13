# 事件洞察（Event Insights）设计方案

> Topic Insights 新增类型：基于新闻/线索深挖事件来龙去脉，通过现象发现本质

## 1. 场景定义

### 1.1 核心目标

**通过一个事件，梳理其来龙去脉，通过现象发现本质。**

用户看到一条新闻或线索（如"OpenAI 发布 GPT-5"、"英伟达收购 Run:ai"、"欧盟通过 AI 法案"），
希望以此为锚点，不仅了解事件本身，更要：

- **追溯根因**：这件事为什么会发生？什么结构性力量在推动？
- **还原全貌**：涉及哪些利益方？各方的真实动机是什么？
- **推演影响**：一阶影响（直接影响）→ 二阶影响（间接影响）→ 三阶影响（系统性变化）
- **洞察本质**：这个事件背后反映了什么更深层的趋势或矛盾？
- **预判走向**：接下来会怎样？什么变量决定走哪条路？

### 1.2 与现有类型的区别

|              | MACRO                                   | TECHNOLOGY                                | COMPANY                                 | **EVENT（新）**                                                |
| ------------ | --------------------------------------- | ----------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| **输入**     | 主题名称                                | 技术名称                                  | 企业名称                                | 新闻 URL / 粘贴内容                                            |
| **研究起点** | 无锚点，广泛搜索                        | 技术为中心                                | 企业为中心                              | **锚定文章**为中心                                             |
| **核心方法** | 多维度扫描                              | 技术深度分析                              | 企业全景分析                            | **因果链推理**                                                 |
| **维度来源** | Leader 自主规划                         | Leader 自主规划                           | Leader 自主规划                         | **从文章内容和因果假设推导**                                   |
| **搜索策略** | 搜主题本身                              | 搜技术本身                                | 搜企业本身                              | **不搜事件本身（已有锚定文章），搜背景/影响/反应**             |
| **分析特色** | 全景覆盖                                | 技术纵深                                  | 竞争定位                                | **因果推理 + 利益博弈 + 情景推演**                             |
| **典型维度** | 政策/市场/竞争/技术/投资/人才/国际/应用 | 原理/前沿/玩家/专利/应用/商业化/挑战/路线 | 概况/产品/模式/财务/技术/市场/战略/SWOT | 事件核心/结构背景/触发时机/利益格局/连锁反应/历史对标/情景推演 |

### 1.3 典型用例

| 用例                                     | 用户期望的本质洞察                                               |
| ---------------------------------------- | ---------------------------------------------------------------- |
| 一条行业新闻（英伟达收购 Run:ai）        | 不只是收购本身，而是 AI 基础设施从"芯片战"进入"调度权之争"的信号 |
| 一个政策公告（欧盟 AI 法案落地）         | 不只是合规要求，而是全球 AI 治理从"自律"转向"强监管"的拐点       |
| 一条竞品动态（Claude 4 发布）            | 不只是产品更新，而是大模型竞争从"参数竞赛"转向"工程化能力"的转折 |
| 一条融资消息（某 AI 公司 10 亿美元融资） | 不只是金额，而是资本对 AI 产业链哪个环节的预判                   |
| 一起安全事件（大规模数据泄露）           | 不只是事件本身，而是暴露了什么系统性安全治理缺陷                 |

---

## 2. 核心分析方法论

> **定位**：所有竞品（OpenAI/Gemini/Perplexity Deep Research）都是"智能搜索聚合器"——搜得广、整理得好，但不会质疑、不会反驳、不会问"如果主流分析是错的呢？"。
>
> Event Insights 的目标不是做一个更好的搜索聚合器，而是做一个**会思考的分析师**——它有分析框架、会提出假设、会自我质疑、会告诉你"大多数人没看到的东西"。

### 2.1 竞品差距分析

| 能力           | OpenAI Deep Research         | Gemini Deep Research        | Perplexity        | **Event Insights（目标）**                                       |
| -------------- | ---------------------------- | --------------------------- | ----------------- | ---------------------------------------------------------------- |
| 信息搜集       | 强（多步搜索+回溯）          | 强（迭代搜索）              | 强（并行搜索）    | 强（三层递进搜索）                                               |
| 信息整理       | 中（长散文）                 | 中（长散文）                | 强（结构化+引用） | 强（结构化维度）                                                 |
| **因果推理**   | 弱（偶尔出现）               | 弱                          | 无                | **强（三层因果引擎）**                                           |
| **自我质疑**   | 无                           | 有（self-critique，仅格式） | 无                | **强（对抗验证，通过 synthesis prompt 实现）**                   |
| **反共识洞察** | 无                           | 无                          | 无                | **有（共识 vs 反共识分离）**                                     |
| **分析框架**   | 无（对所有事件用同一种方式） | 无                          | 无                | **有（按事件类型自动选框架）**                                   |
| **可证伪预测** | 无（"未来充满不确定性"）     | 无                          | 无                | **有（WWNBT 条件-时间-结果三元组，通过 synthesis prompt 实现）** |

**一句话总结**：竞品做到了"帮你搜到所有信息"，我们要做到的是"告诉你大多数人没看到的东西"。

### 2.2 分析引擎：五层递进（Five-Layer Analytical Engine）

Event Insights 的核心差异是一个**五层递进分析引擎**，每一层都在竞品能力边界之上：

```
                    竞品能力边界
                    ─────────────────────────────────────
Layer 1  信息层      搜集事实、整理信息              ← 所有竞品都能做
Layer 2  因果层      远因-近因-导火索推理             ← 竞品偶尔做到，不系统
                    ═════════════════════════════════════
                    Event Insights 独有能力
                    ─────────────────────────────────────
Layer 3  框架层      选择分析框架，结构化看问题        ← 竞品完全没有
Layer 4  对抗层      反共识检验 + 替代假设 + 证伪条件  ← 竞品完全没有
Layer 5  预测层      可证伪情景（WWNBT）+ 盲点检测    ← 竞品完全没有
```

**五层引擎的实现方式**（v5 对齐实际架构）：

| 层次    | 实现位置                                         | 机制                                      |
| ------- | ------------------------------------------------ | ----------------------------------------- |
| Layer 1 | 现有 enrichment 搜索管线                         | 三层递进搜索策略（prompt 差异）           |
| Layer 2 | Leader prompt EVENT 分支扩展                     | 因果推理 prompt 段，输出到 topicConfig    |
| Layer 3 | `framework-skills.config.ts` 已有机制            | EVENT_SUBTYPE_SKILLS + .skill.md 自动注入 |
| Layer 4 | `report-synthesis.prompt.ts` EVENT 专属 addendum | 反共识视角 + 替代假设 + 证伪条件          |
| Layer 5 | `report-synthesis.prompt.ts` EVENT 专属 addendum | WWNBT 情景推演 + 观察指标                 |

**关键设计原则**：Layer 4 和 Layer 5 通过 synthesis prompt 的 EVENT 专属指令实现，而非新增独立的编排阶段。这样 EVENT 与 MACRO/TECHNOLOGY/COMPANY 走完全相同的 pipeline，差异只在 prompt 内容和 framework skills 上。

### 2.3 Layer 2：因果层

Leader 在规划维度之前，必须完成**因果假设生成**：

```
锚定文章 ──→ Leader 因果推理 ──→ 生成因果假设链 ──→ 分配给各维度验证/证伪
```

**三层因果结构**：

| 层次                         | 问题                                        | 示例（英伟达收购 Run:ai）                           |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------- |
| **远因**（Structural Cause） | 什么长期趋势/结构性矛盾导致这件事可能发生？ | AI 算力从"有就行"进入"编排效率决定 ROI"阶段         |
| **近因**（Proximate Cause）  | 什么具体条件在近期成熟，使这件事变为可能？  | Run:ai 客户规模达到临界点 + CUDA 生态需要补齐调度层 |
| **导火索**（Trigger）        | 为什么是现在？什么触发了行动？              | AMD ROCm 生态加速 + 欧盟反垄断审查窗口              |

### 2.4 Layer 3：框架层

Leader 根据事件类型，自动加载对应的**专业分析框架**（通过 `EVENT_SUBTYPE_SKILLS` 映射 + `.skill.md` 文件）：

| 事件类型          | 分析框架                                           | Skill ID                |
| ----------------- | -------------------------------------------------- | ----------------------- |
| **收购/并购**     | 交易逻辑分析（战略互补性 + 估值合理性 + 整合风险） | event-ma                |
| **政策/法规**     | 政策周期分析 + 合规级联                            | event-policy            |
| **产品发布**      | 颠覆理论（Christensen）+ 采用曲线（Rogers）        | event-product-launch    |
| **融资/IPO**      | 资本信号解读（估值逻辑 + 资金用途 + 投资人信号）   | event-funding           |
| **安全事件/危机** | 瑞士奶酪模型（多层防御失效分析）                   | event-crisis            |
| **地缘/贸易**     | 约束分析（Stratfor 方法论）+ 博弈论                | event-geopolitical      |
| **人事变动**      | 组织政治分析 + 路线信号解读                        | event-leadership        |
| **技术突破**      | Gartner Hype Cycle 定位 + 技术-商业缺口分析        | event-tech-breakthrough |

框架注入复用已有的 `chatWithSkills({ additionalSkills })` 通道，零新增配置机制。

### 2.5 Layer 4：对抗层（通过 Synthesis Prompt 实现）

**核心洞察**：所有竞品的分析都有确认偏差——LLM 形成判断后，倾向于搜集支持该判断的证据，忽略矛盾证据。

**实现方式**：`report-synthesis.prompt.ts` 中的 EVENT 专属 addendum 指示 LLM 以"Devil's Advocate"视角审视主分析，输出以下内容作为 `crossDimensionAnalysis` 或独立章节的一部分：

- **反共识视角**：主流分析的核心判断 + 同样能解释现有证据的替代解释
- **证伪条件**：什么情况下主分析大概率是错的（2-3 个可观察条件）
- **确认偏差检测**：主分析是否只引用了支持其结论的证据？

**报告呈现示例**：

```markdown
### 反共识视角

**主流分析认为**：英伟达收购 Run:ai 是为了控制 AI 算力调度权。

**但值得注意的是**：另一种同样合理的解释是，这是一笔防御性收购——
英伟达的真正恐惧是 AMD ROCm 生态在调度层补齐短板后绕过 CUDA 护城河。

**证伪条件**：如果以下任一情况出现，主分析可能需要修正：

1. 英伟达在收购后 12 个月内未将 Run:ai 集成到 CUDA 生态
2. Run:ai 继续支持 AMD GPU 调度
```

### 2.6 Layer 5：预测层（通过 Synthesis Prompt 实现）

**核心洞察**：所有竞品的预测都是不可证伪的废话——"未来充满不确定性"。

**实现方式**：synthesis prompt 的 EVENT 专属 addendum 要求生成 2-4 个 WWNBT 情景，作为报告 `strategicRecommendations` 或结论部分的一部分：

**WWNBT = "What Would Need to Be True"（要使这件事成立，什么条件必须为真）**

对每个情景：

1. **What Would Need to Be True**：具体、可观察、有时间限定的条件
2. **关键观察指标**：用户应关注什么信号（当前值 → 触发阈值）
3. **判断窗口**：在什么时间点之前应看到明确信号

**与竞品的区别**：

- 竞品说"英伟达的收购可能改变行业格局"（不可证伪）
- 我们说"如果 Run:ai 12 个月内停止支持 AMD，则垄断情景成立；否则只是防御性收购"（可证伪、可追踪）

---

## 3. 用户旅程

### 3.1 核心原则

**界面一致性**：EVENT 类型的详情页、研究进度、报告展示与现有类型完全一致。用户感知到的唯一差别是：创建时输入的是新闻 URL/内容而非主题名称。研究、报告、导出等后续所有 UI 零改动。

```
创建事件洞察 → 锚定文章解析 → 因果推理+维度规划 → 搜索+写作 → 报告合成 → 报告消费
     │              │              │                    │           │           │
  用户操作       系统自动        系统自动             系统执行     系统自动    用户操作
  (~30s)        (~10s)         (~15s)              (~3-8min)    (~30s)      (持续)
```

### 3.2 Step 1: 创建事件洞察

**入口**：用户在 `/ai-insights/topic-research` 页面点击「创建话题」按钮

**Step 1a: 选择类型**

用户在类型选择面板中看到 4 个选项卡片（现有 3 个 + 新增 EVENT）。

**Step 1b: 填写事件信息**

EVENT 类型的表单核心输入从「主题名称」变为「新闻来源」，其余字段（语言、研究深度、高级选项）与现有类型一致：

```
┌─────────────────────────────────────────────────────────┐
│  创建事件洞察                                             │
│                                                          │
│  ┌─ 输入方式 ──────────────────────────────────────┐    │
│  │  ● 新闻链接    ○ 粘贴内容                        │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  新闻链接 *                                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │ https://www.reuters.com/technology/nvidia-...     │   │
│  └──────────────────────────────────────────────────┘   │
│  ✓ 已识别来源：reuters.com                               │
│                                                          │
│  主题名称（自动生成，可编辑）                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 英伟达宣布收购 Run:ai —— AI 算力市场格局巨变       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  研究语言                                                │
│  [中文 ▾]                                                │
│                                                          │
│  ┌─ 高级选项 ─────────────────────────────────────┐    │
│  │  研究深度:  ○ 快速(4维度)  ● 标准(5维度)  ○ 深度(7维度) │
│  │  启用图表:  [✓]                                  │    │
│  │  搜索时间范围: [近6个月 ▾]                        │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│                    [取消]    [开始分析]                    │
└─────────────────────────────────────────────────────────┘
```

**关键交互细节**：

| 交互              | 行为                                                              |
| ----------------- | ----------------------------------------------------------------- |
| 输入 URL 后       | 前端展示 loading → 后端抓取文章 → 自动填充主题名称 → 展示来源域名 |
| URL 无法抓取      | 提示「无法访问该链接，请尝试粘贴内容」，自动切换到粘贴模式        |
| 粘贴内容后        | 取第一行或前 50 字符作为主题名称候选                              |
| 内容过短 (<100字) | 提示「内容较短，可能影响分析深度」，但不阻止创建                  |

**Step 1c: 提交创建**

1. 前端发送 `POST /api/v1/topic-insights/topics` + `CreateTopicDto`（含 `topicConfig.sourceUrl` 或 `topicConfig.sourceContent`）
2. 后端创建 Topic 记录（type=EVENT）
3. 前端收到响应 → 跳转到 `/ai-insights/topic/{topicId}` 详情页（与现有类型完全相同的页面）
4. 后端异步触发锚定文章解析

### 3.3 Step 2: 锚定文章解析（系统自动，用户无感）

创建 Topic 时，后端异步解析锚定文章。这一步对用户完全透明——用户看到的是与 MACRO/TECH/COMPANY 完全一致的标准详情页。

**系统在后台完成的工作**（~5-10s）：

1. URL 抓取全文（如果是 URL 输入）
2. LLM 提取标题、摘要、关键实体、事件类型（acquisition/policy/product/funding/incident/geopolitical/leadership/tech_breakthrough）
3. 评估信源可信度等级（Tier 1/2/3）
4. 结果写入 `topicConfig`（供后续 Leader 规划使用）

> 如果解析失败（URL 不可访问等），不阻塞流程——Leader 规划时降级为普通模式（无锚定文章特殊逻辑）。

### 3.4 Step 3: 研究执行（与现有类型相同的 pipeline）

用户点击「开始研究」后，EVENT 类型经过与 MACRO/TECHNOLOGY/COMPANY **完全相同的编排流程**：

```
Initialize → Plan (Leader) → Parallel Dimension Research → Cognitive Loop (V5) → Report Synthesis → Fact Check (thorough only) → Finalize
```

**差异点仅在 prompt 内容和 framework skills**：

1. **Leader planning prompt**：EVENT 分支有额外的因果推理任务（见 5.3）
2. **Framework skills**：`EVENT_SUBTYPE_SKILLS[eventType]` 自动注入（已有机制）
3. **Synthesis prompt**：EVENT 专属 addendum（反共识视角 + WWNBT）
4. **Quality gate**：EVENT case 的 soft warning（见第 8 章）

**无新增编排阶段**。Red Team、WWNBT、交叉验证均通过现有阶段的 prompt 扩展实现，而非新增独立阶段。

### 3.5 Step 4: 报告消费（与现有类型完全一致）

报告自动合成后展示在右侧面板，用户可以：

- 阅读报告（执行摘要 + 各维度分析）
- 查看证据来源
- 导出（Markdown / PDF / DOCX）
- 更新研究（增量模式）
- 版本历史与对比

### 3.6 创建流程差异汇总

```
                    现有类型 (MACRO/TECH/COMPANY)          EVENT 类型
                    ───────────────────────────          ──────────

Step 1 类型选择       一样                                一样（多一个 EVENT 卡片）
Step 1 表单          名称 + 描述                         ★ URL/粘贴 + 自动生成名称
Step 2 文章解析       无此步骤                            ★ 后端异步解析（用户无感）
Step 3 详情页        一样                                一样（完全复用）
Step 3 启动研究       一样                                一样
Step 3 Leader 规划    直接规划维度                        ★ 先因果推理，再规划维度（prompt 差异）
Step 3 Framework     类型 skill 自动注入（已有）          ★ EVENT 子类型 skill 自动注入（已有机制）
Step 3 研究执行       完全一样的 pipeline                 完全一样的 pipeline
Step 3 Synthesis     通用合成 prompt                     ★ 通用合成 + EVENT 专属 addendum
Step 4 报告展示       一样                                一样（完全复用）
Step 4 报告消费       一样                                一样（完全复用）
```

**前端只需改动 2 处**：CreateTopicDialog（EVENT 卡片 + 输入表单）、TopicCard（图标/颜色映射）。
**后端只在 prompt 和 framework-skills 层面有差异**。编排代码、报告 assembler、前端详情页全部零改动。

### 3.7 边界场景与降级策略

| 场景                             | 处理方式                                            |
| -------------------------------- | --------------------------------------------------- |
| URL 无法访问（403/付费墙）       | 创建对话框中提示用户手动粘贴内容，自动切换输入模式  |
| 文章内容过短（<200 字）          | 允许创建，但提示分析深度可能受限                    |
| 文章内容过长（>10000 字）        | 截取前 5000 字符注入 prompt，不影响用户体验         |
| 文章语言与设定语言不一致         | Leader 用设定语言输出，不阻止                       |
| 锚定文章解析失败                 | 不阻塞创建，Leader 规划时无锚定文章，降级为普通模式 |
| 因果推理质量过低（LLM 输出空泛） | Leader 自检，低质量时降级为标准维度规划模式         |
| 重复提交相同 URL                 | 前端检查是否存在同 URL 的 Topic，提示但不阻止       |

---

## 4. 维度模板

EVENT 类型**不使用固定维度模板**（维度完全由 Leader 从文章内容和因果假设推导），但在 `dimension-templates.config.ts` 中提供**分析驱动的参考框架**供 Leader prompt 引用：

> 注意：v8.0 起所有类型的维度均由 Leader AI 自主规划，模板只作为参考提示注入 Leader prompt，不自动创建维度。

```typescript
// dimension-templates.config.ts

/**
 * 事件洞察维度参考框架（分析驱动型）
 *
 * 不作为固定模板使用，仅作为 Leader AI 的规划参考
 * 每个维度有核心分析问题（analyticalQuestion），注入写作 prompt
 */
export const EVENT_INSIGHT_REFERENCE_DIMENSIONS: DimensionTemplate[] = [
  {
    id: "event_core",
    name: "事件核心：发生了什么",
    description:
      "事件全貌还原：5W1H（谁、什么、何时、何地、为何、如何），关键时间线",
    analyticalQuestion: "如果用一句话概括这个事件的本质，是什么？",
    sortOrder: 1,
  },
  {
    id: "structural_context",
    name: "结构性背景：为什么会发生",
    description:
      "事件发生的深层结构性原因：行业周期、技术成熟度、政策窗口、竞争格局演变",
    analyticalQuestion: "这个事件是偶然的还是必然的？什么结构性力量在推动？",
    sortOrder: 2,
  },
  {
    id: "trigger_and_timing",
    name: "触发与时机：为什么是现在",
    description: "直接触发因素、时间窗口分析、催化事件、竞争压力",
    analyticalQuestion:
      "为什么这件事没有早一年或晚一年发生？什么条件在此刻成熟？",
    sortOrder: 3,
  },
  {
    id: "stakeholder_map",
    name: "利益格局：谁受益谁受损",
    description: "关键利益相关方的立场、动机、博弈关系、权力不对称分析",
    analyticalQuestion:
      "谁是这个事件最大的受益者？谁的利益被损害？权力格局如何重新分配？",
    sortOrder: 4,
  },
  {
    id: "ripple_effects",
    name: "连锁反应：影响如何传导",
    description:
      "一阶影响（直接）→ 二阶影响（间接）→ 三阶影响（系统性），跨行业传导路径",
    analyticalQuestion:
      "这个事件的影响会如何层层传导？哪些看似无关的领域会被波及？",
    sortOrder: 5,
  },
  {
    id: "historical_parallel",
    name: "历史对标：有无先例可循",
    description: "历史上类似事件的对比分析、结局复盘、经验教训、关键差异",
    analyticalQuestion: "历史上有没有类似的事件？结局如何？这次有什么不同？",
    sortOrder: 6,
  },
  {
    id: "future_scenarios",
    name: "情景推演：接下来会怎样",
    description: "基准/乐观/悲观三种情景分析，关键变量识别，WWNBT 可证伪预测",
    analyticalQuestion: "这件事的发展有几种可能路径？什么变量决定走向哪条路？",
    sortOrder: 7,
  },
];
```

### 维度选择策略

Leader 根据事件类型灵活裁剪维度：

| 事件类型  | 核心维度（必选）               | 可选维度             |
| --------- | ------------------------------ | -------------------- |
| 收购/并购 | 事件核心、利益格局、连锁反应   | 结构性背景、历史对标 |
| 政策/法规 | 事件核心、结构性背景、连锁反应 | 利益格局、情景推演   |
| 产品发布  | 事件核心、利益格局、情景推演   | 结构性背景           |
| 融资/IPO  | 事件核心、利益格局、结构性背景 | 连锁反应、情景推演   |
| 安全事件  | 事件核心、连锁反应、历史对标   | 利益格局             |
| 地缘/贸易 | 全部维度                       | —                    |

---

## 5. 架构设计

### 5.1 数据模型变更

#### Prisma Schema

```prisma
// backend/prisma/schema/models.prisma

// 新增 enum 值（ResearchTopicType 现有：MACRO, TECHNOLOGY, COMPANY）
enum ResearchTopicType {
  MACRO
  TECHNOLOGY
  COMPANY
  EVENT       // ← 新增
}
```

**topicConfig（EVENT 类型使用的字段）**：

`ResearchTopic.topicConfig` 是 Json 字段，EVENT 类型使用以下结构（无需 schema 变更）：

```typescript
// EVENT topicConfig 字段说明（注释形式，实际存储为 JSON）
interface EventTopicConfig {
  // === 锚定文章信息（创建时存入）===
  sourceUrl?: string; // 原始新闻 URL
  sourceContent?: string; // 原始新闻内容（截取前 5000 字符）
  sourceTitle?: string; // 新闻标题
  sourceDate?: string; // 新闻日期（ISO 格式）
  sourceDomain?: string; // 来源域名
  sourceTier?: 1 | 2 | 3; // 信源可信度等级

  // === 事件解析结果（创建时异步写入）===
  eventType?: string; // acquisition/policy/product/funding/incident/geopolitical/leadership/tech_breakthrough
  keyEntities?: {
    people: string[];
    organizations: string[];
    technologies: string[];
    locations: string[];
  };

  // === 因果推理结果（Leader 规划阶段生成）===
  causalHypotheses?: {
    structuralCause: string; // 远因
    proximateCause: string; // 近因
    trigger: string; // 导火索
    essenceStatement: string; // 一句话本质判断
  };

  // === 通用搜索配置（与现有类型一致）===
  searchTimeRange?: string;
  enableFigures?: boolean;
  researchDepth?: string;
}
```

#### 迁移 SQL

```sql
-- backend/prisma/migrations/20260314_add_event_topic_type/migration.sql
-- 直接使用 IF NOT EXISTS，不要 DO $$ EXCEPTION 包装
ALTER TYPE "ResearchTopicType" ADD VALUE IF NOT EXISTS 'EVENT';
```

### 5.2 已存在的关键机制（无需变更）

以下机制**已经就绪**，EVENT 类型直接复用：

| 机制                                                  | 位置                                                 | 状态 |
| ----------------------------------------------------- | ---------------------------------------------------- | ---- |
| `FRAMEWORK_SKILLS_BY_TOPIC_TYPE`                      | `config/framework-skills.config.ts`                  | 已有 |
| `EVENT_SUBTYPE_SKILLS`（空占位符）                    | `config/framework-skills.config.ts`                  | 已有 |
| `resolveFrameworkSkills(type, subtype)`               | `config/framework-skills.config.ts`                  | 已有 |
| VALID_SKILLS 白名单（含 event-\* 系列）               | `services/core/leader/leader-planning.service.ts`    | 已有 |
| framework skills 自动注入（dimension_researcher）     | `services/core/leader/leader-planning.service.ts`    | 已有 |
| `chatWithSkills({ additionalSkills })`                | `services/dimension/section-writer.service.ts`       | 已有 |
| `validateDimensionContent(content, lang, topicType?)` | `services/quality/report-quality-gate.service.ts`    | 已有 |
| 报告 assembler 通用骨架                               | `shared/report-template/report-assembler.service.ts` | 已有 |
| V5 Cognitive Loop（交叉验证）                         | `services/core/topic-team-orchestrator.service.ts`   | 已有 |

### 5.3 差异点详细设计

#### 差异 1：锚定文章抓取解析

**触发时机**：Topic 创建后异步执行（不阻塞响应）
**实现方式**：轻量工具函数（不是独立 NestJS 服务），在 `topic-crud.service.ts` 的创建流程中调用

```typescript
// 新增工具函数（轻量，非 NestJS 服务）
// backend/src/modules/ai-app/topic-insights/utils/event-source-parser.utils.ts

async function parseEventSource(
  topicConfig: EventTopicConfig,
): Promise<Partial<EventTopicConfig>> {
  // 1. 如果是 URL，通过现有 web-scraper tool 抓取
  // 2. 评估信源可信度
  // 3. LLM 提取：标题、摘要、关键实体、事件类型
  // 4. 返回提取结果，调用方写入 topicConfig
}

function assessSourceTier(domain: string): 1 | 2 | 3 {
  // Tier 1: .gov / 企业官方 newsroom
  // Tier 2: reuters/bloomberg/wsj/ft/gartner/mckinsey 等
  // Tier 3: 其余
}
```

#### 差异 2：Leader 因果推理（prompt 扩展）

`research-leader.prompt.ts` 的 EVENT 分支增加以下 prompt 段（已有 `{topicType}` 分支机制）：

```
### 如果类型为 EVENT（事件洞察）：

## 第一步：因果推理（必须完成后再规划维度）

基于锚定文章，完成因果推理并输出到 causalHypotheses 字段：

1. 远因（Structural Cause）：什么长期趋势/结构性矛盾导致这件事可能发生？
2. 近因（Proximate Cause）：什么具体条件在近期成熟，使这件事变为可能？
3. 导火索（Trigger）：为什么是现在？什么触发了行动？
4. 本质判断（一句话）：这个事件的本质是什么？

## 第二步：基于因果假设规划维度

- 以因果假设为骨架，围绕事件展开分析
- 每个维度必须有明确的 analyticalQuestion（核心分析问题）
- 参考 EVENT_INSIGHT_REFERENCE_DIMENSIONS 方向，灵活调整
- 搜索策略：不搜事件本身（锚定文章已有），搜事件的背景/影响/反应

## 锚定文章内容
{sourceContent}

## 关键实体
{keyEntities}
```

#### 差异 3：EVENT_SUBTYPE_SKILLS 填充

`framework-skills.config.ts` 中的 `EVENT_SUBTYPE_SKILLS` 已声明为空占位符，需要填充：

```typescript
// 已有文件：config/framework-skills.config.ts
// 需要将占位符填充为实际映射
export const EVENT_SUBTYPE_SKILLS: Record<string, string[]> = {
  acquisition: ["event-ma"],
  policy: ["event-policy"],
  product: ["event-product-launch"],
  funding: ["event-funding"],
  incident: ["event-crisis"],
  geopolitical: ["event-geopolitical"],
  leadership: ["event-leadership"],
  tech_breakthrough: ["event-tech-breakthrough"],
};
```

对应的 `.skill.md` 文件需要创建（每个 ~1000-1500 tokens，放在 `skills/frameworks/` 目录下）。每个文件包含：事件类型的核心分析问题、Leader 分析指导、写作视角、搜索词模板。

#### 差异 4：锚定证据注入（dimension-mission）

EVENT 类型在每个维度的 enrichment 阶段，将锚定文章作为第一条证据预置：

```typescript
// services/dimension/dimension-mission.service.ts
// EVENT 类型：将锚定文章作为一级证据注入每个维度
if (
  topic.type === ResearchTopicType.EVENT &&
  topic.topicConfig?.sourceContent
) {
  const anchorEvidence = buildAnchorEvidence(topic.topicConfig);
  searchPhaseResult.evidenceData.unshift(anchorEvidence);
}
```

#### 差异 5：Synthesis Prompt EVENT 专属 Addendum

`report-synthesis.prompt.ts` 根据 `topicType === 'EVENT'` 追加以下指令：

```
## EVENT 专属合成指令（仅当 topicType 为 EVENT 时执行）

在标准报告合成基础上，额外生成以下内容：

### 反共识视角（纳入 crossDimensionAnalysis 或独立章节）
1. 主流分析的核心判断是什么？
2. 同样能解释现有证据的替代解释是什么？（至少 1 个）
3. 证伪条件：什么情况下主分析大概率是错的？（2-3 个可观察条件，12 个月内可验证）

### WWNBT 情景推演（纳入 strategicRecommendations 或独立章节）
生成 2-4 个情景，每个情景必须包含：
- What Would Need to Be True（具体可观察条件）
- 关键观察指标（当前值 → 触发阈值）
- 判断窗口（时间限定）
- 禁止不可证伪的预测

### 执行摘要结构（EVENT 使用因果脉络型，替代标准 SCR 格式）
1. 一句话本质判断（加粗，30 字以内）
2. 为什么重要（2-3 句）
3. 因果脉络表（远因/近因/导火索/事件/影响）
4. 核心发现（3-5 条，含置信度标注）
5. 谁受益谁受损（表格）
6. 关键不确定性（2-3 条）
```

#### 差异 6：Quality Gate EVENT Case

`report-quality-gate.service.ts` 的 `validateDimensionContent()` 中新增 EVENT case（与现有 MACRO/TECHNOLOGY/COMPANY case 同构）：

```typescript
case ResearchTopicType.EVENT:
  // soft warnings（不阻止，仅记录警告）
  if (!content.includes('因果') && !content.includes('causal')) {
    warnings.push('EVENT 维度建议包含因果分析');
  }
  if (content.length < 800) {
    warnings.push('EVENT 维度内容较短，建议 800 字以上');
  }
  break;
```

### 5.4 Pipeline 对比（EVENT vs 现有类型）

```
                    MACRO/TECH/COMPANY                              EVENT
                    ==================                              =====

用户输入            主题名称 + 描述                                 新闻 URL 或粘贴内容
                         │                                               │
                         │                                          ┌────┴────┐
                         │                                          │ 锚定文章 │  ← 新增（异步工具函数）
                         │                                          │ 抓取解析 │
                         │                                          └────┬────┘
                         │                                               │
                    ┌────┴────┐                                    ┌────┴────┐
                    │ Leader  │                                    │ Leader  │
                    │ 规划维度 │                                    │ 因果推理 │  ← prompt 差异
                    │         │                                    │ + 维度规划│
                    └────┬────┘                                    └────┬────┘
                         │                                               │
                    ┌────┴────────────────────────────────────────────┘
                    │
                    │  完全相同的 pipeline
                    │
                    ├── Parallel Dimension Research
                    │     └── dimension-mission（EVENT 追加锚定证据注入）
                    │
                    ├── Cognitive Loop (V5: claims + hypothesis validation)
                    │     └── 已有交叉验证能力
                    │
                    ├── Report Synthesis
                    │     └── 通用 synthesis prompt
                    │         + EVENT 专属 addendum（反共识视角 + WWNBT）← prompt 差异
                    │
                    ├── Fact Check (thorough only)
                    │
                    └── Finalize
```

---

## 6. 报告结构

### 6.1 设计原则：Assembler 零改动

**核心决策**：EVENT 报告的额外内容（反共识视角、WWNBT）通过 synthesis prompt addendum 生成，注入到现有的 `SupplementaryContent` 字段中，而非扩展 assembler 或 SupplementaryContent 接口。

- `crossDimensionAnalysis` 字段可以包含反共识视角（synthesis prompt 决定内容）
- `strategicRecommendations` 字段可以包含 WWNBT 情景推演
- `conclusion` 字段包含分析局限声明

**Assembler 行为不变**：现有硬编码章节顺序（前言 → 执行摘要 → 目录 → 维度 → 跨维度 → 风险 → 战略 → 结语）对 EVENT 类型完全适用。

### 6.2 执行摘要（EVENT 专属结构）

EVENT 类型的执行摘要使用因果脉络型结构（通过 synthesis prompt addendum 指定），替代标准 McKinsey SCR 格式：

```
1. 一句话本质判断（加粗，30 字以内）
2. 为什么重要（2-3 句）
3. 因果脉络表
   | 层次 | 内容 |
   | 远因 | ... |
   | 近因 | ... |
   | 导火索 | ... |
   | 一阶影响 | ... |
4. 核心发现（3-5 条，含置信度 [高/中/低]）
5. 谁受益谁受损（表格）
6. 关键不确定性（2-3 条）
```

约束：总长度 500-700 字，必须独立可读。

### 6.3 维度写作标准

在通用 `report-writing-standards.constants.ts` 基础上，EVENT 维度额外遵循（通过 section-writer prompt 注入）：

```
EVENT 维度写作附加要求：
1. 结论先行：每个 ### 子节的第一段必须是核心结论，不是背景铺垫
2. 因果严谨性：区分相关性和因果性（"A 导致了 B（据 XX）" vs "A 与 B 呈正相关"）
3. 量化锚点：关键数据必须有对比基准（"同比增长 23%"而非仅"增长"）
4. 时间锚定：预测性判断标注时间窗口和置信度
5. analyticalQuestion 回答：维度结尾必须对核心分析问题给出明确判断
```

### 6.4 事件时间线

作为"事件核心"维度的结构化输出，V1 用 Markdown 表格呈现：

```markdown
### 事件时间线

| 时间    | 事件                          | 类别   | 重要性 |
| ------- | ----------------------------- | ------ | ------ |
| 2023-06 | Run:ai 完成 C 轮融资 1 亿美元 | 近因   | 中     |
| 2024-01 | AMD 发布 ROCm 6.0             | 导火索 | 高     |
| 2024-03 | 英伟达宣布收购意向            | 事件   | 高     |
| 2024-04 | 欧盟反垄断审查启动            | 反应   | 高     |
| 2024-12 | 收购获批完成                  | 后续   | 高     |
```

---

## 7. 前端设计

### 7.1 改动范围

**只改 2 个文件**：

1. `CreateTopicDialog.tsx`：增加 EVENT 类型卡片 + URL/粘贴输入表单
2. `TopicCard.tsx`（或 TopicTypeIcon 组件）：新增 EVENT 图标和颜色映射

其余所有页面（TopicDetail、TopicResearchLayout、报告面板、导出、版本历史、证据面板等）完全复用，零改动。

### 7.2 CreateTopicDialog 扩展

**新增 EVENT 类型卡片**：

```typescript
{
  type: 'EVENT',
  icon: Newspaper,          // Lucide Newspaper 图标
  gradient: 'from-orange-500 to-red-500',
  title: '事件洞察',
  description: '基于新闻或线索，深挖事件来龙去脉，洞察背后本质',
}
```

**EVENT 专属 Step 2 表单**（URL/粘贴替代「主题名称+描述」，其余字段不变）：

```
输入方式:  ● 新闻链接    ○ 粘贴内容

新闻链接 *
┌──────────────────────────────────────────┐
│ https://www.reuters.com/technology/...   │
└──────────────────────────────────────────┘

主题名称（自动从文章标题生成，可编辑）*
┌──────────────────────────────────────────┐
│ 英伟达宣布收购 Run:ai                    │
└──────────────────────────────────────────┘

语言 / 研究深度 / 高级选项 → 与现有类型一致
```

**前端 topicConfig 构造**：

```typescript
// EVENT 类型提交时构造的 topicConfig
const topicConfig =
  inputMode === "url"
    ? { sourceUrl: urlInput }
    : { sourceContent: pastedContent };
```

### 7.3 TopicCard 适配

在类型→图标/颜色映射中新增 EVENT 条目：

```typescript
EVENT: { icon: Newspaper, gradient: 'from-orange-500 to-red-500' }
```

### 7.4 前端枚举扩展

前端 `ResearchTopicType` 枚举需新增 EVENT 值，与后端保持一致。

---

## 8. 质量控制

### 8.1 Quality Gate EVENT Case

在 `report-quality-gate.service.ts` 的 `validateDimensionContent()` 中新增 EVENT case，以 soft warning 形式（不阻止发布）：

| 检查项                      | 规则                                                  | 类型         |
| --------------------------- | ----------------------------------------------------- | ------------ |
| **因果分析**                | 维度内容应包含因果分析，不只是信息罗列                | soft warning |
| **analyticalQuestion 回答** | 维度结尾应对核心分析问题给出判断                      | soft warning |
| **内容长度**                | EVENT 维度建议 800 字以上                             | soft warning |
| **因果严谨性**              | 区分相关性和因果性（避免 correlation≠causation 谬误） | soft warning |
| **反共识视角**              | 整体报告应包含反共识视角（synthesis 质量检查）        | soft warning |
| **WWNBT 可证伪性**          | 情景推演条件应具体、可观察                            | soft warning |

### 8.2 三层可读性目标

报告支持三种阅读模式：

| 阅读层   | 目标读者 | 时间     | 获取内容                                    |
| -------- | -------- | -------- | ------------------------------------------- |
| **扫描** | 高管     | 30 秒    | 执行摘要一句话判断 + 因果脉络表             |
| **速读** | 决策者   | 10 分钟  | 执行摘要 + 各章要点 + 谁受益谁受损          |
| **精读** | 分析师   | 30+ 分钟 | 全文，含详细论证、时间线、反共识视角、WWNBT |

---

## 9. 实现计划

### 9.1 阶段划分

| 阶段                              | 内容                                                                       | 工作量 | 依赖   |
| --------------------------------- | -------------------------------------------------------------------------- | ------ | ------ |
| **P1: 数据模型**                  | Prisma enum 新增 EVENT + 迁移 SQL + DTO 扩展（topicConfig EVENT 字段）     | 0.5 天 | 无     |
| **P2: 锚定文章解析**              | `event-source-parser.utils.ts`（轻量工具函数，非独立服务）+ topic 创建触发 | 1 天   | P1     |
| **P3: Leader prompt EVENT 分支**  | 因果推理 prompt 段 + 锚定文章注入 + EVENT 子类型 skill 注入逻辑            | 1 天   | P2     |
| **P4: EVENT_SUBTYPE_SKILLS 填充** | 填充 `framework-skills.config.ts` 中的映射 + 8 个 `.skill.md` 文件         | 1 天   | 无     |
| **P5: Synthesis Prompt Addendum** | EVENT 专属 addendum（反共识视角 + WWNBT + 因果脉络型执行摘要）             | 1 天   | P3     |
| **P6: 锚定证据注入**              | `dimension-mission.service.ts` 中的锚定文章一级证据注入                    | 0.5 天 | P3     |
| **P7: Quality Gate EVENT case**   | `report-quality-gate.service.ts` 新增 EVENT soft warning                   | 0.5 天 | 无     |
| **P8: 前端**                      | CreateTopicDialog EVENT 卡片 + URL/粘贴输入 + TopicCard 图标 + 枚举扩展    | 0.5 天 | P1     |
| **P9: 测试**                      | 单元测试（event-source-parser, quality-gate EVENT case）+ 端到端验证       | 1.5 天 | P7, P8 |

**总工作量：约 7.5 天**

### 9.2 文件变更清单

**新增文件**：

| 文件                                                                    | 说明                     |
| ----------------------------------------------------------------------- | ------------------------ |
| `utils/event-source-parser.utils.ts`                                    | 锚定文章抓取解析工具函数 |
| `utils/__tests__/event-source-parser.utils.spec.ts`                     | 测试                     |
| `skills/frameworks/event-ma.skill.md`                                   | 并购事件分析框架         |
| `skills/frameworks/event-policy.skill.md`                               | 政策事件分析框架         |
| `skills/frameworks/event-product-launch.skill.md`                       | 产品发布事件分析框架     |
| `skills/frameworks/event-funding.skill.md`                              | 融资事件分析框架         |
| `skills/frameworks/event-crisis.skill.md`                               | 危机事件分析框架         |
| `skills/frameworks/event-geopolitical.skill.md`                         | 地缘政治事件分析框架     |
| `skills/frameworks/event-leadership.skill.md`                           | 人事变动事件分析框架     |
| `skills/frameworks/event-tech-breakthrough.skill.md`                    | 技术突破事件分析框架     |
| `backend/prisma/migrations/20260314_add_event_topic_type/migration.sql` | 迁移 SQL                 |

**修改文件**：

| 文件                                                  | 变更                                                      |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `backend/prisma/schema/models.prisma`                 | 新增 `EVENT` enum 值                                      |
| `config/dimension-templates.config.ts`                | 新增 `EVENT_INSIGHT_REFERENCE_DIMENSIONS`                 |
| `config/framework-skills.config.ts`                   | 填充 `EVENT_SUBTYPE_SKILLS` 映射                          |
| `prompts/research-leader.prompt.ts`                   | 新增 EVENT 因果推理 + 维度规划 prompt 分支                |
| `prompts/report-synthesis.prompt.ts`                  | 新增 EVENT 专属 addendum（反共识 + WWNBT + 执行摘要结构） |
| `services/core/leader/leader-planning.service.ts`     | EVENT 子类型 skill 从 `topicConfig.eventType` 自动注入    |
| `services/core/topic/topic-crud.service.ts`           | EVENT 创建时异步触发锚定文章解析                          |
| `services/dimension/dimension-mission.service.ts`     | EVENT 类型锚定证据注入（unshift 到 evidenceData）         |
| `services/quality/report-quality-gate.service.ts`     | 新增 EVENT case（soft warnings）                          |
| `dto/create-topic.dto.ts`                             | EVENT 类型 topicConfig 字段（sourceUrl/sourceContent）    |
| `frontend/.../CreateTopicDialog.tsx`                  | EVENT 类型卡片 + URL/粘贴输入表单                         |
| `frontend/.../TopicCard.tsx`（或 TopicTypeIcon 组件） | EVENT 类型图标和渐变色映射                                |
| `frontend/...` 前端 `ResearchTopicType` 枚举          | 新增 EVENT 值                                             |

### 9.3 零改动的部分

以下模块完全不需要修改：

- 报告 assembler（`report-assembler.service.ts`）— 通用骨架对 EVENT 完全适用
- 格式化管道（`dimension-content-formatting.utils.ts`）— Layer 1 格式规则类型无关
- 报告写作标准（`report-writing-standards.constants.ts`）— Layer 2 通用基线
- 图片管线（figure-extractor / figure-relevance）
- 报告导出（`topic-export.service.ts`）
- SkillLoaderService — 自动发现 `skills/frameworks/` 下新增的 `.skill.md` 文件
- `section-writer.service.ts` — 已通过 `chatWithSkills` 泛化
- V5 Cognitive Loop 编排逻辑
- 前端详情页（TopicDetail / TopicResearchLayout）
- 前端报告展示（报告面板、证据面板、版本历史、导出）

---

## 10. 风险和注意事项

### 10.1 锚定文章质量

- **问题**：用户可能粘贴无关内容、营销软文或低质量信息源
- **对策**：解析阶段加入信源可信度评估；quality gate 标注信源 tier
- **降级**：质量过低时提示用户，但不阻止创建；Leader 因果推理质量自检

### 10.2 因果推理质量

- **问题**：LLM 因果推理可能过于笼统或存在逻辑跳跃
- **对策**：Prompt 中要求每个因果层次给出具体证据线索；Leader 自检机制
- **降级**：如果因果假设无法指导具体搜索方向，降级为标准维度规划模式

### 10.3 搜索词与锚定文章重复

- **问题**：Leader 生成的搜索词可能搜到锚定文章本身
- **对策**：prompt 中明确"不搜事件本身，搜背景/影响/反应"；enrichment 阶段 URL 去重

### 10.4 Synthesis Prompt 长度

- **问题**：EVENT 专属 addendum 增加 synthesis prompt 长度，可能影响输出质量
- **对策**：addendum 控制在 500 tokens 以内；使用 outputLength: "long" task profile

### 10.5 事件时效性

- **问题**：事件洞察时效性要求高
- **对策**：Leader prompt 中明确时间范围偏好；`topicConfig.searchTimeRange` 默认值设为较短窗口

---

## 11. 未来扩展

### 11.1 多篇锚定文章支持（V2）

数据模型预留 `sourceUrls` 字段。V2 扩展：输入多个链接，多篇文章交叉验证事实一致性，多视角覆盖（中英文媒体、行业媒体 vs 大众媒体）。

### 11.2 事件追踪模式（V2）

EVENT 类型设置 `refreshFrequency: DAILY`，持续追踪事件发展。每次刷新时增量更新报告，对比上一版本的 WWNBT 情景是否验证（预测回溯机制）。

### 11.3 事件关联网络（V2）

多个 EVENT 类型的 Topic 通过关键实体（企业、人物、技术）关联，自动发现相关事件，生成跨事件因果链分析。

### 11.4 一键事件洞察（V2）

从 AI Ask（智能问答）模块，用户提问关于某个新闻时，提供"深度分析"按钮，一键创建 EVENT 类型 Topic。

### 11.5 前端时间线可视化（V2）

将 Markdown 表格形式的时间线升级为交互式可视化组件，支持按因果类别着色。

---

**最后更新**: 2026-03-14
**版本**: 5.0 — 对齐实际 codebase 状态：去掉新增编排阶段，EVENT 复用相同 pipeline，差异仅在 prompt/skills/quality-gate 层面

### 版本历史

| 版本 | 日期       | 变更                                                                                                                                                                                                         |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0  | 2026-03-12 | 初始方案：EVENT 类型基础设计                                                                                                                                                                                 |
| 2.0  | 2026-03-13 | 五层分析引擎（因果层+框架层+对抗层+预测层）、证据分级、信息新颖度检测                                                                                                                                        |
| 3.0  | 2026-03-13 | ReportSkill 架构、Red Team/WWNBT 阶段实现设计、数据模型扩展                                                                                                                                                  |
| 4.0  | 2026-03-13 | 对齐三层模型：去掉 ReportSkill 重型架构，改用 TopicTypeConfig 配置驱动 + EVENT_SUBTYPE_SKILLS + llm-task 结构化输出                                                                                          |
| 5.0  | 2026-03-14 | 对齐实际 codebase 状态：去掉新增编排阶段（crossValidation/RedTeam/WWNBT 作为独立 orchestration 阶段），改为通过 synthesis prompt addendum 实现；Assembler 零改动；迁移 SQL 修正（去掉 DO $$ EXCEPTION 包装） |
