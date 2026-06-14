/**
 * Animation configuration
 * 统一的动画时长、缓动函数和过渡配置
 */

// 动画时长（单位：秒）
export const DURATIONS = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.35,
  verySlow: 0.5,
} as const;

// 缓动函数
export const EASINGS = {
  easeInOut: [0.4, 0, 0.2, 1], // 标准缓动
  easeOut: [0, 0, 0.2, 1], // 淡出缓动
  easeIn: [0.4, 0, 1, 1], // 淡入缓动
  spring: { type: 'spring', stiffness: 300, damping: 30 }, // 弹簧效果
  springBouncy: { type: 'spring', stiffness: 400, damping: 20 }, // 弹性弹簧
} as const;

// Fade In 动画配置
export const fadeInVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: DURATIONS.fast,
      ease: EASINGS.easeIn,
    },
  },
};

// Slide In 动画配置（从上到下）
export const slideInFromTopVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: DURATIONS.fast,
      ease: EASINGS.easeIn,
    },
  },
};

// Slide In 动画配置（从左到右）
export const slideInFromLeftVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: DURATIONS.fast,
      ease: EASINGS.easeIn,
    },
  },
};

// Slide In 动画配置（从右到左）
export const slideInFromRightVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: {
      duration: DURATIONS.fast,
      ease: EASINGS.easeIn,
    },
  },
};

// Scale 动画配置（用于模态框）
export const scaleVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: DURATIONS.fast,
      ease: EASINGS.easeIn,
    },
  },
};

// Backdrop 动画配置（遮罩层）
export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: DURATIONS.fast,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: DURATIONS.fast,
    },
  },
};

// Stagger 动画配置（列表项）
export const staggerContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05, // 每个子元素延迟 0.05s
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1, // 反向退出
    },
  },
};

export const staggerItemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATIONS.normal,
      ease: EASINGS.easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: {
      duration: DURATIONS.fast,
    },
  },
};

// 检测用户是否偏好减少动画
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 条件动画配置（根据用户偏好）
export function getAnimationConfig<T>(config: T): T | false {
  return prefersReducedMotion() ? false : config;
}
