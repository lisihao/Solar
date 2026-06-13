import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PubMedConnector } from "../pubmed.connector";
import { DataSourceType } from "../../../../types/data-source.types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockConfigService = {
  get: jest.fn(),
};

describe("PubMedConnector", () => {
  let connector: PubMedConnector;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PubMedConnector,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    connector = module.get<PubMedConnector>(PubMedConnector);
  });

  describe("connector metadata", () => {
    it("should have correct sourceType", () => {
      expect(connector.sourceType).toBe(DataSourceType.PUBMED);
    });

    it("should have correct displayName", () => {
      expect(connector.displayName).toBe("PubMed");
    });

    it("should not require API key", () => {
      expect(connector.requiresApiKey).toBe(false);
    });
  });

  describe("search", () => {
    it("should return results when PubMed returns articles", async () => {
      const mockEsearchResponse = {
        esearchresult: { idlist: ["12345678", "87654321"] },
      };
      const mockEsummaryResponse = {
        result: {
          "12345678": {
            title: "COVID-19 Treatment Study",
            pubdate: "2023 Jan",
            source: "NEJM",
            fulljournalname: "New England Journal of Medicine",
            elocationid: "10.1056/NEJMtest",
            authors: [{ name: "Smith J" }, { name: "Doe A" }],
          },
          "87654321": {
            title: "mRNA Vaccine Efficacy",
            pubdate: "2022 Dec",
            source: "Lancet",
            fulljournalname: "The Lancet",
            elocationid: "10.1016/lancettest",
            authors: [{ name: "Brown B" }],
          },
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockEsearchResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockEsummaryResponse),
        });

      const results = await connector.search("COVID-19 treatment", 10);

      expect(results).toHaveLength(2);
      expect(results[0].sourceType).toBe(DataSourceType.PUBMED);
      expect(results[0].title).toBe("COVID-19 Treatment Study");
      expect(results[0].url).toBe("https://pubmed.ncbi.nlm.nih.gov/12345678/");
      expect(results[0].domain).toBe("pubmed.ncbi.nlm.nih.gov");
      expect(results[0].metadata?.pmid).toBe("12345678");
      expect(results[0].metadata?.journal).toBe(
        "New England Journal of Medicine",
      );
      expect(results[0].metadata?.doi).toBe("10.1056/NEJMtest");
      expect(results[0].metadata?.authors).toEqual(["Smith J", "Doe A"]);
      expect(results[0].metadata?.sourceConnector).toBe("pubmed");
    });

    it("should return empty array when esearch returns no IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          esearchresult: { idlist: [] },
        }),
      });

      const results = await connector.search("nonexistent topic xyz", 10);

      expect(results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return empty array when esearch API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const results = await connector.search("test query", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when esummary API fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            esearchresult: { idlist: ["12345678"] },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const results = await connector.search("test query", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when esummary result is null", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            esearchresult: { idlist: ["12345678"] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ result: null }),
        });

      const results = await connector.search("test query", 5);

      expect(results).toEqual([]);
    });

    it("should skip articles without title in esummary", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            esearchresult: { idlist: ["11111111", "22222222"] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            result: {
              "11111111": { title: "Valid Article" },
              "22222222": {},
            },
          }),
        });

      const results = await connector.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid Article");
    });

    it("should handle network error gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const results = await connector.search("test query", 5);

      expect(results).toEqual([]);
    });

    it("should cap maxResults at 50", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          esearchresult: { idlist: [] },
        }),
      });

      await connector.search("test", 200);

      const firstCallUrl = mockFetch.mock.calls[0][0] as string;
      expect(firstCallUrl).toContain("retmax=50");
    });

    it("should include API key when configured", async () => {
      mockConfigService.get.mockReturnValue("test-ncbi-key");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PubMedConnector,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const connectorWithKey = module.get<PubMedConnector>(PubMedConnector);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          esearchresult: { idlist: [] },
        }),
      });

      await connectorWithKey.search("test", 5);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("api_key=test-ncbi-key");
    });

    it("should apply date sort when sortBy is date", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          esearchresult: { idlist: [] },
        }),
      });

      await connector.search("test", 5, { sortBy: "date" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("sort=pub_date");
    });

    it("should apply since date filter when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          esearchresult: { idlist: [] },
        }),
      });

      const since = new Date("2023-01-01");
      await connector.search("test", 5, { since });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("mindate=");
      expect(callUrl).toContain("datetype=pdat");
    });

    it("should parse publishedAt date when pubdate is present", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            esearchresult: { idlist: ["12345678"] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            result: {
              "12345678": {
                title: "Test Article",
                pubdate: "2023 Jan 15",
              },
            },
          }),
        });

      const results = await connector.search("test", 5);

      expect(results[0].publishedAt).toBeDefined();
      expect(results[0].publishedAt).toBeInstanceOf(Date);
    });

    it("should build snippet from authors and journal", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            esearchresult: { idlist: ["12345678"] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            result: {
              "12345678": {
                title: "Test Title",
                pubdate: "2023",
                fulljournalname: "Nature Medicine",
                authors: [{ name: "Author A" }, { name: "Author B" }],
              },
            },
          }),
        });

      const results = await connector.search("test", 5);

      expect(results[0].snippet).toContain("Author A");
      expect(results[0].snippet).toContain("Author B");
      expect(results[0].snippet).toContain("Nature Medicine");
    });
  });

  describe("isAvailable", () => {
    it("should return true when API is reachable", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const available = await connector.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when API returns error status", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });

    it("should return false when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("healthCheck", () => {
    it("should return available=true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const health = await connector.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeDefined();
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
      expect(health.error).toBeUndefined();
    });

    it("should return available=false when API fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should return error string when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toContain("Timeout");
      expect(health.lastChecked).toBeInstanceOf(Date);
    });
  });
});
