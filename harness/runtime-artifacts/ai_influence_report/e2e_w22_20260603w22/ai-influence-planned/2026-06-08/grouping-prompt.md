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
  "date": "2026-06-08",
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
    "channel": "硅谷101",
    "title": "对话高通：智能体爆发、6G与Physical AI背后的大赢家",
    "published_at": "2026-06-03T23:00:23+00:00",
    "duration_min": null,
    "language": "zh",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 12970,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "AI周期\\n前沿大模型们在表面上厮杀\\n而在水下 有一个隐形的大赢家\\n过去一年 高通股价大涨60%\\n并在五月底创下历史新高\\n随着“Physical AI”的概念在今年走进主流\\nAI边缘设备\\n包括AI手机、AIPC、XR、汽车以及机器人等市场的火热\\n推动芯片市场需求\\n再加上6G技术的期待\\n使得高通这样布局多年通信和芯片的技术巨头\\n旗下的骁龙产品和平台被寄以希望\\n成为接下来“边缘AI”生态的核心玩家\\n这期视频\\n我们来到高通在北京举办的“骁友会五周年派对”\\n现场对话了高通公司全球副总裁徐晧\\n我们要让人工智能触及到千家万户\\nAI去到终端设备\\n你觉得现在难点在哪里\\n多大的模型可以放在手机上\\n我们又做通信\\n又做AI\\n又做机器人\\n所以我们可以把这三者结合起来\\n打造一个最好的一个解决方案\\nAIPC这个东西是不是伪命题啊\\n其实PC上面有很多的AI是可以应用的\\n一个最强的AI的商业化的一个用例\\n就是做coding（编程）\\nAI进了车\\n但实际上这里面有非常多的技术支持\\n是从我们的工程团队\\n从我们的研发团队 要考虑的事情\\n但从用户的角度来说\\n我们希望这个对用户是完全无感\\n其实眼镜相对来说在某些方面是最难的一个端侧的AI\\n同时 我们也与徐博士一起在现场逛了逛展\\n体验了数款当下讨论热度非常高的端侧产品\\n来看看AI是如何在底层赋能Physical AI的进化\\n那接下来 就跟随我 走进高通 骁龙的AI布局\\n我在硅谷看到今年AI其实是有两条线\\n可以说一条是明线 一条是暗线\\n明线就是当大家还是在卷\\n最好的 最SOTA（顶尖）的大模型\\n但是暗线 我发现\\n大家是在慢慢地看端侧模型\\n是不是能够有一个更好的应用了\\n在你的观察来看\\n你觉得今年到了\\n我们应该去看AI+硬件的这个时候了吗\\n最早的人工智能的发展\\n肯定是以云端为主\\n因为大家都想知道\\n人工智能它的能力边界到底在哪\\n但是在我们现在人工智能发展到\\n现在的阶段的时候\\n我们会意识到\\n有更多的应用\\n它实际上需要有终端的支持\\n我们最先看到的是手机\\n智能手机上人工智能的应用\\n除此之外 我们还有XR的眼镜\\n有车的自动驾驶\\n然后有车内的娱乐系统\\n还有机器人\\n我们现在看到非常多的机器人的应用\\n这些都是把云端的算力\\n和云端可能做的事情慢慢落地到端侧\\n所以这是个非常大的\\n可能有百亿、千亿的\\n这样一个体量的人工智能的应用\\n所以我们是非常积极地推动\\n人工智能在端侧的落地的\\n要让AI去到终端设备\\n你觉得现在难点在哪里\\n它是模型做不到还是算力上面的挑战\\n比较明显的几个挑战\\n第一个是手机上的算力\\n多大的模型可以放在手机上\\n比如说我们做过一个研究\\n在2024年 最好的Llama出来的一个模型\\n小于一年的时间内\\n100多个bi"
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
    "transcript_chars": 12994,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Thank you.\\nGood morning everybody.\\nYou know, we really are living\\nin the most remarkable times.\\nsince I started working in AI,\\nThe compute that we use to train frontier models\\nhas increased by 1 trillion fold.\\nThat's 12 orders of magnitude\\nof computation in just 15 years.\\nIt's now clear that\\na consistent exponential increase in computation\\nleads to predictable advances in AI capabilities.\\nAnd in the next few years,\\nwe're going to see three more orders\\nof magnitude of compute\\napplied to train frontier models.\\nIntelligence is now a function of compute.\\nLog linear hillclimbing has become the norm.\\nThe scaling laws are clearly holding,\\nand it is a remarkable time in our industry.\\nAnd so in this context,\\nwe at MAI are building towards\\nwhat we call Humanist Superintelligence.\\nState of the art\\nAI capabilities that are explicitly designed\\nto serve people and organizations\\nand not replace them, because the type of\\nAI that we create really does matter.\\nWe need an AI that places humanity first,\\nthat always prioritizes human\\nwell-being and human progress.\\nThis is the core philosophy and motivation\\nbehind our superintelligence\\nefforts at Microsoft,\\nand it shape"
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
    "transcript_chars": 34174,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "One of the most provocative and\\ninteresting investors in the country,\\n>> a legendary activist investor,\\n>> Persing Square CEO and founder, Bill\\nAman.\\n>> Taking a short position and going public\\nwith it is a pretty serious business.\\nInterestingly, some of the best\\nbusinesses in the world are trading at\\nthe lowest multiples.\\n>> We're kind of the rebirth of the closed\\nend investment company universe.\\n>> What did you think of Zara, the CEO of\\nOpenAI? I'm sorry, CFO. Felt like the\\nCEO. Yeah, I I was\\n>> stop with that stuff.\\n>> Uh, actually I was super impressed. Uh,\\nmade me a lot more bullish on Open AI\\nand I thought\\n>> right\\n>> I thought she should be CEO of OpenAI.\\n>> That's what I thought.\\n>> I think Sam should be I think Sam should\\nbe chair. I think he's much better.\\n>> There was a question I wanted to ask her\\nthat we didn't get time which was what's\\nit like working with Sam?\\n>> I mean that could have been like three\\nhours in a documentary.\\n>> I wanted to kick this off. So thank you\\nso much for being here. We've tried a\\nnumber of times to get you to all in and\\nit's great to to finally have you. You\\nobviously are a legend that doesn't need\\nmuch of an"
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
    "transcript_chars": 81511,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "that\\nthat I should I'm really good at sort of\\nsummarizing themes and so I prepared six\\nthemes that I wanted to set your pallet\\nwith I guess for the rest of this\\nconference.\\nThe first thing I wanted to talk about\\nis how AI is increasingly not just\\nmodels. Um here's two sideby-side shots\\nof open AI saying into um a model is\\nincreasingly the harness right AI21 is\\npivoting to\\nis as well\\nand also uh AI is also about services\\nand data and brand and product right so\\nI think this all these trends are really\\ngood for AI engineers because it is\\neverything outside the model but the\\nsecond trend also shows that the models\\nare and I think the realist world\\nbenchmark is probably the amount of code\\nthat's written by AI. Uh this is a\\nscreenshot of cloud code commits in\\nGitHub over time. Uh as of February, it\\nwas about 4 to 5% of all code. Right\\nnow, it's probably sitting at around 10%\\nand towards the end of the year, it's\\ngoing to be around 40 to 50%. Everyone\\nis sufficiently appreciating that is\\ncurrently changing the entire world.\\nCloud code agents are I mean agents are\\nalso just self-hosting and enabling slot\\nforks which are really interesting. And\\nalso of cours"
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
    "transcript_chars": 13390,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Um good afternoon my name is Jun O from\\nthe University of West medicine. Today\\nI'm going to present our work\\nco-designing traffic control with MVM of\\nfabric for disorientated storage and\\nthis is a comparative study of a\\nswitched architecture and switchless\\narchitecture of a storage area network.\\nLet me start my presentation.\\nStorage disagregation is getting\\nimportant to manage the largest scale\\nstorage system. Storage disagregation is\\na technique decoupling a storage node\\nfrom a comput node. Uh left side is a\\ntraditional storage system. Traditional\\nstorage system tightly couple comput\\nresource and storage resource in the\\nsame server. Each server has its own\\nlocal SSDs. And if you need more storage\\ncapacity, you need to provision more\\nwhole servers even if you don't need\\nmore computer resources. Storage\\ndisagregation break this coupling.\\nCompute nodes and storage nodes are in\\nseparated pools connected by a storage\\narea network. Compute nodes access\\nstorage remotely typically using MBM\\nover protocols on top of TCP or IDMA.\\nIn disagregated storage systems uh\\nstorage nodes themselves are evol are\\nevolving rapidly. There are two trends\\nin the evolution. Th"
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
    "transcript_chars": 13373,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Okay. Hello everyone. My name is Leang.\\nSo I come from National University of\\nSingapore. So it's my honor to present\\nthe work uh mer switch the uh uh\\ncompatible uh compatible emulation\\nframework for the white box switches.\\nOkay. Because all the authors in this\\npaper could not come attend here because\\nthe visa issues. Okay. So this is a\\nproject uh this project is a massive\\ncollaborative efforts between the\\nengineers at Tencent and the researchers\\nfrom Tesenu University, Shan University,\\nPiking University, HQST and University\\nof Michigan.\\nSo in the past switches were blackbox\\nand one window give you everything. So\\nbut today the cloud providers deploy uh\\nmore white box switches in a mixing and\\na matching minor that is they want one\\nvendor's switching chip another vendor's\\nuh uh peripheral modules and run on\\ntheir own OS usually it's sonic so\\nsorry\\nso the motivations is three-fold okay to\\navoid the window lock in and\\nsignificantly reduce the hardware cost\\nand most importantly okay to customize\\nthe new features to meet the specific\\napplication demands.\\nSo while the white box switches often\\noffer the flexibility their high\\nfidelity emulation is non trivial"
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
    "transcript_chars": 33270,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Hello.\\nReady?\\n>> Hey, Masu.\\n>> Hi.\\n>> Hello. I I don't know if I pronounce\\nyour name right.\\n>> Yes. Yes, it's correct. Yes. Yes.\\n>> Okay. Great. Thank you for joining us.\\nUm, it's really uh\\nhappy to have you join the team.\\n>> You're welcome.\\n>> Lot of people\\nin the waiting room. I'll just admit\\nthem in first.\\n>> Yeah, sure.\\nOkay. Uh, welcome everyone to the\\nmeeting and first of all I'd like to\\nintroduce Mass.\\nuh we want to welcome him to join the\\ngroup\\nand in the past week and Masud did a lot\\nof revision and comments\\nto the white paper. So um if you look at\\nthe web paper we have some\\nrecommendations about how to extend\\nexisting agent um pro communication\\nprotocol\\nso that we can augment that protocol to\\nincluding information for like uh\\ncommunication recovery and also the\\nspecialization. So that's why we invite\\nMasud to give us a presentation.\\nThis presentation is on MCP deep dive\\nfrom protocol basics basics to custom\\nextension.\\nThank you Masu. So you can start your\\npresentation.\\n>> Yeah sure. Thank you. I think I can\\nshare my screen.\\n>> Yes. Let me stop sharing.\\n>> Yeah sure.\\nUm share\\nthis one.\\n>> You see my screen?\\n>> Yes.\\n>> Right.\\n>>"
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
    "transcript_chars": 20330,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "My name is Kobe Crawford. I'm a\\ndeveloper advocate at\\nSnorkel.\\nWe are the frontier AI data lab. And\\nwhat that means is that we produce data\\nsets for foundation models to help climb\\non. So our research team is\\nhighly integrated with the work that we\\ndo in terms of our production work. And\\nwe put a lot of emphasis on how we\\nintegrate research in that. This\\ncompany's origins actually begin from a\\nStanford University AI research lab and\\nthe\\nwork that they were doing there actually\\nwas part of one of the the CEO's CC\\nPhD thesis and then that became a\\nlibrary that was used open source for a\\nwhile and then we've grown into\\nfocusing on delivering things uh\\nuh with data sets for our customers.\\nUh one of the things that's been a\\nconsistent through line for Snorkel\\nsince we the since they got started in\\nas a company in 2019 is that the the\\ncore thesis has been that the quality of\\ndata is critical and that you the data\\nthat you're looking at you want to make\\nsure is is top quality and in all those\\ncases. So we look at how that applies to\\nthe data sets that we provide as well as\\nas things move into the agentic space\\nuh how that applies to agentic tasks.\\nAnd what"
  }
]
