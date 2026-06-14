/**
 * Unit tests for LayoutFixerSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LayoutFixerSkill } from "../layout-fixer.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-layout-fixer",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const SIMPLE_HTML = `<html><head></head><body><div class="slide-container" style="width:1280px;height:720px;"><p>Content</p></div></body></html>`;

describe("LayoutFixerSkill", () => {
  let skill: LayoutFixerSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: LayoutFixerSkill,
          useFactory: () => new LayoutFixerSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<LayoutFixerSkill>(LayoutFixerSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-layout-fixer");
    expect(skill.name).toBe("布局修复");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("5.0.0");
  });

  it("should return error when html is empty", async () => {
    const result = await skill.execute({ html: "" }, buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("should return error for whitespace-only html", async () => {
    const result = await skill.execute({ html: "   " }, buildSkillContext());
    expect(result.success).toBe(false);
  });

  it("should succeed for clean HTML with no issues", async () => {
    const result = await skill.execute(
      { html: SIMPLE_HTML },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.originalHtml).toBe(SIMPLE_HTML);
    expect(result.data!.stats.totalIssues).toBeGreaterThanOrEqual(0);
  });

  it("should detect overflow issues from long text", async () => {
    const longText = "a".repeat(350);
    const html = `<html><body><p>${longText}</p></body></html>`;

    const result = await skill.execute({ html }, buildSkillContext());

    expect(result.success).toBe(true);
    const overflowIssues = result.data!.issues.filter(
      (i) => i.type === "overflow",
    );
    expect(overflowIssues.length).toBeGreaterThan(0);
  });

  it("should detect overlap issues from many absolute positioned elements", async () => {
    const html = `<html><body>
      <div style="position: absolute; top:0;left:0;">1</div>
      <div style="position: absolute; top:10px;left:10px;">2</div>
      <div style="position: absolute; top:20px;left:20px;">3</div>
      <div style="position: absolute; top:30px;left:30px;">4</div>
    </body></html>`;

    const result = await skill.execute({ html }, buildSkillContext());

    expect(result.success).toBe(true);
    const overlapIssues = result.data!.issues.filter(
      (i) => i.type === "overlap",
    );
    expect(overlapIssues.length).toBeGreaterThan(0);
  });

  it("should use AI to generate fixes when issues are found", async () => {
    const fixesJson = JSON.stringify([
      {
        issueIndex: 0,
        fixType: "css",
        description: "Add overflow control",
        cssChanges: { overflow: "hidden" },
      },
    ]);
    mockFacade.chat.mockResolvedValue({ content: fixesJson, tokensUsed: 60 });

    const longText = "a".repeat(350);
    const html = `<html><body><p>${longText}</p></body></html>`;
    const result = await skill.execute({ html }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(mockFacade.chat).toHaveBeenCalled();
  });

  it("should use rule-based fixes when AI facade is not available", async () => {
    const skillWithoutFacade = new LayoutFixerSkill(undefined as any);

    const longText = "a".repeat(350);
    const html = `<html><body><p>${longText}</p></body></html>`;
    const result = await skillWithoutFacade.execute(
      { html },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // Rule-based fixes should still produce a result
    expect(result.data!.fixedHtml).toBeDefined();
  });

  it("should inject CSS into existing style tag", async () => {
    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify([
        {
          issueIndex: 0,
          fixType: "css",
          description: "Fix overflow",
          cssChanges: { overflow: "hidden" },
        },
      ]),
      tokensUsed: 50,
    });

    const longText = "a".repeat(350);
    const html = `<html><head><style>.container{color:red;}</style></head><body><p>${longText}</p></body></html>`;
    const result = await skill.execute({ html }, buildSkillContext());

    expect(result.success).toBe(true);
    // The fixed HTML should still contain a style tag
    expect(result.data!.fixedHtml).toContain("<style>");
  });

  it("should detect flexbox without alignment as alignment issue", async () => {
    const html = `<html><body><div style="display: flex;"><span>item</span></div></body></html>`;

    const result = await skill.execute({ html }, buildSkillContext());

    expect(result.success).toBe(true);
    const alignmentIssues = result.data!.issues.filter(
      (i) => i.type === "alignment",
    );
    expect(alignmentIssues.length).toBeGreaterThan(0);
  });

  it("should pass pageIndex to output", async () => {
    const result = await skill.execute(
      { html: SIMPLE_HTML, pageIndex: 3 },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.pageIndex).toBe(3);
  });

  it("should include metadata with duration", async () => {
    const result = await skill.execute(
      { html: SIMPLE_HTML },
      buildSkillContext("layout-exec-7"),
    );

    expect(result.metadata?.executionId).toBe("layout-exec-7");
    expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
  });
});
