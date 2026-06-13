/**
 * 统一导出系统 - 模块定义
 */

import { Module } from "@nestjs/common";
import { ExportFormat } from "@prisma/client";

// Controllers
import { ExportController } from "./controllers/export.controller";
import { TemplateController } from "./controllers/template.controller";

// Services
import { ExportOrchestratorService } from "./services/export-orchestrator.service";
import { ContentTransformerService } from "./services/content-transformer.service";
import { TemplateManagerService } from "./services/template-manager.service";
import { MissionTransformerService } from "./services/mission-transformer.service";
import { WysiwygRenderService } from "./services/wysiwyg-render.service";

// Renderers
import { RENDERER_TOKEN } from "./renderers/renderer.interface";
import { PdfRenderer } from "./renderers/pdf.renderer";
import { DocxRenderer } from "./renderers/docx.renderer";
import { PptxRenderer } from "./renderers/pptx.renderer";
// PptxSlidesRenderer 已删除，导出统一使用 HTML 截图路径
import { XlsxRenderer } from "./renderers/xlsx.renderer";
import { MarkdownRenderer } from "./renderers/markdown.renderer";
import { HtmlRenderer } from "./renderers/html.renderer";

// Common
import { PrismaModule } from "../../common/prisma/prisma.module";
import { BrowserModule } from "../../common/browser/browser.module";

@Module({
  imports: [PrismaModule, BrowserModule],
  controllers: [ExportController, TemplateController],
  providers: [
    // Services
    ExportOrchestratorService,
    ContentTransformerService,
    TemplateManagerService,
    MissionTransformerService,
    WysiwygRenderService,

    // Renderers
    PdfRenderer,
    DocxRenderer,
    PptxRenderer,
    XlsxRenderer,
    MarkdownRenderer,
    HtmlRenderer,

    // Renderer Registry - 注册所有渲染器
    {
      provide: RENDERER_TOKEN,
      useFactory: (
        pdfRenderer: PdfRenderer,
        docxRenderer: DocxRenderer,
        pptxRenderer: PptxRenderer,
        xlsxRenderer: XlsxRenderer,
        markdownRenderer: MarkdownRenderer,
        htmlRenderer: HtmlRenderer,
      ) => {
        const renderers = new Map();
        renderers.set(ExportFormat.PDF, pdfRenderer);
        renderers.set(ExportFormat.DOCX, docxRenderer);
        renderers.set(ExportFormat.PPTX, pptxRenderer);
        renderers.set(ExportFormat.XLSX, xlsxRenderer);
        renderers.set(ExportFormat.MARKDOWN, markdownRenderer);
        renderers.set(ExportFormat.HTML, htmlRenderer);
        return renderers;
      },
      inject: [
        PdfRenderer,
        DocxRenderer,
        PptxRenderer,
        XlsxRenderer,
        MarkdownRenderer,
        HtmlRenderer,
      ],
    },
  ],
  exports: [
    ExportOrchestratorService,
    ContentTransformerService,
    TemplateManagerService,
    MissionTransformerService,
    WysiwygRenderService,
  ],
})
export class ExportModule {}
