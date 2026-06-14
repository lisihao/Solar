/**
 * MCP Server - Teams Debate Tool Handler
 * Multi-perspective debate via AIFacade.chat() (dual-role simulation)
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
} from "../abstractions/mcp-server.interface";
import { ChatFacade } from "../../../../ai-harness/facade";
import type { ChatMessage } from "../../../../ai-harness/facade";
import { withToolTimeout, MULTI_STEP_TIMEOUT_MS } from "./tool-timeout";

interface DebateRound {
  round: number;
  proArgument: string;
  conArgument: string;
}

@Injectable()
export class TeamsDebateToolHandler implements IMCPToolHandler {
  private readonly logger = new Logger(TeamsDebateToolHandler.name);

  readonly toolName = "genesis_team_debate";
  readonly description =
    "Run a structured multi-agent debate on a topic. Two AI agents with opposing perspectives " +
    "analyze the topic through multiple rounds, producing balanced analysis with a final judgment.";
  readonly inputSchema = {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The debate topic or proposition",
      },
      rounds: {
        type: "number",
        description: "Number of debate rounds (1-5). Default: 3",
      },
      perspective: {
        type: "string",
        description: "Optional specific angle for the debate",
      },
    },
    required: ["topic"],
  };

  constructor(private readonly aiFacade: ChatFacade) {}

  async execute(
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    if (!args.topic || typeof args.topic !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "topic must be a non-empty string" }),
          },
        ],
        isError: true,
      };
    }

    const topic = args.topic;
    const rounds = Math.min(Math.max((args.rounds as number) || 3, 1), 5);
    const perspective = args.perspective as string | undefined;

    this.logger.log(
      `MCP debate request: "${topic}" (rounds: ${rounds}, key: ${context.apiKeyId})`,
    );

    try {
      const result = await withToolTimeout(
        this.executeDebate(topic, rounds, perspective),
        MULTI_STEP_TIMEOUT_MS,
        "Team debate",
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      this.logger.error(`Debate tool failed: ${error}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Failed to execute debate",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
          },
        ],
        isError: true,
      };
    }
  }

  private async executeDebate(
    topic: string,
    rounds: number,
    perspective?: string,
  ): Promise<{
    topic: string;
    perspective: string | null;
    rounds: DebateRound[];
    judgment: unknown;
  }> {
    const debateRounds: DebateRound[] = [];
    const perspectiveNote = perspective
      ? ` Focus the debate around this angle: ${perspective}.`
      : "";

    const proSystemPrompt =
      `You are a skilled debater arguing IN FAVOR of the following proposition. ` +
      `Present strong, evidence-based arguments supporting the position.${perspectiveNote} ` +
      `Be persuasive but intellectually honest. Keep your argument focused and concise (200-400 words per round). ` +
      `In subsequent rounds, directly respond to the opposing arguments presented.`;

    const conSystemPrompt =
      `You are a skilled debater arguing AGAINST the following proposition. ` +
      `Present strong, evidence-based counterarguments.${perspectiveNote} ` +
      `Be persuasive but intellectually honest. Keep your argument focused and concise (200-400 words per round). ` +
      `Directly respond to the arguments presented by the other side.`;

    for (let round = 1; round <= rounds; round++) {
      const debateHistory = this.buildDebateHistory(debateRounds);

      // Pro argument
      const proMessages: ChatMessage[] = [
        ...debateHistory,
        {
          role: "user",
          content:
            round === 1
              ? `Debate topic: "${topic}"\n\nPresent your opening argument IN FAVOR of this proposition.`
              : `Continue the debate. Present your round ${round} argument, responding to the opposing points made.`,
        },
      ];

      const proResponse = await this.aiFacade.chat({
        messages: proMessages,
        systemPrompt: proSystemPrompt,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "medium", outputLength: "medium" },
        strictMode: true,
      });

      // Con argument (includes pro argument from this round)
      const conMessages: ChatMessage[] = [
        ...debateHistory,
        {
          role: "assistant",
          content: `[PRO - Round ${round}]: ${proResponse.content}`,
        },
        {
          role: "user",
          content:
            round === 1
              ? `Debate topic: "${topic}"\n\nThe PRO side has presented their opening argument above. Present your argument AGAINST this proposition.`
              : `The PRO side has presented their round ${round} argument above. Present your counterargument.`,
        },
      ];

      const conResponse = await this.aiFacade.chat({
        messages: conMessages,
        systemPrompt: conSystemPrompt,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "medium", outputLength: "medium" },
        strictMode: true,
      });

      debateRounds.push({
        round,
        proArgument: proResponse.content,
        conArgument: conResponse.content,
      });
    }

    // Final judgment
    const judgmentResponse = await this.aiFacade.chat({
      messages: [
        {
          role: "user",
          content: this.buildJudgmentPrompt(topic, debateRounds, perspective),
        },
      ],
      systemPrompt:
        "You are an impartial judge and expert analyst. Evaluate the debate objectively. " +
        "Return your judgment as valid JSON. No markdown code fences or extra text.",
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "long" },
      strictMode: true,
    });

    let judgment: unknown;
    try {
      judgment = JSON.parse(judgmentResponse.content);
    } catch {
      judgment = {
        winner: "draw",
        confidence: "low",
        proStrengths: [],
        proWeaknesses: [],
        conStrengths: [],
        conWeaknesses: [],
        keyInsights: [],
        conclusion: judgmentResponse.content,
        _parseError: true,
      };
    }

    return {
      topic,
      perspective: perspective || null,
      rounds: debateRounds,
      judgment,
    };
  }

  private buildDebateHistory(rounds: DebateRound[]): ChatMessage[] {
    if (rounds.length === 0) return [];

    const messages: ChatMessage[] = [];
    for (const round of rounds) {
      messages.push({
        role: "assistant",
        content: `[PRO - Round ${round.round}]: ${round.proArgument}`,
      });
      messages.push({
        role: "assistant",
        content: `[CON - Round ${round.round}]: ${round.conArgument}`,
      });
    }
    return messages;
  }

  private buildJudgmentPrompt(
    topic: string,
    rounds: DebateRound[],
    perspective?: string,
  ): string {
    let prompt = `You have observed a ${rounds.length}-round debate on: "${topic}"`;
    if (perspective) {
      prompt += ` (focused on: ${perspective})`;
    }
    prompt += "\n\nDebate transcript:\n";

    for (const round of rounds) {
      prompt += `\n--- Round ${round.round} ---\n`;
      prompt += `PRO: ${round.proArgument}\n`;
      prompt += `CON: ${round.conArgument}\n`;
    }

    prompt += `\nProvide your judgment as JSON:
{
  "winner": "pro|con|draw",
  "confidence": "high|medium|low",
  "proStrengths": ["Strength 1"],
  "proWeaknesses": ["Weakness 1"],
  "conStrengths": ["Strength 1"],
  "conWeaknesses": ["Weakness 1"],
  "keyInsights": ["Insight 1"],
  "conclusion": "Overall assessment"
}`;

    return prompt;
  }
}
