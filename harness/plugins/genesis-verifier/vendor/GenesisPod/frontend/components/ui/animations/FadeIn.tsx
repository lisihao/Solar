/**
 * FadeIn 动画组件
 * 提供淡入淡出动画效果
 */

'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { fadeInVariants, getAnimationConfig } from '@/lib/animations/config';

interface FadeInProps extends Omit<HTMLMotionProps<'div'>, 'variants'> {
  /**
   * 延迟时间（秒）
   */
  delay?: number;
  /**
   * 动画时长（秒）
   */
  duration?: number;
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
 * FadeIn 组件
 * 为子元素添加淡入淡出动画
 */
export function FadeIn({
  children,
  delay = 0,
  duration,
  className,
  ...props
}: FadeInProps) {
  const variants = getAnimationConfig({
    ...fadeInVariants,
    visible: {
      ...fadeInVariants.visible,
      transition: {
        ...fadeInVariants.visible.transition,
        delay,
        ...(duration && { duration }),
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
