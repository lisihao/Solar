/**
 * Slides Rendering Exports
 */

export {
  SlidesExportService,
  type PPTXExportResult,
  type PDFExportResult,
  type PNGExportResult,
} from "./slides-export.service";

// v4.0: 参数化渲染器
export {
  ParameterizedRendererService,
  type RenderContext,
  type RenderResult,
  type Position,
} from "./parameterized-renderer.service";
