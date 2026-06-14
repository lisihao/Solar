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
  "status": "pending_grouping"
}

视频目录 JSON：
[
  {
    "video_ref": "V001",
    "channel": "硅谷101",
    "title": "对话高通：智能体爆发、6G与Physical AI背后的大赢家",
    "published_at": "2026-06-03T23:00:23+00:00",
    "duration_min": null,
    "language": "zh",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 12970
  },
  {
    "video_ref": "V002",
    "channel": "Microsoft Research",
    "title": "Microsoft AI CEO unveils 7 new AI models | Mustafa Suleyman at Microsoft Build 2026",
    "published_at": "2026-06-03T16:30:56+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 12994
  },
  {
    "video_ref": "V003",
    "channel": "All-In Podcast",
    "title": "Bill Ackman: Investment Strategy, What the Market is Missing, How AI Breaks Businesses",
    "published_at": "2026-06-03T12:08:28+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 34174
  },
  {
    "video_ref": "V004",
    "channel": "AI Engineer",
    "title": "AI Engineer Melbourne 2026 Keynote Livestream | Day 1",
    "published_at": "2026-06-03T02:57:47+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 81511
  },
  {
    "video_ref": "V005",
    "channel": "USENIX",
    "title": "NSDI '26 - Co-Designing Traffic Control with NVMe-oF for Disaggregated Storage: A Comparative Study",
    "published_at": "2026-06-02T23:53:00+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 13390
  },
  {
    "video_ref": "V006",
    "channel": "USENIX",
    "title": "NSDI '26 - A Composable Emulation Framework for Whitebox Switches",
    "published_at": "2026-06-02T23:52:01+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 13373
  },
  {
    "video_ref": "V007",
    "channel": "Open Compute Project",
    "title": "Server - AI HW SW CoDesign - sub-project - (2026-05-15)",
    "published_at": "2026-06-02T18:02:06+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 33270
  },
  {
    "video_ref": "V008",
    "channel": "AI Engineer",
    "title": "Task Fidelity Scaling Laws — Kobie Crawdord, Snorkel",
    "published_at": "2026-06-02T17:00:39+00:00",
    "duration_min": null,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 20330
  }
]
