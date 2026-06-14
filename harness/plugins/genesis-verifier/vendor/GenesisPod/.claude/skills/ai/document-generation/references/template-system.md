# Template System

## Template Interface

```typescript
interface DocumentTemplate {
  id: string;
  name: string;
  format: "docx" | "pdf" | "pptx" | "xlsx";
  template: string; // Base64 encoded template file
  variables: TemplateVariable[];
}

interface TemplateVariable {
  name: string;
  type: "text" | "number" | "date" | "list" | "table";
  required: boolean;
  default?: any;
}
```

## Template Processing

```typescript
async function processTemplate(
  template: DocumentTemplate,
  data: Record<string, any>,
): Promise<Buffer> {
  // Load template
  const templateBuffer = Buffer.from(template.template, "base64");

  // Replace variables
  switch (template.format) {
    case "docx":
      return processDocxTemplate(templateBuffer, data);
    case "pptx":
      return processPptxTemplate(templateBuffer, data);
    default:
      throw new Error(`Unsupported format: ${template.format}`);
  }
}
```

## AI-Powered Generation

```typescript
interface AIDocumentRequest {
  type: "report" | "presentation" | "spreadsheet";
  topic: string;
  outline?: string[];
  style?: "formal" | "casual" | "technical";
  length?: "short" | "medium" | "long";
}

async function generateWithAI(request: AIDocumentRequest): Promise<Buffer> {
  // Step 1: Generate content outline
  const outline = await this.aiService.chat({
    messages: [
      {
        role: "system",
        content: `Generate a ${request.type} outline about "${request.topic}"`,
      },
    ],
    modelType: AIModelType.CREATIVE,
    taskProfile: { creativity: "medium", outputLength: "medium" },
  });

  // Step 2: Generate detailed content
  const content = await this.aiService.chat({
    messages: [
      {
        role: "system",
        content: `Based on this outline, generate detailed content:\n${outline}`,
      },
    ],
    modelType: AIModelType.CREATIVE,
    taskProfile: { creativity: "medium", outputLength: "long" },
  });

  // Step 3: Convert to document
  return await this.generateDocument(request.type, content);
}
```

## Responsibilities

1. Implement document generators for all formats
2. Build template processing system
3. Integrate with AI for content generation
4. Handle styling and formatting
5. Optimize for large documents
6. Support custom fonts and images
