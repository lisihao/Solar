# Claude Code → GenesisPod 借鉴专题

> 2026-05-06 起，对照 Anthropic 官方 Claude Code v2.1.88（从泄露 sourcemap 还原的 1916 个 TS 文件，位于 `d:/projects/codes/claude-code-build`）的工程改造专题。

## 文档清单

| 文档                                                   | 用途                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [agent-execution-guide.md](./agent-execution-guide.md) | **主文档**。Agent（含 sub-agent / 人）按图执行的工程改造手册，含 P0×6 + P1×10 + P2×6 任务卡，每张含白名单 / 必读上下文 / 实施步骤 / DoD / 回滚预案 / sub-agent prompt 模板 |

## 快速导航

- 想知道**为什么做**：[§1 北极星与边界](./agent-execution-guide.md#1-北极星与边界)
- 想看**对照表**：[§2 架构对照速查表](./agent-execution-guide.md#2-架构对照速查表)
- 想看**Anthropic 自己踩的坑**：[§3 反向洞察](./agent-execution-guide.md#3-反向洞察anthropic-自己踩出来的坑)
- 想**接任务实施**：[§4 P0 任务卡](./agent-execution-guide.md#4-p0-任务卡6-张必抄)
- 想**派 sub-agent**：[§7 Sub-agent 执行规约](./agent-execution-guide.md#7-sub-agent-执行规约)（含 prompt 模板）
- 想查**Claude Code 源码位置**：[附录 A](./agent-execution-guide.md#附录-a-claude-code-关键文件位置索引)
- 想查**GenesisPod 接入锚点**：[附录 B](./agent-execution-guide.md#附录-b-genesis-接入锚点索引)

## 关联 memory

- `project_claude_code_borrow_plan_2026_05_06` —— 原始借鉴清单
- `reference_claude_code_v2_1_88_source` —— Claude Code 还原源码路径索引
- `project_north_star_anthropic_managed_agent` —— 北极星目标
