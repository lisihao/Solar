# 005. LLM Wiki 与 Knowledge Graph 共存边界

**Date**: 2026-05-09
**Status**: Accepted（与 LLM Wiki v1.5.3 4/4 APPROVED 同步落盘）
**关联设计文档**: [ai-app/library/wiki/llm-wiki.md](../architecture/ai-app/library/wiki/llm-wiki.md)
**评审纪要**: [ai-app/library/wiki/llm-wiki-review-r7.md](../architecture/ai-app/library/wiki/llm-wiki-review-r7.md)

## 背景

项目当前已有两条"实体关系"表达路径：

1. **现有 Knowledge Graph 路径**：`Note.graphNodes` JSON 字段、`Resource.graph` JSON 字段、`GraphService` 提供的图视图、`KnowledgeGraphView` 前端组件。Note / Resource 的实体关系通过 graphNodes 数组表达。
2. **LLM Wiki 路径（v1.5.3 引入）**：基于 Karpathy LLM Wiki 模式，在 `KnowledgeBase` 上引入 wikiEnabled 开关 + 10 张 wiki 表，wiki page 之间的关系通过 markdown 内的 `[[slug]]` 引用表达，`WikiPageLink` 表是 `[[slug]]` 解析后的物化结果。

这两条路径在概念层有重叠（"实体关系"），如果不显式定型边界，会出现：

- LLM 在 wiki ingest 时是否同步写 graphNodes？（双写 → 双源风险）
- KG 视图是否可视化 wiki 的 [[slug]] 链接？（混叠 → 概念不清）
- 用户在 KG / wiki 视图同时使用同一 KB 时如何理解两者关系？

## 决策

**LLM Wiki 与 Knowledge Graph 在本期完全解耦，KG 路径冻结为只读保留**：

1. **wiki 不写、不读 graphNodes**：wiki ingest / edit / lint 编排都不触碰 `Note.graphNodes` 或 `Resource.graph`；wiki 子模块 service 不 import GraphService。
2. **wiki 实体关系仅用 `[[slug]]`**：wiki 内的实体关系通过 markdown 内 `[[slug]]` 软引用 + `WikiPageLink` 物化表达；不引入新的 graphNodes-style 字段。
3. **KG 路径保留只读**：现有 Note.graphNodes / Resource.graph / GraphService / KnowledgeGraphView 不删除、不下线；用户在 Note / Resource 视图仍可看到 KG 形态。
4. **不强制同步**：wiki 改动不触发 KG 更新；KG 改动不触发 wiki 更新；两路径数据各自独立演进。
5. **未来产品决策可重启融合**：本 ADR 仅定型 v1.5 / P0 阶段；若产品后续判断需要融合（如"wiki entity 自动产出 graphNodes"），届时新写 ADR 重新评估，本 ADR 不阻塞。

## 后果

**正面**：

- 短期不需要 graph schema 变更，wiki 可以独立推进 P0–P3 各阶段。
- wiki 模块的 `verify:arch` 单向依赖 L3→L2.5/L2 不被破坏（不需要 wiki → KG 反向 import）。
- 用户的 KG 数据不丢失，旧 Note / Resource 视图行为不变。

**负面**：

- 用户在同一 KB 同时使用 KG 视图（基于 Note.graphNodes）与 wiki 视图（基于 WikiPageLink）时，会看到两套独立的"实体关系"——文档需明示两者不同步，避免误解。
- 同一份 raw 内容（KnowledgeBaseDocument）派生出 wiki page 与 Note 时，wiki 的 `[[slug]]` 关系与 Note 的 graphNodes 关系无任何机械对应；用户期望"自动同步"会失望。
- 未来若融合，需要数据迁移工具（graphNodes → WikiPageLink 或反向），存在一次性迁移成本。

## 已考虑的替代方案

**A. wiki 同步写 graphNodes**：每次 wiki ingest 时把 wiki entity 关系也写入 Note.graphNodes。**拒绝理由**：双源——wiki body 与 graphNodes 谁是 SoT 不清；用户改 graphNodes 不会触发 wiki 重写，反向亦然。违反项目"无双源"红线（feedback_no_dual_sources）。

**B. KG 改读 WikiPageLink**：把 GraphService 改造成读 WikiPageLink 渲染 KG 视图，废弃 graphNodes。**拒绝理由**：本期 wiki 还在 P0 阶段，没有真实数据；强行替换 KG 数据源会让 Note / Resource 视图失效；范围过大。

**C. wiki 引入新字段 wikiGraphNodes**：在 wiki 表新加 graphNodes 字段表达实体关系。**拒绝理由**：与 `[[slug]]` 双源；增加 schema 复杂度；Karpathy 原意 markdown is SoT 被破坏。

## 配套实现

- `WikiPageLink` 表（v1.5.3 P0b 落地）：`[[slug]]` 解析结果的物化形式
- wiki ingest skill prompt（v1.5.3 P1）：明确指示 LLM 用 `[[slug]]` 表达跨页引用，不输出 graphNodes JSON
- wiki query 双分支（v1.5.3 P2）：检索基于 oneLiner / body embedding 与 BM25，不依赖 KG 邻接关系
- 文档中将本 ADR 在 LLM Wiki §3.2 / §1.5 显式引用，KG 模块文档中也加反向引用提示边界
