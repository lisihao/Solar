/**
 * MissionFailure —— C2/G3 契约测试：category 投影穷尽 + abort→failure 映射穷尽 + 不变量。
 */

import {
  MissionFailureCode,
  FailureCategory,
  codeToCategory,
  buildMissionFailure,
  mapAbortReasonToFailureCode,
  mapAgentFailureCode,
} from "../mission-failure";
import { MissionAbortReason } from "../../abort-registry";

describe("MissionFailure (C2/G3)", () => {
  it("codeToCategory 对每个 MissionFailureCode 都有映射(穷尽,无落 unknown 漏网)", () => {
    for (const code of Object.values(MissionFailureCode)) {
      const cat = codeToCategory(code);
      expect(Object.values(FailureCategory)).toContain(cat);
      // 只有 unknown code 才允许映射到 unknown category
      if (code !== MissionFailureCode.unknown) {
        expect(cat).not.toBe(FailureCategory.unknown);
      }
    }
  });

  it("buildMissionFailure 的 category 永远 === codeToCategory(code)（投影不变量）", () => {
    for (const code of Object.values(MissionFailureCode)) {
      const f = buildMissionFailure(code, "msg", "runtime");
      expect(f.category).toBe(codeToCategory(code));
      expect(f.code).toBe(code);
      expect(f.message).toBe("msg");
    }
  });

  it("mapAbortReasonToFailureCode 对每个 MissionAbortReason 都有映射(穷尽)", () => {
    for (const reason of Object.values(MissionAbortReason)) {
      const code = mapAbortReasonToFailureCode(reason);
      expect(Object.values(MissionFailureCode)).toContain(code);
      // abort 一定不是 unknown（每个 reason 都有明确归属）
      expect(code).not.toBe(MissionFailureCode.unknown);
    }
  });

  it("关键 abort→failure 映射语义正确（budget/cancel/walltime/row-missing）", () => {
    expect(
      mapAbortReasonToFailureCode(MissionAbortReason.budget_exhausted),
    ).toBe(MissionFailureCode.budget_exhausted);
    expect(mapAbortReasonToFailureCode(MissionAbortReason.user_cancelled)).toBe(
      MissionFailureCode.user_cancelled,
    );
    expect(
      mapAbortReasonToFailureCode(
        MissionAbortReason.mission_wall_time_exceeded,
      ),
    ).toBe(MissionFailureCode.wall_time_exceeded);
    expect(
      mapAbortReasonToFailureCode(MissionAbortReason.mission_row_missing),
    ).toBe(MissionFailureCode.mission_row_missing);
  });

  it("mapAgentFailureCode 已知 agent code 正确映射 + 未知降级 unknown", () => {
    expect(mapAgentFailureCode("LOOP_BUDGET_EXHAUSTED")).toBe(
      MissionFailureCode.budget_exhausted,
    );
    expect(mapAgentFailureCode("PROVIDER_API_ERROR")).toBe(
      MissionFailureCode.provider_error,
    );
    expect(mapAgentFailureCode("RUNNER_WALL_TIME_EXCEEDED")).toBe(
      MissionFailureCode.wall_time_exceeded,
    );
    expect(mapAgentFailureCode("SOME_NEW_UNMAPPED_CODE")).toBe(
      MissionFailureCode.unknown,
    );
    expect(mapAgentFailureCode(undefined)).toBe(MissionFailureCode.unknown);
  });
});
