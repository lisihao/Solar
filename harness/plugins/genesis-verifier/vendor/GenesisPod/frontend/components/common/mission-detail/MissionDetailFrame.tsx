'use client';

/**
 * MissionDetailFrame — AI Agent Team mission 详情页统一外壳
 *
 * 三个 domain（ai-social / agent-playground / ai-radar）共享相同的信息架构：
 *   Header  : [← back] [品牌 icon] 标题 + meta · [status pill] [actions slot]
 *   Body    :
 *     Left  : 360px 可折叠 panel（TeamRoster / RadarTeam / ... 由调用方注入）
 *     Right : flex-1 tab bar + tab content（由调用方注入）
 *
 * 设计原则：
 *   - Frame 只接管外层布局，不知道任何 domain 业务
 *   - 调用方保留自己的 state、handler、modal、drawer
 *   - children 就是 active tab 当前应该渲染的内容（外部 switch）
 *
 * 关于"Playground 能力不丢失"：本 Frame 仅替换页面顶层 wrap div + header
 * + tab bar + left/right grid 的视觉容器；所有现有 panel、modal、drawer、
 * artifact viewer 都通过 leftPanel / headerActions / children 等 slot 原样
 * 注入，page 自己的逻辑 0 改动。
 */

import { ChevronRight, type LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/common';
import { Tabs } from '@/components/ui/tabs';
import { MODULE_THEMES, moduleFromPath } from '@/lib/design/module-themes';

const ArrowLeftIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

export interface MissionDetailFrameTab<TKey extends string = string> {
  key: TKey;
  label: string;
  Icon: LucideIcon;
}

export interface MissionDetailFrameProps<TTab extends string = string> {
  // ── Back navigation ──────────────────────────────────────────────
  onBack: () => void;
  backTitle?: string;

  // ── Header brand zone（左侧 icon + title） ───────────────────────
  /** Tailwind gradient classes, e.g. "from-rose-500 to-pink-600" */
  brandGradient: string;
  HeaderIcon: LucideIcon;
  title: React.ReactNode;
  /** 标题下方一行小字（mission id / platforms / topic 等） */
  subtitle?: React.ReactNode;

  // ── Header right zone（status + actions） ────────────────────────
  /** Status pill — 已渲染好的 ReactNode，可包含 icon + label */
  statusPill?: React.ReactNode;
  /** 主操作按钮区（发布到草稿箱 / 重试 / 取消 / 重跑 / ...） */
  headerActions?: React.ReactNode;

  // ── Tab bar ──────────────────────────────────────────────────────
  tabs: MissionDetailFrameTab<TTab>[];
  activeTab: TTab;
  onTabChange: (key: TTab) => void;
  /** @deprecated W0(B)：tab 改用 canonical `<Tabs>`（统一 underline = playground），此参数已忽略 */
  tabActiveColor?: string;

  // ── Left panel（可折叠） ────────────────────────────────────────
  leftPanel: React.ReactNode;
  leftCollapsed: boolean;
  onLeftCollapseToggle: () => void;
  /** 默认 360px，可调（radar 用了 360） */
  leftWidth?: string;
  /** 可选：折叠态自定义视图（playground 装饰性折叠：垂直 "Team" 文字 + 运行指示器） */
  leftCollapsedView?: React.ReactNode;

  // ── Right content（外部按 activeTab 决定渲染什么） ──────────────
  children: React.ReactNode;

  // ── Optional slots（playground 等 domain 独有 UI） ──────────────
  /** 在 tab bar 之上、Right panel 顶部的横幅容器（WS 失联 / 失败警告 banner 等） */
  topBanner?: React.ReactNode;
  /** tab bar 右侧附加内容（CompactMeters 等紧凑指标条） */
  tabBarTrailing?: React.ReactNode;

  // ── 容器自定义 ──────────────────────────────────────────────────
  className?: string;
}

export function MissionDetailFrame<TTab extends string = string>({
  onBack,
  backTitle = '返回',
  brandGradient,
  HeaderIcon,
  title,
  subtitle,
  statusPill,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  leftPanel,
  leftCollapsed,
  onLeftCollapseToggle,
  leftWidth = 'w-[360px]',
  leftCollapsedView,
  children,
  topBanner,
  tabBarTrailing,
  className,
}: MissionDetailFrameProps<TTab>) {
  const pathname = usePathname();
  // 详情页头部图标渐变：按路由自动匹配模块色（与菜单一致），匹配不到才用调用方 brandGradient
  const routeKey = moduleFromPath(pathname);
  const effectiveGradient = routeKey
    ? MODULE_THEMES[routeKey].gradient
    : brandGradient;
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col bg-gray-50', className)}>
      {/* ── Header ──────────────────────────────────────────────── */}
      {/* W0(B)：header markup 与 agent-playground 详情页逐类对齐（一模一样基准） */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title={backTitle}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br shadow-md',
                effectiveGradient
              )}
            >
              <HeaderIcon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-gray-900">
                {title}
              </h1>
              {subtitle && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  {subtitle}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {statusPill}
          {headerActions}
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* W0(B)：左栏与 playground 同款——折叠态 w-12 strip（leftCollapsedView 或默认展开条），
            展开态 leftPanel（收起键在业务面板内，经 onLeftCollapseToggle 回调）；无外挂 w-5 切换条 */}
        <aside
          className={cn(
            // Keep scrolling ownership inside the injected left panel.
            // If the frame also scrolls, bottom action bars get pushed out of view.
            'flex min-h-0 flex-shrink-0 overflow-hidden border-r border-gray-200 bg-white transition-all duration-300',
            leftCollapsed ? 'w-12' : leftWidth
          )}
        >
          {leftCollapsed
            ? (leftCollapsedView ?? (
                <div className="flex h-full flex-col items-center py-4">
                  <button
                    type="button"
                    onClick={onLeftCollapseToggle}
                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    title="展开"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              ))
            : leftPanel}
        </aside>

        {/* Right panel — banners + tabs + content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* topBanner slot — playground 用作 WS 失联 / 失败警告 banner */}
          {topBanner}

          {/* Tab bar + trailing slot
              响应式：flex-wrap —— 当 tabs + trailing(meters) 同行放不下时，trailing
              换到第二行，而不是把 tabs 挤成横向滚动（tabs 拿满首行宽度，通常即可完整显示）。
              对所有 mission-detail 页面生效（agent-playground / ai-radar 等）。 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 bg-white px-4">
            {/* W0(B)：用 canonical <Tabs>（与 playground 详情页同款，underline 默认）*/}
            <Tabs
              className="scrollbar-thin min-w-0 flex-1 overflow-x-auto border-b-0"
              items={tabs.map((t) => ({
                key: t.key,
                label: t.label,
                icon: t.Icon,
              }))}
              value={activeTab}
              onChange={(k) => onTabChange(k as TTab)}
            />
            {tabBarTrailing && <div className="shrink-0">{tabBarTrailing}</div>}
          </div>

          {/* Tab content slot */}
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
