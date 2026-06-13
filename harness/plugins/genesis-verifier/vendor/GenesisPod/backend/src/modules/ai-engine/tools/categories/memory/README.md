# Memory Tools - 记忆系统工具

Agent 记忆系统，支持短期记忆和长期记忆。

## 功能概述

### 短期记忆 (Short Term Memory)

会话级别的临时记忆存储，适用于存储会话上下文、临时状态等。

**特点:**

- 基于内存 Map 存储（生产环境可替换为 Redis）
- 支持 TTL 过期机制
- 支持 sessionId 隔离
- 自动清理过期数据

**支持的操作:**

- `get` - 获取记忆
- `set` - 设置记忆
- `append` - 追加到数组
- `delete` - 删除记忆
- `clear` - 清空会话记忆
- `list` - 列出所有记忆

**使用示例:**

```typescript
// 设置记忆
{
  operation: "set",
  key: "user_preferences",
  value: { theme: "dark", language: "zh-CN" },
  ttl: 3600 // 1小时后过期
}

// 获取记忆
{
  operation: "get",
  key: "user_preferences"
}

// 追加到数组
{
  operation: "append",
  key: "conversation_history",
  value: { role: "user", content: "Hello" }
}

// 列出所有记忆
{
  operation: "list"
}
```

### 长期记忆 (Long Term Memory)

持久化记忆存储，支持语义搜索和高级查询。

**特点:**

- 使用 PostgreSQL 持久化存储
- 支持向量化存储和语义搜索（未来扩展）
- 支持 userId 隔离
- 支持按 type、importance、tags 过滤和排序

**支持的操作:**

- `store` - 存储记忆
- `retrieve` - 检索记忆
- `search` - 语义搜索
- `delete` - 删除记忆
- `list` - 列出记忆
- `update` - 更新元数据

**使用示例:**

```typescript
// 存储知识
{
  operation: "store",
  key: "project_requirements",
  value: { title: "AI Agent System", description: "..." },
  type: "knowledge",
  importance: 8,
  tags: ["project", "requirements"]
}

// 检索记忆
{
  operation: "retrieve",
  key: "project_requirements"
}

// 搜索记忆
{
  operation: "search",
  query: "AI Agent requirements",
  options: {
    limit: 10,
    threshold: 0.7
  },
  type: "knowledge"
}

// 列出用户偏好
{
  operation: "list",
  type: "preference",
  options: {
    sortBy: "importance",
    sortOrder: "desc",
    limit: 20
  }
}

// 更新重要性
{
  operation: "update",
  key: "project_requirements",
  importance: 10,
  tags: ["project", "requirements", "critical"]
}
```

## 架构说明

```
backend/src/modules/ai/ai-agents/
├── core/memory/                    # 核心记忆模块
│   ├── memory.interface.ts         # 记忆接口定义
│   ├── short-term.memory.ts        # 短期记忆服务
│   ├── long-term.memory.ts         # 长期记忆服务
│   └── index.ts
└── tools/memory/                   # 记忆工具
    ├── short-term-memory.tool.ts   # 短期记忆工具
    ├── long-term-memory.tool.ts    # 长期记忆工具
    ├── README.md
    └── index.ts
```

## 数据库表结构

长期记忆需要在 PostgreSQL 中创建表：

```sql
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  type VARCHAR(100),
  importance INTEGER DEFAULT 5,
  tags TEXT[],
  embedding VECTOR(1536),  -- 向量字段（未来扩展）
  expires_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- 索引
CREATE INDEX idx_agent_memories_user_id ON agent_memories(user_id);
CREATE INDEX idx_agent_memories_type ON agent_memories(type);
CREATE INDEX idx_agent_memories_tags ON agent_memories USING GIN(tags);
CREATE INDEX idx_agent_memories_importance ON agent_memories(importance);
```

## 配置说明

### 短期记忆配置

```typescript
// 在 ShortTermMemoryService 中配置
private readonly defaultTTL = 3600; // 默认过期时间（秒）
private readonly cleanupIntervalMs = 60000; // 清理间隔（毫秒）
```

### 长期记忆配置

长期记忆使用 PrismaService 连接数据库，需要在 Prisma schema 中定义表结构。

## 性能优化建议

### 短期记忆

- **生产环境替换为 Redis**: 当前使用内存 Map，多实例部署时应替换为 Redis
- **设置合理的 TTL**: 避免内存泄漏
- **定期清理**: 已实现自动清理机制

### 长期记忆

- **使用向量搜索**: 集成 pgvector 扩展实现语义搜索
- **添加缓存层**: 对热点数据使用 Redis 缓存
- **优化查询**: 使用适当的索引和分页
- **定期清理过期数据**: 设置定时任务清理过期记忆

## 未来扩展

1. **向量化存储**: 集成 pgvector 实现语义搜索
2. **Redis 集成**: 短期记忆使用 Redis 替代内存 Map
3. **记忆压缩**: 对长期不使用的记忆进行压缩存储
4. **记忆重要性自动评估**: 基于访问频率和上下文自动调整重要性
5. **记忆关联**: 建立记忆之间的关联关系
6. **多模态记忆**: 支持存储图片、音频等多模态数据

## 测试

```bash
# 运行单元测试
npm test -- --grep "Memory"

# 运行集成测试
npm run test:e2e -- --grep "Memory"
```

## 注意事项

1. **数据隔离**: 确保使用正确的 sessionId 和 userId 进行数据隔离
2. **敏感数据**: 不要在记忆中存储敏感信息（密码、密钥等）
3. **数据大小**: 注意控制单个记忆的大小，避免性能问题
4. **过期策略**: 合理设置 TTL，避免数据堆积
5. **并发控制**: 长期记忆的更新操作需要注意并发控制

## License

Copyright © 2025 GenesisPod
