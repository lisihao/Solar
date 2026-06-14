/**
 * SlideIn 动画组件
 * 提供滑入滑出动画效果
 */

'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import {
  slideInFromTopVariants,
  slideInFromLeftVariants,
  slideInFromRightVariants,
  getAnimationConfig,
} from '@/lib/animations/config';

type Direction = 'top' | 'left' | 'right';

interface SlideInProps extends Omit<HTMLMotionProps<'div'>, 'variants'> {
  /**
   * 滑入方向
   */
  direction?: Direction;
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

const variantsByDirection = {
  top: slideInFromTopVariants,
  left: slideInFromLeftVariants,
  right: slideInFromRightVariants,
} as const;

/**
 * SlideIn 组件
 * 为子元素添加滑入滑出动画
 */
export function SlideIn({
  children,
  direction = 'top',
  delay = 0,
  duration,
  className,
  ...props
}: SlideInProps) {
  const baseVariants = variantsByDirection[direction];

  const variants = getAnimationConfig({
    ...baseVariants,
    visible: {
      ...baseVariants.visible,
      transition: {
        ...baseVariants.visible.transition,
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
