/**
 * Playground postmortem patterns 注入测试 —— 验证业务 substring (chapter:revision)
 * 在 PLAYGROUND_POSTMORTEM_PATTERNS 注入后能被 base layer classifier 识别。
 *
 * base layer harness spec 用 generic 'revision:stuck' 测；
 * playground 业务 substring 'chapter:revision' 的测试在此（ai-app 侧）。
 */

import { PLAYGROUND_POSTMORTEM_PATTERNS } from "../playground-postmortem-patterns";
import { PostmortemClassifierService } from "@/modules/ai-harness/facade";

function makeEvent(type: string, ts = 0) {
  return { type, ts };
}

describe("PLAYGROUND_POSTMORTEM_PATTERNS injection", () => {
  let svc: PostmortemClassifierService;
  beforeEach(() => {
    svc = new PostmortemClassifierService();
  });

  it("chapter:revision 5 次（业务 substring）→ reviewer_loop", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent("chapter:revision", i),
    );
    const result = svc.classify(
      { status: "failed", events },
      PLAYGROUND_POSTMORTEM_PATTERNS,
    );
    expect(result.mode).toBe("reviewer_loop");
  });

  it("revision:stuck 5 次（generic substring）→ reviewer_loop", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent("revision:stuck", i),
    );
    const result = svc.classify(
      { status: "failed", events },
      PLAYGROUND_POSTMORTEM_PATTERNS,
    );
    expect(result.mode).toBe("reviewer_loop");
  });

  it("不传 patterns 用 generic defaults — chapter:revision 不命中", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent("chapter:revision", i),
    );
    const result = svc.classify({ status: "failed", events });
    expect(result.mode).toBe("unknown");
  });
});
