# ADR-0003: 使用PostgreSQL+MongoDB双数据库策略

> **创建日期**: 2025-01-01
> **作者**: GenesisPod Team
> **审阅者**: -

---

## 状态

~~✅ **已接受** (Accepted) - 2025-01-01~~

**状态: 已废弃 (Superseded) - 2026-06-04**

> 2025 年后已移除 MongoDB（及 Neo4j、Qdrant），统一到 PostgreSQL 16（JSONB 存原始数据）+ Redis 7（缓存/会话）。唯一主库方案成本节约 70-75%，解决了跨库一致性问题。本 ADR 保留作历史记录，正文不作修改。

---

## 上下文

### 问题描述

GenesisPod需要存储两类数据：

**结构化数据**:

- 用户信息、资源元数据、学习路径、收藏等
- 需要复杂查询、关联查询、事务支持
- Schema相对固定

**原始数据**:

- 从arXiv、GitHub等API获取的完整原始响应
- 数据结构不固定，各个来源差异大
- 数据量大，主要用于归档和数据分析
- 极少需要复杂查询

我们需要选择合适的数据库方案来存储这两类数据。

### 约束条件

- **技术约束**:
  - 必须支持ACID事务（用户操作）
  - 必须支持高效的关联查询
  - 原始数据存储成本要低

- **资源约束**:
  - 小团队，不希望维护过多系统
  - 云服务成本需要控制

- **业务约束**:
  - 资源元数据需要强一致性
  - 原始数据允许最终一致性
  - 需要保留完整原始数据用于未来分析

### 目标

- [x] 结构化数据有强类型支持和事务保证
- [x] 原始数据完整保存，便于追溯和分析
- [x] 两类数据通过ID关联，保持同步
- [x] 查询性能和存储成本平衡

---

## 决策

我们决定采用 **PostgreSQL + MongoDB 双数据库策略**：

- **PostgreSQL**: 存储结构化数据（用户、资源元数据、关系）
- **MongoDB**: 存储完整的API原始响应数据

### 详细说明

**数据流程**:

```
API Source (arXiv/GitHub)
         ↓
1. 完整原始数据 → MongoDB (raw_data)
         ↓
2. 提取结构化数据 → PostgreSQL (resources)
         ↓
3. 建立双向引用关系
   - PostgreSQL.resource.rawDataId → MongoDB._id
   - MongoDB.raw_data.resourceId → PostgreSQL.resource.id
```

**PostgreSQL Schema (Prisma)**:

```prisma
model Resource {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(500)
  type        ResourceType
  sourceUrl   String   @unique

  // 关联MongoDB中的原始数据
  rawDataId   String?

  createdAt   DateTime @default(now())
}
```

**MongoDB Document**:

```json
{
  "_id": ObjectId("..."),
  "resourceId": "clxy123456",  // 关联PostgreSQL
  "source": "arxiv",
  "sourceId": "2301.12345",

  // 完整的API原始响应
  "rawResponse": {
    "title": "...",
    "authors": [...],
    "abstract": "...",
    // ... 所有字段
  },

  "fetchedAt": ISODate("2024-01-01T00:00:00Z")
}
```

### 实施要点

- 使用Prisma管理PostgreSQL Schema
- 使用MongoDB Node.js Driver管理MongoDB
- 服务层封装双数据库操作，保证原子性
- 建立数据一致性检查脚本

---

## 考虑的方案

### 方案A: 仅使用PostgreSQL

#### 描述

所有数据存储在PostgreSQL中，原始数据使用JSON/JSONB字段。

#### 优点

- ✅ **简单**: 只需维护一个数据库
- ✅ **事务性**: 所有数据在同一事务中
- ✅ **查询一致**: 统一使用SQL

#### 缺点

- ❌ **Schema限制**: JSONB字段缺少灵活性
- ❌ **存储成本高**: PostgreSQL云服务成本较MongoDB高
- ❌ **性能问题**: 大量JSON数据影响查询性能
- ❌ **扩展性差**: 随着数据增长性能下降明显

#### 成本

- 开发时间：1周
- 学习曲线：低
- 长期维护：中
- 存储成本：高

---

### 方案B: 仅使用MongoDB

#### 描述

所有数据存储在MongoDB中，使用文档引用处理关系。

#### 优点

- ✅ **灵活**: Schema-less，适合多样化数据
- ✅ **成本低**: MongoDB存储成本较低
- ✅ **水平扩展**: 易于分片扩展

#### 缺点

- ❌ **事务支持弱**: 虽然支持事务但不如PostgreSQL成熟
- ❌ **关联查询复杂**: $lookup性能不如SQL JOIN
- ❌ **缺少类型安全**: 无Schema，容易出错
- ❌ **数据一致性难保证**: 最终一致性模型

#### 成本

- 开发时间：1周
- 学习曲线：中
- 长期维护：高（数据一致性问题）
- 存储成本：低

---

### 方案C: PostgreSQL + MongoDB (双数据库) ✅ 选择此方案

#### 描述

PostgreSQL存储结构化数据，MongoDB存储原始数据，通过ID关联。

#### 优点

- ✅ **各取所长**: PostgreSQL处理关系，MongoDB处理非结构化数据
- ✅ **性能优化**: 结构化查询快速，原始数据不影响性能
- ✅ **成本优化**: 大量原始数据存储在便宜的MongoDB
- ✅ **类型安全**: 结构化数据有Prisma类型支持
- ✅ **灵活性**: 原始数据无Schema限制

#### 缺点

- ❌ **复杂性增加**: 需要维护两个数据库
- ❌ **一致性挑战**: 需要手动维护两个数据库的一致性
- ❌ **事务跨库**: 无法在两个数据库间使用事务

#### 成本

- 开发时间：2周
- 学习曲线：中
- 长期维护：中
- 存储成本：低

---

### 方案D: PostgreSQL + S3

#### 描述

PostgreSQL存储结构化数据，原始数据以JSON文件存储在S3。

#### 优点

- ✅ **成本最低**: S3存储极其便宜
- ✅ **无限扩展**: S3容量无限
- ✅ **简单**: S3无需维护

#### 缺点

- ❌ **查询困难**: 原始数据无法查询，只能下载
- ❌ **延迟高**: 读取S3延迟较MongoDB高
- ❌ **无索引**: 无法建立索引，检索慢

#### 成本

- 开发时间：1.5周
- 学习曲线：低
- 长期维护：低
- 存储成本：极低

---

## 决策理由

我们选择**方案C: PostgreSQL + MongoDB**的主要理由：

1. **性能最优**: PostgreSQL快速查询结构化数据，MongoDB高效存储大量文档
2. **成本平衡**: PostgreSQL存储少量高价值数据，MongoDB存储大量低成本数据
3. **类型安全**: Prisma + TypeScript提供编译时类型检查
4. **查询灵活**: 原始数据可以被查询（vs S3），支持未来数据分析需求
5. **业界验证**: 许多公司使用类似架构（如Airbnb, Uber）

### 对比总结

| 维度         | PostgreSQL Only | MongoDB Only | PostgreSQL + MongoDB | PostgreSQL + S3 |
| ------------ | --------------- | ------------ | -------------------- | --------------- |
| 查询性能     | ⭐⭐⭐          | ⭐⭐⭐       | ⭐⭐⭐⭐⭐           | ⭐⭐⭐          |
| 存储成本     | ⭐⭐            | ⭐⭐⭐⭐     | ⭐⭐⭐⭐             | ⭐⭐⭐⭐⭐      |
| 类型安全     | ⭐⭐⭐⭐⭐      | ⭐⭐         | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐⭐      |
| 事务支持     | ⭐⭐⭐⭐⭐      | ⭐⭐⭐       | ⭐⭐⭐⭐             | ⭐⭐⭐⭐        |
| Schema灵活性 | ⭐⭐            | ⭐⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐           | ⭐⭐⭐⭐        |
| 维护复杂度   | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐     | ⭐⭐⭐               | ⭐⭐⭐⭐        |
| 原始数据查询 | ⭐⭐⭐          | ⭐⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐           | ⭐              |

---

## 结果

### 正面影响

- ✅ **查询性能提升**: 结构化查询响应时间<100ms（vs PostgreSQL JSONB的300ms+）
- ✅ **存储成本降低40%**: 大量原始数据存储在MongoDB
- ✅ **类型安全**: Prisma提供编译时类型检查，减少运行时错误
- ✅ **数据完整性**: 原始数据100%保留，便于数据分析和问题追溯
- ✅ **灵活性**: 可以快速添加新数据源，无Schema限制

### 负面影响 / 权衡

- ⚠️ **复杂性增加**: 需要维护两个数据库连接和配置
- ⚠️ **一致性挑战**: 需要确保PostgreSQL和MongoDB数据同步
- ⚠️ **无跨库事务**: 两个数据库操作无法在同一事务中

### 风险与缓解措施

#### 风险1: 数据不一致（MongoDB有rawData但PostgreSQL没有resource，或反之）

- **可能性**: 中
- **影响**: 中
- **缓解措施**:
  - 编写数据一致性检查脚本，定期运行
  - 在服务层封装操作，确保要么都成功要么都失败
  - 建立告警机制，发现不一致立即修复
  - 双向引用：PostgreSQL.rawDataId ↔ MongoDB.resourceId

#### 风险2: 运维复杂度增加

- **可能性**: 高
- **影响**: 低
- **缓解措施**:
  - 使用托管服务（AWS RDS + MongoDB Atlas）
  - 统一的备份策略
  - 监控两个数据库的健康状况

#### 风险3: 查询跨两个数据库

- **可能性**: 中
- **影响**: 低
- **缓解措施**:
  - 在应用层处理关联，避免跨库JOIN
  - 在PostgreSQL保存必要的冗余字段
  - 使用缓存减少跨库查询

### 成功指标

- [x] 结构化查询平均响应时间<100ms
- [x] 原始数据100%保存，无丢失
- [x] 数据一致性>99.9%（每月检查）
- [x] 存储成本比单PostgreSQL降低40%

---

## 实施计划

### 阶段1: 初始设置 (Week 1)

- [x] 配置PostgreSQL和MongoDB连接
- [x] 设计Prisma Schema
- [x] 设计MongoDB Collection结构
- [x] 实现MongodbService封装

### 阶段2: 数据操作层 (Week 1-2)

- [x] 实现双数据库写入逻辑
- [x] 添加错误处理和重试机制
- [x] 建立双向引用关系

### 阶段3: 一致性保证 (Week 2)

- [x] 编写数据一致性检查脚本
- [x] 实现link-raw-data脚本修复不一致数据
- [x] 添加监控和告警

### 阶段4: 测试和验证 (Week 2)

- [x] 单元测试和集成测试
- [x] 压力测试验证性能
- [x] 灾难恢复演练

---

## 数据一致性策略

### 写入策略 (强一致性)

```typescript
async function createResource(data: CreateResourceDto) {
  let rawDataId: string | null = null;
  let resourceId: string | null = null;

  try {
    // 1. 先存MongoDB（完整原始数据）
    rawDataId = await mongodb.insertRawData("arxiv", rawData);

    // 2. 再存PostgreSQL（结构化数据）
    const resource = await prisma.resource.create({
      data: {
        ...extractedData,
        rawDataId,
      },
    });
    resourceId = resource.id;

    // 3. 建立反向引用（MongoDB → PostgreSQL）
    await mongodb.linkResourceToRawData(rawDataId, resourceId);

    return resource;
  } catch (error) {
    // 回滚：删除已创建的数据
    if (rawDataId && !resourceId) {
      await mongodb.deleteRawData(rawDataId);
    }
    throw error;
  }
}
```

### 一致性检查脚本

```typescript
// 定期运行（每天）
async function checkDataConsistency() {
  // 检查1: PostgreSQL的每个resource是否有对应的MongoDB记录
  const orphanResources = await prisma.resource.findMany({
    where: {
      OR: [
        { rawDataId: null },
        { rawDataId: { notIn: await mongodb.getAllRawDataIds() } },
      ],
    },
  });

  // 检查2: MongoDB的每个rawData是否有resourceId
  const orphanRawData = await mongodb.countDocuments({
    resourceId: { $exists: false },
  });

  // 报告不一致
  if (orphanResources.length > 0 || orphanRawData > 0) {
    alertTeam({
      orphanResources: orphanResources.length,
      orphanRawData,
    });
  }
}
```

---

## 后续行动

- [x] 编写数据库操作最佳实践文档
- [x] 建立定期数据一致性检查（每日）
- [x] 监控两个数据库的性能指标
- [x] 定期review存储成本优化机会
- [x] 6个月后评估是否需要引入缓存层

---

## 参考资料

- [Prisma Documentation](https://www.prisma.io/docs/)
- [MongoDB Node.js Driver](https://www.mongodb.com/docs/drivers/node/current/)
- [Polyglot Persistence](https://martinfowler.com/bliki/PolyglotPersistence.html)
- [Database per Service Pattern](https://microservices.io/patterns/data/database-per-service.html)
- [Uber's Schemaless](https://eng.uber.com/schemaless-part-one-mysql-datastore/)

---

## 变更历史

| 日期       | 版本 | 变更内容                       | 作者 |
| ---------- | ---- | ------------------------------ | ---- |
| 2025-01-01 | 1.0  | 初始版本，决定使用双数据库策略 | Team |
| 2025-11-09 | 1.1  | 添加数据一致性检查和修复策略   | Team |

---

## 实际运行数据 (3个月)

### 性能指标

- **平均查询响应时间**: 75ms (vs 预期<100ms) ✅
- **P95响应时间**: 180ms
- **P99响应时间**: 450ms

### 数据统计

- **PostgreSQL记录数**: 15,000+
- **MongoDB文档数**: 15,123
- **数据一致性**: 99.95% ✅

### 成本

- **PostgreSQL**: $50/月
- **MongoDB**: $30/月
- **总成本**: $80/月 (vs 单PostgreSQL预估$130/月) ✅

### 问题

- 发现3次数据不一致情况，都通过link-raw-data脚本成功修复
- 无重大事故
