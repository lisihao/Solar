# ai-radar UI-Discipline 收尾 punch-list（跨会话交接）

> 2026-05-20。另一会话把全仓 UI-discipline（`npm run audit:ui-discipline`，规则
> R1–R9）迁到了 floor：R1=0、R6=1、R3/R5 仅剩 ai-radar、其余非 ai-radar 项均已迁移
> 或加 bespoke 白名单。**ai-radar 子树由本会话（radar owner）持有，故留作交接。**
> 本文是 ai-radar 剩余违规的精确清单 + 操作指引，供 radar 会话收尾。

## 为什么交给 radar 会话

- ai-radar 全部已提交（工作树干净），但两会话**共用同一工作树**，他人代为编辑
  ai-radar 文件会与你在途的提交撞车 / 重复劳动（你近期已在迁 ai-radar：
  `e1d4f8974` R7 RadarTopicConfigDrawer→Tabs、`dc9946fb9`/`14785a46d` EmptyState、
  `eccfef54f` R8→ui/table）。
- 你最懂 radar 组件语义（哪些骨架/卡片是布局专属、不该硬塞 canonical）。

## 确认的 ai-radar 违规（用真实检测器逻辑扫描，准确）

| 文件                                                 | 规则          | 建议处置                                                                      |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `app/ai-radar/topic/[topicId]/page.tsx`              | R3, R5        | R3：若是真·空数据占位 → `EmptyState`；R5：若是布局专属骨架 → 加白名单         |
| `app/ai-radar/topic/[topicId]/runs/[runId]/page.tsx` | R2(3), R5, R7 | R2：多半是统计/领域卡（非资产卡）→ 白名单；R5：同上；R7：自写 tab 栏 → `Tabs` |
| `components/ai-radar/RadarEventLog.tsx`              | R3            | 真·空态 → `EmptyState`（注意区分 guard / 欢迎页等假阳性）                     |
| `components/ai-radar/RadarBucketSwitcher.tsx`        | R5            | 多半布局专属骨架 → 白名单                                                     |
| `components/ai-radar/RadarRawItemsPanel.tsx`         | R5            | 多半布局专属骨架 → 白名单                                                     |

> R4 / R6 / R7「B 型」（`activeTab===字面量` 那条新检测）这几项的计数会随你自己的
> 检测器改动（R7-B、R9）浮动，本会话无法稳定枚举 —— **请直接 `npm run audit:ui-discipline`
> 看 live 列表**。（注：原 R6=1 的 `RadarSourceList` 你已迁，R6 的那 1 项已转移。）

## 怎么迁（canonical API）

- **EmptyState**：`import { EmptyState } from '@/components/ui/states/EmptyState'`
  - props：`{ type?, title?, description?, icon?, action?, size?: 'sm'|'md' }`，紧凑面板/侧栏用 `size="sm"`。
  - **只迁真·空数据占位**；guard（`if(len===0) return null`）、欢迎/首跑页、下拉标签、
    `<select>` 兜底 option、上下文告警 = 假阳性，**不迁，加白名单**。
- **Tabs**：`import { Tabs } from '@/components/ui/tabs'`
  - props：`{ items:{key,label,icon?,count?}[]; value; onChange; variant?:'underline'|'pill'; size? }`；
    只替 tab 栏，内容面板 `value===key` 照旧。向导步骤条不是 tab → 不迁。
- **LoadingSkeleton**：`import { LoadingSkeleton } from '@/components/ui/states/LoadingState'`（`{lines?}` 通用直条）。
  - **只在骨架本就是「一摞通用灰条」时用**；卡片/表格/缩略图/页面形态骨架 = 视觉会劣化 → 白名单。

## 怎么加 bespoke 白名单（假阳性 / 布局专属）

检测器 `scripts/utils/audit-ui-discipline.ts` 已有逐规则白名单数组（你是 R9 作者，可直接改）：

- `R2_BESPOKE_OK`、`R3_BESPOKE_OK`、`R5_BESPOKE_OK`、`R6_BESPOKE_OK`、`R7_BESPOKE_OK`
- 每条 `路径片段 // 一句理由`，`norm.endsWith(p)` 匹配。radar 的布局专属骨架 / 统计卡
  按同样格式追加即可（例：`components/ai-radar/RadarBucketSwitcher.tsx, // bucket 切换器的布局占位`）。
- R1 现为 layout-aware（祖先 `layout.tsx` import AppShell 即视为已覆盖 + redirect 桩页跳过），
  radar 页若由 `app/ai-radar/layout.tsx` 提供壳则自动 pass，无需处理。

## 提交避坑（本会话踩过）

1. **commit subject 不能大写 ASCII 开头** —— commitlint `subject-case` 会拒
   `R3 ...` / `WikiIngestModal ...`。用中文或小写开头（`迁 ... / fix(...): 让 ...`）。
2. **后台 `git commit -m ... | tail && git push` 会把 commitlint 失败伪装成 exit 0**
   （管道退出码是 tail 的）——失败的文件继续 staged，下次 commit 全扫进去。提交后
   `git show --stat HEAD` 核对文件数。
3. 跑 `npm run audit:ui-discipline -- --update-baseline` 后只 `git add` 自己的文件，
   `git diff --cached --name-only` 核对，别带上他人改动。

## 验收

- `npm run audit:ui-discipline` 中 ai-radar 相关项归零（迁移）或转入白名单（假阳性）。
- `cd frontend && npx tsc --noEmit` 0 error。
