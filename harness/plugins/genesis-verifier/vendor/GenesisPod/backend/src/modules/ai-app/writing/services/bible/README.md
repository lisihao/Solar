# Story Bible Services

## StoryBibleAuditService - 审计日志服务

### 概述

`StoryBibleAuditService` 是 Story Bible 的审计日志服务，负责记录所有 Story Bible 相关的变更历史，支持版本对比和变更追踪。

### 功能特性

1. **变更记录**
   - 单个变更记录
   - 批量变更记录
   - 支持所有实体类型（Bible、Character、WorldSetting、Timeline、Terminology、Faction）

2. **历史查询**
   - 获取完整变更历史（支持分页）
   - 获取特定实体的变更历史
   - 支持时间范围过滤

3. **版本对比**
   - 对比任意两个版本的差异
   - 智能识别新增、删除、修改
   - 增量变更记录

4. **统计分析**
   - 版本变更统计
   - 按类型、实体、变更者分组统计

5. **数据维护**
   - 清理过期审计日志

### 数据模型

#### 审计日志表 (story_bible_audit_logs)

```typescript
{
  id: string;              // 审计日志ID
  bibleId: string;         // Story Bible ID
  version: number;         // 版本号
  changeType: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: 'BIBLE' | 'CHARACTER' | 'WORLD_SETTING' | 'TIMELINE' | 'TERMINOLOGY' | 'FACTION';
  entityId?: string;       // 实体ID（如角色ID、设定ID）
  field: string;           // 变更的字段名
  oldValue?: any;          // 旧值（JSON格式）
  newValue?: any;          // 新值（JSON格式）
  changedBy: string;       // 变更者（'user', 'story-architect', 'bible-keeper' 等）
  reason?: string;         // 变更原因
  createdAt: Date;         // 创建时间
}
```

### 使用示例

#### 1. 记录单个变更

```typescript
await auditService.logChange({
  bibleId: "bible-123",
  version: 2,
  changeType: "UPDATE",
  entityType: "CHARACTER",
  entityId: "char-456",
  field: "personality",
  oldValue: { trait: "brave" },
  newValue: { trait: "brave", flaw: "impulsive" },
  changedBy: "story-architect",
  reason: "深化角色性格",
});
```

#### 2. 批量记录变更

```typescript
await auditService.logBulkChanges([
  {
    bibleId: "bible-123",
    version: 3,
    changeType: "CREATE",
    entityType: "WORLD_SETTING",
    entityId: "setting-789",
    field: "description",
    newValue: "魔法体系设定",
    changedBy: "user",
  },
  {
    bibleId: "bible-123",
    version: 3,
    changeType: "UPDATE",
    entityType: "BIBLE",
    field: "premise",
    oldValue: "旧的前提",
    newValue: "新的前提",
    changedBy: "bible-keeper",
    reason: "优化核心设定",
  },
]);
```

#### 3. 获取变更历史

```typescript
const { logs, total, hasMore } = await auditService.getChangeHistory(
  "bible-123",
  {
    limit: 20,
    offset: 0,
    entityType: "CHARACTER", // 可选：仅查看角色变更
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-12-31"),
  },
);
```

#### 4. 获取实体历史

```typescript
const history = await auditService.getEntityHistory(
  "bible-123",
  "CHARACTER",
  "char-456",
);

// history 返回该角色的所有变更记录，按时间升序排列
```

#### 5. 对比两个版本

```typescript
const comparison = await auditService.compareVersions(
  "bible-123",
  1, // 版本1
  5, // 版本5
);

// comparison 包含：
// - version1, version2: 版本号
// - differences: 所有差异列表
// - totalChanges: 变更总数

for (const diff of comparison.differences) {
  console.log(`${diff.field}: ${diff.changeType}`);
  console.log(`  旧值: ${JSON.stringify(diff.v1Value)}`);
  console.log(`  新值: ${JSON.stringify(diff.v2Value)}`);
}
```

#### 6. 获取版本统计

```typescript
const stats = await auditService.getVersionStats("bible-123", 3);

// stats 返回：
// {
//   version: 3,
//   totalChanges: 15,
//   changesByType: { CREATE: 5, UPDATE: 8, DELETE: 2 },
//   changesByEntity: { CHARACTER: 7, WORLD_SETTING: 5, TERMINOLOGY: 3 },
//   changedBy: { 'story-architect': 10, 'user': 5 }
// }
```

#### 7. 清理旧日志

```typescript
// 删除90天前的审计日志
const deletedCount = await auditService.cleanupOldLogs("bible-123", 90);
console.log(`清理了 ${deletedCount} 条旧日志`);
```

### 集成到其他服务

在修改 Story Bible 相关数据时，应该同时记录审计日志：

#### 示例：CharacterService 集成

```typescript
@Injectable()
export class CharacterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: StoryBibleAuditService,
  ) {}

  async update(
    id: string,
    projectId: string,
    userId: string,
    dto: UpdateCharacterDto,
  ) {
    const bible = await this.getBibleByProject(projectId, userId);
    const character = await this.prisma.writingCharacter.findFirst({
      where: { id, bibleId: bible.id },
    });

    if (!character) {
      throw new NotFoundException("Character not found");
    }

    // 准备审计日志
    const auditLogs = [];

    // 检测每个字段的变更
    if (dto.name && dto.name !== character.name) {
      auditLogs.push({
        bibleId: bible.id,
        version: bible.version + 1,
        changeType: "UPDATE" as const,
        entityType: "CHARACTER" as const,
        entityId: id,
        field: "name",
        oldValue: character.name,
        newValue: dto.name,
        changedBy: "user",
      });
    }

    if (dto.personality) {
      auditLogs.push({
        bibleId: bible.id,
        version: bible.version + 1,
        changeType: "UPDATE" as const,
        entityType: "CHARACTER" as const,
        entityId: id,
        field: "personality",
        oldValue: character.personality,
        newValue: dto.personality,
        changedBy: "user",
      });
    }

    // 执行更新和审计日志记录（事务）
    const [updatedCharacter] = await this.prisma.$transaction(async (tx) => {
      // 更新角色
      const updated = await tx.writingCharacter.update({
        where: { id },
        data: dto,
      });

      // 更新 Bible 版本号
      await tx.storyBible.update({
        where: { id: bible.id },
        data: { version: { increment: 1 } },
      });

      return [updated];
    });

    // 批量记录审计日志
    if (auditLogs.length > 0) {
      await this.auditService.logBulkChanges(auditLogs);
    }

    return updatedCharacter;
  }
}
```

### 最佳实践

1. **始终在事务中更新版本号**
   - 数据变更和版本递增应该在同一事务中完成
   - 审计日志可以在事务外记录（异步）

2. **记录有意义的变更**
   - 只记录实际发生变化的字段
   - 使用有意义的 changedBy 值（区分人工和 AI Agent）

3. **合理使用批量记录**
   - 单次操作涉及多个字段时，使用 `logBulkChanges`
   - 减少数据库往返次数

4. **定期清理**
   - 设置定时任务清理过期审计日志
   - 建议保留 90-180 天的历史记录

5. **版本号管理**
   - 每次变更递增版本号
   - 版本号应该与 StoryBible.version 保持一致

### 数据库迁移

在使用此服务前，需要运行数据库迁移：

```bash
cd backend
npx prisma migrate dev --name add_story_bible_audit_log
```

### 索引优化

审计日志表已经配置了以下索引：

- `(bibleId, version)` - 用于版本查询和对比
- `(bibleId, entityType, entityId)` - 用于实体历史查询
- `(bibleId, createdAt DESC)` - 用于时间范围查询

### 性能考虑

1. **分页查询**：获取历史时始终使用分页，避免一次性加载大量数据
2. **异步记录**：审计日志记录可以异步执行，不阻塞主业务流程
3. **定期清理**：避免表数据无限增长

### 相关文件

- Service: `backend/src/modules/ai-app/writing/services/bible/story-bible-audit.service.ts`
- Schema: `backend/prisma/schema.prisma` (StoryBibleAuditLog model)
- Module: 需要在 `ai-writing.module.ts` 中注册

### TODO

- [ ] 在 `ai-writing.module.ts` 中注册服务
- [ ] 集成到所有修改 Story Bible 的服务中
- [ ] 添加单元测试
- [ ] 添加 Controller 和 API 端点
- [ ] 实现定时清理任务
