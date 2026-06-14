# Schema

数据库架构设计和管理。

**任务**: $ARGUMENTS

## 专业领域

1. **Prisma Schema 设计** - 模型定义、关系、索引
2. **迁移管理** - 安全迁移、数据保留
3. **多数据库** - PostgreSQL + MongoDB + Neo4j
4. **性能优化** - 索引策略、查询优化

## Prisma Schema 位置

```
backend/prisma/schema.prisma  # 主 PostgreSQL schema
```

## 常用操作

### 查看当前 Schema

```bash
npx prisma studio
```

### 创建迁移

```bash
npx prisma migrate dev --name <migration_name>
```

### 生成客户端

```bash
npx prisma generate
```

### 重置数据库 (危险)

```bash
npx prisma migrate reset
```

## 模型设计规范

### 命名约定

- 模型名: PascalCase (User, KnowledgeBase)
- 字段名: camelCase (createdAt, userId)
- 关系: 单数 (user) 或复数 (posts)

### 必需字段

```prisma
model Example {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // ...
}
```

### 关系定义

```prisma
model User {
  id    String @id
  posts Post[]
}

model Post {
  id       String @id
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
}
```

### 索引设计

```prisma
model Resource {
  id     String @id
  userId String
  type   String

  @@index([userId])
  @@index([type, userId])
}
```

## 迁移安全检查

- [ ] 是否会丢失数据？
- [ ] 是否需要数据迁移脚本？
- [ ] 是否有破坏性变更？
- [ ] 索引是否合理？
- [ ] 外键约束是否正确？

## 我会帮助你

- 设计数据模型和关系
- 创建安全的迁移
- 优化查询性能
- 解决 schema 冲突
