# Collective Review Brief — `renumberHeadings` 全覆盖仿真结果

## 待评审对象

`frontend/components/agent-playground/artifact/ArtifactMarkdown.tsx` 中的 `renumberHeadings(markdown, dimNames?)` 函数 +
`ContinuousReader.tsx` / `ChapterReader.tsx` 的 dimNames 透传。

## 用户原始诉求

1. 维度/章节/段落编号必须正确（H2 维度 N. / H3 章节 N.M. / H4 子小节无编号）
2. **章节和子小节必须保持包含关系**（不能平铺成同级）
3. 既有 mission（fullMarkdown 已落库）也要被前端预处理修复
4. supplementary section（执行摘要/目录/参考文献等）不带编号
5. **不能靠用户反复反馈来发现问题** — 必须基于 DB 真实数据 100% 仿真验证

## 仿真覆盖范围

跑 `scripts/dev/sim-renumber-headings.js` 对最近 10 个 completed mission 全跑：

| Mission  | depth | dim | chap | sub | total | 结果                    |
| -------- | ----- | --- | ---- | --- | ----- | ----------------------- |
| ddc90bfd | deep  | 10  | 60   | 368 | 448   | **PASS** ✅             |
| c195035f | deep  | 30  | 30   | 106 | 166   | **PASS** ✅             |
| 1520783d | deep  | 9   | 28   | 164 | 256   | FAIL 7                  |
| 29753565 | deep  | 5   | 6    | 128 | 142   | FAIL 1                  |
| 4940b78d | deep  | 6   | 6    | 100 | 164   | FAIL 1                  |
| 6ceba2d5 | deep  | 6   | 6    | 110 | 146   | FAIL 1                  |
| f03bb7c9 | deep  | 6   | 6    | 54  | 113   | FAIL 1                  |
| 4fd5efa1 | deep  | 5   | 5    | 41  | 61    | FAIL 1                  |
| e128f991 | deep  | 4   | 0    | 0   | 6     | FAIL 1                  |
| 5aa7491a | std   | —   | —    | —   | —     | SKIP（无 fullMarkdown） |

**Total errors: 13**

## 关键校验不变量

```
1. H2 dim 顺序连续：## 1. ## 2. ## 3. ...
2. H3 章节按 dim 重置：1.1 / 1.2 ... 然后 2.1 / 2.2 ...
3. H4 子小节不带编号
4. supplementary H2 不带编号
5. dim count == dimNames count
```

## CLEAN PASS 样本（ddc90bfd）

```
## 执行摘要         ← supplementary 无编号 ✓
## 目录             ← supplementary ✓
## 1. 核心架构与设计哲学
   ### 1.1. LangGraph的有状态图架构...
       #### 有状态图架构赋予代理流程精确控制的核心机制   ← H4 无编号 ✓
       #### 状态持久化机制确保多步任务可靠执行
       #### ...
   ### 1.2. LangGraph的循环与分支机制...
   ### 1.3. CrewAI的角色-based层次架构...
   ### 1.4. CrewAI层次协调高效但适应性受限
   ### 1.5. AutoGen对话式交互驱动高适应性计划优化
   ### 1.6. 三框架互补混合架构显著提升性能
## 2. Agent类型与协作机制
   ### 2.1. ...     ← chap 重置为 1 ✓
   ### 2.2. ...
   ...
## 10. 生产部署与适用场景
   ### 10.1. ...
## 跨维度分析       ← supplementary ✓
## 事实表概要
## 冲突
## 重叠
## 空白
## 下游消费指引
## 参考文献         ← supplementary ✓
```

10 dim / 60 chap / 368 H4，所有不变量通过。**这是新装配器（v1.7+）写入的报告。**

## LEGACY FAIL 样本（1520783d，2 周前 mission）

```
## 1. 推理成本历史趋势与2026预测
   ### 1.1. LLM推理token价格整体下降约600倍
       #### Tiered Super-Moore假设解释分层下降特征
       #### 旗舰模型指数拟合近零与推理溢价机制
       #### 经济型模型价格半衰期仅为1.10年      ← 应该是 1.2 章
       #### 中型模型半衰期达1.55年仍显著领先   ← 应该是 1.3 章
       ...（30+ H4 全堆在 1.1 下面）
## 2. 成本下降技术驱动因素
   ### 2.1. 推理成本指数下降重塑AI经济性
   ### "label": "经济型模型",         ← JSON 片段泄漏到 H3
   ### "label": "中型模型",           ← JSON 片段
   ### 2.2. 模型阶层半衰期远超摩尔定律
```

→ **错的不是 renumber，是被 renumber 处理之前的 markdown 本身**：

1. JSON 片段 `### "label":` 是 chapter-writer 老 bug — 把 JSON 内容意外当 markdown 写出
2. 30 个 H4 全堆在 1.1 是因为老 chapter-writer 没正确按 H3 边界切章节
3. dimNames 元数据有 10 项但 fullMarkdown 只有 9 个真维度（assembler 阶段差异导致）

## 评审 5 个问题

请你**基于上述仿真真实数据**回答：

1. **renumberHeadings 算法是否正确？** 对新装配器（PASS 样本）是否完整满足用户 4 条诉求？
2. **包含关系是否保持？** H2 → H3 → H4 嵌套是否清晰可读？
3. **fence 处理是否安全？** ` ``` ` 内的伪 H2/H3 不被改？JSON 嵌入的 ### 是否会误判？
4. **Legacy mission FAIL 应如何处理？** 是接受"前端尽力而为，旧数据无法救"，还是必须前端强行重排到全部 PASS？
5. **TI 标杆对齐度？** 对比 `topic-insights/services/splitFullReportIntoChapters.ts`、`buildFullReportFromDimensions` 是否对齐 TI 编号哲学？

## 你的判定要求

- **YES / NO / NO-WITH-CAVEATS** — 三选一
- 列出**具体问题**（带行号或样本片段）
- 不要含糊"建议改进"，要明确"是否阻塞 ship"

## 参考代码位置

- `frontend/components/agent-playground/artifact/ArtifactMarkdown.tsx` — renumberHeadings 实现
- `frontend/components/agent-playground/artifact/ContinuousReader.tsx:40-47` — dimNames 注入
- `frontend/components/agent-playground/artifact/ChapterReader.tsx` — 同款 dimNames 注入
- `backend/src/modules/ai-app/topic-insights/services/splitFullReportIntoChapters.ts` — TI 编号实现（参考）
- `scripts/dev/sim-renumber-headings.js` — 仿真脚本
- `scripts/dev/sim-output.txt` — PASS+FAIL 完整 hierarchy 输出
