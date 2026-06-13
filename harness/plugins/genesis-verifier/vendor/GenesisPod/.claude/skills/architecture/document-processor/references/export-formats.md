# Export Formats

## Export Service

```typescript
@Injectable()
export class DocumentExportService {
  async exportDocument(
    document: Document,
    format: ExportFormat,
    options: ExportOptions = {},
  ): Promise<Buffer> {
    switch (format) {
      case ExportFormat.PDF:
        return this.exportToPdf(document, options);
      case ExportFormat.DOCX:
        return this.exportToDocx(document, options);
      case ExportFormat.HTML:
        return this.exportToHtml(document, options);
      case ExportFormat.MARKDOWN:
        return this.exportToMarkdown(document, options);
      case ExportFormat.PPTX:
        return this.exportToPptx(document, options);
      default:
        throw new BadRequestException(`Unsupported format: ${format}`);
    }
  }
}
```

## PDF Export (Puppeteer)

```typescript
async exportToPdf(document: Document, options: PdfOptions): Promise<Buffer> {
  const html = await this.markdownToHtml(document.content);

  const styledHtml = this.applyPdfTemplate(html, {
    title: document.title,
    author: document.author,
    date: document.createdAt,
    ...options,
  });

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent(styledHtml);

  const pdf = await page.pdf({
    format: options.pageSize || "A4",
    margin: options.margin || {
      top: "1cm",
      bottom: "1cm",
      left: "1cm",
      right: "1cm",
    },
    printBackground: true,
    displayHeaderFooter: options.headerFooter,
    headerTemplate: options.header,
    footerTemplate: options.footer,
  });

  await browser.close();
  return Buffer.from(pdf);
}
```

## DOCX Export (docx library)

```typescript
async exportToDocx(document: Document, options: DocxOptions): Promise<Buffer> {
  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children: this.buildDocxContent(document),
      },
    ],
  });

  return Packer.toBuffer(doc);
}

private buildDocxContent(document: Document): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Title
  paragraphs.push(
    new Paragraph({
      text: document.title,
      heading: HeadingLevel.TITLE,
    }),
  );

  // Sections
  for (const section of document.sections || []) {
    paragraphs.push(
      new Paragraph({
        text: section.title,
        heading: this.getHeadingLevel(section.level),
      }),
    );

    const contentParagraphs = this.parseMarkdownToParagraphs(section.content);
    paragraphs.push(...contentParagraphs);
  }

  return paragraphs;
}
```

## Markdown Processing

```typescript
async markdownToHtml(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)           // GitHub Flavored Markdown
    .use(remarkMath)          // Math equations
    .use(remarkRehype)
    .use(rehypeHighlight)     // Code highlighting
    .use(rehypeKatex)         // Math rendering
    .use(rehypeStringify)
    .process(markdown);

  return String(result);
}

function generateToc(document: Document): TocEntry[] {
  return (document.sections || []).map((section) => ({
    id: section.id,
    title: section.title,
    level: section.level,
    children: section.children?.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
    })),
  }));
}
```

## Style Presets

```typescript
const professionalStyle: StyleConfig = {
  fontFamily: "Georgia, serif",
  fontSize: 11,
  lineHeight: 1.6,
  headingFont: "Helvetica, sans-serif",
  textColor: "#333333",
  headingColor: "#1a1a1a",
  linkColor: "#0066cc",
  backgroundColor: "#ffffff",
  paragraphSpacing: 12,
  sectionSpacing: 24,
  pageSize: "A4",
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
};

const modernStyle: StyleConfig = {
  fontFamily: "Inter, sans-serif",
  fontSize: 10,
  lineHeight: 1.5,
  headingFont: "Inter, sans-serif",
  textColor: "#374151",
  headingColor: "#111827",
  linkColor: "#2563eb",
  backgroundColor: "#ffffff",
  paragraphSpacing: 10,
  sectionSpacing: 20,
  pageSize: "A4",
  margins: { top: 60, bottom: 60, left: 60, right: 60 },
};
```
