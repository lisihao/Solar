---
name: Document Processor
description: |
  Design and implement document generation, export, templates, and format conversion.
  Trigger keywords: document, export, pdf, docx, template, office
  Not for: AI content generation (-> ai-app-developer)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [documents, export, templates, pdf, office]
boundaries:
  includes:
    - Document generation workflows
    - Multi-format export (PDF, DOCX, HTML)
    - Template management
    - Markdown processing
  excludes:
    - AI content generation logic
  handoff:
    - skill: ai-app-developer
      when: AI generation logic needed
---

# Document Processor Expert

> Detailed docs: `references/`

## Architecture

```
AI Office Frontend (Editor | Template | Export)
                    ↓
Backend Services (Generation | Template | Export)
                    ↓
Export Formats (PDF | DOCX | MD | HTML | PPTX)
```

## Key Files

```
frontend/components/ai-office/
├── DocumentEditor.tsx         # Rich text editor
├── TemplateGallery.tsx        # Template selection
└── ExportDialog.tsx           # Export options

backend/src/modules/ai/ai-office/
├── document-generation.service.ts
├── document-export.service.ts
└── template.service.ts
```

## Document Types

```typescript
enum DocumentType {
  REPORT = "report",
  ARTICLE = "article",
  PROPOSAL = "proposal",
  ANALYSIS = "analysis",
  PRESENTATION = "presentation",
}

interface Document {
  id: string;
  title: string;
  type: DocumentType;
  content: string; // Markdown
  sections?: DocumentSection[];
  templateId?: string;
}
```

## Export Formats

```typescript
enum ExportFormat {
  PDF = 'pdf',
  DOCX = 'docx',
  HTML = 'html',
  MARKDOWN = 'md',
  PPTX = 'pptx',
}

async exportDocument(doc: Document, format: ExportFormat): Promise<Buffer> {
  switch (format) {
    case ExportFormat.PDF: return this.exportToPdf(doc);
    case ExportFormat.DOCX: return this.exportToDocx(doc);
    case ExportFormat.HTML: return this.exportToHtml(doc);
    // ...
  }
}
```

## PDF Export (Puppeteer)

```typescript
async exportToPdf(document: Document, options: PdfOptions): Promise<Buffer> {
  const html = await this.markdownToHtml(document.content);
  const styledHtml = this.applyPdfTemplate(html, { title: document.title });

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(styledHtml);

  const pdf = await page.pdf({
    format: options.pageSize || 'A4',
    margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
    printBackground: true,
  });

  await browser.close();
  return Buffer.from(pdf);
}
```

## Template System

```typescript
interface DocumentTemplate {
  id: string;
  name: string;
  type: DocumentType;
  structure: TemplateSection[];
  variables: TemplateVariable[];
  defaultStyles: StyleConfig;
}

interface TemplateVariable {
  key: string;
  label: string;
  type: "text" | "date" | "select" | "multiline";
  required: boolean;
}
```

## Style Configuration

```typescript
interface StyleConfig {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  headingColor: string;
  pageSize: "A4" | "Letter";
  margins: { top: number; bottom: number; left: number; right: number };
}
```

## Related Docs

- [AI Document Generation](references/ai-generation.md)
- [Export Formats](references/export-formats.md)
- [Template System](references/templates.md)
