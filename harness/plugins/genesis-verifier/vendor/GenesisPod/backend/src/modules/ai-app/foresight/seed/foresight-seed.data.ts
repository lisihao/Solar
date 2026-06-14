/**
 * AI 前瞻 P0 种子数据 —— 「下一代算力底座 2028–2030」示例判断资产。
 * 与 docs/demos/insight-graph-demo.html v0.4 同源；供 dogfooding 起步与产品演示。
 */

export interface SeedCard {
  cardKey: string;
  layer: string;
  title: string;
  claim: string;
  conf: number;
  sens: string;
  horizon: number;
  stage: string;
  evidence: string[];
  falsifiers: string[];
  sources: Array<{ org: string; title: string; type: string; url: string }>;
  scenarios?: Array<{ scenario: string; p: number; conf: number }>;
}

export interface SeedEdge {
  fromKey: string;
  toKey: string;
  metric: string;
  type?: "flow" | "constrain";
  weight: number;
}

export interface SeedSignal {
  name: string;
  targetKey: string;
  direction: "down" | "up";
  targetConf: number;
  effect: string;
  grade: "strong" | "weak";
  basis: Record<string, unknown>;
}

export interface SeedConclusion {
  conclKey: string;
  title: string;
  body: string;
  decisions: string[];
  trigger: string;
  upstreamKeys: string[];
  conf: number;
  horizon: number;
}

export interface SeedConfLog {
  cardKey: string;
  fromConf: number;
  toConf: number;
  actor: string;
  reason: string;
  daysAgo: number;
}

export const SEED_CARDS: SeedCard[] = [
  {
    cardKey: "A-L0-01",
    layer: "L0",
    title: "Agent 负载主体化",
    conf: 0.75,
    sens: "high",
    horizon: 2028,
    stage: "evolving",
    claim:
      "2028 年 Agent 产生的推理 token 占总推理量 >70%，人机直接对话退居次要负载形态。",
    evidence: [
      "2025–26 编码 / 研究类 Agent token 消耗年增 >20×",
      "头部 API 平台 Agent 流量占比已过半",
    ],
    falsifiers: [
      "Agent 商业化渗透率连续两季度低于预期",
      "单位任务 token 消耗因蒸馏 / 缓存大幅下降",
    ],
    sources: [
      {
        org: "Anthropic",
        title: "Economic Index — Agent 任务占比追踪",
        type: "report",
        url: "https://www.anthropic.com/economic-index",
      },
      {
        org: "OpenRouter",
        title: "模型 Token 消耗公开排行（Agent 应用占比）",
        type: "oss",
        url: "https://openrouter.ai/rankings",
      },
    ],
  },
  {
    cardKey: "A-L0-02",
    layer: "L0",
    title: "长会话 + 突发 Prefill",
    conf: 0.7,
    sens: "high",
    horizon: 2028,
    stage: "evolving",
    claim:
      "Agent 单会话平均有效上下文 >256K，工具调用回填使 prefill : decode 突发比 >10:1。",
    evidence: [
      "主流 Agent 框架默认携带全量工具结果回填",
      "上下文窗口商用上限 2 年内从 128K → 1M+",
    ],
    falsifiers: [
      "记忆检索 / 上下文压缩使有效上下文需求回落",
      "工具结果走结构化缓存而非重新 prefill",
    ],
    sources: [
      {
        org: "Anthropic",
        title: "Building Effective Agents（工具结果回填模式）",
        type: "vendor",
        url: "https://www.anthropic.com/research/building-effective-agents",
      },
      {
        org: "MCP",
        title: "Model Context Protocol 规范",
        type: "std",
        url: "https://modelcontextprotocol.io",
      },
    ],
  },
  {
    cardKey: "A-L0-03",
    layer: "L0",
    title: "Test-time Compute 扩张",
    conf: 0.65,
    sens: "high",
    horizon: 2030,
    stage: "evolving",
    claim:
      "推理算力需求 2026–2030 维持高速增长，训练 : 推理算力比降至 1:4 以下。",
    evidence: [
      "Reasoning 模型单查询 token 量较 chat 高 10–100×",
      "头部实验室公开表态推理为算力支出主体",
    ],
    falsifiers: [
      "推理蒸馏使单任务推理量级系统性下降",
      "Agent 单位经济性恶化抑制需求增长",
    ],
    sources: [
      {
        org: "OpenAI",
        title: "Learning to Reason with LLMs（o 系列）",
        type: "vendor",
        url: "https://openai.com/index/learning-to-reason-with-llms/",
      },
      {
        org: "Epoch AI",
        title: "AI 算力趋势数据库",
        type: "report",
        url: "https://epoch.ai/data",
      },
    ],
    scenarios: [
      { scenario: "延续高增 (p 0.60)", p: 0.6, conf: 0.8 },
      { scenario: "效率革命 (p 0.40)", p: 0.4, conf: 0.42 },
    ],
  },
  {
    cardKey: "A-L0-04",
    layer: "L0",
    title: "MoA 混合专家 Agent",
    conf: 0.55,
    sens: "mid",
    horizon: 2029,
    stage: "exploring",
    claim:
      "Agent 组织形态从单体走向 MoA（Mixture of Agents）：异构专家 Agent 按任务动态路由混合编排，跨 Agent 上下文共享成为新负载形态。",
    evidence: [
      "MoA 编排在基准上超越单体大模型（arXiv:2406.04692）",
      "头部实验室多 Agent 研究系统进入生产（编排者 + 子专家模式）",
    ],
    falsifiers: [
      "单体模型能力增长使多 Agent 编排收益消失",
      "跨 Agent 通信开销吞噬质量收益，行业回归单 Agent + 工具",
    ],
    sources: [
      {
        org: "Together AI",
        title: "Mixture-of-Agents (arXiv:2406.04692)",
        type: "paper",
        url: "https://arxiv.org/abs/2406.04692",
      },
      {
        org: "Anthropic",
        title: "How we built our multi-agent research system",
        type: "vendor",
        url: "https://www.anthropic.com/engineering/built-multi-agent-research-system",
      },
    ],
  },
  {
    cardKey: "A-L1-01",
    layer: "L1",
    title: "MoE 稀疏化主导",
    conf: 0.7,
    sens: "high",
    horizon: 2028,
    stage: "current",
    claim: "前沿模型全面 MoE 化，激活参数比 ≤ 1/15，总参数规模迈向 5T+。",
    evidence: [
      "DeepSeek-V3 / 前沿旗舰均采用细粒度 MoE",
      "单位 token 成本压力使 dense 路线失去经济性",
    ],
    falsifiers: [
      "某前沿实验室发布 Dense 旗舰且推理成本占优",
      "HBM 容量增长低于路线图 30% 迫使架构折返",
    ],
    sources: [
      {
        org: "DeepSeek",
        title: "DeepSeek-V3 Technical Report (arXiv:2412.19437)",
        type: "paper",
        url: "https://arxiv.org/abs/2412.19437",
      },
      {
        org: "Mistral AI",
        title: "Mixtral of Experts (arXiv:2401.04088)",
        type: "paper",
        url: "https://arxiv.org/abs/2401.04088",
      },
    ],
  },
  {
    cardKey: "A-L1-02",
    layer: "L1",
    title: "KV Cache 第一性负载",
    conf: 0.75,
    sens: "high",
    horizon: 2028,
    stage: "current",
    claim:
      "KV cache 取代权重成为推理内存第一占用，会话级 KV 复用率成为成本关键变量。",
    evidence: [
      "长上下文 Agent 场景 KV 占用已超权重 2–5×",
      "Prefix caching 命中率直接决定 $/token",
    ],
    falsifiers: [
      "线性注意力 / SSM 路线在前沿规模验证成功",
      "滑窗 + 检索混合架构使 KV 需求次线性增长",
    ],
    sources: [
      {
        org: "Moonshot AI",
        title: "Mooncake: KVCache-centric Disaggregation (arXiv:2407.00079)",
        type: "paper",
        url: "https://arxiv.org/abs/2407.00079",
      },
      {
        org: "vLLM",
        title: "Automatic Prefix Caching 文档",
        type: "oss",
        url: "https://docs.vllm.ai",
      },
    ],
  },
  {
    cardKey: "A-L1-03",
    layer: "L1",
    title: "多模态原生统一",
    conf: 0.55,
    sens: "mid",
    horizon: 2029,
    stage: "exploring",
    claim: "视频 / 音频原生进入主干模型，多模态 token 占总推理量 >40%。",
    evidence: ["原生多模态旗舰已成头部实验室标配方向"],
    falsifiers: [
      "多模态长期停留在外挂编码器 + 适配层路线",
      "视频理解需求集中于专用小模型",
    ],
    sources: [
      {
        org: "Google DeepMind",
        title: "Gemini 原生多模态技术页",
        type: "vendor",
        url: "https://deepmind.google/technologies/gemini/",
      },
      {
        org: "OpenAI",
        title: "Hello GPT-4o（原生全模态）",
        type: "vendor",
        url: "https://openai.com/index/hello-gpt-4o/",
      },
    ],
  },
  {
    cardKey: "A-L2-01",
    layer: "L2",
    title: "PD 分离标准化",
    conf: 0.8,
    sens: "mid",
    horizon: 2027,
    stage: "current",
    claim: "Prefill / Decode 分离 + 异构实例配比成为推理引擎默认架构。",
    evidence: ["vLLM / SGLang / Dynamo 等主流栈均已内置 PD 分离"],
    falsifiers: ["超大 SRAM 类芯片使统一调度反而占优"],
    sources: [
      {
        org: "PKU / UCSD",
        title: "DistServe: PD 分离推理 (arXiv:2401.09670)",
        type: "paper",
        url: "https://arxiv.org/abs/2401.09670",
      },
      {
        org: "NVIDIA",
        title: "Dynamo 分布式推理框架",
        type: "vendor",
        url: "https://developer.nvidia.com/dynamo",
      },
    ],
  },
  {
    cardKey: "A-L2-02",
    layer: "L2",
    title: "KV 分层卸载体系",
    conf: 0.65,
    sens: "mid",
    horizon: 2028,
    stage: "evolving",
    claim:
      "HBM → DRAM → NVMe 三级 KV cache 体系商用化，分层命中率决定推理 TCO。",
    evidence: [
      "LMCache / Mooncake 类系统已在生产验证",
      "DRAM 池化 + RDMA 取回延迟进入可用区间",
    ],
    falsifiers: ["NVMe 取回延迟无法满足 decode SLA，卸载止步 DRAM"],
    sources: [
      {
        org: "LMCache",
        title: "LMCache — KV 多级缓存开源实现",
        type: "oss",
        url: "https://github.com/LMCache/LMCache",
      },
      {
        org: "Moonshot AI",
        title: "Mooncake 存算分离生产实践 (arXiv:2407.00079)",
        type: "paper",
        url: "https://arxiv.org/abs/2407.00079",
      },
    ],
  },
  {
    cardKey: "A-L2-03",
    layer: "L2",
    title: "会话感知调度",
    conf: 0.7,
    sens: "low",
    horizon: 2028,
    stage: "exploring",
    claim:
      "集群调度器从无状态请求路由演进为会话亲和 + KV 位置感知的有状态调度。",
    evidence: ["Agent 会话生命周期从秒级拉长到小时级"],
    falsifiers: ["KV 迁移成本低到调度无需位置感知"],
    sources: [
      {
        org: "SGLang",
        title: "RadixAttention / 会话亲和调度",
        type: "oss",
        url: "https://github.com/sgl-project/sglang",
      },
      {
        org: "vLLM",
        title: "生产环境调度文档",
        type: "oss",
        url: "https://docs.vllm.ai",
      },
    ],
  },
  {
    cardKey: "A-L3-01",
    layer: "L3",
    title: "Scale-up 域扩张",
    conf: 0.65,
    sens: "high",
    horizon: 2028,
    stage: "evolving",
    claim: "单 scale-up 域从 72 卡扩至 576+ 卡，域内呈现统一内存语义。",
    evidence: [
      "NVL72 → Kyber 576 路线图公开",
      "MoE 专家并行通信量随稀疏度上升",
    ],
    falsifiers: [
      "铜 / 光成本使 >144 卡域 TCO 不成立",
      "EP 通信压缩使大域必要性显著下降",
    ],
    sources: [
      {
        org: "NVIDIA",
        title: "GB200 NVL72 产品页（72 卡域基线）",
        type: "vendor",
        url: "https://www.nvidia.com/en-us/data-center/gb200-nvl72/",
      },
      {
        org: "SemiAnalysis",
        title: "GPU 集群与机架架构深度研报",
        type: "report",
        url: "https://semianalysis.com",
      },
    ],
  },
  {
    cardKey: "A-L3-02",
    layer: "L3",
    title: "KV 专用存储层",
    conf: 0.6,
    sens: "mid",
    horizon: 2029,
    stage: "exploring",
    claim:
      "存储系统分化出 KV / 上下文专用层：高 IOPS、微秒级延迟、近计算部署。",
    evidence: ["多家存储厂商发布 KV cache offload 专用产品线"],
    falsifiers: ["通用并行文件系统 + 客户端缓存即可满足 SLA"],
    sources: [
      {
        org: "VAST Data",
        title: "AI 推理存储平台（KV cache offload）",
        type: "vendor",
        url: "https://www.vastdata.com",
      },
      {
        org: "WEKA",
        title: "Augmented Memory Grid",
        type: "vendor",
        url: "https://www.weka.io",
      },
    ],
  },
  {
    cardKey: "A-L3-03",
    layer: "L3",
    title: "Scale-out 以太网化",
    conf: 0.6,
    sens: "low",
    horizon: 2028,
    stage: "evolving",
    claim: "UEC 以太网在 scale-out 互联取代 InfiniBand 成为新建集群主流。",
    evidence: ["超大集群成本敏感度 + 多供应商诉求驱动"],
    falsifiers: ["UEC 生态成熟度不足，IB 在旗舰集群继续锁定"],
    sources: [
      {
        org: "UEC",
        title: "Ultra Ethernet Consortium 1.0 规范",
        type: "std",
        url: "https://ultraethernet.org",
      },
      {
        org: "Broadcom",
        title: "Tomahawk 交换芯片产品线",
        type: "vendor",
        url: "https://www.broadcom.com/products/ethernet-connectivity/switching/strataxgs",
      },
    ],
  },
  {
    cardKey: "A-L3-04",
    layer: "L3",
    title: "三网合一（统一 Fabric）",
    conf: 0.5,
    sens: "mid",
    horizon: 2030,
    stage: "exploring",
    claim:
      "智算（scale-up / scale-out）、存储、通算三张网在以太网底座上融合为统一 fabric：UEC 承载 + 存储流量并网 + CXL 语义互通，独立存储网络逐步消失。",
    evidence: [
      "UEC 1.0 同时面向 AI 与存储流量设计",
      "头部云厂新建集群已试点计算 / 存储共网",
    ],
    falsifiers: [
      "尾延迟干扰使存储流量被迫重新独立组网",
      "scale-up 域专用互联（NVLink 类）长期不向以太收敛",
    ],
    sources: [
      {
        org: "UEC",
        title: "Ultra Ethernet 1.0 — AI 与存储统一传输",
        type: "std",
        url: "https://ultraethernet.org",
      },
      {
        org: "CXL Consortium",
        title: "CXL 3.x 规范（内存语义互联）",
        type: "std",
        url: "https://computeexpresslink.org",
      },
    ],
  },
  {
    cardKey: "A-L4-01",
    layer: "L4",
    title: "HBM4 路线图兑现",
    conf: 0.6,
    sens: "high",
    horizon: 2028,
    stage: "evolving",
    claim:
      "HBM4 于 2026–27 量产，2028 单栈达 48GB / 2TB·s 级，供应不构成第一瓶颈。",
    evidence: ["三大 HBM 厂商路线图公开且节奏一致", "头部买家已签长期产能协议"],
    falsifiers: [
      "HBM4 良率爬坡延期超过 2 个季度",
      "头部买家锁产能造成结构性短缺",
    ],
    sources: [
      {
        org: "SK hynix",
        title: "HBM4 开发与量产节奏（Newsroom）",
        type: "vendor",
        url: "https://news.skhynix.com",
      },
      {
        org: "TrendForce",
        title: "HBM 供需与价格季度研报",
        type: "report",
        url: "https://www.trendforce.com",
      },
    ],
  },
  {
    cardKey: "A-L4-02",
    layer: "L4",
    title: "推理 ASIC 分流",
    conf: 0.5,
    sens: "mid",
    horizon: 2029,
    stage: "evolving",
    claim: "自研 / 第三方推理 ASIC 按算力计承接 >30% 推理 token。",
    evidence: ["云厂自研芯片迭代至 3–4 代，推理性价比逼近 GPU"],
    falsifiers: [
      "CUDA 生态 + 快速迭代使 ASIC 始终慢一个身位",
      "ASIC 拿不到足额 HBM 产能",
    ],
    sources: [
      {
        org: "Google Cloud",
        title: "TPU 代际路线（Trillium / Ironwood）",
        type: "vendor",
        url: "https://cloud.google.com/tpu",
      },
      {
        org: "AWS",
        title: "Trainium / Inferentia 自研芯片",
        type: "vendor",
        url: "https://aws.amazon.com/ai/machine-learning/trainium/",
      },
    ],
    scenarios: [
      { scenario: "ASIC 分流成立 (p 0.45)", p: 0.45, conf: 0.78 },
      { scenario: "GPU 主导延续 (p 0.55)", p: 0.55, conf: 0.27 },
    ],
  },
  {
    cardKey: "A-L4-03",
    layer: "L4",
    title: "CPO 进入 Scale-up",
    conf: 0.55,
    sens: "mid",
    horizon: 2029,
    stage: "exploring",
    claim: "共封装光学（CPO）在 576 卡级 scale-up 域商用，替代部分铜互联。",
    evidence: ["交换机侧 CPO 已商用，XPU 侧路线图公开"],
    falsifiers: [
      "有源铜缆 + 机架架构折中将光推迟到 2030 后",
      "CPO 可维护性 / 良率问题未解",
    ],
    sources: [
      {
        org: "NVIDIA",
        title: "Quantum-X / Spectrum-X Photonics（CPO 交换）",
        type: "vendor",
        url: "https://nvidianews.nvidia.com",
      },
      {
        org: "Broadcom",
        title: "Bailly 51.2T CPO 平台",
        type: "vendor",
        url: "https://www.broadcom.com",
      },
    ],
  },
  {
    cardKey: "A-L4-04",
    layer: "L4",
    title: "近存计算商用萌芽",
    conf: 0.45,
    sens: "low",
    horizon: 2030,
    stage: "research",
    claim:
      "3D 堆叠 / 近存计算在 KV 检索、attention 等访存密集环节出现商用产品。",
    evidence: ["PIM 原型在 attention kernel 上展示数倍能效"],
    falsifiers: ["编程模型碎片化导致无人愿意适配"],
    sources: [
      {
        org: "Samsung",
        title: "HBM-PIM 近存计算",
        type: "vendor",
        url: "https://semiconductor.samsung.com",
      },
      {
        org: "SK hynix",
        title: "AiM（Accelerator-in-Memory）",
        type: "vendor",
        url: "https://news.skhynix.com",
      },
    ],
  },
  {
    cardKey: "A-L5-01",
    layer: "L5",
    title: "机架功率密度跃迁",
    conf: 0.75,
    sens: "high",
    horizon: 2028,
    stage: "evolving",
    claim:
      "旗舰 AI 机架功率从 130kW 走向 600kW–1MW，机架成为新的系统设计单元。",
    evidence: ["NVL72 实测 ~130kW，Rubin Ultra 代际公开指引 600kW 级"],
    falsifiers: ["散热 / 供电瓶颈迫使域扩张转向多机架低密度方案"],
    sources: [
      {
        org: "NVIDIA",
        title: "GTC Keynote — Rubin Ultra / Kyber 600kW 机架",
        type: "vendor",
        url: "https://www.nvidia.com/gtc/keynote/",
      },
      {
        org: "DCD",
        title: "Data Center Dynamics 高密机架追踪",
        type: "report",
        url: "https://www.datacenterdynamics.com",
      },
    ],
  },
  {
    cardKey: "A-L5-02",
    layer: "L5",
    title: "液冷全面渗透",
    conf: 0.7,
    sens: "low",
    horizon: 2028,
    stage: "current",
    claim: "新建 AI 数据中心液冷渗透率 >80%，DLC 为主、浸没式在高密段起量。",
    evidence: ["100kW+ 机架风冷物理不可行，无替代路线"],
    falsifiers: ["新型相变 / 喷淋方案改变渗透结构（仅影响形态）"],
    sources: [
      {
        org: "Uptime Institute",
        title: "全球数据中心调查（液冷渗透率）",
        type: "report",
        url: "https://uptimeinstitute.com/resources",
      },
      {
        org: "Vertiv",
        title: "DLC 直接液冷方案白皮书",
        type: "vendor",
        url: "https://www.vertiv.com",
      },
    ],
  },
  {
    cardKey: "A-L5-03",
    layer: "L5",
    title: "电力第一约束",
    conf: 0.7,
    sens: "high",
    horizon: 2030,
    stage: "evolving",
    claim:
      "GW 级园区常态化，电力获取（自备电 / SMR / 储能）成为算力扩张第一约束，并反压上层算力规划。",
    evidence: [
      "主要 Hub 电网接入排队 2–4 年",
      "头部云厂均已布局核电 / 燃气自备电",
    ],
    falsifiers: ["电网扩容 + 跨区调度超预期，电力回到普通成本项"],
    sources: [
      {
        org: "IEA",
        title: "Energy and AI 报告",
        type: "report",
        url: "https://www.iea.org/reports/energy-and-ai",
      },
      {
        org: "EPRI",
        title: "数据中心用电增长预测",
        type: "report",
        url: "https://www.epri.com",
      },
    ],
  },
  {
    cardKey: "A-L5-04",
    layer: "L5",
    title: "MW 级机架与 HVDC 供电",
    conf: 0.45,
    sens: "high",
    horizon: 2030,
    stage: "research",
    claim:
      "2030 旗舰机架功率突破 1MW，供电架构从 415V AC 转向 ±400V / 800V HVDC 直流母线，机架升格为数据中心的最小设计单元。",
    evidence: [
      "NVIDIA 公布 800V HVDC 机架供电路线（Rubin Ultra 之后代际）",
      "Vertiv / Delta 等发布 800VDC 整机架电源方案",
    ],
    falsifiers: [
      "散热与供电瓶颈使行业长期停在 600kW 平台期",
      "多机架低密度方案 TCO 反超高密单机架",
    ],
    sources: [
      {
        org: "NVIDIA",
        title: "800V HVDC 数据中心供电架构",
        type: "vendor",
        url: "https://developer.nvidia.com/blog",
      },
      {
        org: "OCP",
        title: "Open Compute — 高压直流机架供电规范",
        type: "std",
        url: "https://www.opencompute.org",
      },
    ],
    scenarios: [
      { scenario: "高密集中化 (p 0.55)", p: 0.55, conf: 0.65 },
      { scenario: "低密分布式 (p 0.45)", p: 0.45, conf: 0.21 },
    ],
  },
];

export const SEED_EDGES: SeedEdge[] = [
  {
    fromKey: "A-L0-01",
    toKey: "A-L2-03",
    metric: "并发会话数 / 会话生命周期",
    weight: 0.7,
  },
  {
    fromKey: "A-L0-02",
    toKey: "A-L1-02",
    metric: "上下文长度分布",
    weight: 0.9,
  },
  {
    fromKey: "A-L0-02",
    toKey: "A-L2-01",
    metric: "prefill : decode 突发比",
    weight: 0.7,
  },
  {
    fromKey: "A-L0-03",
    toKey: "A-L1-01",
    metric: "$ / token 成本压力",
    weight: 0.7,
  },
  { fromKey: "A-L0-03", toKey: "A-L4-02", metric: "推理算力总盘", weight: 0.6 },
  {
    fromKey: "A-L0-03",
    toKey: "A-L5-03",
    metric: "总算力 → 总电力需求",
    weight: 0.8,
  },
  {
    fromKey: "A-L1-01",
    toKey: "A-L3-01",
    metric: "专家并行 EP 通信量",
    weight: 0.8,
  },
  {
    fromKey: "A-L1-02",
    toKey: "A-L2-01",
    metric: "KV 容量 / 迁移需求",
    weight: 0.8,
  },
  {
    fromKey: "A-L1-02",
    toKey: "A-L2-02",
    metric: "KV 容量分层曲线",
    weight: 0.9,
  },
  {
    fromKey: "A-L1-02",
    toKey: "A-L4-04",
    metric: "attention 访存密度",
    weight: 0.5,
  },
  {
    fromKey: "A-L1-03",
    toKey: "A-L1-02",
    metric: "多模态 token 膨胀系数",
    weight: 0.6,
  },
  {
    fromKey: "A-L2-01",
    toKey: "A-L3-01",
    metric: "PD 间 KV 迁移带宽",
    weight: 0.6,
  },
  {
    fromKey: "A-L2-02",
    toKey: "A-L3-02",
    metric: "二级存储 IOPS / 延迟 SLA",
    weight: 0.8,
  },
  {
    fromKey: "A-L2-03",
    toKey: "A-L3-03",
    metric: "东西向流量模式",
    weight: 0.5,
  },
  {
    fromKey: "A-L4-01",
    toKey: "A-L1-01",
    metric: "HBM 容量 / 带宽上限",
    type: "constrain",
    weight: 0.8,
  },
  {
    fromKey: "A-L4-01",
    toKey: "A-L4-02",
    metric: "HBM 产能分配",
    type: "constrain",
    weight: 0.7,
  },
  {
    fromKey: "A-L3-01",
    toKey: "A-L4-03",
    metric: "互联距离 × 带宽密度",
    weight: 0.7,
  },
  { fromKey: "A-L3-01", toKey: "A-L5-01", metric: "域内功率密度", weight: 0.9 },
  { fromKey: "A-L4-03", toKey: "A-L5-01", metric: "互联功耗占比", weight: 0.5 },
  { fromKey: "A-L5-01", toKey: "A-L5-02", metric: "单机架热密度", weight: 0.9 },
  { fromKey: "A-L5-01", toKey: "A-L5-03", metric: "园区供电需求", weight: 0.8 },
  {
    fromKey: "A-L5-03",
    toKey: "A-L0-03",
    metric: "可用算力上限（反压）",
    type: "constrain",
    weight: 0.6,
  },
  {
    fromKey: "A-L0-01",
    toKey: "A-L0-04",
    metric: "任务复杂度分布",
    weight: 0.6,
  },
  {
    fromKey: "A-L0-04",
    toKey: "A-L1-02",
    metric: "跨 Agent 上下文共享量",
    weight: 0.6,
  },
  {
    fromKey: "A-L0-04",
    toKey: "A-L2-03",
    metric: "Agent 间路由 / 编排开销",
    weight: 0.6,
  },
  {
    fromKey: "A-L3-03",
    toKey: "A-L3-04",
    metric: "以太网语义覆盖度",
    weight: 0.7,
  },
  {
    fromKey: "A-L2-02",
    toKey: "A-L3-04",
    metric: "存储流量并网比例",
    weight: 0.5,
  },
  {
    fromKey: "A-L3-04",
    toKey: "A-L5-01",
    metric: "网络功耗 / 布线密度",
    weight: 0.5,
  },
  { fromKey: "A-L5-01", toKey: "A-L5-04", metric: "代际功率曲线", weight: 0.7 },
  {
    fromKey: "A-L5-04",
    toKey: "A-L5-03",
    metric: "单机架供电需求（HVDC）",
    weight: 0.6,
  },
];

export const SEED_SIGNALS: SeedSignal[] = [
  {
    name: "HBM4 良率爬坡延期 12 个月",
    targetKey: "A-L4-01",
    direction: "down",
    targetConf: 0.35,
    effect:
      "证伪信号命中「HBM4 路线图兑现」— 裁定后置信度 0.60 → 0.35。HBM 容量约束沿图谱向模型架构、推理 ASIC、scale-up 域规划传导。",
    grade: "strong",
    basis: {
      falsifier: "HBM4 良率爬坡延期超过 2 个季度",
      dir: "证伪方向 — 命中后置信度下调",
      threshold: "延期 > 2 个季度",
      observed: "≈ 4 个季度（12 个月）",
      gradeNote: "多源独立确认：厂商财报口径 + 渠道研报交叉验证",
      sources: [
        {
          org: "SK hynix",
          title: "季度财报电话会 — HBM4 量产指引调整",
          type: "vendor",
          url: "https://news.skhynix.com",
        },
        {
          org: "TrendForce",
          title: "HBM 供需季度研报 — 量产节奏下修",
          type: "report",
          url: "https://www.trendforce.com",
        },
      ],
    },
  },
  {
    name: "前沿实验室发布 Dense 旗舰，推理成本反超 MoE",
    targetKey: "A-L1-01",
    direction: "down",
    targetConf: 0.45,
    effect:
      "证伪信号命中「MoE 稀疏化主导」— 裁定后置信度 0.70 → 0.45。EP 通信量假设失效，scale-up 域扩张的必要性需重估。",
    grade: "strong",
    basis: {
      falsifier: "某前沿实验室发布 Dense 旗舰且推理成本占优",
      dir: "证伪方向 — 命中后置信度下调",
      threshold: "Dense 旗舰发布 且 同级任务 $/token 低于 MoE 旗舰",
      observed: "两项条件均满足（技术报告 + 第三方基准）",
      gradeNote: "架构信息来自官方技术报告，成本数据来自独立基准平台",
      sources: [
        {
          org: "arXiv",
          title: "旗舰模型技术报告（架构披露）",
          type: "paper",
          url: "https://arxiv.org",
        },
        {
          org: "Artificial Analysis",
          title: "跨模型推理成本独立基准",
          type: "report",
          url: "https://artificialanalysis.ai",
        },
      ],
    },
  },
  {
    name: "北美主要 Hub 电网接入排队超 4 年",
    targetKey: "A-L5-03",
    direction: "up",
    targetConf: 0.85,
    effect:
      "约束收紧：「电力第一约束」裁定后置信度 0.70 → 0.85。物理层约束沿反压边向上传导，总算力供给假设需下修。",
    grade: "strong",
    basis: {
      falsifier: "监测条件：主要 Hub 接入排队时长突破基线（2–4 年）",
      dir: "约束收紧方向 — 命中后置信度上调",
      threshold: "排队时长 > 4 年（任一主要 Hub 区域）",
      observed: "PJM / ERCOT 区域 > 4 年",
      gradeNote: "权威年度报告 + 国际机构交叉验证",
      sources: [
        {
          org: "LBNL",
          title: "Queued Up — 电网互联排队年度报告",
          type: "report",
          url: "https://emp.lbl.gov/queues",
        },
        {
          org: "IEA",
          title: "Energy and AI（数据中心用电章节）",
          type: "report",
          url: "https://www.iea.org/reports/energy-and-ai",
        },
      ],
    },
  },
];

export const SEED_CONCLUSIONS: SeedConclusion[] = [
  {
    conclKey: "C-01",
    title: "2026 H2 前锁定 HBM 产能，采购按 $/GB·s 而非 $/FLOPS 谈判",
    body: "KV 需求 = 并发会话 × 上下文长度 × bytes/token：按 Agent 负载曲线推算，2028 推理集群内存成本占 BOM 从 ~35% 升至 50%+。HBM4 供应紧张下先锁产能者拿到结构性成本优势，等现货意味着溢价 30% 起。",
    decisions: [
      "2026 H2 前与 ≥2 家 HBM 供应方签 2028 产能框架协议，不接受单一供应",
      "采购评估模型第一指标改为内存带宽利用率（$/GB·s），算力指标降为第二",
      "推理栈必须支持 KV 分层卸载（DRAM/NVMe 可降 HBM 需求 30–50%），不支持的方案一票否决",
    ],
    trigger:
      "HBM4 现货价回落 >20%，或线性注意力在前沿规模验证成功 → 本结论降级重估",
    upstreamKeys: ["A-L4-01", "A-L1-02", "A-L2-02"],
    conf: 0.7,
    horizon: 2028,
  },
  {
    conclKey: "C-02",
    title:
      "2027 起新建机房必须按 ≥600kW/机架 + 液冷设计，否则错过 2029 旗舰代际",
    body: "域扩张 576 卡 → 单机架 600kW（厂商公开指引），机房从设计到投产 24–36 个月：2027 年还按 130kW 风冷设计的机房，2029–2030 无法承接旗舰部署；事后改造成本是新建预留的 3–5 倍。",
    decisions: [
      "新建项目供电 / 楼板承重 / 液冷管路按 600kW–1MW 机架预留（MW 级为 2030 上限情景）",
      "2026 年内完成液冷供应商认证 + 试点机柜运行数据",
      "存量机房明确定位为低密推理 / 通算，不再投入追旗舰代际",
    ],
    trigger: "行业停在 600kW 平台期（A-L5-04 证伪）→ 1MW 预留要求降级",
    upstreamKeys: ["A-L3-01", "A-L4-03", "A-L5-01", "A-L5-04"],
    conf: 0.65,
    horizon: 2028,
  },
  {
    conclKey: "C-03",
    title: "算力扩张必须电力先行：2030 目标容量的能源合约 2026–27 必须落定",
    body: "主要 Hub 接入排队 2–4 年且持续恶化，GW 级园区从谈判到通电 ≥36 个月。决定 2029–2030 实际可部署算力的是电力获取节奏而非芯片供应——按当前排队曲线，2030 电力缺口约为行业规划量的 30–40%。",
    decisions: [
      "每 100MW 算力规划同步启动能源组合谈判（自备燃气 / 核电 PPA / 储能调峰）",
      "选址权重重排：电力可得性 > 网络时延 > 地价",
      "设电力里程碑门：能源合约未落定，不批准对应算力 CAPEX",
    ],
    trigger: "电网扩容超预期使排队 <2 年 → 电力降级为普通成本项",
    upstreamKeys: ["A-L5-03", "A-L5-01", "A-L0-03"],
    conf: 0.7,
    horizon: 2030,
  },
  {
    conclKey: "C-04",
    title: "所有新系统设计必须回答「会话状态放哪」——无状态假设已失效",
    body: "Agent 会话拉长到小时级 × 256K 上下文，状态量级达 GB/会话；调度（亲和性）、存储（KV 分层）、网络（迁移带宽）三个域的设计被状态布局绑定，事后补救等于全链路重构。MoA 编排进一步增加跨 Agent 状态共享需求。",
    decisions: [
      "架构评审增加必答项：会话状态容量模型 / 放置策略 / 迁移成本三件套",
      "中间件与调度选型必须支持 KV 位置感知，不支持的不进短名单",
      "KV 命中率纳入容量规划 KPI——命中率每提升 10%，prefill 算力需求约降 8–12%",
    ],
    trigger: "SSM / 线性注意力在前沿规模验证成功 → KV 量级假设全线重估",
    upstreamKeys: ["A-L0-01", "A-L0-02", "A-L0-04", "A-L1-02", "A-L2-03"],
    conf: 0.75,
    horizon: 2028,
  },
  {
    conclKey: "C-05",
    title: "网络投资押注以太网底座，但存储并网保留独立逃生门",
    body: "Scale-out 以太化（conf 0.60）是高置信方向，三网合一（conf 0.50）仍在探索期：统一 fabric 省 CAPEX 与布线功耗，但存储流量尾延迟干扰风险未消除，押满注会被单点证伪打穿。",
    decisions: [
      "新建集群 scale-out 直接选 UEC 以太网，停止 InfiniBand 新增投资",
      "存储网先共物理层、保留逻辑隔离（VLAN/QoS 分级），并网失败可 6 个月内回退",
      "跟踪 scale-up 开放互联（UALink / NVLink Fusion 类），每半年评估收敛时点",
    ],
    trigger: "旗舰集群出现 ≥2 例存储流量被迫重新独立组网 → 三网合一假设下调",
    upstreamKeys: ["A-L3-03", "A-L3-04", "A-L3-02"],
    conf: 0.6,
    horizon: 2030,
  },
];

export const SEED_CONF_LOGS: SeedConfLog[] = [
  {
    cardKey: "A-L4-01",
    fromConf: 0.7,
    toConf: 0.6,
    actor: "Champion-L4",
    reason: "渠道传闻 HBM4 良率爬坡偏慢，季度复核下调",
    daysAgo: 31,
  },
  {
    cardKey: "A-L4-01",
    fromConf: 0.65,
    toConf: 0.7,
    actor: "Champion-L4",
    reason: "三大厂商量产时间表官宣一致，上调",
    daysAgo: 102,
  },
  {
    cardKey: "A-L5-01",
    fromConf: 0.7,
    toConf: 0.75,
    actor: "Champion-L5",
    reason: "Kyber 600kW 级机架实测数据公开，上调",
    daysAgo: 3,
  },
  {
    cardKey: "A-L1-01",
    fromConf: 0.65,
    toConf: 0.7,
    actor: "Owner",
    reason: "两家前沿实验室旗舰均确认细粒度 MoE，上调",
    daysAgo: 53,
  },
];
