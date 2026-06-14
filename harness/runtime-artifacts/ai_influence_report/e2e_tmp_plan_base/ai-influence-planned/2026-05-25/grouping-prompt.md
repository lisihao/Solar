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
  "date": "2026-05-25",
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
    "video_ref": "V002",
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
    "video_ref": "V003",
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
    "video_ref": "V004",
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
  },
  {
    "video_ref": "V005",
    "channel": "USENIX",
    "title": "NSDI '26 - KRAKENGUARD: Towards Fine-Grained eBPF Isolation",
    "published_at": "2026-06-01T22:41:44+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 14860,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Hello everyone, I am Janel Patel. I\\ncompleted my undergraduate studies from\\nIIO Ljourki and today I'm going to talk\\nabout Kraken Guard. So a work done with\\nmy co-authors under the guidance of\\nprofessor Marios at Imperial College. So\\nKraken Guard is a load time EBPF policy\\nenforcer that provides fine grain\\nisolation with zero runtime overhead. So\\nlet's talk about ebpf programs first.\\nebpf is a safe in kernel virtual machine\\nthat allows userdefined program to run\\ninside the operating system kernel. It\\nuh the programs are loaded at runtime\\nand they are attached to different\\nkernel hooks based on their types and\\nfunctionality. Uh once they once\\nattached they can observe and influence\\nthe systemwide behavior like they can\\nread and edit the network traffic. They\\ncan uh trace user space processes etc.\\nIn order to ensure safety, eBPF uses in\\nkernel verifier that checks programs for\\nmemory safety and guaranteed\\ntermination.\\nEbpf is no longer a niche kernel\\nfeature, but now it runs in production\\nat hyperscalers. Uh systems like metasan\\nand cloudflare's unimog rely on the in\\nkernel ebpf programs for real datab\\nfunctionalities.\\nThe use of EVPF program has also\\ni"
  },
  {
    "video_ref": "V006",
    "channel": "USENIX",
    "title": "NSDI '26 - Net-P4ct: Enhanced WAN Bandwidth Fair Sharing Using P4 Programmable Switches",
    "published_at": "2026-06-01T22:41:44+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 15305,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Hello everyone, I'm Har. I will discuss\\nNetpack system which enables uh enhanced\\none bandwidth fair sharing with P4\\nprogram switches. I'm preding I'm\\npresenting this talk on behalf of my\\nco-workers.\\nUh first let's look at the challenge we\\nhave uh driven by applications include\\nincluding cloud services live streaming\\nand on demand videos etc. The capacity\\nof Biden's selfbuilt WAN has increased\\nfrom 010 to 100 terabits per second in\\nthe past few years. Due to the long uh\\ndeployment cycles and uh high provision\\nand high provisioning cost of one\\nexpansion, network operators strive to\\nimprove bandwidth utilization resource\\nefficiency in order to meet the SLOs's\\nfor various applications. We generally c\\ncategorize the traffic classes into high\\npriority and low priority class. We\\nobserved that each class consists of\\ndiverse uh service type. A few\\ninfrastructure services such as compute\\nand storage and then uh business\\napplications account for majority of the\\nnetwork traffic in each priority traffic\\nuh in each priority class. A large\\nfraction of low priority traffic belongs\\nto distributed file system which\\nexhibits burst traffic patterns. Uh it\\nis important uh"
  },
  {
    "video_ref": "V007",
    "channel": "USENIX",
    "title": "NSDI '26 - OneSidedMW: Managing Disaggregated Memory Efficiently, Flexibly, and Securely with RNIC",
    "published_at": "2026-06-01T22:41:44+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 15918,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Good afternoon everyone. My name is\\nWang. I'm from Shanghai J University.\\nToday I'm glad to present our research\\npaper once memory window a system for\\nmanaging disaged memory efficiently\\nflexibly and securely using aric\\noffloading. So let me start with some\\nbackground on the disagregated memory\\narchitecture or DM architecture. So the\\nkey idea of this disagregate memory is\\nto separate compute and memory sources\\ninto two independent hardware pools\\nconnected over a network. In this work\\nwe mainly focus on RDMA based systems.\\nIn DM architecture, computer nodes\\ntypically have strong CPUs but limited\\nlocal memory. Memory nodes have abundant\\nuh DM but uh very weak or even no CPU\\npower. Computer nodes can access remote\\nmemory through one side through\\none-sided RDMA which gives us a\\nmicrocond level latency.\\nNow in the DM architecture how to\\nmanaging disagregated memory is a\\ncritical problem. Uh I mean the\\ndisagregated memory management by uh the\\nmemory node have to uh handle allocation\\nand deoc allocation requests from\\ncomputer nodes and at the same time uh\\nin me memory isolation which means that\\na computer node should not be able to\\naccess memory me should no"
  },
  {
    "video_ref": "V008",
    "channel": "USENIX",
    "title": "NSDI '26 - Syntra: Synthesizing Cross-Layer Controllers for Low-Latency Video Streaming",
    "published_at": "2026-06-01T22:41:44+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 12412,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Uh hi everyone this is Jeff from UTR\\nteam and today I'm going to talk about\\nour work central the synthesized cross\\nlayer controllers for low latency video\\nstreaming.\\nWell the pipeline of a low lat low\\nlatency video streaming is fairly\\ncomplex. uh a video source will generate\\nsome frames and then the system need to\\nuh decides should we skip this frame,\\nwhat bait rate should we compress this\\nframe at and how much FC redundancy\\nshould we add and how fast should we\\nsend packets into the network among\\namong them ABR and Ca have been well\\nstudied.\\nHowever, when combined them together,\\nthe problem is still pretty hard. We\\nfound that the state-ofthe-art\\nrate controller webc\\nis slow to adapt to network changes. We\\nrun it on the link alternating between 2\\nMbps and 500 kbps every 40 seconds. Uh\\nwhen the link rate increases, the CCA\\nwants small bias to prove the network.\\nHowever, the the encoder cannot pro\\nprovide enough bi. So, this causes a\\nslow ramp up problem and takes about 20\\nseconds to convert to the new bandwidth.\\nWhen the link rate decreases, the\\nproblem still persists. Uh GCC will\\nquickly uh detect that the bandwidth\\ncapacity drops and then notify the "
  },
  {
    "video_ref": "V009",
    "channel": "Stanford Online",
    "title": "Stanford CME296 Diffusion & Large Vision Models | Spring 2026 | Lecture 8 - Trending Topics",
    "published_at": "2026-06-01T20:25:31+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 77645,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Hello everyone and welcome to lecture 8\\nof CME 296.\\nSo today is a special day because as you\\nknow today is the last lecture of this\\nentire class. So the menu for today will\\nbe a little bit different. What we'll do\\nis we'll divide this lecture into two\\nparts. In the first part, we'll try to\\npush to piece together everything we've\\nseen in the class up until now and see\\nwhat we can take away from it. And in\\nthe second part, what we look at is\\nadjacent fields where we can apply what\\nwe have learned.\\nDoes it sound good to you?\\nSo with that what we'll do is we'll\\nstart with the first part which is just\\npiecing together everything we've seen\\nthis quarter\\nand\\nthe whole goal of this class has been to\\nlearn how to generate images. So for\\ninstance given an input prompt how can\\nwe generate an image that is\\nquite aligned with the prompt as input\\nand of course there is just a lot of\\ndimensions we can look at. So this class\\nhas been about decomposing the fact of\\nlearning how it works into tractable\\nparts. And if you remember the first\\nthree lectures were about just\\nunderstanding how we could generate\\nimages just let's suppose we have a\\nblackbox model what is the p"
  },
  {
    "video_ref": "V010",
    "channel": "Microsoft Research",
    "title": "AI's Mythos Moment: Preparing governments for AI | Former UK Prime Minister Rishi Sunak",
    "published_at": "2026-06-01T18:57:32+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 61374,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "With Mythos,\\nwhat's happened\\nis you've had a kind of gated\\nrelease for this thing\\nwhere it's like, “Hang on, there's some risks here.\\nWe can't just let this thing\\nbe released into the world.\\nWe need to give defense the time to,\\nto implement everything, and get ahead before\\nit's released.\\nOtherwise,\\nyou know,\\nwe're giving the bad guys\\na head start, essentially.”\\nThat's Rishi Sunak,\\nFormer Prime Minister of the United Kingdom.\\nHe's an advisor to both Microsoft and Anthropic,\\nplacing him at the center of today's AI headlines.\\nOur conversation comes at\\nwhat The Economist has called\\n“The Mythos Moment”,\\nnamed for issues raised by Anthropic’s\\nlatest model.\\nMythos is so capable\\nof spotting software vulnerabilities\\nthat it's raising new questions\\naround the responsible release\\nof increasingly powerful AI.\\nWe talk about why\\ncyber attacks are today's leading AI risks,\\nthe changing nature of digital sovereignty,\\nand what AI may mean to your job.\\nRishi Sunak,\\nup next on Tools and Weapons.\\nRishi, thank you so much for joining me.\\nYou're here at Microsoft for our CEO summit, and\\nwe get to see you more often these days.\\nYou're an advisor to Microsoft.\\nYou're "
  },
  {
    "video_ref": "V011",
    "channel": "AI Engineer",
    "title": "Can LLMs generate Enterprise Quality Code? — Prasenjit Sarkar, Sonar",
    "published_at": "2026-05-31T18:00:21+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 14384,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "[music]\\n>> All right. Okay.\\nSorry guys for the little hiccup.\\nOkay. So, my name is Prasanjit Sarkar\\nand\\ntoday's session is all about is our\\nall the LLMs are they generating the\\ncode which is enterprise ready, right?\\nSo, let's look at the first slide. In\\nthe first slide we are talking about um\\nAdnan Qureshi who 2 months back said\\nthat a lot of things has been changed in\\nthe software development area. Earlier\\nwe used to write code in IDE. Now things\\nhas been changed. Now it's all about\\nagentic. So, you are spinning up agents.\\nYou are just giving instructions in\\nEnglish and English is now the new\\nprogramming language. Everybody's\\ntalking about that. And\\nthen you are letting it go, but you\\nknow, humans are actually reviewing the\\ncode that is being generated by the\\nagent.\\nSo, a lot of things has been changed.\\nEarlier we used to start you know,\\nopening up by IDE, fancy IDEs like\\nstarting from VS Code or JetBrains\\nto Cursor now\\nor Wind Surf or you know, anti-gravity.\\nAnd now we are moving towards the\\nagentic coding platforms which is Code X\\nor Claude or Devin or Gemini CLI. And\\naccording to the Pragmatic Engineer\\nSurvey which was done in March 2026, we\\nh"
  },
  {
    "video_ref": "V012",
    "channel": "AI Engineer",
    "title": "Engineering voice agents: Latency, quality, and scale — Rishabh Bhargava, Together AI",
    "published_at": "2026-05-31T16:00:06+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 26458,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "All right. Well, folks, thanks for being\\nhere. Excited to chat more about how to\\nengineer voice agents, you know, high\\nquality, low latency at scale. First,\\nmaybe a little bit about me. My name is\\nRishab. I work at a company called\\nTogether AI. I lead the voice AI team\\nthere.\\nPrior to Together, I was the co-founder\\nCEO of a company called Refuel that was\\nacquired by Together last year. But\\ngenerally been building AI and machine\\nlearning infrastructure for about a\\ndecade.\\nFor folks who maybe don't know about\\nTogether, Together is building the AI\\nnative cloud. What that really means is\\nfor companies that are looking to train\\nmodels and need access to reliable\\ncompute, or you want to do inference at\\nscale, we're probably a very good fit\\nfor you. We work with, you know, there's\\na million plus developers. We closely\\nwork with hundreds of companies and, you\\nknow, very proud to be working with\\ncompanies like Cursor and Deck again.\\nOkay, here is the agenda for today. So,\\nwe're going to first talk about, you\\nknow, why we're talking about voice,\\nalthough the previous speaker alluded to\\na lot of interesting things that he's\\ndoing with voice. But why does voice\\n"
  },
  {
    "video_ref": "V013",
    "channel": "Welch Labs",
    "title": "Yann LeCun's $1B Bet Against LLMs [Part 2]",
    "published_at": "2026-05-30T18:18:59+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 38116,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "This video is sponsored by Kiwiico. More\non them later. The startup Physical\nIntelligence builds some of the most\nimpressive robot brains ever\ndemonstrated. Here's their PI07 model.\nPeeling a zucchini, folding a pin wheel,\nand taking out the trash. PIO7 is a\nvision language action or VLA model.\nWhat's your expectation here? Do you\nthink Jeepa based approaches will\neventually overtake VA approaches?\n>> Oh, absolutely. Yeah, VA are doomed. I\nmean they they basically don't work\nreally well.\n>> Last time we followed Yon Lun's path to\nJeppa, an alternative architecture for\nbuilding AI models. Like VLA models,\nJeepa approaches can also control\nrobots. But Jeppa's demonstrated\ncapabilities are significantly behind.\nHere's Jeepa taking 60 seconds to move a\ncup off a platform.\nSo what makes Lacun so confident here?\nAre these VLA approaches that look\nincredibly impressive right now actually\ndoomed? VA models are in many ways the\npinnacle of the current mainstream\ngenerative language driven approach to\nAI.\nVLA models are built on top of VLMs,\nvision language models and VLMs are in\nturn built from vision encoders and\nlarge language models.\nAt each level of the VLA stack, there\nexists an altern"
  },
  {
    "video_ref": "V014",
    "channel": "AI Engineer",
    "title": "How I deleted 95% of my agent skills and got better results — Nick Nisi, WorkOS",
    "published_at": "2026-05-30T18:00:06+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 18262,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "[music]\n>> All right, good morning everyone.\nUh welcome to my talk building AI\nsystems that ship. I'm Nick Nisi and I\nwork at WorkOS. We've got a booth\ndownstairs. Come check us out and talk\nto us. We'd be happy to chat.\nUh but let me start that over. Hi, I'm\nthe bottle neck. Uh\nI'm a DX engineer at WorkOS and I work\non 20 plus repos across eight different\nlanguages. Uh it's all of our SDKs and\nopen source things that we have. And the\nit's like AuthKit Next.js, AuthKit\nReact,\nWorkOS Node, WorkOS Kotlin, WorkOS Ruby,\nPHP,\neverywhere. So, there's a lot to do\nacross a lot of different things.\nAnd I'm really good at working on those.\nAnd I've gotten really good over the\nlast eight months\nworking with those via agents. So, I\nhaven't written a line of code myself in\nprobably eight months. Uh I've gotten\nreally good at just scaling that with\nagents and then reviewing what they do\nand then instructing them and getting\nthe work done faster and better while\nstill maintaining good quality.\nUh but there was a big problem doing\nthat uh with one agent at a time across\nall of these repos. I'm just constantly\ncontext switching over and over and\nover. Uh and it just gets harder and\nharder\nuh and\nth"
  },
  {
    "video_ref": "V015",
    "channel": "S3 | Science, Startups, & Stories",
    "title": "This startup is solving floods | Terranova",
    "published_at": "2026-05-30T16:00:11+00:00",
    "duration_min": 0.0,
    "language": "en",
    "summary_zh": "[semantic_summary_missing]",
    "key_points": [],
    "topic_tags": [],
    "why_it_matters": "",
    "transcript_chars": 13755,
    "transcript_truncated_for_grouping": true,
    "transcript_excerpt": "Teranova is a company that that develops\nways to automatically elevate terrain\nwith the subterranean injection of wood\nto lift areas up out of flood problems,\ngive them permanent flood resilience.\n>> Devastating storms and catastrophic\nflooding. Entire communities seemingly\nunderwater.\n>> Heavy rain touched off flooding and\nmudslides that damaged homes, swallowed\nup cars, and forced evacuations. You see\nthese cities that are flooding and these\npeople who were dying and losing their\nhomes. That didn't need to happen. That\narea could have been lifted up.\n>> They're predicted by60 where there will\nbe a trillion dollar multi-stage levy\ncollapse.\n>> If levies won't work, we need to invent\nsomething new. And Lawrence said, you\nknow, we really have to start a company\nto do this. When that's what your kid\nsays to you, it's a pretty compelling\nargument.\n>> I firmly believe this is the first step\nto really being able to do large scale\nterraforming.\nMy name is Trip Allen. I'm founder and\nchairman of Terteranova Systems. We're\nliving in San Rafale and San Rafel is\nthis close to the bay and our yard list\nflooding all the time. You'd be trying\nto drive to work and have to go through\n18 in of wat"
  }
]
