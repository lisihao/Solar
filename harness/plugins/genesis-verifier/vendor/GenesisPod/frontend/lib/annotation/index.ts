/**
 * Annotation Library
 *
 * Provides utilities for finding, highlighting, and managing text annotations
 * in DOM-rendered content.
 */

export {
  findTextRange,
  extractContext,
  calculateOffsets,
  normalizeWhitespace,
  type TextSelector,
} from './text-finder';

export {
  highlightRange,
  clearHighlights,
  scrollToAnnotation,
  updateHighlightedAnnotation,
  getAnnotationIds,
  type AnnotationData,
} from './dom-highlighter';

// New React Controlled Highlighting approach
export {
  normalizeWhitespace as normalizeAnnotationWhitespace,
  findAnnotationMatches,
  splitTextIntoSegments,
  processTextNode,
  hasAnnotationsInText,
  getMatchingAnnotationIds,
  type Annotation,
  type AnnotatedSegment,
  type AnnotationMatch,
  type AnnotationColor,
} from './annotation-preprocessor';
