/**
 * W4 PR-3a verification: duty-loader successfully builds prompts from
 * each agent's SKILL.md, integrating frontmatter duties[] with body anchors.
 */
import {
  buildPromptFromDuty,
  clearDutyCache,
} from "../mission/services/duty-loader";

interface RoleDuty {
  agentDir: string;
  duty: string;
}

const ROLE_DUTIES: RoleDuty[] = [
  { agentDir: "leader", duty: "plan" },
  { agentDir: "leader", duty: "assess-transform" },
  { agentDir: "leader", duty: "foreword" },
  { agentDir: "leader", duty: "signoff" },
  { agentDir: "steward", duty: "budget-eval" },
  { agentDir: "platform-probe", duty: "probe-platform" },
  { agentDir: "content-transformer", duty: "transform-for-platform" },
  { agentDir: "cover-artist", duty: "craft-cover" },
  { agentDir: "composer", duty: "compose-body" },
  { agentDir: "polish-reviewer", duty: "polish-review" },
  { agentDir: "publish-executor", duty: "publish-to-platform" },
  { agentDir: "publish-verifier", duty: "verify-publish" },
];

describe("W4 PR-3a — duty-loader builds prompts from 9 agent SKILL.md", () => {
  beforeEach(() => {
    clearDutyCache();
  });

  describe.each(ROLE_DUTIES)("%s", ({ agentDir, duty }) => {
    it(`builds a non-empty prompt for "${agentDir}.${duty}"`, () => {
      const prompt = buildPromptFromDuty(agentDir, duty, {
        // Provide a handful of common vars that templates might reference;
        // missing vars just render as empty string per duty-loader semantics.
        title: "Test Title",
        topic: "Test Topic",
        platforms: ["WECHAT_MP"],
      });
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(200);
    });

    it(`prompt contains both soul and duty content for "${agentDir}.${duty}"`, () => {
      const prompt = buildPromptFromDuty(agentDir, duty, {});
      // Soul + duty separator is `\n\n---\n\n` per duty-loader
      expect(prompt).toContain("---");
    });
  });

  it("throws clear error for unknown duty name", () => {
    expect(() => buildPromptFromDuty("leader", "nonexistent-duty", {})).toThrow(
      /does not declare duty "nonexistent-duty"/,
    );
  });

  it("throws clear error for unknown agent dir", () => {
    expect(() => buildPromptFromDuty("nonexistent-agent", "x", {})).toThrow(
      /SKILL\.md not found/,
    );
  });
});
