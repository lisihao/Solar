/**
 * Animation Components
 * 统一导出所有动画组件
 */

export { FadeIn } from './FadeIn';
export { SlideIn } from './SlideIn';
export { AnimatedList, AnimatedListItem } from './AnimatedList';

// 导出动画配置
export {
  DURATIONS,
  EASINGS,
  fadeInVariants,
  slideInFromTopVariants,
  slideInFromLeftVariants,
  slideInFromRightVariants,
  scaleVariants,
  backdropVariants,
  staggerContainerVariants,
  staggerItemVariants,
  prefersReducedMotion,
  getAnimationConfig,
} from '@/lib/animations/config';
