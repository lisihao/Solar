/**
 * AnimatedList 动画组件
 * 提供列表项 stagger 动画效果
 */

'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import {
  staggerContainerVariants,
  staggerItemVariants,
  getAnimationConfig,
} from '@/lib/animations/config';

interface AnimatedListProps extends Omit<HTMLMotionProps<'div'>, 'variants'> {
  /**
   * 子元素
   */
  children: React.ReactNode;
  /**
   * 自定义 className
   */
  className?: string;
  /**
   * Stagger 延迟（秒）
   */
  staggerDelay?: number;
}

interface AnimatedListItemProps extends Omit<
  HTMLMotionProps<'div'>,
  'variants'
> {
  /**
   * 子元素
   */
  children: React.ReactNode;
  /**
   * 自定义 className
   */
  className?: string;
}

/**
 * AnimatedList 容器组件
 * 管理列表项的 stagger 动画
 */
export function AnimatedList({
  children,
  className,
  staggerDelay = 0.05,
  ...props
}: AnimatedListProps) {
  const variants = getAnimationConfig({
    ...staggerContainerVariants,
    visible: {
      ...staggerContainerVariants.visible,
      transition: {
        ...staggerContainerVariants.visible.transition,
        staggerChildren: staggerDelay,
      },
    },
  });

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={variants || undefined}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * AnimatedListItem 子元素组件
 * 列表中的单个项目
 */
export function AnimatedListItem({
  children,
  className,
  ...props
}: AnimatedListItemProps) {
  const variants = getAnimationConfig(staggerItemVariants);

  return (
    <motion.div
      variants={variants || undefined}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
