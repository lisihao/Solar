# 架构决策记录 (ADR)

Architecture Decision Records - 记录GenesisPod项目的重要技术决策

---

## 什么是ADR？

架构决策记录（ADR）是一种文档格式，用于记录项目中做出的重要架构和技术决策。每个ADR描述：

- **为什么**做出这个决策（上下文）
- 考虑了**哪些选项**
- **选择了什么**方案
- **预期的结果**和影响

## 为什么使用ADR？

- ✅ 保留决策的上下文和理由
- ✅ 帮助新团队成员了解架构演进
- ✅ 避免重复讨论已解决的问题
- ✅ 记录技术债务和权衡决策
- ✅ 在代码审查中提供参考

---

## ADR列表

### 已接受 (Accepted)

| ADR                                                 | 标题                                          | 日期       | 状态      |
| --------------------------------------------------- | --------------------------------------------- | ---------- | --------- |
| [ADR-0001](0001-monorepo-architecture.md)           | 采用Monorepo架构                              | 2025-01-01 | ✅ 已接受 |
| [ADR-0002](0002-typescript-strict-mode.md)          | 启用TypeScript严格模式                        | 2025-11-09 | ✅ 已接受 |
| [ADR-0004](0004-unified-postgresql-architecture.md) | 统一PostgreSQL架构 (移除MongoDB/Neo4j/Qdrant) | 2026-02-21 | ✅ 已接受 |

### 提议中 (Proposed)

| ADR | 标题 | 日期 | 状态 |
| --- | ---- | ---- | ---- |
| -   | -    | -    | -    |

### 已弃用 (Deprecated)

| ADR                                        | 标题                               | 日期       | 被替代者 |
| ------------------------------------------ | ---------------------------------- | ---------- | -------- |
| [ADR-0003](0003-dual-database-strategy.md) | 使用PostgreSQL+MongoDB双数据库策略 | 2025-01-01 | ADR-0004 |

---

## 如何编写ADR

### 1. 复制模板

```bash
cp .claude/adrs/template.md .claude/adrs/NNNN-your-decision-title.md
```

编号从上一个ADR递增（例如：0004, 0005...）

### 2. 填写内容

按照模板结构填写：

- 更新状态（提议中 / 已接受 / 已弃用）
- 描述决策上下文和问题
- 列出考虑的所有方案
- 说明最终决策
- 分析预期结果和影响

### 3. 审查和合并

- 创建PR提交ADR
- 团队讨论和审查
- 达成共识后合并到main分支
- 更新本README的ADR列表

---

## ADR命名规范

```
格式: NNNN-descriptive-title.md

示例:
0001-monorepo-architecture.md
0002-typescript-strict-mode.md
0003-dual-database-strategy.md
0004-use-react-query-for-server-state.md
```

**命名规则**:

- 使用4位数字编号（从0001开始）
- 使用kebab-case（小写+连字符）
- 标题简洁但具有描述性
- 突出核心决策内容

---

## 何时创建ADR

### 必须创建ADR 🔴

- 选择核心技术栈（框架、数据库、语言）
- 重大架构变更（如引入新服务、重构核心模块）
- 影响整个团队的开发流程变更
- 重要的技术债务决策
- 安全或性能相关的关键决策

### 建议创建ADR 🟡

- 选择第三方库（如状态管理、UI组件库）
- 数据模型重大变更
- API设计重要决策
- 部署策略变更
- 测试策略变更

### 不需要ADR 🟢

- 日常bug修复
- 小范围重构
- 代码风格调整
- 依赖版本升级（无重大变更）
- 临时性的实验代码

---

## ADR模板

详见 [template.md](template.md)

---

## 参考资料

- [ADR GitHub Org](https://adr.github.io/)
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR Tools](https://github.com/npryce/adr-tools)
- [When Should I Write an ADR](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record/)
