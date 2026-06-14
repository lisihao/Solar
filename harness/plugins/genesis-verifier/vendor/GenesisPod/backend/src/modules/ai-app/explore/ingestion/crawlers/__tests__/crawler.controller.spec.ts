import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { CrawlerController } from "../crawler.controller";
import { ArxivService } from "../arxiv.service";
import { GithubService } from "../github.service";
import { HackernewsService } from "../hackernews.service";

// ── Test suite ────────────────────────────────────────────────────────────────

describe("CrawlerController", () => {
  let controller: CrawlerController;
  let arxivService: jest.Mocked<ArxivService>;
  let githubService: jest.Mocked<GithubService>;
  let hackernewsService: jest.Mocked<HackernewsService>;

  beforeEach(async () => {
    const mockArxivService = {
      fetchLatestPapers: jest.fn(),
      searchPapers: jest.fn(),
    };

    const mockGithubService = {
      fetchTrendingRepos: jest.fn(),
      searchRepositories: jest.fn(),
    };

    const mockHackernewsService = {
      fetchTopStories: jest.fn(),
      fetchNewStories: jest.fn(),
      fetchBestStories: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CrawlerController],
      providers: [
        { provide: ArxivService, useValue: mockArxivService },
        { provide: GithubService, useValue: mockGithubService },
        { provide: HackernewsService, useValue: mockHackernewsService },
      ],
    }).compile();

    controller = module.get<CrawlerController>(CrawlerController);
    arxivService = module.get(ArxivService);
    githubService = module.get(GithubService);
    hackernewsService = module.get(HackernewsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── fetchArxivLatest ──────────────────────────────────────────────────────────

  describe("POST /crawler/arxiv/latest", () => {
    it("fetches arXiv latest papers with default max=10 and no category", async () => {
      arxivService.fetchLatestPapers.mockResolvedValue(8);

      const result = await controller.fetchArxivLatest(undefined, undefined);

      expect(arxivService.fetchLatestPapers).toHaveBeenCalledWith(
        10,
        undefined,
      );
      expect(result).toEqual({
        source: "arxiv",
        action: "fetch_latest",
        processed: 8,
        maxResults: 10,
        category: "all",
      });
    });

    it("parses max query param and passes category to service", async () => {
      arxivService.fetchLatestPapers.mockResolvedValue(5);

      const result = await controller.fetchArxivLatest("5", "cs.AI");

      expect(arxivService.fetchLatestPapers).toHaveBeenCalledWith(5, "cs.AI");
      expect(result).toEqual({
        source: "arxiv",
        action: "fetch_latest",
        processed: 5,
        maxResults: 5,
        category: "cs.AI",
      });
    });

    it("propagates service errors", async () => {
      arxivService.fetchLatestPapers.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(
        controller.fetchArxivLatest(undefined, undefined),
      ).rejects.toThrow("Network error");
    });
  });

  // ── searchArxiv ───────────────────────────────────────────────────────────────

  describe("POST /crawler/arxiv/search", () => {
    it("searches arXiv papers with query and default max=10", async () => {
      arxivService.searchPapers.mockResolvedValue(3);

      const result = await controller.searchArxiv(
        "transformer architecture",
        undefined,
      );

      expect(arxivService.searchPapers).toHaveBeenCalledWith(
        "transformer architecture",
        10,
      );
      expect(result).toEqual({
        source: "arxiv",
        action: "search",
        query: "transformer architecture",
        processed: 3,
      });
    });

    it("parses max query param correctly", async () => {
      arxivService.searchPapers.mockResolvedValue(20);

      const result = await controller.searchArxiv("LLM", "20");

      expect(arxivService.searchPapers).toHaveBeenCalledWith("LLM", 20);
      expect(result.processed).toBe(20);
    });

    it("throws BadRequestException when query is missing", async () => {
      await expect(controller.searchArxiv("", undefined)).rejects.toThrow(
        BadRequestException,
      );

      expect(arxivService.searchPapers).not.toHaveBeenCalled();
    });

    it("throws BadRequestException with descriptive message for missing query", async () => {
      await expect(controller.searchArxiv("", undefined)).rejects.toThrow(
        'Query parameter "q" is required',
      );
    });
  });

  // ── fetchGithubTrending ───────────────────────────────────────────────────────

  describe("POST /crawler/github/trending", () => {
    it("fetches GitHub trending repos with defaults", async () => {
      githubService.fetchTrendingRepos.mockResolvedValue(12);

      const result = await controller.fetchGithubTrending(undefined, undefined);

      expect(githubService.fetchTrendingRepos).toHaveBeenCalledWith(
        undefined,
        "daily",
      );
      expect(result).toEqual({
        source: "github",
        action: "fetch_trending",
        processed: 12,
        language: "all",
        since: "daily",
      });
    });

    it("passes language and since to service", async () => {
      githubService.fetchTrendingRepos.mockResolvedValue(7);

      const result = await controller.fetchGithubTrending(
        "typescript",
        "weekly",
      );

      expect(githubService.fetchTrendingRepos).toHaveBeenCalledWith(
        "typescript",
        "weekly",
      );
      expect(result).toEqual({
        source: "github",
        action: "fetch_trending",
        processed: 7,
        language: "typescript",
        since: "weekly",
      });
    });

    it("uses 'daily' as default since value when not provided", async () => {
      githubService.fetchTrendingRepos.mockResolvedValue(5);

      const result = await controller.fetchGithubTrending("python", undefined);

      expect(result.since).toBe("daily");
    });

    it("reflects 'monthly' since value correctly", async () => {
      githubService.fetchTrendingRepos.mockResolvedValue(3);

      const result = await controller.fetchGithubTrending("rust", "monthly");

      expect(result.since).toBe("monthly");
    });
  });

  // ── searchGithub ──────────────────────────────────────────────────────────────

  describe("POST /crawler/github/search", () => {
    it("searches GitHub repos with query and default max=10", async () => {
      githubService.searchRepositories.mockResolvedValue(6);

      const result = await controller.searchGithub(
        "nestjs microservice",
        undefined,
      );

      expect(githubService.searchRepositories).toHaveBeenCalledWith(
        "nestjs microservice",
        10,
      );
      expect(result).toEqual({
        source: "github",
        action: "search",
        query: "nestjs microservice",
        processed: 6,
      });
    });

    it("parses max query param correctly", async () => {
      githubService.searchRepositories.mockResolvedValue(15);

      await controller.searchGithub("react hooks", "15");

      expect(githubService.searchRepositories).toHaveBeenCalledWith(
        "react hooks",
        15,
      );
    });

    it("throws BadRequestException when query is missing", async () => {
      await expect(controller.searchGithub("", undefined)).rejects.toThrow(
        BadRequestException,
      );

      expect(githubService.searchRepositories).not.toHaveBeenCalled();
    });
  });

  // ── fetchHNTop ────────────────────────────────────────────────────────────────

  describe("POST /crawler/hackernews/top", () => {
    it("fetches HN top stories with default max=30", async () => {
      hackernewsService.fetchTopStories.mockResolvedValue(28);

      const result = await controller.fetchHNTop(undefined);

      expect(hackernewsService.fetchTopStories).toHaveBeenCalledWith(30);
      expect(result).toEqual({
        source: "hackernews",
        action: "fetch_top",
        processed: 28,
      });
    });

    it("parses max query param correctly", async () => {
      hackernewsService.fetchTopStories.mockResolvedValue(10);

      await controller.fetchHNTop("10");

      expect(hackernewsService.fetchTopStories).toHaveBeenCalledWith(10);
    });
  });

  // ── fetchHNNew ────────────────────────────────────────────────────────────────

  describe("POST /crawler/hackernews/new", () => {
    it("fetches HN new stories with default max=30", async () => {
      hackernewsService.fetchNewStories.mockResolvedValue(25);

      const result = await controller.fetchHNNew(undefined);

      expect(hackernewsService.fetchNewStories).toHaveBeenCalledWith(30);
      expect(result).toEqual({
        source: "hackernews",
        action: "fetch_new",
        processed: 25,
      });
    });

    it("parses max query param correctly", async () => {
      hackernewsService.fetchNewStories.mockResolvedValue(5);

      await controller.fetchHNNew("5");

      expect(hackernewsService.fetchNewStories).toHaveBeenCalledWith(5);
    });
  });

  // ── fetchHNBest ───────────────────────────────────────────────────────────────

  describe("POST /crawler/hackernews/best", () => {
    it("fetches HN best stories with default max=30", async () => {
      hackernewsService.fetchBestStories.mockResolvedValue(20);

      const result = await controller.fetchHNBest(undefined);

      expect(hackernewsService.fetchBestStories).toHaveBeenCalledWith(30);
      expect(result).toEqual({
        source: "hackernews",
        action: "fetch_best",
        processed: 20,
      });
    });

    it("parses max query param correctly", async () => {
      hackernewsService.fetchBestStories.mockResolvedValue(15);

      await controller.fetchHNBest("15");

      expect(hackernewsService.fetchBestStories).toHaveBeenCalledWith(15);
    });
  });

  // ── fetchAll ──────────────────────────────────────────────────────────────────

  describe("POST /crawler/fetch-all", () => {
    it("returns aggregated results when all sources succeed", async () => {
      arxivService.fetchLatestPapers.mockResolvedValue(10);
      githubService.fetchTrendingRepos.mockResolvedValue(12);
      hackernewsService.fetchTopStories.mockResolvedValue(20);

      const result = await controller.fetchAll();

      expect(result.action).toBe("fetch_all");
      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toEqual({
        source: "arxiv",
        status: "fulfilled",
        processed: 10,
        error: null,
      });
      expect(result.results[1]).toEqual({
        source: "github",
        status: "fulfilled",
        processed: 12,
        error: null,
      });
      expect(result.results[2]).toEqual({
        source: "hackernews",
        status: "fulfilled",
        processed: 20,
        error: null,
      });
    });

    it("calls services with hardcoded defaults for all-in-one fetch", async () => {
      arxivService.fetchLatestPapers.mockResolvedValue(0);
      githubService.fetchTrendingRepos.mockResolvedValue(0);
      hackernewsService.fetchTopStories.mockResolvedValue(0);

      await controller.fetchAll();

      expect(arxivService.fetchLatestPapers).toHaveBeenCalledWith(10, "cs.AI");
      expect(githubService.fetchTrendingRepos).toHaveBeenCalledWith(
        "typescript",
        "daily",
      );
      expect(hackernewsService.fetchTopStories).toHaveBeenCalledWith(20);
    });

    it("handles partial failures gracefully", async () => {
      arxivService.fetchLatestPapers.mockResolvedValue(5);
      githubService.fetchTrendingRepos.mockRejectedValue(
        new Error("GitHub API down"),
      );
      hackernewsService.fetchTopStories.mockResolvedValue(15);

      const result = await controller.fetchAll();

      expect(result.results[0]).toEqual({
        source: "arxiv",
        status: "fulfilled",
        processed: 5,
        error: null,
      });
      expect(result.results[1]).toEqual({
        source: "github",
        status: "rejected",
        processed: 0,
        error: "GitHub API down",
      });
      expect(result.results[2]).toEqual({
        source: "hackernews",
        status: "fulfilled",
        processed: 15,
        error: null,
      });
    });

    it("handles all sources failing", async () => {
      arxivService.fetchLatestPapers.mockRejectedValue(new Error("arXiv down"));
      githubService.fetchTrendingRepos.mockRejectedValue(
        new Error("GitHub down"),
      );
      hackernewsService.fetchTopStories.mockRejectedValue(new Error("HN down"));

      const result = await controller.fetchAll();

      expect(result.results.every((r) => r.status === "rejected")).toBe(true);
      expect(result.results.every((r) => r.processed === 0)).toBe(true);
    });
  });

  // ── health ────────────────────────────────────────────────────────────────────

  describe("GET /crawler/health", () => {
    it("returns ok status with all source names", () => {
      const result = controller.health();

      expect(result).toEqual({
        status: "ok",
        service: "Crawler",
        sources: ["arxiv", "github", "hackernews"],
      });
    });

    it("is synchronous and does not call any services", () => {
      controller.health();

      expect(arxivService.fetchLatestPapers).not.toHaveBeenCalled();
      expect(githubService.fetchTrendingRepos).not.toHaveBeenCalled();
      expect(hackernewsService.fetchTopStories).not.toHaveBeenCalled();
    });
  });
});
