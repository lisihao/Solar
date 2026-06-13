import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GithubService } from "../github.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";

// Mock axios at module level
jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  resource: {
    create: jest.fn(),
  },
};

const mockMongodb = {
  findRawDataByExternalId: jest.fn(),
  findRawDataByExternalIdAcrossAllSources: jest.fn(),
  findRawDataByUrlAcrossAllSources: jest.fn(),
  findRawDataByTitleAcrossAllSources: jest.fn(),
  insertRawData: jest.fn(),
  linkResourceToRawData: jest.fn(),
  findRawDataById: jest.fn(),
};

const mockDeduplication = {
  normalizeUrl: jest.fn(),
  areTitlesSimilar: jest.fn(),
};

const mockConfig = {
  get: jest.fn(),
};

// ── Helper factories ──────────────────────────────────────────────────────────

function makeRepo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 12345,
    name: "awesome-repo",
    full_name: "owner/awesome-repo",
    description: "An awesome repository for testing",
    html_url: "https://github.com/owner/awesome-repo",
    clone_url: "https://github.com/owner/awesome-repo.git",
    git_url: "git://github.com/owner/awesome-repo.git",
    homepage: "https://awesome-repo.example.com",
    stargazers_count: 1500,
    watchers_count: 1500,
    forks_count: 200,
    open_issues_count: 42,
    language: "TypeScript",
    topics: ["typescript", "testing", "awesome"],
    license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
    created_at: "2023-01-01T00:00:00Z",
    updated_at: "2024-01-10T00:00:00Z",
    pushed_at: new Date().toISOString(), // recently active
    private: false,
    fork: false,
    archived: false,
    is_template: false,
    has_issues: true,
    has_projects: true,
    has_wiki: true,
    has_pages: false,
    has_downloads: true,
    size: 5000,
    default_branch: "main",
    owner: {
      login: "owner",
      id: 99,
      avatar_url: "https://github.com/avatars/owner",
      url: "https://api.github.com/users/owner",
      type: "User",
    },
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("GithubService", () => {
  let service: GithubService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfig.get.mockImplementation((key: string) => {
      if (key === "GITHUB_TOKEN") return "ghp_test_token_123";
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RawDataService, useValue: mockMongodb },
        { provide: DeduplicationService, useValue: mockDeduplication },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<GithubService>(GithubService);

    // Default mock behaviors: no duplicates
    mockMongodb.findRawDataByExternalId.mockResolvedValue(null);
    mockMongodb.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(null);
    mockMongodb.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
    mockMongodb.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
    mockDeduplication.normalizeUrl.mockImplementation((url: string) => url);
    mockDeduplication.areTitlesSimilar.mockReturnValue(false);
    mockMongodb.insertRawData.mockResolvedValue("mongo-id-abc");
    mockMongodb.findRawDataById.mockResolvedValue({
      resourceId: "resource-id-1",
    });
    mockMongodb.linkResourceToRawData.mockResolvedValue(undefined);
    mockPrisma.resource.create.mockResolvedValue({ id: "resource-id-1" });
  });

  // ── fetchTrendingRepos ────────────────────────────────────────────────────────

  describe("fetchTrendingRepos", () => {
    it("fetches trending repos with default parameters (daily, no language)", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } }) // search API
        .mockResolvedValueOnce({ data: repo }) // /repos/owner/awesome-repo
        .mockResolvedValueOnce({ data: "# README Content" }) // readme (raw)
        .mockResolvedValueOnce({ data: { TypeScript: 50000 } }) // languages
        .mockResolvedValueOnce({
          data: [{ login: "contributor1", contributions: 42 }],
        }); // contributors

      const count = await service.fetchTrendingRepos();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("/search/repositories"),
        expect.objectContaining({
          params: expect.objectContaining({
            q: expect.stringContaining("stars:>50"),
            sort: "stars",
          }),
        }),
      );
      expect(count).toBe(1);
    });

    it("includes language filter in query when provided", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await service.fetchTrendingRepos("Python", "weekly");

      const firstCall = mockedAxios.get.mock.calls[0];
      expect(firstCall[1].params.q).toContain("language:Python");
    });

    it("uses correct date threshold for daily range", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await service.fetchTrendingRepos(undefined, "daily");

      const firstCall = mockedAxios.get.mock.calls[0];
      const query = firstCall[1].params.q;
      // Should have a date from roughly yesterday
      expect(query).toMatch(/created:>\d{4}-\d{2}-\d{2}/);
    });

    it("uses correct date threshold for monthly range", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await service.fetchTrendingRepos(undefined, "monthly");

      const firstCall = mockedAxios.get.mock.calls[0];
      // monthly threshold should be about 30 days ago
      const query = firstCall[1].params.q;
      expect(query).toContain("created:>");
    });

    it("returns 0 when search returns no items", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      const count = await service.fetchTrendingRepos();

      expect(count).toBe(0);
    });

    it("returns 0 when search result has no items field", async () => {
      mockedAxios.get = jest.fn().mockResolvedValueOnce({ data: {} });

      const count = await service.fetchTrendingRepos();

      expect(count).toBe(0);
    });

    it("skips repos with missing full_name", async () => {
      const repoWithoutFullName = makeRepo({ full_name: undefined });

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repoWithoutFullName] } });

      await service.fetchTrendingRepos();

      // full_name is missing -> processRepository returns early without inserting
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
    });

    it("skips repos that already exist in MongoDB by externalId", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } });

      mockMongodb.findRawDataByExternalId.mockResolvedValue({
        source: "github",
        externalId: "owner/awesome-repo",
      });

      await service.fetchTrendingRepos();

      // Duplicate found early -> no insertRawData called
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
      expect(mockPrisma.resource.create).not.toHaveBeenCalled();
    });

    it("skips repos that exist from cross-source duplicate check", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } });

      mockMongodb.findRawDataByExternalId.mockResolvedValue(null);
      mockMongodb.findRawDataByExternalIdAcrossAllSources.mockResolvedValue({
        source: "rss",
        externalId: "owner/awesome-repo",
      });

      await service.fetchTrendingRepos();

      // Cross-source duplicate -> no insertRawData
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
    });

    it("skips repos with URL duplicate", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } });

      mockMongodb.findRawDataByUrlAcrossAllSources.mockResolvedValue({
        source: "arxiv",
      });

      await service.fetchTrendingRepos();

      // URL duplicate -> no insertRawData
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
    });

    it("skips repos with similar title in title deduplication", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } });

      mockMongodb.findRawDataByTitleAcrossAllSources.mockResolvedValue([
        {
          data: { name: "awesome-repo", description: "An awesome repository" },
          source: "rss",
        },
      ]);
      mockDeduplication.areTitlesSimilar.mockReturnValue(true);

      await service.fetchTrendingRepos();

      // Title similarity duplicate -> no insertRawData
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
    });

    it("throws when GitHub API request fails", async () => {
      mockedAxios.get = jest
        .fn()
        .mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(service.fetchTrendingRepos()).rejects.toThrow(
        "Rate limit exceeded",
      );
    });

    it("stores raw data in MongoDB and creates resource in PostgreSQL", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } })
        .mockResolvedValueOnce({
          data: { ...repo, languages: { TypeScript: 50000 } },
        })
        .mockResolvedValueOnce({ data: "# README" })
        .mockResolvedValueOnce({ data: { TypeScript: 50000 } })
        .mockResolvedValueOnce({
          data: [{ login: "user1", contributions: 10 }],
        });

      await service.fetchTrendingRepos();

      expect(mockMongodb.insertRawData).toHaveBeenCalledWith(
        "github",
        expect.objectContaining({ externalId: "owner/awesome-repo" }),
      );
      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "PROJECT",
            title: "owner/awesome-repo",
          }),
        }),
      );
    });

    it("establishes bi-directional reference between MongoDB and PostgreSQL", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } })
        .mockResolvedValueOnce({ data: repo })
        .mockResolvedValueOnce({ data: "# README" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] });

      await service.fetchTrendingRepos();

      expect(mockMongodb.linkResourceToRawData).toHaveBeenCalledWith(
        "mongo-id-abc",
        "resource-id-1",
      );
    });

    it("counts success even when README fetch fails", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } }) // search
        .mockResolvedValueOnce({ data: repo }) // repo data
        .mockRejectedValueOnce(new Error("README not found")) // readme
        .mockResolvedValueOnce({ data: {} }) // languages
        .mockResolvedValueOnce({ data: [] }); // contributors

      const count = await service.fetchTrendingRepos();

      // README failure should be handled gracefully, repo still processed
      expect(count).toBe(1);
    });
  });

  // ── searchRepositories ───────────────────────────────────────────────────────

  describe("searchRepositories", () => {
    it("searches repositories by query string", async () => {
      const repo = makeRepo();

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [repo] } })
        .mockResolvedValueOnce({ data: repo })
        .mockResolvedValueOnce({ data: "README" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] });

      const count = await service.searchRepositories("typescript testing");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("/search/repositories"),
        expect.objectContaining({
          params: expect.objectContaining({
            q: "typescript testing",
          }),
        }),
      );
      expect(count).toBe(1);
    });

    it("uses maxResults to limit results", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await service.searchRepositories("test query", 5);

      const firstCall = mockedAxios.get.mock.calls[0];
      expect(firstCall[1].params.per_page).toBe(5);
    });

    it("returns 0 when no repositories match", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      const count = await service.searchRepositories(
        "very-specific-nonexistent-query",
      );

      expect(count).toBe(0);
    });

    it("throws when GitHub API request fails", async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error("API error"));

      await expect(service.searchRepositories("test")).rejects.toThrow(
        "API error",
      );
    });

    it("processes multiple repos and returns total success count", async () => {
      const repos = [
        makeRepo({
          full_name: "owner/repo1",
          html_url: "https://github.com/owner/repo1",
        }),
        makeRepo({
          full_name: "owner/repo2",
          html_url: "https://github.com/owner/repo2",
        }),
      ];

      mockPrisma.resource.create
        .mockResolvedValueOnce({ id: "resource-1" })
        .mockResolvedValueOnce({ id: "resource-2" });

      mockMongodb.findRawDataById
        .mockResolvedValueOnce({ resourceId: "resource-1" })
        .mockResolvedValueOnce({ resourceId: "resource-2" });

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: repos } }) // search
        // repo 1 data
        .mockResolvedValueOnce({ data: repos[0] })
        .mockResolvedValueOnce({ data: "README 1" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] })
        // repo 2 data
        .mockResolvedValueOnce({ data: repos[1] })
        .mockResolvedValueOnce({ data: "README 2" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] });

      const count = await service.searchRepositories("test", 10);

      expect(count).toBe(2);
    });
  });

  // ── quality score calculation ─────────────────────────────────────────────────

  describe("quality score calculation (via processRepository)", () => {
    it("calculates higher quality score for repos with more stars", async () => {
      const lowStarRepo = makeRepo({
        full_name: "owner/low-stars",
        html_url: "https://github.com/owner/low-stars",
        stargazers_count: 10,
        forks_count: 0,
      });
      const highStarRepo = makeRepo({
        full_name: "owner/high-stars",
        html_url: "https://github.com/owner/high-stars",
        stargazers_count: 10000,
        forks_count: 500,
      });

      const createdResources: unknown[] = [];
      mockPrisma.resource.create.mockImplementation(
        (args: { data: unknown }) => {
          createdResources.push(args.data);
          return Promise.resolve({ id: `resource-${createdResources.length}` });
        },
      );

      mockMongodb.findRawDataById.mockImplementation(() =>
        Promise.resolve({ resourceId: `resource-${createdResources.length}` }),
      );

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [lowStarRepo, highStarRepo] } })
        // low star repo
        .mockResolvedValueOnce({ data: lowStarRepo })
        .mockResolvedValueOnce({ data: null }) // no readme
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] })
        // high star repo
        .mockResolvedValueOnce({ data: highStarRepo })
        .mockResolvedValueOnce({ data: "# README" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] });

      await service.fetchTrendingRepos();

      // Both should have been created
      expect(createdResources.length).toBe(2);

      const lowData = createdResources[0] as Record<string, unknown>;
      const highData = createdResources[1] as Record<string, unknown>;

      expect(Number(highData.qualityScore)).toBeGreaterThan(
        Number(lowData.qualityScore),
      );
    });

    it("stores Organization repos with organizations field", async () => {
      const orgRepo = makeRepo({
        owner: {
          login: "MyOrg",
          id: 100,
          avatar_url: "https://github.com/avatars/myorg",
          url: "https://api.github.com/orgs/MyOrg",
          type: "Organization",
        },
      });

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [orgRepo] } })
        .mockResolvedValueOnce({ data: orgRepo })
        .mockResolvedValueOnce({ data: "README" })
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: [] });

      await service.fetchTrendingRepos();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizations: ["MyOrg"],
          }),
        }),
      );
    });
  });

  // ── auth token configuration ─────────────────────────────────────────────────

  describe("auth token configuration", () => {
    it("does not add Authorization header when token is not configured", async () => {
      // Re-create service without token
      mockConfig.get.mockReturnValue("");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GithubService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: RawDataService, useValue: mockMongodb },
          { provide: DeduplicationService, useValue: mockDeduplication },
          { provide: ConfigService, useValue: mockConfig },
        ],
      }).compile();

      const serviceNoToken = module.get<GithubService>(GithubService);

      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await serviceNoToken.fetchTrendingRepos();

      const requestConfig = mockedAxios.get.mock.calls[0][1];
      expect(requestConfig.headers.Authorization).toBeUndefined();
    });

    it("adds Authorization header when valid token is configured", async () => {
      mockedAxios.get = jest
        .fn()
        .mockResolvedValueOnce({ data: { items: [] } });

      await service.fetchTrendingRepos();

      const requestConfig = mockedAxios.get.mock.calls[0][1];
      expect(requestConfig.headers.Authorization).toBe(
        "token ghp_test_token_123",
      );
    });
  });
});
