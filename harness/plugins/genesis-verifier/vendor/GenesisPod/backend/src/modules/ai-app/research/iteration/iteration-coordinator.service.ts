import { Injectable, Logger, Optional } from "@nestjs/common";
import { Subject } from "rxjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { DiscussionOrchestratorService } from "../discussion/discussion-orchestrator.service";
import { ExitDecisionService } from "../evaluation";
import type { ExitDecision, ExitContext } from "../evaluation";
import { IterationRecordService } from "./iteration-record.service";
import { IterationFeedbackService } from "./iteration-feedback.service";
import {
  IterationEvaluatorService,
  estimateReportQuality,
  buildFollowUpQuery,
  buildPreviousContext,
  buildIterationHistory,
  extractKeywords,
} from "./iteration-evaluator.service";
import type { IdeaItem } from "./iteration-evaluator.service";
import type {
  StartIterativeResearchDto,
  IterationStartEvent,
  IterationResearchEvent,
  IterationIdeasEvent,
  IterationDemoEvent,
  IterationEvalEvent,
  IterationExitEvent,
  ResearchCheckpoint,
} from "./types";
import type { IterationSnapshot as IterationSnapshotType } from "./types";
import { ResearchMemoryService } from "../memory/research-memory.service";
import type {
  DeepResearchReport,
  DeepResearchSSEEvent,
} from "../discussion/types";
import { ITERATION_CONFIG } from "../config/research.config";
import type {
  IterationMeta,
  IterationSSEEvent,
  IterationSessionEvent,
} from "./iterative-research.service";

// Local alias
type IterationSnapshot = IterationSnapshotType;

const MAX_ACCUMULATED_IDEAS = ITERATION_CONFIG.MAX_ACCUMULATED_IDEAS;

interface RunInnerResult {
  sessionId: string;
  report: DeepResearchReport;
}

/**
 * Orchestrates the outer iterative research loop: round management, checkpoint
 * persistence/recovery, session merging, and summary generation.
 *
 * Delegates to:
 *  - IterationEvaluatorService — topic classification, idea extraction, demo scoring
 *  - IterationFeedbackService  — user feedback pause/resume
 *  - IterationRecordService    — markdown record generation
 *  - ResearchMemoryService     — cross-session memory persistence
 */
@Injectable()
export class IterationCoordinatorService {
  private readonly logger = new Logger(IterationCoordinatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: DiscussionOrchestratorService,
    private readonly evaluator: IterationEvaluatorService,
    private readonly feedbackService: IterationFeedbackService,
    @Optional() private readonly exitDecisionService?: ExitDecisionService,
    @Optional()
    private readonly iterationRecordService?: IterationRecordService,
    @Optional() private readonly memoryService?: ResearchMemoryService,
  ) {}

  /**
   * Runs the full iterative loop, emitting SSE events to the provided Subject.
   * Should be called inside a void-caught async block by the facade.
   */
  async runIterativeLoop(
    projectId: string,
    dto: StartIterativeResearchDto,
    subject: Subject<DeepResearchSSEEvent | IterationSSEEvent>,
  ): Promise<void> {
    const startTime = Date.now();
    const depth = dto.options?.depth ?? "standard";
    const maxIterations = dto.iterationOptions?.maxIterations ?? 4;

    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    const userId = project?.userId ?? "";
    if (!userId) {
      this.logger.warn(
        `[Iterative] No userId found for project ${projectId}, proceeding with empty userId`,
      );
    }

    // ---- Round 0: initial research ------------------------------------------
    this.logger.log(`[Iterative] Starting round 0 for project ${projectId}`);
    const { sessionId, report } = await this.runInnerResearch(
      projectId,
      {
        query: dto.query,
        options: dto.options,
        isFollowUp: dto.isFollowUp,
        previousContext: dto.previousContext,
      },
      subject,
    );

    const topicType = await this.evaluator.classifyTopic(
      dto.query,
      report.executiveSummary,
    );

    const initialIdeas = await this.evaluator.extractIdeas(
      userId,
      projectId,
      sessionId,
    );
    const allInsights = initialIdeas.filter((i) => i.type === "INSIGHT");
    const allCreativeIdeas = initialIdeas.filter(
      (i) => i.type === "CREATIVE_IDEA",
    );

    if (allInsights.length > 0) {
      const creativeIdeas = await this.evaluator.extractCreativeIdeasSafe(
        userId,
        projectId,
      );
      creativeIdeas.forEach((i) => {
        if (!allCreativeIdeas.some((x) => x.id === i.id))
          allCreativeIdeas.push(i);
      });
    }

    subject.next({
      type: "iteration.ideas",
      data: {
        round: 0,
        newInsights: allInsights.map((i) => ({ title: i.title })),
        newCreativeIdeas: allCreativeIdeas.map((i) => ({ title: i.title })),
        totalInsights: allInsights.length,
        totalCreativeIdeas: allCreativeIdeas.length,
      },
    } satisfies IterationIdeasEvent);

    const demoIdea = allCreativeIdeas[0] ?? allInsights[0];
    let currentScore = 0;
    let currentGaps: { dataGaps: string[]; ideaGaps: string[] } = {
      dataGaps: [],
      ideaGaps: [],
    };
    let currentReport = report;
    let currentSessionId = sessionId;
    const originalSessionId = sessionId;

    subject.next({
      type: "iteration.session",
      data: {
        sessionId: originalSessionId,
        maxIterations,
        qualityThreshold: dto.iterationOptions?.qualityThreshold ?? 0.75,
        depth,
      },
    } satisfies IterationSessionEvent);

    subject.next({
      type: "iteration.research",
      data: {
        round: 0,
        queries: [dto.query],
        newSources: report.metadata.totalSources,
        informationGain: 1.0,
      },
    } satisfies IterationResearchEvent);

    let demoAvailable = false;
    if (demoIdea) {
      subject.next({
        type: "iteration.demo",
        data: { round: 0, status: "generating" },
      } satisfies IterationDemoEvent);

      const completedDemo = await this.evaluator.createAndPollDemo(
        userId,
        projectId,
        demoIdea.id,
      );
      if (completedDemo) {
        demoAvailable = true;
        subject.next({
          type: "iteration.demo",
          data: { round: 0, status: "completed" },
        } satisfies IterationDemoEvent);

        const lastDemoScore = await this.evaluator.evaluateDemo(
          completedDemo.htmlContent,
          {
            insights: allInsights.map((i) => i.title),
            creativeIdeas: allCreativeIdeas.map((i) => i.title),
          },
          topicType,
          dto.query,
        );

        currentScore = lastDemoScore.composite;
        currentGaps = lastDemoScore.gaps;
      }
    }

    if (!demoAvailable) {
      const fallback = estimateReportQuality(
        report,
        allInsights.length,
        allCreativeIdeas.length,
      );
      currentScore = fallback.score;
      currentGaps = fallback.gaps;
      this.logger.log(
        `[Iterative] Demo unavailable, using report-based score: ${(currentScore * 100).toFixed(0)}%`,
      );
    }

    const scores: number[] = [currentScore];
    const iterationRecords: string[] = [];
    const userFeedbackHistory: string[] = [];
    let latestFeedback: string | null = null;

    const roundSnapshots: Array<{
      insights: number;
      creativeIdeas: number;
      gapCount: number;
      keyChange: string;
    }> = [
      {
        insights: allInsights.length,
        creativeIdeas: allCreativeIdeas.length,
        gapCount: currentGaps.dataGaps.length + currentGaps.ideaGaps.length,
        keyChange: "Initial research",
      },
    ];

    const initMarkdown = this.iterationRecordService?.generateInitRecord({
      query: dto.query,
      topicType,
      depth,
      qualityThreshold: dto.iterationOptions?.qualityThreshold ?? 0.75,
      maxIterations,
      searchSummary: {
        directions: report.metadata.searchRounds,
        sources: report.metadata.totalSources,
        rounds: report.metadata.searchRounds,
      },
      insights: allInsights.map((i) => i.title),
      creativeIdeas: allCreativeIdeas.map((i) => i.title),
      demoType: topicType,
      demoScore: currentScore,
      gaps: currentGaps,
    });
    if (initMarkdown) {
      iterationRecords.push(initMarkdown);
    }

    subject.next({
      type: "iteration.eval",
      data: {
        round: 0,
        score: currentScore * 100,
        previousScore: 0,
        gaps: currentGaps,
        record: initMarkdown ?? undefined,
      },
    } satisfies IterationEvalEvent);

    await this.saveIterationSnapshot(originalSessionId, {
      round: 0,
      score: currentScore * 100,
      previousScore: 0,
      gaps: currentGaps,
      ideas: {
        newInsights: allInsights.map((i) => ({ title: i.title })),
        newCreativeIdeas: allCreativeIdeas.map((i) => ({ title: i.title })),
        totalInsights: allInsights.length,
        totalCreativeIdeas: allCreativeIdeas.length,
      },
      demo: demoIdea ? { status: "completed" } : undefined,
      timestamp: new Date().toISOString(),
    });

    // Pause for user feedback after Round 0
    const FEEDBACK_TIMEOUT_MS = Math.min(
      dto.iterationOptions?.feedbackTimeoutMs ||
        ITERATION_CONFIG.FEEDBACK_TIMEOUT_MS,
      ITERATION_CONFIG.MAX_FEEDBACK_TIMEOUT_MS,
    );
    subject.next({
      type: "iteration.awaiting_feedback" as const,
      data: {
        round: 0,
        score: currentScore * 100,
        gaps: currentGaps,
        timeoutMs: FEEDBACK_TIMEOUT_MS,
      },
    });

    const round0Feedback = await this.feedbackService.waitForFeedback(
      projectId,
      FEEDBACK_TIMEOUT_MS,
    );
    if (round0Feedback) {
      this.logger.log(
        `[Iterative] User feedback for round 0: "${round0Feedback.slice(0, 100)}"`,
      );
      userFeedbackHistory.push(round0Feedback);
      latestFeedback = round0Feedback;
    }

    // ---- Checkpoint recovery ------------------------------------------------
    const existingCheckpoint = await this.loadCheckpoint(originalSessionId);
    let checkpointStartRound = 1;
    if (existingCheckpoint && existingCheckpoint.completedRounds >= 1) {
      this.logger.log(
        `[Iterative] Resuming from checkpoint: completedRounds=${existingCheckpoint.completedRounds}, savedAt=${existingCheckpoint.savedAt}`,
      );
      checkpointStartRound = existingCheckpoint.completedRounds + 1;

      existingCheckpoint.accumulatedIdeas.forEach((idea) => {
        const asItem: IdeaItem = {
          id: "",
          title: idea.title,
          type: "INSIGHT",
          description: idea.description ?? "",
          metadata: null,
        };
        if (!allInsights.some((x) => x.title === idea.title)) {
          allInsights.push(asItem);
        }
      });

      const snap = existingCheckpoint.lastSnapshot;
      currentScore = snap.score / 100;
      currentGaps = snap.gaps;
      while (scores.length < existingCheckpoint.completedRounds + 1) {
        scores.push(currentScore);
      }
    }

    // ---- Iteration loop (rounds 1..maxIterations) ---------------------------
    let exitDecision: ExitDecision = { exit: false };
    let informationGain = 1.0;

    for (let round = checkpointStartRound; round <= maxIterations; round++) {
      const exitContext: ExitContext = {
        iteration: round,
        depth,
        scores,
        informationGain,
        gaps: currentGaps,
      };

      exitDecision = this.exitDecisionService?.decide(exitContext) ?? {
        exit: round >= maxIterations,
        reason: round >= maxIterations ? "budget_exhausted" : undefined,
      };

      if (exitDecision.exit) {
        this.logger.log(
          `[Iterative] Exit at round ${round}: ${exitDecision.reason}`,
        );
        break;
      }

      subject.next({
        type: "iteration.start",
        data: { round, targetGaps: currentGaps },
      } satisfies IterationStartEvent);

      const followUpQuery = buildFollowUpQuery(
        dto.query,
        currentGaps,
        latestFeedback,
      );
      latestFeedback = null;

      const iterationHistory = buildIterationHistory(
        iterationRecords,
        scores,
        userFeedbackHistory,
      );
      const previousContext = buildPreviousContext(
        currentReport,
        iterationHistory,
      );
      const prevTotalSources = currentReport.metadata.totalSources;

      let roundErrored = false;
      try {
        const followUp = await this.runInnerResearch(
          projectId,
          {
            query: followUpQuery,
            options: dto.options,
            isFollowUp: true,
            previousContext,
          },
          subject,
        );

        const newTotalSources = followUp.report.metadata.totalSources;
        const newSources = Math.max(0, newTotalSources - prevTotalSources);
        informationGain =
          prevTotalSources > 0 ? newSources / prevTotalSources : 1;

        subject.next({
          type: "iteration.research",
          data: {
            round,
            queries: [followUpQuery],
            newSources,
            informationGain,
          },
        } satisfies IterationResearchEvent);

        const newIdeas = await this.evaluator.extractIdeas(
          userId,
          projectId,
          followUp.sessionId,
        );
        const newInsights = newIdeas.filter((i) => i.type === "INSIGHT");
        const newCreativeIdeas = newIdeas.filter(
          (i) => i.type === "CREATIVE_IDEA",
        );

        if (newInsights.length > 0) {
          const freshCreativeIdeas =
            await this.evaluator.extractCreativeIdeasSafe(userId, projectId);
          freshCreativeIdeas.forEach((i) => {
            if (!newCreativeIdeas.some((x) => x.id === i.id))
              newCreativeIdeas.push(i);
          });
        }

        newInsights.forEach((i) => {
          if (!allInsights.some((x) => x.id === i.id)) allInsights.push(i);
        });
        newCreativeIdeas.forEach((i) => {
          if (!allCreativeIdeas.some((x) => x.id === i.id))
            allCreativeIdeas.push(i);
        });

        if (allInsights.length > MAX_ACCUMULATED_IDEAS) {
          allInsights.splice(0, allInsights.length - MAX_ACCUMULATED_IDEAS);
        }
        if (allCreativeIdeas.length > MAX_ACCUMULATED_IDEAS) {
          allCreativeIdeas.splice(
            0,
            allCreativeIdeas.length - MAX_ACCUMULATED_IDEAS,
          );
        }

        subject.next({
          type: "iteration.ideas",
          data: {
            round,
            newInsights: newInsights.map((i) => ({ title: i.title })),
            newCreativeIdeas: newCreativeIdeas.map((i) => ({
              title: i.title,
            })),
            totalInsights: allInsights.length,
            totalCreativeIdeas: allCreativeIdeas.length,
          },
        } satisfies IterationIdeasEvent);

        const bestIdea =
          newCreativeIdeas[0] ??
          allCreativeIdeas[0] ??
          newInsights[0] ??
          allInsights[0];

        const previousScore = currentScore;
        let newScore = previousScore;
        let newGaps = currentGaps;

        let roundDemoAvailable = false;
        if (bestIdea) {
          subject.next({
            type: "iteration.demo",
            data: { round, status: "generating" },
          } satisfies IterationDemoEvent);

          const newDemo = await this.evaluator.createAndPollDemo(
            userId,
            projectId,
            bestIdea.id,
          );
          if (newDemo) {
            roundDemoAvailable = true;
            subject.next({
              type: "iteration.demo",
              data: { round, status: "completed" },
            } satisfies IterationDemoEvent);

            const updatedScore = await this.evaluator.evaluateDemo(
              newDemo.htmlContent,
              {
                insights: allInsights.map((i) => i.title),
                creativeIdeas: allCreativeIdeas.map((i) => i.title),
              },
              topicType,
              dto.query,
            );

            newScore = updatedScore.composite;
            newGaps = updatedScore.gaps;
          }
        }

        if (!roundDemoAvailable) {
          const fallback = estimateReportQuality(
            followUp.report,
            allInsights.length,
            allCreativeIdeas.length,
            currentReport,
          );
          newScore = fallback.score;
          newGaps = fallback.gaps;
        }

        newScore = Math.max(newScore, currentScore);

        scores.push(newScore);
        currentScore = newScore;
        currentGaps = newGaps;
        currentReport = followUp.report;
        currentSessionId = followUp.sessionId;

        // Merge intermediate session back into original session
        try {
          let intermediateDiscussion: unknown[] = [];
          if (currentSessionId !== originalSessionId) {
            const intermediateSession =
              await this.prisma.deepResearchSession.findUnique({
                where: { id: currentSessionId },
                select: { discussion: true },
              });
            if (
              intermediateSession?.discussion &&
              Array.isArray(intermediateSession.discussion)
            ) {
              intermediateDiscussion =
                intermediateSession.discussion as unknown[];
            }
          }

          if (intermediateDiscussion.length > 0) {
            const newDiscussionJson = JSON.stringify(intermediateDiscussion);
            await this.prisma.$executeRaw`
              UPDATE "deep_research_sessions"
              SET "discussion" = array_cat(
                    COALESCE("discussion", ARRAY[]::jsonb[]),
                    (SELECT array_agg(elem) FROM jsonb_array_elements(${newDiscussionJson}::jsonb) AS elem)
                  ),
                  "report" = ${JSON.stringify(followUp.report)}::jsonb,
                  "status" = 'SEARCHING',
                  "updated_at" = NOW()
              WHERE "id" = ${originalSessionId}
            `;
          } else {
            await this.prisma.deepResearchSession.update({
              where: { id: originalSessionId },
              data: {
                report: followUp.report as unknown as Record<
                  string,
                  unknown
                > & {
                  toJSON(): unknown;
                },
                status: "SEARCHING",
              },
            });
          }

          if (currentSessionId !== originalSessionId) {
            await this.prisma.researchIdea.updateMany({
              where: { sessionId: currentSessionId },
              data: { sessionId: originalSessionId },
            });

            await this.prisma.deepResearchSession
              .delete({
                where: { id: currentSessionId },
              })
              .catch(() => {
                /* ignore if already deleted */
              });
          }
        } catch (err) {
          this.logger.warn(
            `Failed to sync report to original session: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        roundSnapshots.push({
          insights: allInsights.length,
          creativeIdeas: allCreativeIdeas.length,
          gapCount: newGaps.dataGaps.length + newGaps.ideaGaps.length,
          keyChange: `Iteration ${round}`,
        });

        const nextExitContext: ExitContext = {
          iteration: round + 1,
          depth,
          scores,
          informationGain,
          gaps: currentGaps,
        };
        const nextExitDecision = this.exitDecisionService?.decide(
          nextExitContext,
        ) ?? {
          exit: round + 1 >= maxIterations,
        };

        const iterationMarkdown =
          this.iterationRecordService?.generateIterationRecord({
            round,
            previousScore,
            gaps: currentGaps,
            researchActions: {
              queries: [followUpQuery],
              newSources,
              informationGain,
            },
            newInsights: newInsights.map((i) => i.title),
            newCreativeIdeas: newCreativeIdeas.map((i) => i.title),
            ideaPoolTotal: {
              insights: allInsights.length,
              creativeIdeas: allCreativeIdeas.length,
            },
            adoptedInDemo: bestIdea ? [bestIdea.title] : [],
            demoChanges: newGaps.dataGaps
              .slice(0, 3)
              .map((g) => `Addressed gap: ${g}`),
            newScore,
            remainingGaps: newGaps,
            exitDecision: nextExitDecision,
          });
        if (iterationMarkdown) {
          iterationRecords.push(iterationMarkdown);
        }

        subject.next({
          type: "iteration.eval",
          data: {
            round,
            score: newScore * 100,
            previousScore: previousScore * 100,
            gaps: newGaps,
            record: iterationMarkdown ?? undefined,
          },
        } satisfies IterationEvalEvent);

        const roundSnapshot: IterationSnapshot = {
          round,
          score: newScore * 100,
          previousScore: previousScore * 100,
          gaps: newGaps,
          research: {
            queries: [followUpQuery],
            newSources,
            informationGain,
          },
          ideas: {
            newInsights: newInsights.map((i) => ({ title: i.title })),
            newCreativeIdeas: newCreativeIdeas.map((i) => ({
              title: i.title,
            })),
            totalInsights: allInsights.length,
            totalCreativeIdeas: allCreativeIdeas.length,
          },
          demo: bestIdea ? { status: "completed" } : undefined,
          timestamp: new Date().toISOString(),
        };
        await this.saveIterationSnapshot(originalSessionId, roundSnapshot);

        await this.saveCheckpoint(originalSessionId, {
          completedRounds: round,
          lastSnapshot: roundSnapshot,
          accumulatedIdeas: [
            ...allInsights.map((i) => ({
              title: i.title,
              description: i.description || undefined,
            })),
            ...allCreativeIdeas.map((i) => ({
              title: i.title,
              description: i.description || undefined,
            })),
          ],
          lastReportContent: currentReport.executiveSummary?.slice(0, 500),
          savedAt: new Date().toISOString(),
        });

        subject.next({
          type: "iteration.awaiting_feedback" as const,
          data: {
            round,
            score: newScore * 100,
            gaps: newGaps,
            timeoutMs: FEEDBACK_TIMEOUT_MS,
          },
        });

        const userFeedback = await this.feedbackService.waitForFeedback(
          projectId,
          FEEDBACK_TIMEOUT_MS,
        );
        if (userFeedback) {
          this.logger.log(
            `[Iterative] User feedback for round ${round}: "${userFeedback.slice(0, 100)}"`,
          );
          userFeedbackHistory.push(userFeedback);
          latestFeedback = userFeedback;
        }
      } catch (roundErr: unknown) {
        const message =
          roundErr instanceof Error ? roundErr.message : String(roundErr);
        this.logger.error(
          `[Iterative] Round ${round} failed, exiting loop gracefully: ${message}`,
        );

        exitDecision = { exit: true, reason: "round_error" };
        roundErrored = true;

        subject.next({
          type: "iteration.eval",
          data: {
            round,
            score: currentScore * 100,
            previousScore: currentScore * 100,
            gaps: currentGaps,
          },
        } satisfies IterationEvalEvent);
      }

      if (roundErrored) {
        break;
      }
    }

    // ---- Summary ------------------------------------------------------------
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const totalIterations = scores.length - 1;

    const summaryRows = scores.map((s, idx) => {
      const snapshot = roundSnapshots[idx];
      return {
        round: idx,
        score: s * 100,
        delta: idx === 0 ? 0 : (s - scores[idx - 1]) * 100,
        insights: snapshot?.insights ?? allInsights.length,
        creativeIdeas: snapshot?.creativeIdeas ?? allCreativeIdeas.length,
        gaps: snapshot?.gapCount ?? 0,
        keyChange: snapshot?.keyChange ?? `Round ${idx}`,
      };
    });

    const summaryMarkdown = this.iterationRecordService?.generateSummaryRecord({
      exitReason: exitDecision.reason ?? "completed",
      totalIterations,
      finalScore: currentScore * 100,
      duration: durationSec,
      creditsConsumed: 0,
      iterations: summaryRows,
      finalInsights: allInsights.map((i) => i.title),
      finalCreativeIdeas: allCreativeIdeas.map((i) => i.title),
      learnings: (exitDecision.nextResearchFocus ?? []).slice(0, 5),
    });
    if (summaryMarkdown) {
      iterationRecords.push(summaryMarkdown);
    }

    await this.saveIterationMetadata(originalSessionId, iterationRecords);
    await this.saveIterationMeta(originalSessionId, {
      exitReason: exitDecision.reason ?? "completed",
      finalScore: currentScore * 100,
      totalIterations,
      maxIterations,
    });

    await this.clearCheckpoint(originalSessionId);

    try {
      await this.prisma.deepResearchSession.update({
        where: { id: originalSessionId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to mark session as COMPLETED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.memoryService) {
      void this.memoryService
        .saveSessionMeta({
          sessionId: originalSessionId,
          userId,
          topicType,
          topicKeywords: extractKeywords(dto.query),
          searchStats: {
            totalSources: currentReport.metadata.totalSources,
            uniqueDomains: 0,
            languageDistribution: {},
            avgRelevanceScore: 0,
          },
          qualityMetrics: {
            coverageRate: informationGain,
            sourcesDiversity: 0,
            informationGain,
            finalDemoScore: currentScore,
          },
          strategyUsed: [],
          strategyEffect: [],
          iterationCount: totalIterations,
          exitReason: exitDecision.reason,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to save session meta: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    this.feedbackService.clearPendingFeedback(projectId);

    subject.next({
      type: "iteration.exit",
      data: {
        reason: exitDecision.reason ?? "completed",
        finalScore: currentScore * 100,
        totalIterations,
        sessionId: originalSessionId,
      },
    } satisfies IterationExitEvent);

    subject.complete();
  }

  // ---------------------------------------------------------------------------
  // Private: inner research runner
  // ---------------------------------------------------------------------------

  private runInnerResearch(
    projectId: string,
    dto: {
      query: string;
      options?: StartIterativeResearchDto["options"];
      isFollowUp?: boolean;
      previousContext?: StartIterativeResearchDto["previousContext"];
    },
    subject: Subject<DeepResearchSSEEvent | IterationSSEEvent>,
  ): Promise<RunInnerResult> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const obs = this.orchestrator.startResearch(projectId, {
        query: dto.query,
        mode: "iterative_internal",
        options: dto.options,
        isFollowUp: dto.isFollowUp,
        previousContext: dto.previousContext,
      });

      obs.subscribe({
        next: (event) => {
          if (event.type === "interaction.complete") {
            resolved = true;
            const data = (
              event as {
                type: "interaction.complete";
                data: {
                  sessionId: string;
                  report: DeepResearchReport;
                  status: string;
                };
              }
            ).data;
            resolve({ sessionId: data.sessionId, report: data.report });
          } else {
            subject.next(event);
          }
        },
        error: (err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        },
        complete: () => {
          if (!resolved) {
            reject(
              new Error(
                "Inner research Observable completed without emitting interaction.complete",
              ),
            );
          }
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private: checkpoint persistence
  // ---------------------------------------------------------------------------

  private async saveCheckpoint(
    sessionId: string,
    checkpoint: ResearchCheckpoint,
  ): Promise<void> {
    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      const existingDirections =
        session?.directions && typeof session.directions === "object"
          ? (session.directions as Prisma.JsonObject)
          : ({} as Prisma.JsonObject);

      await this.prisma.deepResearchSession.update({
        where: { id: sessionId },
        data: {
          directions: {
            ...existingDirections,
            checkpoint: checkpoint as unknown as Prisma.JsonObject,
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to save checkpoint for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadCheckpoint(
    sessionId: string,
  ): Promise<ResearchCheckpoint | null> {
    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      if (!session?.directions || typeof session.directions !== "object") {
        return null;
      }

      const directions = session.directions as Record<string, unknown>;
      const raw = directions.checkpoint;

      if (!raw || typeof raw !== "object") {
        return null;
      }

      const candidate = raw as Record<string, unknown>;

      if (
        typeof candidate.completedRounds !== "number" ||
        !candidate.lastSnapshot ||
        typeof candidate.savedAt !== "string" ||
        !Array.isArray(candidate.accumulatedIdeas)
      ) {
        this.logger.warn(
          `Checkpoint for session ${sessionId} has unexpected shape, ignoring`,
        );
        return null;
      }

      return candidate as unknown as ResearchCheckpoint;
    } catch (err) {
      this.logger.warn(
        `Failed to load checkpoint for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async clearCheckpoint(sessionId: string): Promise<void> {
    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      if (!session?.directions || typeof session.directions !== "object") {
        return;
      }

      const directions = { ...(session.directions as Prisma.JsonObject) };
      delete directions.checkpoint;

      await this.prisma.deepResearchSession.update({
        where: { id: sessionId },
        data: { directions },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to clear checkpoint for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: snapshot / metadata persistence
  // ---------------------------------------------------------------------------

  private async saveIterationMetadata(
    sessionId: string,
    records: string[],
  ): Promise<void> {
    if (records.length === 0) return;

    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      const existingDirections =
        session?.directions && typeof session.directions === "object"
          ? (session.directions as Record<string, unknown>)
          : {};

      await this.prisma.deepResearchSession.update({
        where: { id: sessionId },
        data: {
          directions: { ...existingDirections, iterationRecords: records },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to save iteration metadata for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async saveIterationSnapshot(
    sessionId: string,
    snapshot: IterationSnapshot,
    meta?: IterationMeta,
  ): Promise<void> {
    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      const existingDirections =
        session?.directions && typeof session.directions === "object"
          ? (session.directions as Record<string, unknown>)
          : {};

      const existingSnapshots = Array.isArray(
        existingDirections.iterationSnapshots,
      )
        ? (existingDirections.iterationSnapshots as IterationSnapshot[])
        : [];

      const idx = existingSnapshots.findIndex(
        (s) => s.round === snapshot.round,
      );
      if (idx >= 0) {
        existingSnapshots[idx] = snapshot;
      } else {
        existingSnapshots.push(snapshot);
      }

      const updateData: Record<string, unknown> = {
        ...existingDirections,
        iterationSnapshots: existingSnapshots,
      };
      if (meta) {
        updateData.iterationMeta = meta;
      }

      await this.prisma.deepResearchSession.update({
        where: { id: sessionId },
        data: {
          directions: updateData as unknown as Record<string, unknown> & {
            toJSON(): unknown;
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to save iteration snapshot for session ${sessionId} round ${snapshot.round}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async saveIterationMeta(
    sessionId: string,
    meta: IterationMeta,
  ): Promise<void> {
    try {
      const session = await this.prisma.deepResearchSession.findUnique({
        where: { id: sessionId },
        select: { directions: true },
      });

      const existingDirections =
        session?.directions && typeof session.directions === "object"
          ? (session.directions as Record<string, unknown>)
          : {};

      const mergedData = { ...existingDirections, iterationMeta: meta };
      await this.prisma.deepResearchSession.update({
        where: { id: sessionId },
        data: {
          directions: mergedData as unknown as Record<string, unknown> & {
            toJSON(): unknown;
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to save iteration meta for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
