# Report Quality Debugging - 报告质量问题定位方法论

> 系统性定位和修复 AI 生成报告中的质量问题

## 适用场景

- 用户报告洞察报告/研究报告中的渲染、格式、内容质量问题
- 新功能上线后的报告质量回归检查
- 定期的报告质量审计

## 方法论（10步循环）

### 1. 收集样本和问题截图

- 获取最新导出的 HTML 报告文件
- 获取用户标注的问题截图（debug/bugfix/ 目录）
- 读取截图识别具体的视觉问题

### 2. 分类问题

将问题按以下类别分类：

| 类别           | 示例                        | 根因方向                       |
| -------------- | --------------------------- | ------------------------------ |
| **渲染问题**   | raw markdown `**` 未转 bold | 前端渲染组件 or 后端数据清洗   |
| **内容截断**   | "类是..."开头的要点         | JSON解析截断 or prompt指令缺失 |
| **格式不一致** | 混合使用中文/阿拉伯数字编号 | prompt写作规范不完整           |
| **图表问题**   | Source为空、图表与正文无关  | 图表分配逻辑 or 相关性过滤     |
| **内容质量**   | 套话、重复、缺乏分析深度    | prompt指令 or 审核逻辑         |

### 3. 端到端追踪数据流

对每个问题，追踪完整的数据流：

```
Prompt → AI生成 → JSON解析 → 存储(DB) → API返回 → 前端渲染 → HTML导出
```

**关键文件路径**（insight 模块，后端目录 `backend/src/modules/ai-app/insight/`，前端路由 `ai-insights`）：

| 阶段         | 文件                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| 大纲生成     | `prompts/research-leader.prompt.ts` → DIMENSION_OUTLINE_PROMPT         |
| 章节写作     | `prompts/dimension-research.prompt.ts` → SECTION_WRITING_SYSTEM_PROMPT |
| 报告合成     | `prompts/report-synthesis.prompt.ts` → REPORT_SYNTHESIS_USER_PROMPT    |
| 章节写作服务 | `services/dimension/section-writer.service.ts`                         |
| 报告合成服务 | `services/report/report-synthesis.service.ts`                          |
| 报告组装     | `services/report/report-assembler.service.ts`                          |
| 前端渲染     | `frontend/components/ai-insights/reports/ReportEditor.tsx`             |
| 快速视图     | `frontend/components/ai-insights/reports/QuickViewReport.tsx`          |
| 图表渲染     | `frontend/components/ai-insights/charts/FigureRenderer.tsx`            |
| Markdown组件 | `frontend/lib/report/createMarkdownComponents.tsx`                     |

### 4. 使用并行Agent调查

对每类问题启动独立的 explorer agent：

- 一个追踪渲染问题（前端组件）
- 一个追踪内容生成问题（prompt + service）
- 一个追踪图表问题（分配逻辑 + 过滤）
- 一个追踪格式一致性（prompt规范）

### 5. 识别根因（常见模式）

| 症状             | 常见根因                                             |
| ---------------- | ---------------------------------------------------- |
| Raw `**` in HTML | 前端用 plain text 渲染 markdown 内容，或后端未清理   |
| 要点开头被截断   | JSON repair 截断 or AI 生成带序号前缀未后处理        |
| 图表与正文无关   | keyword overlap 阈值太低（1词即通过）                |
| Source 只有编号  | auto-inject 硬编码 `Source [N]` 未从 evidence 取标题 |
| 分类标记不一致   | prompt 未规定 keyPoints 格式                         |

### 6. 修复策略（多层防御）

**每个问题至少在两层修复**：

1. **Prompt层**：告诉AI不要生成有问题的格式
2. **后处理层**：在service中添加正则/逻辑清理
3. **渲染层**：前端组件适配处理（仅在必要时）

### 7. 验证修复

```bash
# 类型检查
npx tsc --noEmit

# 相关测试
npx jest --testPathPattern="section-writer|report-synthesis" --no-coverage

# 完整后端测试（可选）
npm run test:quick
```

### 8. 深度代码检视

- `git diff --stat` 查看所有修改文件
- 逐文件 `git diff {file}` 审查
- 验证逻辑正确性、影响范围、回归风险

### 9. 业务仿真验证

- 部署后生成新的洞察报告
- 对照问题清单逐项验证
- 检查是否引入新问题

### 10. 迭代直到收敛

- 未通过的问题回到步骤3重新定位
- 新发现的问题纳入任务列表
- 所有问题修复后统一提交

## 关键经验

### 1. AI生成内容的后处理是必须的

AI不会100%遵守prompt指令。关键格式问题必须在后端service中用代码强制保证。

### 2. 图表相关性过滤需要强阈值

1个关键词匹配远远不够。至少需要2个不同关键词同时匹配才能认为图表与章节相关。

### 3. Markdown bold `**` 在多个渲染上下文中不可靠

executive summary、export HTML、quick view 等场景下 `**` 可能不被解析。最安全的做法是在后端strip掉。

### 4. keyPoints 是报告质量的源头

outline prompt 生成的 keyPoints 质量直接影响：

- 章节写作的结构和内容
- 图表相关性过滤的准确性
- 最终报告的逻辑一致性

### 5. 并行调查 + 统一修复

用多个agent并行调查不同类别的问题，但修复要统一规划，避免互相冲突。
