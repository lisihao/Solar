import { Test, TestingModule } from "@nestjs/testing";
import { ContentComplianceCheck } from "../content-compliance-check";

describe("ContentComplianceCheck", () => {
  let check: ContentComplianceCheck;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentComplianceCheck],
    }).compile();
    check = module.get<ContentComplianceCheck>(ContentComplianceCheck);
  });

  it("should have correct id, name and enabled", () => {
    expect(check.id).toBe("content-compliance-check");
    expect(check.name).toBe("Content Compliance Check");
    expect(check.enabled).toBe(true);
  });

  it("should pass with no issues for clean output", async () => {
    const result = await check.check({
      content: "The capital of France is Paris.",
    });
    expect(result.passed).toBe(true);
    expect(result.guardrailId).toBe("content-compliance-check");
    expect(result.severity).toBe("info");
    expect(result.message).toContain("No compliance issues");
  });

  it("should warn for knowledge cutoff reference", async () => {
    const result = await check.check({
      content: "As of my knowledge cutoff, the latest data is from 2024.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("hallucination indicators");
    const meta = result.metadata as any;
    expect(meta.hallucinations).toContain("Knowledge Cutoff Reference");
  });

  it("should warn for training limitation mention", async () => {
    const result = await check.check({
      content: "My knowledge was cut off in early 2024.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("hallucination indicators");
  });

  it("should warn for access limitation", async () => {
    const result = await check.check({
      content: "I don't have access to real-time data.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("hallucination indicators");
  });

  it("should warn for real-time access limitation", async () => {
    const result = await check.check({
      content: "I do not have current information about this topic.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
  });

  it("should warn for high uncertainty language", async () => {
    const result = await check.check({
      content: "I think that might be correct.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("hallucination indicators");
    const meta = result.metadata as any;
    expect(meta.hallucinations).toContain("High Uncertainty");
  });

  it("should fail (error) for direct refusal", async () => {
    const result = await check.check({
      content: "I can't help with that request.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toContain("refusal patterns");
    const meta = result.metadata as any;
    expect(meta.refusals).toContain("Direct Refusal");
  });

  it("should fail (error) for apologetic refusal", async () => {
    const result = await check.check({
      content: "Sorry, but I can't provide that information.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
    const meta = result.metadata as any;
    expect(meta.refusals).toContain("Apologetic Refusal");
  });

  it("should fail (error) for policy violation", async () => {
    const result = await check.check({
      content: "This is against my policy to discuss.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
    const meta = result.metadata as any;
    expect(meta.refusals).toContain("Policy Violation");
  });

  it("should fail (error) for permission denial", async () => {
    const result = await check.check({
      content: "I'm not allowed to share this information.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
    const meta = result.metadata as any;
    expect(meta.refusals).toContain("Permission Denial");
  });

  it("should fail (error) when both refusal and hallucination detected", async () => {
    const result = await check.check({
      content: "As of my knowledge cutoff, I can't help with this request.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
    const meta = result.metadata as any;
    expect(meta.refusals.length).toBeGreaterThan(0);
    expect(meta.hallucinations.length).toBeGreaterThan(0);
  });

  it("should handle multiple hallucination patterns", async () => {
    const result = await check.check({
      content:
        "As of my knowledge cutoff I don't have access to current data, and I think that might be outdated.",
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("warning");
    const meta = result.metadata as any;
    expect(meta.hallucinations.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle case-insensitive matching", async () => {
    const result = await check.check({
      content: "I CANNOT HELP with this.",
    });
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("error");
  });
});
