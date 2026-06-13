/**
 * Unit tests for ImageFetcherSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ImageFetcherSkill } from "../image-fetcher.skill";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-image-fetcher",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

describe("ImageFetcherSkill", () => {
  let skill: ImageFetcherSkill;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockHttpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined), // no API key by default
    } as any;

    mockHttpService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageFetcherSkill,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    skill = module.get<ImageFetcherSkill>(ImageFetcherSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-image-fetcher");
    expect(skill.name).toBe("图片获取");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("4.0.0");
  });

  it("should return error when keywords are missing", async () => {
    const result = await skill.execute({ keywords: [] }, buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("should return fallback images when no API key is configured", async () => {
    const result = await skill.execute(
      { keywords: ["business", "finance"], count: 1 },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!).toHaveLength(1);
    expect(result.data![0].url).toContain("unsplash.com");
  });

  it("should map known keywords to correct fallback categories", async () => {
    const result = await skill.execute(
      { keywords: ["技术", "tech"], count: 2 },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // technology category has 2 fallback images
    expect(result.data!.length).toBeLessThanOrEqual(2);
  });

  it("should use default category for unknown keywords", async () => {
    const result = await skill.execute(
      { keywords: ["unknownkeyword12345"] },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
    expect(result.data![0].id).toContain("fallback-default");
  });

  it("should call Unsplash API when access key is configured", async () => {
    mockConfigService.get.mockReturnValue("test-api-key");

    // Re-create the skill with configured key
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageFetcherSkill,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();
    const skillWithKey = module.get<ImageFetcherSkill>(ImageFetcherSkill);

    const mockApiResponse = {
      data: {
        results: [
          {
            id: "abc123",
            urls: {
              raw: "https://images.unsplash.com/photo-abc",
              small: "https://images.unsplash.com/photo-abc?w=200",
            },
            width: 1920,
            height: 1280,
            description: "Test photo",
            alt_description: "alt",
            user: {
              name: "Photographer",
              links: { html: "https://unsplash.com/@user" },
            },
          },
        ],
      },
    };
    mockHttpService.get.mockReturnValue(of(mockApiResponse) as any);

    const result = await skillWithKey.execute(
      { keywords: ["business"], count: 1 },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data![0].id).toBe("abc123");
    expect(result.data![0].author).toBe("Photographer");
  });

  it("should fall back to default images when Unsplash API fails", async () => {
    mockConfigService.get.mockReturnValue("test-api-key");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageFetcherSkill,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();
    const skillWithKey = module.get<ImageFetcherSkill>(ImageFetcherSkill);

    mockHttpService.get.mockReturnValue(
      new (require("rxjs").throwError)(() => new Error("Network Error")),
    );

    const result = await skillWithKey.execute(
      { keywords: ["business"] },
      buildSkillContext(),
    );

    // Falls back to default images
    expect(result.success).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
  });

  it("should extract Chinese and English keywords correctly", () => {
    const keywords = skill.extractKeywords(
      "AI 技术市场分析报告",
      "business innovation",
    );
    expect(keywords.length).toBeGreaterThan(0);
  });

  it("should generate placeholder HTML", () => {
    const html = skill.generatePlaceholderHtml(400, 300, "Loading...");
    expect(html).toContain("400px");
    expect(html).toContain("300px");
    expect(html).toContain("Loading...");
  });

  it("should generate image HTML with correct attributes", () => {
    const image = {
      id: "img1",
      url: "https://example.com/photo.jpg",
      thumbnailUrl: "https://example.com/photo-thumb.jpg",
      width: 800,
      height: 600,
      description: "Test image",
    };

    const html = skill.generateImageHtml(image, { width: 300, height: 200 });
    expect(html).toContain('src="https://example.com/photo.jpg"');
    expect(html).toContain('alt="Test image"');
    expect(html).toContain("300px");
  });

  it("should handle Orchestrator input format", async () => {
    const orchestratorInput = {
      task: "fetch image",
      context: {
        input: {
          keywords: ["technology"],
          count: 1,
        },
      },
    };

    const result = await skill.execute(
      orchestratorInput as any,
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
  });

  it("should fetch image for slide from title", async () => {
    const image = await skill.fetchImageForSlide("Technology Innovation");
    expect(image).not.toBeNull();
    expect(image!.url).toBeDefined();
  });
});
