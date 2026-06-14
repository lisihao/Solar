# Week 3 实现总结：评论系统

## 概述

本周完成了完整的评论系统实现，支持嵌套回复、点赞、编辑和软删除功能。

## 后端实现

### 数据模型

**Comment Model** (backend/prisma/schema.prisma)

```prisma
model Comment {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  resourceId  String    @map("resource_id")
  content     String    @db.Text
  parentId    String?   @map("parent_id")
  upvoteCount Int       @default(0) @map("upvote_count")
  replyCount  Int       @default(0) @map("reply_count")
  isEdited    Boolean   @default(false) @map("is_edited")
  isDeleted   Boolean   @default(false) @map("is_deleted")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  resource    Resource  @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  parent      Comment?  @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies     Comment[] @relation("CommentReplies")

  @@map("comments")
}
```

**关键特性：**

- 自引用关系支持无限嵌套
- 软删除保持树结构完整性
- 点赞和回复计数器
- 编辑标记

### API 端点

**CommentsController** (backend/src/comments/comments.controller.ts)

| 方法   | 端点                                        | 功能             |
| ------ | ------------------------------------------- | ---------------- |
| POST   | /api/v1/comments                            | 创建评论/回复    |
| GET    | /api/v1/comments/resource/:resourceId       | 获取资源的评论树 |
| GET    | /api/v1/comments/:id                        | 获取单个评论     |
| PATCH  | /api/v1/comments/:id                        | 更新评论内容     |
| DELETE | /api/v1/comments/:id                        | 软删除评论       |
| POST   | /api/v1/comments/:id/upvote                 | 点赞评论         |
| GET    | /api/v1/comments/resource/:resourceId/stats | 获取统计数据     |

### 业务逻辑

**CommentsService** (backend/src/comments/comments.service.ts)

**核心方法：**

1. **createComment(dto)**
   - 验证父评论存在性
   - 创建评论记录
   - 增加父评论回复计数
   - 返回完整评论数据含用户信息

2. **getResourceComments(resourceId)**
   - 加载顶层评论
   - 递归加载3层嵌套回复
   - 返回树形结构
   - 包含用户信息

3. **updateComment(id, dto)**
   - 更新内容
   - 设置 isEdited = true
   - 更新时间戳

4. **deleteComment(id)**
   - 软删除：isDeleted = true
   - 替换内容为 "[此评论已被删除]"
   - 保持树结构

5. **upvoteComment(id)**
   - 增加 upvoteCount
   - 返回新计数

6. **getCommentStats(resourceId)**
   - 总评论数
   - 顶层评论数
   - 回复数

## 前端实现

### 组件架构

```
CommentsList (容器)
├── CommentInput (输入框)
└── CommentItem (评论项) - 递归
    ├── CommentInput (回复框)
    └── CommentItem (嵌套回复)
```

### CommentInput 组件

**位置：** frontend/components/CommentInput.tsx

**功能：**

- 创建新评论
- 回复已有评论
- 表单验证
- 提交状态管理
- 取消回复

**Props：**

```typescript
interface CommentInputProps {
  resourceId: string;
  parentId?: string; // 回复时提供
  placeholder?: string;
  onCommentAdded?: (comment: any) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}
```

### CommentItem 组件

**位置：** frontend/components/CommentItem.tsx

**功能：**

- 显示评论内容
- 用户头像和信息
- 相对时间显示
- 点赞按钮
- 回复按钮（最多3层）
- 编辑/删除功能
- 递归显示嵌套回复

**关键实现：**

```typescript
const maxNestingLevel = 3; // 最大嵌套层级

// 相对时间格式化
const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  // 返回 "刚刚", "5分钟前", "2小时前", "3天前" 等
};

// 递归渲染回复
{comment.replies && comment.replies.length > 0 && (
  <div className="border-l-2 border-gray-200">
    {comment.replies.map((reply) => (
      <CommentItem
        key={reply.id}
        comment={reply}
        level={level + 1}
        {...props}
      />
    ))}
  </div>
)}
```

### CommentsList 组件

**位置：** frontend/components/CommentsList.tsx

**功能：**

- 加载评论树
- 加载统计数据
- 显示评论输入框
- 管理评论状态
- 实时更新

**状态管理：**

```typescript
const [comments, setComments] = useState<any[]>([]);
const [stats, setStats] = useState({ total: 0, topLevel: 0, replies: 0 });
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```

## 用户体验

### 交互流程

1. **发表评论**
   - 用户在输入框输入内容
   - 点击"评论"按钮
   - 评论立即显示在列表顶部
   - 统计数据更新

2. **回复评论**
   - 点击评论的"回复"按钮
   - 显示回复输入框，带用户名提示
   - 提交后嵌套显示在父评论下
   - 回复计数更新

3. **点赞**
   - 点击向上箭头图标
   - 图标变蓝，数字增加
   - 已点赞后禁用

4. **编辑评论**
   - 点击"编辑"按钮
   - 内容变为可编辑文本框
   - 保存或取消
   - 显示"已编辑"标记

5. **删除评论**
   - 点击"删除"按钮
   - 确认对话框
   - 软删除，显示"[此评论已被删除]"
   - 保持子回复可见

### 视觉设计

- 头像：圆形，8x8，字母初始头像
- 嵌套：左侧12px缩进，灰色边框
- 时间：相对时间格式（刚刚、5分钟前）
- 操作：灰色文字，悬停变蓝/红
- 空状态：消息气泡图标 + 提示文字

## 技术决策

### 1. 为什么使用软删除？

**优势：**

- 保持评论树结构完整
- 子回复仍可见
- 审计追踪
- 可恢复

**实现：**

```typescript
// 软删除
isDeleted: true
content: "[此评论已被删除]"

// 显示逻辑
if (comment.isDeleted) {
  return <div className="text-gray-400 italic">[此评论已被删除]</div>;
}
```

### 2. 为什么限制3层嵌套？

**原因：**

- 防止无限嵌套导致UI问题
- 移动端显示友好
- 性能优化

**实现：**

```typescript
const maxNestingLevel = 3;

{level < maxNestingLevel && (
  <button onClick={() => setShowReplyInput(true)}>
    回复
  </button>
)}
```

### 3. 为什么使用树形结构？

**优势：**

- 一次加载所有数据
- 减少API调用
- 更好的用户体验

**缺点：**

- 大量评论时数据量大
- 需要递归处理

**优化：**

- 后端限制嵌套深度为3层
- 前端虚拟滚动（待实现）
- 分页加载（待实现）

## 待办事项

### 1. 认证集成

```typescript
// TODO: 从 JWT token 获取当前用户ID
const currentUserId = 'mock-user-id'; // 临时方案

// 显示编辑/删除按钮的条件
{comment.userId === currentUserId && (
  <button onClick={() => setIsEditing(true)}>编辑</button>
)}
```

### 2. 实时更新

- [ ] 使用 WebSocket 或 Server-Sent Events
- [ ] 新评论实时推送
- [ ] 点赞数实时更新

### 3. 性能优化

- [ ] 虚拟滚动（react-window）
- [ ] 评论分页加载
- [ ] 图片懒加载
- [ ] 评论缓存

### 4. 功能增强

- [ ] @ 提及用户
- [ ] Markdown 支持
- [ ] 图片上传
- [ ] 举报功能
- [ ] 评论搜索
- [ ] 排序选项（最新、最热）

## 测试清单

### 单元测试

- [ ] CommentsService.createComment()
- [ ] CommentsService.getResourceComments()
- [ ] CommentsService.updateComment()
- [ ] CommentsService.deleteComment()
- [ ] CommentsService.upvoteComment()
- [ ] CommentsService.getCommentStats()

### 集成测试

- [ ] POST /api/v1/comments
- [ ] GET /api/v1/comments/resource/:resourceId
- [ ] PATCH /api/v1/comments/:id
- [ ] DELETE /api/v1/comments/:id
- [ ] POST /api/v1/comments/:id/upvote

### E2E 测试

- [ ] 用户发表评论
- [ ] 用户回复评论（3层嵌套）
- [ ] 用户编辑自己的评论
- [ ] 用户删除自己的评论
- [ ] 用户点赞评论
- [ ] 查看评论统计

## 部署注意事项

1. **数据库迁移**

   ```bash
   cd backend
   npx prisma migrate deploy
   ```

2. **环境变量**
   - 无新增环境变量

3. **依赖安装**

   ```bash
   # 后端无新增依赖
   # 前端无新增依赖
   ```

4. **API 文档更新**
   - 更新 Swagger/OpenAPI 文档
   - 添加评论 API 示例

## 数据库影响

### 新增表

- `comments` 表

### 索引优化建议

```sql
-- 提升查询性能
CREATE INDEX idx_comments_resource_id ON comments(resource_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_created_at ON comments(created_at DESC);
```

## 监控指标

- 评论创建成功率
- 评论加载时间
- API 响应时间
- 评论树深度分布
- 用户活跃度（评论数/用户）
- 点赞率

## 总结

Week 3 成功实现了功能完整的评论系统，包括：

✅ 7个 API 端点
✅ 完整的 CRUD 操作
✅ 嵌套回复支持（3层）
✅ 点赞功能
✅ 软删除
✅ 实时统计
✅ 3个前端组件
✅ 树形结构显示
✅ 响应式设计

下一步：Week 4 - 集成到统一面板 + My Library 页面
