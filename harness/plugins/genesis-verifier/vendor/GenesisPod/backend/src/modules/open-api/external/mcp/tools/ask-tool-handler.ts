/**
 * MCP Server - Ask Tool Handler
 * GenesisPod AI Ask -> AIFacade.chat()
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
} from "../abstractions/mcp-server.interface";
import { ChatFacade, RAGFacade } from "../../../../ai-harness/facade";
import { withToolTimeout, TOOL_TIMEOUT_MS } from "./tool-timeout";
import { APP_CONFIG } from "../../../../../common/config/app.config";

@Injectable()
export class AskToolHandler implements IMCPToolHandler {
  private readonly logger = new Logger(AskToolHandler.name);

  readonly toolName = "genesis_ask";
  readonly description =
    `Ask ${APP_CONFIG.brand.name} AI a question. Supports multi-model responses with ` +
    "web search augmentation and knowledge base integration.";
  readonly inputSchema = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask",
      },
      context: {
        type: "string",
        description: "Optional additional context for the question",
      },
      webSearch: {
        type: "boolean",
        description:
          "Whether to augment with web search results. Default: false",
      },
    },
    required: ["question"],
  };

  constructor(
    private readonly aiFacade: ChatFacade,
    private readonly ragFacade: RAGFacade,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    if (!args.question || typeof args.question !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "question must be a non-empty string",
            }),
          },
        ],
        isError: true,
      };
    }

    const question = args.question;
    const userContext = args.context as string | undefined;
    const webSearch = (args.webSearch as boolean) || false;

    this.logger.log(
      `MCP ask request: "${question.slice(0, 50)}..." (webSearch: ${webSearch}, key: ${context.apiKeyId})`,
    );

    try {
      let searchContext = "";

      if (webSearch) {
        try {
          const searchResponse = await this.ragFacade.search({
            query: question,
            maxResults: 5,
          });

          if (searchResponse.success && searchResponse.results.length > 0) {
            searchContext = searchResponse.results
              .map(
                (r, i) =>
                  `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`,
              )
              .join("\n\n");
          }
        } catch (err) {
          this.logger.warn(`Web search failed, proceeding without: ${err}`);
        }
      }

      const systemParts: string[] = [];
      if (userContext) {
        systemParts.push(`User-provided context:\n${userContext}`);
      }
      if (searchContext) {
        systemParts.push(`Web search results for reference:\n${searchContext}`);
      }

      const systemPrompt =
        systemParts.length > 0
          ? systemParts.join("\n\n---\n\n") +
            "\n\nUse the above context to help answer the question. Cite sources when using web search results."
          : undefined;

      const response = await withToolTimeout(
        this.aiFacade.chat({
          messages: [{ role: "user", content: question }],
          systemPrompt,
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "medium", outputLength: "medium" },
          strictMode: true,
        }),
        TOOL_TIMEOUT_MS,
        "Ask AI",
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer: response.content,
              model: response.model,
              tokensUsed: response.tokensUsed,
              webSearchUsed: webSearch,
            }),
          },
        ],
      };
    } catch (error) {
      this.logger.error(`Ask tool failed: ${error}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Failed to process question",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  }
}
