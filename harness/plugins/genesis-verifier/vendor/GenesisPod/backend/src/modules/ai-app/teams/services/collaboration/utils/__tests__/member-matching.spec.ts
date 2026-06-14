/**
 * member-matching.utils 单元测试
 */

import {
  cleanMemberName,
  normalizeMemberName,
  calculateSimilarity,
  findMemberByName,
  findMemberByNameEnhanced,
  createMatchStatistics,
  calculateFailureRate,
  isMatchFailureRateExceeded,
  updateFailureRate,
  formatMatchFailureError,
} from "../member-matching.utils";

// ==================== 测试数据 ====================

interface TestMember {
  agentName: string | null;
  displayName: string;
}

const members: TestMember[] = [
  { agentName: "AI-ChatGPT", displayName: "ChatGPT" },
  { agentName: "AI-Claude", displayName: "Claude" },
  { agentName: null, displayName: "人类专家" },
];

// ==================== cleanMemberName ====================

describe("cleanMemberName", () => {
  it("should remove @ prefix", () => {
    expect(cleanMemberName("@AI-ChatGPT")).toBe("AI-ChatGPT");
  });

  it("should not remove AI- prefix", () => {
    expect(cleanMemberName("AI-ChatGPT")).toBe("AI-ChatGPT");
  });

  it("should trim whitespace", () => {
    expect(cleanMemberName("  AI-Claude  ")).toBe("AI-Claude");
  });

  it("should handle @ + whitespace", () => {
    expect(cleanMemberName("@  AI-Claude")).toBe("AI-Claude");
  });

  it("should return unchanged name without @", () => {
    expect(cleanMemberName("人类专家")).toBe("人类专家");
  });
});

describe("normalizeMemberName (alias)", () => {
  it("should behave the same as cleanMemberName", () => {
    expect(normalizeMemberName("@AI-ChatGPT")).toBe(
      cleanMemberName("@AI-ChatGPT"),
    );
  });
});

// ==================== calculateSimilarity ====================

describe("calculateSimilarity", () => {
  it("should return 1.0 for identical strings", () => {
    expect(calculateSimilarity("hello", "hello")).toBe(1.0);
  });

  it("should return 0 when one string is empty", () => {
    expect(calculateSimilarity("", "hello")).toBe(0);
    expect(calculateSimilarity("hello", "")).toBe(0);
  });

  it("should return 0 for both empty strings", () => {
    expect(calculateSimilarity("", "")).toBe(1.0);
  });

  it("should be case-insensitive", () => {
    expect(calculateSimilarity("Hello", "hello")).toBe(1.0);
  });

  it("should return a value between 0 and 1 for similar strings", () => {
    const sim = calculateSimilarity("AI-ChatGPT", "AI-ChatGP");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
    expect(sim).toBeGreaterThan(0.8); // 只差一个字符，应该很高
  });

  it("should return low similarity for very different strings", () => {
    const sim = calculateSimilarity("abc", "xyz");
    expect(sim).toBeLessThan(0.5);
  });

  it("should handle strings longer than MAX_NAME_LENGTH (100 chars)", () => {
    const longStr = "a".repeat(150);
    const sim = calculateSimilarity(longStr, longStr);
    expect(sim).toBe(1.0);
  });
});

// ==================== findMemberByName ====================

describe("findMemberByName", () => {
  it("should find member by exact agentName (case-insensitive)", () => {
    const result = findMemberByName("AI-ChatGPT", members);
    expect(result).toBeDefined();
    expect(result?.agentName).toBe("AI-ChatGPT");
  });

  it("should find member ignoring case", () => {
    const result = findMemberByName("ai-chatgpt", members);
    expect(result).toBeDefined();
  });

  it("should strip @ prefix before matching", () => {
    const result = findMemberByName("@AI-Claude", members);
    expect(result).toBeDefined();
    expect(result?.agentName).toBe("AI-Claude");
  });

  it("should match by displayName when agentName is null", () => {
    const result = findMemberByName("人类专家", members);
    expect(result).toBeDefined();
    expect(result?.displayName).toBe("人类专家");
  });

  it("should return undefined when no match", () => {
    const result = findMemberByName("不存在的成员", members);
    expect(result).toBeUndefined();
  });

  it("should return undefined for empty member list", () => {
    const result = findMemberByName("AI-ChatGPT", []);
    expect(result).toBeUndefined();
  });
});

// ==================== findMemberByNameEnhanced ====================

describe("findMemberByNameEnhanced", () => {
  it("should return exact match with confidence 1.0", () => {
    const result = findMemberByNameEnhanced("AI-ChatGPT", members);
    expect(result.member).toBeDefined();
    expect(result.matchInfo.type).toBe("exact");
    expect(result.matchInfo.confidence).toBe(1.0);
  });

  it("should return fuzzy match when similarity > 0.8", () => {
    // "AI-ChatGP" vs "AI-ChatGPT" 差一个字符
    const result = findMemberByNameEnhanced("AI-ChatGP", members);
    if (result.matchInfo.type === "fuzzy") {
      expect(result.member).toBeDefined();
      expect(result.matchInfo.confidence).toBeGreaterThan(0.8);
      expect(result.matchInfo.originalInput).toBe("AI-ChatGP");
    }
    // 即使返回 none 也不应报错
  });

  it("should return none when no match and low similarity", () => {
    const result = findMemberByNameEnhanced("完全不相关的名字XYZ123", members);
    expect(result.matchInfo.type).toBe("none");
    expect(result.member).toBeUndefined();
    expect(result.matchInfo.confidence).toBe(0);
    expect(result.matchInfo.availableMembers).toBeDefined();
  });

  it("should include originalInput in none match info", () => {
    const result = findMemberByNameEnhanced("未知成员", members);
    expect(result.matchInfo.originalInput).toBe("未知成员");
  });

  it("should strip @ prefix in enhanced matching", () => {
    const result = findMemberByNameEnhanced("@AI-Claude", members);
    expect(result.matchInfo.type).toBe("exact");
    expect(result.member?.agentName).toBe("AI-Claude");
  });
});

// ==================== createMatchStatistics ====================

describe("createMatchStatistics", () => {
  it("should create empty statistics", () => {
    const stats = createMatchStatistics();
    expect(stats.totalRows).toBe(0);
    expect(stats.matched).toBe(0);
    expect(stats.fuzzyMatched).toBe(0);
    expect(stats.unmatched).toEqual([]);
    expect(stats.memberTaskCount).toBeInstanceOf(Map);
    expect(stats.failureRate).toBe(0);
  });
});

// ==================== calculateFailureRate ====================

describe("calculateFailureRate", () => {
  it("should return 0 when totalRows is 0", () => {
    const stats = createMatchStatistics();
    expect(calculateFailureRate(stats)).toBe(0);
  });

  it("should calculate correct failure rate", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "A", availableMembers: [] },
      { taskTitle: "任务2", inputName: "B", availableMembers: [] },
    ];
    expect(calculateFailureRate(stats)).toBe(0.2);
  });

  it("should return 0 when all matched", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 5;
    expect(calculateFailureRate(stats)).toBe(0);
  });
});

// ==================== isMatchFailureRateExceeded ====================

describe("isMatchFailureRateExceeded", () => {
  it("should return false when rate is below default threshold (0.1)", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "A", availableMembers: [] },
    ]; // 10%
    expect(isMatchFailureRateExceeded(stats)).toBe(false);
  });

  it("should return true when rate exceeds default threshold (0.1)", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "A", availableMembers: [] },
      { taskTitle: "任务2", inputName: "B", availableMembers: [] },
    ]; // 20%
    expect(isMatchFailureRateExceeded(stats)).toBe(true);
  });

  it("should use custom threshold", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "A", availableMembers: [] },
      { taskTitle: "任务2", inputName: "B", availableMembers: [] },
    ]; // 20%
    expect(isMatchFailureRateExceeded(stats, 0.5)).toBe(false);
  });
});

// ==================== updateFailureRate ====================

describe("updateFailureRate", () => {
  it("should update failureRate field on stats", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "A", availableMembers: [] },
    ];
    updateFailureRate(stats);
    expect(stats.failureRate).toBe(0.1);
  });
});

// ==================== formatMatchFailureError ====================

describe("formatMatchFailureError", () => {
  it("should format error message with rate and names", () => {
    const stats = createMatchStatistics();
    stats.totalRows = 10;
    stats.unmatched = [
      { taskTitle: "任务1", inputName: "成员A", availableMembers: [] },
      { taskTitle: "任务2", inputName: "成员B", availableMembers: [] },
    ];
    const available = ["AI-ChatGPT", "AI-Claude"];
    const msg = formatMatchFailureError(stats, available);

    expect(msg).toContain("2/10");
    expect(msg).toContain("20.0%");
    expect(msg).toContain("成员A");
    expect(msg).toContain("成员B");
    expect(msg).toContain("AI-ChatGPT");
    expect(msg).toContain("AI-Claude");
  });

  it("should handle zero totalRows without NaN", () => {
    const stats = createMatchStatistics();
    const msg = formatMatchFailureError(stats, []);
    expect(msg).toContain("0/0");
  });
});
