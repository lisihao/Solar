# ADR-0004: 统一 PostgreSQL 架构 (移除 MongoDB/Neo4j/Qdrant)

**日期**: 2026-02-21
**状态**: ✅ 已接受
**作者**: Claude Code

---

## 摘要

将数据库架构从 PostgreSQL + MongoDB + Neo4j + Qdrant 多数据库架构迁移到**统一的 PostgreSQL 16 单一数据库架构**，使用 JSONB 存储原始数据、递归 CTE 实现知识图谱、pgvector 实现向量搜索。

---

## 背景

### 原有架构问题

- **运维复杂**: 需要维护 4 个不同的数据库服务
- **成本高**: MongoDB + Neo4j + Qdrant 额外增加 70-75% 成本
- **数据一致性问题**: 多数据库之间需要双向同步
- **开发效率**: 团队需要熟悉多种数据库技术

### 决策驱动

- 成本优化需求
- 简化运维复杂度
- PostgreSQL 15+ 的 JSONB 和递归 CTE 功能成熟

---

## 考虑的方案

### 方案 A: 保持多数据库架构 (原有)

- PostgreSQL: 结构化数据
- MongoDB: 原始数据
- Neo4j: 知识图谱
- Qdrant: 向量搜索

**优点**:

- 各数据库擅长领域发挥最大性能

**缺点**:

- 运维成本高
- 数据一致性挑战
- 需要多种技术栈 expertise

### 方案 B: 仅使用 PostgreSQL (选择)

使用 PostgreSQL 16 的高级特性:

- **JSONB**: 替代 MongoDB 存储原始数据
- **递归 CTE**: 替代 Neo4j 实现知识图谱遍历
- **pgvector**: 替代 Qdrant 实现向量搜索

**优点**:

- 单一数据库，运维简单
- 成本降低 70-75%
- 数据一致性保证
- 团队只需掌握 PostgreSQL

**缺点**:

- JSONB 查询性能略低于 MongoDB
- 图遍历性能略低于 Neo4j
- 向量搜索精度略低于专业向量数据库

---

## 决策

**选择方案 B: 统一 PostgreSQL 架构**

### 技术实现

| 场景       | 实现方式                    |
| ---------- | --------------------------- |
| 结构化数据 | PostgreSQL 表 + Prisma ORM  |
| 原始数据   | PostgreSQL JSONB + GIN 索引 |
| 知识图谱   | PostgreSQL 递归 CTE         |
| 向量搜索   | PostgreSQL pgvector 扩展    |
| 缓存       | Redis 7                     |

### 迁移策略

1. **Phase 1**: 创建 JSONB 表存储原始数据，迁移 MongoDB 数据
2. **Phase 2**: 使用递归 CTE 重写图查询，迁移 Neo4j 关系数据
3. **Phase 3**: 启用 pgvector，迁移 Qdrant 向量数据
4. **Phase 4**: 移除 MongoDB、Neo4j、Qdrant 服务

---

## 影响

### 正面影响

- ✅ 运维成本降低 70-75%
- ✅ 简化开发和调试流程
- ✅ 数据一致性保证
- ✅ 减少技术栈复杂度

### 需要注意

- ⚠️ JSONB 查询需要使用特定语法
- ⚠️ 图查询需要使用递归 CTE
- ⚠️ 向量搜索精度可能略有下降
- ⚠️ 需要团队学习 PostgreSQL 高级特性

---

## 相关文档

- [数据库设计规范](../standards/06-database-design.md)
- [STRUCTURE.md](../../STRUCTURE.md)
- [docker-compose.yml](../../docker-compose.yml)

---

## 历史

- 2026-02-21: 创建 ADR-0004，统一 PostgreSQL 架构决策
- 2025-01-01: ADR-0003 (已弃用) - PostgreSQL + MongoDB 双数据库策略
