/**
 * MissionTerminalOutcome / toTerminalOutcome —— C7/G9 契约测试:终态映射 + G6 不含 quality_rejected。
 */

import { MissionTerminalOutcome, toTerminalOutcome } from "../mission-state";

describe("MissionTerminalOutcome (C7/G9)", () => {
  it("terminal status → outcome 映射", () => {
    expect(toTerminalOutcome("completed")).toBe(MissionTerminalOutcome.success);
    expect(toTerminalOutcome("failed")).toBe(MissionTerminalOutcome.failure);
    expect(toTerminalOutcome("cancelled")).toBe(
      MissionTerminalOutcome.cancelled,
    );
  });

  it("★ G6:平台 outcome 只 3 个,不含 quality_rejected(业务态留 failureCode)", () => {
    const vals = Object.values(MissionTerminalOutcome);
    expect(vals.sort()).toEqual(["cancelled", "failure", "success"]);
    expect(vals).not.toContain("quality_rejected");
  });
});
