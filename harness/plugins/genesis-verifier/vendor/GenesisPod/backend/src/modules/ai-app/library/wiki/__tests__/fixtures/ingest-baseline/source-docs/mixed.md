# AI Agent 评估方法与工程实践

随着大语言模型 (LLM) 能力的飞跃，单轮问答正在迅速让位给多步推理与工具调用的 Agent 系统。一个完整的 AI Agent 通常包含规划 (Planning)、工具调用 (Tool Use)、记忆 (Memory)、自我反思 (Reflection) 四类核心能力。如何在迭代过程中度量这些能力的真实进步、识别回归、并构造可重复的基线，是工程团队最容易忽视也最容易踩坑的环节。本文结合主流学术基准与生产落地经验，梳理 Agent 评估的常见维度、典型基准与实践陷阱，希望帮助工程团队在落地时绕开常见暗礁，构建可持续演进的评估体系，让团队对每个版本相对基线的位移方向都能做到心中有数，从而支撑稳定可控的快速迭代节奏，避免被偶然的指标波动带偏决策，也避免被单一指标遮蔽真实的能力短板与潜在的隐性风险。

## 核心能力维度

### Planning 规划

Planning is the capability that decomposes a goal into a sequence of executable sub-goals and dynamically updates the plan when the environment changes. 规划质量直接决定 Agent 能否解决多步任务，是 Agent 区别于普通问答模型的核心能力。典型的评估方式有两种：一是黑盒终点评估，只看任务整体成功率；二是过程评估，逐步检查计划合理性、子目标完整性、依赖关系正确性。后者需要人工标注的"参考计划"作为对照，成本高但能定位具体失败步骤。常用基准如 PlanBench、AutoPlanBench 已经将常见规划失败模式（dead end、goal forgetting、infinite loop）抽取成离散类目。除此之外，规划评估还应当区分静态规划与动态重规划两种场景：静态规划是一次性输出完整计划再执行，动态重规划则要求 Agent 在执行过程中根据反馈不断修正计划，后者更接近真实部署但评估难度也明显更高。

### Tool Use 工具调用

Tool Use evaluates whether the agent picks the right tool, fills parameters correctly, and recovers gracefully from tool errors. 工具调用是 Agent 与真实世界交互的窗口，也是错误传播最严重的环节。常见失败模式包括幻觉调用不存在的工具、参数类型错位、把同一工具的两次输出混淆。学术基准 ToolBench、API-Bank、Gorilla 提供了大规模 API 描述与调用样本，但生产环境更依赖团队自建黄金集来覆盖业务专属 API。一个被严重低估的细节是：评估指标不能只看"调用成功率"，还要看"调用必要性"——一个过度调用工具的 Agent 即便每次调用都对，整体效率也会非常糟糕。此外评估时还应模拟工具异常返回，例如超时、限流、字段缺失，看 Agent 是否能识别并回退而不是把错误结果当作正常输出继续推进。

### Memory 记忆

Memory in agent systems usually refers to working memory (current conversation context), episodic memory (past interactions), and external persistent stores. 记忆评估的难点是缺乏统一基准——大多数公开基准默认无状态，无法考察长程记忆。MemGPT、A-MEM 等近期工作开始构造跨会话评估场景，例如让 Agent 在第十轮对话中回忆第二轮的用户偏好。生产实践中，团队通常会记录"用户重复声明同一信息"的频次作为代理指标，频次上升即说明 Agent 记忆机制退化。记忆评估还需关注遗忘策略：当上下文窗口超限时哪些信息可以淘汰、淘汰策略是先进先出还是按重要性排序、被淘汰的信息是否会持久化到外部存储以备未来召回，这些都直接影响长期任务的连贯性。

### Reflection 自我反思

Reflection 是让 Agent 在每一步执行后审视自身输出、识别错误并自我修正的能力。代表性方法包括 ReAct、Reflexion、Self-Refine。Reflection helps the agent escape one-shot mistakes that would otherwise compound, but it is expensive: every reflection step at least doubles the token cost. 评估时不仅要看反思是否提高了最终成功率，还要计算 token-per-task 的成本，否则容易得到"准确率高但 ROI 为负"的伪结论。Reflection 还存在一个反直觉的失败模式：过度反思会让 Agent 不停否定正确答案最终选择错误答案，因此 max reflection rounds 必须设上限。一种工程上常见的折中是只在置信度低于阈值时触发反思，这样既能保留反思的纠错收益，又能避免对所有任务无差别加成本。另一个值得注意的现象是反思与提示工程的耦合：同一段反思逻辑在不同的初始提示下表现差异巨大，因此评估反思能力时必须固定基础提示模板。

## 主流学术基准

### AgentBench

AgentBench 是 Liu 等人 2023 年提出的多环境 Agent 评估框架，覆盖操作系统、数据库、知识图谱、卡牌游戏、网购、家居模拟等八个交互环境。它强调真实交互而非静态测试，模型必须实时观察反馈并调整策略。AgentBench's main contribution is the unified interface across heterogeneous environments, making it the closest thing to a "general agent leaderboard" the field has. 其局限是任务多为玩具级别，无法反映企业级长程任务的复杂度。

### GAIA

GAIA (General AI Assistants benchmark) 由 Meta、HuggingFace 等团队联合发布，包含 466 道需要浏览网页、阅读附件、跨步推理的真实问题。GAIA's problems are deliberately easy for humans (a non-expert can solve them in minutes with a search engine) but extremely hard for current LLMs — GPT-4 with tools scores only around 15% on Level 3 questions. 这种"对人简单、对机器困难"的设计是 GAIA 最大的价值，揭示了 Agent 在现实知识整合上的真实差距。

### SWE-bench

SWE-bench 把 GitHub 上的真实 issue 与对应 PR 作为评估单元，要求 Agent 读懂仓库、定位 bug、提交可通过测试的 patch。It is the closest evaluation we have to a real software engineering job, and even Claude 3.5 Sonnet with Agent harnesses scores around 50% on the verified subset. SWE-bench 的运行成本极高——每道题需要拉起完整的开发容器，单次评估全集需要数千美元，许多团队只能跑随机 20% 子集做日常回归。

## 工程评估实践

生产环境的 Agent 评估通常分四层。第一层是单元级评估：单独测每个工具调用的正确率，固定参数与上下文，覆盖核心 API 的边界条件，包括异常返回、超时与重试。这一层最像传统单元测试，应纳入持续集成流水线每次提交都跑。第二层是轨迹级评估：录制端到端轨迹，对每一步执行 LLM-as-Judge 评分，重点是判断每一步决策是否合理，而不是仅看最终结果。第三层是结果级评估：只看任务整体成功与否，配合人工抽检失败样本，定位是规划失败、工具失败还是反思失败。第四层是线上遥测：把线上对话中的取消率、降级率、用户重试率作为代理指标，覆盖离线评估永远无法穷尽的长尾场景。成熟团队会把这四层缝合到一个统一仪表盘里，任何一层出现回归都触发告警，每一层都为其他层的噪声兜底。

一个常被忽略的细节是评估抖动 (evaluation flakiness)。Agent 任务的随机性远高于普通 LLM 任务——同一提示在 temperature 等于零的情况下也可能因为工具响应顺序、外部网页变更、并发竞争产生不同结果。建议每个评估任务至少跑五次取均值并报告 95% 置信区间，单次评估的结论几乎没有参考价值。除了多次抽样，还需要对评估环境做版本快照：把测试时所用的工具版本、网页快照、数据库镜像都打包归档，否则两次评估之间环境的微小变化可能被归因到模型本身。

最后，所有 Agent 评估都应配套成本追踪：把 token 消耗、工具调用次数、运行墙钟时间作为一等公民指标，因为"准确率提升的代价是成本翻倍"是 Agent 系统的常见陷阱。一个准确率高但成本失控的 Agent 在产品上很难真正落地。建议把每条评估记录的成本、时延、准确率构成三维曲面，用帕累托前沿来挑选最优配置，而不是单维度排序。这样既能避免单纯追求精度而牺牲成本，也能在不同业务场景灵活选择不同点位。

## 团队组织建议

Agent 评估体系的搭建往往跨越多个职能：算法工程师负责模型与提示，平台工程师负责评估基础设施，产品工程师负责业务黄金集与指标定义，运营人员负责线上反馈采集。建议在团队里设立专职的评估负责人，统一管理评估代码仓、黄金集版本、评估结果归档，避免每个子团队各自实现一套互不兼容的评估流水线。评估代码也应纳入与产品代码同等的代码评审标准，禁止评估脚本中夹带未声明的隐式依赖、临时硬编码或未版本化的随机种子。最后要警惕的是评估通胀：随着模型能力提升，原本困难的基准会逐渐被"打满"，团队应当主动从生产数据中提炼新难度的评估样本，否则会陷入"分数年年涨但用户没感觉"的伪进展之中。具体做法包括：定期把生产环境中用户取消、重试、报错的对话片段脱敏后纳入新黄金集，定期淘汰已经被模型"刷穿"的旧样本，并对每个新增样本标注难度等级以便后续追踪不同档位的进展。
