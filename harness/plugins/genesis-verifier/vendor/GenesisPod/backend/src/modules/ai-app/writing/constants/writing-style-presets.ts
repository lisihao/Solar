/**
 * Writing Style Presets - 写作风格预设
 *
 * 提供多种经典写作风格供用户选择，
 * 包括中国武侠名家、网文流派、外国经典风格等。
 */

export interface WritingStylePreset {
  /** 预设ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 分类 */
  category: "chinese_martial_arts" | "chinese_web_novel" | "foreign" | "custom";
  /** 描述 */
  description: string;
  /** 代表作家/作品 */
  representative?: string;
  /** 风格特点 */
  characteristics: {
    /** 叙事节奏 */
    pacing: "slow" | "medium" | "fast" | "varied";
    /** 对话风格 */
    dialogueStyle: string;
    /** 描写风格 */
    descriptionStyle: string;
    /** 句式长度 */
    sentenceLength: "short" | "medium" | "long" | "varied";
    /** 词汇水平 */
    vocabulary: "simple" | "intermediate" | "advanced" | "poetic";
    /** 情感表达 */
    emotionalTone: string;
    /** 场景转换 */
    sceneTransition: string;
  };
  /** 系统提示词片段 */
  systemPromptFragment: string;
  /** 写作要求 */
  writingRequirements: string[];
  /** 应避免的模式 */
  avoidPatterns: string[];
  /** ★新增：标志性技法（每章应使用2-3种） */
  signatureTechniques?: {
    /** 技法名称 */
    name: string;
    /** 技法说明 */
    description: string;
    /** 使用示例 */
    example?: string;
  }[];
}

/**
 * 预设风格库
 */
export const WRITING_STYLE_PRESETS: Record<string, WritingStylePreset> = {
  // ==================== 中国武侠名家 ====================

  jin_yong: {
    id: "jin_yong",
    name: "金庸风格",
    category: "chinese_martial_arts",
    description: "大气磅礴，侠之大者，融合历史与武侠，注重人物塑造与家国情怀",
    representative: "金庸 - 《射雕英雄传》《天龙八部》《笑傲江湖》",
    characteristics: {
      pacing: "varied",
      dialogueStyle: "文雅中带豪气，对话中展现人物性格",
      descriptionStyle: "场景宏大细腻，武功描写具有诗意",
      sentenceLength: "varied",
      vocabulary: "advanced",
      emotionalTone: "厚重深沉，侠义豪情",
      sceneTransition: "承上启下，自然流畅",
    },
    systemPromptFragment: `【金庸武侠风格指南】
- 对话要点：语言文雅但不造作，豪侠气概自然流露，善用四字词语和成语
- 描写要点：武功招式有诗意，场景描写大气磅礴，善用历史典故
- 人物塑造：性格鲜明有层次，既有大侠风范也有凡人情感
- 情节特点：善恶分明但有复杂性，家国情怀与儿女情长并重`,
    writingRequirements: [
      "对话应体现人物身份和性格，武林前辈与江湖后辈说话方式不同",
      "武功描写要有意境，如「降龙十八掌」「独孤九剑」般有画面感",
      "情节要有历史厚重感，可适当引用历史典故",
      "人物情感要真挚，侠义与情爱兼顾",
    ],
    avoidPatterns: ["现代网络用语", "过于白话的对白", "脱离时代的物品描写"],
  },

  gu_long: {
    id: "gu_long",
    name: "古龙风格",
    category: "chinese_martial_arts",
    description: "短句犀利，氛围神秘，注重悬念与意境，人物孤独浪漫",
    representative: "古龙 - 《绝代双骄》《小李飞刀》《楚留香》",
    characteristics: {
      pacing: "fast",
      dialogueStyle: "简洁犀利，言简意赅，暗藏机锋",
      descriptionStyle: "写意不写实，注重氛围营造",
      sentenceLength: "short",
      vocabulary: "intermediate",
      emotionalTone: "孤独浪漫，冷峻中带温情",
      sceneTransition: "跳跃式，制造悬念",
    },
    systemPromptFragment: `【古龙武侠风格指南】
- 句式要点：短句为主，一行一句，制造节奏感和紧张感
- 对话要点：话不说满，点到为止，让读者自己体会
- 描写要点：写意不写实，「夕阳下，一个人影」比详细描写更有意境
- 氛围要点：神秘、孤独、浪漫，善用留白
- 武功描写：不必详述招式，注重结果和意境`,
    writingRequirements: [
      "多用短句，一句一行，营造节奏感",
      "对话简洁有力，忌啰嗦",
      "善用问句和省略号营造悬念",
      "场景描写要有诗意，重氛围轻细节",
      "武功描写点到为止，留给读者想象空间",
    ],
    avoidPatterns: ["冗长的心理描写", "繁复的武功招式名称", "拖沓的场景过渡"],
  },

  liang_yusheng: {
    id: "liang_yusheng",
    name: "梁羽生风格",
    category: "chinese_martial_arts",
    description: "典雅工整，诗词优美，名士风流，正邪分明",
    representative: "梁羽生 - 《白发魔女传》《七剑下天山》",
    characteristics: {
      pacing: "medium",
      dialogueStyle: "典雅工整，书卷气浓",
      descriptionStyle: "细腻优美，善用诗词",
      sentenceLength: "medium",
      vocabulary: "poetic",
      emotionalTone: "典雅含蓄，正气凛然",
      sceneTransition: "娓娓道来，层次分明",
    },
    systemPromptFragment: `【梁羽生武侠风格指南】
- 文风要点：典雅工整，带有书卷气息，可适当引用诗词
- 对话要点：语言优美，体现人物文化修养
- 描写要点：细腻而不繁琐，善用比喻和诗意描写
- 人物特点：正邪分明，主角多有名士风流气质
- 情节特点：节奏稳健，逻辑清晰`,
    writingRequirements: [
      "可适当引用或化用古诗词",
      "对话要体现人物的文化素养",
      "正邪立场分明，但不脸谱化",
      "叙事节奏稳健，不急不躁",
    ],
    avoidPatterns: ["粗俗的语言", "过于现代的表达", "混乱的善恶观"],
  },

  // ==================== 中国网文流派 ====================

  web_xuanhuan: {
    id: "web_xuanhuan",
    name: "玄幻爽文",
    category: "chinese_web_novel",
    description: "节奏明快，升级打怪，爽点密集，设定宏大",
    representative: "《斗破苍穹》《完美世界》《遮天》",
    characteristics: {
      pacing: "fast",
      dialogueStyle: "直白热血，装X打脸",
      descriptionStyle: "战斗爽快，升级明确",
      sentenceLength: "short",
      vocabulary: "simple",
      emotionalTone: "热血燃情，爽感十足",
      sceneTransition: "快节奏推进",
    },
    systemPromptFragment: `【玄幻爽文风格指南】
- 节奏要点：快！每章都要有爽点或进展
- 对话要点：直白有力，打脸要果断，装X要自然
- 战斗要点：招式炫酷，结果明确，胜负分明
- 升级要点：进步要看得见，每章有小突破，大章有大突破
- 情节要点：目标明确，障碍清晰，主角始终在成长`,
    writingRequirements: [
      "每章必须有明确的爽点或进展",
      "主角成长要有阶段性成果",
      "反派要恰到好处地「送脸」",
      "战斗描写要有画面感和冲击力",
      "不要有无意义的过渡章节",
    ],
    avoidPatterns: ["冗长的心理独白", "过多的日常描写", "主角长期低谷"],
  },

  web_gongdou: {
    id: "web_gongdou",
    name: "宫斗权谋",
    category: "chinese_web_novel",
    description: "步步惊心，心机博弈，人物复杂，层层反转",
    representative: "《甄嬛传》《琅琊榜》《庆余年》",
    characteristics: {
      pacing: "medium",
      dialogueStyle: "话里有话，暗藏机锋",
      descriptionStyle: "细腻入微，察言观色",
      sentenceLength: "medium",
      vocabulary: "intermediate",
      emotionalTone: "隐忍克制，暗流涌动",
      sceneTransition: "伏笔铺陈，前后呼应",
    },
    // 注意：详细的写作规则已移至数据库风格模板层 (WritingStyleTemplate)
    // 此处只保留基础风格指南，具体规则由用户选择的模板提供
    systemPromptFragment: `【宫斗权谋风格指南】
- 对话要点：一语双关，话中有话，不同身份人物语气有别
- 描写要点：善用微表情和肢体语言，环境暗示心境
- 人物塑造：人物立体有层次，没有绝对的善恶
- 情节特点：伏笔呼应，主角需有主动行动，势力博弈合理`,
    writingRequirements: [
      "对话应体现人物身份差异，用暗语和试探推进情节",
      "善用微表情描写代替直白的心理独白",
      "主角需有主动决策和行动，不能只是被动应对",
      "情节靠角色智谋推进，避免巧合",
    ],
    avoidPatterns: [
      "过于直白的表态",
      "脸谱化的善恶划分",
      "情节靠巧合推进",
      "所有角色说话方式雷同",
    ],
    signatureTechniques: [
      {
        name: "话中藏刀",
        description: "表面恭维实则讽刺，或者表面关心实则威胁，对话有双层含义",
        example: "「姐姐这身打扮倒是素净，想必是不想抢了今日寿宴的风头。」",
      },
      {
        name: "物件隐喻",
        description: "用茶、棋、花等物件暗示人物关系或局势变化",
        example: "她将那盏已凉透的茶轻轻推到一旁——这是最后的警告。",
      },
      {
        name: "微表情叙事",
        description: "通过细微的神态变化暗示内心活动，而非直接描写心理",
        example: "她接过那道圣旨时，睫毛微不可察地颤了颤，旋即恢复如常。",
      },
      {
        name: "环境映衬",
        description: "用环境细节映衬人物处境或情绪变化",
        example: "殿中的炭火已尽，铜盆里只剩一层灰白的冷灰。",
      },
      {
        name: "留白结尾",
        description: "对话或场景在关键处戛然而止，留给读者想象空间",
        example: "她欲言又止，最终只是福了福身，转身离去。",
      },
      {
        name: "伏笔前置",
        description: "在看似不经意的描写中埋下后续剧情的伏笔",
        example: "她随手将那枚玉佩收入袖中——这东西，日后或许用得上。",
      },
      {
        name: "势力博弈",
        description: "通过多方势力的角力展现权谋的复杂性",
        example: "太后一派按兵不动，皇后一系蠢蠢欲动，而她，只需静待鹬蚌相争。",
      },
      {
        name: "身份反差",
        description: "利用人物的表面身份与真实身份的反差制造张力",
        example: "谁能想到，这个在御前战战兢兢的小太监，竟是......",
      },
    ],
  },

  // ==================== 晋江女频风格 ====================

  jinjiang_yanqing: {
    id: "jinjiang_yanqing",
    name: "晋江言情",
    category: "chinese_web_novel",
    description: "细腻情感，双向奔赴，成长弧线清晰，甜虐平衡",
    representative: "《知否知否应是绿肥红瘦》《何以笙箫默》《步步惊心》",
    characteristics: {
      pacing: "varied",
      dialogueStyle: "自然灵动，暗藏情愫，台词有记忆点",
      descriptionStyle: "细腻入微，情绪流动，注重心理描写",
      sentenceLength: "varied",
      vocabulary: "intermediate",
      emotionalTone: "细腻温婉，情感层次丰富",
      sceneTransition: "情绪驱动，自然流畅",
    },
    systemPromptFragment: `【晋江言情风格指南】
- 情感核心：感情线是主轴，但角色要有独立人格，不是恋爱脑
- 对话要点：台词要有记忆点，能让读者截图分享；暧昧期的试探和拉扯尤为重要
- 内心戏：女主内心戏细腻但不啰嗦，要有洞察力和小聪明
- 男主塑造：冷面热心或外冷内热，对女主的特殊要有细节体现
- 节奏把控：甜虐交替，高甜后有小虐，虐后有糖，情绪起伏有节奏
- 配角作用：配角推动剧情，不是工具人，要有自己的故事线`,
    writingRequirements: [
      "每章至少一个情感推进点（心动、误会、和解、升温）",
      "男女主互动要有化学反应，对话有来有往",
      "女主要有成长弧线，从被动到主动的转变",
      "暧昧期要足够长，给读者期待感",
      "甜宠场景要具体，不能只写「他对她很好」",
      "高甜场景注重五感细节：心跳、脸红、触感、气息",
    ],
    avoidPatterns: [
      "女主无脑傻白甜或恋爱脑",
      "男主无缘无故爱上女主",
      "配角脸谱化（恶毒女配、炮灰男配）",
      "强行制造误会推动剧情",
      "感情转折太突兀",
      "大量旁白代替情感描写",
    ],
    signatureTechniques: [
      {
        name: "欲言又止",
        description: "情感关键时刻话说一半，留下悬念和想象空间",
        example: "「我……」她顿了顿，终究没有说出那句话，只是移开了视线。",
      },
      {
        name: "细节心动",
        description: "用极其细微的动作描写心动瞬间",
        example:
          "他替她挡住了人群，手臂微微抬起却没有触碰到她——那恰到好处的距离，让她的心跳漏了一拍。",
      },
      {
        name: "反差萌",
        description: "展现角色表面性格与真实一面的反差",
        example:
          "在外人面前冷若冰霜的他，此刻却小心翼翼地用手背试了试粥的温度。",
      },
      {
        name: "糖中带刀",
        description: "看似甜蜜的场景埋下后续虐心的伏笔",
        example: "她笑着接过那枚玉佩，却不知道这是他留给她的最后一件东西。",
      },
      {
        name: "旁观者视角",
        description: "通过第三人视角侧写男女主的感情",
        example:
          "丫鬟红袖偷偷看了一眼自家小姐——每次那位萧公子来访，小姐嘴上说着「不见」，簪子却换了三根。",
      },
      {
        name: "触感描写",
        description: "用触觉描写传达情感温度",
        example:
          "他的指尖扫过她的发梢，像是羽毛掠过水面，轻得几乎不存在，却让她整个人都僵住了。",
      },
      {
        name: "记忆闪回",
        description: "在关键时刻闪回过去的甜蜜或创伤",
        example:
          "看着他转身离去的背影，她忽然想起初见时——他也是这样，头也不回地走进了风雪里。",
      },
    ],
  },

  jinjiang_gongdou: {
    id: "jinjiang_gongdou",
    name: "晋江宫斗",
    category: "chinese_web_novel",
    description: "女性视角权谋，话中藏刀，微表情博弈，情感与生存交织",
    representative: "《甄嬛传》《延禧攻略》《如懿传》",
    characteristics: {
      pacing: "medium",
      dialogueStyle: "绵里藏针，一语双关，身份决定语气",
      descriptionStyle: "微表情叙事，环境隐喻，细节暗示",
      sentenceLength: "medium",
      vocabulary: "advanced",
      emotionalTone: "隐忍克制，暗流汹涌，偶有真情流露",
      sceneTransition: "伏笔呼应，势力轮转",
    },
    systemPromptFragment: `【晋江宫斗风格指南】
- 核心逻辑：生存是第一需求，感情服务于生存，但也要有真情流露的时刻
- 对话分层：对上（恭敬中有自保）、对平（试探中有交锋）、对下（恩威并施）
- 女性视角：不是权力的附庸，而是权力游戏的参与者和博弈者
- 势力格局：后宫势力要清晰，每个人的靠山和弱点要明确
- 情感处理：爱情不是全部，但真情时刻要动人；被辜负时要有恨意的层次
- 成长弧线：从天真到黑化有过程，每次转变都要有触发事件`,
    writingRequirements: [
      "每次对话都要考虑双方身份地位差异",
      "重大场景用微表情代替心理描写",
      "势力博弈要有清晰的利益链条",
      "女主的每次行动都要有动机和代价",
      "配角后妃要有各自的立场和苦衷",
      "圣宠不是万能的，要写出其危险性",
    ],
    avoidPatterns: [
      "女主一路开挂无人能敌",
      "后妃全是蠢货只有女主聪明",
      "皇上圣明一切公正",
      "对话像现代人吵架",
      "动不动就跪地求饶",
      "所有人都围着女主转",
    ],
    signatureTechniques: [
      {
        name: "请安暗战",
        description: "在请安礼仪中进行势力宣示和言语交锋",
        example:
          "「给皇后娘娘请安。」她福身时故意慢了半拍，那半拍里，足够在座所有人都看清她腕上的镯子——那是昨夜皇上新赐的。",
      },
      {
        name: "赏赐博弈",
        description: "通过赏赐物品暗示恩宠变化和派系立场",
        example:
          "皇后赐下的燕窝羹还冒着热气，她却看向那只素白的瓷盅——皇后宫里从来只用青花。这是试探。",
      },
      {
        name: "太监传话",
        description: "通过太监宫女的传话方式暗示主子真意",
        example:
          "「皇上说让娘娘好好休息。」小太监垂着眼，声音里听不出喜怒——可那「好好」二字，咬得格外清晰。",
      },
      {
        name: "病中角力",
        description: "利用生病或假病进行宫中博弈",
        example:
          "她已经「病」了三日，三日里，那些平日不登门的人，全都来了——有人是探病，有人是探虚实。",
      },
      {
        name: "衣饰密语",
        description: "通过服饰首饰的选择暗示立场和态度",
        example:
          "众妃皆着盛装，唯独她换了素服——这是在提醒皇上，今日是她孩儿的忌辰。",
      },
      {
        name: "茶道试探",
        description: "通过上茶、品茶、换茶等细节进行心理博弈",
        example:
          "贵妃亲手斟的茶，她接过，却只是捧在手里——茶凉了，便有借口不喝。",
      },
      {
        name: "借刀杀人",
        description: "不直接出手，借他人之力达成目的",
        example:
          "她什么都没做，只是在淑妃面前，「不小心」提了一句那件事——剩下的，淑妃会替她做。",
      },
      {
        name: "真情裂痕",
        description: "在算计中偶露真情，让人物更立体",
        example:
          "「你以为我愿意吗？」她声音忽然颤了，那一瞬的失态，让他第一次看清她眼底的血丝。",
      },
    ],
  },

  // ==================== 外国经典风格 ====================

  western_fantasy: {
    id: "western_fantasy",
    name: "西方史诗奇幻",
    category: "foreign",
    description: "宏大世界观，史诗叙事，善恶对抗，英雄之旅",
    representative: "托尔金《指环王》、乔治·马丁《冰与火之歌》",
    characteristics: {
      pacing: "varied",
      dialogueStyle: "庄重优雅，符合角色身份",
      descriptionStyle: "细致入微，世界观宏大",
      sentenceLength: "long",
      vocabulary: "advanced",
      emotionalTone: "史诗感，命运的厚重",
      sceneTransition: "多线叙事，宏观把控",
    },
    systemPromptFragment: `【西方史诗奇幻风格指南】
- 世界观：完整自洽的设定，有历史感和厚重感
- 叙事：可采用多视角，展现宏大图景
- 对话：符合角色身份和文化背景
- 描写：场景要有沉浸感，细节要服务于氛围
- 情节：命运与选择的冲突，善与恶的复杂性`,
    writingRequirements: [
      "世界观设定要自洽",
      "可使用多视角叙事",
      "战争和政治的描写要有真实感",
      "人物的选择要有道德复杂性",
    ],
    avoidPatterns: ["过于东方化的表达", "脱离设定的现代用语"],
  },

  mystery_suspense: {
    id: "mystery_suspense",
    name: "悬疑推理",
    category: "foreign",
    description: "层层设疑，逻辑缜密，真相反转，智力博弈",
    representative: "阿加莎·克里斯蒂、东野圭吾",
    characteristics: {
      pacing: "varied",
      dialogueStyle: "信息量大，暗藏线索",
      descriptionStyle: "精确细致，每个细节都可能是线索",
      sentenceLength: "medium",
      vocabulary: "intermediate",
      emotionalTone: "紧张压抑，层层推进",
      sceneTransition: "多线索交织",
    },
    systemPromptFragment: `【悬疑推理风格指南】
- 线索布局：公平呈现线索，让读者有机会自己推理
- 节奏控制：张弛有度，紧张与舒缓交替
- 人物塑造：嫌疑人各有动机，真相出人意料又合情合理
- 对话技巧：对话中隐藏关键信息
- 反转技巧：反转要有铺垫，不能强行反转`,
    writingRequirements: [
      "线索要公平地呈现给读者",
      "真相要出人意料但合情合理",
      "每个嫌疑人都要有可信的动机",
      "推理过程要有逻辑性",
    ],
    avoidPatterns: ["毫无铺垫的反转", "超自然的解答", "线索的后知后觉"],
  },

  // ==================== 通用现代风格 ====================

  modern_realistic: {
    id: "modern_realistic",
    name: "现代现实主义",
    category: "custom",
    description: "贴近生活，情感真挚，人物立体，语言自然",
    representative: "当代文学、都市小说",
    characteristics: {
      pacing: "medium",
      dialogueStyle: "自然口语化，符合现代人说话习惯",
      descriptionStyle: "写实细腻，生活化",
      sentenceLength: "varied",
      vocabulary: "simple",
      emotionalTone: "温暖或深沉，接地气",
      sceneTransition: "自然流畅",
    },
    systemPromptFragment: `【现代现实主义风格指南】
- 语言：自然口语化，贴近现代人的说话方式
- 描写：生活化细节，让读者有代入感
- 情感：真挚不矫情，情绪转折要有过程
- 人物：有缺点的普通人，成长要真实可信
- 情节：接地气，避免过于戏剧化`,
    writingRequirements: [
      "对话要自然，可以使用现代口语",
      "细节描写要有生活气息",
      "人物情感转变要有过程",
      "情节发展要符合现实逻辑",
    ],
    avoidPatterns: ["过于戏剧化的巧合", "脸谱化的人物", "悬浮的生活场景"],
  },
};

/**
 * 获取风格预设
 */
export function getStylePreset(
  styleId: string,
): WritingStylePreset | undefined {
  return WRITING_STYLE_PRESETS[styleId];
}

/**
 * 获取所有风格预设列表（用于前端展示）
 */
export function getAllStylePresets(): Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  representative?: string;
}> {
  return Object.values(WRITING_STYLE_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    category: preset.category,
    description: preset.description,
    representative: preset.representative,
  }));
}

/**
 * 根据故事类型推荐风格
 */
export function recommendStyleByGenre(genre: string): string[] {
  const genreLower = genre.toLowerCase();

  if (genreLower.includes("武侠") || genreLower.includes("江湖")) {
    return ["jin_yong", "gu_long", "liang_yusheng"];
  }

  if (
    genreLower.includes("玄幻") ||
    genreLower.includes("修仙") ||
    genreLower.includes("穿越")
  ) {
    return ["web_xuanhuan", "jin_yong"];
  }

  if (
    genreLower.includes("宫斗") ||
    genreLower.includes("权谋") ||
    genreLower.includes("宫廷")
  ) {
    return ["jinjiang_gongdou", "web_gongdou", "jin_yong"];
  }

  if (
    genreLower.includes("言情") ||
    genreLower.includes("爱情") ||
    genreLower.includes("甜宠") ||
    genreLower.includes("纯爱")
  ) {
    return ["jinjiang_yanqing", "modern_realistic"];
  }

  if (genreLower.includes("古代") || genreLower.includes("古风")) {
    return ["jinjiang_gongdou", "jinjiang_yanqing", "jin_yong"];
  }

  if (
    genreLower.includes("悬疑") ||
    genreLower.includes("推理") ||
    genreLower.includes("侦探")
  ) {
    return ["mystery_suspense"];
  }

  if (
    genreLower.includes("奇幻") ||
    genreLower.includes("魔法") ||
    genreLower.includes("西方")
  ) {
    return ["western_fantasy"];
  }

  if (
    genreLower.includes("都市") ||
    genreLower.includes("现代") ||
    genreLower.includes("现实")
  ) {
    return ["modern_realistic"];
  }

  // 默认推荐
  return ["modern_realistic", "jin_yong", "web_gongdou"];
}

/**
 * 生成风格相关的写作提示词
 */
export function generateStylePrompt(styleId: string): string {
  const preset = WRITING_STYLE_PRESETS[styleId];
  if (!preset) return "";

  const {
    characteristics,
    writingRequirements,
    avoidPatterns,
    signatureTechniques,
  } = preset;

  let prompt = `
【写作风格：${preset.name}】
${preset.systemPromptFragment}

【风格特点】
- 叙事节奏：${characteristics.pacing === "fast" ? "快节奏推进" : characteristics.pacing === "slow" ? "徐徐展开" : characteristics.pacing === "medium" ? "节奏适中" : "张弛有度"}
- 对话风格：${characteristics.dialogueStyle}
- 描写风格：${characteristics.descriptionStyle}
- 句式特点：${characteristics.sentenceLength === "short" ? "短句为主，节奏明快" : characteristics.sentenceLength === "long" ? "长句铺陈，细腻深入" : "长短结合，错落有致"}
- 情感基调：${characteristics.emotionalTone}

【写作要求】
${writingRequirements.map((req, i) => `${i + 1}. ${req}`).join("\n")}

【避免模式】
${avoidPatterns.map((p) => `- 避免：${p}`).join("\n")}
`;

  // ★ 新增：标志性技法
  if (signatureTechniques && signatureTechniques.length > 0) {
    prompt += `\n【标志性技法】（每章至少使用 2-3 种以保持风格独特性）\n`;
    for (const technique of signatureTechniques) {
      prompt += `★ ${technique.name}：${technique.description}\n`;
      if (technique.example) {
        prompt += `  示例：${technique.example}\n`;
      }
    }
  }

  return prompt;
}

/**
 * 获取随机选择的标志性技法建议
 * 每章推荐 3 种技法，增加多样性
 */
export function getRandomTechniques(
  styleId: string,
  count: number = 3,
): Array<{ name: string; description: string; example?: string }> {
  const preset = WRITING_STYLE_PRESETS[styleId];
  if (!preset?.signatureTechniques) return [];

  const techniques = [...preset.signatureTechniques];
  // Fisher-Yates shuffle
  for (let i = techniques.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [techniques[i], techniques[j]] = [techniques[j], techniques[i]];
  }

  return techniques.slice(0, Math.min(count, techniques.length));
}
