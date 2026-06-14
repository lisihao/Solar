/**
 * 中国历史知识库 - Chinese History Knowledge Base
 *
 * 涵盖主要朝代的：
 * - 时间范围、都城、疆域
 * - 政治制度、官职体系
 * - 社会结构、等级制度
 * - 经济、文化、科技
 * - 重要人物、重大事件
 * - 日常生活细节
 *
 * 数据来源：综合史籍资料
 * 用途：为AI写作提供历史准确性参考
 */

// ==================== 类型定义 ====================

export interface Dynasty {
  /** 朝代名称 */
  name: string;
  /** 别称 */
  aliases: string[];
  /** 时间范围 */
  period: {
    start: number; // 公元年（负数为公元前）
    end: number;
    description: string;
  };
  /** 都城 */
  capitals: Array<{
    name: string;
    modernLocation: string;
    period?: string;
    description?: string;
  }>;
  /** 政治制度 */
  politics: {
    system: string;
    centralGov: OfficialSystem;
    localGov: string;
    military: string;
    selection: string; // 选官制度
  };
  /** 社会结构 */
  society: {
    classes: SocialClass[];
    genderRoles: string;
    family: string;
    customs: string[];
  };
  /** 后宫制度（如适用） */
  harem?: HaremSystem;
  /** 经济 */
  economy: {
    agriculture: string;
    commerce: string;
    currency: string[];
    taxation: string;
  };
  /** 文化 */
  culture: {
    literature: string[];
    art: string[];
    philosophy: string[];
    religion: string[];
  };
  /** 科技 */
  technology: string[];
  /** 日常生活 */
  dailyLife: DailyLife;
  /** 称谓系统 */
  honorifics: HonorificSystem;
  /** 禁忌 */
  taboos: Taboo[];
  /** 重要人物 */
  notableFigures: NotableFigure[];
  /** 重大事件 */
  majorEvents: HistoricalEvent[];
  /** 重要术语 */
  terminology: Record<string, string>;
  /** 写作注意事项 */
  writingNotes: string[];
}

export interface OfficialSystem {
  name: string;
  description: string;
  ranks: Array<{
    rank: number;
    title: string;
    duties: string;
    salary?: string;
  }>;
}

export interface SocialClass {
  name: string;
  description: string;
  privileges: string[];
  restrictions: string[];
  percentage?: string; // 人口占比
}

export interface HaremSystem {
  ranks: Array<{
    rank: number;
    title: string;
    count?: number; // 定额人数
    privileges: string;
  }>;
  management: string;
  rules: string[];
}

export interface DailyLife {
  clothing: ClothingSystem;
  food: FoodSystem;
  housing: string;
  transportation: string[];
  entertainment: string[];
  etiquette: string[];
}

export interface ClothingSystem {
  male: string[];
  female: string[];
  colors: {
    royal: string[];
    official: string[];
    common: string[];
    forbidden: string[];
  };
  accessories: string[];
  notes: string[];
}

export interface FoodSystem {
  staples: string[];
  meats: string[];
  vegetables: string[];
  seasonings: string[];
  drinks: string[];
  tableware: string[];
  notes: string[];
}

export interface HonorificSystem {
  emperor: Record<string, string>;
  empress: Record<string, string>;
  officials: Record<string, string>;
  common: Record<string, string>;
  selfReferences: Record<string, string>;
}

export interface Taboo {
  type: "naming" | "behavior" | "speech" | "dress" | "other";
  description: string;
  consequence: string;
  examples?: string[];
}

export interface NotableFigure {
  name: string;
  title?: string;
  period: string;
  role: string;
  significance: string;
  relatedEvents?: string[];
}

export interface HistoricalEvent {
  name: string;
  year: string;
  description: string;
  significance: string;
  relatedFigures?: string[];
}

// ==================== 西汉 (前202-8) ====================

export const WESTERN_HAN: Dynasty = {
  name: "西汉",
  aliases: ["前汉", "汉朝"],
  period: {
    start: -202,
    end: 8,
    description: "刘邦建立，王莽篡位结束，共210年",
  },
  capitals: [
    {
      name: "长安",
      modernLocation: "陕西西安",
      description: "西汉都城，当时世界最大城市之一，人口约50万",
    },
  ],
  politics: {
    system: "中央集权的郡国并行制",
    centralGov: {
      name: "三公九卿制",
      description: "三公为最高行政长官，九卿分管具体事务",
      ranks: [
        { rank: 1, title: "丞相", duties: "总理朝政，百官之长" },
        { rank: 1, title: "太尉", duties: "掌管军事" },
        { rank: 1, title: "御史大夫", duties: "监察百官，副丞相" },
        { rank: 2, title: "太常", duties: "掌管宗庙祭祀" },
        { rank: 2, title: "光禄勋", duties: "掌管宫殿门户、皇帝侍卫" },
        { rank: 2, title: "卫尉", duties: "掌管宫门卫屯兵" },
        { rank: 2, title: "太仆", duties: "掌管皇帝车马" },
        { rank: 2, title: "廷尉", duties: "掌管刑狱" },
        { rank: 2, title: "大鸿胪", duties: "掌管外交、朝会礼仪" },
        { rank: 2, title: "宗正", duties: "掌管皇族事务" },
        { rank: 2, title: "大司农", duties: "掌管财政税收" },
        { rank: 2, title: "少府", duties: "掌管皇室财物、宫廷手工业" },
      ],
    },
    localGov: "郡县制为主，封国并存。郡设太守，县设县令/长",
    military: "中央军（南军、北军）+ 地方军（郡国兵）+ 边防军",
    selection: "察举制（举孝廉、茂才）+ 征辟制",
  },
  society: {
    classes: [
      {
        name: "皇族",
        description: "刘姓皇室及外戚",
        privileges: ["封王封侯", "食邑", "免赋役"],
        restrictions: ["受监控", "不可干预朝政（理论上）"],
      },
      {
        name: "列侯",
        description: "功臣及其后代",
        privileges: ["食邑", "世袭", "见官不跪"],
        restrictions: ["不可擅离封地"],
      },
      {
        name: "官僚",
        description: "各级官员",
        privileges: ["俸禄", "免赋役", "子弟入仕便利"],
        restrictions: ["受考课", "丁忧守制"],
      },
      {
        name: "士人",
        description: "读书人、候选官员",
        privileges: ["免体罚", "科举入仕"],
        restrictions: ["需遵守礼教"],
      },
      {
        name: "庶民",
        description: "农工商",
        privileges: ["可买卖土地", "可从军晋升"],
        restrictions: ["赋税、徭役", "服色限制"],
        percentage: "约90%",
      },
      {
        name: "奴婢",
        description: "官私奴婢",
        privileges: ["无"],
        restrictions: ["依附主人", "可买卖"],
      },
    ],
    genderRoles:
      "儒家礼教约束，但尚不严苛。女性可再嫁，太后可临朝称制。普通女性主内，但可参与家庭经济。",
    family: "宗法制，嫡长子继承。三从四德开始形成但尚未固化。",
    customs: [
      "席地而坐（无椅子）",
      "分餐制",
      "冠礼（男子成年）",
      "笄礼（女子成年）",
      "婚礼六礼",
      "丧服制度（斩衰、齐衰等）",
    ],
  },
  harem: {
    ranks: [
      {
        rank: 1,
        title: "皇后",
        count: 1,
        privileges: "正妻，母仪天下，居椒房殿",
      },
      { rank: 2, title: "夫人", privileges: "仅次于皇后" },
      { rank: 3, title: "美人", privileges: "可侍寝" },
      { rank: 4, title: "良人", privileges: "可侍寝" },
      { rank: 5, title: "八子", privileges: "可侍寝" },
      { rank: 6, title: "七子", privileges: "可侍寝" },
      { rank: 7, title: "长使", privileges: "可侍寝" },
      { rank: 8, title: "少使", privileges: "可侍寝" },
    ],
    management: "掖庭令、掖庭丞管理后宫事务",
    rules: [
      "皇后由皇帝册封，需太后同意",
      "妃嫔晋升由皇帝决定",
      "生育皇子可晋升",
      "妃嫔不可干预朝政（理论上）",
      "后宫有专门的服饰、器用规格",
    ],
  },
  economy: {
    agriculture: "铁犁牛耕推广，精耕细作，以粟（小米）为主粮",
    commerce: "盐铁官营，商人地位低但有富商大贾",
    currency: ["五铢钱（主要货币）", "黄金（大额交易）", "布帛（实物货币）"],
    taxation: "田租（三十税一）、人头税（口赋、算赋）、徭役",
  },
  culture: {
    literature: ["《史记》", "《楚辞》", "赋体文学", "乐府诗"],
    art: ["画像石", "漆器", "丝织", "玉器"],
    philosophy: ["儒学独尊", "黄老之学", "阴阳五行"],
    religion: ["祖先崇拜", "天地祭祀", "神仙方术"],
  },
  technology: [
    "造纸术萌芽",
    "铁器普及",
    "水利工程（都江堰扩建）",
    "丝绸之路开通",
    "天文历法（太初历）",
  ],
  dailyLife: {
    clothing: {
      male: ["深衣（直裾、曲裾）", "袍服", "襦", "裤（胫衣）", "履/舄"],
      female: ["深衣（曲裾为主）", "襦裙", "帔（披肩）"],
      colors: {
        royal: ["黄色（皇帝专用）", "紫色（尊贵）"],
        official: ["黑色（正式）", "红色（喜庆）"],
        common: ["白色", "青色", "褐色"],
        forbidden: ["黄色（庶民禁用）"],
      },
      accessories: [
        "冠（男，20种以上）",
        "笄（女，束发）",
        "佩玉",
        "印绶（官员）",
      ],
      notes: [
        "上衣下裳为正式礼服",
        "深衣为日常服饰",
        "交领右衽（左衽为夷狄或死者）",
      ],
    },
    food: {
      staples: ["粟（小米）", "麦", "稻（南方）", "豆"],
      meats: ["羊肉（最贵重）", "猪肉", "牛肉（少，牛用于耕作）", "鸡、鱼"],
      vegetables: ["葵（百菜之主）", "韭", "葱", "蒜", "萝卜"],
      seasonings: ["盐", "酱", "醋", "蜜", "花椒"],
      drinks: ["酒（米酒、黍酒）", "浆（发酵饮料）", "水"],
      tableware: ["漆器（贵）", "陶器", "铜器", "竹木器"],
      notes: [
        "无辣椒、番茄、玉米、花生（美洲作物）",
        "无炒菜（缺少植物油）",
        "以煮、蒸、烤为主",
        "无白砂糖（用蜜、饴糖）",
      ],
    },
    housing: "院落式建筑，坐北朝南。贵族多进院落。室内铺席坐卧，无椅凳。",
    transportation: ["牛车（尊贵）", "马车", "骑马", "驴车", "步行"],
    entertainment: ["六博（棋戏）", "投壶", "蹴鞠", "歌舞", "百戏", "狩猎"],
    etiquette: [
      "跪坐为正式坐姿",
      "作揖为常礼",
      "叩首为大礼",
      "见尊者需避席而立",
      "食不语",
    ],
  },
  honorifics: {
    emperor: {
      他称: "陛下、天子、圣上、皇上",
      自称: "朕、寡人",
    },
    empress: {
      太后: "太后、母后",
      皇后: "皇后、中宫",
      妃嫔: "娘娘、夫人",
    },
    officials: {
      尊称: "大人、明府、君",
      同辈: "君、足下",
      下属: "尔、汝",
    },
    common: {
      尊称: "君、公、先生、郎君、娘子",
      谦称: "鄙人、愚、仆、妾",
    },
    selfReferences: {
      皇帝: "朕",
      臣子: "臣",
      女性: "妾、奴婢",
      百姓: "小人、草民",
    },
  },
  taboos: [
    {
      type: "naming",
      description: "避讳皇帝名字",
      consequence: "可能被治罪",
      examples: ["汉武帝刘彻，需避'彻'字，改用'通'"],
    },
    {
      type: "dress",
      description: "不可僭越服色",
      consequence: "大不敬之罪",
      examples: ["庶民不可穿黄色", "非官员不可用绶带"],
    },
    {
      type: "behavior",
      description: "不可直视天子",
      consequence: "失仪之罪",
    },
    {
      type: "speech",
      description: "不可妄议朝政",
      consequence: "可能被治罪",
    },
  ],
  notableFigures: [
    {
      name: "刘邦",
      title: "汉高祖",
      period: "前256-前195",
      role: "开国皇帝",
      significance: "建立汉朝，奠定四百年基业",
    },
    {
      name: "刘彻",
      title: "汉武帝",
      period: "前156-前87",
      role: "第七位皇帝",
      significance: "独尊儒术，开拓疆土，开通丝绸之路",
      relatedEvents: ["罢黜百家独尊儒术", "征伐匈奴", "张骞出使西域"],
    },
    {
      name: "卫青",
      period: "?-前106",
      role: "将军、大司马",
      significance: "抗击匈奴名将，皇后卫子夫之弟",
    },
    {
      name: "霍去病",
      period: "前140-前117",
      role: "骠骑将军",
      significance: "少年名将，封狼居胥",
    },
    {
      name: "司马迁",
      period: "约前145-?",
      role: "史学家、文学家",
      significance: "著《史记》，被誉为'史家之绝唱'",
    },
  ],
  majorEvents: [
    {
      name: "楚汉之争",
      year: "前206-前202",
      description: "刘邦与项羽争夺天下",
      significance: "汉朝建立的过程",
    },
    {
      name: "白登之围",
      year: "前200",
      description: "刘邦被匈奴围困",
      significance: "此后采取和亲政策",
    },
    {
      name: "七国之乱",
      year: "前154",
      description: "七个诸侯王叛乱",
      significance: "加强中央集权",
    },
    {
      name: "罢黜百家独尊儒术",
      year: "前134",
      description: "汉武帝采纳董仲舒建议",
      significance: "儒学成为官方意识形态",
    },
    {
      name: "张骞出使西域",
      year: "前138/前119",
      description: "两次出使西域",
      significance: "开通丝绸之路",
    },
  ],
  terminology: {
    长安: "西汉都城，今陕西西安，当时世界最大城市之一",
    未央宫: "皇帝主要居住和办公的宫殿",
    长乐宫: "太后居所，也是重要政治场所",
    少府: "掌管皇室财物和宫廷手工业的机构",
    织染署: "少府下属，负责宫廷织染事务",
    尚方: "少府下属，制作御用器物",
    掖庭: "后宫管理机构，掖庭令为长官",
    暴室: "宫中惩罚宫人的场所，条件恶劣",
    椒房: "皇后居所（以椒和泥涂墙，取温暖多子之意）",
    东宫: "太子居所",
    诏书: "皇帝的命令文书",
    策书: "任命官员的文书",
    虎符: "调兵凭证，分为两半",
  },
  writingNotes: [
    "注意避讳：如写汉武帝时期，人物对话中不可直接说'彻'字",
    "称谓要准确：不同身份用不同称呼，不可混用",
    "无椅子：所有坐姿都是跪坐或盘腿坐",
    "无炒菜：烹饪方式以煮、蒸、烤为主",
    "无棉花：保暖主要靠丝绸、麻布夹层、皮毛",
    "货币单位：钱（铜钱）、金（黄金，以斤计）",
    "时间称呼：辰时、巳时等十二时辰",
    "女性地位：相对后世较高，但仍受礼教约束",
  ],
};

// ==================== 唐代 (618-907) ====================

export const TANG: Dynasty = {
  name: "唐代",
  aliases: ["唐朝", "李唐"],
  period: {
    start: 618,
    end: 907,
    description: "李渊建立，朱温篡位结束，共289年",
  },
  capitals: [
    {
      name: "长安",
      modernLocation: "陕西西安",
      period: "主都",
      description: "世界最大城市，人口约百万",
    },
    {
      name: "洛阳",
      modernLocation: "河南洛阳",
      period: "东都",
      description: "武则天时期为主都",
    },
  ],
  politics: {
    system: "中央集权的三省六部制",
    centralGov: {
      name: "三省六部制",
      description: "中书省草拟、门下省审核、尚书省执行",
      ranks: [
        {
          rank: 1,
          title: "同中书门下平章事",
          duties: "宰相，实际最高行政长官",
        },
        { rank: 2, title: "中书令", duties: "中书省长官，草拟诏令" },
        { rank: 2, title: "门下侍中", duties: "门下省长官，审核诏令" },
        { rank: 2, title: "尚书令", duties: "尚书省长官（后虚设）" },
        { rank: 3, title: "六部尚书", duties: "吏户礼兵刑工六部长官" },
      ],
    },
    localGov: "道-州-县三级制，道设节度使/观察使",
    military: "府兵制（前期）→募兵制（中后期），节度使掌地方军政",
    selection: "科举制为主（进士、明经等）+ 门荫制",
  },
  society: {
    classes: [
      {
        name: "皇族",
        description: "李姓皇室",
        privileges: ["封王", "食邑"],
        restrictions: ["受监控"],
      },
      {
        name: "士族",
        description: "五姓七望等门阀大族",
        privileges: ["婚姻网络", "文化资源"],
        restrictions: ["科举改变格局"],
      },
      {
        name: "官僚",
        description: "科举出身及门荫官员",
        privileges: ["俸禄", "免役"],
        restrictions: ["考课"],
      },
      {
        name: "庶民",
        description: "良人",
        privileges: ["可科举入仕", "可买卖土地"],
        restrictions: ["赋役"],
        percentage: "约85%",
      },
      {
        name: "贱民",
        description: "奴婢、部曲、杂户",
        privileges: ["无"],
        restrictions: ["依附主人"],
      },
    ],
    genderRoles:
      "唐代女性地位较高，可骑马、着胡服、参与社交。武则天称帝。但礼教约束仍在。",
    family: "宗法制，但个人自由度较高，女性可主动和离（离婚）。",
    customs: [
      "渐用椅凳（高坐）",
      "饮茶风尚",
      "胡风盛行（胡服、胡乐、胡食）",
      "节日众多（上元、寒食、重阳等）",
    ],
  },
  harem: {
    ranks: [
      { rank: 1, title: "皇后", count: 1, privileges: "正妻" },
      {
        rank: 2,
        title: "四妃（贵妃、淑妃、德妃、贤妃）",
        count: 4,
        privileges: "一品",
      },
      { rank: 3, title: "九嫔", count: 9, privileges: "二品" },
      { rank: 4, title: "婕妤", count: 9, privileges: "三品" },
      { rank: 5, title: "美人", count: 9, privileges: "四品" },
      { rank: 6, title: "才人", count: 9, privileges: "五品" },
      { rank: 7, title: "宝林等", privileges: "六品以下" },
    ],
    management: "内侍省、宫闱局管理",
    rules: [
      "后宫等级森严",
      "贵妃地位可超皇后（如杨贵妃）",
      "宫人出路：晋升、放出、出家",
    ],
  },
  economy: {
    agriculture: "均田制（前期）→土地兼并，水稻种植扩大",
    commerce: "商业繁荣，长安有东西两市，夜市出现（后期）",
    currency: ["开元通宝", "飞钱（汇票雏形）"],
    taxation: "租庸调制（前期）→两税法（780年后）",
  },
  culture: {
    literature: ["唐诗黄金时代", "传奇小说", "变文"],
    art: ["书法（颜真卿、柳公权）", "绘画（吴道子）", "乐舞", "雕塑"],
    philosophy: ["儒学复兴", "佛学鼎盛", "道教发展"],
    religion: ["佛教（禅宗、密宗）", "道教", "景教、祆教、摩尼教传入"],
  },
  technology: [
    "雕版印刷",
    "火药（军事应用）",
    "瓷器（越窑、邢窑）",
    "造船航海",
    "天文（僧一行）",
  ],
  dailyLife: {
    clothing: {
      male: ["圆领袍", "幞头", "靴"],
      female: ["襦裙", "半臂", "帔帛", "胡服", "高髻"],
      colors: {
        royal: ["黄色", "紫色"],
        official: [
          "紫（三品以上）",
          "绯（四五品）",
          "绿（六七品）",
          "青（八九品）",
        ],
        common: ["白", "皂"],
        forbidden: ["黄色（庶民禁用）"],
      },
      accessories: ["幞头", "玉带", "钗钿", "步摇"],
      notes: ["女性服饰开放", "胡服流行", "袒胸装一度盛行"],
    },
    food: {
      staples: ["面食（饼、面条）", "米", "粟"],
      meats: ["羊肉", "猪肉", "鱼", "鸡鸭"],
      vegetables: ["蔬菜品种丰富", "菠菜（菠薐）传入"],
      seasonings: ["盐", "酱", "醋", "糖（蔗糖普及）", "胡椒"],
      drinks: ["茶（陆羽《茶经》）", "酒", "乳酪"],
      tableware: ["瓷器普及", "金银器（贵族）"],
      notes: [
        "饼（各种面食总称）",
        "胡食流行（胡饼等）",
        "饮茶风尚形成",
        "无辣椒、番茄",
      ],
    },
    housing: "坊市制，贵族府邸有园林，渐用桌椅",
    transportation: ["马车", "牛车", "骑马（女性也可）", "骆驼（丝路）"],
    entertainment: ["诗酒唱和", "歌舞", "马球", "斗鸡", "博戏"],
    etiquette: ["渐用椅坐", "作揖叉手", "叩首"],
  },
  honorifics: {
    emperor: {
      他称: "陛下、圣人、大家、至尊",
      自称: "朕",
    },
    empress: {
      太后: "太后",
      皇后: "皇后、梓童",
      妃嫔: "娘娘、娘子",
    },
    officials: {
      宰相: "相公",
      上级: "大人、明公",
      同辈: "郎君、足下",
    },
    common: {
      男性: "郎君、郎",
      女性: "娘子、娘",
      长辈: "阿郎、阿娘",
    },
    selfReferences: {
      皇帝: "朕",
      臣子: "臣",
      女性: "妾、奴奴",
      百姓: "小的、某",
    },
  },
  taboos: [
    {
      type: "naming",
      description: "避讳皇帝名字及祖先名",
      consequence: "可能被治罪",
      examples: ["避'世'字（李世民）", "避'虎'字（李渊祖父李虎）"],
    },
    {
      type: "dress",
      description: "服色有等级规定",
      consequence: "僭越罪",
    },
  ],
  notableFigures: [
    {
      name: "李世民",
      title: "唐太宗",
      period: "598-649",
      role: "第二位皇帝",
      significance: "贞观之治，被尊为明君典范",
    },
    {
      name: "武则天",
      period: "624-705",
      role: "女皇帝",
      significance: "中国历史上唯一的女皇帝",
    },
    {
      name: "李白",
      period: "701-762",
      role: "诗人",
      significance: "诗仙，浪漫主义诗歌顶峰",
    },
    {
      name: "杜甫",
      period: "712-770",
      role: "诗人",
      significance: "诗圣，现实主义诗歌顶峰",
    },
    {
      name: "杨玉环",
      title: "杨贵妃",
      period: "719-756",
      role: "贵妃",
      significance: "四大美人之一，与玄宗故事流传",
    },
  ],
  majorEvents: [
    {
      name: "玄武门之变",
      year: "626",
      description: "李世民杀兄弟夺位",
      significance: "唐太宗即位",
    },
    {
      name: "贞观之治",
      year: "627-649",
      description: "唐太宗统治时期",
      significance: "盛世典范",
    },
    {
      name: "武周革命",
      year: "690-705",
      description: "武则天称帝",
      significance: "唯一女皇帝",
    },
    {
      name: "开元盛世",
      year: "713-741",
      description: "唐玄宗前期",
      significance: "唐朝鼎盛时期",
    },
    {
      name: "安史之乱",
      year: "755-763",
      description: "安禄山、史思明叛乱",
      significance: "唐朝由盛转衰的转折点",
    },
  ],
  terminology: {
    长安: "唐都，世界最大城市",
    大明宫: "唐代主要皇宫，含元殿、麟德殿等",
    坊市: "城市区划，坊为居住区，市为商业区",
    进士: "科举最高功名，最受尊崇",
    节度使: "地方军政长官，安史之乱后势力膨胀",
    翰林学士: "皇帝近臣，参与机要",
  },
  writingNotes: [
    "唐代开放包容，女性地位较高",
    "胡风盛行，可写胡人、胡商、胡乐",
    "饮茶习惯形成，可以此为背景",
    "诗歌是重要社交工具",
    "渐用桌椅，但跪坐仍存在",
    "长安是国际大都市，有各国商人、使节",
  ],
};

// ==================== 宋代 (960-1279) ====================

export const SONG_DYNASTY: Dynasty = {
  name: "宋代",
  aliases: ["宋朝", "赵宋", "北宋", "南宋"],
  period: {
    start: 960,
    end: 1279,
    description:
      "赵匡胤陈桥兵变建立，蒙古灭南宋结束，共319年（北宋167年，南宋152年）",
  },
  capitals: [
    {
      name: "汴京",
      modernLocation: "河南开封",
      period: "北宋都城（960-1127）",
      description: "人口超150万，当时世界最繁华城市",
    },
    {
      name: "东京",
      modernLocation: "河南开封",
      period: "北宋都城别称",
      description: "与汴京同指一地",
    },
    {
      name: "临安",
      modernLocation: "浙江杭州",
      period: "南宋都城（1138-1279）",
      description: "人口约百万，称'行在'（临时驻跸之意）",
    },
  ],
  politics: {
    system: "中央集权的文官政治",
    centralGov: {
      name: "二府三司制",
      description: "中书门下（政事堂）主政，枢密院管军，三司管财政",
      ranks: [
        {
          rank: 1,
          title: "同中书门下平章事",
          duties: "宰相，处理政务",
        },
        {
          rank: 1,
          title: "枢密使",
          duties: "掌管军事，与宰相并称'二府'",
        },
        {
          rank: 2,
          title: "参知政事",
          duties: "副宰相",
        },
        {
          rank: 2,
          title: "枢密副使",
          duties: "副枢密使",
        },
        {
          rank: 3,
          title: "三司使",
          duties: "掌管财政（盐铁、度支、户部三司）",
        },
        {
          rank: 4,
          title: "六部尚书",
          duties: "吏户礼兵刑工六部长官",
        },
        {
          rank: 5,
          title: "御史中丞",
          duties: "掌管监察",
        },
        {
          rank: 5,
          title: "翰林学士",
          duties: "掌管诏令、皇帝顾问",
        },
      ],
    },
    localGov: "路-州（府）-县三级制，路设转运使、提点刑狱、提举常平等多重监督",
    military:
      "禁军（中央）+ 厢军（地方），兵将分离，更戍法（定期换防），重文轻武",
    selection:
      "科举制高度发达（进士、明经、武举等），三年一次殿试，皇帝亲策，录取率较高",
  },
  society: {
    classes: [
      {
        name: "皇族",
        description: "赵姓皇室",
        privileges: ["封王封郡王", "优厚俸禄", "免死特权"],
        restrictions: ["不可干政", "不可掌握军权"],
      },
      {
        name: "士大夫",
        description: "科举出身的文官阶层",
        privileges: ["政治主导权", "高社会地位", "经济特权", "'刑不上大夫'"],
        restrictions: ["言行受儒家礼教约束"],
        percentage: "核心统治阶层",
      },
      {
        name: "官僚",
        description: "各级官员（包括胥吏）",
        privileges: ["俸禄", "免役", "优先子弟入仕"],
        restrictions: ["考课制度", "回避制度"],
      },
      {
        name: "士人",
        description: "读书人、应试者",
        privileges: ["社会尊重", "科举入仕机会"],
        restrictions: ["需遵守礼教"],
      },
      {
        name: "农民",
        description: "自耕农、佃农",
        privileges: ["相对自由（无依附关系）"],
        restrictions: ["赋税、徭役"],
        percentage: "约70%",
      },
      {
        name: "工商",
        description: "手工业者、商人",
        privileges: ["经济活跃", "城市居住", "商业地位提升"],
        restrictions: ["仍受身份歧视", "税负较重"],
        percentage: "约20%",
      },
      {
        name: "奴婢",
        description: "官私奴婢（数量减少）",
        privileges: ["无"],
        restrictions: ["依附主人"],
        percentage: "约5%（较前朝大幅减少）",
      },
    ],
    genderRoles:
      "程朱理学兴起，'饿死事小失节事极大'观念形成，女性地位下降。贞节观念强化，寡妇再嫁受限。但北宋早期仍较宽松，南宋后趋严。缠足开始流行（上层社会）。",
    family:
      "宗法制，嫡长子继承。宗族组织发达，族规、族田普遍。女性出嫁后仍可继承娘家财产（部分）。",
    customs: [
      "高坐（椅凳普及）",
      "分餐向合餐过渡",
      "缠足习俗兴起（北宋后期）",
      "茶文化鼎盛",
      "理学影响日常礼仪",
      "瓦舍勾栏（娱乐场所）",
      "上元节赏灯",
      "清明踏青",
    ],
  },
  harem: {
    ranks: [
      {
        rank: 1,
        title: "皇后",
        count: 1,
        privileges: "正妻，掌六宫，居中宫",
      },
      {
        rank: 2,
        title: "贵妃",
        privileges: "正一品，仅次于皇后",
      },
      {
        rank: 3,
        title: "淑妃、德妃、贤妃",
        privileges: "正一品",
      },
      {
        rank: 4,
        title: "夫人（贵、淑、德、贤）",
        privileges: "从一品",
      },
      {
        rank: 5,
        title: "婕妤",
        count: 9,
        privileges: "正二品",
      },
      {
        rank: 6,
        title: "美人",
        count: 9,
        privileges: "正三品",
      },
      {
        rank: 7,
        title: "才人",
        count: 9,
        privileges: "正四品",
      },
      {
        rank: 8,
        title: "贵人",
        privileges: "正五品",
      },
    ],
    management: "内命妇管理，设女官（尚宫、尚仪、尚服等）",
    rules: [
      "皇后册封需太后同意",
      "妃嫔晋升由皇帝决定，生皇子可晋升",
      "宋代后宫管理较前朝严格",
      "外戚势力受控制（汲取前朝教训）",
      "宫人不可干政（有明文规定）",
    ],
  },
  economy: {
    agriculture: "水稻种植技术提升（占城稻推广），精耕细作，南方经济超越北方",
    commerce:
      "商业革命，夜市、晓市普及，打破坊市制，城市经济繁荣，海外贸易发达（市舶司管理）",
    currency: [
      "铜钱（开元通宝等）",
      "交子（世界最早纸币，1024年官方发行）",
      "会子（南宋纸币）",
      "白银（大额交易）",
    ],
    taxation: "两税法，后改为募役法、方田均税法等（王安石变法）",
  },
  culture: {
    literature: [
      "词的黄金时代（苏轼、辛弃疾、李清照）",
      "话本小说兴起",
      "诗歌（与唐诗不同风格）",
      "史学（《资治通鉴》）",
    ],
    art: [
      "山水画（范宽、郭熙）",
      "书法（苏黄米蔡）",
      "瓷器（汝窑、官窑、哥窑、钧窑、定窑五大名窑）",
    ],
    philosophy: ["理学（程朱理学）", "心学萌芽", "儒学复兴"],
    religion: ["佛教（禅宗为主）", "道教", "儒释道三教合流"],
  },
  technology: [
    "活字印刷术（毕昇，1041-1048）",
    "指南针（罗盘用于航海）",
    "火药武器（火炮、火箭、火枪）",
    "水运仪象台（苏颂）",
    "沈括《梦溪笔谈》（科学百科）",
    "造船技术（尖底海船）",
    "纺织技术（丝绸、棉布）",
  ],
  dailyLife: {
    clothing: {
      male: [
        "襕衫（文人常服）",
        "直裰",
        "道袍",
        "圆领袍",
        "幞头（各式，如直脚幞头）",
        "靴",
      ],
      female: [
        "褙子（宋代特色，对襟长衫）",
        "襦裙",
        "抹胸",
        "大袖衫（礼服）",
        "背心",
        "裹脚布（缠足）",
      ],
      colors: {
        royal: ["赭黄色（皇帝专用）", "紫色"],
        official: [
          "紫色（三品以上）",
          "绯色（红色，四五品）",
          "绿色（六七品）",
          "青色（八九品）",
        ],
        common: ["白色", "青色", "褐色", "黑色"],
        forbidden: ["赭黄色（庶民禁用）", "明黄色"],
      },
      accessories: [
        "幞头（男）",
        "玉带（高官）",
        "冠（女，各式）",
        "步摇（女）",
        "扇子（折扇北宋末开始流行）",
      ],
      notes: [
        "服饰趋于简朴（相较唐代）",
        "褙子为宋代特色",
        "文人尚素雅",
        "缠足影响女性服饰",
      ],
    },
    food: {
      staples: ["米饭（南方主流）", "面食（北方主流：馒头、包子、面条）", "粥"],
      meats: [
        "羊肉（最受欢迎，北宋宫廷主要肉食）",
        "猪肉（平民主要肉食，东坡肉）",
        "鱼虾（沿海地区）",
        "鸡鸭鹅",
      ],
      vegetables: ["各类蔬菜", "笋", "茄子", "黄瓜", "萝卜", "白菜"],
      seasonings: [
        "盐",
        "酱油（酱）",
        "醋",
        "糖（蔗糖普及）",
        "花椒",
        "姜",
        "葱",
        "蒜",
      ],
      drinks: [
        "茶（点茶法，斗茶盛行）",
        "酒（黄酒、烧酒开始出现）",
        "果子汁",
        "饮子（药饮）",
      ],
      tableware: [
        "瓷器（主流，各大名窑）",
        "漆器",
        "金银器（贵族）",
        "筷子",
        "勺",
      ],
      notes: [
        "炒菜技术成熟（植物油普及）",
        "川菜雏形出现",
        "东坡肉、涮羊肉等名菜",
        "食肆餐馆发达，有菜单",
        "无辣椒、番茄、玉米、土豆",
        "点心文化发达",
      ],
    },
    housing:
      "城市打破坊市制，临街而建。官僚宅邸有园林。平民多瓦房。室内用桌椅。",
    transportation: [
      "马车（官员）",
      "牛车",
      "轿子（开始流行）",
      "骑马",
      "船（江南普遍）",
      "步行",
    ],
    entertainment: [
      "瓦舍勾栏（听书、看戏）",
      "相扑",
      "蹴鞠",
      "斗茶",
      "赏花",
      "词社诗会",
      "傀儡戏",
      "杂剧",
    ],
    etiquette: [
      "作揖（拱手礼）",
      "叩首（大礼）",
      "万福（女性礼）",
      "椅坐为主（跪坐基本消失）",
      "儒家礼教影响深（特别是南宋）",
      "宴饮礼仪复杂",
    ],
  },
  honorifics: {
    emperor: {
      他称: "陛下、官家（宋代特色）、圣上、万岁",
      自称: "朕、寡人",
    },
    empress: {
      太后: "太后、太皇太后",
      皇后: "皇后、中宫娘娘",
      妃嫔: "娘娘",
    },
    officials: {
      宰相: "相公、阁老",
      上级: "大人、老爷、相公",
      同辈: "学士、郎中、员外",
      下属: "你、尔",
    },
    common: {
      男性尊称: "官人、郎君、相公、客官",
      女性尊称: "娘子、小娘子、孺人",
      长辈: "公公、婆婆、老爷、太太",
      谦称: "小人、草民、晚生、学生",
    },
    selfReferences: {
      皇帝: "朕",
      臣子: "臣、下官、卑职",
      女性: "妾、奴家",
      百姓: "小人、草民、小的",
      文人: "学生、晚生、某（自称姓氏）",
    },
  },
  taboos: [
    {
      type: "naming",
      description: "避讳皇帝及祖先名讳",
      consequence: "可能被治罪，但宋代相对宽松",
      examples: ["避'匡'字（赵匡胤）改为'正'", "避'敬'字（赵敬）改为'恭'"],
    },
    {
      type: "dress",
      description: "服色等级严格",
      consequence: "僭越罪",
      examples: ["庶民不可穿黄色", "官服颜色严格对应品级"],
    },
    {
      type: "behavior",
      description: "女性贞节观念强化",
      consequence: "社会舆论压力",
      examples: ["寡妇再嫁受歧视（尤其南宋）", "失节被鄙视"],
    },
    {
      type: "speech",
      description: "不可妄议朝政（相对宽松）",
      consequence: "可能被贬谪",
      examples: ["文人可上书言事", "但直言可能遭贬"],
    },
  ],
  notableFigures: [
    {
      name: "赵匡胤",
      title: "宋太祖",
      period: "927-976",
      role: "北宋开国皇帝",
      significance: "陈桥兵变黄袍加身，建立宋朝，杯酒释兵权",
      relatedEvents: ["陈桥兵变", "杯酒释兵权"],
    },
    {
      name: "赵光义",
      title: "宋太宗",
      period: "939-997",
      role: "第二位皇帝",
      significance: "统一全国（灭北汉、南唐），推进文治",
    },
    {
      name: "王安石",
      period: "1021-1086",
      role: "宰相、改革家",
      significance: "主持熙宁变法，推行新法",
      relatedEvents: ["熙宁变法"],
    },
    {
      name: "司马光",
      period: "1019-1086",
      role: "史学家、政治家",
      significance: "编纂《资治通鉴》，反对王安石变法",
    },
    {
      name: "苏轼",
      title: "苏东坡",
      period: "1037-1101",
      role: "文学家、书画家",
      significance: "宋词豪放派代表，唐宋八大家之一",
    },
    {
      name: "岳飞",
      period: "1103-1142",
      role: "抗金名将",
      significance: "精忠报国，抗击金军，被秦桧陷害",
      relatedEvents: ["郾城大捷", "风波亭冤案"],
    },
    {
      name: "秦桧",
      period: "1090-1155",
      role: "宰相",
      significance: "主和派代表，陷害岳飞，历史上负面人物",
    },
    {
      name: "赵构",
      title: "宋高宗",
      period: "1107-1187",
      role: "南宋开国皇帝",
      significance: "靖康之变后建立南宋",
    },
    {
      name: "李清照",
      period: "1084-约1155",
      role: "女词人",
      significance: "宋词婉约派代表，'千古第一才女'",
    },
    {
      name: "辛弃疾",
      period: "1140-1207",
      role: "词人、将领",
      significance: "宋词豪放派代表，抗金志士",
    },
    {
      name: "朱熹",
      period: "1130-1200",
      role: "理学家",
      significance: "集理学大成，影响后世数百年",
    },
    {
      name: "文天祥",
      period: "1236-1283",
      role: "抗元名臣",
      significance: "宁死不降蒙古，'人生自古谁无死，留取丹心照汗青'",
    },
  ],
  majorEvents: [
    {
      name: "陈桥兵变",
      year: "960",
      description: "赵匡胤被部下拥立称帝",
      significance: "北宋建立",
      relatedFigures: ["赵匡胤"],
    },
    {
      name: "杯酒释兵权",
      year: "961",
      description: "赵匡胤解除开国功臣兵权",
      significance: "确立文治武功的国策",
      relatedFigures: ["赵匡胤"],
    },
    {
      name: "澶渊之盟",
      year: "1004",
      description: "宋辽订立和约，宋每年给辽岁币",
      significance: "宋辽百年和平",
    },
    {
      name: "熙宁变法",
      year: "1069-1085",
      description: "王安石主持的改革",
      significance: "试图富国强兵，但引发党争",
      relatedFigures: ["王安石", "司马光"],
    },
    {
      name: "靖康之变",
      year: "1127",
      description: "金军攻陷汴京，徽钦二帝被俘",
      significance: "北宋灭亡，南宋建立",
      relatedFigures: ["赵构"],
    },
    {
      name: "郾城大捷",
      year: "1140",
      description: "岳飞大败金军",
      significance: "南宋抗金最大胜利",
      relatedFigures: ["岳飞"],
    },
    {
      name: "绍兴和议",
      year: "1141",
      description: "宋金订立和约，宋称臣纳贡",
      significance: "确立南宋偏安局面",
      relatedFigures: ["秦桧"],
    },
    {
      name: "风波亭冤案",
      year: "1142",
      description: "岳飞被秦桧陷害处死",
      significance: "主战派失势，影响抗金大局",
      relatedFigures: ["岳飞", "秦桧"],
    },
    {
      name: "崖山海战",
      year: "1279",
      description: "南宋最后抵抗，陆秀夫背幼帝跳海",
      significance: "南宋灭亡，蒙古统一中国",
      relatedFigures: ["文天祥"],
    },
  ],
  terminology: {
    汴京: "北宋都城，今河南开封，又称东京",
    临安: "南宋都城，今浙江杭州，称'行在'",
    官家: "宋代对皇帝的特殊称呼",
    相公: "对宰相或有地位男性的称呼",
    娘子: "对女性的尊称",
    瓦舍: "娱乐场所",
    勾栏: "瓦舍内的演出场地",
    话本: "说书人的底本，小说雏形",
    交子: "世界最早纸币，北宋1024年官方发行",
    会子: "南宋纸币",
    榷场: "宋与辽、金、西夏的边境贸易市场",
    市舶司: "管理海外贸易的机构",
    岁币: "宋给辽、金的年贡",
    理学: "程朱理学，强调'天理'",
    书院: "私人讲学场所（岳麓书院、白鹿洞书院等）",
    进士: "科举最高功名",
    殿试: "皇帝亲自主持的考试",
    靖康: "宋钦宗年号，靖康之变因此得名",
    绍兴: "宋高宗年号",
  },
  writingNotes: [
    "注意区分北宋（960-1127）和南宋（1127-1279）的差异",
    "北宋都城在汴京（开封），南宋在临安（杭州）",
    "宋代称皇帝为'官家'是特色",
    "商业文化发达，可写城市生活、夜市、瓦舍等",
    "理学影响深远，特别是南宋，女性贞节观念强化",
    "缠足在上层社会流行，但非普遍",
    "科举制度成熟，文人地位高",
    "炒菜技术成熟，饮食文化丰富",
    "已有椅凳，无需跪坐",
    "词是主流文学形式，可作为人物才艺",
    "茶文化鼎盛，斗茶、点茶",
    "瓷器工艺登峰造极（五大名窑）",
    "纸币（交子、会子）已流通",
    "火药武器已使用",
    "无辣椒、番茄、土豆、玉米（美洲作物）",
    "无烟草",
    "南宋面临外族威胁（金、蒙古），有家国情怀主题",
  ],
};

// ==================== 明代 (1368-1644) ====================

export const MING_DYNASTY: Dynasty = {
  name: "明代",
  aliases: ["明朝", "朱明", "大明"],
  period: {
    start: 1368,
    end: 1644,
    description: "朱元璋建立,李自成攻入北京结束,共276年",
  },
  capitals: [
    {
      name: "南京",
      modernLocation: "江苏南京",
      period: "1368-1421",
      description: "明初都城,朱元璋定都于此",
    },
    {
      name: "北京",
      modernLocation: "北京",
      period: "1421-1644",
      description: "永乐迁都,紫禁城为皇宫",
    },
  ],
  politics: {
    system: "中央集权的君主专制",
    centralGov: {
      name: "废丞相、设内阁",
      description: "废除宰相,皇帝直接统领六部。内阁辅臣为顾问,无正式宰相职权",
      ranks: [
        {
          rank: 1,
          title: "内阁大学士(首辅)",
          duties: "票拟政务,辅佐皇帝,实际宰相职能",
        },
        {
          rank: 2,
          title: "六部尚书",
          duties: "吏户礼兵刑工六部长官,直接对皇帝负责",
        },
        { rank: 3, title: "都察院都御史", duties: "最高监察长官,监察百官" },
        { rank: 3, title: "大理寺卿", duties: "最高司法长官" },
        { rank: 4, title: "通政司通政使", duties: "掌章奏文书" },
        { rank: 4, title: "詹事府詹事", duties: "辅导太子" },
        { rank: 5, title: "锦衣卫指挥使", duties: "皇帝亲军,兼司侦缉" },
        { rank: 5, title: "东厂/西厂提督", duties: "宦官特务机构" },
      ],
    },
    localGov:
      "省-府-县三级制,布政使司(民政)、按察使司(监察)、都指挥使司(军政)三司分权",
    military: "卫所制:军户世袭,分散驻防。后期募兵制(戚继光练兵)",
    selection: "科举制:童试-乡试-会试-殿试。八股取士(严格格式)",
  },
  society: {
    classes: [
      {
        name: "皇族",
        description: "朱姓宗室",
        privileges: ["封王(亲王、郡王)", "俸禄", "免税"],
        restrictions: ["不可入仕", "不可经商", "需守祖训"],
      },
      {
        name: "勋贵",
        description: "开国功臣及其后代",
        privileges: ["世袭爵位(公、侯、伯)", "食禄", "恩荫子弟"],
        restrictions: ["受监控", "无实权(中后期)"],
      },
      {
        name: "士人(士大夫)",
        description: "科举出身的官员和读书人",
        privileges: ["入仕为官", "免徭役", "见官不跪"],
        restrictions: ["受文字狱威胁", "需守礼教"],
      },
      {
        name: "商人",
        description: "工商业者",
        privileges: ["可积累财富", "后期地位提升"],
        restrictions: [
          "不可穿丝绸(初期)",
          "子弟不可科举(理论上)",
          "地位低于士农",
        ],
      },
      {
        name: "农民",
        description: "占人口大多数",
        privileges: ["可拥有土地"],
        restrictions: ["赋税、徭役、服兵役"],
        percentage: "约85%",
      },
      {
        name: "贱民",
        description: "乐户、丐户、奴婢",
        privileges: ["无"],
        restrictions: ["世袭身份", "不可科举"],
      },
    ],
    genderRoles:
      "程朱理学严格约束,女性地位较低。'饿死事小,失节事大'。但民间女性可参与生产劳动,市井女性有一定自由。",
    family:
      "宗族制度完备,族谱、祠堂、族规。嫡长子继承。女性守寡需守节,改嫁受歧视。",
    customs: [
      "完全高坐(桌椅普及)",
      "饮茶(散茶冲泡)",
      "戏曲(昆曲、地方戏)",
      "节日(春节、元宵、清明、端午、中秋、重阳等)",
      "婚礼(明媒正娶、花轿)",
      "丧礼(守孝三年)",
    ],
  },
  harem: {
    ranks: [
      {
        rank: 1,
        title: "皇后",
        count: 1,
        privileges: "正宫,母仪天下,居坤宁宫",
      },
      {
        rank: 2,
        title: "皇贵妃",
        privileges: "仅次于皇后,可代理后宫",
      },
      {
        rank: 3,
        title: "贵妃",
        privileges: "一品,享受高规格待遇",
      },
      {
        rank: 4,
        title: "妃",
        privileges: "二品",
      },
      {
        rank: 5,
        title: "嫔",
        privileges: "三品",
      },
      {
        rank: 6,
        title: "贵人",
        privileges: "四品",
      },
      {
        rank: 7,
        title: "常在",
        privileges: "五品",
      },
      {
        rank: 8,
        title: "答应",
        privileges: "六品",
      },
    ],
    management: "司礼监(宦官)和六宫尚宫协同管理,皇后总摄后宫",
    rules: [
      "皇后册封需经廷议,多为勋贵或大臣之女",
      "妃嫔多选自民间秀女(三年一选)",
      "生育皇子可晋封",
      "不可干政(严禁宦官外戚专权)",
      "皇帝驾崩,妃嫔需守宫,无子者可出家",
    ],
  },
  economy: {
    agriculture: "精耕细作,推广水稻、棉花。江南鱼米之乡。徐光启《农政全书》",
    commerce:
      "商品经济发达,出现资本主义萌芽。江南纺织业、景德镇瓷器。海禁→隆庆开海",
    currency: ["白银(主要货币,一条鞭法后)", "铜钱", "宝钞(纸币,早期)"],
    taxation: "一条鞭法(1581):赋役合一,折银征收",
  },
  culture: {
    literature: [
      "四大名著(《西游记》《水浒传》《三国演义》《金瓶梅》)",
      "小说繁荣(话本、章回体)",
      "《永乐大典》《本草纲目》",
      "八股文(科举)",
    ],
    art: [
      "青花瓷(景德镇)",
      "书法(董其昌、文徵明、祝允明)",
      "绘画(吴门画派、浙派)",
      "昆曲(汤显祖《牡丹亭》)",
    ],
    philosophy: [
      "程朱理学(官方意识形态)",
      "王阳明心学(知行合一、致良知)",
      "李贽异端思想",
    ],
    religion: ["佛教(仍盛行)", "道教", "民间信仰", "天主教传入(利玛窦)"],
  },
  technology: [
    "《本草纲目》(李时珍,1596)",
    "《天工开物》(宋应星,1637)",
    "《农政全书》(徐光启)",
    "郑和下西洋(造船航海技术)",
    "火器(火铳、佛朗机、红夷大炮)",
    "地图测绘(《坤舆万国全图》)",
  ],
  dailyLife: {
    clothing: {
      male: [
        "官服:蟒袍、补服(文官补子绣鸟、武官绣兽)",
        "常服:直裰、道袍、圆领袍",
        "乌纱帽(官员)",
        "四方平定巾(文人)",
      ],
      female: [
        "襦裙(上袄下裙)",
        "袄裙、褙子",
        "明制汉服(交领、琵琶袖)",
        "凤冠霞帔(礼服)",
      ],
      colors: {
        royal: ["明黄色(皇帝)", "金黄色(皇太子)"],
        official: ["蟒袍:红、蓝、绿等(按品级)", "补子颜色区分品级"],
        common: ["蓝、灰、褐", "白色(丧服)"],
        forbidden: ["明黄色(庶民禁用)", "玄色(祭服)"],
      },
      accessories: [
        "官帽(乌纱帽、梁冠)",
        "女性发饰(簪、钗、步摇、头花)",
        "玉佩、香囊",
        "腰带(犀带、玉带、金带)",
      ],
      notes: [
        "补子制度:文官绣鸟(一品仙鹤、二品锦鸡等),武官绣兽(一品麒麟、二品狮子等)",
        "女性服饰华丽但保守,遮蔽严密",
        "缠足风气盛行(三寸金莲)",
      ],
    },
    food: {
      staples: [
        "大米(南方)",
        "小麦(北方)",
        "玉米(明中后期传入)",
        "番薯(救荒作物)",
      ],
      meats: ["猪肉(最常见)", "鸡鸭", "鱼虾", "羊肉", "牛肉(少,耕牛禁杀)"],
      vegetables: [
        "白菜、萝卜、茄子、黄瓜",
        "辣椒(明末传入)",
        "番茄、南瓜、土豆(明中后期传入)",
      ],
      seasonings: ["盐", "酱油", "醋", "糖", "花椒", "辣椒(明末)"],
      drinks: ["茶(散茶、饼茶)", "酒(黄酒、烧酒)", "豆浆"],
      tableware: ["瓷器(普及)", "银器(贵族)", "木筷、木碗(平民)"],
      notes: [
        "炒菜普及(植物油使用增加)",
        "饮食南北差异大",
        "宴席菜肴丰富",
        "辣椒明末才传入,不可早用",
        "玉米、番薯、土豆为美洲作物,明中后期引入",
      ],
    },
    housing:
      "北京四合院为典型。江南园林发达。砖木结构,坐北朝南。富裕人家多进院落。",
    transportation: [
      "轿子(官员、贵族)",
      "马车",
      "骑马",
      "驴车",
      "船(江南)",
      "步行",
    ],
    entertainment: [
      "戏曲(昆曲、弋阳腔、梆子)",
      "说书",
      "棋琴书画",
      "斗蟋蟀、斗鸡",
      "蹴鞠",
      "赏花、雅集",
    ],
    etiquette: [
      "作揖(拱手礼)",
      "跪拜(叩首,见长辈、上级)",
      "万福(女性礼节)",
      "见皇帝行五拜三叩头礼",
      "晚辈对长辈请安",
    ],
  },
  honorifics: {
    emperor: {
      他称: "陛下、万岁爷、皇上、圣上、天子",
      自称: "朕、孤",
    },
    empress: {
      太后: "太后、圣母皇太后",
      皇后: "皇后、中宫娘娘",
      妃嫔: "娘娘、贵妃娘娘",
    },
    officials: {
      内阁大学士: "阁老、中堂、老师(皇帝称)",
      尚书: "大人、老爷",
      同僚: "老兄、仁兄、台兄",
      下属: "本官、老爷",
    },
    common: {
      尊称男性: "老爷、相公、郎君、官人",
      尊称女性: "夫人、娘子、小姐",
      自称: "在下、小人、草民、晚生",
      谦称女性: "妾身、奴家",
    },
    selfReferences: {
      皇帝: "朕",
      臣子: "臣、微臣",
      太监: "奴婢、老奴",
      女性: "妾、奴婢",
      百姓: "草民、小民、小的",
    },
  },
  taboos: [
    {
      type: "naming",
      description: "避讳皇帝及祖先名讳",
      consequence: "可能被治大不敬之罪",
      examples: ["朱元璋名'元璋','元'字需避讳", "朱棣名'棣',需改用'第'"],
    },
    {
      type: "speech",
      description: "文字狱严酷",
      consequence: "轻则充军,重则凌迟处死",
      examples: [
        "诗文中涉嫌讽刺朝廷",
        "疑似影射'僧'(朱元璋曾为僧)、'光'(朱元璋曾为'光头')",
        "写'则'(似'贼')、'生'(似'僧')",
      ],
    },
    {
      type: "dress",
      description: "服色品级严格",
      consequence: "僭越罪",
      examples: ["庶民不可穿明黄", "非官员不可用补子"],
    },
    {
      type: "behavior",
      description: "礼教严格,女性守节",
      consequence: "社会舆论压力,家族惩罚",
      examples: ["寡妇改嫁受歧视", "女性抛头露面受非议"],
    },
    {
      type: "other",
      description: "宦官干政禁忌",
      consequence: "名义上严禁,实际中后期宦官专权严重",
      examples: ["刘瑾、魏忠贤专权"],
    },
  ],
  notableFigures: [
    {
      name: "朱元璋",
      title: "明太祖",
      period: "1328-1398",
      role: "开国皇帝",
      significance:
        "推翻元朝,建立明朝。废除丞相,加强君权。制定《大明律》《皇明祖训》",
      relatedEvents: ["洪武之治", "废除丞相", "文字狱"],
    },
    {
      name: "朱棣",
      title: "明成祖(永乐帝)",
      period: "1360-1424",
      role: "第三位皇帝",
      significance: "迁都北京,修建紫禁城。派郑和下西洋。编纂《永乐大典》",
      relatedEvents: ["靖难之役", "郑和下西洋", "迁都北京"],
    },
    {
      name: "郑和",
      period: "1371-1433",
      role: "航海家、外交家",
      significance: "七下西洋,远航东南亚、南亚、西亚、东非",
      relatedEvents: ["郑和下西洋"],
    },
    {
      name: "张居正",
      period: "1525-1582",
      role: "内阁首辅",
      significance: "万历年间改革,推行一条鞭法,整顿吏治,加强中央集权",
      relatedEvents: ["张居正改革", "一条鞭法"],
    },
    {
      name: "王阳明",
      period: "1472-1529",
      role: "思想家、军事家",
      significance: "创立阳明心学,'知行合一'、'致良知'。平定宁王之乱",
      relatedEvents: ["平定宁王之乱", "阳明心学"],
    },
    {
      name: "戚继光",
      period: "1528-1588",
      role: "军事家",
      significance: "抗倭名将,创立戚家军。著《纪效新书》《练兵实纪》",
      relatedEvents: ["东南抗倭", "戚家军"],
    },
    {
      name: "李时珍",
      period: "1518-1593",
      role: "医药学家",
      significance: "著《本草纲目》,记载药物1892种,是中药学巨著",
    },
    {
      name: "徐光启",
      period: "1562-1633",
      role: "科学家、政治家",
      significance: "与利玛窦合作翻译《几何原本》,著《农政全书》,推广番薯",
    },
    {
      name: "利玛窦",
      period: "1552-1610",
      role: "传教士、学者",
      significance: "天主教在华传播先驱,引入西方科学知识,绘制《坤舆万国全图》",
    },
    {
      name: "魏忠贤",
      period: "1568-1627",
      role: "宦官",
      significance: "天启年间专权,称'九千岁',打击东林党人",
      relatedEvents: ["阉党专权", "东林党争"],
    },
    {
      name: "崇祯帝",
      title: "朱由检",
      period: "1611-1644",
      role: "末代皇帝",
      significance: "勤政但性急多疑,内忧外患下明朝灭亡,吊死煤山",
      relatedEvents: ["明朝灭亡", "李自成攻入北京"],
    },
  ],
  majorEvents: [
    {
      name: "靖难之役",
      year: "1399-1402",
      description: "燕王朱棣起兵夺侄子建文帝皇位",
      significance: "朱棣夺位成功,成为永乐帝,强化君主专制",
      relatedFigures: ["朱棣", "建文帝"],
    },
    {
      name: "郑和下西洋",
      year: "1405-1433",
      description: "郑和率船队七次远航,到达东南亚、南亚、西亚、东非",
      significance: "展示国力,建立朝贡体系,促进海外贸易和文化交流",
      relatedFigures: ["郑和", "朱棣"],
    },
    {
      name: "土木堡之变",
      year: "1449",
      description: "明英宗北征瓦剌,被俘,大将于谦力挽狂澜",
      significance: "明朝由盛转衰的转折点,于谦主持北京保卫战成功",
      relatedFigures: ["明英宗", "于谦"],
    },
    {
      name: "王阳明平宁王之乱",
      year: "1519",
      description: "宁王朱宸濠叛乱,王阳明仅用35天平定",
      significance: "显示王阳明军事才能,但功高震主,遭猜忌",
      relatedFigures: ["王阳明", "宁王朱宸濠"],
    },
    {
      name: "嘉靖倭乱",
      year: "1547-1565",
      description: "东南沿海倭寇侵扰,戚继光、俞大猷抗倭",
      significance: "戚家军成名,沿海防御体系建立",
      relatedFigures: ["戚继光", "俞大猷"],
    },
    {
      name: "万历三大征",
      year: "1592-1600",
      description: "宁夏之役(1592)、朝鲜之役(1592-1598)、播州之役(1599-1600)",
      significance: "国力耗损严重,财政危机加剧",
    },
    {
      name: "张居正改革",
      year: "1572-1582",
      description: "推行一条鞭法、整顿吏治、清丈田亩",
      significance: "短暂中兴,但改革后遭清算",
      relatedFigures: ["张居正", "明神宗"],
    },
    {
      name: "东林党争",
      year: "1620年代",
      description: "东林党与阉党(魏忠贤)斗争",
      significance: "党争激烈,朝政混乱",
      relatedFigures: ["魏忠贤", "东林党人"],
    },
    {
      name: "萨尔浒之战",
      year: "1619",
      description: "明军大败于后金(努尔哈赤)",
      significance: "明朝对后金由攻转守,辽东防线崩溃",
      relatedFigures: ["努尔哈赤"],
    },
    {
      name: "明朝灭亡",
      year: "1644",
      description: "李自成攻入北京,崇祯帝自缢于煤山(景山)",
      significance: "明朝正式灭亡,清军入关",
      relatedFigures: ["崇祯帝", "李自成", "吴三桂"],
    },
  ],
  terminology: {
    紫禁城: "明清皇宫,位于北京中轴线,占地72万平方米",
    午门: "紫禁城正门,皇帝在此颁诏、受俘",
    太和殿: "紫禁城最大殿宇,举行大典",
    乾清宫: "皇帝寝宫(清代改为办公)",
    坤宁宫: "皇后寝宫",
    东厂: "宦官特务机构,监视臣民",
    西厂: "成化年间设立,后裁撤",
    锦衣卫: "皇帝侍卫兼特务机构,直属皇帝",
    内阁: "辅政机构,票拟政务,无正式宰相权",
    司礼监: "宦官二十四衙门之首,掌批红",
    六科: "给事中监察六部",
    都察院: "最高监察机关",
    翰林院: "负责编修、文学、顾问",
    八股文: "科举考试文体,分八部分,格式僵化",
    童试: "入学考试,过者为秀才",
    乡试: "省级考试,中者为举人",
    会试: "京城会考,中者为贡士",
    殿试: "皇帝主考,分一二三甲,前三名为状元、榜眼、探花",
    卫所制: "军户世袭,分散驻防,平时屯田",
    一条鞭法: "赋役合一,折银征收,简化税制",
    海禁: "禁止民间海外贸易(防倭寇、防走私)",
    隆庆开海: "1567年部分解除海禁",
  },
  writingNotes: [
    "明代称谓:'老爷'、'相公'普遍使用,女性称'小姐'、'娘子'",
    "礼节严格:见长辈官员需下跪叩首,不同于唐代开放",
    "服饰细节:补子制度是明代特色,文武官员区分明显",
    "文字狱:朱元璋时期极为严酷,涉及'僧'、'光'、'则'等字需谨慎",
    "缠足:明代缠足风气盛行,但农村劳动妇女不缠足",
    "饮食:辣椒明末才传入,早期不可使用。玉米、番薯、土豆为明中后期引入",
    "宦官:明代宦官权势极大,司礼监太监可'批红'(代皇帝批示)",
    "内阁:无正式宰相权,只能'票拟',最终决定权在皇帝",
    "科举:八股文格式僵化,束缚思想",
    "时间:可使用十二时辰或更(夜间五更)",
    "货币:白银为主要货币,一两银子约现在300-500元人民币购买力",
    "交通:江南水路发达,北方陆路为主,官员可坐轿(四人抬、八人抬)",
    "地理:南北差异大,江南富庶,北方农业为主",
    "思想:程朱理学为官方意识形态,但王阳明心学影响深远",
    "外来文化:天主教传入(利玛窦),西方科学知识开始传播",
    "社会风气:相对宋元更保守,但市民文化繁荣(小说、戏曲)",
  ],
};

// ==================== 清代 (1644-1912) ====================

export const QING_DYNASTY: Dynasty = {
  name: "清代",
  aliases: ["清朝", "大清", "满清"],
  period: {
    start: 1644,
    end: 1912,
    description: "满清入关建立,辛亥革命推翻,共268年",
  },
  capitals: [
    {
      name: "北京",
      modernLocation: "北京",
      period: "1644-1912",
      description: "沿用明代紫禁城,清代进一步扩建",
    },
    {
      name: "盛京",
      modernLocation: "辽宁沈阳",
      period: "1625-1644",
      description: "入关前都城,后为陪都",
    },
  ],
  politics: {
    system: "君主专制达到顶峰",
    centralGov: {
      name: "军机处(雍正后最高决策)",
      description:
        "军机处取代内阁,成为皇帝直接领导的最高决策机构。皇帝乾纲独断",
      ranks: [
        {
          rank: 1,
          title: "军机大臣",
          duties: "承旨办事,辅助皇帝处理军国大政",
        },
        { rank: 2, title: "六部尚书", duties: "吏户礼兵刑工六部长官,满汉各一" },
        { rank: 3, title: "内阁大学士", duties: "名义最高官职,实权下降" },
        { rank: 3, title: "都察院都御史", duties: "监察长官" },
        { rank: 4, title: "大理寺卿", duties: "司法审判" },
        { rank: 5, title: "理藩院", duties: "管理蒙古、西藏、新疆事务" },
        { rank: 6, title: "内务府总管", duties: "管理皇室事务" },
      ],
    },
    localGov: "省-府-县三级制,总督(跨省)、巡抚(省级)为封疆大吏。满汉分任",
    military: "八旗(满蒙汉)、绿营(汉军)。后期湘军淮军兴起",
    selection: "科举制:沿袭明制,八股取士。满人可另途入仕",
  },
  society: {
    classes: [
      {
        name: "皇族",
        description: "爱新觉罗氏宗室",
        privileges: [
          "封爵(亲王、郡王、贝勒、贝子、镇国公、辅国公)",
          "俸禄",
          "铁帽子王世袭",
        ],
        restrictions: ["不可科举入仕", "需遵皇家规矩"],
      },
      {
        name: "八旗贵族",
        description: "满洲八旗、蒙古八旗、汉军八旗",
        privileges: ["铁杆庄稼(俸禄)", "优先入仕", "不事生产"],
        restrictions: ["不得经商务农", "后期旗人贫困"],
      },
      {
        name: "士绅",
        description: "科举出身或捐纳获得功名者",
        privileges: ["免徭役", "见官不跪", "可穿戴功名服饰"],
        restrictions: ["需守礼教"],
      },
      {
        name: "平民",
        description: "农、工、商",
        privileges: ["可参加科举", "晚清地位提升"],
        restrictions: ["赋税、徭役"],
        percentage: "约90%",
      },
      {
        name: "贱民",
        description: "奴仆、乐户、丐户、惰民、疍民",
        privileges: ["无"],
        restrictions: ["世袭身份(雍正后逐渐放开)"],
      },
    ],
    genderRoles:
      "程朱理学影响深刻,女性地位低。'三从四德'严格执行。但满族女性不缠足,地位略高于汉族女性。太后(如慈禧)可垂帘听政。",
    family: "宗族制度,族谱、祠堂。满汉通婚(晚清放开)。嫡庶分明,嫡长子继承。",
    customs: [
      "剃发易服(满族发式,非满族强制)",
      "请安(打千,满式礼节)",
      "满汉全席(宫廷宴席)",
      "旗装(满族女性)",
      "节日(春节、元宵、清明、端午、中秋、重阳)",
    ],
  },
  harem: {
    ranks: [
      {
        rank: 1,
        title: "皇后",
        count: 1,
        privileges: "正宫,母仪天下,居坤宁宫(后改为祭祀)",
      },
      {
        rank: 2,
        title: "皇贵妃",
        count: 1,
        privileges: "副后,可代理后宫",
      },
      {
        rank: 3,
        title: "贵妃",
        count: 2,
        privileges: "一品",
      },
      {
        rank: 4,
        title: "妃",
        count: 4,
        privileges: "二品",
      },
      {
        rank: 5,
        title: "嫔",
        count: 6,
        privileges: "三品",
      },
      {
        rank: 6,
        title: "贵人",
        privileges: "四品,无定额",
      },
      {
        rank: 7,
        title: "常在",
        privileges: "五品,无定额",
      },
      {
        rank: 8,
        title: "答应",
        privileges: "六品,无定额",
      },
    ],
    management: "内务府管理,敬事房记录",
    rules: [
      "秀女选拔:三年一次,八旗女子必须参加",
      "皇后多出自满蒙贵族",
      "后妃不得干政(慈禧是例外)",
      "生育阿哥可晋封",
      "侍寝有严格规定(敬事房安排)",
    ],
  },
  economy: {
    agriculture: "推广玉米、番薯,人口激增(乾隆时期超3亿)。摊丁入亩",
    commerce: "闭关锁国(广州十三行),后期被迫开放通商口岸",
    currency: ["白银", "铜钱", "银票(晚清)"],
    taxation: "摊丁入亩(雍正):将丁税并入田赋,按田亩征收",
  },
  culture: {
    literature: [
      "《红楼梦》《聊斋志异》《儒林外史》",
      "考据学(乾嘉学派)",
      "《四库全书》(乾隆)",
      "京剧(道光、咸丰年间形成)",
    ],
    art: [
      "珐琅彩瓷、粉彩瓷",
      "书法(刘墉、翁同龢)",
      "绘画(四王、扬州八怪)",
      "京剧(程长庚、谭鑫培)",
    ],
    philosophy: [
      "程朱理学(官方)",
      "考据学(戴震、段玉裁)",
      "经世致用(魏源、龚自珍)",
    ],
    religion: ["佛教(藏传佛教受推崇)", "道教", "民间信仰", "基督教传入"],
  },
  technology: [
    "农业技术改进(玉米、番薯推广)",
    "《康熙字典》《古今图书集成》",
    "测绘(《皇舆全览图》)",
    "晚清洋务运动引进西方技术",
    "京张铁路(詹天佑)",
  ],
  dailyLife: {
    clothing: {
      male: [
        "朝服:蟒袍、补服(沿用明制补子)",
        "常服:马褂、长袍(旗装)",
        "辫子(剃发留辫)",
        "翎顶(官帽上的孔雀翎)",
        "顶戴(红蓝白水晶等区分品级)",
      ],
      female: [
        "旗装:旗袍雏形,宽大直筒",
        "汉族女性:上袄下裙",
        "花盆底(旗鞋)",
        "满族女性不缠足",
        "两把头、大拉翅(发式)",
      ],
      colors: {
        royal: ["明黄(皇帝)", "杏黄(皇太子)", "金黄(皇子)"],
        official: ["蟒袍颜色按品级", "朝珠、顶戴区分等级"],
        common: ["蓝、灰、褐", "白色(丧服)"],
        forbidden: ["明黄色(庶民禁用)"],
      },
      accessories: [
        "顶戴花翎",
        "朝珠(108颗)",
        "翎管",
        "扳指",
        "荷包",
        "女性头饰(点翠、珠花)",
      ],
      notes: [
        "剃发易服:满清强制推行,留头不留发,留发不留头",
        "马褂:清代特色服饰,满族骑射传统",
        "满汉服饰差异明显",
        "缠足:汉族女性仍盛行,满族禁止",
      ],
    },
    food: {
      staples: ["大米", "小麦", "玉米(已普及)", "番薯"],
      meats: ["猪肉", "羊肉", "鸡鸭鹅", "牛肉(满族可食)", "鱼虾"],
      vegetables: ["白菜、萝卜、茄子", "辣椒(已普及)", "土豆、番茄"],
      seasonings: ["盐", "酱油", "醋", "辣椒", "花椒", "糖"],
      drinks: ["茶", "酒(白酒已流行)", "奶茶(满蒙)"],
      tableware: ["瓷器(景德镇)", "银器", "铜器"],
      notes: [
        "满汉全席:清代宫廷宴席",
        "辣椒已普及使用",
        "玉米、番薯为救荒作物",
        "烤鸭、涮羊肉为北京名菜",
      ],
    },
    housing:
      "北京四合院,王府有规制。紫禁城规模更大。江南园林仍盛行。砖木结构。",
    transportation: [
      "轿子(官员)",
      "马车",
      "骑马",
      "人力车(晚清)",
      "火车(晚清)",
    ],
    entertainment: [
      "京剧(道光后成型)",
      "评书",
      "相声(晚清)",
      "围棋、象棋",
      "斗蟋蟀",
      "遛鸟",
      "逛庙会",
    ],
    etiquette: [
      "打千(满式单腿跪礼)",
      "请安(满式问候)",
      "三跪九叩(见皇帝)",
      "作揖(汉式)",
      "万福(女性)",
    ],
  },
  honorifics: {
    emperor: {
      他称: "万岁爷、皇上、圣上、主子",
      自称: "朕",
    },
    empress: {
      太后: "老佛爷(慈禧专用)、皇太后",
      皇后: "主子娘娘、皇后娘娘",
      妃嫔: "主子、娘娘",
    },
    officials: {
      军机大臣: "中堂、大人",
      总督巡抚: "大人、制台、抚台",
      知府知县: "大人、太爷",
      同僚: "老兄、年兄",
    },
    common: {
      尊称男性: "老爷、爷、爷们儿",
      尊称女性: "太太、奶奶、姑奶奶",
      自称: "奴才(旗人)、臣(汉臣)、小的、草民",
      仆人称主: "主子、老爷、太太",
    },
    selfReferences: {
      皇帝: "朕",
      旗人臣子: "奴才",
      汉臣: "臣",
      太监: "奴才",
      女性: "奴婢、婢子",
      百姓: "小的、草民",
    },
  },
  taboos: [
    {
      type: "naming",
      description: "避讳皇帝名字极为严格",
      consequence: "文字狱,可能满门抄斩",
      examples: ["康熙玄烨,'玄'字需改写", "雍正胤禛,'胤'字改为'允'"],
    },
    {
      type: "speech",
      description: "文字狱极为严酷",
      consequence: "株连九族,凌迟处死",
      examples: [
        "清风不识字,何故乱翻书(疑似反清)",
        "维止(疑似去掉雍正头)",
        "查嗣庭案、吕留良案",
      ],
    },
    {
      type: "dress",
      description: "剃发易服强制执行",
      consequence: "抗拒者杀无赦",
      examples: ["留头不留发,留发不留头", "嘉定三屠、扬州十日"],
    },
    {
      type: "behavior",
      description: "满汉界限",
      consequence: "社会歧视",
      examples: ["满汉不通婚(晚清放开)", "旗人不事生产"],
    },
    {
      type: "other",
      description: "反清复明",
      consequence: "灭族大罪",
      examples: ["天地会", "白莲教起义"],
    },
  ],
  notableFigures: [
    {
      name: "康熙帝",
      title: "爱新觉罗·玄烨",
      period: "1654-1722",
      role: "第四位皇帝(入关后第二位)",
      significance:
        "在位61年,平定三藩、收复台湾、驱逐沙俄(雅克萨)、三征准噶尔。编纂《康熙字典》",
      relatedEvents: ["平三藩", "收复台湾", "雅克萨之战"],
    },
    {
      name: "雍正帝",
      title: "爱新觉罗·胤禛",
      period: "1678-1735",
      role: "第五位皇帝",
      significance:
        "勤政改革,设军机处,推行摊丁入亩、火耗归公、改土归流。在位13年",
      relatedEvents: ["设立军机处", "摊丁入亩"],
    },
    {
      name: "乾隆帝",
      title: "爱新觉罗·弘历",
      period: "1711-1799",
      role: "第六位皇帝",
      significance:
        "在位60年(禅位后又3年),十全武功,编纂《四库全书》。清朝鼎盛时期,也是由盛转衰转折点",
      relatedEvents: ["十全武功", "编纂四库全书", "六下江南"],
    },
    {
      name: "慈禧太后",
      title: "叶赫那拉·杏贞",
      period: "1835-1908",
      role: "实际统治者(同治、光绪两朝)",
      significance: "垂帘听政近50年,掌控晚清政局。支持洋务运动,但镇压戊戌变法",
      relatedEvents: ["辛酉政变", "戊戌政变", "庚子国变"],
    },
    {
      name: "曾国藩",
      period: "1811-1872",
      role: "湘军统帅、理学大师",
      significance: "创建湘军镇压太平天国,开洋务运动先河",
      relatedEvents: ["平定太平天国", "洋务运动"],
    },
    {
      name: "李鸿章",
      period: "1823-1901",
      role: "淮军统帅、外交家",
      significance: "洋务运动主要推动者,签订多项不平等条约",
      relatedEvents: ["洋务运动", "《马关条约》", "《辛丑条约》"],
    },
    {
      name: "纪晓岚",
      title: "纪昀",
      period: "1724-1805",
      role: "学者、文学家",
      significance: "主持编纂《四库全书》,著《阅微草堂笔记》",
    },
    {
      name: "林则徐",
      period: "1785-1850",
      role: "政治家、民族英雄",
      significance: "虎门销烟,抵抗英国侵略",
      relatedEvents: ["虎门销烟", "鸦片战争"],
    },
    {
      name: "洪秀全",
      period: "1814-1864",
      role: "太平天国领袖",
      significance: "建立太平天国,持续14年,动摇清朝统治",
      relatedEvents: ["太平天国起义", "天京事变"],
    },
    {
      name: "溥仪",
      title: "宣统帝",
      period: "1906-1967",
      role: "末代皇帝",
      significance: "三岁登基,六岁逊位。后为满洲国傀儡皇帝,新中国公民",
      relatedEvents: ["辛亥革命", "清帝逊位"],
    },
  ],
  majorEvents: [
    {
      name: "清军入关",
      year: "1644",
      description: "吴三桂引清兵入关,击败李自成,定都北京",
      significance: "满清统一中国,建立全国政权",
      relatedFigures: ["多尔衮", "吴三桂", "顺治帝"],
    },
    {
      name: "平定三藩",
      year: "1673-1681",
      description: "康熙削藩,吴三桂等三藩叛乱,历经八年平定",
      significance: "加强中央集权,巩固统一",
      relatedFigures: ["康熙帝", "吴三桂"],
    },
    {
      name: "收复台湾",
      year: "1683",
      description: "施琅率军击败郑氏政权,台湾纳入清朝版图",
      significance: "台湾正式成为清朝领土",
      relatedFigures: ["康熙帝", "施琅"],
    },
    {
      name: "雅克萨之战",
      year: "1685-1686",
      description: "清军两次进攻雅克萨,驱逐沙俄侵略者",
      significance: "签订《尼布楚条约》,划定中俄边界",
      relatedFigures: ["康熙帝"],
    },
    {
      name: "文字狱高峰",
      year: "康雍乾三朝",
      description: "大量文字狱案件,知识分子受迫害",
      significance: "钳制思想,加强专制",
    },
    {
      name: "鸦片战争",
      year: "1840-1842",
      description: "英国发动战争,清军战败,签订《南京条约》",
      significance: "中国近代史开端,开始沦为半殖民地",
      relatedFigures: ["林则徐", "道光帝"],
    },
    {
      name: "太平天国运动",
      year: "1851-1864",
      description: "洪秀全领导农民起义,建立太平天国政权",
      significance: "动摇清朝统治,促进汉族地方势力崛起",
      relatedFigures: ["洪秀全", "曾国藩", "李鸿章"],
    },
    {
      name: "洋务运动",
      year: "1861-1894",
      description: "'自强''求富',引进西方技术,创办近代工业",
      significance: "中国近代化起步,但甲午战败证明改革失败",
      relatedFigures: ["曾国藩", "李鸿章", "左宗棠", "张之洞"],
    },
    {
      name: "甲午战争",
      year: "1894-1895",
      description: "中日战争,北洋舰队全军覆没,签订《马关条约》",
      significance: "割让台湾,赔款两亿两,民族危机空前严重",
      relatedFigures: ["李鸿章", "邓世昌"],
    },
    {
      name: "戊戌变法",
      year: "1898",
      description: "光绪帝支持维新派变法,百日后慈禧政变镇压",
      significance: "资产阶级改良运动失败,六君子遇难",
      relatedFigures: ["光绪帝", "康有为", "梁启超", "谭嗣同", "慈禧"],
    },
    {
      name: "庚子国变",
      year: "1900",
      description: "八国联军侵华,慈禧西逃,签订《辛丑条约》",
      significance: "赔款4.5亿两,中国完全沦为半殖民地",
      relatedFigures: ["慈禧", "光绪帝"],
    },
    {
      name: "辛亥革命",
      year: "1911",
      description: "武昌起义,各省响应,清朝覆灭",
      significance: "结束两千年帝制,建立中华民国",
      relatedFigures: ["孙中山", "黄兴", "袁世凯"],
    },
    {
      name: "清帝逊位",
      year: "1912年2月12日",
      description: "隆裕太后颁布退位诏书,清朝正式灭亡",
      significance: "中国最后一个封建王朝终结",
      relatedFigures: ["溥仪", "隆裕太后", "袁世凯"],
    },
  ],
  terminology: {
    紫禁城: "明清皇宫,清代沿用并扩建",
    养心殿: "雍正后皇帝主要居住办公场所",
    军机处: "雍正设立,最高决策机构",
    内务府: "管理皇室事务,规模庞大",
    八旗: "满洲、蒙古、汉军各八旗,是清朝军事和社会组织",
    绿营: "汉族军队,驻防各地",
    顶戴花翎: "清代官员帽饰,区分等级",
    朝珠: "高官佩戴的108颗珠串",
    满汉全席: "清代宫廷最高规格宴席",
    摊丁入亩: "雍正税制改革,丁税并入田赋",
    改土归流: "废除土司世袭,改派流官",
    秀女: "八旗女子选秀入宫制度",
    奴才: "旗人对皇帝自称(表示亲近)",
    总理衙门: "晚清处理外交事务机构",
    北洋: "晚清李鸿章系势力,北洋舰队、北洋军阀",
  },
  writingNotes: [
    "称谓:'奴才'是旗人自称(非贬义,表亲近),汉臣自称'臣'",
    "剃发易服:清初强制推行,但汉族抗争,有'嘉定三屠''扬州十日'",
    "满汉差异:旗人有俸禄(铁杆庄稼),不事生产;汉人多为农商",
    "女性:满族女性不缠足,穿旗装,地位略高于汉族女性",
    "后宫:秀女选拔严格,必须是八旗女子。宫廷规矩森严",
    "文字狱:康雍乾三朝极为严酷,任何疑似反清言论都可能招来杀身之祸",
    "晚清变局:鸦片战争后社会剧变,传统与现代碰撞",
    "礼节:打千(单膝跪)是满式礼节,三跪九叩见皇帝",
    "交通:晚清有火车、电报等现代事物出现",
    "货币:白银仍为主要货币,晚清出现银元、银票",
    "时间:可使用十二时辰,但晚清开始引入西式时间",
    "满语:宫廷内满汉双语,但满语逐渐衰落",
    "康雍乾盛世:清朝鼎盛时期,人口激增,疆域辽阔",
    "晚清民族矛盾:太平天国、义和团等运动反映社会矛盾",
    "外国势力:晚清被迫开放,租界、教堂、洋行出现",
  ],
};

// ==================== 导出 ====================

export const DYNASTIES: Record<string, Dynasty> = {
  西汉: WESTERN_HAN,
  唐代: TANG,
  宋代: SONG_DYNASTY,
  北宋: SONG_DYNASTY,
  南宋: SONG_DYNASTY,
  明代: MING_DYNASTY,
  明朝: MING_DYNASTY, // 别名
  清代: QING_DYNASTY,
  清朝: QING_DYNASTY, // 别名
  大清: QING_DYNASTY, // 别名
};

/**
 * 根据年份获取朝代
 */
export function getDynastyByYear(year: number): Dynasty | null {
  for (const dynasty of Object.values(DYNASTIES)) {
    if (year >= dynasty.period.start && year <= dynasty.period.end) {
      return dynasty;
    }
  }
  return null;
}

/**
 * 根据关键词检测朝代
 */
export function detectDynastyByKeywords(text: string): Dynasty | null {
  for (const [name, dynasty] of Object.entries(DYNASTIES)) {
    // 检查朝代名称
    if (text.includes(name)) return dynasty;
    // 检查别称
    for (const alias of dynasty.aliases) {
      if (text.includes(alias)) return dynasty;
    }
    // 检查都城
    for (const capital of dynasty.capitals) {
      if (text.includes(capital.name)) return dynasty;
    }
    // 检查重要人物
    for (const figure of dynasty.notableFigures) {
      if (text.includes(figure.name)) return dynasty;
    }
  }
  return null;
}
