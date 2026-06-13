# PDF Generation

## Using pdf-lib

```typescript
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

async function generatePdf(content: PdfContent): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Draw title
  page.drawText(content.title, {
    x: 50,
    y: 800,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  });

  // Draw paragraphs
  let y = 750;
  for (const paragraph of content.paragraphs) {
    page.drawText(paragraph, {
      x: 50,
      y,
      size: 12,
      font,
      maxWidth: 495,
    });
    y -= 20;
  }

  return await pdfDoc.save();
}
```

## Adding Images

```typescript
async function addImageToPdf(pdfDoc: PDFDocument, imageUrl: string) {
  const imageBytes = await fetch(imageUrl).then((res) => res.arrayBuffer());

  // Detect image type and embed
  let image;
  if (imageUrl.endsWith(".png")) {
    image = await pdfDoc.embedPng(imageBytes);
  } else {
    image = await pdfDoc.embedJpg(imageBytes);
  }

  const page = pdfDoc.getPages()[0];
  page.drawImage(image, {
    x: 50,
    y: 400,
    width: 200,
    height: 150,
  });
}
```

## Multi-page Documents

```typescript
async function generateMultiPagePdf(sections: Section[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const section of sections) {
    const page = pdfDoc.addPage([595, 842]);
    let y = 800;

    // Section title
    page.drawText(section.title, {
      x: 50,
      y,
      size: 18,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 40;

    // Section content
    const lines = this.wrapText(section.content, 80);
    for (const line of lines) {
      if (y < 50) {
        // Add new page if needed
        const newPage = pdfDoc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 16;
    }
  }

  return pdfDoc.save();
}
```
