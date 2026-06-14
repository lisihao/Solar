# Performance

性能分析和优化。

**目标**: $ARGUMENTS

## 优化领域

### 1. 前端性能

- **首屏加载** - 代码分割、懒加载
- **渲染性能** - 减少 re-render、虚拟滚动
- **Bundle 大小** - Tree shaking、动态导入

### 2. 后端性能

- **API 响应** - 缓存、并行处理
- **数据库查询** - N+1 问题、索引优化
- **内存使用** - 内存泄漏、大对象处理

### 3. AI 调用性能

- **Token 优化** - 减少输入长度
- **并发控制** - Rate limiting、队列
- **流式响应** - SSE/WebSocket

## 诊断工具

### 前端

```bash
# Bundle 分析
npm run build -- --analyze

# Lighthouse
npx lighthouse http://localhost:3000
```

### 后端

```bash
# Prisma 查询日志
# 在 schema.prisma 中启用:
# generator client {
#   previewFeatures = ["tracing"]
# }

# 性能测试
npm run test:perf
```

## 常见问题和解决方案

### N+1 查询

```typescript
// 问题
const users = await prisma.user.findMany();
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { userId: user.id } });
}

// 解决
const users = await prisma.user.findMany({
  include: { posts: true },
});
```

### React Re-render

```typescript
// 问题: 每次渲染创建新函数
<Button onClick={() => handleClick(id)} />

// 解决: useCallback
const handleClick = useCallback((id) => {...}, [deps])
```

### 大列表渲染

```typescript
// 使用虚拟滚动
import { useVirtualizer } from "@tanstack/react-virtual";
```

## 性能标准

| 指标             | 目标    |
| ---------------- | ------- |
| 首屏加载         | < 2s    |
| API 响应         | < 500ms |
| AI 首字节        | < 2s    |
| Lighthouse Score | > 80    |

## 我会帮助你

- 分析性能瓶颈
- 优化数据库查询
- 减少前端 re-render
- 优化 AI 调用效率
- 实现缓存策略
