# AI Teams Feature Docs

> 本目录保留 `ai-app/teams` 相关功能文档，但只有明确标注为当前实现的页面可作为现行设计依据。

## 当前可用入口

| 文档                                                 | 说明                                                                  | 状态    |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| [system-design.md](system-design.md)                 | 当前 `backend/src/modules/ai-app/teams/` 的系统设计、数据模型、数据流 | Current |
| [../architecture.md](../architecture.md)             | `ai-app/teams` 与 `agent-playground` 的系统边界和关系                 | Current |
| [../../system-overview.md](../../system-overview.md) | 仓库级组件图和跨系统数据流                                            | Current |

## 历史或待校正文档

下列页面仍有较强参考价值，但暂时不能直接视为当前代码事实，因为它们包含历史方案、旧路径或未完全校验的设计描述：

| 文档                                                     | 主题                    | 状态         |
| -------------------------------------------------------- | ----------------------- | ------------ |
| [topic-research.md](topic-research.md)                   | Topic Research 业务说明 | Needs review |
| [debate-system.md](debate-system.md)                     | Debate 方案说明         | Needs review |
| [mission-execution.md](mission-execution.md)             | Mission 执行思路        | Needs review |
| [ai-teams-product-vision.md](ai-teams-product-vision.md) | 产品愿景和演进路线      | Historical   |
| [gap-analysis.md](gap-analysis.md)                       | 差距分析                | Historical   |
| [code-review-report.md](code-review-report.md)           | 阶段性审查记录          | Historical   |

## 使用规则

1. 如果页面引用 `backend/src/modules/ai-engine/teams/*`，默认按历史方案处理。
2. 如果页面描述 API、事件名、Prisma 模型，必须以当前代码为准：
   - `backend/src/modules/ai-app/teams/controllers/ai-teams.controller.ts`
   - `backend/src/modules/ai-app/teams/ai-teams.gateway.ts`
   - `backend/prisma/schema/models.prisma`
   - `frontend/services/ai-teams/api.ts`
   - `frontend/stores/ai-teams/index.ts`
3. 新增或重写功能文档时，优先补充当前入口，不要继续扩散旧目录引用。

## 推荐阅读顺序

1. [../../system-overview.md](../../system-overview.md)
2. [../architecture.md](../architecture.md)
3. [system-design.md](system-design.md)
4. 相关 controller、gateway、store 和 Prisma 模型
