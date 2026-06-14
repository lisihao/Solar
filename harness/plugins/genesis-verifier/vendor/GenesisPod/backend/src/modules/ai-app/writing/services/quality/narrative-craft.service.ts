/**
 * NarrativeCraftService - 叙事工艺服务
 *
 * 核心职责：
 * - 禁止"说教式写法"（Tell not Show）
 * - 禁止总结式结尾
 * - 确保对话自然（非NPC式）
 * - 确保动机逻辑链条完整
 *
 * 设计理念：
 * 网文常见的"AI味"问题：
 * 1. "她知道，XXX是XXX的象征" - 直接告诉读者主题
 * 2. "她意识到，这意味着..." - 用意识代替行动
 * 3. "只要能掌控这份力量，就能..." - 总结式结尾
 * 4. "奴婢名唤XX，小姐您是XX的女儿" - NPC读设定集
 *
 * 解决方案：
 * - 用动作/反应代替心理解读
 * - 用具体场景代替抽象议论
 * - 用对话冲突代替信息灌输
 * - 用悬念代替总结
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import type { AIModelType as _AIModelType } from "@prisma/client"; // 保留用于类型参考

// ==================== 禁止模式库 ====================

/**
 * 说教式写法禁止模式
 * 这些句式会让读者感觉被"教导"，破坏沉浸感
 */
const PREACH_PATTERNS = {
  // "她知道"类 - 直接告诉读者角色的认知
  awareness: {
    patterns: [
      "她知道，",
      "他知道，",
      "她明白，",
      "他明白，",
      "她意识到，",
      "他意识到，",
      "她清楚，",
      "他清楚，",
      "她深知，",
      "他深知，",
    ],
    problem: "直接告诉读者角色知道什么，而非通过行动展示",
    fix: "用角色的具体行动或生理反应来暗示其认知",
    examples: [
      {
        bad: "她知道，作为后宫女子，美丽是生存的基础。",
        good: "她的手指不自觉地摸上了脸颊——这张脸，是她在这深宫中唯一的筹码。",
      },
      {
        bad: "他知道，这场战斗将决定他的命运。",
        good: "他握紧刀柄，指节发白。",
      },
    ],
  },

  // "是...的象征"类 - 直接点明主题
  symbolism: {
    patterns: [
      "是权力的象征",
      "是生存的基础",
      "是地位的体现",
      "意味着死亡",
      "意味着失败",
      "代表着希望",
      "象征着自由",
    ],
    problem: "直接解释象征意义，剥夺读者的解读空间",
    fix: "让象征物通过情节自然展现其意义",
    examples: [
      {
        bad: "在这个时代，妆容是权力的象征。",
        good: "太后扫了一眼她素净的面容，嘴角微微下撇。殿内的宫女们立刻低下了头。",
      },
    ],
  },

  // "她/他+情绪形容词"类 - 直接描述情绪
  emotion_telling: {
    patterns: [
      "她很紧张",
      "他很愤怒",
      "她感到恐惧",
      "他感到兴奋",
      "她内心充满",
      "他心中涌起",
      "她的心情",
      "他的情绪",
    ],
    problem: "直接告诉读者角色的情绪，而非通过表现展示",
    fix: "用生理反应、微表情、下意识动作来展示情绪",
    examples: [
      {
        bad: "她很紧张，心跳加速。",
        good: "她的手指不自觉地揪紧了袖口，指甲陷进掌心。",
      },
      {
        bad: "他很愤怒。",
        good: "他的太阳穴突突直跳，握着酒杯的手青筋暴起。",
      },
    ],
  },

  // 总结式句式 - 在叙事中间插入总结
  mid_summary: {
    patterns: [
      "总之，",
      "总而言之，",
      "换句话说，",
      "也就是说，",
      "这说明，",
      "由此可见，",
      "不难看出，",
    ],
    problem: "在叙事中插入议论式总结，打断故事流",
    fix: "删除这些总结，让情节自己说话",
    examples: [
      {
        bad: "总之，她必须尽快适应这个环境。",
        good: "（直接删除，或转为具体行动）她推开窗，深吸一口陌生的空气。",
      },
    ],
  },

  // ★★★ AI写作典型陋习 - 检测典型的决心/感悟式写法
  ai_writing_cliche: {
    patterns: [
      // 内心独白式决心（最常见）
      "心中暗下决心",
      "心中暗暗决心",
      "暗暗发誓",
      "暗暗决定",
      "暗暗立下",
      "默默立下",
      "默默发誓",
      // 眼神坚定类
      "眼神.*坚定.*仿佛做出",
      "目光.*坚定.*决心",
      // 决心宣言类
      "掌控.*自己的.*命运",
      "绝不随波逐流",
      "牢牢握住.*命运",
      "找到.*自己的.*一席之地",
      "属于.*自己的.*位置",
      // 心中燃起类
      "心中燃起.*斗志",
      "心中燃起.*决心",
      "心中燃起.*希望",
      "心[中底头]升起",
      // 展望式决心
      "[她他]不会.*放弃",
      "[她他]绝不.*放弃",
      "绝不妥协",
      "绝不低头",
      // 感悟式写法
      "[她他]终于明白",
      "[她他]终于懂得",
      "从此以后",
      "从这一刻起",
    ],
    problem: "AI写作典型陋习：用内心独白代替具体行动",
    fix: "删除内心独白，用具体的动作、对话来展现角色状态",
    examples: [
      {
        bad: "她心中暗下决心，一定要在这后宫中生存下去。",
        good: "她攥紧袖中那枚铜钱，指甲几乎嵌入掌心。",
      },
    ],
  },

  // ★★★ 过度心理描写（精简版 - 只检测最明显的问题）
  excessive_psychology: {
    patterns: [
      // 只保留最典型的过度心理描写
      "思绪万千",
      "思绪翻涌",
      "百感交集",
      "心潮澎湃",
      "内心最深处",
    ],
    problem: "过度使用心理描写词汇，破坏叙事节奏",
    fix: "用外在的生理反应和行为代替直接的心理描写",
    examples: [
      {
        bad: "她心中一震，没想到他会出现在这里。",
        good: "她的脚步顿住，手中的茶盏晃了一下。",
      },
    ],
  },
};

/**
 * 结尾禁止模式
 * 这些句式会让结尾显得"总结式"，缺乏余韵
 * ★ 使用正则表达式提高检测覆盖率
 */
const ENDING_PATTERNS = {
  // 预告式结尾
  foreshadowing_cliche: {
    patterns: [
      // 开始/篇章类 - ★ 扩展更多变体
      "这一切.*只是.*开始",
      "这一切.*才.*开始",
      "而这一切.*开始",
      "一切.*才刚刚?开始",
      "才刚刚?开始",
      "刚刚开始",
      "故事.*才?刚刚?开始",
      "序幕.*拉开",
      "新的.*篇章",
      "新的.*征程",
      // 风暴/命运类
      "风暴.*来临",
      "命运的齿轮.*转动",
      "历史的.*洪流",
      "命运.*降临",
      // 未来/前路类
      "未来.*方向.*明朗",
      "前[路方].*艰[难险]",
      "前[方路]的.*道路",
      "未知的.*挑战",
      "更大的.*挑战",
      "等待.*的.*将是",
    ],
    problem: "空洞的预告，没有具体内容",
    fix: "用具体的悬念或未解决的冲突结尾",
  },

  // 感悟式结尾
  epiphany_cliche: {
    patterns: [
      // 终于明白类
      "[她他]终于明白",
      "[她他]终于懂得",
      "[她他]终于理解",
      "[她他]明白了",
      "[她他]懂得了",
      "[她他]理解了",
      // 此刻感悟类
      "此刻[她他]才",
      "这一刻[她他]才",
      "这时[她他]才",
      "[她他]第一次感受到",
      "[她他]第一次意识到",
      // 从此以后类
      "从此以后",
      "从这一刻起",
      "从今往后",
      // 或许类
      "或许这正是",
      "也许这就是",
      "大概这便是",
    ],
    problem: "把领悟直接告诉读者，而非让读者自己体会",
    fix: "用角色的沉默、动作或未完成的对话结尾",
  },

  // 决心式结尾 - 大幅扩展（使用正则）
  resolution_cliche: {
    patterns: [
      // 直接决心 - ★ 扩展更多变体
      "[她他]暗暗发誓",
      "[她他]在心中.*誓",
      "[她他]下定.*决心",
      "[她他]决定.*要",
      "[她他]决心.*以",
      "[她他]决心.*用",
      "[她他]决心.*要",
      "[她他]决心.*把",
      "[她他]决心.*在",
      // 无论如何类
      "无论如何.*[她他]都[要会]",
      "不管怎样.*[她他]都[要会]",
      // 不会放弃类
      "[她他]不会.*放弃",
      "[她他]绝不.*放弃",
      "[她他]绝不.*认输",
      "[她他]绝不.*屈服",
      // 命运/力量类
      "牢牢握住.*命运",
      "掌控.*自己的.*命运",
      "找到.*掌控.*力量",
      "找到.*自己的.*一席之地",
      "找到.*属于.*位置",
      "改变.*这[里一].*一切",
      "书写.*属于.*篇章",
      "绝不随波逐流",
      // 她要/她必须类
      "[她他][要必]须.*在这",
      "[她他][要必]须.*走出",
      "[她他][要必]须.*成为",
      // 使命宣言式
      "只要[她他]能",
      "既然命运.*将[她他]",
      "[她他]就不打算.*放弃",
      "[她他]绝不会就此",
      // 心中燃起式
      "心[中底头]燃起",
      "心[中底头]升起",
      "心[中底]涌起",
      "胸中涌起",
      "一股.*力量",
      "一丝.*希望",
      "一丝.*斗志",
      "一线.*生机",
    ],
    problem: "用空洞的决心代替具体的行动计划",
    fix: "让角色做出一个具体的小行动，暗示其决心",
  },

  // 抒情式结尾
  lyrical_cliche: {
    patterns: [
      // 夜色/月光类
      "夜色.*深",
      "月光如水",
      "月色.*笼罩",
      "繁星点点",
      "星光.*闪烁",
      "长夜漫漫",
      // 岁月/时光类
      "岁月静好",
      "时光.*流逝",
      // 希望/温暖类
      "闪烁着.*希望.*光",
      "充满了.*温暖",
      "洋溢着.*幸福",
      // 距离类
      "[逐渐慢慢]拉近",
      "渐行渐[近远]",
      "越来越[近远]",
    ],
    problem: "用空洞的景色描写收尾，没有情节张力",
    fix: "景色描写要服务于情绪，且要有具体细节",
  },

  // 新增：总结陈词式结尾
  summary_statement: {
    patterns: [
      "至此，",
      "就这样，",
      "于是，",
      "如此一来，",
      "这便是",
      "这就是",
    ],
    problem: "用陈述句总结情节，缺乏戏剧张力",
    fix: "用动作或感官细节结尾，让读者自己感受",
  },

  // ★★★ GAP-7: 新增更多结尾模式 ★★★
  // 展望未来式结尾
  future_outlook: {
    patterns: [
      "未来.*可期",
      "前途.*光明",
      "一切.*会好",
      "总会.*好起来",
      "明天.*更好",
      "希望.*明天",
      "[她他]相信.*未来",
      "[她他]期待.*明天",
      "新的.*开始",
      "崭新的.*开始",
    ],
    problem: "用空洞的未来展望代替具体情节",
    fix: "用悬念或未解决的问题结尾",
  },

  // 情感升华式结尾
  emotional_climax: {
    patterns: [
      "[她他]的心.*温暖",
      "[她他]感到.*温暖",
      "[她他]感到.*幸福",
      "[她他]感到.*安心",
      "一股暖流",
      "暖流.*涌过",
      "心.*安定.*下来",
      "心.*平静.*下来",
      "[她他].*释然",
      "[她他].*释怀",
    ],
    problem: "直接告诉读者角色的情感结论",
    fix: "用角色的动作或沉默来暗示情感状态",
  },

  // 伪悬念式结尾
  pseudo_suspense: {
    patterns: [
      "但[她他]不知道的是",
      "然而[她他]不知道",
      "[她他]还不知道",
      "殊不知",
      "却不知",
      "接下来.*等待[她他]的",
      "命运.*另有.*安排",
    ],
    problem: "作者跳出来提示悬念，破坏沉浸感",
    fix: "让悬念自然留在情节中，不要明说",
  },
};

/**
 * NPC式对话禁止模式
 * 这些对话模式让角色像在读"设定集"
 */
const NPC_DIALOGUE_PATTERNS = {
  // 自我介绍式
  self_intro: {
    patterns: ["奴婢名唤", "在下姓", "我是XXX的", "小人乃是"],
    problem: "现实中人不会这样自我介绍背景设定",
    fix: "通过他人称呼、回忆、或自然流露来展示身份",
    examples: [
      {
        bad: '"奴婢名唤阿梅，小姐您是织染署染人的女儿，因得卫大人照拂才入宫供职。"',
        good: '"小姐！您可算醒了！"丫鬟扑到床边，"卫大人的人昨晚又来问过，奴婢都不知道怎么回了..."',
      },
    ],
  },

  // 背景灌输式
  info_dump: {
    patterns: ["您可知道", "您要知道", "我得告诉您", "有件事您必须知道"],
    problem: "为了灌输设定而强行安排对话",
    fix: "设定信息通过冲突、问题、误解来自然引出",
  },

  // 解释太多
  over_explain: {
    patterns: ["也就是说，", "换言之，", "简单来说，", "具体而言，"],
    problem: "角色在对话中像在做讲解",
    fix: "对话应该有潜台词、有省略、有误解",
  },
};

// ==================== Few-shot 优秀结尾示例 ====================

/**
 * 优秀章节结尾示例
 * 来源：顶级网文（诡秘之主、庆余年、琅琊榜等）的技法分析
 */
const EXCELLENT_ENDING_EXAMPLES = {
  // 悬念式结尾 - 抛出问题，不给答案
  suspense: [
    {
      type: "对话悬念",
      example: `"那个人，"老者放下茶盏，浑浊的眼珠突然锐利起来，"三十年前死在长安的那个人，其实是..."
门外突然传来一阵急促的脚步声。老者闭上了嘴。`,
      technique: "对话在关键信息前被打断，制造悬念",
    },
    {
      type: "行为悬念",
      example: `她将那封信折好，塞入袖中。然后，她推开了那扇从未有人敢推开的门。`,
      technique: "以一个大胆的行动收尾，读者想知道后果",
    },
    {
      type: "发现悬念",
      example: `她翻开盒盖，里面只有一张纸条，上面只写了两个字——
她的手开始发抖。`,
      technique: "隐藏关键信息，只展示角色反应",
    },
  ],

  // 动作定格 - 在一个具体动作中结束
  action_freeze: [
    {
      type: "离开",
      example: `他站起身，走到门口，却在推门的刹那停住了。
"有件事我忘了告诉你，"他没有回头，"你父亲，其实还活着。"
门被轻轻带上，脚步声渐行渐远。`,
      technique: "在门口/转身/离开时抛出炸弹",
    },
    {
      type: "沉默",
      example: `问完这句话，她就安静地看着他，不再说话。
火盆中的炭偶尔发出细微的噼啪声。
他始终没有回答。`,
      technique: "用沉默和环境音制造压迫感",
    },
    {
      type: "微小动作",
      example: `苏培盛躬身退出养心殿，临出门前，他看到皇上的手指轻轻敲了敲御案。
三下。
他的后背一下子被冷汗浸透了。`,
      technique: "一个细微动作暗示重大信息",
    },
  ],

  // 感官冲击 - 用感官细节结尾
  sensory: [
    {
      type: "嗅觉",
      example: `她推开门，一股浓烈的血腥气扑面而来。
屋内很安静。`,
      technique: "用气味暗示发生了什么，不直接描述",
    },
    {
      type: "听觉",
      example: `她躺在床上，听着窗外的雨声。
远处传来三更的梆子声，一下，两下，三下。
然后是一声极轻的脚步声——在她的门外停住了。`,
      technique: "声音渐近，制造紧张感",
    },
    {
      type: "触觉",
      example: `她将手伸入水中，指尖触到一个冰冷的、坚硬的东西。
圆形的，有棱角。
是一枚印章。`,
      technique: "通过触觉发现关键物品",
    },
  ],

  // 反转提示 - 暗示接下来有变化
  twist_hint: [
    {
      type: "发现异常",
      example: `她正要离开，目光无意中扫过桌案。
那封信——她明明放在左边的——现在却在桌案的正中央。
有人来过。`,
      technique: "发现不对劲的细节，暗示危机",
    },
    {
      type: "计划外变量",
      example: `一切都在按计划进行。
直到她在人群中看到了一张不该出现的脸。`,
      technique: "计划被意外打破",
    },
  ],
};

/**
 * 错误结尾示例对比
 * 每个示例包含原文（差）和改写（好）的对比
 */
const ENDING_REWRITE_EXAMPLES = [
  {
    bad: `苏薇的心中燃起一丝怒火与决心，不仅要活下去，更要找到掌控这一切的力量。`,
    good: `她走到窗前，指尖轻轻触上冰冷的窗棂。外面的夜色浓得像墨。
"阿翠，"她头也不回地问，"明天，是谁当值验粉？"`,
    analysis: "用具体的动作和问题代替抽象的决心宣言",
  },
  {
    bad: `即使未来迷雾重重，她也要牢牢握住自己的命运，绝不随波逐流。`,
    good: `她将那瓶粉末藏入袖中。
明天验粉时，该让谁来试这第一口呢？
她的嘴角微微上扬。`,
    analysis: "用具体的行动和心机代替空洞的使命宣言",
  },
  {
    bad: `她与韩延之间的距离却因这一份共同的追求而逐渐拉近。`,
    good: `"你真的相信，"韩延收起最后一个药瓶，"这世上的毒，都能被解？"
她没有回答。
炉火噼啪作响，映得两人的影子忽明忽暗。`,
    analysis: "用对话和环境收尾，留下开放性思考",
  },
  {
    bad: `在即将到来的考验面前，她的心中燃起一丝斗志。即使前路艰险，她也要用自己的智慧与能力，去挑战那些陈旧的规则。`,
    good: `她拿起那支细毫笔，在空白的竹简上落下第一个字。
"配方..."
门外传来脚步声，她迅速将竹简塞入袖中。
"苏姑娘，尚宫有请。"`,
    analysis: "动作被打断，制造紧张感和悬念",
  },
];

// ==================== 服务实现 ====================

export interface NarrativeCraftReport {
  /** 检测到的问题 */
  issues: Array<{
    type: "preach" | "ending" | "npc_dialogue";
    category: string;
    match: string;
    line: number;
    problem: string;
    suggestion: string;
  }>;
  /** 总体评分 0-100 */
  score: number;
  /** 是否通过 */
  passed: boolean;
}

@Injectable()
export class NarrativeCraftService {
  private readonly logger = new Logger(NarrativeCraftService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 生成叙事工艺约束提示词
   * 用于在写作前注入，防止产生问题
   */
  generateNarrativeCraftConstraints(): string {
    const parts: string[] = [];

    parts.push(
      `## 【最高优先级】叙事工艺禁忌（必须严格遵守，违反将导致重写）\n`,
    );

    // 说教禁止
    parts.push(`### 1. 禁止"说教式写法"（Tell not Show）`);
    parts.push(`以下句式会破坏沉浸感，严禁使用：\n`);

    parts.push(`**禁止"她/他知道"类：**`);
    parts.push(`- ❌ "她知道，作为后宫女子，美丽是生存的基础。"`);
    parts.push(
      `- ✅ 改为动作：她的手指不自觉地摸上脸颊——这张脸，是她唯一的筹码。\n`,
    );

    parts.push(`**禁止"是...的象征"类：**`);
    parts.push(`- ❌ "在这个时代，妆容是权力的象征。"`);
    parts.push(`- ✅ 改为场景：太后扫了一眼她素净的面容，嘴角微微下撇。\n`);

    parts.push(`**禁止直接描述情绪：**`);
    parts.push(`- ❌ "她很紧张" / "他感到愤怒"`);
    parts.push(`- ✅ 用生理反应：她的手指揪紧袖口，指甲陷进掌心。\n`);

    // 结尾禁止 - 加强
    parts.push(`### 2. 【核心】章节结尾禁忌（这是最常见的问题！）`);
    parts.push(`章节必须在【具体场景/动作/对话】中结束，严禁以下结尾：\n`);
    parts.push(`**绝对禁止的结尾模式（出现任何一个都必须重写）：**`);
    parts.push(`- ❌ "只要她能掌控这份力量，就能..." （决心总结）`);
    parts.push(`- ❌ "既然命运已将她抛入...她就不打算放弃..." （使命宣言）`);
    parts.push(`- ❌ "而这一切，只是开始" / "风暴即将来临" （空洞预告）`);
    parts.push(`- ❌ "她终于明白..." / "此刻她才意识到..." （顿悟总结）`);
    parts.push(`- ❌ "心中燃起一丝斗志/希望/决心" （心理总结）`);
    parts.push(`- ❌ "牢牢握住自己的命运" / "绝不随波逐流" （鸡汤宣言）`);
    parts.push(
      `- ❌ "找到掌控这一切的力量" / "找到自己的一席之地" （空洞目标）`,
    );
    parts.push(`- ❌ "她与XX之间的距离逐渐拉近" （旁白总结）\n`);

    // Few-shot 示例
    parts.push(`**【重要】正确的结尾方式（请严格模仿以下示例）：**\n`);

    // 从 EXCELLENT_ENDING_EXAMPLES 中提取示例
    parts.push(`**示例1 - 悬念式：**`);
    parts.push(`\`\`\``);
    parts.push(EXCELLENT_ENDING_EXAMPLES.suspense[0].example);
    parts.push(`\`\`\``);
    parts.push(`技巧：${EXCELLENT_ENDING_EXAMPLES.suspense[0].technique}\n`);

    parts.push(`**示例2 - 动作定格：**`);
    parts.push(`\`\`\``);
    parts.push(EXCELLENT_ENDING_EXAMPLES.action_freeze[2].example);
    parts.push(`\`\`\``);
    parts.push(
      `技巧：${EXCELLENT_ENDING_EXAMPLES.action_freeze[2].technique}\n`,
    );

    parts.push(`**示例3 - 感官冲击：**`);
    parts.push(`\`\`\``);
    parts.push(EXCELLENT_ENDING_EXAMPLES.sensory[1].example);
    parts.push(`\`\`\``);
    parts.push(`技巧：${EXCELLENT_ENDING_EXAMPLES.sensory[1].technique}\n`);

    // 对比示例
    parts.push(`**【对比】错误结尾 vs 正确结尾：**\n`);
    for (const example of ENDING_REWRITE_EXAMPLES.slice(0, 2)) {
      parts.push(`❌ 错误：${example.bad}`);
      parts.push(`✅ 正确：`);
      parts.push(`\`\`\``);
      parts.push(example.good);
      parts.push(`\`\`\``);
      parts.push(`分析：${example.analysis}\n`);
    }

    // 对话禁止
    parts.push(`### 3. 对话自然度要求`);
    parts.push(`对话不能像NPC在"读设定集"：\n`);
    parts.push(`**禁止设定灌输式对话：**`);
    parts.push(
      `- ❌ "奴婢名唤阿梅，小姐您是织染署染人的女儿，因得卫大人照拂才入宫供职。"`,
    );
    parts.push(
      `- ✅ "小姐！您可算醒了！卫大人的人昨晚又来问过，奴婢都不知道怎么回了..."\n`,
    );
    parts.push(`**对话要有：**`);
    parts.push(`- 潜台词（说的和想的不一样）`);
    parts.push(`- 省略（熟人间不会解释已知信息）`);
    parts.push(`- 情绪（紧张、害怕、讨好、试探）`);
    parts.push(`- 冲突（意见不合、误解、隐瞒）\n`);

    // 动机逻辑
    parts.push(`### 4. 动机逻辑链条`);
    parts.push(`角色行动必须有合理的动机触发：\n`);
    parts.push(`**错误示例：**`);
    parts.push(`- 主角刚穿越醒来 → 立刻开始做胭脂`);
    parts.push(`- 问题：缺乏紧迫性触发，为什么非要现在做？\n`);
    parts.push(`**正确示例：**`);
    parts.push(
      `- 主角刚穿越醒来 → 丫鬟说"半个时辰后尚宫要来验人" → 照镜发现面色惨白 → 必须立刻补妆`,
    );
    parts.push(`- 动机链完整：外部压力 + 发现问题 + 必须行动\n`);

    return parts.join("\n");
  }

  /**
   * ★★★ 辅助方法：检测模式是否包含正则表达式语法 ★★★
   */
  private isRegexPattern(pattern: string): boolean {
    // 检测常见的正则表达式特殊字符
    return /[.*+?|^$\[\]{}()\\]/.test(pattern);
  }

  /**
   * ★★★ 辅助方法：匹配模式（支持正则和字面量） ★★★
   */
  private matchPattern(
    line: string,
    pattern: string,
  ): { matched: boolean; matchedText: string } {
    if (this.isRegexPattern(pattern)) {
      try {
        const regex = new RegExp(pattern);
        const match = line.match(regex);
        if (match) {
          return { matched: true, matchedText: match[0] };
        }
      } catch {
        // 正则表达式无效，降级为字面量匹配
        if (line.includes(pattern)) {
          return { matched: true, matchedText: pattern };
        }
      }
    } else {
      if (line.includes(pattern)) {
        return { matched: true, matchedText: pattern };
      }
    }
    return { matched: false, matchedText: "" };
  }

  /**
   * 分析内容中的叙事问题
   * 用于后置检查
   */
  analyzeContent(content: string): NarrativeCraftReport {
    const lines = content.split("\n");
    const issues: NarrativeCraftReport["issues"] = [];

    // 检查说教模式（支持正则表达式）
    for (const [category, config] of Object.entries(PREACH_PATTERNS)) {
      for (const pattern of config.patterns) {
        lines.forEach((line, index) => {
          const { matched, matchedText } = this.matchPattern(line, pattern);
          if (matched) {
            issues.push({
              type: "preach",
              category,
              match: matchedText || pattern,
              line: index + 1,
              problem: config.problem,
              suggestion: config.fix,
            });
          }
        });
      }
    }

    // 检查结尾模式（只检查最后5行）
    const lastLines = lines.slice(-5);
    for (const [category, config] of Object.entries(ENDING_PATTERNS)) {
      for (const pattern of config.patterns) {
        lastLines.forEach((line, index) => {
          const { matched, matchedText } = this.matchPattern(line, pattern);
          if (matched) {
            issues.push({
              type: "ending",
              category,
              match: matchedText || pattern,
              line: lines.length - 5 + index + 1,
              problem: config.problem,
              suggestion: config.fix,
            });
          }
        });
      }
    }

    // 检查NPC对话模式
    for (const [category, config] of Object.entries(NPC_DIALOGUE_PATTERNS)) {
      for (const pattern of config.patterns) {
        lines.forEach((line, index) => {
          const { matched, matchedText } = this.matchPattern(line, pattern);
          if (matched) {
            issues.push({
              type: "npc_dialogue",
              category,
              match: matchedText || pattern,
              line: index + 1,
              problem: config.problem,
              suggestion: config.fix,
            });
          }
        });
      }
    }

    // 计算分数 - 区分不同严重程度（调整后更宽松）
    const aiClicheCount = issues.filter(
      (i) =>
        i.type === "preach" &&
        (i.category === "ai_writing_cliche" ||
          i.category === "excessive_psychology"),
    ).length;
    const otherPreachCount = issues.filter(
      (i) =>
        i.type === "preach" &&
        i.category !== "ai_writing_cliche" &&
        i.category !== "excessive_psychology",
    ).length;
    const endingCount = issues.filter((i) => i.type === "ending").length;
    const dialogueCount = issues.filter(
      (i) => i.type === "npc_dialogue",
    ).length;

    // 每个问题扣分 - 只有结尾问题才严重，其他问题宽容度较高
    // 避免因为常见的中文小说写法而过度惩罚
    const score = Math.max(
      0,
      100 -
        Math.min(aiClicheCount, 2) * 5 - // AI陋习：最多扣10分（2*5），超过2处不再累加
        Math.min(otherPreachCount, 3) * 2 - // 其他说教：最多扣6分（3*2），宽容常见写法
        endingCount * 20 - // 结尾问题：每处扣20分（降低，避免单个结尾问题导致失败）
        Math.min(dialogueCount, 2) * 4, // 对话问题：最多扣8分
    );

    if (issues.length > 0) {
      this.logger.warn(
        `[NarrativeCraft] Found ${issues.length} issues: ${aiClicheCount} AI-cliche, ${otherPreachCount} preach, ${endingCount} ending, ${dialogueCount} dialogue`,
      );
    }

    return {
      issues,
      score,
      // 只有结尾问题才会导致不通过（score < 80）
      // 其他问题只是警告，不阻止章节通过
      passed: endingCount === 0 || score >= 50,
    };
  }

  /**
   * 生成修复建议
   */
  generateFixSuggestions(report: NarrativeCraftReport): string {
    if (report.issues.length === 0) {
      return "叙事工艺检查通过，无需修改。";
    }

    const parts: string[] = [];
    parts.push(`## 叙事工艺问题修复建议\n`);
    parts.push(`检测到 ${report.issues.length} 个问题，需要修改：\n`);

    // 按类型分组
    const preachIssues = report.issues.filter((i) => i.type === "preach");
    const endingIssues = report.issues.filter((i) => i.type === "ending");
    const dialogueIssues = report.issues.filter(
      (i) => i.type === "npc_dialogue",
    );

    if (preachIssues.length > 0) {
      parts.push(`### 说教式写法问题（${preachIssues.length}处）`);
      for (const issue of preachIssues.slice(0, 3)) {
        parts.push(`- 第${issue.line}行: "${issue.match}"`);
        parts.push(`  问题: ${issue.problem}`);
        parts.push(`  建议: ${issue.suggestion}\n`);
      }
    }

    if (endingIssues.length > 0) {
      parts.push(`### 结尾问题（${endingIssues.length}处）`);
      for (const issue of endingIssues) {
        parts.push(`- 第${issue.line}行: "${issue.match}"`);
        parts.push(`  问题: ${issue.problem}`);
        parts.push(`  建议: ${issue.suggestion}\n`);
      }
    }

    if (dialogueIssues.length > 0) {
      parts.push(`### 对话问题（${dialogueIssues.length}处）`);
      for (const issue of dialogueIssues.slice(0, 3)) {
        parts.push(`- 第${issue.line}行: "${issue.match}"`);
        parts.push(`  问题: ${issue.problem}`);
        parts.push(`  建议: ${issue.suggestion}\n`);
      }
    }

    return parts.join("\n");
  }

  /**
   * ★★★ 自动重写章节内容
   * 处理结尾问题和全文散布的 AI 陋习
   *
   * @param content 完整章节内容
   * @param issues 检测到的问题
   * @returns 重写后的完整章节内容
   */
  async rewriteEnding(
    content: string,
    issues: NarrativeCraftReport["issues"],
  ): Promise<string> {
    // 处理结尾问题和全文AI陋习问题
    const endingIssues = issues.filter((i) => i.type === "ending");
    const aiClicheIssues = issues.filter(
      (i) =>
        i.type === "preach" &&
        (i.category === "ai_writing_cliche" ||
          i.category === "excessive_psychology"),
    );

    // 如果两者都没有，直接返回
    if (endingIssues.length === 0 && aiClicheIssues.length === 0) {
      return content;
    }

    this.logger.log(
      `[NarrativeCraft] Rewriting content due to ${endingIssues.length} ending issues and ${aiClicheIssues.length} AI cliche issues`,
    );

    const lines = content.split("\n");
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
    if (paragraphs.length < 2) {
      return content; // 内容太短，不处理
    }

    // ★★★ 新策略：根据问题分布决定处理范围 ★★★
    // 1. 如果只有结尾问题（最后5行），只处理最后3段
    // 2. 如果有全文散布的 AI 陋习，需要处理受影响的段落

    const totalLines = lines.length;
    const midContentIssues = aiClicheIssues.filter(
      (i) => i.line < totalLines - 5,
    ); // 非结尾部分的问题

    let beforePart: string;
    let targetPart: string;
    let rewriteMode: "ending" | "full";

    if (midContentIssues.length === 0) {
      // 只有结尾问题，处理最后3段
      const lastParagraphsCount = Math.min(3, paragraphs.length);
      beforePart = paragraphs.slice(0, -lastParagraphsCount).join("\n\n");
      targetPart = paragraphs.slice(-lastParagraphsCount).join("\n\n");
      rewriteMode = "ending";
    } else {
      // 有全文散布的问题，需要处理更大范围
      // 找出所有有问题的行号
      const problemLines = new Set(aiClicheIssues.map((i) => i.line));

      // 找出包含问题的段落索引
      let currentLine = 0;
      const problemParagraphIndices = new Set<number>();
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraphLines = paragraphs[i].split("\n").length;
        const paragraphEndLine = currentLine + paragraphLines;

        // 检查这个段落是否包含问题行
        for (let line = currentLine; line < paragraphEndLine; line++) {
          if (problemLines.has(line + 1)) {
            // line是0-indexed，problemLines是1-indexed
            problemParagraphIndices.add(i);
            break;
          }
        }
        currentLine = paragraphEndLine + 1; // +1 for the blank line between paragraphs
      }

      // 如果问题段落超过总段落的 30%，或超过 5 段，则全文重写太耗资源
      // 改为只处理有问题的段落（及其前后各1段作为上下文）
      if (
        problemParagraphIndices.size > paragraphs.length * 0.3 ||
        problemParagraphIndices.size > 5
      ) {
        // 问题太多，只处理最后部分 + 记录警告
        this.logger.warn(
          `[NarrativeCraft] Too many AI cliche issues (${problemParagraphIndices.size} paragraphs), falling back to ending-only rewrite`,
        );
        const lastParagraphsCount = Math.min(5, paragraphs.length); // 扩展到5段
        beforePart = paragraphs.slice(0, -lastParagraphsCount).join("\n\n");
        targetPart = paragraphs.slice(-lastParagraphsCount).join("\n\n");
        rewriteMode = "ending";
      } else {
        // 提取有问题的段落及上下文
        const indicesToInclude = new Set<number>();
        for (const idx of problemParagraphIndices) {
          if (idx > 0) indicesToInclude.add(idx - 1); // 前一段作为上下文
          indicesToInclude.add(idx);
          if (idx < paragraphs.length - 1) indicesToInclude.add(idx + 1); // 后一段作为上下文
        }

        // 找出连续的段落范围
        const sortedIndices = Array.from(indicesToInclude).sort(
          (a, b) => a - b,
        );
        const minIdx = sortedIndices[0];
        const maxIdx = sortedIndices[sortedIndices.length - 1];

        beforePart = paragraphs.slice(0, minIdx).join("\n\n");
        targetPart = paragraphs.slice(minIdx, maxIdx + 1).join("\n\n");
        // 还需要保留后面的内容
        const afterPart = paragraphs.slice(maxIdx + 1).join("\n\n");
        if (afterPart) {
          // 将 afterPart 暂存，稍后拼接回去
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- temporary cross-call state storage
          (this as any)._tempAfterPart = afterPart;
        }
        rewriteMode = "full";
      }
    }

    // 构建重写提示词 - 同时处理结尾问题和全文AI陋习
    const systemPrompt = `你是一位专业的小说编辑，负责修复章节中的叙事问题。

## 核心任务
重写以下章节内容，将所有抽象的心理描写/总结/感悟改为具体的场景/动作/对话。

## 【严格禁止】AI写作典型陋习（必须全部删除或改写！）

### 1. 内心独白式决心（最常见的错误！）
- ❌ "她心中暗下决心" → ✅ 用具体动作展现
- ❌ "她的眼神坚定，仿佛做出了某种决定" → ✅ 描写她做的具体事情
- ❌ "他默默立下目标" → ✅ 删除，让行动说话
- ❌ "心中燃起斗志/决心/希望" → ✅ 删除这类空洞描写

### 2. 展望式收尾
- ❌ "她不会轻易放弃" → ✅ 直接删除
- ❌ "即使前路艰险，她也将不再退缩" → ✅ 直接删除
- ❌ "无论如何，她都要..." → ✅ 直接删除

### 3. 过度心理描写
- ❌ "心中一震/一紧" → ✅ 用生理反应代替（手指发抖、脚步顿住）
- ❌ "脑海中浮现" → ✅ 删除或改为具体行为
- ❌ "思绪万千" → ✅ 删除

### 4. 总结式结尾
- ❌ "这一切才刚刚开始" → ✅ 用悬念代替
- ❌ "命运的齿轮开始转动" → ✅ 删除这类抒情
- ❌ "她终于明白了..." → ✅ 用沉默或动作代替

## 正确的写法示例

### 示例1：删除决心式内心独白
❌ 原文：
苏薇的心中燃起一丝怒火与决心，不仅要活下去，更要找到掌控这一切的力量。

✅ 改为：
她走到窗前，指尖轻轻触上冰冷的窗棂。
"阿翠，"她头也不回地问，"明天，是谁当值验粉？"

### 示例2：用动作代替心理描写
❌ 原文：
她心中一震，没想到他会出现在这里。她的眼神坚定，仿佛做出了某种决定。

✅ 改为：
她的脚步顿住，手中的茶盏晃了一下。
"你怎么在这？"她压低声音。

### 示例3：删除展望式结尾
❌ 原文：
即使前路艰险，她也将不再退缩。她知道，未来的挑战还有很多。

✅ 改为：
（直接删除这两句，让前文的情节自己说话）

## 输出要求
- 只输出重写后的段落
- 保持与前文风格一致
- 不要添加任何解释或说明
- 遇到"决心/感悟/展望"类内容，优先选择直接删除`;

    // 合并所有问题的诊断
    const allIssues = [...endingIssues, ...aiClicheIssues];
    const userPrompt = `## 问题诊断
${allIssues.map((i) => `- 第${i.line}行: "${i.match}" - ${i.problem}`).join("\n")}

## 前文内容（保持一致性）
${beforePart.slice(-500)}

## 需要重写的内容
${targetPart}

请重写以上内容，删除或改写所有AI陋习表达，使其在具体的动作/对话/场景中自然${rewriteMode === "ending" ? "结束" : "衔接"}：`;

    // 重试机制：最多尝试3次
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // ★ 使用 TaskProfile 统一管理创意度，重试时保持 high 创意度
      // 注：TaskProfile 的 "high" 对应 temperature 0.9，已足够创意多样性
      const taskProfile: TaskProfile = {
        creativity: "high", // 创意写作需要高创造性
        outputLength: rewriteMode === "full" ? "medium" : "short",
      };

      try {
        const response = await this.chatFacade.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          taskProfile,
        });

        const newEnding = response.content?.trim();
        if (!newEnding) {
          this.logger.warn(
            `[NarrativeCraft] Rewrite attempt ${attempt}/${maxRetries} failed: empty response`,
          );
          if (attempt < maxRetries) {
            // 等待一小段时间后重试
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          this.logger.error(
            "[NarrativeCraft] All rewrite attempts failed with empty response",
          );
          return content;
        }

        // ★★★ GAP-4 修复：验证重写后的内容是否仍有问题（包括AI陋习） ★★★
        const rewriteReport = this.analyzeContent(newEnding);
        const stillHasEndingIssues = rewriteReport.issues.some(
          (i) => i.type === "ending",
        );
        const stillHasClicheIssues = rewriteReport.issues.some(
          (i) =>
            i.category === "ai_writing_cliche" ||
            i.category === "excessive_psychology",
        );

        if (stillHasEndingIssues || stillHasClicheIssues) {
          const issueTypes = [
            stillHasEndingIssues ? "ending" : null,
            stillHasClicheIssues ? "cliche" : null,
          ]
            .filter(Boolean)
            .join(", ");
          this.logger.warn(
            `[NarrativeCraft] Rewrite attempt ${attempt}/${maxRetries} still has issues (${issueTypes}), ${attempt < maxRetries ? "retrying..." : "keeping original"}`,
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue; // 使用重试机制，不立即返回原内容
          }
          return content; // 所有重试都失败，返回原内容
        }

        // 拼接新内容（处理 full 模式的 afterPart）
        let newContent = beforePart
          ? `${beforePart}\n\n${newEnding}`
          : newEnding;

        // 如果是 full 模式，需要拼接后面的内容
        if (rewriteMode === "full") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- temporary cross-call state storage
          const afterPart = (this as any)._tempAfterPart;
          if (afterPart) {
            newContent = `${newContent}\n\n${afterPart}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- temporary cross-call state storage
            delete (this as any)._tempAfterPart; // 清理临时变量
          }
        }

        this.logger.log(
          `[NarrativeCraft] Content rewritten successfully (mode: ${rewriteMode})`,
        );
        return newContent;
      } catch (error) {
        this.logger.warn(
          `[NarrativeCraft] Rewrite attempt ${attempt}/${maxRetries} failed: ${error}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        this.logger.error(`[NarrativeCraft] All rewrite attempts failed`);
        return content;
      }
    }

    // 不应该到达这里，但作为安全返回
    return content;
  }
}
