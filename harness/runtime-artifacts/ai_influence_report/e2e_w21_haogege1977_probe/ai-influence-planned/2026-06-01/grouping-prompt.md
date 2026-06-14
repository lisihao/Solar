你是 AI Influence 的 YouTube 素材总编和研究策展人。

你现在使用 Browser Agent 算子打开 ChatGPT，模型必须是 chatgpt-5.5，Thinking high。

任务：基于一周 YouTube 视频的标题、频道、时间、摘要和 transcript，先做“语义分组”，不要写最终报告，也不要只按关键词或发布时间聚类。

你必须识别：
1. 是否属于同一个重要展会 / keynote / 产品发布 / 开发者大会 / 研究会议。
2. 是否是大咖访谈、播客、圆桌、个人观点类内容。
3. 是否是教程 / demo / workshop / 产品功能更新。
4. 是否是公司官方发布、学术研究、开源社区、投资/产业判断、硬件/机器人等不同材料类型。
5. 哪些视频应该被 group 在一起共同支撑一个趋势，哪些只能作为弱证据或排除。

输出必须是严格 JSON object，禁止 Markdown 代码块，schema 如下：
{
  "date": "2026-06-01",
  "lookback_days": 7,
  "grouping_model": "chatgpt-5.5",
  "grouping_summary": "string",
  "video_groups": [
    {
      "group_id": "lowercase-slug",
      "group_title": "string",
      "group_type": "event|keynote|conference|big_name_interview|podcast_panel|tutorial_demo|product_update|research_talk|open_source|industry_investment|hardware_robotics|weak_misc",
      "center_of_gravity": "这组素材真正共同讨论的问题，不是关键词列表",
      "why_grouped_together": "为什么这些视频应该放在一起",
      "material_video_refs": ["V001"],
      "representative_videos": ["V001"],
      "candidate_trends": [
        {
          "trend_title": "string",
          "trend_type": "real_trend|weak_signal|watchlist|hype|noise",
          "supporting_video_refs": ["V001"],
          "reasoning": "string"
        }
      ],
      "reportability": "must_report|maybe_report|background_only|exclude",
      "quality_notes": "string"
    }
  ],
  "ungrouped_materials": [
    {"video_ref": "V999", "reason": "string"}
  ],
  "planning_guidance": [
    "给下一步 report planner 的具体建议"
  ]
}

分组原则：
- 不允许只因为 title 里都有 agent / Gemini / AI 就放在一起。
- 同一展会/发布会/keynote/系列活动优先作为事件组。
- 大咖访谈/播客要按人物观点和讨论问题分组，不要和产品公告混在一起。
- workshop/tutorial/demo 可以成为“工程落地材料组”，但不要强行上升为趋势。
- 每个 group 必须说明为什么这些视频在语义上同组。
- 如果 transcript 证据不够，放入 weak_misc 或 ungrouped_materials，不要硬凑。

视频 transcript 材料 JSON：
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
    "transcript_chars": 81511,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "that\\nthat I should I'm really good at sort of\\nsummarizing themes and so I prepared six\\nthemes that I wanted to set your pallet\\nwith I guess for the rest of this\\nconference.\\nThe first thing I wanted to talk about\\nis how AI is increasingly not just\\nmodels. Um here's two sideby-side shots\\nof open AI saying into um a model is\\nincreasingly the harness right AI21 is\\npivoting to\\nis as well\\nand also uh AI is also about services\\nand data and brand and product right so\\nI think this all these trends are really\\ngood for AI engineers because it is\\neverything outside the model but the\\nsecond trend also shows that the models\\nare and I think the realist world\\nbenchmark is probably the amount of code\\nthat's written by AI. Uh this is a\\nscreenshot of cloud code commits in\\nGitHub over time. Uh as of February, it\\nwas about 4 to 5% of all code. Right\\nnow, it's probably sitting at around 10%\\nand towards the end of the year, it's\\ngoing to be around 40 to 50%. Everyone\\nis sufficiently appreciating that is\\ncurrently changing the entire world.\\nCloud code agents are I mean agents are\\nalso just self-hosting and enabling slot\\nforks which are really interesting. And\\nalso of cours"
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
    "transcript_chars": 13390,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Um good afternoon my name is Jun O from\\nthe University of West medicine. Today\\nI'm going to present our work\\nco-designing traffic control with MVM of\\nfabric for disorientated storage and\\nthis is a comparative study of a\\nswitched architecture and switchless\\narchitecture of a storage area network.\\nLet me start my presentation.\\nStorage disagregation is getting\\nimportant to manage the largest scale\\nstorage system. Storage disagregation is\\na technique decoupling a storage node\\nfrom a comput node. Uh left side is a\\ntraditional storage system. Traditional\\nstorage system tightly couple comput\\nresource and storage resource in the\\nsame server. Each server has its own\\nlocal SSDs. And if you need more storage\\ncapacity, you need to provision more\\nwhole servers even if you don't need\\nmore computer resources. Storage\\ndisagregation break this coupling.\\nCompute nodes and storage nodes are in\\nseparated pools connected by a storage\\narea network. Compute nodes access\\nstorage remotely typically using MBM\\nover protocols on top of TCP or IDMA.\\nIn disagregated storage systems uh\\nstorage nodes themselves are evol are\\nevolving rapidly. There are two trends\\nin the evolution. Th"
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
    "transcript_chars": 13373,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Okay. Hello everyone. My name is Leang.\\nSo I come from National University of\\nSingapore. So it's my honor to present\\nthe work uh mer switch the uh uh\\ncompatible uh compatible emulation\\nframework for the white box switches.\\nOkay. Because all the authors in this\\npaper could not come attend here because\\nthe visa issues. Okay. So this is a\\nproject uh this project is a massive\\ncollaborative efforts between the\\nengineers at Tencent and the researchers\\nfrom Tesenu University, Shan University,\\nPiking University, HQST and University\\nof Michigan.\\nSo in the past switches were blackbox\\nand one window give you everything. So\\nbut today the cloud providers deploy uh\\nmore white box switches in a mixing and\\na matching minor that is they want one\\nvendor's switching chip another vendor's\\nuh uh peripheral modules and run on\\ntheir own OS usually it's sonic so\\nsorry\\nso the motivations is three-fold okay to\\navoid the window lock in and\\nsignificantly reduce the hardware cost\\nand most importantly okay to customize\\nthe new features to meet the specific\\napplication demands.\\nSo while the white box switches often\\noffer the flexibility their high\\nfidelity emulation is non trivial"
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
    "transcript_chars": 33270,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Hello.\\nReady?\\n>> Hey, Masu.\\n>> Hi.\\n>> Hello. I I don't know if I pronounce\\nyour name right.\\n>> Yes. Yes, it's correct. Yes. Yes.\\n>> Okay. Great. Thank you for joining us.\\nUm, it's really uh\\nhappy to have you join the team.\\n>> You're welcome.\\n>> Lot of people\\nin the waiting room. I'll just admit\\nthem in first.\\n>> Yeah, sure.\\nOkay. Uh, welcome everyone to the\\nmeeting and first of all I'd like to\\nintroduce Mass.\\nuh we want to welcome him to join the\\ngroup\\nand in the past week and Masud did a lot\\nof revision and comments\\nto the white paper. So um if you look at\\nthe web paper we have some\\nrecommendations about how to extend\\nexisting agent um pro communication\\nprotocol\\nso that we can augment that protocol to\\nincluding information for like uh\\ncommunication recovery and also the\\nspecialization. So that's why we invite\\nMasud to give us a presentation.\\nThis presentation is on MCP deep dive\\nfrom protocol basics basics to custom\\nextension.\\nThank you Masu. So you can start your\\npresentation.\\n>> Yeah sure. Thank you. I think I can\\nshare my screen.\\n>> Yes. Let me stop sharing.\\n>> Yeah sure.\\nUm share\\nthis one.\\n>> You see my screen?\\n>> Yes.\\n>> Right.\\n>>"
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
    "transcript_chars": 41827,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "How's everybody doing?\\n>> Hi. Doing well. What about you?\\n>> Tired, but good. Just finished the uh\\nthe spring semester. Oh,\\n>> I'm trying to organize a fintech expo in\\ndowntown Chicago for next week with a\\nbunch of the student uh projects\\nsite, but it's fun.\\n>> Oh, yes.\\n>> At least it's gorgeous out. So,\\n>> yeah, this time of the year is always\\nnice.\\n>> Yep.\\nYeah. I think the dream job is to to\\nsomeday have a position where I spend\\nsix months in the northern hemisphere\\nand then go to Australia when it gets\\nbad here.\\nI wonder what's going to happen when all\\nmeetings devolve to just everybody sends\\na noteaker and then no one actually\\nshows up. We need to get the notetakers\\nto be able to uh at least simulate the\\npeople they're taking notes for.\\n>> Yeah,\\nis always on time. So, I wonder if he's\\nnot Oh, he's I think he just\\nHey. Hey, David. Hey, Sana. Hey, Greg.\\n>> Hi, Anchor. How are you?\\n>> Good. How are you?\\n>> I'm good.\\njust preparing for another trip. We have\\na 1588 face toface meeting next week.\\n>> Oh, okay. Nice.\\nYeah, I think this one um u particularly\\nfor this AI causality. It's been a while\\nwe have done this meeting. I think\\nbecause we were "
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
    "transcript_chars": 88814,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Oh, I just made it. Hey, everyone.\\n>> Hi. Hi. Oh, we got the\\ngreat people here. Fantastic. How are\\nyou? Uh, Jason, how are you, Garrett?\\n>> Doing good. Doing good. How's everyone?\\nI am I'm very happy to have all of you.\\nI feel I am blessed. And we got a Steve\\nFarber also. That's excellent.\\n>> Yeah, I'm here.\\n>> How are you, Steve? You are the man. I\\nwill\\n>> I'm okay. I'm very hot. The UK is just\\ngoing through.\\n>> Oh, yes. Yes.\\n>> My my my brother lives in Manchester.\\n>> Yeah, it's been unusually hot. And of\\ncourse in UK we don't have air\\nconditioning. So,\\n>> wow.\\n>> Everybody melts.\\n>> Every every time we'd see um some news\\nabout a heat wave in the UK and they'd\\nsay it's 30° Celsius, the Australians\\nwould start laughing at you. But then we\\ndidn't appreciate that you don't have\\nair conditioning invented yet. So,\\n>> yeah. In the UK, we think 20 is hot.\\nYeah. Anything above 20 is is becoming\\nunlivable.\\n>> Yeah.\\n>> We got we got bread, too. That's\\nexcellent. Wow. We got all everybody\\n>> and Rajit. Yes.\\n>> Hi Rajit. How are you?\\n>> How's it going?\\n>> Nice to see everyone again.\\n>> Yeah, I am really blessed to have uh to\\nhave you here all of you.\\nSo "
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
    "transcript_chars": 52311,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "between the FCSA 1.0 on the SCS 101.\\nHello, Professor Yeshel.\\n>> Hi. How are you?\\n>> How are you?\\n>> I'm good. I'm good. Thank you. Thank\\nyou.\\nSo, I guess it's morning time.\\n>> Yeah. Where are you? You are in England,\\nright? UK.\\n>> I am in the UK. Yes. uh in\\n>> so it is uh what time is\\n>> literally\\nyeah central uh UK\\nwhich is called Midlands\\n>> so you are at this is 5:00 uh\\n>> this is yes 2 minutes to 5 yes\\n>> yeah exactly\\n>> so\\n>> I'm very happy that you accepted to give\\nthis presentation this is great\\n>> yeah I'm very happy\\nuh that you invited and happy to be\\nYeah,\\n>> thank you very much. And uh usually we\\nstart at 9:05 give 5 minutes for people.\\n>> Yeah, that's fine. Yes, I can\\nunderstand. I just wanted to come in\\ntime so that uh no that's excellent\\ncertainty that everything is working\\nokay.\\n>> That's excellent. And uh at 9:05\\nuh I will announce uh the presentation\\nand you can start by giving brief\\nintroduction about yourself\\n>> and uh\\nuh and and and and what you are going to\\ntalk about although I already provided\\nyour bio and uh\\n>> and the and the abstract and title of\\nthe presentation but just briefly\\nintroduce all of this and then you c"
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
    "transcript_chars": 23376,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Oh, hey afternoon. Sorry I ran a little\\nlate on last meeting.\\nHi Michael. Hi.\\n>> Hey.\\nNot know if we've met before. Um is this\\nHave you been on these calls before?\\n>> Uh yeah. Um\\nI think I just joined in the first first\\ncall and after that there's been meeting\\nconflicts so wasn't able to join today I\\nthink time so yeah working in uh micron\\non uh firmware security so I mean\\nsustainability is certainly huge here\\nalso\\njust out of interest\\n>> to see if they can contribute to\\nsomething\\n>> just for everybody's sake I'm going to\\npost\\nthe best practices\\num white paper that everybody's kind of\\nbeen working through.\\n>> Nice.\\n>> Like I said, we've kind of been um we're\\ntrying to catch back up because yeah,\\nthere was the whole um Zoom issues there\\nfor a few weeks. So, we're slowly trying\\nto get\\nbought back up.\\nBut I think that's kind of been the main\\ngoal right now. Um, we had been\\ntargeting May, but like I said with the\\ndelays, um, the other\\npeople kind of running the group, Derek\\nfrom Verdive and Rashad from Oracle, I\\ndon't see them quite on the call yet,\\nbut essentially kind of the focus we've\\nbeen having and I think the goal is to\\nget it done this summ"
  }
]
