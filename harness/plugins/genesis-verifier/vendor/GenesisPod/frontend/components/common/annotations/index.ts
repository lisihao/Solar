/**
 * Annotations - 通用文本注解协作平台
 *
 * 抽自 Topic Insights 报告注解系统，沉淀为跨模块平台能力。
 *
 * 组件：
 * - AnnotatedText：将文本拆段并叠加高亮（5 色 + 线程评论）
 * - AnnotationHighlighter：低层片段高亮渲染
 * - ChangeHighlighter：变更对比的红/绿高亮
 * - ReportAnnotations：右侧栏注解面板（5 色筛选 + 线程展示 + resolve / archive）
 *
 * 适用场景：
 * - AI Writing 协作批注
 * - AI Office Slides 评论
 * - 任何「读者标注 + 创作者回复」的协作工作流
 */

export { AnnotatedText } from './AnnotatedText';
export { AnnotationHighlighter } from './AnnotationHighlighter';
export { ChangeHighlighter } from './ChangeHighlighter';
export { ReportAnnotations } from './ReportAnnotations';
