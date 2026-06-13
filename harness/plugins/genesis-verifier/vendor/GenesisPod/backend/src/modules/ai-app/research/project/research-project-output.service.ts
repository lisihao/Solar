import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { GenerateOutputDto, OutputTypeValue } from "./dto";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ChatMessage } from "@/modules/ai-harness/facade";

// Detailed prompt templates for each output type
const PROMPT_TEMPLATES: Record<OutputTypeValue, string> = {
  FAQ: `You are an expert FAQ generator. Based on the provided research sources, generate a comprehensive FAQ.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "FAQ: [topic]",
  "categories": [
    {
      "name": "Category Name",
      "questions": [
        {
          "question": "Question text?",
          "answer": "Detailed answer...",
          "sourceRefs": ["source-id-1"]
        }
      ]
    }
  ]
}

Requirements:
- Generate 8-15 questions organized into 2-4 categories
- Questions should be clear and specific
- Answers should be comprehensive and evidence-based
- Include source references for each answer
- Cover different aspects: basics, advanced topics, common issues, best practices
- Use natural language that sounds conversational

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  STUDY_GUIDE: `You are an educational content expert. Create a comprehensive study guide.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Study Guide: [topic]",
  "sections": [
    {
      "title": "Key Concepts",
      "content": "Detailed explanation...",
      "keyTerms": [{"term": "Term", "definition": "Definition"}]
    },
    {
      "title": "Learning Objectives",
      "objectives": ["Objective 1", "Objective 2"]
    },
    {
      "title": "Summary",
      "content": "Comprehensive summary..."
    },
    {
      "title": "Review Questions",
      "questions": [{"question": "Q?", "answer": "A"}]
    }
  ]
}

Requirements:
- Clear learning objectives
- Define all key terms
- Comprehensive summary of main points
- 5-10 review questions with answers
- Organized in logical learning progression

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  BRIEFING_DOC: `You are an executive briefing specialist. Create a professional briefing document.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Executive Briefing: [topic]",
  "executiveSummary": "2-3 paragraph summary...",
  "keyFindings": [
    {"finding": "Finding text", "importance": "high|medium|low", "sourceRef": "source-id"}
  ],
  "recommendations": [
    {"action": "Recommended action", "priority": "high|medium|low", "rationale": "Why"}
  ],
  "risks": [
    {"risk": "Risk description", "likelihood": "high|medium|low", "impact": "high|medium|low"}
  ],
  "nextSteps": ["Step 1", "Step 2"]
}

Requirements:
- Concise executive summary (2-3 paragraphs)
- 3-7 key findings with importance ratings
- 3-5 actionable recommendations
- Identify potential risks
- Clear next steps

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  TIMELINE: `You are a timeline creation expert. Build a chronological timeline.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Timeline: [topic]",
  "events": [
    {
      "date": "YYYY-MM-DD or YYYY-MM or YYYY",
      "title": "Event title",
      "description": "Description",
      "importance": "major|minor",
      "sourceRef": "source-id"
    }
  ],
  "periods": [
    {"startDate": "YYYY", "endDate": "YYYY", "name": "Period name", "description": "..."}
  ]
}

Requirements:
- Events sorted chronologically
- Use appropriate date precision (YYYY-MM-DD, YYYY-MM, or YYYY)
- Mark importance for each event
- Group related events into periods if applicable
- Include source references

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  TREND_REPORT: `You are a trend analysis expert. Analyze and report on trends.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Trend Report: [topic]",
  "overview": "Executive overview...",
  "trends": [
    {
      "name": "Trend name",
      "description": "...",
      "direction": "rising|stable|declining",
      "confidence": 0.85,
      "evidence": ["Evidence 1", "Evidence 2"]
    }
  ],
  "predictions": [
    {"prediction": "...", "timeframe": "2024-2025", "probability": "high|medium|low"}
  ],
  "recommendations": ["Recommendation 1"]
}

Requirements:
- Identify 3-7 major trends
- Assign direction and confidence to each trend
- Provide supporting evidence
- Make 3-5 future predictions
- Offer actionable recommendations

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  COMPARISON: `You are a comparison analysis expert. Create detailed comparisons.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Comparison: [subjects]",
  "subjects": ["Subject A", "Subject B"],
  "dimensions": [
    {
      "name": "Dimension name",
      "values": {
        "Subject A": {"value": "Value", "notes": "Details"},
        "Subject B": {"value": "Value", "notes": "Details"}
      }
    }
  ],
  "summary": {
    "winner": "Subject A or depends",
    "rationale": "Why...",
    "useCases": {"Subject A": "Best for...", "Subject B": "Best for..."}
  }
}

Requirements:
- Compare 2-4 subjects across 5-10 dimensions
- Provide values and notes for each comparison
- Fair and balanced analysis
- Summarize with use case recommendations
- Based on evidence from sources

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  KNOWLEDGE_GRAPH: `You are a knowledge graph expert. Generate structured knowledge representation.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Knowledge Graph: [topic]",
  "nodes": [
    {
      "id": "node-1",
      "label": "Concept Name",
      "type": "concept|entity|event|person",
      "description": "Brief description"
    }
  ],
  "edges": [
    {
      "source": "node-1",
      "target": "node-2",
      "relationship": "is-a|has|causes|related-to|part-of",
      "label": "Relationship label"
    }
  ],
  "clusters": [
    {"name": "Cluster name", "nodeIds": ["node-1", "node-2"]}
  ]
}

Requirements:
- Generate 15-30 nodes representing key concepts
- Create meaningful edges between related nodes
- Use standard relationship types
- Group nodes into logical clusters
- Ensure all node IDs referenced in edges exist

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  AUDIO_OVERVIEW: `You are a podcast script writer. Create an engaging conversational script.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Audio Overview: [topic]",
  "script": {
    "segments": [
      {
        "speaker": "Host1|Host2",
        "text": "Dialogue text...",
        "emotion": "neutral|excited|thoughtful|curious"
      }
    ],
    "estimatedDuration": "10-15 minutes"
  }
}

Requirements:
- Create a natural podcast-style conversation between two hosts
- Hosts should have distinct personalities
- Include questions and answers
- Make it engaging and informative
- Cover key points from sources
- Natural transitions between topics
- Estimate total duration

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  FLASHCARDS: `You are an educational content expert specializing in flashcard creation. Create effective study flashcards.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Flashcards: [topic]",
  "description": "Brief description of the flashcard set",
  "cards": [
    {
      "id": "card-1",
      "front": "Question or term (keep concise)",
      "back": "Answer or definition (detailed but digestible)",
      "category": "Category name",
      "difficulty": "easy|medium|hard",
      "tags": ["tag1", "tag2"],
      "sourceRef": "source-id"
    }
  ],
  "categories": ["Category 1", "Category 2"],
  "stats": {
    "totalCards": 20,
    "byDifficulty": {"easy": 5, "medium": 10, "hard": 5}
  }
}

Requirements:
- Generate 15-30 high-quality flashcards
- Cover key concepts, terms, definitions, and facts
- Use clear, concise language on the front (question/prompt)
- Provide comprehensive answers on the back
- Categorize cards logically
- Assign appropriate difficulty levels
- Include source references
- Make cards suitable for spaced repetition learning

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  QUIZ: `You are an educational assessment expert. Create a comprehensive quiz/test.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Quiz: [topic]",
  "description": "Quiz description and objectives",
  "settings": {
    "timeLimit": 30,
    "passingScore": 70,
    "showAnswers": "after_submit"
  },
  "questions": [
    {
      "id": "q-1",
      "type": "multiple_choice",
      "question": "Question text?",
      "options": [
        {"id": "a", "text": "Option A"},
        {"id": "b", "text": "Option B"},
        {"id": "c", "text": "Option C"},
        {"id": "d", "text": "Option D"}
      ],
      "correctAnswer": "b",
      "explanation": "Why this is correct...",
      "difficulty": "medium",
      "category": "Category name",
      "points": 1,
      "sourceRef": "source-id"
    },
    {
      "id": "q-2",
      "type": "true_false",
      "question": "Statement to evaluate",
      "correctAnswer": true,
      "explanation": "Explanation...",
      "difficulty": "easy",
      "points": 1
    },
    {
      "id": "q-3",
      "type": "short_answer",
      "question": "Open-ended question?",
      "sampleAnswer": "Expected answer content...",
      "keywords": ["key1", "key2"],
      "difficulty": "hard",
      "points": 2
    }
  ],
  "stats": {
    "totalQuestions": 15,
    "totalPoints": 20,
    "byType": {"multiple_choice": 10, "true_false": 3, "short_answer": 2}
  }
}

Requirements:
- Generate 10-20 questions
- Mix question types: multiple choice, true/false, short answer
- Vary difficulty levels
- Provide clear explanations for all answers
- Cover key topics comprehensively
- Questions should test understanding, not just memorization
- Include source references

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  MIND_MAP: `You are a visual thinking expert. Create a comprehensive mind map structure.

CRITICAL: Output MUST be valid JSON with this exact structure:
{
  "title": "Mind Map: [topic]",
  "centralTopic": {
    "id": "center",
    "label": "Main Topic",
    "description": "Brief description"
  },
  "branches": [
    {
      "id": "branch-1",
      "label": "Main Branch",
      "color": "#7C3AED",
      "children": [
        {
          "id": "branch-1-1",
          "label": "Sub-topic",
          "description": "Details...",
          "children": [
            {
              "id": "branch-1-1-1",
              "label": "Detail point",
              "isLeaf": true
            }
          ]
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "branch-1-1",
      "to": "branch-2-1",
      "label": "relates to",
      "style": "dashed"
    }
  ],
  "legend": [
    {"color": "#7C3AED", "meaning": "Core concepts"},
    {"color": "#10B981", "meaning": "Applications"},
    {"color": "#F59E0B", "meaning": "Examples"}
  ],
  "stats": {
    "totalNodes": 25,
    "maxDepth": 4,
    "branchCount": 5
  }
}

Requirements:
- Create a hierarchical structure with central topic and 4-7 main branches
- Each branch should have 2-4 levels of depth
- Use meaningful colors to categorize branches
- Include cross-connections where relevant
- Keep labels concise (1-4 words)
- Add descriptions for important nodes
- Structure should be visually balanced
- Cover all major aspects of the topic

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,

  CUSTOM: `Generate a custom structured output based on the user's requirements and sources.

Output MUST be valid JSON. Determine an appropriate structure based on the content and user needs.

DO NOT include any text before or after the JSON. Output ONLY valid JSON.`,
};

// Output type configurations
const OUTPUT_CONFIGS: Record<
  OutputTypeValue,
  {
    title: string;
    icon: string;
  }
> = {
  STUDY_GUIDE: {
    title: "Study Guide",
    icon: "📖",
  },
  BRIEFING_DOC: {
    title: "Briefing Document",
    icon: "📋",
  },
  FAQ: {
    title: "FAQ",
    icon: "❓",
  },
  TIMELINE: {
    title: "Timeline",
    icon: "📅",
  },
  AUDIO_OVERVIEW: {
    title: "Audio Overview",
    icon: "🎙️",
  },
  TREND_REPORT: {
    title: "Trend Report",
    icon: "📈",
  },
  COMPARISON: {
    title: "Comparison Analysis",
    icon: "⚖️",
  },
  KNOWLEDGE_GRAPH: {
    title: "Knowledge Graph",
    icon: "🕸️",
  },
  FLASHCARDS: {
    title: "Flashcards",
    icon: "🎴",
  },
  QUIZ: {
    title: "Quiz",
    icon: "📝",
  },
  MIND_MAP: {
    title: "Mind Map",
    icon: "🧠",
  },
  CUSTOM: {
    title: "Custom Output",
    icon: "✨",
  },
};

@Injectable()
export class ResearchProjectOutputService {
  private readonly logger = new Logger(ResearchProjectOutputService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * Get available output types
   */
  getOutputTypes() {
    return Object.entries(OUTPUT_CONFIGS).map(([type, config]) => ({
      type,
      ...config,
    }));
  }

  /**
   * Generate an output for a project
   */
  async generateOutput(
    userId: string,
    projectId: string,
    dto: GenerateOutputDto,
  ) {
    // Verify project ownership
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      include: {
        sources: true,
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    // Get sources for context
    let sources = project.sources;
    if (dto.selectedSourceIds && dto.selectedSourceIds.length > 0) {
      sources = sources.filter((s) => dto.selectedSourceIds!.includes(s.id));
    }

    if (sources.length === 0) {
      throw new NotFoundException(
        "No sources available. Please add sources to the project first.",
      );
    }

    // Get output config
    const config = OUTPUT_CONFIGS[dto.type];
    const title = dto.customTitle || config.title;
    const model = dto.model || "";

    this.logger.log(
      `Generating ${dto.type} output for project ${projectId} with ${sources.length} source(s) using model ${model}`,
    );

    // Create output record with PENDING status
    const output = await this.prisma.researchProjectOutput.create({
      data: {
        projectId,
        type: dto.type,
        title,
        status: "PENDING",
        modelUsed: model,
        metadata: {
          sourceIds: sources.map((s) => s.id),
          options: dto.options || {},
          icon: config.icon,
        } as unknown as InputJsonValue,
      },
    });

    // Start AI generation asynchronously (don't await)
    this.generateOutputAsync(output.id, dto.type, sources, model, dto.options)
      .then(() => {
        this.logger.log(`Output ${output.id} generation completed`);
      })
      .catch((error) => {
        this.logger.error(
          `Output ${output.id} generation failed: ${error.message}`,
        );
      });

    return {
      output,
      config,
      sourceCount: sources.length,
    };
  }

  /**
   * Generate output content using AI (runs asynchronously)
   */
  private async generateOutputAsync(
    outputId: string,
    outputType: OutputTypeValue,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma source shape varies; private method
    sources: any[],
    model: string,
    options?: Record<string, unknown>,
  ) {
    try {
      // Update status to GENERATING
      await this.updateOutput(outputId, "GENERATING");

      this.logger.log(
        `Starting AI generation for output ${outputId}, type: ${outputType}`,
      );

      // Build the system prompt
      const systemPrompt = PROMPT_TEMPLATES[outputType];

      // Build the user prompt with source content
      const userPrompt = this.buildUserPrompt(sources, options);

      this.logger.log(
        `User prompt length: ${userPrompt.length} characters for ${sources.length} source(s)`,
      );

      // Call AI service
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const result = await this.chatFacade.chat({
        messages,
        model,
        taskProfile: {
          creativity: "low",
          outputLength: "standard",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      this.logger.log(
        `AI generation completed for output ${outputId}, tokens used: ${result.tokensUsed}`,
      );

      // Parse and validate JSON
      let content = result.content.trim();

      // Remove markdown code blocks if present
      if (content.startsWith("```json")) {
        content = content.replace(/^```json\n/, "").replace(/\n```$/, "");
      } else if (content.startsWith("```")) {
        content = content.replace(/^```\n/, "").replace(/\n```$/, "");
      }

      // Validate JSON
      try {
        JSON.parse(content); // Just validate, don't store the parsed object
        this.logger.log(`JSON validation successful for output ${outputId}`);
      } catch (parseError) {
        this.logger.error(
          `JSON parsing failed for output ${outputId}: ${parseError}`,
        );
        throw new Error(
          `AI returned invalid JSON: ${parseError instanceof Error ? parseError.message : "Parse error"}`,
        );
      }

      // Update output with success
      await this.updateOutput(
        outputId,
        "COMPLETED",
        content,
        undefined,
        result.tokensUsed,
      );

      this.logger.log(`Output ${outputId} marked as COMPLETED`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Failed to generate output ${outputId}: ${errorMessage}`,
      );

      // Update output with failure
      await this.updateOutput(outputId, "FAILED", undefined, errorMessage);
    }
  }

  /**
   * Build user prompt with source content
   */
  private buildUserPrompt(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma source shape varies; private method
    sources: any[],
    options?: Record<string, unknown>,
  ): string {
    const sourcesText = sources
      .map((source, index) => {
        const sourceInfo = [
          `## Source ${index + 1}: ${source.title}`,
          `**ID**: ${source.id}`,
          `**Type**: ${source.sourceType}`,
        ];

        if (source.sourceUrl) {
          sourceInfo.push(`**URL**: ${source.sourceUrl}`);
        }

        if (source.authors && source.authors.length > 0) {
          sourceInfo.push(`**Authors**: ${source.authors.join(", ")}`);
        }

        if (source.publishedAt) {
          sourceInfo.push(`**Published**: ${source.publishedAt}`);
        }

        if (source.abstract) {
          sourceInfo.push(`\n**Abstract**:\n${source.abstract}`);
        }

        if (source.content) {
          // Limit content length to avoid token limits
          const maxContentLength = 3000;
          const content =
            source.content.length > maxContentLength
              ? source.content.substring(0, maxContentLength) +
                "\n\n[Content truncated...]"
              : source.content;
          sourceInfo.push(`\n**Content**:\n${content}`);
        }

        return sourceInfo.join("\n");
      })
      .join("\n\n---\n\n");

    let prompt = `You are analyzing research sources to generate a structured output.

# Research Sources

${sourcesText}

---

# Task

Based on the above sources, generate the requested output following the exact JSON structure specified in your instructions.`;

    // Add custom options if provided
    if (options && Object.keys(options).length > 0) {
      prompt += `\n\n# Additional Requirements\n\n${JSON.stringify(options, null, 2)}`;
    }

    prompt += `\n\nRemember: Output ONLY valid JSON. Do not include any explanatory text before or after the JSON.`;

    return prompt;
  }

  /**
   * Get all outputs for a project
   */
  async getOutputs(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProjectOutput.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get a single output
   */
  async getOutput(userId: string, projectId: string, outputId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const output = await this.prisma.researchProjectOutput.findUnique({
      where: { id: outputId },
    });

    if (!output || output.projectId !== projectId) {
      throw new NotFoundException("Output not found");
    }

    return output;
  }

  /**
   * Update output status and content (used by AI generation job)
   */
  async updateOutput(
    outputId: string,
    status: "PENDING" | "GENERATING" | "COMPLETED" | "FAILED",
    content?: string,
    error?: string,
    tokensUsed?: number,
  ) {
    return this.prisma.researchProjectOutput.update({
      where: { id: outputId },
      data: {
        status,
        ...(content && { content }),
        ...(error && { error }),
        ...(tokensUsed && { tokensUsed }),
        ...(status === "COMPLETED" && { completedAt: new Date() }),
      },
    });
  }

  /**
   * Delete an output
   */
  async deleteOutput(userId: string, projectId: string, outputId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const output = await this.prisma.researchProjectOutput.findUnique({
      where: { id: outputId },
    });

    if (!output || output.projectId !== projectId) {
      throw new NotFoundException("Output not found");
    }

    await this.prisma.researchProjectOutput.delete({
      where: { id: outputId },
    });

    return { success: true };
  }

  /**
   * Update output properties (e.g., rename) - user-facing API
   */
  async updateOutputProperties(
    userId: string,
    projectId: string,
    outputId: string,
    updates: { title?: string },
  ) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const output = await this.prisma.researchProjectOutput.findUnique({
      where: { id: outputId },
    });

    if (!output || output.projectId !== projectId) {
      throw new NotFoundException("Output not found");
    }

    return this.prisma.researchProjectOutput.update({
      where: { id: outputId },
      data: {
        ...(updates.title && { title: updates.title }),
      },
    });
  }

  /**
   * Regenerate an output
   */
  async regenerateOutput(userId: string, projectId: string, outputId: string) {
    // Verify access by getting the output (throws if not found or unauthorized)
    await this.getOutput(userId, projectId, outputId);

    // Reset status to pending
    return this.prisma.researchProjectOutput.update({
      where: { id: outputId },
      data: {
        status: "PENDING",
        content: null,
        error: null,
        completedAt: null,
      },
    });
  }
}
