import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ConsistencyIssue } from "./post-write-validation.service";

@Injectable()
export class ConflictResolutionService {
  private readonly _logger = new Logger(ConflictResolutionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(chapterId: string, issues: ConsistencyIssue[]) {
    const results = [];

    for (const issue of issues) {
      const result = await this.resolveIssue(chapterId, issue);
      results.push(result);
    }

    // Update consistency check status
    await this.prisma.consistencyCheck.updateMany({
      where: { chapterId, status: "ISSUES_FOUND" },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });

    return {
      resolved: results.filter((r) => r.resolved).length,
      failed: results.filter((r) => !r.resolved).length,
      details: results,
    };
  }

  private async resolveIssue(_chapterId: string, issue: ConsistencyIssue) {
    try {
      switch (issue.severity) {
        case "INFO":
          // Auto-resolve info issues
          return { resolved: true, issue, action: "auto-resolved" };

        case "WARNING":
          // Auto-resolve warning issues with suggestion
          if (issue.suggestion) {
            return {
              resolved: true,
              issue,
              action: "auto-resolved with suggestion",
            };
          }
          return { resolved: false, issue, action: "requires manual review" };

        case "CRITICAL":
          // Critical issues always require manual resolution
          return {
            resolved: false,
            issue,
            action: "requires manual resolution",
          };

        default:
          return { resolved: false, issue, action: "unknown severity" };
      }
    } catch (error) {
      this._logger.error(`Failed to resolve issue: ${error}`);
      return { resolved: false, issue, action: "error during resolution" };
    }
  }

  async markResolved(checkId: string) {
    return this.prisma.consistencyCheck.update({
      where: { id: checkId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });
  }
}
