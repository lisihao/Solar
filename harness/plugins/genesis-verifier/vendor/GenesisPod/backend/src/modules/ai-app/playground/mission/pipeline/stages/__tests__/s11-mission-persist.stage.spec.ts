import { runPersistStage } from "../s11-mission-persist.stage";
import type { MissionDeps } from "../../../context/mission-deps";

function makePool(tokensUsed = 10000, costUsd = 0.5) {
  return {
    snapshot: jest
      .fn()
      .mockReturnValue({ poolTokensUsed: tokensUsed, poolCostUsd: costUsd }),
  };
}

function makeDeps(overrides: Partial<MissionDeps> = {}): MissionDeps {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
    log: {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    },
    lifecycle: jest.fn().mockResolvedValue(undefined),
    store: {
      // ★ C0/G1: applyTerminalIfRunning 替代 markCompleted / markFailed（条件写，首写赢）
      applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
    },
    // ★ C0/G1: s11 终态写经 finalize 单入口；mock 复刻真实语义——委托 arbiter
    //   (=deps.store) 的 applyTerminalIfRunning，故既有 applyTerminalIfRunning 断言仍成立。
    lifecycleManager: {
      finalize: jest.fn(
        async (a: {
          missionId: string;
          intent: unknown;
          arbiter: {
            applyTerminalIfRunning: (
              id: string,
              intent: unknown,
            ) => Promise<boolean>;
          };
          onWon?: () => Promise<void>;
        }) => {
          const won = await a.arbiter.applyTerminalIfRunning(
            a.missionId,
            a.intent,
          );
          if (won && a.onWon) {
            try {
              await a.onWon();
            } catch {
              // swallow（与真实 finalize 一致）
            }
          }
          return { won };
        },
      ),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

const BASE_RESULT = {
  report: { title: "AI Report", summary: "AI summary" },
  reportArtifact: {
    metadata: { topic: "AI Report" },
    quickView: { executiveSummary: { markdown: "Executive summary" } },
  },
  reviewScore: 82,
  trajectoryStored: 42,
  themeSummary: "AI is changing everything",
  dimensions: [{ id: "d1", name: "Market" }],
  verdicts: [{ score: 82 }],
  userProfile: { tier: "pro" },
  reconciliationReport: null,
  leaderSignOff: {
    leaderOverallScore: 82,
    leaderVerdict: "good" as const,
    signed: true,
  },
};

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    missionId: "m11",
    userId: "u1",
    t0: Date.now() - 5000,
    result: BASE_RESULT,
    pool: makePool(),
    ...overrides,
  };
}

/**
 * Helper to extract the intent passed to applyTerminalIfRunning.
 */
function getApplyIntent(deps: MissionDeps, callIndex = 0) {
  return (deps.store.applyTerminalIfRunning as jest.Mock).mock.calls[
    callIndex
  ][1] as {
    status: string;
    extra: { kind: string; detail?: Record<string, unknown>; userId?: string };
  };
}

describe("runPersistStage (S11)", () => {
  it("signed=true → calls applyTerminalIfRunning with kind=completed", async () => {
    const deps = makeDeps();
    await runPersistStage(makeArgs(), deps);
    expect(deps.store.applyTerminalIfRunning).toHaveBeenCalled();
    const intent = getApplyIntent(deps);
    expect(intent.status).toBe("completed");
    expect(intent.extra.kind).toBe("completed");
  });

  it("signed=false → calls applyTerminalIfRunning with kind=failed and refusal message", async () => {
    const deps = makeDeps();
    const result = {
      ...BASE_RESULT,
      leaderSignOff: {
        leaderOverallScore: 35,
        leaderVerdict: "failed" as const,
        signed: false,
        refusalReason: "Coverage too low",
      },
    };
    await runPersistStage(makeArgs({ result }), deps);
    const intent = getApplyIntent(deps);
    expect(intent.status).toBe("failed");
    expect(intent.extra.kind).toBe("failed");
    expect(intent.extra.detail?.errorMessage).toContain("Coverage too low");
  });

  it("no leaderSignOff → calls applyTerminalIfRunning with kind=failed (leader_signoff_missing)", async () => {
    const deps = makeDeps();
    const result = { ...BASE_RESULT, leaderSignOff: undefined };
    await runPersistStage(makeArgs({ result }), deps);
    const intent = getApplyIntent(deps);
    expect(intent.status).toBe("failed");
    expect(intent.extra.kind).toBe("failed");
    expect(intent.extra.detail?.errorMessage).toContain(
      "leader_signoff_missing",
    );
  });

  it("completed intent includes finalScore and tokensUsed", async () => {
    const deps = makeDeps();
    await runPersistStage(
      makeArgs({
        pool: makePool(15000, 0.8),
      }),
      deps,
    );
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.finalScore).toBe(82);
    expect(intent.extra.detail?.tokensUsed).toBe(15000);
    expect(intent.extra.detail?.costUsd).toBe(0.8);
  });

  it("reportArtifact v2 → reportArtifactVersion=2 in completed intent", async () => {
    const deps = makeDeps();
    await runPersistStage(makeArgs(), deps);
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.reportArtifactVersion).toBe(2);
  });

  it("no reportArtifact → reportArtifactVersion=1, uses v1 report", async () => {
    const deps = makeDeps();
    const result = { ...BASE_RESULT, reportArtifact: undefined };
    await runPersistStage(makeArgs({ result }), deps);
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.reportArtifactVersion).toBe(1);
  });

  it("elapsedWallTimeMs = now - t0 approximately", async () => {
    const deps = makeDeps();
    const t0 = Date.now() - 10000;
    await runPersistStage(makeArgs({ t0 }), deps);
    const intent = getApplyIntent(deps);
    const elapsed = intent.extra.detail?.elapsedWallTimeMs as number;
    expect(elapsed).toBeGreaterThan(9000);
    expect(elapsed).toBeLessThan(20000);
  });

  it("trajectoryStored included in completed intent", async () => {
    const deps = makeDeps();
    await runPersistStage(makeArgs(), deps);
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.trajectoryStored).toBe(42);
  });

  it("leaderSignOff data passed in completed intent", async () => {
    const deps = makeDeps();
    await runPersistStage(makeArgs(), deps);
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.leaderOverallScore).toBe(82);
    expect(intent.extra.detail?.leaderSigned).toBe(true);
    expect(intent.extra.detail?.leaderVerdict).toBe("good");
  });

  it("failed intent includes leaderOverallScore and leaderVerdict when signed=false", async () => {
    const deps = makeDeps();
    const result = {
      ...BASE_RESULT,
      leaderSignOff: {
        leaderOverallScore: 45,
        leaderVerdict: "failed" as const,
        signed: false,
        refusalReason: "Insufficient coverage",
      },
    };
    await runPersistStage(makeArgs({ result }), deps);
    const intent = getApplyIntent(deps);
    expect(intent.extra.detail?.leaderOverallScore).toBe(45);
    expect(intent.extra.detail?.leaderSigned).toBe(false);
    expect(intent.extra.detail?.leaderVerdict).toBe("failed");
  });

  it("missionId is passed as first arg to applyTerminalIfRunning", async () => {
    const deps = makeDeps();
    await runPersistStage(makeArgs({ missionId: "mission-42" }), deps);
    expect(
      (deps.store.applyTerminalIfRunning as jest.Mock).mock.calls[0][0],
    ).toBe("mission-42");
  });

  it("persist failure → logs error, emits persist-failed, rethrows", async () => {
    const deps = makeDeps();
    (deps.store.applyTerminalIfRunning as jest.Mock).mockRejectedValue(
      new Error("DB write failed"),
    );
    await expect(runPersistStage(makeArgs(), deps)).rejects.toThrow(
      "DB write failed",
    );
    expect(deps.log.error as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("persist failed"),
    );
    const persistFailedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:persist-failed",
    );
    expect(persistFailedCall).toBeDefined();
  });

  it("persist failure with non-Error thrown → String(err) used in log", async () => {
    const deps = makeDeps();
    (deps.store.applyTerminalIfRunning as jest.Mock).mockRejectedValue(
      "string error",
    );
    await expect(runPersistStage(makeArgs(), deps)).rejects.toBe(
      "string error",
    );
    expect(deps.log.error as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("persist failed"),
    );
  });

  describe("chapter content guard", () => {
    function makeArtifactWithSections(
      sectionLengths: number[],
    ): typeof BASE_RESULT.reportArtifact & {
      sections: Array<{
        title?: string;
        startOffset: number;
        endOffset: number;
      }>;
      content: { fullMarkdown: string };
    } {
      const sections: Array<{
        title?: string;
        startOffset: number;
        endOffset: number;
      }> = [];
      const parts: string[] = [];
      let offset = 0;

      for (const [index, len] of sectionLengths.entries()) {
        const title = `Section ${index + 1}`;
        const sectionText = `## ${title}\n\n${"x".repeat(len)}`;
        sections.push({
          title,
          startOffset: offset,
          endOffset: offset + sectionText.length,
        });
        parts.push(sectionText);
        offset += sectionText.length + 2;
      }

      const fullMarkdown = parts.join("\n\n");
      return {
        ...BASE_RESULT.reportArtifact,
        sections,
        content: { fullMarkdown },
      };
    }

    it("all sections >= 500 chars → applyTerminalIfRunning with kind=completed", async () => {
      const deps = makeDeps();
      const reportArtifact = makeArtifactWithSections([600, 600, 600, 600]);
      await runPersistStage(
        makeArgs({
          result: { ...BASE_RESULT, reportArtifact },
        }),
        deps,
      );
      const intent = getApplyIntent(deps);
      expect(intent.extra.kind).toBe("completed");
    });

    it("< 50% sections have content → applyTerminalIfRunning with kind=failed (chapter_content_below_threshold)", async () => {
      const deps = makeDeps();
      const reportArtifact = makeArtifactWithSections([600, 100, 100, 100]);
      await runPersistStage(
        makeArgs({
          result: { ...BASE_RESULT, reportArtifact },
        }),
        deps,
      );
      const intent = getApplyIntent(deps);
      expect(intent.extra.kind).toBe("failed");
      expect(intent.extra.detail?.errorMessage).toContain(
        "chapter_content_below_threshold",
      );
    });

    it("0 sections (no-chapter mode) → skips guard, applyTerminalIfRunning with kind=completed", async () => {
      const deps = makeDeps();
      const reportArtifact = {
        ...BASE_RESULT.reportArtifact,
        sections: [] as Array<{
          title?: string;
          startOffset: number;
          endOffset: number;
        }>,
        content: { fullMarkdown: "" },
      };
      await runPersistStage(
        makeArgs({
          result: { ...BASE_RESULT, reportArtifact },
        }),
        deps,
      );
      const intent = getApplyIntent(deps);
      expect(intent.extra.kind).toBe("completed");
    });

    it("coverage exactly 50% → applyTerminalIfRunning with kind=completed (boundary: >= MIN_COVERAGE passes)", async () => {
      const deps = makeDeps();
      const reportArtifact = makeArtifactWithSections([600, 100]);
      await runPersistStage(
        makeArgs({
          result: { ...BASE_RESULT, reportArtifact },
        }),
        deps,
      );
      const intent = getApplyIntent(deps);
      expect(intent.extra.kind).toBe("completed");
    });

    it("heading-only chapters fail even if the raw span is long", async () => {
      const deps = makeDeps();
      const fullMarkdown =
        "## Section 1\n\n" +
        "x".repeat(700) +
        "\n\n## Section 2\n\n### Outline only\n\n- bullet a\n- bullet b\n";
      const secondSectionStart = fullMarkdown.indexOf("## Section 2");
      const reportArtifact = {
        ...BASE_RESULT.reportArtifact,
        sections: [
          {
            title: "Section 1",
            startOffset: 0,
            endOffset: secondSectionStart,
          },
          {
            title: "Section 2",
            startOffset: secondSectionStart,
            endOffset: fullMarkdown.length,
          },
        ],
        content: { fullMarkdown },
      };
      await runPersistStage(
        makeArgs({
          result: { ...BASE_RESULT, reportArtifact },
        }),
        deps,
      );
      const intent = getApplyIntent(deps);
      expect(intent.extra.kind).toBe("failed");
      expect(intent.extra.detail?.errorMessage).toContain(
        "chapter_content_incomplete",
      );
    });
  });
});
