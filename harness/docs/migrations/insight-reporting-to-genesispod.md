# 洞察报告能力迁移到 GenesisPod

> 显示状态：**已经迁移到 GenesisPod、本仓库废除**
> Solar 状态：`retired`
> 产品迁移：`migrated-to-genesispod`
> 继任产品：`GenesisPod`
> 生效日期：`2026-08-10`
> 机器可读事实源：[`harness/config/feature-lifecycle.json`](../../config/feature-lifecycle.json)

## 决策

大咖洞察、AI Influence 洞察、DeepDive 洞察，以及洞察报告的规划、写作、分析、编辑、质量评估、渲染和导出，产品归属已经迁移到 GenesisPod。上述能力在 Solar 本仓库正式废除：不再新增产品入口、报告 writer、分析器、UI、schema 或产品逻辑，也不再把旧实现描述为 Solar 的活跃产品能力。

旧代码和历史报告不会在本次标注中删除。它们只作为审计证据、数据兼容和迁移回滚参考存在；安全修复、迁移修复及必要的数据供给兼容可以继续，但不得借此恢复 Solar 的报告产品面。

## 能力边界

```text
┌────────────────────────────────────┬─────────┬──────────────────────────────┐
│ 能力                               │ 归属    │ Solar 状态                   │
├────────────────────────────────────┼─────────┼──────────────────────────────┤
│ 大咖访谈 / 大展 / 事件洞察         │ GenesisPod │ retired                  │
│ AI Influence 洞察产品              │ GenesisPod │ retired                  │
│ GitHub / HF / YouTube / Social 报告│ GenesisPod │ retired                  │
│ DeepDive 洞察研究与报告            │ GenesisPod │ retired                  │
│ 报告规划、章节写作与全文综合       │ GenesisPod │ retired                  │
│ 报告编辑、修订、质量评估与导出     │ GenesisPod │ retired                  │
│ 来源采集、去重和基础物化           │ Solar      │ retained data plane      │
│ provenance、freshness、历史证据    │ Solar      │ retained evidence plane  │
│ 向 GenesisPod 的单向同步与兼容桥   │ Solar      │ retained migration layer │
└────────────────────────────────────┴─────────┴──────────────────────────────┘
```

## GenesisPod 承接证据

GenesisPod 已有独立的 AI Insights 产品路由与原生报告服务：

- `frontend/app/ai-insights/page.tsx`
- `frontend/app/ai-insights/topic/[topicId]/page.tsx`
- `frontend/app/ai-research/page.tsx`
- `frontend/app/ai-research/[projectId]/page.tsx`
- `frontend/app/ai-writing/page.tsx`
- `frontend/app/ai-writing/[id]/page.tsx`
- `frontend/app/ai-writing/report/[missionId]/page.tsx`
- `frontend/components/ai-insights/reports/ReportEditor.tsx`
- `backend/src/modules/ai-app/insight/services/report/report-generator.service.ts`
- `backend/src/modules/ai-app/insight/services/report/report-synthesis.service.ts`
- `backend/src/modules/ai-app/insight/services/report/report-editor.service.ts`
- `backend/src/modules/ai-app/insight/services/quality/report-evaluation.service.ts`
- `backend/src/modules/ai-app/insight/services/quality/report-quality-gate.service.ts`
- `backend/src/modules/ai-app/insight/services/report/research-export.service.ts`

Solar 来源数据仍可通过 GenesisPod 的本地同步脚本进入其知识库或展示层。这是数据供给和迁移兼容，不代表报告产品仍归 Solar 所有。

## 技术切换说明

“产品归属已迁移”不等于所有历史采集和桥接代码已经物理搬走。当前部分大咖、HF、GitHub、YouTube、Social 数据仍来自 Solar SQLite、Knowledge 或 browser-agent bridge。只有在后续单独完成数据面替换、调度解绑和消费者验收后，才能删除这些兼容层。

本生命周期标注也不声明 GenesisPod 当前模型 Provider、数据库或在线任务一定健康；运行健康必须通过其独立的端口、HTTP、数据库和最终报告产物验收。

## Solar 后续规则

1. 新的洞察报告需求、writer、editor、analyzer、quality gate 和导出功能只在 GenesisPod 实现。
2. Solar 不再创建新的报告产品入口或恢复已废除的报告调度。
3. Solar 数据面只输出可追溯的来源材料、标准化记录、evidence packet 和同步 manifest。
4. 旧报告代码只允许安全、迁移兼容或数据供给修复；任何产品逻辑扩展都应被拒绝。
5. 历史报告与旧实现保留，避免破坏审计链和回滚证据。

## 非本次变更

- 不删除旧脚本、历史报告或数据库记录。
- 不修改当前 launchd、cron、队列或运行中任务。
- 不声称所有 Solar 数据依赖已经解除。
- 不以本标注替代 GenesisPod 的运行健康验收。
