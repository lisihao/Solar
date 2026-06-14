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
  "date": "2026-06-01",
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
  "date": "2026-06-01",
  "lookback_days": 7,
  "grouping_model": "chatgpt-5.5",
  "grouping_summary": "本批材料主要分为四类：①AI Engineer Melbourne 2026大会相关内容（V001），属于AI工程与Agent产业化方向；②NSDI 2026学术研究论文（V002、V003），属于数据中心网络与基础设施研究；③OCP TAP/TSIAW/AI HW-SW CoDesign系列工作组（V004、V005、V006、V007），属于开放基础设施、Agent协议、时间同步与智能基础设施标准化讨论；④OCP Sustainability工作组（V008），属于数据中心可持续性与资源度量体系。当前最具报告价值的是OCP智能基础设施标准化方向与AI Engineer大会对Agent工程化趋势的观察。NSDI论文更适合作为技术观察而非本周核心趋势。",
  "video_groups": [
    {
      "group_id": "ai-engineer-melbourne-2026-agent-engineering",
      "group_title": "AI Engineer Melbourne 2026：AI工程化从模型转向运行时、服务与Agent系统",
      "group_type": "conference",
      "center_of_gravity": "AI价值中心正在从模型能力本身转向围绕模型构建的运行时、Agent、数据、服务与产品体系，AI工程正在成为独立学科。",
      "why_grouped_together": "该材料来自大会Keynote，不是单一产品发布，也不是教程，而是面向整个AI工程社区的趋势总结与议程设定。内容围绕Agent、自主开发、代码生成、Harness、服务化体系展开。",
      "material_video_refs": [
        "V001"
      ],
      "representative_videos": [
        "V001"
      ],
      "candidate_trends": [
        {
          "trend_title": "AI工程正在从模型工程转向Agent运行时工程",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "演讲明确提出AI不再只是模型，价值逐渐集中于Harness、服务、数据、品牌和产品层。"
        },
        {
          "trend_title": "AI生成代码占比快速上升正在改变软件开发生产模式",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "演讲引用代码生成占比持续增长的数据，并将其作为现实世界采用度的重要衡量指标。"
        },
        {
          "trend_title": "Agent自举开发与大规模并行Fork可能成为新开发范式",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V001"
          ],
          "reasoning": "演讲提到Agent自托管和并行Fork能力，但材料尚不足以证明行业已经形成稳定实践。"
        }
      ],
      "reportability": "must_report",
      "quality_notes": "Keynote材料，趋势浓度高；但transcript为截断版本，后续报告需要补全完整内容验证具体论据。"
    },
    {
      "group_id": "nsdi-2026-disaggregated-infrastructure",
      "group_title": "NSDI 2026：下一代可组合数据中心基础设施",
      "group_type": "research_talk",
      "center_of_gravity": "计算、存储与网络资源持续解耦，可组合基础设施正在推动数据中心架构演进。",
      "why_grouped_together": "两篇论文都属于NSDI 2026研究论文，关注数据中心基础设施演进，一个聚焦NVMe-oF存储解耦，一个聚焦Whitebox交换机仿真验证，两者共同指向资源池化和开放网络架构。",
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
          "trend_title": "存储与计算解耦持续深化",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V002"
          ],
          "reasoning": "论文研究Disaggregated Storage与NVMe-oF流量控制协同优化。"
        },
        {
          "trend_title": "开放网络设备生态加速成熟",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V003"
          ],
          "reasoning": "Whitebox交换机、SONiC生态与多供应商架构成为研究重点。"
        },
        {
          "trend_title": "基础设施仿真与验证平台成为关键工具链",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V003"
          ],
          "reasoning": "高保真仿真框架反映系统复杂度持续提升，但尚不足以上升为产业级趋势。"
        }
      ],
      "reportability": "background_only",
      "quality_notes": "属于高质量学术研究，但与本周AI产业主线关联较弱，更适合作为基础设施观察材料。"
    },
    {
      "group_id": "ocp-ai-infra-standardization-and-agent-protocols",
      "group_title": "OCP智能基础设施标准化：Agent协议、时间同步与统一智能基础设施",
      "group_type": "conference",
      "center_of_gravity": "开放基础设施社区正在尝试把Agent协议、时间同步、AI系统协同与智能基础设施管理纳入统一标准框架。",
      "why_grouped_together": "这些视频均来自OCP体系内部工作组，参与者高度重叠，讨论焦点不是单一产品，而是未来AI基础设施治理、Agent互操作协议、统一管理框架和时间同步机制。",
      "material_video_refs": [
        "V004",
        "V005",
        "V006",
        "V007"
      ],
      "representative_videos": [
        "V004",
        "V005"
      ],
      "candidate_trends": [
        {
          "trend_title": "Agent协议开始进入基础设施标准化阶段",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V004"
          ],
          "reasoning": "讨论MCP扩展、通信恢复、Agent专业化能力描述等协议层议题。"
        },
        {
          "trend_title": "统一智能基础设施（UII）成为开放计算社区新议题",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V005"
          ],
          "reasoning": "工作组围绕Unified Intelligent Infrastructure展开持续讨论，但距离成熟标准仍有距离。"
        },
        {
          "trend_title": "时间同步与AI系统可信协同逐渐成为关键约束",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V005",
            "V006",
            "V007"
          ],
          "reasoning": "材料中出现1588、TSIAW、跨系统协调等主题，反映AI基础设施开始关注时间一致性问题。"
        },
        {
          "trend_title": "AI硬件与软件协同设计进入开放社区路线图",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V004"
          ],
          "reasoning": "工作组围绕AI HW-SW CoDesign与白皮书推进展开实质性讨论。"
        }
      ],
      "reportability": "must_report",
      "quality_notes": "属于连续工作组材料，价值在于长期路线和标准化方向；需要后续报告中区分已经形成共识的内容与仍处讨论阶段的内容。"
    },
    {
      "group_id": "ocp-sustainability-water-efficiency",
      "group_title": "OCP Sustainability：数据中心水资源效率与评级体系",
      "group_type": "conference",
      "center_of_gravity": "AI基础设施扩张背景下，数据中心资源效率度量开始从能耗扩展到水资源管理与评级体系。",
      "why_grouped_together": "该材料来自OCP Sustainability工作组，核心任务是推进水资源效率最佳实践和评价框架。",
      "material_video_refs": [
        "V008"
      ],
      "representative_videos": [
        "V008"
      ],
      "candidate_trends": [
        {
          "trend_title": "数据中心水效率指标体系正在标准化",
          "trend_type": "real_trend",
          "supporting_video_refs": [
            "V008"
          ],
          "reasoning": "工作组围绕最佳实践白皮书和评价框架推进讨论。"
        },
        {
          "trend_title": "AI基础设施资源披露要求持续扩大",
          "trend_type": "watchlist",
          "supporting_video_refs": [
            "V008"
          ],
          "reasoning": "目前材料主要体现工作组方向，尚未看到大规模产业落地证据。"
        }
      ],
      "reportability": "maybe_report",
      "quality_notes": "与此前OCP热管理、热复用材料可形成完整可持续性专题；单独成文证据略弱。"
    }
  ],
  "ungrouped_materials": [],
  "planning_guidance": [
    "优先规划《OCP智能基础设施标准化与资源度量观察》专题，将V004-V008作为同一观察窗口下的多个章节。",
    "AI Engineer Melbourne 2026 Keynote应单独形成《AI工程从模型时代走向运行时时代》专题，不要与OCP材料混合。",
    "NSDI论文不要强行拔高为产业趋势，应作为基础设施研究观察或附录材料。",
    "OCP工作组属于会议记录性质材料，报告必须先还原讨论内容、参与者关注点和未解决问题，再进行趋势分析。",
    "对于V004中的MCP扩展讨论，应单独建立Agent协议标准化观察章节。",
    "对于V005-V007中的UII、TSIAW、1588相关内容，应建立时间同步与可信协同观察章节，并明确哪些内容已经形成提案、哪些仍是讨论阶段。",
    "对于V008，应与此前热管理、CDU、热复用材料合并分析，形成完整的数据中心可持续性专题，而非孤立报道。"
  ],
  "_backend": "browser_agent_chatgpt",
  "_model": "chatgpt-5.5",
  "_reasoning_effort": "high",
  "_request_dir": "/Users/lisihao/.solar/harness/state/tech-hotspot-radar/browser-agent-requests/20260603T113015Z-ai-influence-video-grouping-2026-06-01",
  "_latency_ms": 92735,
  "input_token_count": 4291,
  "output_token_count": 1299,
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
