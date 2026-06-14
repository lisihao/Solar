/**
 * ExpressionMemoryService - 表达记忆服务
 *
 * 核心职责：
 * - 追踪项目中已使用的表达（成语、比喻、描写手法等）
 * - 实现冷却期机制，防止表达重复使用
 * - 为 Writer Agent 提供「禁用表达」列表
 * - 分析内容，自动提取并记录新表达
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// 表达类型（与 Prisma schema 同步）
export type ExpressionType =
  | "IDIOM"
  | "METAPHOR"
  | "DESCRIPTION"
  | "EMOTION"
  | "ACTION"
  | "DIALOGUE"
  | "TRANSITION"
  | "PLOT_PATTERN"
  | "CHAPTER_OPENING" // 章节开场模式
  | "SCENE_STRUCTURE" // 场景结构模式
  | "NARRATIVE_PACING"; // 叙事节奏模式

// ==================== 常量配置 ====================

/**
 * 表达冷却配置
 */
const EXPRESSION_COOLDOWN_CONFIG = {
  /** 默认冷却章节数（表达需要间隔多少章才能再用） */
  defaultCooldownChapters: 10,
  /** 高频表达冷却章节数（使用超过3次的表达） */
  highFrequencyCooldownChapters: 20,
  /** 成语冷却章节数 */
  idiomCooldownChapters: 15,
  /** 情感表达冷却章节数 */
  emotionCooldownChapters: 8,
  /** 过渡语冷却章节数 */
  transitionCooldownChapters: 5,
  /** 章节开场模式冷却章节数（★新增：防止每章开场雷同） */
  chapterOpeningCooldownChapters: 25,
  /** 场景结构模式冷却章节数（★新增：防止场景安排重复） */
  sceneStructureCooldownChapters: 20,
  /** 叙事节奏模式冷却章节数（★新增：防止节奏单一） */
  narrativePacingCooldownChapters: 15,
  /** 每章目标字数（用于估算冷却时间） */
  chapterWordCount: 3000,
} as const;

/**
 * 表达替代建议库 - 用于主动引导创作
 *
 * 当某个表达被禁用时，提供具体的替代方案，
 * 从"被动禁止"转变为"主动引导"
 */
const EXPRESSION_ALTERNATIVES: Record<string, string[]> = {
  // ==================== 情感表达替代 ====================
  // "心中X" 系列
  心中一震: ["胸口一窒", "呼吸微滞", "手指不自觉攥紧", "瞳孔微缩"],
  心中一惊: ["脚步一顿", "手中物件险些滑落", "眼睫微颤", "后背一凉"],
  心中一喜: [
    "嘴角不由自主微翘",
    "眼底泛起笑意",
    "脚步轻快几分",
    "指尖微微发热",
  ],
  心中暗喜: ["垂眸掩去眼底光芒", "低头遮住唇边弧度", "手指在袖中轻叩"],
  心中一凛: ["后颈汗毛乍起", "脊背微僵", "不由自主后退半步", "手心沁出薄汗"],
  心中一寒: ["指尖发凉", "血液仿佛凝固", "冷意从脚底直窜头顶", "牙关微紧"],
  心中一动: ["目光微闪", "耳畔一热", "思绪忽然一转", "唇角微勾"],
  心头一紧: ["呼吸急促起来", "手不自觉握紧衣袖", "太阳穴突突直跳"],
  心头涌起: ["喉间发紧", "眼眶微热", "胸口闷闷的", "鼻尖微酸"],
  暗自思忖: ["眉头微蹙", "手指轻叩桌面", "目光变得幽深", "负手踱步"],

  // ==================== 动作表达替代 ====================
  // 微笑系列
  微微一笑: ["唇角微扬", "眼尾弯出细纹", "嘴角轻轻一勾", "眼底漾开笑意"],
  嘴角微扬: ["唇边浮现笑意", "眼中含笑", "面上带了三分笑意", "嘴角噙着淡笑"],
  淡然一笑: ["神色不变，只唇角微弯", "眼底笑意不达眼底", "漫不经心地勾了勾唇"],

  // 说话系列
  缓缓道: ["沉吟片刻后开口", "声音不疾不徐", "一字一顿地说", "语调平缓"],
  轻声道: ["压低声音说", "附耳低语", "声若蚊蚋", "唇畔微动"],
  冷冷道: ["语带寒意", "声线冰凉", "一字一句如刀锋", "话音里不带丝毫温度"],
  沉声道: ["声音低沉", "嗓音压得极低", "喉间发出低哑的声音"],

  // 表情系列
  眉头微皱: ["眉心拧起", "秀眉轻蹙", "双眉略聚", "眉峰微动"],
  眉头紧锁: ["眉间川字深刻", "双眉几乎拧在一处", "面带忧色"],
  目光一闪: ["眼中精光一现", "瞳孔微缩", "眼底暗光流转", "视线陡然锋利"],
  眼中闪过: ["目光微动", "眼底掠过一丝", "瞳仁微颤"],

  // 动作修饰替代
  微微: ["略", "稍", "轻", "浅浅"],
  缓缓: ["徐徐", "慢慢", "从容地", "不紧不慢地"],
  轻轻: ["小心翼翼地", "柔柔地", "悄然", "悄悄"],
  深吸一口气: ["调整呼吸", "胸膛起伏", "用力呼出一口浊气", "闭目凝神片刻"],

  // ==================== 环境描写替代 ====================
  月光如水: ["月华清冷", "银辉洒落", "冷月高悬", "月色朦胧"],
  烛光摇曳: ["灯花微颤", "火苗轻晃", "橘黄光影明灭不定", "烛火跳动"],
  夜色深沉: ["夜幕如墨", "暮色四合", "天际漆黑如铁", "万籁俱寂"],
  金碧辉煌: ["殿宇巍峨", "琉璃映日", "朱漆红柱鲜亮夺目", "雕梁画栋"],

  // ==================== 过渡语替代 ====================
  就在这时: ["恰在此刻", "话音未落", "正说着", "忽然"],
  与此同时: ["同一时刻", "这边厢...那边厢", "正当此际", "而另一边"],
  片刻之后: ["须臾", "一盏茶功夫", "不多时", "转瞬之间"],
  不知不觉: ["浑然不觉间", "恍惚间", "不经意间", "悄然间"],

  // ==================== 情节模式替代 ====================
  暗流涌动: [
    "局势微妙",
    "表面平静下暗藏波澜",
    "平静只是假象",
    "各方势力蠢蠢欲动",
  ],
  剑拔弩张: ["气氛紧绷", "空气仿佛凝固", "对峙之势", "火药味浓重"],
  峰回路转: ["柳暗花明", "局势陡变", "事态急转", "出乎意料"],

  // ==================== 比喻词替代 ====================
  仿佛: ["好似", "恰如", "有如", "一如"],
  宛如: ["恍若", "俨然", "好比", "无异于"],
  似乎: ["像是", "仿似", "隐约", "约莫"],

  // ==================== 基础情态词替代 ====================
  不禁: ["忍不住", "情不自禁", "不由自主", "不觉"],
  不由得: ["禁不住", "没来由地", "自然而然地", "无端地"],
  暗自: ["心下", "默默", "私下里", "在心中"],
};

/**
 * 获取表达的替代建议
 */
function getAlternatives(expression: string): string[] {
  // 精确匹配
  if (EXPRESSION_ALTERNATIVES[expression]) {
    return EXPRESSION_ALTERNATIVES[expression];
  }

  // 部分匹配：尝试找到包含该表达的键
  for (const [key, alternatives] of Object.entries(EXPRESSION_ALTERNATIVES)) {
    if (expression.includes(key) || key.includes(expression)) {
      return alternatives;
    }
  }

  // 基于类别的通用建议
  return [];
}

/**
 * 常见重复表达模式 - 用于检测
 * 扩展版本：覆盖更多常见 AI 写作重复模式
 */
const COMMON_EXPRESSION_PATTERNS: Array<{
  pattern: RegExp;
  type: ExpressionType;
  category?: string;
}> = [
  // ==================== 情感震惊类 ====================
  { pattern: /心中一震/g, type: "EMOTION", category: "震惊" },
  { pattern: /心头一紧/g, type: "EMOTION", category: "紧张" },
  { pattern: /心中一动/g, type: "EMOTION", category: "触动" },
  { pattern: /心中一凛/g, type: "EMOTION", category: "警惕" },
  { pattern: /心下一沉/g, type: "EMOTION", category: "沮丧" },
  { pattern: /心中暗喜/g, type: "EMOTION", category: "喜悦" },
  { pattern: /心中暗道/g, type: "EMOTION", category: "思考" },
  { pattern: /暗自思忖/g, type: "EMOTION", category: "思考" },
  // ★ 移到 BASE: 基础词汇部分统一管理
  // { pattern: /不由得/g, type: "EMOTION", category: "自然反应" },
  // { pattern: /不禁/g, type: "EMOTION", category: "自然反应" },
  { pattern: /心如刀绞/g, type: "EMOTION", category: "痛苦" },
  { pattern: /心乱如麻/g, type: "EMOTION", category: "困惑" },
  { pattern: /百感交集/g, type: "EMOTION", category: "复杂" },
  { pattern: /五味杂陈/g, type: "EMOTION", category: "复杂" },
  { pattern: /心头一热/g, type: "EMOTION", category: "感动" },
  { pattern: /心中一喜/g, type: "EMOTION", category: "喜悦" },
  { pattern: /暗自庆幸/g, type: "EMOTION", category: "庆幸" },
  { pattern: /心中一寒/g, type: "EMOTION", category: "恐惧" },
  { pattern: /心中一惊/g, type: "EMOTION", category: "惊讶" },
  { pattern: /若有所思/g, type: "EMOTION", category: "思考" },
  // ★ 新增：高频遗漏表达
  { pattern: /心中明白/g, type: "EMOTION", category: "思考" },
  { pattern: /心里明白/g, type: "EMOTION", category: "思考" },
  { pattern: /心中清楚/g, type: "EMOTION", category: "思考" },
  { pattern: /心里清楚/g, type: "EMOTION", category: "思考" },
  { pattern: /心中了然/g, type: "EMOTION", category: "思考" },
  { pattern: /心中暗想/g, type: "EMOTION", category: "思考" },
  { pattern: /心中暗自/g, type: "EMOTION", category: "思考" },
  { pattern: /心中不由/g, type: "EMOTION", category: "自然反应" },
  { pattern: /心中一紧/g, type: "EMOTION", category: "紧张" },
  { pattern: /心中涌起/g, type: "EMOTION", category: "情感涌动" },
  { pattern: /心头涌起/g, type: "EMOTION", category: "情感涌动" },
  { pattern: /心中升起/g, type: "EMOTION", category: "情感涌动" },
  { pattern: /心下明白/g, type: "EMOTION", category: "思考" },
  { pattern: /心下了然/g, type: "EMOTION", category: "思考" },

  // ==================== 动作描写类 ====================
  { pattern: /微微一笑/g, type: "ACTION", category: "微笑" },
  { pattern: /嘴角微扬/g, type: "ACTION", category: "微笑" },
  { pattern: /嘴角上扬/g, type: "ACTION", category: "微笑" },
  { pattern: /淡然一笑/g, type: "ACTION", category: "微笑" },
  { pattern: /莞尔一笑/g, type: "ACTION", category: "微笑" },
  { pattern: /轻声道/g, type: "ACTION", category: "说话" },
  { pattern: /淡淡道/g, type: "ACTION", category: "说话" },
  { pattern: /缓缓道/g, type: "ACTION", category: "说话" },
  { pattern: /冷冷道/g, type: "ACTION", category: "说话" },
  { pattern: /沉声道/g, type: "ACTION", category: "说话" },
  { pattern: /低声道/g, type: "ACTION", category: "说话" },
  { pattern: /喃喃道/g, type: "ACTION", category: "说话" },
  { pattern: /厉声道/g, type: "ACTION", category: "说话" },
  { pattern: /眉头微皱/g, type: "ACTION", category: "表情" },
  { pattern: /眉头一蹙/g, type: "ACTION", category: "表情" },
  { pattern: /眉头紧锁/g, type: "ACTION", category: "表情" },
  { pattern: /眉头舒展/g, type: "ACTION", category: "表情" },
  { pattern: /目光一闪/g, type: "ACTION", category: "眼神" },
  { pattern: /眼中闪过/g, type: "ACTION", category: "眼神" },
  { pattern: /目光如炬/g, type: "ACTION", category: "眼神" },
  { pattern: /目光深邃/g, type: "ACTION", category: "眼神" },
  { pattern: /眼神一凝/g, type: "ACTION", category: "眼神" },
  // ★ 新增：坚定类表达
  { pattern: /目光坚定/g, type: "ACTION", category: "眼神" },
  { pattern: /眼神坚定/g, type: "ACTION", category: "眼神" },
  { pattern: /语气坚定/g, type: "ACTION", category: "说话" },
  { pattern: /声音坚定/g, type: "ACTION", category: "说话" },
  { pattern: /态度坚定/g, type: "ACTION", category: "态度" },
  { pattern: /神情坚定/g, type: "ACTION", category: "表情" },
  { pattern: /表情坚定/g, type: "ACTION", category: "表情" },
  { pattern: /目光坚毅/g, type: "ACTION", category: "眼神" },
  { pattern: /语气平静/g, type: "ACTION", category: "说话" },
  { pattern: /语气淡然/g, type: "ACTION", category: "说话" },
  { pattern: /语气冰冷/g, type: "ACTION", category: "说话" },
  { pattern: /目光灼灼/g, type: "ACTION", category: "眼神" },
  { pattern: /目光炯炯/g, type: "ACTION", category: "眼神" },
  { pattern: /微微颔首/g, type: "ACTION", category: "点头" },
  { pattern: /轻轻点头/g, type: "ACTION", category: "点头" },
  { pattern: /缓缓摇头/g, type: "ACTION", category: "摇头" },
  { pattern: /轻叹一声/g, type: "ACTION", category: "叹息" },
  { pattern: /长叹一声/g, type: "ACTION", category: "叹息" },
  { pattern: /轻轻叹息/g, type: "ACTION", category: "叹息" },
  // ★ 新增：呼吸/点头/缓慢动作类
  { pattern: /深吸一口气/g, type: "ACTION", category: "呼吸" },
  { pattern: /深呼一口气/g, type: "ACTION", category: "呼吸" },
  { pattern: /长出一口气/g, type: "ACTION", category: "呼吸" },
  { pattern: /微微点头/g, type: "ACTION", category: "点头" },
  { pattern: /缓缓点头/g, type: "ACTION", category: "点头" },
  { pattern: /微微摇头/g, type: "ACTION", category: "摇头" },
  { pattern: /缓缓道/g, type: "ACTION", category: "说话" },
  { pattern: /缓缓说道/g, type: "ACTION", category: "说话" },
  { pattern: /缓缓开口/g, type: "ACTION", category: "说话" },
  { pattern: /嘴角微微上扬/g, type: "ACTION", category: "微笑" },
  { pattern: /嘴角轻轻上扬/g, type: "ACTION", category: "微笑" },

  // ==================== 过渡语类 ====================
  { pattern: /话说/g, type: "TRANSITION", category: "开场" },
  { pattern: /却说/g, type: "TRANSITION", category: "转场" },
  { pattern: /且说/g, type: "TRANSITION", category: "转场" },
  { pattern: /正当此时/g, type: "TRANSITION", category: "时间" },
  { pattern: /就在这时/g, type: "TRANSITION", category: "时间" },
  { pattern: /与此同时/g, type: "TRANSITION", category: "时间" },
  { pattern: /不多时/g, type: "TRANSITION", category: "时间" },
  { pattern: /片刻之后/g, type: "TRANSITION", category: "时间" },
  { pattern: /时光荏苒/g, type: "TRANSITION", category: "时间跨度" },
  { pattern: /岁月如梭/g, type: "TRANSITION", category: "时间跨度" },
  { pattern: /转眼之间/g, type: "TRANSITION", category: "时间" },
  { pattern: /不知不觉/g, type: "TRANSITION", category: "时间" },
  { pattern: /良久之后/g, type: "TRANSITION", category: "时间" },
  { pattern: /须臾之间/g, type: "TRANSITION", category: "时间" },

  // ==================== 环境描写类 ====================
  { pattern: /月光透过[^，。]{2,8}/g, type: "DESCRIPTION", category: "月光" },
  { pattern: /月色如水/g, type: "DESCRIPTION", category: "月光" },
  { pattern: /月华如练/g, type: "DESCRIPTION", category: "月光" },
  { pattern: /晨曦初露/g, type: "DESCRIPTION", category: "晨景" },
  { pattern: /晨光熹微/g, type: "DESCRIPTION", category: "晨景" },
  { pattern: /夕阳西下/g, type: "DESCRIPTION", category: "夕景" },
  { pattern: /夜色深沉/g, type: "DESCRIPTION", category: "夜景" },
  { pattern: /夜幕降临/g, type: "DESCRIPTION", category: "夜景" },
  { pattern: /烛光摇曳/g, type: "DESCRIPTION", category: "光线" },
  { pattern: /灯火阑珊/g, type: "DESCRIPTION", category: "光线" },
  { pattern: /金碧辉煌/g, type: "DESCRIPTION", category: "建筑" },
  { pattern: /雕梁画栋/g, type: "DESCRIPTION", category: "建筑" },
  { pattern: /亭台楼阁/g, type: "DESCRIPTION", category: "建筑" },
  { pattern: /气势恢宏/g, type: "DESCRIPTION", category: "气势" },
  { pattern: /庄严肃穆/g, type: "DESCRIPTION", category: "气氛" },

  // ==================== 人物外貌类 ====================
  { pattern: /一袭[^，。,\.]{2,6}/g, type: "DESCRIPTION", category: "服饰" },
  { pattern: /身着[^，。,\.]{2,8}/g, type: "DESCRIPTION", category: "服饰" },
  { pattern: /面如[^，。,\.]{2,4}/g, type: "DESCRIPTION", category: "外貌" },
  { pattern: /眉如[^，。,\.]{2,4}/g, type: "DESCRIPTION", category: "外貌" },
  { pattern: /肤若[^，。,\.]{2,4}/g, type: "DESCRIPTION", category: "外貌" },
  { pattern: /倾国倾城/g, type: "DESCRIPTION", category: "美貌" },
  { pattern: /国色天香/g, type: "DESCRIPTION", category: "美貌" },
  { pattern: /沉鱼落雁/g, type: "DESCRIPTION", category: "美貌" },
  { pattern: /闭月羞花/g, type: "DESCRIPTION", category: "美貌" },
  { pattern: /仪表堂堂/g, type: "DESCRIPTION", category: "外貌" },
  { pattern: /气宇轩昂/g, type: "DESCRIPTION", category: "气质" },
  { pattern: /风度翩翩/g, type: "DESCRIPTION", category: "气质" },

  // ==================== 情节模式类 ====================
  { pattern: /权力的游戏/g, type: "PLOT_PATTERN", category: "政治" },
  // ★ 新增：权力相关高频表达
  { pattern: /权力[的之]漩涡/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]斗争/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]角逐/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]争夺/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]巅峰/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]中心/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]博弈/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /权力[的之]核心/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /政治[的之]漩涡/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /政治[的之]斗争/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /朝堂[的之上]/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /后宫[的之中]/g, type: "PLOT_PATTERN", category: "政治" },
  { pattern: /暗流涌动/g, type: "PLOT_PATTERN", category: "氛围" },
  { pattern: /波谲云诡/g, type: "PLOT_PATTERN", category: "氛围" },
  { pattern: /风起云涌/g, type: "PLOT_PATTERN", category: "氛围" },
  { pattern: /山雨欲来/g, type: "PLOT_PATTERN", category: "氛围" },
  { pattern: /一触即发/g, type: "PLOT_PATTERN", category: "紧张" },
  { pattern: /剑拔弩张/g, type: "PLOT_PATTERN", category: "紧张" },
  { pattern: /势如破竹/g, type: "PLOT_PATTERN", category: "进展" },
  { pattern: /峰回路转/g, type: "PLOT_PATTERN", category: "转折" },
  { pattern: /柳暗花明/g, type: "PLOT_PATTERN", category: "转折" },
  { pattern: /绝处逢生/g, type: "PLOT_PATTERN", category: "转折" },
  { pattern: /出人意料/g, type: "PLOT_PATTERN", category: "转折" },
  // ★ 新增："这场X"高频模式
  { pattern: /这场斗争/g, type: "PLOT_PATTERN", category: "斗争描述" },
  { pattern: /这场博弈/g, type: "PLOT_PATTERN", category: "斗争描述" },
  { pattern: /这场游戏/g, type: "PLOT_PATTERN", category: "斗争描述" },
  { pattern: /这场较量/g, type: "PLOT_PATTERN", category: "斗争描述" },
  {
    pattern: /这场权力[的之]?博弈/g,
    type: "PLOT_PATTERN",
    category: "政治描述",
  },
  {
    pattern: /这场权力[的之]?游戏/g,
    type: "PLOT_PATTERN",
    category: "政治描述",
  },
  {
    pattern: /这场权力[的之]?斗争/g,
    type: "PLOT_PATTERN",
    category: "政治描述",
  },
  {
    pattern: /这场宫廷[的之]?斗争/g,
    type: "PLOT_PATTERN",
    category: "宫斗描述",
  },
  {
    pattern: /这场无形[的之]?斗争/g,
    type: "PLOT_PATTERN",
    category: "斗争描述",
  },
  // ★ 新增：量词+情感高频模式
  { pattern: /一丝不安/g, type: "EMOTION", category: "不安" },
  { pattern: /一丝期待/g, type: "EMOTION", category: "期待" },
  { pattern: /一丝希望/g, type: "EMOTION", category: "希望" },
  { pattern: /一丝担忧/g, type: "EMOTION", category: "担忧" },
  { pattern: /一丝惊讶/g, type: "EMOTION", category: "惊讶" },
  { pattern: /一丝寒意/g, type: "EMOTION", category: "恐惧" },
  { pattern: /一阵寒意/g, type: "EMOTION", category: "恐惧" },
  { pattern: /一股寒意/g, type: "EMOTION", category: "恐惧" },
  { pattern: /一阵不安/g, type: "EMOTION", category: "不安" },
  { pattern: /一抹冷笑/g, type: "EMOTION", category: "冷笑" },

  // ==================== 对话模式类 ====================
  { pattern: /你可知道/g, type: "DIALOGUE", category: "提问" },
  { pattern: /你可曾想过/g, type: "DIALOGUE", category: "提问" },
  { pattern: /难道你不知道/g, type: "DIALOGUE", category: "反问" },
  { pattern: /这是为何/g, type: "DIALOGUE", category: "疑问" },
  { pattern: /此话怎讲/g, type: "DIALOGUE", category: "疑问" },
  { pattern: /莫非是/g, type: "DIALOGUE", category: "猜测" },
  { pattern: /想必是/g, type: "DIALOGUE", category: "猜测" },
  { pattern: /原来如此/g, type: "DIALOGUE", category: "恍然" },
  { pattern: /恍然大悟/g, type: "DIALOGUE", category: "恍然" },
  { pattern: /不可思议/g, type: "DIALOGUE", category: "惊讶" },

  // ==================== 成语高频类 ====================
  { pattern: /深不可测/g, type: "IDIOM", category: "描述" },
  { pattern: /高深莫测/g, type: "IDIOM", category: "描述" },
  { pattern: /不可一世/g, type: "IDIOM", category: "态度" },
  { pattern: /胸有成竹/g, type: "IDIOM", category: "态度" },
  { pattern: /步步为营/g, type: "IDIOM", category: "策略" },
  { pattern: /运筹帷幄/g, type: "IDIOM", category: "策略" },
  { pattern: /深谋远虑/g, type: "IDIOM", category: "策略" },
  { pattern: /明争暗斗/g, type: "IDIOM", category: "斗争" },
  { pattern: /尔虞我诈/g, type: "IDIOM", category: "斗争" },
  { pattern: /勾心斗角/g, type: "IDIOM", category: "斗争" },

  // ==================== 基础词汇归一化（★最佳实践） ====================
  // 设计原理：
  // 1. 基础词（如"心中"）匹配所有包含该词的文本
  // 2. 当文本为"心中一震"时，会同时匹配具体模式和基础词模式
  // 3. 基础词共享冷却计数，有效防止变体滥用
  // 4. 使用 BASE_WORD 类型，冷却期更长，更严格限制复用

  // ★ 核心高频基础词 - 直接匹配，无 negative lookahead
  { pattern: /心中/g, type: "EMOTION", category: "BASE:心中" },
  { pattern: /心头/g, type: "EMOTION", category: "BASE:心头" },
  { pattern: /心下/g, type: "EMOTION", category: "BASE:心下" },
  { pattern: /心里/g, type: "EMOTION", category: "BASE:心里" },

  // ★ 比喻类基础词 - 之前完全缺失！
  { pattern: /仿佛/g, type: "DESCRIPTION", category: "BASE:比喻" },
  { pattern: /好像/g, type: "DESCRIPTION", category: "BASE:比喻" },
  { pattern: /似乎/g, type: "DESCRIPTION", category: "BASE:比喻" },
  { pattern: /宛如/g, type: "DESCRIPTION", category: "BASE:比喻" },
  { pattern: /犹如/g, type: "DESCRIPTION", category: "BASE:比喻" },
  { pattern: /恍若/g, type: "DESCRIPTION", category: "BASE:比喻" },

  // ★ 动作修饰基础词
  { pattern: /微微/g, type: "ACTION", category: "BASE:微微" },
  { pattern: /缓缓/g, type: "ACTION", category: "BASE:缓缓" },
  { pattern: /轻轻/g, type: "ACTION", category: "BASE:轻轻" },
  { pattern: /静静/g, type: "ACTION", category: "BASE:静静" },
  { pattern: /默默/g, type: "ACTION", category: "BASE:默默" },

  // ★ 情态基础词
  { pattern: /暗自/g, type: "EMOTION", category: "BASE:暗自" },
  { pattern: /不由得/g, type: "EMOTION", category: "BASE:不由" }, // 不由得 归入 不由 类
  { pattern: /不由自主/g, type: "EMOTION", category: "BASE:不由" },
  { pattern: /不禁/g, type: "EMOTION", category: "BASE:不禁" },

  // ★ 程度基础词
  { pattern: /深深/g, type: "DESCRIPTION", category: "BASE:深深" },
  { pattern: /淡淡/g, type: "DESCRIPTION", category: "BASE:淡淡" },

  // ==================== 章节开场模式类（★新增） ====================
  // 场景固定型开场
  {
    pattern: /站在[^，。]{2,8}中/g,
    type: "CHAPTER_OPENING",
    category: "场景固定",
  },
  {
    pattern: /坐在[^，。]{2,8}中/g,
    type: "CHAPTER_OPENING",
    category: "场景固定",
  },
  { pattern: /晨光[^，。]{2,6}洒/g, type: "CHAPTER_OPENING", category: "晨景" },
  { pattern: /月光[^，。]{2,6}洒/g, type: "CHAPTER_OPENING", category: "月景" },
  {
    pattern: /阳光透过[^，。]{2,8}/g,
    type: "CHAPTER_OPENING",
    category: "光线",
  },
  // 配角打断型开场
  {
    pattern: /打断了[^，。]{1,4}的思绪/g,
    type: "CHAPTER_OPENING",
    category: "打断思绪",
  },
  {
    pattern: /声音打破了[^，。]{2,6}/g,
    type: "CHAPTER_OPENING",
    category: "打破宁静",
  },
  // 心理独白型开场
  {
    pattern: /心中[^，。]{2,6}复杂/g,
    type: "CHAPTER_OPENING",
    category: "心理开场",
  },
  {
    pattern: /思绪[^，。]{2,6}飘/g,
    type: "CHAPTER_OPENING",
    category: "心理开场",
  },

  // ==================== 场景结构模式类（★新增） ====================
  // 偷听模式
  {
    pattern: /躲在[^，。]{2,6}偷听/g,
    type: "SCENE_STRUCTURE",
    category: "偷听",
  },
  { pattern: /藏身[^，。]{2,6}听/g, type: "SCENE_STRUCTURE", category: "偷听" },
  {
    pattern: /透过门缝[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "偷窥",
  },
  // 巧遇模式
  {
    pattern: /正巧遇[到见上]/g,
    type: "SCENE_STRUCTURE",
    category: "巧遇",
  },
  {
    pattern: /恰好[^，。]{2,6}经过/g,
    type: "SCENE_STRUCTURE",
    category: "巧遇",
  },
  // 被打断模式
  {
    pattern: /话未说完[^，。]{2,8}打断/g,
    type: "SCENE_STRUCTURE",
    category: "被打断",
  },
  {
    pattern: /正要[^，。]{2,6}却被/g,
    type: "SCENE_STRUCTURE",
    category: "被打断",
  },
  // 深夜密会
  {
    pattern: /夜深人静[^，。]{2,8}来到/g,
    type: "SCENE_STRUCTURE",
    category: "深夜密会",
  },
  {
    pattern: /悄悄来到[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "密会",
  },

  // ★★★ 新增：信息获取方式模式 ★★★
  // 发现信件/密报
  {
    pattern: /发现[^，。]{2,6}信[件笺]/g,
    type: "SCENE_STRUCTURE",
    category: "发现信件",
  },
  {
    pattern: /看到[^，。]{2,6}密[信报]/g,
    type: "SCENE_STRUCTURE",
    category: "发现密报",
  },
  {
    pattern: /无意中[^，。]{2,6}听[到见]/g,
    type: "SCENE_STRUCTURE",
    category: "无意听闻",
  },
  {
    pattern: /不经意间[^，。]{2,6}瞥见/g,
    type: "SCENE_STRUCTURE",
    category: "无意瞥见",
  },
  // 被告知/被通风报信
  {
    pattern: /有人来报[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "来人禀报",
  },
  {
    pattern: /急匆匆[^，。]{2,6}来报/g,
    type: "SCENE_STRUCTURE",
    category: "来人禀报",
  },

  // ★★★ 新增：冲突触发模式 ★★★
  // 误会触发
  {
    pattern: /误以为[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "误会冲突",
  },
  {
    pattern: /以为[^，。]{2,6}却原来/g,
    type: "SCENE_STRUCTURE",
    category: "误会冲突",
  },
  // 第三者介入
  {
    pattern: /忽然有人[^，。]{2,6}闯入/g,
    type: "SCENE_STRUCTURE",
    category: "第三者介入",
  },
  {
    pattern: /不速之客[^，。]{2,6}到来/g,
    type: "SCENE_STRUCTURE",
    category: "第三者介入",
  },
  // 旧事重提
  {
    pattern: /提起[^，。]{2,6}旧事/g,
    type: "SCENE_STRUCTURE",
    category: "旧事重提",
  },
  {
    pattern: /想起[^，。]{2,6}往事/g,
    type: "SCENE_STRUCTURE",
    category: "回忆往事",
  },

  // ★★★ 新增：解决方式模式 ★★★
  // 外力介入解决
  {
    pattern: /就在这时[^，。]{2,8}出现/g,
    type: "SCENE_STRUCTURE",
    category: "外力介入",
  },
  {
    pattern: /恰在此刻[^，。]{2,8}赶到/g,
    type: "SCENE_STRUCTURE",
    category: "外力介入",
  },
  // 主角隐忍
  {
    pattern: /只得[^，。]{2,6}忍下/g,
    type: "SCENE_STRUCTURE",
    category: "主角隐忍",
  },
  {
    pattern: /压下[^，。]{2,6}怒火/g,
    type: "SCENE_STRUCTURE",
    category: "主角隐忍",
  },
  // 妥协和解
  {
    pattern: /各退一步[^，。]{2,6}/g,
    type: "SCENE_STRUCTURE",
    category: "妥协和解",
  },
  {
    pattern: /暂时搁置[^，。]{2,6}/g,
    type: "SCENE_STRUCTURE",
    category: "搁置争议",
  },

  // ★★★ 新增：情节便利模式（Deus ex machina）★★★
  {
    pattern: /凑巧[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "巧合便利",
  },
  {
    pattern: /幸好[^，。]{2,6}否则/g,
    type: "SCENE_STRUCTURE",
    category: "巧合便利",
  },
  {
    pattern: /多亏[^，。]{2,6}及时/g,
    type: "SCENE_STRUCTURE",
    category: "巧合便利",
  },

  // ★★★ 新增：场景转换模式 ★★★
  {
    pattern: /话分两头[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "场景切换",
  },
  {
    pattern: /却说[^，。]{2,6}那边/g,
    type: "SCENE_STRUCTURE",
    category: "场景切换",
  },
  {
    pattern: /另一边[^，。]{2,8}/g,
    type: "SCENE_STRUCTURE",
    category: "场景切换",
  },

  // ==================== 叙事节奏模式类（★新增） ====================
  // 被动观察型（主角无作为）
  {
    pattern: /只能[^，。]{2,6}看着/g,
    type: "NARRATIVE_PACING",
    category: "被动观察",
  },
  {
    pattern: /默默[^，。]{2,6}注视/g,
    type: "NARRATIVE_PACING",
    category: "被动观察",
  },
  {
    pattern: /静静地站在[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "被动等待",
  },
  // 重复询问型
  {
    pattern: /这究竟是怎么回事/g,
    type: "NARRATIVE_PACING",
    category: "重复疑问",
  },
  {
    pattern: /到底发生了什么/g,
    type: "NARRATIVE_PACING",
    category: "重复疑问",
  },
  // 拖延型叙事
  {
    pattern: /不知过了多久/g,
    type: "NARRATIVE_PACING",
    category: "时间拖延",
  },
  {
    pattern: /时间一点一点过去/g,
    type: "NARRATIVE_PACING",
    category: "时间拖延",
  },

  // ★★★ 新增：情绪循环模式（防止情绪反复） ★★★
  {
    pattern: /又[^，。]{2,4}一阵[^，。]{2,4}涌上心头/g,
    type: "NARRATIVE_PACING",
    category: "情绪反复",
  },
  {
    pattern: /心中[^，。]{2,4}复杂的情绪/g,
    type: "NARRATIVE_PACING",
    category: "情绪复杂",
  },
  {
    pattern: /说不清是[^，。]{2,8}还是/g,
    type: "NARRATIVE_PACING",
    category: "情绪复杂",
  },

  // ★★★ 新增：信息堆砌模式（防止情节灌输） ★★★
  {
    pattern: /原来[^，。]{2,8}原来[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "信息堆砌",
  },
  {
    pattern: /这才知道[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "信息揭示",
  },
  {
    pattern: /事情的真相[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "真相揭示",
  },

  // ★★★ 新增：主角被动模式（防止主角变NPC） ★★★
  {
    pattern: /只好[^，。]{2,6}照做/g,
    type: "NARRATIVE_PACING",
    category: "主角被动",
  },
  {
    pattern: /无可奈何[^，。]{2,6}只得/g,
    type: "NARRATIVE_PACING",
    category: "主角被动",
  },
  {
    pattern: /被[^，。]{2,6}带到[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "主角被动",
  },

  // ★★★ 新增：转折预告模式（防止虚假悬念） ★★★
  {
    pattern: /殊不知[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "上帝视角",
  },
  {
    pattern: /谁也没想到[^，。]{2,8}/g,
    type: "NARRATIVE_PACING",
    category: "上帝视角",
  },
  {
    pattern: /这一切都是[^，。]{2,6}安排/g,
    type: "NARRATIVE_PACING",
    category: "幕后黑手",
  },
];

// ==================== 类型定义 ====================

export interface ExpressionRecord {
  expression: string;
  type: ExpressionType;
  category?: string;
  useCount: number;
  lastChapterId?: string;
  isCoolingDown: boolean;
  cooldownUntil?: Date;
}

export interface CoolingExpression {
  expression: string;
  type: ExpressionType;
  useCount: number;
  remainingCooldown: number; // 剩余冷却章节数
}

export interface ExpressionAnalysisResult {
  /** 新发现的表达 */
  newExpressions: Array<{
    expression: string;
    type: ExpressionType;
    category?: string;
  }>;
  /** 重复使用的表达（违反冷却期） */
  violatedExpressions: Array<{ expression: string; useCount: number }>;
  /** 高频表达警告 */
  highFrequencyWarnings: Array<{ expression: string; useCount: number }>;
}

// ==================== 服务实现 ====================

@Injectable()
export class ExpressionMemoryService {
  private readonly logger = new Logger(ExpressionMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 核心查询方法 ====================

  /**
   * 获取当前处于冷却期的表达列表
   *
   * Writer Agent 在写作前调用此方法获取禁用列表
   *
   * @param projectId 项目ID
   * @param currentChapterNumber 当前章节号
   * @param limit 最大返回数量（默认200，防止 prompt 过长）
   */
  async getCoolingExpressions(
    projectId: string,
    currentChapterNumber: number,
    limit: number = 200,
  ): Promise<CoolingExpression[]> {
    const expressions = await this.prisma.writingExpressionMemory.findMany({
      where: {
        projectId,
        isCoolingDown: true,
      },
      orderBy: { useCount: "desc" },
      take: limit, // ★ 性能优化：限制返回数量
    });

    return expressions.map((expr) => ({
      expression: expr.expression,
      type: expr.expressionType,
      useCount: expr.useCount,
      remainingCooldown: this.calculateRemainingCooldown(
        expr,
        currentChapterNumber,
      ),
    }));
  }

  /**
   * 获取高频表达列表（用于警告）
   */
  async getHighFrequencyExpressions(
    projectId: string,
    threshold: number = 5,
  ): Promise<ExpressionRecord[]> {
    const expressions = await this.prisma.writingExpressionMemory.findMany({
      where: {
        projectId,
        useCount: { gte: threshold },
      },
      orderBy: { useCount: "desc" },
      take: 50,
    });

    return expressions.map((expr) => ({
      expression: expr.expression,
      type: expr.expressionType,
      category: expr.category ?? undefined,
      useCount: expr.useCount,
      lastChapterId: expr.lastChapterId ?? undefined,
      isCoolingDown: expr.isCoolingDown,
      cooldownUntil: expr.cooldownUntil ?? undefined,
    }));
  }

  /**
   * 生成禁用表达提示词（供 Writer Agent 使用）
   */
  async generateAvoidancePrompt(
    projectId: string,
    currentChapterNumber: number,
  ): Promise<string> {
    // ★ 关键：先刷新冷却状态，解除已过期的表达
    await this.refreshCooldownStatus(projectId, currentChapterNumber);

    const coolingExpressions = await this.getCoolingExpressions(
      projectId,
      currentChapterNumber,
    );
    const highFrequency = await this.getHighFrequencyExpressions(projectId, 3);

    if (coolingExpressions.length === 0 && highFrequency.length === 0) {
      return "";
    }

    const parts: string[] = [];

    if (coolingExpressions.length > 0) {
      // ★ 限制每种类型最多显示 15 个，防止 prompt 过长
      const maxPerType = 15;
      const grouped = this.groupByType(coolingExpressions);
      parts.push("## 禁用表达与替代建议\n");
      parts.push(
        "以下表达处于冷却期，请使用右侧的替代方案或自行创造新表达：\n",
      );

      for (const [type, exprs] of Object.entries(grouped)) {
        const typeLabel = this.getTypeLabel(type as ExpressionType);
        const limitedExprs = exprs.slice(0, maxPerType);
        parts.push(`### ${typeLabel}`);

        for (const expr of limitedExprs) {
          const alternatives = getAlternatives(expr.expression);
          if (alternatives.length > 0) {
            // 有替代建议：显示 ❌ 原表达 → ✅ 替代方案
            parts.push(
              `- ❌ "${expr.expression}" → ✅ ${alternatives.slice(0, 3).join(" / ")}`,
            );
          } else {
            // 无替代建议：只显示禁用
            parts.push(
              `- ❌ "${expr.expression}" (已用${expr.useCount}次，请创造新表达)`,
            );
          }
        }

        if (exprs.length > maxPerType) {
          parts.push(`  ...及其他 ${exprs.length - maxPerType} 个`);
        }
        parts.push("");
      }
    }

    if (highFrequency.length > 0) {
      parts.push("## 高频警告（建议使用替代表达）");
      const warnings: string[] = [];
      for (const expr of highFrequency.slice(0, 20)) {
        const alternatives = getAlternatives(expr.expression);
        if (alternatives.length > 0) {
          warnings.push(
            `- ⚠️ "${expr.expression}" (${expr.useCount}次) → 建议: ${alternatives.slice(0, 2).join(" / ")}`,
          );
        } else {
          warnings.push(`- ⚠️ "${expr.expression}" (已用${expr.useCount}次)`);
        }
      }
      parts.push(warnings.join("\n"));
    }

    return parts.join("\n");
  }

  // ==================== 内容分析方法 ====================

  /**
   * 只分析表达，不记录到数据库（用于质量评估）
   *
   * ★ 重要：QualityGate 评估时使用此方法，避免重复记录
   */
  async analyzeExpressionsOnly(
    projectId: string,
    content: string,
  ): Promise<ExpressionAnalysisResult> {
    const result: ExpressionAnalysisResult = {
      newExpressions: [],
      violatedExpressions: [],
      highFrequencyWarnings: [],
    };

    // 1. 使用模式匹配检测表达
    const detectedExpressions = this.detectExpressions(content);

    // 2. 批量查询已有记录
    const existingRecords = await this.prisma.writingExpressionMemory.findMany({
      where: {
        projectId,
        expression: { in: detectedExpressions.map((e) => e.expression) },
      },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.expression, r]));

    // 3. 只分析，不记录
    for (const detected of detectedExpressions) {
      const existing = existingMap.get(detected.expression);

      if (existing) {
        // 已存在的表达：检查是否违反冷却期
        if (existing.isCoolingDown) {
          result.violatedExpressions.push({
            expression: detected.expression,
            useCount: existing.useCount + detected.count,
          });
        }

        // 高频警告
        if (existing.useCount + detected.count >= 5) {
          result.highFrequencyWarnings.push({
            expression: detected.expression,
            useCount: existing.useCount + detected.count,
          });
        }
      } else {
        // 新表达
        result.newExpressions.push({
          expression: detected.expression,
          type: detected.type,
          category: detected.category,
        });
      }
    }

    return result;
  }

  /**
   * 分析章节内容，提取并记录表达
   *
   * ★ 只在章节最终保存时调用，避免重复记录
   */
  async analyzeAndRecordExpressions(
    projectId: string,
    chapterId: string,
    chapterNumber: number,
    content: string,
  ): Promise<ExpressionAnalysisResult> {
    const result: ExpressionAnalysisResult = {
      newExpressions: [],
      violatedExpressions: [],
      highFrequencyWarnings: [],
    };

    // 1. 使用模式匹配检测表达
    const detectedExpressions = this.detectExpressions(content);

    // 2. 批量查询已有记录
    const existingRecords = await this.prisma.writingExpressionMemory.findMany({
      where: {
        projectId,
        expression: { in: detectedExpressions.map((e) => e.expression) },
      },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.expression, r]));

    // 3. 处理每个检测到的表达
    for (const detected of detectedExpressions) {
      const existing = existingMap.get(detected.expression);

      if (existing) {
        // 已存在的表达：更新计数和冷却状态
        const newCount = existing.useCount + detected.count;

        // 检查是否违反冷却期
        if (existing.isCoolingDown) {
          result.violatedExpressions.push({
            expression: detected.expression,
            useCount: newCount,
          });
        }

        // 高频警告
        if (newCount >= 5) {
          result.highFrequencyWarnings.push({
            expression: detected.expression,
            useCount: newCount,
          });
        }

        // 更新记录
        await this.updateExpressionRecord(
          existing.id,
          chapterId,
          chapterNumber,
          detected.count,
        );
      } else {
        // 新表达：创建记录
        result.newExpressions.push({
          expression: detected.expression,
          type: detected.type,
          category: detected.category,
        });

        await this.createExpressionRecord(
          projectId,
          detected.expression,
          detected.type,
          detected.category,
          chapterId,
          chapterNumber,
        );
      }
    }

    this.logger.log(
      `[ExpressionMemory] Analyzed chapter ${chapterNumber}: ` +
        `${result.newExpressions.length} new, ` +
        `${result.violatedExpressions.length} violated, ` +
        `${result.highFrequencyWarnings.length} high-frequency`,
    );

    return result;
  }

  /**
   * 检测内容中的表达
   */
  private detectExpressions(content: string): Array<{
    expression: string;
    type: ExpressionType;
    category?: string;
    count: number;
  }> {
    const detected = new Map<
      string,
      {
        expression: string;
        type: ExpressionType;
        category?: string;
        count: number;
      }
    >();

    for (const pattern of COMMON_EXPRESSION_PATTERNS) {
      const matches = content.match(pattern.pattern);
      if (matches) {
        for (const match of matches) {
          // ★ 关键：BASE: 类别归一化 - 提取基础词作为 key
          // 例如：category="BASE:心中" → 无论匹配"心中一震"还是"心中想着"，都归一化为"心中"
          let normalizedKey = match;
          let normalizedExpr = match;

          if (pattern.category?.startsWith("BASE:")) {
            // 从 "BASE:心中" 提取 "心中"
            normalizedExpr = pattern.category.substring(5);
            normalizedKey = `BASE:${normalizedExpr}`;
          }

          const existing = detected.get(normalizedKey);
          if (existing) {
            existing.count++;
          } else {
            detected.set(normalizedKey, {
              expression: normalizedExpr,
              type: pattern.type,
              category: pattern.category,
              count: 1,
            });
          }
        }
      }
    }

    return Array.from(detected.values());
  }

  // ==================== 记录管理方法 ====================

  /**
   * 创建新的表达记录
   */
  private async createExpressionRecord(
    projectId: string,
    expression: string,
    type: ExpressionType,
    category: string | undefined,
    chapterId: string,
    chapterNumber: number,
  ): Promise<void> {
    const cooldownChapters = this.getCooldownChapters(type, 1);

    // ★ 使用 upsert 防止并发场景下的唯一索引冲突
    await this.prisma.writingExpressionMemory.upsert({
      where: {
        projectId_expression: {
          projectId,
          expression,
        },
      },
      create: {
        projectId,
        expression,
        expressionType: type,
        category,
        useCount: 1,
        lastUsedAt: new Date(),
        lastChapterId: chapterId,
        lastUsedChapterNumber: chapterNumber, // ★ 记录章节号
        isCoolingDown: true,
        cooldownUntilChapter: this.calculateCooldownEndChapter(
          chapterNumber,
          cooldownChapters,
        ), // ★ 使用章节号而非时间
      },
      update: {
        // 如果已存在（并发创建），增加计数
        useCount: { increment: 1 },
        lastUsedAt: new Date(),
        lastChapterId: chapterId,
        lastUsedChapterNumber: chapterNumber, // ★ 记录章节号
        isCoolingDown: true,
        cooldownUntilChapter: this.calculateCooldownEndChapter(
          chapterNumber,
          cooldownChapters,
        ), // ★ 使用章节号而非时间
      },
    });
  }

  /**
   * 更新已有表达记录
   */
  private async updateExpressionRecord(
    recordId: string,
    chapterId: string,
    chapterNumber: number,
    additionalCount: number,
  ): Promise<void> {
    const record = await this.prisma.writingExpressionMemory.findUnique({
      where: { id: recordId },
    });

    if (!record) return;

    const newCount = record.useCount + additionalCount;
    const cooldownChapters = this.getCooldownChapters(
      record.expressionType,
      newCount,
    );

    await this.prisma.writingExpressionMemory.update({
      where: { id: recordId },
      data: {
        useCount: newCount,
        lastUsedAt: new Date(),
        lastChapterId: chapterId,
        lastUsedChapterNumber: chapterNumber, // ★ 记录章节号
        isCoolingDown: true,
        cooldownUntilChapter: this.calculateCooldownEndChapter(
          chapterNumber,
          cooldownChapters,
        ), // ★ 使用章节号而非时间
      },
    });
  }

  /**
   * 更新冷却状态（写作前调用）
   *
   * ★ 重要修复：使用章节号而非时间来判断冷却是否结束
   */
  async refreshCooldownStatus(
    projectId: string,
    currentChapterNumber?: number,
  ): Promise<void> {
    // 如果没有提供当前章节号，无法判断冷却状态
    if (!currentChapterNumber) {
      this.logger.warn(
        "[ExpressionMemory] refreshCooldownStatus called without chapter number, skipping",
      );
      return;
    }

    // 获取所有冷却中的表达
    const coolingExpressions =
      await this.prisma.writingExpressionMemory.findMany({
        where: {
          projectId,
          isCoolingDown: true,
        },
      });

    const updates: string[] = [];

    for (const expr of coolingExpressions) {
      // ★ 使用章节号判断冷却是否结束
      // 如果当前章节 >= 冷却截止章节，则解除冷却
      if (
        expr.cooldownUntilChapter &&
        currentChapterNumber >= expr.cooldownUntilChapter
      ) {
        updates.push(expr.id);
      }
    }

    if (updates.length > 0) {
      await this.prisma.writingExpressionMemory.updateMany({
        where: { id: { in: updates } },
        data: { isCoolingDown: false },
      });

      this.logger.log(
        `[ExpressionMemory] Released ${updates.length} expressions from cooldown (chapter ${currentChapterNumber})`,
      );
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取表达类型的冷却章节数
   */
  private getCooldownChapters(type: ExpressionType, useCount: number): number {
    let base: number;

    switch (type) {
      case "IDIOM":
        base = EXPRESSION_COOLDOWN_CONFIG.idiomCooldownChapters;
        break;
      case "EMOTION":
        base = EXPRESSION_COOLDOWN_CONFIG.emotionCooldownChapters;
        break;
      case "TRANSITION":
        base = EXPRESSION_COOLDOWN_CONFIG.transitionCooldownChapters;
        break;
      // ★新增：章节开场模式冷却期最长，防止每章开场雷同
      case "CHAPTER_OPENING":
        base = EXPRESSION_COOLDOWN_CONFIG.chapterOpeningCooldownChapters;
        break;
      // ★新增：场景结构模式冷却
      case "SCENE_STRUCTURE":
        base = EXPRESSION_COOLDOWN_CONFIG.sceneStructureCooldownChapters;
        break;
      // ★新增：叙事节奏模式冷却
      case "NARRATIVE_PACING":
        base = EXPRESSION_COOLDOWN_CONFIG.narrativePacingCooldownChapters;
        break;
      default:
        base = EXPRESSION_COOLDOWN_CONFIG.defaultCooldownChapters;
    }

    // 高频使用的表达需要更长冷却期
    if (useCount >= 3) {
      base = Math.max(
        base,
        EXPRESSION_COOLDOWN_CONFIG.highFrequencyCooldownChapters,
      );
    }

    return base;
  }

  /**
   * 计算冷却结束章节号
   *
   * ★ 重要修复：使用章节数而非墙钟时间
   * 之前的 bug：冷却10章被转换为冷却10小时，如果用户快速写作，冷却会过早失效
   */
  private calculateCooldownEndChapter(
    currentChapter: number,
    cooldownChapters: number,
  ): number {
    // 直接返回目标章节号：当前章节 + 冷却章节数
    return currentChapter + cooldownChapters;
  }

  /**
   * 计算剩余冷却章节数
   *
   * ★ 重要修复：使用章节号而非时间
   */
  private calculateRemainingCooldown(
    expr: {
      cooldownUntilChapter: number | null;
      useCount: number;
      expressionType: ExpressionType;
    },
    currentChapterNumber: number,
  ): number {
    if (!expr.cooldownUntilChapter) {
      return 0;
    }

    // 直接计算剩余章节数
    const remaining = expr.cooldownUntilChapter - currentChapterNumber;
    return Math.max(0, remaining);
  }

  /**
   * 按类型分组表达
   */
  private groupByType(
    expressions: CoolingExpression[],
  ): Record<string, CoolingExpression[]> {
    const groups: Record<string, CoolingExpression[]> = {};

    for (const expr of expressions) {
      const type = expr.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(expr);
    }

    return groups;
  }

  /**
   * 获取表达类型的中文标签
   */
  private getTypeLabel(type: ExpressionType): string {
    const labels: Record<ExpressionType, string> = {
      IDIOM: "成语",
      METAPHOR: "比喻",
      DESCRIPTION: "描写手法",
      EMOTION: "情感表达",
      ACTION: "动作描写",
      DIALOGUE: "对话模式",
      TRANSITION: "过渡语",
      PLOT_PATTERN: "情节模式",
      CHAPTER_OPENING: "章节开场",
      SCENE_STRUCTURE: "场景结构",
      NARRATIVE_PACING: "叙事节奏",
    };

    return labels[type] || type;
  }

  // ==================== 统计方法 ====================

  /**
   * 获取项目表达统计
   */
  async getProjectExpressionStats(projectId: string): Promise<{
    totalExpressions: number;
    coolingCount: number;
    highFrequencyCount: number;
    byType: Record<string, number>;
  }> {
    const [total, cooling, highFrequency, byType] = await Promise.all([
      this.prisma.writingExpressionMemory.count({ where: { projectId } }),
      this.prisma.writingExpressionMemory.count({
        where: { projectId, isCoolingDown: true },
      }),
      this.prisma.writingExpressionMemory.count({
        where: { projectId, useCount: { gte: 5 } },
      }),
      this.prisma.writingExpressionMemory.groupBy({
        by: ["expressionType"],
        where: { projectId },
        _count: true,
      }),
    ]);

    const typeStats: Record<string, number> = {};
    for (const item of byType) {
      typeStats[item.expressionType] = item._count;
    }

    return {
      totalExpressions: total,
      coolingCount: cooling,
      highFrequencyCount: highFrequency,
      byType: typeStats,
    };
  }

  // ==================== 动态表达学习 ====================

  /**
   * 从项目历史内容中学习新的重复模式
   *
   * 策略：
   * 1. 扫描所有章节内容
   * 2. 提取 3-6 字的短语
   * 3. 统计出现频率
   * 4. 识别高频短语（超过阈值）
   * 5. 过滤常见词汇和已有模式
   * 6. 添加到表达记忆
   */
  async learnFromProjectContent(
    projectId: string,
    minFrequency: number = 5,
  ): Promise<{
    newPatterns: Array<{ expression: string; frequency: number }>;
    totalAnalyzed: number;
  }> {
    this.logger.log(
      `[ExpressionMemory] Starting dynamic learning for project ${projectId}`,
    );

    // 1. 获取项目所有章节内容
    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        content: { not: null },
      },
      select: { content: true, chapterNumber: true },
      orderBy: { chapterNumber: "asc" },
    });

    if (chapters.length === 0) {
      return { newPatterns: [], totalAnalyzed: 0 };
    }

    // 2. 合并所有内容
    const allContent = chapters.map((ch) => ch.content || "").join("\n");

    // 3. 提取 n-gram 短语并统计频率
    const phraseFrequency = new Map<string, number>();
    const ngramLengths = [3, 4, 5, 6]; // 3-6 字短语

    for (const n of ngramLengths) {
      for (let i = 0; i <= allContent.length - n; i++) {
        const phrase = allContent.slice(i, i + n);

        // 过滤：必须全是中文字符
        if (!/^[\u4e00-\u9fa5]+$/.test(phrase)) continue;

        // 过滤：不能包含常见虚词开头/结尾
        if (this.isCommonWord(phrase)) continue;

        const count = phraseFrequency.get(phrase) || 0;
        phraseFrequency.set(phrase, count + 1);
      }
    }

    // 4. 筛选高频短语
    const highFrequencyPhrases: Array<{
      expression: string;
      frequency: number;
    }> = [];

    for (const [phrase, count] of phraseFrequency) {
      if (count >= minFrequency) {
        // 检查是否已在静态模式中
        const isStaticPattern = COMMON_EXPRESSION_PATTERNS.some((p) =>
          p.pattern.test(phrase),
        );

        // 检查是否已在数据库中
        const existsInDb = await this.prisma.writingExpressionMemory.findFirst({
          where: { projectId, expression: phrase },
        });

        if (!isStaticPattern && !existsInDb) {
          highFrequencyPhrases.push({ expression: phrase, frequency: count });
        }
      }
    }

    // 5. 按频率排序，取前 50 个
    highFrequencyPhrases.sort((a, b) => b.frequency - a.frequency);
    const topPhrases = highFrequencyPhrases.slice(0, 50);

    // 6. 添加到表达记忆（标记为动态学习）
    // 获取当前最大章节号作为基准
    const maxChapter = chapters.length;

    for (const { expression, frequency } of topPhrases) {
      const type = this.inferExpressionType(expression);

      await this.prisma.writingExpressionMemory.create({
        data: {
          projectId,
          expression,
          expressionType: type,
          category: "动态学习",
          useCount: frequency,
          lastUsedAt: new Date(),
          lastUsedChapterNumber: maxChapter,
          isCoolingDown: frequency >= 10, // 高频直接进入冷却
          cooldownUntilChapter:
            frequency >= 10
              ? this.calculateCooldownEndChapter(maxChapter, 15)
              : null,
        },
      });
    }

    this.logger.log(
      `[ExpressionMemory] Learned ${topPhrases.length} new patterns from ${chapters.length} chapters`,
    );

    return {
      newPatterns: topPhrases,
      totalAnalyzed: chapters.length,
    };
  }

  /**
   * 检查是否为常见虚词/无意义短语
   */
  private isCommonWord(phrase: string): boolean {
    const commonPatterns = [
      /^[的地得了着过]/,
      /[的地得了着过]$/,
      /^[是在有为]/,
      /^[这那其]/,
      /^[我你他她它们]/,
      /[也就都还]/,
      /^[一二三四五六七八九十]/,
      /[个只条件]$/,
    ];

    return commonPatterns.some((p) => p.test(phrase));
  }

  /**
   * 推断表达类型
   */
  private inferExpressionType(expression: string): ExpressionType {
    // 基于关键词推断类型
    if (/心|情|感|怒|喜|悲|惧|惊/.test(expression)) {
      return "EMOTION";
    }
    if (/道|说|言|语|喊|叫|问/.test(expression)) {
      return "DIALOGUE";
    }
    if (/时|刻|间|后|前|之/.test(expression)) {
      return "TRANSITION";
    }
    if (/眼|眉|目|脸|面|唇|嘴/.test(expression)) {
      return "ACTION";
    }
    if (/月|日|风|云|雨|雪|光/.test(expression)) {
      return "DESCRIPTION";
    }

    return "DESCRIPTION"; // 默认
  }
}
