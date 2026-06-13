# Library页面CRUD功能修复方案

## 问题背景

### 当前错误的实现

1. **删除功能**：直接删除资源本身 (`DELETE /api/v1/resources/{id}`) ❌
   - 影响所有用户的资源访问
   - 破坏系统数据完整性

2. **编辑功能**：直接修改资源本身 (`PATCH /api/v1/resources/{id}`) ❌
   - 修改全局共享的资源数据
   - 用户无法添加个人笔记

### 核心概念

- **Resource（资源）**：系统中的内容实体，所有用户共享
- **CollectionItem（收藏项）**：用户个人的收藏记录，包含个人笔记
- **Collection（收藏集）**：用户的收藏夹，如"我的收藏"

## 正确的产品方案

### 1. 功能重新定义

| 操作               | 当前错误行为    | 正确行为            | API端点                                                            | 影响范围 |
| ------------------ | --------------- | ------------------- | ------------------------------------------------------------------ | -------- |
| **查看**           | 显示资源详情 ✓  | 显示资源详情 ✓      | `GET /api/v1/resources/{id}`                                       | 只读     |
| **编辑笔记**       | 修改资源本身 ❌ | 编辑个人笔记/标签 ✓ | `PATCH /api/v1/collections/{collectionId}/items/{resourceId}/note` | 仅个人   |
| **从收藏移除**     | 删除资源本身 ❌ | 从收藏中移除 ✓      | `DELETE /api/v1/collections/{collectionId}/items/{resourceId}`     | 仅个人   |
| _(管理员)编辑资源_ | -               | 修改资源本身        | `PATCH /api/v1/resources/{id}`                                     | 全局     |

### 2. UI/UX 改进

#### 操作按钮文案和图标

- **查看详情** (蓝色眼睛图标) - 保持不变 ✓
- **编辑笔记** (绿色铅笔图标) - 文案改为"编辑笔记"
- **从收藏移除** (红色移除图标) - 改为"从收藏移除"，使用减号图标

#### Modal标题和提示

- **Edit Note Modal**: "编辑收藏笔记" / "Edit Bookmark Note"
- **Remove Dialog**: "从收藏中移除" / "Remove from Collection"
- 明确告知用户这不会删除资源本身

## 技术实现方案

### 1. 数据结构调整

```typescript
// 添加 CollectionItem 接口
interface CollectionItem {
  id: string;
  collectionId: string;
  resourceId: string;
  note?: string; // 个人笔记
  createdAt: string;
  resource: Resource; // 关联的资源对象
}

// 修改状态管理
const [bookmarkItems, setBookmarkItems] = useState<CollectionItem[]>([]);
const [currentCollectionId, setCurrentCollectionId] = useState<string>("");
const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
```

### 2. API调用修复

#### loadBookmarks 函数

```typescript
const loadBookmarks = async () => {
  const collections = await fetch("/api/v1/collections");
  const defaultCollection = collections.find((c) => c.name === "我的收藏");

  // 保存完整的 CollectionItem 而不只是 Resource
  setBookmarkItems(defaultCollection.items); // items 包含 resource
  setCurrentCollectionId(defaultCollection.id);
};
```

#### 删除操作 (From Collection)

```typescript
const handleRemoveFromCollection = async (item: CollectionItem) => {
  const response = await fetch(
    `/api/v1/collections/${currentCollectionId}/items/${item.resourceId}`,
    { method: "DELETE" },
  );

  if (response.ok) {
    setBookmarkItems((items) => items.filter((i) => i.id !== item.id));
  }
};
```

#### 编辑笔记操作

```typescript
const handleEditNote = async (item: CollectionItem, newNote: string) => {
  const response = await fetch(
    `/api/v1/collections/${currentCollectionId}/items/${item.resourceId}/note`,
    {
      method: "PATCH",
      body: JSON.stringify({ note: newNote }),
    },
  );

  if (response.ok) {
    setBookmarkItems((items) =>
      items.map((i) => (i.id === item.id ? { ...i, note: newNote } : i)),
    );
  }
};
```

### 3. ResourceCard 组件改造

```typescript
const ResourceCard = ({ item }: { item: CollectionItem }) => {
  const { resource, note } = item;

  return (
    <div className="group relative">
      {/* 操作按钮 */}
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100">
        <button onClick={() => handleView(resource)} title="查看详情">
          {/* 眼睛图标 */}
        </button>
        <button onClick={() => handleEditNote(item)} title="编辑笔记">
          {/* 笔记图标 */}
        </button>
        <button onClick={() => handleRemove(item)} title="从收藏移除">
          {/* 移除图标 (减号) */}
        </button>
      </div>

      {/* 资源内容 */}
      <Link href={`/?id=${resource.id}`}>
        {/* ...资源卡片内容... */}
      </Link>

      {/* 个人笔记预览 */}
      {note && (
        <div className="mt-2 text-xs text-gray-500 italic">
          Note: {note.substring(0, 100)}...
        </div>
      )}
    </div>
  );
};
```

## 实施计划

### Phase 1: 数据层修复 (高优先级) ✅

1. 修改数据结构和状态管理
2. 修改 loadBookmarks 保存完整 CollectionItem
3. 修复删除API调用
4. 修复编辑API调用

### Phase 2: UI/UX 改进 (高优先级)

1. 更新按钮文案和提示
2. 修改 Modal 标题和说明
3. 更新图标（移除用减号而非垃圾桶）
4. 添加笔记显示区域

### Phase 3: YouTube 视频特殊处理 (中优先级)

1. YouTube 视频保存到专门collection
2. 视频删除只移除收藏，保留原始数据

### Phase 4: 测试验证 (必须)

1. 测试从收藏移除功能
2. 验证资源本身未被删除
3. 测试笔记编辑功能
4. 验证其他用户不受影响

## 风险评估

### 高风险

- ❌ 当前实现会删除全局资源，影响所有用户
- ❌ 修改资源会影响所有收藏该资源的用户

### 修复后

- ✅ 只影响个人收藏
- ✅ 资源数据完整性得到保护
- ✅ 用户可以添加个人笔记

## 向后兼容性

- 现有收藏数据无需迁移
- API 已经支持正确的操作
- 只需修改前端调用逻辑

## 总结

这是一个**严重的业务逻辑错误**，必须立即修复。修复方案已经明确，后端API已经支持正确的操作，只需要修改前端的数据结构和API调用即可。
