# Animation Components

AI Social 模块动画系统，基于 Framer Motion。

## 特性

- 淡入淡出动画
- 滑入滑出动画
- 列表项 stagger 动画
- 模态框缩放动画
- 自动检测 `prefers-reduced-motion`
- 统一的动画配置和缓动函数

## 组件

### FadeIn

淡入淡出动画组件。

```tsx
import { FadeIn } from '@/components/ui/animations';

<FadeIn delay={0.1}>
  <div>内容</div>
</FadeIn>;
```

**Props:**

- `delay?: number` - 延迟时间（秒）
- `duration?: number` - 动画时长（秒）
- `className?: string` - 自定义样式

### SlideIn

滑入滑出动画组件。

```tsx
import { SlideIn } from '@/components/ui/animations';

<SlideIn direction="left" delay={0.1}>
  <div>内容</div>
</SlideIn>;
```

**Props:**

- `direction?: 'top' | 'left' | 'right'` - 滑入方向
- `delay?: number` - 延迟时间（秒）
- `duration?: number` - 动画时长（秒）
- `className?: string` - 自定义样式

### AnimatedList & AnimatedListItem

列表项 stagger 动画。

```tsx
import { AnimatedList, AnimatedListItem } from '@/components/ui/animations';

<AnimatedList staggerDelay={0.05}>
  {items.map((item) => (
    <AnimatedListItem key={item.id}>
      <div>{item.content}</div>
    </AnimatedListItem>
  ))}
</AnimatedList>;
```

**AnimatedList Props:**

- `staggerDelay?: number` - 每个子元素延迟时间（秒），默认 0.05
- `className?: string` - 自定义样式

**AnimatedListItem Props:**

- `className?: string` - 自定义样式

## 动画配置

### 预定义 Variants

```tsx
import {
  fadeInVariants,
  slideInFromTopVariants,
  slideInFromLeftVariants,
  slideInFromRightVariants,
  scaleVariants,
  backdropVariants,
  staggerContainerVariants,
  staggerItemVariants,
} from '@/components/ui/animations';
```

### 模态框示例

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import {
  scaleVariants,
  backdropVariants,
  getAnimationConfig,
} from '@/components/ui/animations';

<AnimatePresence>
  {isOpen && (
    <motion.div
      className="fixed inset-0 bg-black/50"
      variants={getAnimationConfig(backdropVariants) || undefined}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="modal"
        variants={getAnimationConfig(scaleVariants) || undefined}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {/* 模态框内容 */}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>;
```

## 性能优化

1. **will-change**: 自动应用到动画元素
2. **prefers-reduced-motion**: 自动检测并禁用动画
3. **AnimatePresence**: 使用 `mode="wait"` 避免同时渲染多个组件

## 配置

所有动画配置位于 `@/lib/animations/config.ts`:

```ts
export const DURATIONS = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.35,
  verySlow: 0.5,
};

export const EASINGS = {
  easeInOut: [0.4, 0, 0.2, 1],
  easeOut: [0, 0, 0.2, 1],
  easeIn: [0.4, 0, 1, 1],
  spring: { type: 'spring', stiffness: 300, damping: 30 },
  springBouncy: { type: 'spring', stiffness: 400, damping: 20 },
};
```

## 应用位置

### AI Social 模块

1. **ConnectionsTab** - 连接卡片列表 stagger 动画 + 登录模态框
2. **ContentsTab** - 表格行淡入动画 + 创建/发布模态框
3. **AI Social Page** - Tab 切换滑动动画

## 无障碍

- 自动检测 `prefers-reduced-motion: reduce`
- 检测到时禁用所有动画
- 保持完整功能，只移除视觉效果
