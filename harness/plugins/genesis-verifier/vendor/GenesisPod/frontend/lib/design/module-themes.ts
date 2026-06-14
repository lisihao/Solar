/**
 * Module Themes — 每个菜单（模块）的识别色，全站唯一事实源（SSOT）。
 *
 * 设计系统约定（2026-05-22 与用户确认）：
 *   - 骨架统一：圆角(rounded-xl 上限)/弹框外壳/间距/组件复用 全站一致（见标准 21/22）。
 *   - 识别色按模块区分：每个菜单一个主色调，侧边栏激活态 / 模块头部渐变 / 图标 /
 *     强调件 全部读这里，禁止在 feature 里散落硬编码 bg-{hue}-50 / from-x。
 *   - primaryHsl：按路由覆盖全局 --primary CSS 变量（见 ModuleThemeProvider），
 *     让该模块页面内所有 `bg-primary`/focus 强调件自动变成模块色，无需改 Button。
 *
 * Tailwind 注意：class 必须是「字面量」才能被扫描保留，故此处全部写全名，
 * 不得用 `bg-${hue}-50` 之类拼接。新增模块时在此补一整行。
 */

export type ModuleKey =
  | 'ask'
  | 'explore'
  | 'library'
  | 'radar'
  | 'insights'
  | 'research'
  | 'discuss'
  | 'planning'
  | 'decision'
  | 'report'
  | 'writing'
  | 'social'
  | 'playground'
  | 'market'
  | 'company';

export interface ModuleTheme {
  /** Tailwind 色相名（文档/调试用） */
  hue: string;
  /** 激活态浅底（侧边栏激活项 / 选中卡背景） */
  activeBg: string;
  /** 主文字 / 图标强调色（激活态文字、模块标题色） */
  text: string;
  /** 图标强调色（略浅于 text，用于激活图标） */
  icon: string;
  /** 浅底（chip / tag / soft surface） */
  softBg: string;
  /** ring / 边框强调 */
  ring: string;
  /** 状态点 / 进度条 */
  dot: string;
  /** 模块头部图标渐变（hero / MissionDetailFrame，"from-x to-y"，不含 bg-gradient-*） */
  gradient: string;
  /** 该模块 -600 主色的 HSL（"H S% L%"），用于按路由覆盖 --primary CSS 变量 */
  primaryHsl: string;
}

/**
 * 13 个菜单的色系分配。冷色块=知识与洞察、暖色块=推演决策、绿/品红/玫红/紫=内容与实验。
 * social=rose、playground=violet 为既有强关联，保留。primaryHsl = Tailwind 对应 -600 色。
 */
export const MODULE_THEMES: Record<ModuleKey, ModuleTheme> = {
  ask: {
    hue: 'blue',
    activeBg: 'bg-blue-50',
    text: 'text-blue-700',
    icon: 'text-blue-600',
    softBg: 'bg-blue-50',
    ring: 'ring-blue-200',
    dot: 'bg-blue-500',
    gradient: 'from-blue-500 to-indigo-600',
    primaryHsl: '221.2 83.2% 53.3%',
  },
  explore: {
    hue: 'sky',
    activeBg: 'bg-sky-50',
    text: 'text-sky-700',
    icon: 'text-sky-600',
    softBg: 'bg-sky-50',
    ring: 'ring-sky-200',
    dot: 'bg-sky-500',
    gradient: 'from-sky-500 to-blue-600',
    primaryHsl: '200.4 98% 39.4%',
  },
  library: {
    hue: 'teal',
    activeBg: 'bg-teal-50',
    text: 'text-teal-700',
    icon: 'text-teal-600',
    softBg: 'bg-teal-50',
    ring: 'ring-teal-200',
    dot: 'bg-teal-500',
    gradient: 'from-teal-500 to-emerald-600',
    primaryHsl: '174.7 83.9% 31.6%',
  },
  radar: {
    hue: 'cyan',
    activeBg: 'bg-cyan-50',
    text: 'text-cyan-700',
    icon: 'text-cyan-600',
    softBg: 'bg-cyan-50',
    ring: 'ring-cyan-200',
    dot: 'bg-cyan-500',
    gradient: 'from-cyan-500 to-sky-600',
    primaryHsl: '191.6 91.4% 36.5%',
  },
  insights: {
    hue: 'indigo',
    activeBg: 'bg-indigo-50',
    text: 'text-indigo-700',
    icon: 'text-indigo-600',
    softBg: 'bg-indigo-50',
    ring: 'ring-indigo-200',
    dot: 'bg-indigo-500',
    gradient: 'from-indigo-500 to-violet-600',
    primaryHsl: '243.4 75.4% 58.6%',
  },
  research: {
    hue: 'purple',
    activeBg: 'bg-purple-50',
    text: 'text-purple-700',
    icon: 'text-purple-600',
    softBg: 'bg-purple-50',
    ring: 'ring-purple-200',
    dot: 'bg-purple-500',
    gradient: 'from-purple-500 to-fuchsia-600',
    primaryHsl: '271.5 81.3% 55.9%',
  },
  discuss: {
    hue: 'amber',
    activeBg: 'bg-amber-50',
    text: 'text-amber-700',
    icon: 'text-amber-600',
    softBg: 'bg-amber-50',
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
    gradient: 'from-amber-500 to-orange-600',
    primaryHsl: '32 94.6% 43.7%',
  },
  planning: {
    hue: 'orange',
    activeBg: 'bg-orange-50',
    text: 'text-orange-700',
    icon: 'text-orange-600',
    softBg: 'bg-orange-50',
    ring: 'ring-orange-200',
    dot: 'bg-orange-500',
    gradient: 'from-orange-500 to-amber-600',
    primaryHsl: '20.5 90.2% 48.2%',
  },
  decision: {
    hue: 'red',
    activeBg: 'bg-red-50',
    text: 'text-red-700',
    icon: 'text-red-600',
    softBg: 'bg-red-50',
    ring: 'ring-red-200',
    dot: 'bg-red-500',
    gradient: 'from-red-500 to-orange-600',
    primaryHsl: '0 72.2% 50.6%',
  },
  report: {
    hue: 'emerald',
    activeBg: 'bg-emerald-50',
    text: 'text-emerald-700',
    icon: 'text-emerald-600',
    softBg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    dot: 'bg-emerald-500',
    gradient: 'from-emerald-500 to-teal-600',
    primaryHsl: '160.1 84.1% 39.4%',
  },
  writing: {
    hue: 'fuchsia',
    activeBg: 'bg-fuchsia-50',
    text: 'text-fuchsia-700',
    icon: 'text-fuchsia-600',
    softBg: 'bg-fuchsia-50',
    ring: 'ring-fuchsia-200',
    dot: 'bg-fuchsia-500',
    gradient: 'from-fuchsia-500 to-purple-600',
    primaryHsl: '292.7 84.1% 50.6%',
  },
  social: {
    hue: 'rose',
    activeBg: 'bg-rose-50',
    text: 'text-rose-700',
    icon: 'text-rose-600',
    softBg: 'bg-rose-50',
    ring: 'ring-rose-200',
    dot: 'bg-rose-500',
    gradient: 'from-rose-500 to-pink-600',
    primaryHsl: '346.8 77.2% 49.8%',
  },
  playground: {
    hue: 'violet',
    activeBg: 'bg-violet-50',
    text: 'text-violet-700',
    icon: 'text-violet-600',
    softBg: 'bg-violet-50',
    ring: 'ring-violet-200',
    dot: 'bg-violet-500',
    gradient: 'from-violet-500 to-purple-600',
    primaryHsl: '262.1 83.3% 57.8%',
  },
  // market：智能体市场（平台共享货架）。翡翠绿=交易/市集；emerald 已被 report 占用，
  // 故用 green，与 report(emerald) 色相相邻但不撞。primaryHsl = Tailwind green-600。
  market: {
    hue: 'green',
    activeBg: 'bg-green-50',
    text: 'text-green-700',
    icon: 'text-green-600',
    softBg: 'bg-green-50',
    ring: 'ring-green-200',
    dot: 'bg-green-500',
    gradient: 'from-green-500 to-emerald-600',
    primaryHsl: '142.1 76.2% 36.3%',
  },
  // company：我的团队（一人公司私有后台）。沉稳灰蓝=董事会气质。primaryHsl = Tailwind slate-600。
  company: {
    hue: 'slate',
    activeBg: 'bg-slate-100',
    text: 'text-slate-700',
    icon: 'text-slate-600',
    softBg: 'bg-slate-50',
    ring: 'ring-slate-200',
    dot: 'bg-slate-500',
    gradient: 'from-slate-600 to-slate-800',
    primaryHsl: '215.3 19.3% 34.5%',
  },
};

export function moduleTheme(key: ModuleKey): ModuleTheme {
  return MODULE_THEMES[key];
}

/** 路由前缀 → 模块 key（侧边栏激活态 / hero / 详情页头部 / --primary 覆盖 共用） */
const ROUTE_MODULE: { prefix: string; key: ModuleKey }[] = [
  { prefix: '/ai-ask', key: 'ask' },
  { prefix: '/explore', key: 'explore' },
  { prefix: '/library', key: 'library' },
  { prefix: '/ai-radar', key: 'radar' },
  { prefix: '/ai-insights', key: 'insights' },
  { prefix: '/ai-research', key: 'research' },
  { prefix: '/ai-teams', key: 'discuss' },
  { prefix: '/ai-planning', key: 'planning' },
  { prefix: '/ai-simulation', key: 'decision' },
  { prefix: '/ai-office', key: 'report' },
  { prefix: '/ai-writing', key: 'writing' },
  { prefix: '/ai-social', key: 'social' },
  { prefix: '/agent-playground', key: 'playground' },
  { prefix: '/marketplace', key: 'market' },
];

/** 由路径推导当前模块 key（匹配不到返回 undefined）。 */
export function moduleFromPath(
  pathname: string | null | undefined
): ModuleKey | undefined {
  if (!pathname) return undefined;
  return ROUTE_MODULE.find((r) => pathname.startsWith(r.prefix))?.key;
}
