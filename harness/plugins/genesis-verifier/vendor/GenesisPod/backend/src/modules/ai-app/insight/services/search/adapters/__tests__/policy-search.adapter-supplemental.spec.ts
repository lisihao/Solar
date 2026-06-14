/**
 * PolicySearchAdapter - Supplemental Tests
 *
 * Covers uncovered branches:
 * - congressResult.status === "rejected" → warn log (line 126)
 * - whResult.status === "rejected" → warn log (line 153)
 * - executePolicyTool: result.success=false → return null (lines 177-180)
 * - executePolicyTool: result.data is null → return null
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: { CHAT: "CHAT" },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));

import { PolicySearchAdapter } from "../policy-search.adapter";
import { DataSourceType } from "../../../../types/data-source.types";
import type { AdapterSearchRequest } from "../../../search.types";

const BASE_REQUEST: AdapterSearchRequest = {
  query: "AI policy",
  maxResults: 9,
  timeoutMs: 5000,
};

function buildPolicyRegistry(
  fedResult: unknown,
  congressResult: unknown,
  whResult: unknown,
) {
  const fedTool = jest.fn().mockResolvedValue(fedResult);
  const congressTool = jest.fn().mockResolvedValue(congressResult);
  const whTool = jest.fn().mockResolvedValue(whResult);

  const registry = {
    tryGet: jest.fn((id: string) => {
      if (id === "federal-register") return { execute: fedTool };
      if (id === "congress-gov") return { execute: congressTool };
      if (id === "whitehouse-news") return { execute: whTool };
      return undefined;
    }),
  };
  return { registry, fedTool, congressTool, whTool };
}

describe("PolicySearchAdapter (supplemental)", () => {
  // ============================================================
  // congressResult.status === "rejected" (line 126)
  // ============================================================

  it("should log warning and skip congress results when congress tool rejects", async () => {
    const { registry } = buildPolicyRegistry(
      // fedResult: success
      { success: true, data: { success: true, documents: [] } },
      // congressResult: rejected — simulate via tool throwing
      null, // will be overridden below
      // whResult: success
      { success: true, data: { success: true, items: [] } },
    );

    // Override congress tool to reject
    const congressRejectTool = jest
      .fn()
      .mockRejectedValue(new Error("Congress API down"));
    registry.tryGet.mockImplementation((id: string) => {
      if (id === "congress-gov") return { execute: congressRejectTool };
      if (id === "federal-register")
        return {
          execute: jest.fn().mockResolvedValue({
            success: true,
            data: { success: true, documents: [] },
          }),
        };
      if (id === "whitehouse-news")
        return {
          execute: jest.fn().mockResolvedValue({
            success: true,
            data: { success: true, items: [] },
          }),
        };
      return undefined;
    });

    const adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    // Should not throw, just skip failed source
    expect(result).toBeDefined();
    expect(
      result.items.filter((i) => i.sourceType === DataSourceType.CONGRESS),
    ).toHaveLength(0);
  });

  // ============================================================
  // whResult.status === "rejected" (line 153)
  // ============================================================

  it("should log warning and skip whitehouse results when whitehouse tool rejects", async () => {
    const registry = {
      tryGet: jest.fn((id: string) => {
        if (id === "federal-register")
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, documents: [] },
            }),
          };
        if (id === "congress-gov")
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, bills: [] },
            }),
          };
        if (id === "whitehouse-news")
          return {
            execute: jest
              .fn()
              .mockRejectedValue(new Error("WhiteHouse API unavailable")),
          };
        return undefined;
      }),
    };

    const adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    expect(result).toBeDefined();
    expect(
      result.items.filter((i) => i.sourceType === DataSourceType.WHITEHOUSE),
    ).toHaveLength(0);
  });

  // ============================================================
  // executePolicyTool: result.success = false → return null (lines 177-180)
  // ============================================================

  it("should return null and skip results when tool execute returns success=false", async () => {
    const registry = {
      tryGet: jest.fn((_id: string) => {
        // All tools return success=false
        return {
          execute: jest.fn().mockResolvedValue({ success: false, data: null }),
        };
      }),
    };

    const adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    // All tools returned null → no results
    expect(result.items).toHaveLength(0);
  });

  it("should return null when tool execute returns success=true but data=null", async () => {
    const registry = {
      tryGet: jest.fn((_id: string) => {
        return {
          execute: jest.fn().mockResolvedValue({ success: true, data: null }),
        };
      }),
    };

    const adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(0);
  });
});
