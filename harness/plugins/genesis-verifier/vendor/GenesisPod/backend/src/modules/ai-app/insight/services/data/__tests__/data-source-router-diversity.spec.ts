/**
 * DataSourceRouterService - Domain Diversity Tests
 *
 * Tests for domain diversity enforcement and domain extraction
 * Type checking is disabled due to Jest mock compatibility issues.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceRouterService } from "../data-source-router.service";
import { ChatFacade, RAGFacade, ToolFacade } from "@/modules/ai-harness/facade";
import {
  ToolRegistry,
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  EmbeddingService,
  VectorService,
} from "@/modules/ai-harness/facade";
import { AICapabilityResolver } from "@/modules/ai-harness/facade";
import { DataSourcePlannerService } from "../data-source-planner.service";
import { createMockAiEngineFacade } from "../../../__tests__/mocks";

/** Local mock result type that includes extra test fields */
type MockResult = {
  url: string;
  title: string;
  snippet: string;
  source: string;
  credibilityScore: number;
};

describe("DataSourceRouterService - Domain Diversity", () => {
  let service: DataSourceRouterService;

  // Mock minimal dependencies
  const mockToolRegistry = {};
  const mockFederalRegisterTool = {};
  const mockCongressGovTool = {};
  const mockWhiteHouseNewsTool = {};
  const mockCapabilityResolver = {};
  const mockDataSourcePlanner = {};
  const mockEmbeddingService = {};
  const mockVectorService = {};

  beforeEach(async () => {
    const mockAiFacade = createMockAiEngineFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourceRouterService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: FederalRegisterTool, useValue: mockFederalRegisterTool },
        { provide: CongressGovTool, useValue: mockCongressGovTool },
        { provide: WhiteHouseNewsTool, useValue: mockWhiteHouseNewsTool },
        { provide: AICapabilityResolver, useValue: mockCapabilityResolver },
        { provide: DataSourcePlannerService, useValue: mockDataSourcePlanner },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: VectorService, useValue: mockVectorService },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: RAGFacade, useValue: mockAiFacade },
        { provide: ToolFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<DataSourceRouterService>(DataSourceRouterService);
  });

  // ==================== extractDomain Tests ====================

  describe("extractDomain (private method)", () => {
    it("should extract hostname and strip www.", () => {
      // Use reflection to access private method
      const extractDomain = service["extractDomain"].bind(service);

      expect(extractDomain("https://www.example.com/page")).toBe("example.com");
      expect(extractDomain("https://example.com/page")).toBe("example.com");
      expect(extractDomain("http://www.github.com/repo")).toBe("github.com");
    });

    it("should return null for invalid URLs", () => {
      const extractDomain = service["extractDomain"].bind(service);

      expect(extractDomain("not-a-url")).toBeNull();
      expect(extractDomain("")).toBeNull();
      expect(extractDomain("just some text")).toBeNull();
    });

    it("should return null for localhost", () => {
      const extractDomain = service["extractDomain"].bind(service);

      expect(extractDomain("http://localhost:3000/page")).toBeNull();
      expect(extractDomain("https://localhost/")).toBeNull();
    });

    it("should return null for IP addresses", () => {
      const extractDomain = service["extractDomain"].bind(service);

      expect(extractDomain("http://192.168.1.1/page")).toBeNull();
      expect(extractDomain("https://127.0.0.1:8080/")).toBeNull();
      expect(extractDomain("http://10.0.0.1/")).toBeNull();
    });

    it("should handle github.io subdomains", () => {
      const extractDomain = service["extractDomain"].bind(service);

      expect(extractDomain("https://username.github.io/project")).toBe(
        "username.github.io",
      );
      expect(extractDomain("https://www.username.github.io/project")).toBe(
        "username.github.io",
      );
    });
  });

  // ==================== enforceDomainDiversity Tests ====================

  describe("enforceDomainDiversity (private method)", () => {
    it("should return input unchanged when ≤3 results", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
      ];

      const output = enforceDomainDiversity(results);

      expect(output).toEqual(results);
      expect(output.length).toBe(3);
    });

    it("should cap single domain at 30% of total", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      // 10 results, 7 from example.com (70%)
      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example.com/4",
          title: "Result 4",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://example.com/5",
          title: "Result 5",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
        {
          url: "https://example.com/6",
          title: "Result 6",
          snippet: "",
          source: "WEB",
          credibilityScore: 65,
        },
        {
          url: "https://example.com/7",
          title: "Result 7",
          snippet: "",
          source: "WEB",
          credibilityScore: 60,
        },
        {
          url: "https://other1.com/1",
          title: "Other 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 55,
        },
        {
          url: "https://other2.com/1",
          title: "Other 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 50,
        },
        {
          url: "https://other3.com/1",
          title: "Other 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 45,
        },
      ];

      const output = enforceDomainDiversity(results);

      // Max per domain: Math.max(2, Math.ceil(10 * 0.3)) = Math.max(2, 3) = 3
      const exampleCount = output.filter((r) =>
        r.url.includes("example.com"),
      ).length;
      expect(exampleCount).toBeLessThanOrEqual(3);
      expect(output.length).toBeLessThanOrEqual(10);
    });

    it("should always keep at least 2 results per domain", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      // 5 results, 4 from example.com (80%)
      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example.com/4",
          title: "Result 4",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://other.com/1",
          title: "Other 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
      ];

      const output = enforceDomainDiversity(results);

      // Max per domain: Math.max(2, Math.ceil(5 * 0.3)) = Math.max(2, 2) = 2
      const exampleCount = output.filter((r) =>
        r.url.includes("example.com"),
      ).length;
      expect(exampleCount).toBe(2); // At least 2, capped at 2
    });

    it("should relax threshold to 50% for authoritative domains (.gov, .edu, arxiv.org)", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      // 10 results, 5 from .gov domains (50%)
      const results = [
        {
          url: "https://nasa.gov/1",
          title: "NASA 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 95,
        },
        {
          url: "https://nasa.gov/2",
          title: "NASA 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 94,
        },
        {
          url: "https://nasa.gov/3",
          title: "NASA 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 93,
        },
        {
          url: "https://nasa.gov/4",
          title: "NASA 4",
          snippet: "",
          source: "WEB",
          credibilityScore: 92,
        },
        {
          url: "https://nasa.gov/5",
          title: "NASA 5",
          snippet: "",
          source: "WEB",
          credibilityScore: 91,
        },
        {
          url: "https://mit.edu/1",
          title: "MIT 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://stanford.edu/1",
          title: "Stanford 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 89,
        },
        {
          url: "https://example.com/1",
          title: "Example 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 50,
        },
        {
          url: "https://example.com/2",
          title: "Example 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 49,
        },
        {
          url: "https://example.com/3",
          title: "Example 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 48,
        },
      ];

      const output = enforceDomainDiversity(results);

      // With >40% authoritative domains, maxRatio should be relaxed to 0.5
      // Max per domain: Math.max(2, Math.ceil(10 * 0.5)) = Math.max(2, 5) = 5
      const nasaCount = output.filter((r) => r.url.includes("nasa.gov")).length;
      expect(nasaCount).toBeLessThanOrEqual(5);
      expect(nasaCount).toBeGreaterThanOrEqual(2);
    });

    it("should keep results with unparseable URLs", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "invalid-url",
          title: "Invalid",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://other.com/1",
          title: "Other",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
      ];

      const output = enforceDomainDiversity(results);

      // Invalid URL should be kept (not counted in domain limits)
      const invalidResult = output.find((r) => r.url === "invalid-url");
      expect(invalidResult).toBeDefined();
    });

    it("should preserve results order (highest credibility first)", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 100,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 95,
        },
        {
          url: "https://other.com/1",
          title: "Other 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "https://other.com/2",
          title: "Other 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
      ];

      const output = enforceDomainDiversity(results);

      // Order should be preserved
      expect(output[0].credibilityScore).toBeGreaterThanOrEqual(
        output[1].credibilityScore,
      );
      if (output.length > 2) {
        expect(output[1].credibilityScore).toBeGreaterThanOrEqual(
          output[2].credibilityScore,
        );
      }
    });

    it("should handle no over-represented domains", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      // Each domain appears only once
      const results = [
        {
          url: "https://example1.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example2.com/1",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "https://example3.com/1",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example4.com/1",
          title: "Result 4",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://example5.com/1",
          title: "Result 5",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
      ];

      const output = enforceDomainDiversity(results);

      // Should return unchanged
      expect(output).toEqual(results);
      expect(output.length).toBe(5);
    });

    it("should handle custom maxRatio parameter", () => {
      const enforceDomainDiversity = service["enforceDomainDiversity"].bind(
        service,
      ) as unknown as (
        results: MockResult[],
        maxRatio?: number,
      ) => MockResult[];

      const results = [
        {
          url: "https://example.com/1",
          title: "Result 1",
          snippet: "",
          source: "WEB",
          credibilityScore: 90,
        },
        {
          url: "https://example.com/2",
          title: "Result 2",
          snippet: "",
          source: "WEB",
          credibilityScore: 85,
        },
        {
          url: "https://example.com/3",
          title: "Result 3",
          snippet: "",
          source: "WEB",
          credibilityScore: 80,
        },
        {
          url: "https://example.com/4",
          title: "Result 4",
          snippet: "",
          source: "WEB",
          credibilityScore: 75,
        },
        {
          url: "https://other.com/1",
          title: "Other",
          snippet: "",
          source: "WEB",
          credibilityScore: 70,
        },
      ];

      // Use custom ratio of 0.5 (50%)
      const output = enforceDomainDiversity(results, 0.5);

      // Max per domain: Math.max(2, Math.ceil(5 * 0.5)) = Math.max(2, 3) = 3
      const exampleCount = output.filter((r) =>
        r.url.includes("example.com"),
      ).length;
      expect(exampleCount).toBeLessThanOrEqual(3);
    });
  });
});
