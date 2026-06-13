#!/usr/bin/env tsx
/**
 * UI Discipline Audit — 12 条结构强制规则
 *
 * 检测前端主页面是否绕过公共组件自写实现。
 * 配套方案文档：docs/guides/testing/frontend-ui-validation.md
 * 基线日期：2026-05-18（首次扫描）
 *
 * 12 条规则（仅作用于 frontend/app/** 和 frontend/components/{ai-*,library,explore,me,profile}/**）：
 *   R1  AI app 主页（app/{ai-*,library,explore}/page.tsx）必须 import AppShell
 *   R2  列表型 .map 渲染卡片的页面必须 import AssetCard（不准自写 rounded-(xl|lg|2xl) + border 卡片）
 *   R3  含 list.length === 0 / data?.length === 0 分支必须 import EmptyState
 *   R4  含 error state 渲染分支必须 import ErrorState
 *   R5  含 isLoading skeleton 渲染必须 import LoadingState/LoadingSkeleton
 *   R6  弹层（role="dialog" 或 fixed inset-0 backdrop）必须 import MissionDialogShell/SideDrawer/Modal/ConfirmDialog
 *   R7  自写横向 tab 栏（A: onClick→tab setter；B: ≥2 处 activeTab===字面量 + 可点击）必须 import ui/tabs/Tabs
 *   R8  feature 代码禁止直写原生 <table>（交互用 common/tables/DataTable，展示用 ui/table）
 *   R9  自写 DIY 环形 spinner（animate-spin + rounded-full + border-N）必须改用 LoadingState（不碰内联图标 spinner）
 *   R11 owner 资产卡基线操作 onEdit + onDelete 必须接齐（运营型卡仅 extraActions 者不在此列）
 *   R12 自写引用/来源「行卡」必须用 CitationListItem（common/citations）
 *   R13 对话流消息卡（message-cards/ 目录）必须用 MessageCardShell（统一外壳 + tone 配色）
 *   R16 数据行表的单元格文本截断必须用 TruncatedCell（common/tables），禁手写 .slice/.substring + 省略号
 *
 * 报告模式：全部规则已焊死（HARD_ZERO，2026-05-20）——任一规则违规即 exit 1 拒推（已退出 warn-only 灰度）。
 *
 * 用法：
 *   npm run audit:ui-discipline
 *   tsx scripts/audit-ui-discipline.ts --strict
 *   tsx scripts/audit-ui-discipline.ts --baseline docs/_archive/ui-baseline.json
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const FRONTEND_ROOT = join(process.cwd(), "frontend");
const ARGS = new Set(process.argv.slice(2));
const STRICT = ARGS.has("--strict");
const RATCHET = ARGS.has("--ratchet");
// 硬零规则：违规必须为 0，任何出现即拒（不比基线、不分模式）。
// 2026-05-20「规则全部焊死」(用户指令)：TOTAL=0 达成后，全部规则升硬零——
// 任一规则新增违规即 exit 1 拒推，彻底退出灰度 warn-only。新违规只能修/迁，不能放过。
const HARD_ZERO_RULES = new Set<string>([
  "R1-AppShell-Required",
  "R2-AssetCard-Required",
  "R3-EmptyState-Required",
  "R4-ErrorState-Required",
  "R5-LoadingState-Required",
  "R6-Dialog-Component-Required",
  "R7-Tabs-Required",
  "R8-Table-Component-Required",
  "R9-Spinner-LoadingState-Required",
  "R11-CardBaseline-Required",
  "R12-CitationListItem-Required",
  "R13-MessageCardShell-Required",
  "R14-PageHeaderHero-Required",
  "R15-CardHome-Required",
  "R16-TruncatedCell-Required",
  "R17-FullWidth-Required",
]);

// 棘轮规则：不进 hard-zero 的「不劣化」规则（cur ≤ baseline）。
// 2026-05-20 R2 加固后曾棘轮冻结存量自写列表卡；2026-05-21 逐源核验存量 = 0（真债务为 0，
// 其余皆合法卡型 allowlist 留痕），R2 已升回 HARD_ZERO 焊死。当前棘轮集为空。
const RATCHET_RULES = new Set<string>([]);
const BASELINE_PATH = (() => {
  const idx = process.argv.indexOf("--baseline");
  return idx > 0
    ? process.argv[idx + 1]
    : "docs/_archive/ui-discipline-baseline.json";
})();

interface Violation {
  rule: string;
  file: string;
  line: number;
  snippet: string;
}

const EXCLUDE_PATTERNS = [
  "node_modules",
  ".next",
  "components/admin/", // admin 自成设计系统
  "components/ai-office/slides/", // slides 自成域
  "components/playground-design/", // playground 自成 token 系统
  "components/ui/", // 公共 UI primitives 自身（Modal/Dialog/Toolbar/LoadingState 实现）
  "components/common/", // 公共组件自身（AssetCard/EmptyState/SideDrawer 实现）
  "components/profile/UserApiKeyDrawer.tsx", // 老式自定义 Drawer，已记入重构清单
  "__tests__",
  ".test.",
  ".spec.",
  ".stories.",
];

function shouldSkip(file: string): boolean {
  const norm = file.split(sep).join("/");
  return EXCLUDE_PATTERNS.some((p) => norm.includes(p));
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(tsx|jsx)$/.test(e.name)) continue;
    const full = join(e.parentPath ?? dir, e.name);
    if (shouldSkip(full)) continue;
    out.push(full);
  }
  return out;
}

function hasImport(src: string, symbol: string): boolean {
  // 简化版：检查 import { ... Symbol ... } 或 import Symbol
  const re = new RegExp(
    `import\\s+(?:[^;]*\\{[^}]*\\b${symbol}\\b[^}]*\\}|\\b${symbol}\\b)[^;]*from`,
    "m",
  );
  return re.test(src);
}

function findLine(src: string, marker: string | RegExp): number {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      typeof marker === "string"
        ? lines[i].includes(marker)
        : marker.test(lines[i])
    ) {
      return i + 1;
    }
  }
  return 0;
}

function snippet(src: string, line: number): string {
  if (!line) return "";
  const l = src.split("\n")[line - 1] ?? "";
  return l.trim().slice(0, 120);
}

// 页面是否被祖先 layout.tsx 提供的 AppShell 包裹（App Router 标准模式：
// 外壳放 route layout，子 page 不必各自 import）。从 page 目录向上走到 app/，
// 任一 layout.tsx import 了 AppShell 即视为已覆盖。
function coveredByAppShellLayout(file: string): boolean {
  let dir = dirname(file);
  for (let i = 0; i < 12; i++) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) {
      try {
        if (hasImport(readFileSync(layout, "utf8"), "AppShell")) return true;
      } catch {
        /* ignore unreadable layout */
      }
    }
    const norm = dir.split(sep).join("/");
    if (norm.endsWith("/app") || norm.endsWith("/frontend")) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

// 纯 redirect 桩页（只 redirect()、无 JSX 渲染）不需要外壳。
function isRedirectStub(src: string): boolean {
  return /\bredirect\s*\(/.test(src) && !/<[A-Za-z]/.test(src);
}

// R1 standalone 豁免：无应用外壳（无侧边栏）的独立页——未登录/邮件落地场景不该套 AppShell。
const R1_STANDALONE_OK = [
  "app/login/page.tsx", // 登录页：鉴权前，无侧栏
  "app/unsubscribed/page.tsx", // 邮件退订落地页：未登录场景，文件已注明不复用 AppShell
];

// R1: AI app 主页必须用 AppShell
function checkR1AppShell(file: string, src: string): Violation[] {
  const norm = file.split(sep).join("/");
  // 堆路径盒子（2026-06-06）：作用域从「ai-* + 硬编码白名单」放宽到所有 app 一级模块页
  // （含其 [id] 详情页），这样新模块（如 industry-chain）不再从规则缝里漏出。
  const isMainPage =
    /\/frontend\/app\/[a-z][a-z0-9-]*\/(page\.tsx|\[[^\]]+\]\/page\.tsx)$/.test(
      norm,
    );
  if (!isMainPage) return [];
  if (R1_STANDALONE_OK.some((p) => norm.endsWith(p))) return [];
  if (hasImport(src, "AppShell")) return [];
  // App Router：外壳常由 route layout.tsx 提供，redirect 桩页无 UI —— 均非缺壳
  if (isRedirectStub(src)) return [];
  if (coveredByAppShellLayout(file)) return [];

  return [
    {
      rule: "R1-AppShell-Required",
      file: relative(process.cwd(), file),
      line: findLine(src, /export\s+default/),
      snippet: snippet(src, findLine(src, /export\s+default/)),
    },
  ];
}

// R2: 列表 .map 渲染卡片必须用 AssetCard，不许自写 rounded-(xl|lg|2xl) + border
// R2 已审批 bespoke 例外（2026-05-20，用户批准，careful per-case 逐源确认）：命中但
// 并非「资产/资源列表卡」——AssetCard（title/desc/icon/可见性/owner/编辑删除/分享语义）
// 不适配。类型：3 列统计卡网格（检测器误触内层 chip .map）、admin 层配置卡（admin 自成
// 设计系统，非 app 用户资源语义）。
const R2_BESPOKE_OK = [
  "app/admin/system/notifications/content.tsx", // 统计卡 + admin 广播表单面板
  "app/admin/system/mcp-server/content.tsx", // admin MCP server 配置卡(admin 自成设计系统)
  "app/ai-radar/topic/[topicId]/runs/[runId]/page.tsx", // StageTaskBoard 流水线阶段任务表(状态徽章+指标+点击抽屉)，非资产列表
  // 加固后逐源核验（2026-05-20）：均为合法独立卡型，AssetCard 不适配（横版/CTA/日志行/
  // 可折叠面板/实时状态/admin stat），非「应迁 AssetCard」债务。卡设计系统多卡型留痕。
  "components/library/knowledge-base/CreateKnowledgeBaseCard.tsx", // 虚线「新建」占位 CTA 卡（非实体卡）
  "components/library/wiki/WikiActivityDrawer.tsx", // WikiLogCard：活动日志 <li> 行（非实体卡）
  "components/ai-research/discussion/TrendReport.tsx", // TrendCard：可展开技术趋势卡（方向/成熟度域内可视化）
  "components/ai-image/components/InsightCard.tsx", // 可折叠洞察面板（标题+图标+展开内容）
  "components/ai-image/ImageGenerator.tsx", // 同款 InsightCard 可折叠洞察面板（内联）
  "components/agent-playground/roster/AgentLiveGrid.tsx", // AgentCard：实时 agent 状态卡（role/trace/耗时）
  "app/admin/ai/dreaming/content.tsx", // 内联 StatCard：统计卡（admin 自成设计系统）
  // 2026-06-07 用户批准（逐源留痕）：智能体市场只读货架卡，含 Agent 头像渐变/评分/采用数/
  // 一键「加入」CTA —— 与 AssetCard（我拥有的资产 + 可见性/编辑/删除/分享）语义不同，
  // 不适配。详见 docs/features/one-person-company-os/design.md §5.1。
  "components/marketplace/ListingCard.tsx",
];

// 卡片三件套（顺序无关，堵旧版「固定顺序」洞）。两版：
//  - WHITE：仅 bg-white（内联列表卡用，bg-white 才是「实体卡」，bg-gray-50 多为结果/子面板，避免误报）
//  - ANY：含 bg-gray-50/slate-50（*Card 组件根节点用，配合命名信号已足够精准）
const CARD_CLASS_WHITE_G =
  /className\s*=\s*[`"'](?=[^`"']*\brounded-(?:lg|xl|2xl|3xl)\b)(?=[^`"']*\bborder\b)(?=[^`"']*\bbg-white\b)[^`"']*[`"']/g;
const CARD_CLASS_ANY =
  /className\s*=\s*[`"'](?=[^`"']*\brounded-(?:lg|xl|2xl|3xl)\b)(?=[^`"']*\bborder\b)(?=[^`"']*\bbg-(?:white|gray-50|slate-50|neutral-50)\b)[^`"']*[`"']/;
const CARD_COMPONENT_G = /(?:const|function)\s+(\w*Card\w*)\s*[=(]/g;
const TITLE_SIGNAL = /font-(?:semibold|bold|medium)|<h[34]\b/;
// 卡设计系统已认的 canonical 卡型——组件体内用了其一即非自写卡（是合法包装）。
// R2 不再「一切列表卡 → AssetCard」，而是认这一组多卡型；只揪三不像的真自写卡。
const CANONICAL_CARD_USE =
  /<(?:AssetCard|StatCard|MessageCardShell|SectionPanelCard|SettingsSectionCard|FeedCard|CitationListItem)\b/;

// 收集「在 .map 里被渲染为列表项」的组件名（每个 .map( 后 ~500 字符内的 <Capitalized 标签）。
// 用于把 R2 形态 B 收敛到「真·列表项卡」，排除配置/汇总/设置等非列表的域内卡。
function collectMapRenderedComponents(src: string, set: Set<string>): void {
  for (const m of src.matchAll(/\.map\s*\(/g)) {
    const idx = m.index ?? 0;
    const window = src.slice(idx, idx + 500);
    for (const t of window.matchAll(/<([A-Z]\w*)/g)) set.add(t[1]);
  }
}

// R2（加固版 2026-05-20）：旧版四处盲区已修——
//   ① 顺序依赖 + 仅 bg-white → 顺序无关（lookahead）
//   ② 抽成 *Card 组件即免疫 → 新增形态 B：命名含 Card 的自写卡组件
//   ③ 文件级 import AssetCard 整文件豁免 → 仅按 match 跳过 <AssetCard 用法 / 体内含 <AssetCard 的组件
//   ④（保留精度）内联形态 A 仍要求 ≥3 + bg-white + 标题信号，避免误报结果/子面板。
function checkR2AssetCard(
  file: string,
  src: string,
  mapComponents: Set<string>,
): Violation[] {
  const norm = file.split(sep).join("/");
  if (R2_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const violations: Violation[] = [];

  // 形态 A：内联在 .map 列表项里的自写卡（bg-white + 标题信号），≥3 才计（保精度）
  const inlineHits = [...src.matchAll(CARD_CLASS_WHITE_G)].filter((m) => {
    const idx = m.index ?? 0;
    const before = src.slice(Math.max(0, idx - 600), idx);
    if (/<AssetCard\b[^>]*$/.test(before)) return false;
    return (
      /\.map\s*\(/.test(before) && TITLE_SIGNAL.test(src.slice(idx, idx + 400))
    );
  });
  if (inlineHits.length >= 3) {
    for (const m of inlineHits.slice(0, 3)) {
      const line = src.slice(0, m.index ?? 0).split("\n").length;
      violations.push({
        rule: "R2-AssetCard-Required",
        file: relative(process.cwd(), file),
        line,
        snippet: snippet(src, line),
      });
    }
  }

  // 形态 B：抽出的 *Card 组件，根节点是自写卡且体内不用 <AssetCard（精准命中 ResourceCard 类）
  for (const m of src.matchAll(CARD_COMPONENT_G)) {
    const name = m[1];
    if (!mapComponents.has(name)) continue; // 仅「列表项卡」才是 AssetCard 候选
    const start = m.index ?? 0;
    const rest = src.slice(start + 1);
    const nextDecl = rest.search(/\n(?:export\s+)?(?:const|function)\s/);
    const body = src.slice(
      start,
      start + 1 + (nextDecl >= 0 ? Math.min(nextDecl, 2600) : 2600),
    );
    if (CANONICAL_CARD_USE.test(body)) continue; // 已用 canonical 卡型（多卡型识别）
    if (!CARD_CLASS_ANY.test(body)) continue; // 根节点非自写卡
    if (!TITLE_SIGNAL.test(body)) continue; // 无标题信号（非实体卡）
    const line = src.slice(0, start).split("\n").length;
    violations.push({
      rule: "R2-AssetCard-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: `自写卡组件 ${name}（应改用 AssetCard）`,
    });
  }

  return violations.slice(0, 8);
}

// R3: 「空态被渲染为 JSX」时必须用 EmptyState
// 仅当 .length===0 / .length<1 / isEmpty / !x.length 紧接 JSX 渲染（&& ( / ? ( /
// && < / ? <）时计违规——排除 `if (x.length===0) return []`、`? null :` 等逻辑判断假阳性。
const EMPTY_RENDER =
  /(?:\.length\s*===\s*0|\.length\s*<\s*1|\bisEmpty\b|!\s*\w+\??\.length)\s*(?:&&|\?)\s*[(<]/;

// R3 已审批例外：length===0 渲染的是「富欢迎/对话起始页」（登录引导 / 功能介绍 /
// 建议问题按钮），非「空数据」空态——EmptyState 不适配，保留自写（标准 22 §3 留痕）。
const R3_WELCOME_OK = [
  "app/ai-ask/page.tsx", // 未登录欢迎页 + 功能 chips + 建议 prompts
  "app/library/knowledge-graph/page.tsx", // 对话起始 + 建议问题按钮
  "app/ai-radar/topic/[topicId]/page.tsx", // sources 为空时渲染功能引导 CTA 卡(非空数据空态)
];

// R3 已审批 bespoke 例外（2026-05-20，用户批准）：`.length===0` 命中但渲染的并非
// 「空数据占位」——逐源确认，EmptyState 不适配。类型：首跑引导、对话欢迎、守卫
// (return null)、下拉/标签内联文案、<select> 兜底 option、上下文告警、死代码分支。
const R3_BESPOKE_OK = [
  "app/admin/ai/harness/page.tsx", // 运行图 mission picker 的 <select> 兜底 <option>（"No missions yet"），非空数据占位
  "app/ai-office/slides/page.tsx", // 首跑引导（"输入内容，AI团队开始生成"）
  "app/ai-simulation/run/[id]/page.tsx", // return null 守卫 + 加载中状态文案
  "components/ai-insights/research-control/ResearchSettingsModal.tsx", // 搜索下拉内联提示 + 标签 toggle
  "components/ai-office/core/PromptBar.tsx", // 死代码（外层已被 length>0 守卫）
  "components/ai-social/drawers/ContentDetailDrawer.tsx", // 上下文 amber 告警 + 跳连接设置链接（02 归位后路径）
  "components/library/knowledge-base/TeamKnowledgeBaseTab.tsx", // 团队 KB 功能介绍引导卡
  "components/library/resources/BatchActionBar.tsx", // if(selectedCount===0) return null 守卫
  "components/library/wiki/WikiQueryDrawer.tsx", // 聊天式 UI 的欢迎 prompt
  "components/me/models/UserModelConfigModal.tsx", // <select> 内兜底 <option>
  "components/me/sections/PersonalizationSection.tsx", // 内联状态 <span> 标签
];

function checkR3EmptyState(file: string, src: string): Violation[] {
  if (!EMPTY_RENDER.test(src)) return [];
  if (hasImport(src, "EmptyState")) return [];
  const norm = file.split(sep).join("/");
  if (R3_WELCOME_OK.some((p) => norm.endsWith(p))) return [];
  if (R3_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = findLine(src, EMPTY_RENDER);
  return [
    {
      rule: "R3-EmptyState-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R4 已审批 bespoke 例外（2026-05-20，用户批准，逐源确认）：error 渲染命中但非
// 「整块错误态」——ErrorState（居中图标卡 + retry 按钮）强迁会破布局/语义。
// 类型：admin 自成设计系统的内联告警条、可关闭的内联错误 banner、连接提示下的内联红字注解。
const R4_BESPOKE_OK = [
  "app/admin/data/collection/page.tsx", // admin 紧凑内联错误块（admin 自成设计系统）
  "app/admin/system/monitoring/content.tsx", // admin 部分数据失败的内联告警 banner（非整块错误态）
  "components/library/integrations/google-drive/GoogleDriveTabContent.tsx", // 连接提示下的内联红字注解（非独立错误块）
  "components/library/integrations/notion/NotionTabContent.tsx", // 可关闭 + 动态成功/错误的内联同步 banner（非整块错误态；Alert 正确，R4 正则误命中 tone="error"）
];

// R4: 含 error 分支渲染必须用 ErrorState
function checkR4ErrorState(file: string, src: string): Violation[] {
  // 启发式：JSX 中包含 error 渲染分支
  const errorRender =
    /\{\s*error\s*&&|\bif\s*\(\s*error\s*\)|\berror\s*\?\s*\(/;
  if (!errorRender.test(src)) return [];
  // ErrorState（整块错误态）或 ErrorInline（canonical 内联错误，同模块）均满足
  if (hasImport(src, "ErrorState") || hasImport(src, "ErrorInline")) return [];
  // 进一步检查是否真的有 JSX 错误展示（avoid 误报 try-catch 中的 error）
  if (!/<\w+[^>]*\b(error|Error)\b/.test(src)) return [];
  const norm = file.split(sep).join("/");
  if (R4_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = findLine(src, errorRender);
  return [
    {
      rule: "R4-ErrorState-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R5 已审批 bespoke 例外（2026-05-20，用户批准）：`animate-pulse bg-gray-100/200` 命中但
// 是「布局专属骨架」或非骨架——逐源确认，generic LoadingSkeleton（h-4 直线条）不适配，
// 强迁会视觉劣化。类型：卡片/表格/缩略图/页面形态骨架、单条内联占位、混在 spinner 块里。
const R5_BESPOKE_OK = [
  "app/admin/ai/eval/content.tsx", // h-20 卡片行占位，非细文本条
  "app/ai-social/mission/[taskId]/loading.tsx", // 整页布局骨架（头部+侧栏+内容卡）
  "app/ai-teams/[topicId]/page.tsx", // 图片加载占位 + 状态点，非骨架块
  "components/ai-image/components/ControlBar.tsx", // 单条 h-7 内联占位（模型选择器）
  "components/library/knowledge-base/KnowledgeBaseDetailDialog.tsx", // 单条标题占位 + flex-row spinner
  "components/ai-social/skeletons/ConnectionCardSkeleton.tsx", // 卡片骨架（头像圈+名称+状态+按钮）
  "components/ai-social/skeletons/ContentTableSkeleton.tsx", // 表格骨架（表头+多列行）
  "components/explore/resources/ResourceThumbnail.tsx", // 缩略图宽高比占位盒
  "components/ai-radar/RadarBucketSwitcher.tsx", // h-9 w-48 精确占位，保 4-bucket 切换器尺寸不抖动
  "components/ai-radar/RadarRawItemsPanel.tsx", // 8× h-16 卡高骨架，镜像 item 行高防布局抖动
];

// R5: 含 isLoading skeleton 渲染必须用 LoadingState/LoadingSkeleton
function checkR5LoadingState(file: string, src: string): Violation[] {
  // 检测自写 animate-pulse skeleton
  const customSkeleton =
    /\banimate-pulse\b.*?\bbg-(gray|slate|neutral)-(100|200)\b/;
  if (!customSkeleton.test(src)) return [];
  if (hasImport(src, "LoadingState") || hasImport(src, "LoadingSkeleton"))
    return [];
  const norm = file.split(sep).join("/");
  if (R5_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = findLine(src, customSkeleton);
  return [
    {
      rule: "R5-LoadingState-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R6 已审批 bespoke 例外（2026-05-20，用户批准）：`fixed inset-0 z-*` 命中但
// 本质不是「居中内容弹层」——逐个读源确认，canonical Modal/SideDrawer 不模型化。
// 类型：点击遮罩(click-away)、进度/加载遮罩、悬浮工具条、移动端导航/侧栏遮罩、
// 全屏画布/图谱/iframe 阅读器、角落浮层、命令面板(顶部锚定+自带搜索头+键盘环)。
const R6_BESPOKE_OK = [
  "components/library/wiki/WikiChromeHeader.tsx", // KB 切换下拉的 click-away 遮罩
  "components/library/wiki/WikiGraphModal.tsx", // 交互式 pan/zoom SVG 图谱（全幅）
  "components/ai-office/core/ProgressTracker.tsx", // 进度遮罩
  "components/ai-office/document/GenerationProgress.tsx", // 生成进度遮罩
  "components/ai-bar/GlobalAIBar.tsx", // 全局悬浮 AI 条
  "components/ai-teams/MessageSelectionToolbar.tsx", // 选择工具条
  "components/ai-teams/TeamCanvasModal.tsx", // 全幅 SVG 画布 drag/pan/zoom（embedded 模式）
  "components/layout/MobileNav.tsx", // 移动端导航抽屉（入口文件）
  "components/explore/youtube/subtitle-export-button.tsx", // 加载 spinner + 错误 toast
  "components/ai-research/discussion/DemosPanel.tsx", // 全屏 iframe 演示查看器
  "components/ai-research/discussion/CommandPalette.tsx", // 命令面板（顶部锚定+搜索头+键盘环）
  "components/ai-insights/reports/ReportEditor.tsx", // fixed right-4 top-20 角落浮层（编辑+预览并排）
  "app/share/topic/[id]/page.tsx", // 移动端侧栏 dismiss 遮罩
  "app/share/writing/[id]/page.tsx", // 移动端 TOC 侧栏遮罩 + 阅读进度条
  "app/ai-simulation/components/EditorModal.tsx", // 向导式编辑器全屏壳（渐变头+步进器+上/下一步底栏），整件即弹层，Modal 不模型化
];

// R6: 弹层必须用 MissionDialogShell/SideDrawer/Modal/ConfirmDialog
function checkR6Dialog(file: string, src: string): Violation[] {
  // 检测自写 dialog/modal/drawer：fixed inset-0 + z-* + backdrop
  const customDialog =
    /className\s*=\s*[`"'][^`"']*\bfixed\b[^`"']*\binset-0\b[^`"']*\bz-\d+/;
  if (!customDialog.test(src)) return [];
  const knownDialogs = [
    "MissionDialogShell",
    "SideDrawer",
    "Modal",
    "ConfirmDialog",
    "AdminDrawer",
    "AdminModal",
  ];
  if (knownDialogs.some((s) => hasImport(src, s))) return [];
  const norm = file.split(sep).join("/");
  if (R6_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = findLine(src, customDialog);
  return [
    {
      rule: "R6-Dialog-Component-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R7: 自写横向 tab 栏必须用 ui/tabs/Tabs
// 检测「tab 按钮 render」——即 onClick 直接调用 tab setter 的可点击元素。
// 比旧版逐行 button 样式（border-b-2+px+font-medium 同行）更可靠（漏 bg/pill/跨行），
// 又比纯 `activeTab===` 状态信号更精准（排除只持有/消费状态、不渲染 bar 的
// state holder / consumer / 委托组件，如 ExploreContext / ExploreContent）。
const SELF_TAB =
  /onClick=\{[^}]*\b(?:setActiveTab|onTabChange|setTab|setActiveKey|setSelectedTab|handleTabChange|switchTab|changeTab|selectTab)\s*\(/;

// R7 已审批 bespoke 例外（2026-05-20，用户批准）：canonical Tabs 不适配的非标准 tab。
// 标准 22 §3 例外审批留痕——这些保留自写，不算违规。
const R7_BESPOKE_OK = [
  // 主导航：每 tab 品牌色 + 响应式隐藏 label + 布局入口，canonical underline/pill 不模型化
  "components/layout/ResponsiveNav.tsx",
  // 资源详情：图标方块工具栏（h-10 w-10 渐变 + 角标），非文本 tab 栏
  "app/explore/resource/[id]/page.tsx",
  // 向导步进器（圆形步号 + 完成勾 + 连接线 + 每步描述），非 tab 语义，canonical Tabs 不模型化
  "app/ai-simulation/components/EditorModal.tsx",
  // YouTube 4-tab：grid-cols-4 等宽 + flex-col 图标上文字下 + 品牌渐变激活，且与翻译/导出开关同行混排
  "app/explore/youtube/page.tsx",
  // 主 tab 已用 canonical 包装件 LibraryTabs；Signal B 仅命中其内容区 activeTab=== 条件，非自写 bar
  "app/library/page.tsx",
  // 纯状态消费：activeTab 仅用于内容条件渲染，onClick 是 setResultsModal（非 tab setter），不渲染 bar
  "components/library/AIOrganizePanel.tsx",
  // Admin Harness 页：tab 栏用 canonical AdminPageLayout；`tab === '字面量'` 仅做
  // 内容条件渲染（execution/memory/governance/...），非自写 bar——与 library/page 同型。
  "app/admin/ai/harness/page.tsx",
];

// R7 Signal B：tab 栏的另一种形态——同一类状态变量上 ≥2 处 `xxxTab === '字面量'`
// 条件样式 + 文件渲染可点击元素（onClick）。要求 ≥2 个不同字面量，排除只读单一
// 状态的 state holder / context provider（如 ExploreContext 仅 1 处 activeTab==='youtube'，
// 及其 consumer ExploreContent）——正是旧版纯 activeTab=== 信号会误报的对象。
const TAB_LITERAL_G =
  /(?<![.\w])(?:activeTab|selectedTab|currentTab|activeKey|activeSection|activeView|activeMode|tab)\s*===\s*['"][a-z][\w-]*['"]/gi;
const TAB_LITERAL =
  /(?<![.\w])(?:activeTab|selectedTab|currentTab|activeKey|activeSection|activeView|activeMode|tab)\s*===\s*['"][a-z][\w-]*['"]/i;

function distinctTabLiterals(src: string): number {
  const set = new Set<string>();
  for (const m of src.matchAll(TAB_LITERAL_G))
    set.add(m[0].replace(/\s+/g, ""));
  return set.size;
}

function checkR7Tabs(file: string, src: string): Violation[] {
  const sigA = SELF_TAB.test(src);
  // Signal B：≥2 个不同 tab 字面量比较 + 有可点击元素（真渲染 tab 栏，非纯状态持有/消费）
  const sigB = distinctTabLiterals(src) >= 2 && /onClick=\{/.test(src);
  if (!sigA && !sigB) return [];
  // 已用 tab 组件的不算自写：canonical Tabs，或 admin 设计系统 AdminTabs
  // （AdminTabs→Tabs 属迷你设计系统统一，另册，不在 R7「自写」范畴）。
  if (hasImport(src, "Tabs") || hasImport(src, "AdminTabs")) return [];
  const norm = file.split(sep).join("/");
  if (R7_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = sigA ? findLine(src, SELF_TAB) : findLine(src, TAB_LITERAL);
  return [
    {
      rule: "R7-Tabs-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R8: feature 代码禁止直写原生 <table>（标准 22 §2.4 两层模型）。
// 交互数据网格用 common/tables/DataTable，纯展示表用 ui/table 原语。
// canonical 实现自身（components/ui/ · components/common/ · components/admin/）
// 已被 EXCLUDE_PATTERNS 排除；用 DataTable/ui/table 的文件渲染 <DataTable>/<Table>
// 而非原生 <table>，故"在范围内仍出现原生 <table>"即违规。
function checkR8Table(file: string, src: string): Violation[] {
  const NATIVE_TABLE = /<table[\s/>]/;
  if (!NATIVE_TABLE.test(src)) return [];

  const line = findLine(src, NATIVE_TABLE);
  return [
    {
      rule: "R8-Table-Component-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R9: 自写 DIY 环形 spinner 必须改用 LoadingState（canonical 已渲染标准 spinner）。
// 仅命中"自造整块加载态"环形 loader（animate-spin + rounded-full + border-N 同一
// className，即手搓 CSS 圆环）；不碰 <Loader2/RefreshCw className="animate-spin"/>
// 这类合法内联图标 spinner（按钮 loading / 状态位）——与 R5(animate-pulse 骨架) 对称。
const DIY_SPINNER =
  /className\s*=\s*[`"'][^`"']*(?:\banimate-spin\b[^`"']*\brounded-full\b[^`"']*\bborder-\d|\brounded-full\b[^`"']*\bborder-\d[^`"']*\banimate-spin\b)/;

// R9 已审批 bespoke 例外（2026-05-20，用户批准；6 个迁移 agent 逐源核验后保留）：
// 环形 className 命中但本质不是「整块加载态」——LoadingState（居中 min-h-[200px] 块）强迁会破布局/语义。
// 类型：按钮内图标位小环、装饰性同心反向旋转环、流式步骤状态环、缩略图占位/绝对遮罩、品牌化"思考中"空态。
const R9_BESPOKE_OK = [
  "app/ai-simulation/[id]/page.tsx", // startingRun 同心 3 环装饰动画
  "app/ai-simulation/run/[id]/page.tsx", // h-16 "AI 推演中" 品牌化空态（🤖 + 团队状态卡）
  "components/ai-image/components/InputArea.tsx", // GenerateButton 内 h-3.5 图标位小环
  "components/ai-image/components/StreamingProgress.tsx", // 流式步骤状态环（配 checkmark/error）
  "components/ai-image/ImageGenerator.tsx", // 装饰性同心反向环 + 流式步骤环
  "components/ai-insights/topics/ApplicationButton.tsx", // apply 按钮图标位小环
  "components/ai-planning/PlanTeamPanel.tsx", // start/advance 按钮图标位小环
  "components/explore/resources/Base64Image.tsx", // 缩略图按比例占位盒内加载环
  "components/explore/resources/PdfThumbnail.tsx", // 缩略图 absolute inset-0 遮罩环
  "components/layout/UserProfileButton.tsx", // check-in 按钮内 h-4 图标位小环
];

function checkR9Spinner(file: string, src: string): Violation[] {
  if (!DIY_SPINNER.test(src)) return [];
  if (hasImport(src, "LoadingState") || hasImport(src, "LoadingSkeleton"))
    return [];
  const norm = file.split(sep).join("/");
  if (R9_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];

  const line = findLine(src, DIY_SPINNER);
  return [
    {
      rule: "R9-Spinner-LoadingState-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R16: 数据行表的单元格文本截断必须用 TruncatedCell（标准 22 表格归一，2026-05-23）。
// 背景：数据行表把长内容硬截断（`.slice(0,N)+'…'`）或多行撑高行；统一用
//   common/tables/TruncatedCell（单行截断 + 仅溢出时挂 Tooltip，列宽变化自动重判）。
// 仅作用于「数据行表文件」——import 了 ui/table 原语 / 用 <DataTable> / MissionTaskList
//   渲染数据行的文件——避免误伤预览 / 日志 / payload 的 substring 截断（非 UI 单元格）。
const TABLE_FILE_SIGNAL =
  /from\s+['"]@\/components\/ui\/table['"]|<DataTable\b|\bMissionTaskList\b/;
const MANUAL_TRUNCATE_G =
  /\.(?:slice|substring|substr)\([^)]*\)\s*\+\s*[`'"](?:…|\.\.\.)/g;
// 单元格上下文信号：手写截断只有出现在「表格单元格渲染」附近才算违规——
//   <Td>/<td>（ui/table 手写表）或 render:/cell:（DataTable/MissionTaskList 列渲染函数）。
//   这样可避开同文件里图表轴标签 / 数据预处理 / toast / payload 的 substring 截断（非 UI 单元格）。
const CELL_CONTEXT = /<[Tt]d\b|[\s,{(]render\s*:|[\s,{(]cell\s*:/;
// R16 例外名单（标准 22 §3 留痕）：单元格上下文里命中手写截断但确不适配 TruncatedCell 的真例外。
const R16_BESPOKE_OK: string[] = [];

function checkR16TruncatedCell(file: string, src: string): Violation[] {
  if (!TABLE_FILE_SIGNAL.test(src)) return [];
  const norm = file.split(sep).join("/");
  if (R16_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];
  for (const m of src.matchAll(MANUAL_TRUNCATE_G)) {
    const idx = m.index ?? 0;
    // 仅当该手写截断位于单元格渲染上下文内（前 ~240 字符出现 <Td / render: / cell:）才计违规。
    const before = src.slice(Math.max(0, idx - 240), idx);
    if (!CELL_CONTEXT.test(before)) continue;
    const line = src.slice(0, idx).split("\n").length;
    return [
      {
        rule: "R16-TruncatedCell-Required",
        file: relative(process.cwd(), file),
        line,
        snippet: snippet(src, line),
      },
    ];
  }
  return [];
}

// R17: AI app 一级主页禁用「居中窄列」外壳（mx-auto + max-w-(xl|2xl|3xl)）——主页必须
// 全宽（对齐 research/insight/radar 的 sticky PageHeaderHero + px-8 全宽网格范式）。
// 背景：industry-chain landing 曾用 max-w-3xl 居中窄列，与全局风格割裂（2026-06-06 debug 截图）。
// 仅作用于一级 index 页（app/<module>/page.tsx，不含 [id] 详情页——详情页可有窄阅读列）。
const NARROW_SHELL =
  /\bmx-auto\b[^"`']*\bmax-w-(?:xl|2xl|3xl)\b|\bmax-w-(?:xl|2xl|3xl)\b[^"`']*\bmx-auto\b/;
// R17 已审批例外（标准 22 §3 留痕）：chat 欢迎 / 内容阅读 / 表单 这类天然窄列页；
// 以及存量窄列页（本次产业链修复未在范围内重构，逐页冻结留痕，待后续按需对齐全宽）。
const R17_FULLWIDTH_OK = [
  "app/ai-ask/page.tsx", // chat 欢迎页：居中输入范式（对话流）
  "app/ai-simulation/page.tsx", // 存量窄列（决策推演入口），待后续评估
  "app/changelog/page.tsx", // 内容阅读页：居中阅读宽度
  "app/feedback/page.tsx", // 反馈表单页：居中表单
  "app/notifications/page.tsx", // 通知列表：居中窄列
];
function checkR17FullWidth(file: string, src: string): Violation[] {
  const norm = file.split(sep).join("/");
  const isMainIndexPage = /\/frontend\/app\/[a-z][a-z0-9-]*\/page\.tsx$/.test(
    norm,
  );
  if (!isMainIndexPage) return [];
  if (!NARROW_SHELL.test(src)) return [];
  if (R17_FULLWIDTH_OK.some((p) => norm.endsWith(p))) return [];
  const line = findLine(src, NARROW_SHELL);
  return [
    {
      rule: "R17-FullWidth-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// TODO(R10): ProgressBar 强制规则待补——需更精准的检测器避免误报
//   R10 进度条：`overflow-hidden rounded-full bg-gray-200` + width 填充需区分于头像/胶囊

// R11: owner 资产卡基线操作必须接齐（标准 22 §2.2 卡片基线策略）。
// 背景：各页给 AssetCard 传不同操作子集 → 同类卡操作不一致（见 debug 截图）。
// 通用基线 = onEdit + onDelete（全实体都成立）。可见性切换**不入通用基线**——实事求是：
// 全应用仅 Topic 有真正可切换可见性（TopicVisibility enum）；plans/scenarios/KB/wiki 后端
// 无可切换可见性字段/接口，强制 onVisibilityToggle 只会造死开关。故规则只查全实体通用的
// onEdit + onDelete，缺任一即违规。
const ASSET_CARD_USE = /<AssetCard[\s>]/;
// 无例外名单：基线收敛到全实体通用的 onEdit + onDelete，达标即合法、不达标即违规——不豁免。
// 若未来某实体获得真可见性能力，在该实体卡补 onVisibilityToggle 即可，不在此开例外。
const R11_BESPOKE_OK: string[] = [];

function jsxHasProp(src: string, prop: string): boolean {
  return new RegExp(`\\b${prop}\\s*=`).test(src);
}

function checkR11CardBaseline(file: string, src: string): Violation[] {
  if (!ASSET_CARD_USE.test(src)) return [];
  // R11 只约束「用标准管理操作的卡」：触发信号 = 实际传了 onEdit/onDelete/onVisibilityToggle/isOwner=。
  // 纯运营型卡（仅 extraActions 领域操作、不传任何标准管理操作）不在此列——合法的不同操作集，非豁免。
  // （RadarTopicCard 现已接 onEdit+onDelete，作为标准 owner 卡正常达标——见 2026-05-20 雷达卡删除补全。）
  const ownerSignal =
    jsxHasProp(src, "isOwner") ||
    jsxHasProp(src, "onEdit") ||
    jsxHasProp(src, "onDelete") ||
    jsxHasProp(src, "onVisibilityToggle");
  if (!ownerSignal) return []; // 纯只读卡不强制基线操作
  // 通用基线：onEdit + onDelete（全实体都成立；可见性切换只属于 Topic 这类真可分享实体）
  const baseline = ["onEdit", "onDelete"];
  const missing = baseline.filter((p) => !jsxHasProp(src, p));
  if (missing.length === 0) return [];
  const norm = file.split(sep).join("/");
  if (R11_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];
  return [
    {
      rule: "R11-CardBaseline-Required",
      file: relative(process.cwd(), file),
      line: findLine(src, ASSET_CARD_USE),
      snippet: `缺基线操作: ${missing.join(", ")}`,
    },
  ];
}

// R12: 自写引用/来源「行卡」必须用 CitationListItem（common/citations）。
// 命中 citations/references/resources/sources 的 .map，且其后 ~700 字符内渲染「行卡」结构：
//   rounded-(lg|xl|2xl) + border + 标题(font-(semibold|medium|bold)/<h3/<h4) + 正文(line-clamp 摘要 或 a[target=_blank] 外链)。
// 刻意只命中「行卡」——不碰：内联引用 chip（CitationBadge 域：小 span/text-[10px]，无行卡结构）、
//   已组件化的 SourceLink、纯数据 .map（无 JSX 行卡）。R12_BESPOKE_OK 收 canonical 真不适配的真 bespoke。
const CITE_MAP_G =
  /\.(?:citations|references|resources|sources)\b[^.\n]{0,30}\.map\s*\(/g;
const R12_BESPOKE_OK = [
  // 引用导航参考面板：锚点 id(ref-N) + 高亮环 + HighlightedSnippet 引文高亮 + "点击跳转"提示，
  // 属引用跳转系统的富面板，非通用来源行；塞进 CitationListItem 会为单一消费方过度抽象。
  "components/ai-research/discussion/ReportPanel.tsx",
  // admin 数据采集「源」配置卡（name + 状态徽章），是数据源配置非引用/来源行，且 admin 自成设计系统。
  "app/admin/data/collection/page.tsx",
];

function checkR12CitationRow(file: string, src: string): Violation[] {
  if (hasImport(src, "CitationListItem")) return [];
  const norm = file.split(sep).join("/");
  if (R12_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];
  for (const m of src.matchAll(CITE_MAP_G)) {
    const idx = m.index ?? 0;
    const region = src.slice(idx, idx + 700);
    const isCard =
      /rounded-(lg|xl|2xl)/.test(region) && /\bborder\b/.test(region);
    const hasTitle = /font-(semibold|medium|bold)|<h[34]\b/.test(region);
    const hasBody = /line-clamp|target=["']_blank/.test(region);
    // chip 排除：极小字号(text-[10px]/[11px]) 且无行卡正文特征 → 是内联徽章不是行卡
    const isChip =
      /text-\[1[01]px\]/.test(region) && !/line-clamp|\bp-[34]\b/.test(region);
    if (isCard && hasTitle && hasBody && !isChip) {
      const line = src.slice(0, idx).split("\n").length;
      return [
        {
          rule: "R12-CitationListItem-Required",
          file: relative(process.cwd(), file),
          line,
          snippet: snippet(src, line),
        },
      ];
    }
  }
  return [];
}

// R13: 对话流消息卡必须用 MessageCardShell（卡片设计系统第 3 类）。仅作用于 message-cards/ 目录：
// 自写 `rounded-lg border + bg-(purple|orange|blue|green|amber|yellow)-50` 外壳而不 import MessageCardShell 即违规。
const MSG_SHELL_PAT =
  /rounded-lg\b[^"`']*\bborder\b[^"`']*\bbg-(?:purple|orange|blue|green|amber|yellow)-50/;
function checkR13MessageShell(file: string, src: string): Violation[] {
  const norm = file.split(sep).join("/");
  if (!norm.includes("topic-content/message-cards/")) return [];
  if (hasImport(src, "MessageCardShell")) return [];
  if (!MSG_SHELL_PAT.test(src)) return [];
  const line = findLine(src, MSG_SHELL_PAT);
  return [
    {
      rule: "R13-MessageCardShell-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R14: AI app 主页自写 hero 页头必须用 PageHeaderHero（固化「页头统一」成果，2026-05-21）。
// 命中「主 index 页直接写 <h1 … text-2xl/3xl font-bold>」(hero 标题特征) 但未 import PageHeaderHero。
// 仅作用于一级主页（app/<module>/page.tsx，不含 [id] 详情页与深层子页），避免误伤无 hero 的页面。
const HERO_H1 = /<h1[^>]*\btext-(?:2xl|3xl)\b[^>]*\bfont-bold\b/;
// R14 已审批例外：内容页/特殊布局——PageHeaderHero（string subtitle + 渐变 icon hero）不适配。
const R14_BESPOKE_OK = [
  "app/changelog/page.tsx", // 居中内容页(max-w-3xl) + 富 subtitle(版本徽章 JSX)，非渐变 hero
];
function checkR14PageHeaderHero(file: string, src: string): Violation[] {
  const norm = file.split(sep).join("/");
  // 堆路径盒子（2026-06-06）：放宽到所有 app 一级主页（不再只限 ai-* + 白名单）。
  const isMainIndexPage = /\/frontend\/app\/[a-z][a-z0-9-]*\/page\.tsx$/.test(
    norm,
  );
  if (!isMainIndexPage) return [];
  if (!HERO_H1.test(src)) return []; // 没自写 hero 标题（用了 header 组件 / 无 hero）
  if (hasImport(src, "PageHeaderHero")) return []; // 已用 canonical
  if (R14_BESPOKE_OK.some((p) => norm.endsWith(p))) return [];
  const line = findLine(src, HERO_H1);
  return [
    {
      rule: "R14-PageHeaderHero-Required",
      file: relative(process.cwd(), file),
      line,
      snippet: snippet(src, line),
    },
  ];
}

// R15: 卡片单一归属（2026-05-21 收口，标准 22 §2.2）——所有卡片 canonical 只允许在
// components/ui/cards/。任何 `cards/` 或 `asset-card/` 目录出现在 ui/cards 之外即违规
// （历史 common/cards、common/asset-card 因无守护而漂移；现焊死，杜绝任意 agent 乱放）。
//
// ★ 必须用文件系统目录扫描，不能走 file-walk：walkDir 通过 EXCLUDE_PATTERNS 排除了
//   components/common/、components/ui/ 等目录，per-file 规则永远看不到散落在被排除目录里的卡。
async function scanCardDirHomes(): Promise<Violation[]> {
  const violations: Violation[] = [];
  async function walk(dir: string) {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      const full = join(dir, e.name);
      const norm = full.split(sep).join("/");
      if (
        (e.name === "cards" || e.name === "asset-card") &&
        !norm.includes("/components/ui/cards")
      ) {
        violations.push({
          rule: "R15-CardHome-Required",
          file: relative(process.cwd(), full),
          line: 1,
          snippet:
            "卡片目录只允许在 components/ui/cards/（标准 22 §2.2；禁止 common/cards、common/asset-card 等散落）",
        });
      }
      await walk(full);
    }
  }
  await walk(join(FRONTEND_ROOT, "components"));
  return violations;
}

// 注：内容/洞察展示卡（SectionPanelCard，卡片设计系统第 5 类）不设硬零检测器——
// 其「渐变头卡」视觉特征与弹层/面板/页头共用（无法精确区分），强检测会误拦 Modal/Dialog 等。
// 故 SectionPanelCard 作为「文档约定 + 已迁清晰用例」治理，不进 HARD_ZERO（实事求是）。

async function main() {
  console.log("[audit:ui-discipline] 扫描 frontend/ 公共组件强制复用规则...");

  const files = await walkDir(FRONTEND_ROOT);
  console.log(`  扫描文件数：${files.length}`);

  // 预读全部源码 + 建「在 .map 里被渲染为列表项的组件名」全局索引（跨文件）。
  // R2 形态 B 仅对「列表项卡」生效——精准区分实体卡 vs 配置/汇总/洞察等域内卡。
  const sources = new Map<string, string>();
  for (const file of files) {
    try {
      sources.set(file, await readFile(file, "utf8"));
    } catch {
      /* skip unreadable */
    }
  }
  const mapComponents = new Set<string>();
  for (const src of sources.values())
    collectMapRenderedComponents(src, mapComponents);

  const allViolations: Violation[] = [];
  for (const [file, src] of sources) {
    allViolations.push(...checkR1AppShell(file, src));
    allViolations.push(...checkR2AssetCard(file, src, mapComponents));
    allViolations.push(...checkR3EmptyState(file, src));
    allViolations.push(...checkR4ErrorState(file, src));
    allViolations.push(...checkR5LoadingState(file, src));
    allViolations.push(...checkR6Dialog(file, src));
    allViolations.push(...checkR7Tabs(file, src));
    allViolations.push(...checkR8Table(file, src));
    allViolations.push(...checkR9Spinner(file, src));
    allViolations.push(...checkR11CardBaseline(file, src));
    allViolations.push(...checkR12CitationRow(file, src));
    allViolations.push(...checkR13MessageShell(file, src));
    allViolations.push(...checkR14PageHeaderHero(file, src));
    allViolations.push(...checkR16TruncatedCell(file, src));
    allViolations.push(...checkR17FullWidth(file, src));
  }
  // R15 结构检查：独立于 file-walk 的目录扫描（卡片目录归属）
  allViolations.push(...(await scanCardDirHomes()));

  // 按 rule 聚合
  const byRule = new Map<string, Violation[]>();
  for (const v of allViolations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule)!.push(v);
  }

  console.log("");
  console.log("── 违规汇总 ──");
  const summary: Record<string, number> = {};
  for (const [rule, list] of [...byRule.entries()].sort()) {
    summary[rule] = list.length;
    console.log(`  ${rule}: ${list.length}`);
  }
  console.log(`  TOTAL: ${allViolations.length}`);
  console.log("");

  // 打印前 N 条样本
  if (allViolations.length > 0) {
    console.log("── 样本（每规则最多 3 条）──");
    for (const [rule, list] of [...byRule.entries()].sort()) {
      console.log(`\n  [${rule}]`);
      for (const v of list.slice(0, 3)) {
        console.log(`    ${v.file}:${v.line}`);
        if (v.snippet) console.log(`      | ${v.snippet}`);
      }
    }
    console.log("");
  }

  // 基线对比
  let baseline: Record<string, number> | null = null;
  if (existsSync(BASELINE_PATH)) {
    try {
      baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as Record<
        string,
        number
      >;
    } catch {
      baseline = null;
    }
  }

  let regressions: string[] = [];
  if (baseline) {
    console.log("── 与基线对比 ──");
    for (const rule of Object.keys({ ...summary, ...baseline })) {
      const cur = summary[rule] ?? 0;
      const base = baseline[rule] ?? 0;
      const delta = cur - base;
      const tag = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
      console.log(
        `  ${tag} ${rule}: ${base} → ${cur} (${delta >= 0 ? "+" : ""}${delta})`,
      );
      if (delta > 0) regressions.push(`${rule}: ${base} → ${cur} (+${delta})`);
    }
    console.log("");
  } else {
    console.log(`(无基线文件 ${BASELINE_PATH}，本次为首次扫描)`);
    console.log("");
  }

  // 写基线：--update-baseline 全量重写；--ratchet 只锁低（不劣化"焊死下限"：current<baseline 即降，永不回升）
  if (ARGS.has("--update-baseline") || RATCHET) {
    const next: Record<string, number> = { ...(baseline ?? {}) };
    const keys = new Set([
      ...Object.keys(summary),
      ...Object.keys(baseline ?? {}),
    ]);
    for (const rule of keys) {
      const cur = summary[rule] ?? 0;
      next[rule] = ARGS.has("--update-baseline")
        ? cur
        : Math.min(next[rule] ?? cur, cur);
    }
    await writeFile(
      BASELINE_PATH,
      JSON.stringify(next, null, 2) + "\n",
      "utf8",
    );
    console.log(
      `✓ 基线已${ARGS.has("--update-baseline") ? "全量重写" : "棘轮锁低"}：${BASELINE_PATH}`,
    );
  }

  // ① 硬零规则：违规数必须为 0，任何出现即拒（不分 strict/warn）。规则迁到 0 后毕业至此。
  const hardZeroHit = [...HARD_ZERO_RULES].filter((r) => (summary[r] ?? 0) > 0);
  if (hardZeroHit.length > 0) {
    console.error("✗ 硬零规则违规（必须为 0，出现即拒）：");
    for (const r of hardZeroHit) console.error(`  ${r}: ${summary[r]}`);
    process.exit(1);
  }

  // ②.棘轮规则：默认即强制「不劣化」（超基线即拒），不必等 strict。存量冻结、只减不增。
  const ratchetHit = regressions.filter((r) =>
    [...RATCHET_RULES].some((rule) => r.startsWith(rule)),
  );
  if (ratchetHit.length > 0) {
    console.error(
      "✗ 棘轮规则劣化（不得超过基线；新增自写列表卡请改用 AssetCard）：",
    );
    for (const r of ratchetHit) console.error(`  ${r}`);
    process.exit(1);
  }

  // ③ strict 模式（灰度全量切换后启用）：任何"劣化"（超基线）即拒
  if (STRICT && regressions.length > 0) {
    console.error("✗ UI discipline 劣化（strict 不劣化模式）：");
    for (const r of regressions) console.error(`  ${r}`);
    process.exit(1);
  }

  const ratchetSuffix =
    RATCHET_RULES.size > 0
      ? ` + ${RATCHET_RULES.size} 条棘轮规则未劣化（${[...RATCHET_RULES]
          .map((r) => `${r}=${summary[r] ?? 0}`)
          .join(", ")}）`
      : "";
  console.log(
    `✓ 全部 ${HARD_ZERO_RULES.size} 条规则硬零通过（违规 = 0，已焊死）${ratchetSuffix}`,
  );
}

main().catch((err) => {
  console.error("audit-ui-discipline failed:", err);
  process.exit(2);
});
