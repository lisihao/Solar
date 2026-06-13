/**
 * Stage S11 — Persist (final)
 *
 * Mission 成功路径的终态写库：把 reportArtifact + leaderSignOff + verdicts +
 * reconciliationReport 等一次性落到 agent_playground_missions 行，
 * 并按签字结果分流到 writeCompleted / writeFailed（经 arbiter 单入口）。
 *
 *   reads  ctx: missionId, t0, pool, runMissionBody 全部 result 字段
 *   writes ctx: (none — 终态)
 *   deps:       store.applyTerminalIfRunning（C0/G1 唯一终态写仲裁口）
 *
 * 分流逻辑：
 *   leaderSignOff.signed === false  → writeFailed（Lead 拒签 → "quality-failed"）
 *   leaderSignOff.signed === true   → writeCompleted + 写 leaderVerdict/Score
 *   未跑到 M7 / 无 signoff       → writeFailed（避免无负责人签收的假成功）
 *   chapter content guard 未过      → writeFailed（"chapter_content_below_threshold"）
 *
 * 注：异常路径（catch handler 里的 writeFailed）不在本 stage —— 它需要 errorMessage /
 *     failureCode 等异常元数据，归 runMission 入口的 try/catch 处理。
 */

import type { MissionDeps } from "../../context/mission-deps";
import { extractSubstantiveSectionText } from "../../artifacts/report-artifact-sections.util";
import type { MissionTerminalIntent } from "@/modules/ai-harness/facade";
import type { PlaygroundTerminalExtra } from "../../lifecycle/mission-store.service";

// ★ 假完成防御：chapter content guard 阈值常量
const MIN_CHAPTER_CHARS = 500; // 单章最小内容长度（字符数）
const MIN_COVERAGE = 0.5; // 至少 50% chapter 有内容才算完成
const MIN_NON_EMPTY_SECTION_CHARS = 40; // 所有正式章节都必须至少有可读正文

interface PersistInput {
  missionId: string;
  /** ★ P1-NEW-H (round 2): userId 必传 —— persist-failed 事件不能空 userId 路由 */
  userId: string;
  t0: number;
  result: {
    report?: unknown;
    reportArtifact?: {
      metadata: { topic?: string; modelTrail?: string[] };
      quickView?: { executiveSummary?: { markdown?: string } };
      /** 章节偏移索引，用于 chapter content guard */
      sections?: Array<{
        title?: string;
        startOffset: number;
        endOffset: number;
      }>;
      /** 报告全文 markdown，sections 通过 startOffset/endOffset slice 取章节内容 */
      content?: { fullMarkdown: string };
    };
    reviewScore?: number;
    trajectoryStored?: number;
    themeSummary?: string;
    dimensions?: unknown[];
    verdicts?: unknown;
    userProfile?: unknown;
    reconciliationReport?: unknown;
    leaderSignOff?: {
      leaderOverallScore: number;
      leaderVerdict: "excellent" | "good" | "acceptable" | "failed";
      signed: boolean;
      refusalReason?: string;
    };
  };
  pool: { snapshot(): { poolTokensUsed: number; poolCostUsd: number } };
}

export async function runPersistStage(
  args: PersistInput,
  deps: MissionDeps,
): Promise<void> {
  // ★ 2026-05-06 单轨化: stage:lifecycle 由 orchestrator 必发，stage 文件不再 emit
  await runPersistInner(args, deps);
}

async function runPersistInner(
  args: PersistInput,
  deps: MissionDeps,
): Promise<void> {
  const { missionId, userId, t0, result, pool } = args;
  const snap = pool.snapshot();
  // P0-5: 优先存 ReportArtifact v2，fallback 旧 ResearchReport v1
  const v2Title = result.reportArtifact?.metadata?.topic;
  const v2Summary =
    result.reportArtifact?.quickView?.executiveSummary?.markdown;
  const reportPayload = result.reportArtifact
    ? {
        ...(result.reportArtifact as Record<string, unknown>),
        title: v2Title,
        summary: v2Summary,
      }
    : (result.report as {
        title?: string;
        summary?: string;
      });

  // ★ P1-H (2026-04-29): persist DB 写入失败时，必须发事件让前端知道（否则前端永远 polling running）
  try {
    // ★ 假完成防御 (2026-04-30): 在终态写之前先校验 chapter content 覆盖率
    //   reportArtifact.sections + content.fullMarkdown 是章节内容的权威来源；
    //   leader signoff 只看打分不看字数，所以需要在 S11 独立守门。
    if (
      result.reportArtifact?.sections &&
      result.reportArtifact.sections.length > 0
    ) {
      const fullMarkdown = result.reportArtifact.content?.fullMarkdown ?? "";
      const sections = result.reportArtifact.sections;

      const substantiveSections = sections.filter(
        (section) => !isReferenceSection(section.title),
      );
      const sectionBodies = substantiveSections.map((section) =>
        extractSubstantiveSectionText(fullMarkdown, section),
      );
      const sectionLengths = sectionBodies.map((body) => body.length);
      const sectionsWithContent = sectionLengths.filter(
        (len) => len >= MIN_CHAPTER_CHARS,
      );
      const nonEmptySections = sectionLengths.filter(
        (len) => len >= MIN_NON_EMPTY_SECTION_CHARS,
      );
      const coverage =
        substantiveSections.length > 0
          ? sectionsWithContent.length / substantiveSections.length
          : 1;
      const totalChars = fullMarkdown.length;

      if (nonEmptySections.length < substantiveSections.length) {
        deps.log.warn(
          `[s11 ${missionId}] chapter content guard failed: non-empty=${nonEmptySections.length}/${substantiveSections.length} totalChars=${totalChars} → writeFailed instead of writeCompleted`,
        );
        // ★ C0/G1：经 arbiter 单入口写终态（条件写 WHERE status='running' 首写赢）
        const failIntent: MissionTerminalIntent<PlaygroundTerminalExtra> = {
          status: "failed",
          extra: {
            kind: "failed",
            detail: {
              errorMessage: `chapter_content_incomplete: nonEmpty=${nonEmptySections.length}/${substantiveSections.length} sections >= ${MIN_NON_EMPTY_SECTION_CHARS} chars, totalChars=${totalChars}`,
              tokensUsed: snap.poolTokensUsed,
              costUsd: snap.poolCostUsd,
              elapsedWallTimeMs: Date.now() - t0,
            },
          },
        };
        // ★ C0/G1：终态写经 finalize 单入口（arbiter=store 条件写首写赢），赢了才广播。
        await deps.lifecycleManager.finalize<PlaygroundTerminalExtra>({
          missionId,
          intent: failIntent,
          arbiter: deps.store,
          onWon: async () => {
            await deps
              .emit({
                type: "playground.mission:failed",
                missionId,
                userId,
                payload: {
                  reason: "chapter_content_incomplete",
                  nonEmptySections: nonEmptySections.length,
                  chapters: substantiveSections.length,
                  totalChars,
                },
              })
              // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
              .catch((emitErr: unknown) => {
                deps.log.warn(
                  `[s11 ${missionId}] emit mission:failed (chapter_content_incomplete) failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
                );
              });
          },
        });
        return;
      }

      if (coverage < MIN_COVERAGE) {
        deps.log.warn(
          `[s11 ${missionId}] chapter content guard failed: coverage=${(coverage * 100).toFixed(1)}% (${sectionsWithContent.length}/${substantiveSections.length}) totalChars=${totalChars} → writeFailed instead of writeCompleted`,
        );
        const failIntent: MissionTerminalIntent<PlaygroundTerminalExtra> = {
          status: "failed",
          extra: {
            kind: "failed",
            detail: {
              errorMessage: `chapter_content_below_threshold: coverage=${(coverage * 100).toFixed(1)}% (${sectionsWithContent.length}/${substantiveSections.length} sections >= ${MIN_CHAPTER_CHARS} chars), totalChars=${totalChars}`,
              tokensUsed: snap.poolTokensUsed,
              costUsd: snap.poolCostUsd,
              elapsedWallTimeMs: Date.now() - t0,
            },
          },
        };
        // ★ C0/G1：终态写经 finalize 单入口（arbiter=store 条件写首写赢），赢了才广播。
        await deps.lifecycleManager.finalize<PlaygroundTerminalExtra>({
          missionId,
          intent: failIntent,
          arbiter: deps.store,
          onWon: async () => {
            await deps
              .emit({
                type: "playground.mission:failed",
                missionId,
                userId,
                payload: {
                  reason: "chapter_content_below_threshold",
                  chapterCoverage: coverage,
                  totalChars,
                },
              })
              // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
              .catch((emitErr: unknown) => {
                deps.log.warn(
                  `[s11 ${missionId}] emit mission:failed (chapter_content_below_threshold) failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
                );
              });
          },
        });
        return;
      }
    }

    if (!result.leaderSignOff) {
      // ★ P0-10 (audit 2026-05-06): leader sign-off 缺失（mission 中途异常没走完）
      //   不该误标为 quality-failed（那是"leader 已拒签"的语义）。删 leaderSigned/
      //   leaderVerdict 字段让 store 走 status='failed' 路径。
      const failIntent: MissionTerminalIntent<PlaygroundTerminalExtra> = {
        status: "failed",
        extra: {
          kind: "failed",
          detail: {
            errorMessage:
              "leader_signoff_missing: report reached persist without final Leader signoff",
            tokensUsed: snap.poolTokensUsed,
            costUsd: snap.poolCostUsd,
            elapsedWallTimeMs: Date.now() - t0,
            trajectoryStored: result.trajectoryStored,
            themeSummary: result.themeSummary,
            dimensions: result.dimensions as never,
            report: reportPayload as unknown as {
              title?: string;
              summary?: string;
            },
            reportArtifactVersion: result.reportArtifact ? 2 : 1,
            // ★ S4b/B-部分：userProfile 停写，不再传 result.userProfile
            reconciliationReport: (result.reconciliationReport ??
              null) as never,
            verdicts: result.verdicts as never,
          },
        },
      };
      // ★ C0/G1：终态写经 finalize 单入口（arbiter=store 条件写首写赢），赢了才广播。
      await deps.lifecycleManager.finalize<PlaygroundTerminalExtra>({
        missionId,
        intent: failIntent,
        arbiter: deps.store,
        onWon: async () => {
          await deps
            .emit({
              type: "playground.mission:failed",
              missionId,
              userId,
              payload: {
                reason: "leader_signoff_missing",
                elapsedWallTimeMs: Date.now() - t0,
              },
            })
            // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
            .catch((emitErr: unknown) => {
              deps.log.warn(
                `[s11 ${missionId}] emit mission:failed (leader_signoff_missing) failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
              );
            });
        },
      });
      return;
    }

    if (!result.leaderSignOff.signed) {
      const failIntent: MissionTerminalIntent<PlaygroundTerminalExtra> = {
        status: "failed",
        extra: {
          kind: "failed",
          detail: {
            elapsedWallTimeMs: Date.now() - t0,
            errorMessage: `Lead 拒绝签字: ${result.leaderSignOff.refusalReason ?? "未达 qualityBar / successCriteria 不全回答"}`,
            tokensUsed: snap.poolTokensUsed,
            costUsd: snap.poolCostUsd,
            trajectoryStored: result.trajectoryStored,
            themeSummary: result.themeSummary,
            dimensions: result.dimensions as never,
            report: reportPayload as unknown as {
              title?: string;
              summary?: string;
            },
            reportArtifactVersion: result.reportArtifact ? 2 : 1,
            // ★ S4b/B-部分：userProfile 停写，不再传 result.userProfile
            reconciliationReport: (result.reconciliationReport ??
              null) as never,
            verdicts: result.verdicts as never,
            leaderJournal: undefined,
            leaderOverallScore: result.leaderSignOff.leaderOverallScore,
            leaderSigned: false,
            leaderVerdict: result.leaderSignOff.leaderVerdict,
          },
        },
      };
      // ★ C0/G1：终态写经 finalize 单入口。Lead 拒签无广播（与原 markFailed 行为一致）。
      await deps.lifecycleManager.finalize<PlaygroundTerminalExtra>({
        missionId,
        intent: failIntent,
        arbiter: deps.store,
      });
    } else {
      const completedIntent: MissionTerminalIntent<PlaygroundTerminalExtra> = {
        status: "completed",
        extra: {
          kind: "completed",
          detail: {
            finalScore: result.reviewScore,
            tokensUsed: snap.poolTokensUsed,
            costUsd: snap.poolCostUsd,
            trajectoryStored: result.trajectoryStored,
            elapsedWallTimeMs: Date.now() - t0,
            themeSummary: result.themeSummary,
            dimensions: result.dimensions as never,
            report: reportPayload as unknown as {
              title?: string;
              summary?: string;
            },
            reportArtifactVersion: result.reportArtifact ? 2 : 1,
            // ★ S4b/B-部分：userProfile 停写，不再传 result.userProfile
            reconciliationReport: (result.reconciliationReport ??
              null) as never,
            verdicts: result.verdicts as never,
            leaderOverallScore: result.leaderSignOff?.leaderOverallScore,
            leaderSigned: result.leaderSignOff?.signed,
            leaderVerdict: result.leaderSignOff?.leaderVerdict,
          },
        },
      };
      // ★ C0/G1：唯一终态写入口（arbiter=store 条件写首写赢）。赢了才广播（防重复广播）。
      await deps.lifecycleManager.finalize<PlaygroundTerminalExtra>({
        missionId,
        intent: completedIntent,
        arbiter: deps.store,
        onWon: async () => {
          // ★ 2026-04-30: 真正的 mission:completed —— 在写库成功后 emit。
          //   之前 S8 提前 emit 导致前端"假成功"且 DB 行还是 running。
          await deps
            .emit({
              type: "playground.mission:completed",
              missionId,
              userId,
              payload: {
                reviewScore: result.reviewScore,
                costUsd: snap.poolCostUsd,
                tokensUsed: snap.poolTokensUsed,
                trajectoryStored: result.trajectoryStored,
                elapsedWallTimeMs: Date.now() - t0,
                verifierVerdicts: result.verdicts,
                leaderSigned: result.leaderSignOff?.signed,
                leaderOverallScore: result.leaderSignOff?.leaderOverallScore,
                // 通用通知 adapter 所需业务细节（emit 侧注入；platform/harness 不感知业务路由）
                missionTitle: reportPayload?.title ?? result.themeSummary,
                appBasePath: "/agent-playground",
                relatedType: "playground-mission",
              },
            })
            // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
            .catch((emitErr: unknown) => {
              deps.log.warn(
                `[s11 ${missionId}] emit mission:completed failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
              );
            });
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error(`[s11 ${missionId}] persist failed: ${message}`);
    await deps
      .emit({
        type: "playground.mission:persist-failed",
        missionId,
        userId,
        payload: { message, wallTimeMs: Date.now() - t0 },
      })
      // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
      .catch((emitErr: unknown) => {
        deps.log.warn(
          `[s11 ${missionId}] emit mission:persist-failed itself failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
        );
      });
    throw err;
  }
}

function isReferenceSection(title?: string): boolean {
  const normalized = (title ?? "").trim().toLowerCase();
  return normalized === "参考文献" || normalized === "references";
}
