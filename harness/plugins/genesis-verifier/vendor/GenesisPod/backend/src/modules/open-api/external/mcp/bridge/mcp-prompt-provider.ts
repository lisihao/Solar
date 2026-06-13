/**
 * MCP Prompt Provider
 *
 * 将 GenesisPod 的 AI 能力暴露为 MCP Prompts（可复用的提示模板），
 * 让外部 AI 工具可以直接获取预构建的提示词。
 *
 * MCP Prompts 是用户驱动的模板（不同于 Tools 是模型驱动的）。
 * 典型用例: 用户在 Claude Code 中选择一个 GenesisPod prompt 来执行特定任务。
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IMCPPromptProvider,
  MCPPrompt,
  MCPPromptMessage,
} from "../abstractions/mcp-server.interface";
import { APP_CONFIG } from "../../../../../common/config/app.config";

interface PromptTemplate {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  build(args: Record<string, string>): MCPPromptMessage[];
}

@Injectable()
export class MCPPromptProvider implements IMCPPromptProvider {
  private readonly logger = new Logger(MCPPromptProvider.name);
  private readonly templates: Map<string, PromptTemplate>;

  constructor() {
    this.templates = new Map();
    this.registerBuiltinPrompts();
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    return Array.from(this.templates.values()).map((t) => ({
      name: t.name,
      description: t.description,
      arguments: t.arguments,
    }));
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPPromptMessage[]> {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    // Validate required arguments
    for (const arg of template.arguments) {
      if (arg.required && !args?.[arg.name]) {
        throw new Error(`Missing required argument: ${arg.name}`);
      }
    }

    return template.build(args || {});
  }

  private registerBuiltinPrompts(): void {
    // -----------------------------------------------------------------------
    // 1. Deep Research Prompt
    // -----------------------------------------------------------------------
    this.templates.set("deep-research", {
      name: "deep-research",
      description:
        "Generate a deep research request with structured planning. " +
        "Use this to leverage GenesisPod's multi-stage research pipeline.",
      arguments: [
        {
          name: "topic",
          description: "Research topic or question",
          required: true,
        },
        {
          name: "depth",
          description:
            "Research depth: quick, standard, or deep (default: standard)",
          required: false,
        },
        {
          name: "language",
          description: "Output language (default: en)",
          required: false,
        },
      ],
      build: (args) => [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Please conduct a ${args.depth || "standard"} depth research on the following topic:\n\n` +
              `Topic: ${args.topic}\n\n` +
              `Requirements:\n` +
              `- Provide an executive summary\n` +
              `- Include key findings with evidence\n` +
              `- Cite sources where possible\n` +
              `- Output in ${args.language || "en"}\n\n` +
              `Use the genesis_deep_research tool to execute this research.`,
          },
        },
      ],
    });

    // -----------------------------------------------------------------------
    // 2. Content Analysis Prompt
    // -----------------------------------------------------------------------
    this.templates.set("content-analysis", {
      name: "content-analysis",
      description:
        "Analyze content with multiple dimensions using GenesisPod's analysis engine.",
      arguments: [
        { name: "content", description: "Content to analyze", required: true },
        {
          name: "type",
          description:
            "Analysis type: comprehensive, summary, key_findings, quality, structure, sentiment",
          required: false,
        },
      ],
      build: (args) => [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Analyze the following content using ${args.type || "comprehensive"} analysis:\n\n` +
              `---\n${args.content}\n---\n\n` +
              `Use the genesis_content_analysis tool for detailed analysis.`,
          },
        },
      ],
    });

    // -----------------------------------------------------------------------
    // 3. Team Debate Prompt
    // -----------------------------------------------------------------------
    this.templates.set("team-debate", {
      name: "team-debate",
      description:
        "Start a multi-agent debate with opposing perspectives. " +
        `${APP_CONFIG.brand.name}'s team debate system simulates pro/con viewpoints with a neutral judge.`,
      arguments: [
        {
          name: "topic",
          description: "Debate topic or proposition",
          required: true,
        },
        {
          name: "rounds",
          description: "Number of debate rounds (1-5, default: 3)",
          required: false,
        },
      ],
      build: (args) => [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Please conduct a structured debate on:\n\n` +
              `"${args.topic}"\n\n` +
              `- Use ${args.rounds || "3"} rounds of pro/con arguments\n` +
              `- Include a final judgment from a neutral perspective\n\n` +
              `Use the genesis_team_debate tool to run this debate.`,
          },
        },
      ],
    });

    // -----------------------------------------------------------------------
    // 4. Writing Assist Prompt
    // -----------------------------------------------------------------------
    this.templates.set("writing-assist", {
      name: "writing-assist",
      description:
        "Get AI writing assistance for improving, expanding, or restructuring text.",
      arguments: [
        { name: "text", description: "Text to work with", required: true },
        {
          name: "task",
          description:
            "Task: improve, expand, summarize, rewrite, proofread, outline",
          required: false,
        },
        {
          name: "style",
          description:
            "Target style: academic, professional, casual, technical",
          required: false,
        },
      ],
      build: (args) => [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Please ${args.task || "improve"} the following text` +
              (args.style ? ` in a ${args.style} style` : "") +
              `:\n\n---\n${args.text}\n---\n\n` +
              `Use the genesis_writing_assist tool for AI-powered writing assistance.`,
          },
        },
      ],
    });

    // -----------------------------------------------------------------------
    // 5. Capability Discovery Prompt
    // -----------------------------------------------------------------------
    this.templates.set("discover-capabilities", {
      name: "discover-capabilities",
      description: `Discover available ${APP_CONFIG.brand.name} AI capabilities, tools, skills, and agents.`,
      arguments: [
        {
          name: "category",
          description:
            "Filter by category (optional): tools, skills, agents, teams, models",
          required: false,
        },
      ],
      build: (args) => {
        const resourceUri = args.category
          ? `genesis://${args.category}`
          : "genesis://capabilities";

        return [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `I want to discover what ${APP_CONFIG.brand.fullName} can do.\n\n` +
                `Please read the resource at ${resourceUri} to see available capabilities` +
                (args.category ? ` filtered to ${args.category}` : "") +
                `.`,
            },
          },
        ];
      },
    });

    this.logger.log(`Registered ${this.templates.size} MCP prompt templates`);
  }
}
