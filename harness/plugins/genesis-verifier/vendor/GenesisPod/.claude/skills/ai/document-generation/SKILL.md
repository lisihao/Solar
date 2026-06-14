---
name: Document Generation
description: |
  Generate DOCX, PDF, PPTX, XLSX documents for AI Office module.
  Trigger keywords: document, docx, pdf, pptx, xlsx, export, word, powerpoint
  Not for: Document processing/export (-> document-processor), Frontend (-> frontend-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [documents, docx, pdf, pptx, xlsx, ai-office]
boundaries:
  includes:
    - Document generation (DOCX, PDF, PPTX, XLSX)
    - Template processing
    - AI-powered content generation
  excludes:
    - Document export from markdown
    - Frontend document preview
  handoff:
    - skill: document-processor
      when: Markdown to document export
    - skill: frontend-expert
      when: Document preview UI
---

# Document Generation Expert

> Detailed docs: `references/`

## Supported Formats

| Format | Library          | Use Case                |
| ------ | ---------------- | ----------------------- |
| DOCX   | docx             | Word documents, reports |
| PDF    | pdf-lib, pdfmake | Export, printing        |
| PPTX   | pptxgenjs        | Presentations           |
| XLSX   | exceljs          | Spreadsheets, data      |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI Office Module                                │
├─────────────────────────────────────────────────┤
│  Document Generator Service                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ DOCX Gen │ │ PDF Gen  │ │ PPTX Gen │        │
│  └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────┤
│  Template Engine                                 │
│  ┌──────────────────────────────────────────┐  │
│  │ Variable Substitution | Loops | Conditions│  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Key Files

```
backend/src/modules/ai/ai-office/
├── ai-office.service.ts
├── generators/
│   ├── docx.generator.ts
│   ├── pdf.generator.ts
│   ├── pptx.generator.ts
│   └── xlsx.generator.ts
└── templates/
    └── template.service.ts
```

## Quick Reference

```typescript
// DOCX
const doc = new Document({ sections: [{ children: paragraphs }] });
return Packer.toBuffer(doc);

// PDF
const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([595, 842]); // A4
return pdfDoc.save();

// PPTX
const pptx = new PptxGenJS();
pptx.addSlide().addText(title, { x: 1, y: 2 });
return pptx.write({ outputType: "nodebuffer" });

// XLSX
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet(name).addRows(data);
return workbook.xlsx.writeBuffer();
```

## Related Docs

- [DOCX Generation](references/docx-generation.md)
- [PDF Generation](references/pdf-generation.md)
- [Template System](references/template-system.md)
