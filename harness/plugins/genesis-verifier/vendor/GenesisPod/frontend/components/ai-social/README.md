# AI Social 组件

AI Social 模块的前端组件库。

## 组件列表

### 核心页面组件

- `ConnectionsTab.tsx` - 平台连接管理页面
- `ContentsTab.tsx` - 内容管理页面

### 创建流程组件

- `create/AccountSelector.tsx` - 账号选择器
- `create/PlatformSelector.tsx` - 平台选择器
- `create/SourceSelector.tsx` - 内容来源选择器
- `create/ContentEditor.tsx` - 内容编辑器
- `create/StepNavigation.tsx` - 步骤导航

### 加载状态组件

- `skeletons/ConnectionCardSkeleton.tsx` - 连接卡片骨架屏
- `skeletons/ContentTableSkeleton.tsx` - 内容表格骨架屏

### 错误处理组件

- `SocialErrorFallback.tsx` - AI Social 专用错误回退 UI

## ErrorBoundary 使用指南

### 基本用法

AI Social 页面已经集成了 ErrorBoundary，会自动捕获子组件中的渲染错误：

```tsx
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { SocialErrorFallback } from '@/components/ai-social/SocialErrorFallback';

<ErrorBoundary
  fallback={
    <SocialErrorFallback
      onReset={() => window.location.reload()}
      onReload={() => window.location.reload()}
      onGoHome={() => (window.location.href = '/')}
    />
  }
>
  <YourComponent />
</ErrorBoundary>;
```

### 测试错误边界

在开发环境中测试 ErrorBoundary：

1. **临时添加测试错误组件**：

```tsx
// 在任意子组件中添加
const ErrorTest = () => {
  throw new Error('Test Error Boundary');
};

// 在页面中使用
{
  activeTab === 'test' && <ErrorTest />;
}
```

2. **触发错误**：
   - 访问 AI Social 页面
   - 切换到测试 tab
   - 应该看到 SocialErrorFallback 组件显示

3. **验证功能**：
   - 查看错误详情（仅开发模式显示）
   - 点击"重试"按钮
   - 点击"刷新页面"按钮
   - 点击"返回首页"按钮

### 错误日志

ErrorBoundary 会自动记录错误信息：

- **开发环境**：控制台显示完整错误堆栈
- **生产环境**：预留了 Sentry 集成接口

### 自定义错误处理

如果需要在特定组件中自定义错误处理：

```tsx
<ErrorBoundary
  fallback={<CustomErrorUI />}
  onError={(error, errorInfo) => {
    // 自定义错误处理逻辑
    console.log('Custom error handler:', error);
  }}
>
  <YourComponent />
</ErrorBoundary>
```

## 错误监控集成

### Sentry 集成（计划）

在 `frontend/components/common/ErrorBoundary.tsx` 中已预留 Sentry 集成代码：

```typescript
// 取消注释并安装 @sentry/react
import * as Sentry from '@sentry/react';

Sentry.captureException(error, {
  contexts: {
    react: {
      componentStack: errorInfo.componentStack,
    },
  },
});
```

### 后端错误上报（计划）

可以将前端错误发送到后端 API：

```typescript
fetch('/api/errors/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: error.message,
    stack: error.stack,
    componentStack: errorInfo.componentStack,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
  }),
});
```

## 国际化

错误 UI 支持中英文双语，翻译键：

```
aiSocial.error.title
aiSocial.error.description
aiSocial.error.possibleCauses
aiSocial.error.cause1
aiSocial.error.cause2
aiSocial.error.cause3
aiSocial.error.retry
aiSocial.error.reload
aiSocial.error.goHome
aiSocial.error.helpText
aiSocial.error.reportIssue
```

## 最佳实践

1. **粒度控制**：在关键模块边界设置 ErrorBoundary
2. **友好提示**：提供清晰的错误信息和恢复建议
3. **日志记录**：记录错误上下文，便于调试
4. **优雅降级**：即使出错也不影响其他模块
5. **用户引导**：提供明确的操作按钮（重试、返回等）

## 维护记录

- **2025-01-25**：添加 AI Social 专用 ErrorBoundary 和错误回退 UI
