# AI Document Generation

## Document Generation Service

```typescript
@Injectable()
export class DocumentGenerationService {
  async generateDocument(dto: GenerateDocumentDto): Promise<Document> {
    const { type, topic, outline, sources, style, language } = dto;

    const prompt = this.buildPrompt({
      type,
      topic,
      outline,
      sources,
      style,
      language,
    });

    const content = await this.aiService.generate({
      prompt,
      temperature: 0.7,
      maxTokens: 4000,
    });

    const sections = this.parseIntoSections(content);

    return {
      id: generateId(),
      title: this.extractTitle(content) || topic,
      type,
      content,
      sections,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private buildPrompt(options: GenerationOptions): string {
    const styleGuide = this.getStyleGuide(options.style);
    const formatGuide = this.getFormatGuide(options.type);

    return `
Generate a ${options.type} about: ${options.topic}

${options.outline ? `Follow this outline:\n${options.outline}` : ""}

${options.sources?.length ? `Reference these sources:\n${options.sources.map((s) => `- ${s.title}: ${s.summary}`).join("\n")}` : ""}

Style: ${styleGuide}
Format: ${formatGuide}
Language: ${options.language || "English"}

Requirements:
- Use clear, professional language
- Include relevant data and examples
- Structure with clear headings (use Markdown)
- Provide actionable insights where appropriate
`;
  }

  private parseIntoSections(content: string): DocumentSection[] {
    const lines = content.split("\n");
    const sections: DocumentSection[] = [];
    let currentSection: DocumentSection | null = null;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2];

        if (currentSection) {
          sections.push(currentSection);
        }

        currentSection = {
          id: generateId(),
          title,
          content: "",
          level,
          order: sections.length,
        };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }
}
```

## Template-Based Generation

```typescript
async generateFromTemplate(
  templateId: string,
  variables: Record<string, any>
): Promise<Document> {
  const template = await this.getTemplate(templateId);

  // Validate required variables
  for (const v of template.variables) {
    if (v.required && !variables[v.key]) {
      throw new BadRequestException(`Missing required variable: ${v.key}`);
    }
  }

  // Generate content for each section
  const sections = await Promise.all(
    template.structure.map(async (section) => {
      const prompt = this.buildSectionPrompt(section, variables);
      const content = await this.aiService.generate({ prompt });
      return { ...section, content };
    })
  );

  return {
    id: generateId(),
    title: this.interpolate(template.name, variables),
    type: template.type,
    templateId,
    templateVariables: variables,
    sections,
    content: sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```
