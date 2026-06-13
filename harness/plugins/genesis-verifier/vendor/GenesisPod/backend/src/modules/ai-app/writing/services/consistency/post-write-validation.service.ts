import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

export interface ConsistencyIssue {
  type: "CHARACTER" | "TIMELINE" | "WORLD" | "TERMINOLOGY" | "PLOT";
  severity: "CRITICAL" | "WARNING" | "INFO";
  location: string;
  description: string;
  expected?: string;
  found?: string;
  suggestion?: string;
}

export interface ConsistencyReport {
  status: "PASSED" | "ISSUES_FOUND";
  issues: ConsistencyIssue[];
  suggestions: string[];
}

@Injectable()
export class PostWriteValidationService {
  private readonly logger = new Logger(PostWriteValidationService.name);

  constructor(private readonly prisma: PrismaService) {
    void this.logger;
  }

  async validate(
    chapterId: string,
    content: string,
  ): Promise<ConsistencyReport> {
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            project: {
              include: {
                storyBible: {
                  include: {
                    characters: true,
                    worldSettings: true,
                    terminologies: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!chapter?.volume.project.storyBible) {
      return { status: "PASSED", issues: [], suggestions: [] };
    }

    const bible = chapter.volume.project.storyBible;
    const issues: ConsistencyIssue[] = [];

    // Check character consistency
    const characterIssues = this.checkCharacterConsistency(
      content,
      bible.characters,
    );
    issues.push(...characterIssues);

    // Check terminology consistency
    const termIssues = this.checkTerminologyConsistency(
      content,
      bible.terminologies,
    );
    issues.push(...termIssues);

    // Check world setting consistency
    const worldIssues = this.checkWorldConsistency(
      content,
      bible.worldSettings,
    );
    issues.push(...worldIssues);

    return {
      status: issues.length > 0 ? "ISSUES_FOUND" : "PASSED",
      issues,
      suggestions: issues.map((i) => i.suggestion).filter(Boolean) as string[],
    };
  }

  private checkCharacterConsistency(
    content: string,
    characters: unknown[],
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const character of characters) {
      const c = character as Record<string, unknown>;
      // Check if character name is mentioned
      if (content.includes(c["name"] as string)) {
        // Check appearance descriptions
        const appearance = c["appearance"];
        if (appearance) {
          // Check for conflicting descriptions
          // This is a simplified check - could be enhanced with NLP
          for (const [_key, value] of Object.entries(
            appearance as Record<string, unknown>,
          )) {
            if (typeof value === "string" && value.length > 0) {
              // Look for contradicting descriptions
              // Placeholder logic - would need NLP in production
            }
          }
        }
      }
    }

    return issues;
  }

  private checkTerminologyConsistency(
    content: string,
    terminologies: unknown[],
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const term of terminologies) {
      const t = term as Record<string, unknown>;
      // Check if term variants are used inconsistently
      if (((t["variants"] as unknown[] | undefined)?.length ?? 0) > 0) {
        const usedVariants = (t["variants"] as string[]).filter((v: string) =>
          content.includes(v),
        );
        if (usedVariants.length > 1) {
          issues.push({
            type: "TERMINOLOGY",
            severity: "WARNING",
            location: "Multiple locations",
            description: `术语 "${t["term"] as string}" 使用了多个变体`,
            expected: t["term"] as string,
            found: usedVariants.join(", "),
            suggestion: `统一使用 "${t["term"] as string}"`,
          });
        }
      }
    }

    return issues;
  }

  private checkWorldConsistency(
    _content: string,
    worldSettings: unknown[],
  ): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const setting of worldSettings) {
      const s = setting as Record<string, unknown>;
      // Check if setting rules are violated
      if (((s["rules"] as unknown[] | undefined)?.length ?? 0) > 0) {
        // Placeholder for rule checking logic
        // Would need NLP/LLM to properly check rule violations
      }
    }

    return issues;
  }
}
