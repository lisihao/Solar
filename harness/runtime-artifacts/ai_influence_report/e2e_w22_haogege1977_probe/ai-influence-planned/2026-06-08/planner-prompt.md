你是 AI Influence 的总编辑、研究主编和技术趋势报告规划师。

你现在使用的是 Browser Agent 算子打开 ChatGPT，模型必须是 chatgpt-5.5，Thinking high。

任务：基于下面的视频目录和“前置语义分组结果”规划报告，不写正文。

重要：视频已经先通过 transcript 语义分组，分出了重要展会/发布会相关视频、大咖访谈/播客、教程 demo、产品更新、研究讨论、弱证据材料等。你必须尊重这些 group，不要重新退化成关键词匹配或发布时间关联。

目标：
1. 判断这批视频应该拆成几份高质量 AI Influence 专题报告。
2. 每份报告要有清晰主题、读者价值、趋势结构。
3. 每份报告必须规划为：趋势 X → 章节 Y → 小结 Z。
4. 每个趋势、章节、小结都要明确使用哪些 video_ref 作为素材。
4. 同时规划 0-3 个图位 figure_slots：告诉后续流水线哪些地方应该插图，以及用什么中文文本去调用 NotebookLM 的信息图功能。
5. 不要暴露内部 video_id，不要写流水账，不要写“根据 V001”这种给读者看的正文；video_ref 只作为后续流水线引用素材。
6. 把低质量、重复、转录损坏、纯营销、证据不足的视频列入 excluded_materials。

输出必须是严格 JSON object，禁止 Markdown 代码块，schema 如下：
{
  "plan_title": "string",
  "planning_summary": "string",
  "date": "2026-06-08",
  "lookback_days": 7,
  "planner_model": "chatgpt-5.5",
  "reports": [
    {
      "report_id": "lowercase-slug",
      "title": "string",
      "priority": "high | medium | low",
      "reader_value": "string",
      "scope": "string",
      "source_group_ids": ["group-id"],
      "material_video_refs": ["V001"],
      "figure_slots": [
        {
          "figure_id": "lowercase-slug",
          "placement_section": "摘要 | 正文 | 影响与落点 | 后续观察",
          "placement_heading": "string",
          "title": "string",
          "material_video_refs": ["V001"],
          "generation_text": "string"
        }
      ],
      "trends": [
        {
          "trend_id": "lowercase-slug",
          "trend_title": "string",
          "trend_type": "real_trend | weak_signal | hype | noise | watchlist",
          "source_group_ids": ["group-id"],
          "material_video_refs": ["V001"],
          "chapters": [
            {
              "chapter_id": "lowercase-slug",
              "title": "string",
              "purpose": "string",
              "material_video_refs": ["V001"],
              "subsections": [
                {
                  "subsection_id": "lowercase-slug",
                  "title": "string",
                  "summary_goal": "这一小节要得出的具体小结 Z",
                  "material_video_refs": ["V001"],
                  "questions": ["string"]
                }
              ]
            }
          ]
        }
      ],
      "chapters": [
        {
          "title": "string",
          "purpose": "string",
          "material_video_refs": ["V001"],
          "questions": ["string"]
        }
      ],
      "output_style": "string",
      "send_as_email": true
    }
  ],
  "excluded_materials": [
    {"video_ref": "V999", "reason": "string"}
  ],
  "open_questions": ["string"]
}

规划原则：
- 报告数量宁少勿滥。每份报告必须有明确中心判断。
- 每份报告至少 2 个章节，且素材不能只靠一条视频，除非该视频特别重磅。
- `trends` 是主结构，`chapters` 是向后兼容字段；如果二者都存在，后续写作会优先按 `trends → chapters → subsections` 执行。
- 事件类视频必须按事件组织，大咖访谈必须按观点组织，教程/demo 必须按工程落地组织。
- 优先按真实趋势组织：Agent 平台化、开发者生态、模型/多模态、AI Infra/Compute、企业落地、产业与投资、机器人/硬件等。
- `figure_slots` 只给真正需要图示的地方。`generation_text` 要直接写成给 NotebookLM 生成信息图的中文指令，描述结构、层次、节点关系和重点。
- 最终报告正文会由同一个 Browser Agent + ChatGPT 5.5 Thinking high 根据你的 plan 逐篇生成。

前置语义分组 JSON：
{
  "date": "2026-06-08",
  "lookback_days": 7,
  "grouping_model": "chatgpt-5.5",
  "grouping_summary": "本周素材可分成四条主线：第一，AI Engineer Melbourne 2026 Day 1 keynote，围绕 AI engineering 从模型中心转向 harness、agent、自主编码与工程系统；第二，OCP/TAP 与 OCP Server/Sustainability 系列工作流，围绕 AI 基础设施标准化、MCP/agent 通信扩展、时间同步与水效率指标；第三，NSDI '26 的网络与存储系统研究，聚焦解耦存储、NVMe-oF 流量控制、白盒交换机仿真；第四，若干 OCP TSIAW 工作流素材 transcript 目前开头信息偏会议寒暄，需进一步抽取正文后才能判断是否进入正式报告。整体上，V001、V004、V005、V008具备较高选题价值；V002/V003是强学术材料但与 AI Influence 主线需要通过“AI 基础设施底座”角度转换；V006/V007目前证据不足，暂作弱材料或待验证。",
  "video_groups": [
    {
      "group_id": "ai-engineer-melbourne-2026-keynote-agentic-engineering",
      "group_title": "AI Engineer Melbourne 2026：AI 工程从模型使用转向 harness、agent 与代码生产系统",
      "group_type": "keynote",
      "center_of_gravity": "这组素材真正讨论的是 AI Engineer 角色边界正在扩大：AI 不再只是调用模型，而是围绕模型之外的 harness、服务、数据、产品、品牌、代码生成 agent、自托管 agent 与工程系统重新组织软件生产。",
      "why_grouped_together": "V001 是单独的大会 keynote livestream，语义上属于 AI Engineer Melbourne 2026 的事件型 keynote 素材。它不是普通产品更新，也不是单点教程，而是用多个主题概括 AI engineering 的阶段变化，因此应作为独立事件组处理。",
      "material_video_refs": [
        "V001"
      ],
      "representative_videos": [
        "V001"
      ],
      "candidate_trends": [
        {
          "trend_title": "AI engineering 的重心从 model API 调用迁移到 harness 与工程化系统",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "transcript 明确提到“AI is increasingly not just models”“model is increasingly the harness”，并把服务、数据、品牌、产品纳入 AI 系统范畴。该材料可支撑一个关于 AI 工程边界扩张的趋势判断。"
        },
        {
          "trend_title": "AI 代码生成占比成为真实世界 AI 进展的关键观察点",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "keynote 中提到 AI 写代码占比从 4–5% 到约 10%，并预测年底可能到 40–50%。由于该数字来自演讲口径，报告中必须标注为 speaker claim，并建议后续用 GitHub、企业开发平台或第三方数据验证。"
        },
        {
          "trend_title": "Cloud code agents 与 self-hosting agent 可能改变软件 fork、维护和自动演进方式",
          "trend_type": "weak_signal",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "摘录提到 cloud code agents、self-hosting 与 slot forks，但当前 excerpt 不足以支撑完整机制分析。适合作为后续观察点，而不是直接写成确定性结论。"
        }
      ],
      "reportability": "must_report",
      "quality_notes": "transcript 字符量很大但已截断，摘要缺失。下一步必须完整抽取 keynote 的六个主题、speaker 的论证顺序、具体例子和保留意见。涉及百分比预测时必须标注为演讲者观点，不能当作事实数据直接使用。"
    },
    {
      "group_id": "ocp-ai-infra-agent-protocol-and-resource-standardization",
      "group_title": "OCP AI 基础设施标准化：agent 通信扩展、TAP/UII、时间同步与水效率指标",
      "group_type": "conference",
      "center_of_gravity": "这组素材共同讨论 AI 基础设施进入标准化与治理阶段：agent 协议不只负责调用，还要承载恢复、专用化和系统协同；TAP/UII、TSIAW、Sustainability 工作流则把时间同步、智能基础设施、水效率指标纳入工程标准与工作流讨论。",
      "why_grouped_together": "V004、V005、V006、V007、V008 都来自 Open Compute Project，且是工作流或子项目会议。它们不是同一个短视频系列的关键词聚类，而是同属 OCP 对 AI/智能基础设施标准、协议、资源指标和时间保障问题的持续工作材料。V004、V005、V008证据较清楚；V006/V007标题相关但 excerpt 暂时不足，需要谨慎处理。",
      "material_video_refs": [
        "V004",
        "V005",
        "V006",
        "V007",
        "V008"
      ],
      "representative_videos": [
        "V004",
        "V005",
        "V008"
      ],
      "candidate_trends": [
        {
          "trend_title": "AI 基础设施标准化开始从硬件规格扩展到 agent/protocol/runtime 协同",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V004"
          ],
          "reasoning": "V004 明确讨论 AI HW/SW CoDesign 子项目，并介绍 MCP deep dive，从协议基础到 custom extension，目标包括 communication recovery 和 specialization。该材料可支撑“协议层开始承载运行时恢复与专用化语义”的判断。"
        },
        {
          "trend_title": "TAP/UII 将智能基础设施、AI causality 与时间保障问题纳入统一工作流",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V005",
            "V006",
            "V007"
          ],
          "reasoning": "V005 excerpt 提到 UII、AI causality、1588 face-to-face meeting；V006/V007 属 TSIAW workstream，但当前摘录主要是会前寒暄和介绍，正式内容不足。可作为观察方向，但需要完整 transcript 再确认。"
        },
        {
          "trend_title": "AI 数据中心资源指标从能耗扩展到水效率与分级治理",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V008"
          ],
          "reasoning": "V008 明确是 Sustainability - Water Efficiency Metrics & Grading workstream，讨论 best practices white paper、目标时间和工作推进。可支撑“水效率指标成为 AI 基础设施治理材料”的趋势判断。"
        }
      ],
      "reportability": "must_report",
      "quality_notes": "OCP 会议材料很有价值，但 transcript 多为会议口语和工作流过程，需要做二次抽取：区分正式 presentation、讨论决定、行动项、白皮书内容和闲聊。V006/V007不要直接写结论，除非后续 transcript 能定位 TSIAW 的核心技术内容。"
    },
    {
      "group_id": "nsdi-2026-disaggregated-storage-and-programmable-networking",
      "group_title": "NSDI '26：解耦存储、NVMe-oF 流量控制与白盒交换机仿真",
      "group_type": "research_talk",
      "center_of_gravity": "这组素材共同讨论云基础设施底层解耦后的网络控制问题：存储从本地 SSD 走向 compute/storage pool 分离，白盒交换机从黑盒设备走向可组合、可仿真、可定制的网络基础设施。",
      "why_grouped_together": "V002 与 V003 都来自 USENIX NSDI '26，均为系统/网络研究报告。二者不是 AI 应用内容，但都指向大规模云和 AI 基础设施底层：解耦存储、NVMe-oF、SAN 架构、whitebox switch、SONiC、高保真仿真。适合组成“AI 基础设施底座研究材料组”。",
      "material_video_refs": [
        "V002",
        "V003"
      ],
      "representative_videos": [
        "V002",
        "V003"
      ],
      "candidate_trends": [
        {
          "trend_title": "AI/云基础设施的资源解耦正在把网络控制推到系统设计中心",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V002"
          ],
          "reasoning": "V002 清楚解释 storage disaggregation：compute node 与 storage node 分池，通过 SAN 远程访问 NVMe-oF，并比较 switched 与 switchless 架构。该材料能支撑对资源解耦后网络控制复杂度上升的分析。"
        },
        {
          "trend_title": "白盒交换机生态需要高保真仿真框架来降低定制网络系统风险",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V003"
          ],
          "reasoning": "V003 讨论 whitebox switch 的 vendor mix-and-match、避免锁定、降低硬件成本、定制新功能，以及高保真 emulation 非平凡。可作为可编程网络基础设施成熟化的学术证据。"
        },
        {
          "trend_title": "NSDI 系统研究可作为 AI 数据中心底层约束的间接证据",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V002",
            "V003"
          ],
          "reasoning": "这两条视频未直接讨论 AI workload，因此不能强行写成 AI 趋势。但它们能作为 AI infra 报告中关于存储/网络/交换机底座演进的支撑材料。"
        }
      ],
      "reportability": "maybe_report",
      "quality_notes": "适合做背景或技术底座章节，不适合单独作为 AI Influence 主报告，除非下一步明确把主题定为“AI 数据中心的网络与存储解耦约束”。需完整 transcript 抽取研究问题、方法、实验对象、结论和局限。"
    },
    {
      "group_id": "ocp-tsiaw-weak-transcript-materials",
      "group_title": "OCP TSIAW 工作流：当前摘录证据不足的待验证材料",
      "group_type": "weak_misc",
      "center_of_gravity": "这组材料可能与时间同步、智能基础设施或 TSIAW 标准工作有关，但当前可见 excerpt 主要是会议寒暄、嘉宾介绍和开场准备，尚不足以判断技术核心。",
      "why_grouped_together": "V006、V007 都是 OCP TAP - TSIAW workstream，时间接近、频道一致、工作流名称一致。但由于 excerpt 没有展开核心议题，不应强行并入趋势结论。它们可以先作为弱材料池，等待 transcript 深抽取后再决定是否并入 OCP 标准化组。",
      "material_video_refs": [
        "V006",
        "V007"
      ],
      "representative_videos": [
        "V007"
      ],
      "candidate_trends": [
        {
          "trend_title": "TSIAW 可能与时间同步/时间保障工作流相关",
          "trend_type": "weak_signal",
          "supporting_video_refs": [
            "V006",
            "V007"
          ],
          "reasoning": "标题显示 TSIAW workstream，V007 excerpt 出现 FCSA 1.0、SCS 101、presentation introduction 等线索，但当前文本不足以确定技术主张。"
        },
        {
          "trend_title": "OCP 工作流材料需要正文定位后才能进入报告证据链",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V006",
            "V007"
          ],
          "reasoning": "当前摘录不能区分正式内容和会前交流，报告中最多作为待验证材料，不能用于支撑明确判断。"
        }
      ],
      "reportability": "background_only",
      "quality_notes": "建议下一步对 V006/V007 做 transcript chaptering：跳过前 5–10 分钟寒暄，定位 presentation title、speaker、agenda、decisions、action items，再决定是否升级到 must_report。"
    }
  ],
  "ungrouped_materials": [],
  "planning_guidance": [
    "下一步 report planner 应优先规划三条候选报告线：1）AI Engineer Melbourne 2026 keynote：AI engineering 从模型中心转向 harness/agent/code production；2）OCP AI 基础设施标准化：MCP 扩展、UII/TAP、TSIAW、水效率指标；3）NSDI 系统研究作为 AI infra 底座：disaggregated storage 与 whitebox switch emulation。",
    "V001 必须先做“keynote 原意摘要与观点归纳”章节，按演讲者六个主题还原原始观点、例子、数字口径和保留意见，然后再做趋势分析。不要直接把 keynote 改写成宏观趋势。",
    "OCP 组必须拆清楚材料层级：V004 是 AI HW/SW CoDesign 与 MCP extension；V005 是 TAP/UII 与 AI causality/1588 相关线索；V008 是 Sustainability 水效率指标；V006/V007 需要进一步验证正文后才能进入证据链。",
    "NSDI 组建议作为技术底座或背景章节，不要因为出现 storage/network 就强行并入 OCP；它们属于学术研究材料，证据类型与 OCP 工作流不同。",
    "报告写作时必须避免暴露内部字段，如 transcript_chars、transcript_truncated_for_grouping、summary_missing 等；只使用频道、标题、发布时间和可验证内容。",
    "所有百分比、预测和口径，如 V001 中 AI 写代码比例和年底预测，必须标注为演讲者观点或 keynote claim，不能当作已验证事实。",
    "风格上禁止使用“更硬”；“信号”只能少量使用，优先写成迹象、线索、依据、变化、材料、观察点。",
    "若某视频 transcript 证据不足，必须写成限制或待验证事项，不要补故事。"
  ],
  "_backend": "browser_agent_chatgpt",
  "_model": "chatgpt-5.5",
  "_reasoning_effort": "high",
  "_request_dir": "/Users/lisihao/.solar/harness/state/tech-hotspot-radar/browser-agent-requests/20260603T113521Z-ai-influence-video-grouping-2026-06-08",
  "_latency_ms": 100287,
  "input_token_count": 4291,
  "output_token_count": 1945,
  "cost_estimate_usd": 0.0,
  "catalog_video_count": 8,
  "grouping_material_count": 8,
  "grouping_policy": "ChatGPT groups weekly videos from transcript evidence before report planning; event/keynote/interview/tutorial distinctions must be preserved."
}

视频目录 JSON：
[
  {
    "video_ref": "V001",
    "channel": "AI Engineer",
    "title": "AI Engineer Melbourne 2026 Keynote Livestream | Day 1",
    "published_at": "2026-06-03T02:57:47+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 81511
  },
  {
    "video_ref": "V002",
    "channel": "USENIX",
    "title": "NSDI '26 - Co-Designing Traffic Control with NVMe-oF for Disaggregated Storage: A Comparative Study",
    "published_at": "2026-06-02T23:53:00+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 13390
  },
  {
    "video_ref": "V003",
    "channel": "USENIX",
    "title": "NSDI '26 - A Composable Emulation Framework for Whitebox Switches",
    "published_at": "2026-06-02T23:52:01+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 13373
  },
  {
    "video_ref": "V004",
    "channel": "Open Compute Project",
    "title": "Server - AI HW SW CoDesign - sub-project - (2026-05-15)",
    "published_at": "2026-06-02T18:02:06+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 33270
  },
  {
    "video_ref": "V005",
    "channel": "Open Compute Project",
    "title": "TAP - UII _ Unified Intelligent Infrastructure - workstream - (2026-05-29)",
    "published_at": "2026-06-02T08:00:58+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 41827
  },
  {
    "video_ref": "V006",
    "channel": "Open Compute Project",
    "title": "TAP - TSIAW - workstream - (2026-05-29)",
    "published_at": "2026-06-02T07:56:55+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 88814
  },
  {
    "video_ref": "V007",
    "channel": "Open Compute Project",
    "title": "TAP - TSIAW - workstream - (2026-06-01)",
    "published_at": "2026-06-02T07:51:15+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 52311
  },
  {
    "video_ref": "V008",
    "channel": "Open Compute Project",
    "title": "Sustainability - Water Efficiency Metrics & Grading - workstream - (2026-05-27)",
    "published_at": "2026-06-02T07:45:06+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 23376
  }
]
