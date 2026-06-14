import {
  dataSourceToToolId,
  toolIdToDataSource,
  convertToolsToDataSources,
} from "../data-source-mapping.config";
import { DataSourceType } from "../../types/data-source.types";

describe("data-source-mapping.config", () => {
  describe("dataSourceToToolId", () => {
    it("should map WEB to web-search", () => {
      expect(dataSourceToToolId(DataSourceType.WEB)).toBe("web-search");
    });

    it("should map ACADEMIC to arxiv-search", () => {
      expect(dataSourceToToolId(DataSourceType.ACADEMIC)).toBe("arxiv-search");
    });

    it("should map GITHUB to github-search", () => {
      expect(dataSourceToToolId(DataSourceType.GITHUB)).toBe("github-search");
    });

    it("should map HACKERNEWS to hackernews-search", () => {
      expect(dataSourceToToolId(DataSourceType.HACKERNEWS)).toBe(
        "hackernews-search",
      );
    });

    it("should map SEMANTIC_SCHOLAR to semantic-scholar", () => {
      expect(dataSourceToToolId(DataSourceType.SEMANTIC_SCHOLAR)).toBe(
        "semantic-scholar",
      );
    });

    it("should map PUBMED to pubmed", () => {
      expect(dataSourceToToolId(DataSourceType.PUBMED)).toBe("pubmed");
    });

    it("should map OPENALEX to openalex-search", () => {
      expect(dataSourceToToolId(DataSourceType.OPENALEX)).toBe(
        "openalex-search",
      );
    });

    it("should return null for unmapped source (LOCAL)", () => {
      expect(dataSourceToToolId(DataSourceType.LOCAL)).toBeNull();
    });

    it("should return null for unmapped source (RSS)", () => {
      expect(dataSourceToToolId(DataSourceType.RSS)).toBeNull();
    });
  });

  describe("toolIdToDataSource", () => {
    it("should map web-search to WEB", () => {
      expect(toolIdToDataSource("web-search")).toBe(DataSourceType.WEB);
    });

    it("should map academic-search alias to ACADEMIC", () => {
      expect(toolIdToDataSource("academic-search")).toBe(
        DataSourceType.ACADEMIC,
      );
    });

    it("should map hn alias to HACKERNEWS", () => {
      expect(toolIdToDataSource("hn")).toBe(DataSourceType.HACKERNEWS);
    });

    it("should map twitter alias to SOCIAL_X", () => {
      expect(toolIdToDataSource("twitter")).toBe(DataSourceType.SOCIAL_X);
    });

    it("should map x-twitter alias to SOCIAL_X", () => {
      expect(toolIdToDataSource("x-twitter")).toBe(DataSourceType.SOCIAL_X);
    });

    it("should map openalex alias to OPENALEX", () => {
      expect(toolIdToDataSource("openalex")).toBe(DataSourceType.OPENALEX);
    });

    it("should map finance alias to FINANCE_API", () => {
      expect(toolIdToDataSource("finance")).toBe(DataSourceType.FINANCE_API);
    });

    it("should map weather alias to WEATHER_API", () => {
      expect(toolIdToDataSource("weather")).toBe(DataSourceType.WEATHER_API);
    });

    it("should return null for empty string", () => {
      expect(toolIdToDataSource("")).toBeNull();
    });

    it("should return null for unknown tool id", () => {
      expect(toolIdToDataSource("unknown-tool")).toBeNull();
    });

    it("should handle case-insensitive mapping", () => {
      expect(toolIdToDataSource("WEB-SEARCH")).toBe(DataSourceType.WEB);
    });
  });

  describe("convertToolsToDataSources", () => {
    it("should convert tool list to unique data sources", () => {
      const sources = convertToolsToDataSources([
        "web-search",
        "arxiv-search",
        "github-search",
      ]);
      expect(sources).toContain(DataSourceType.WEB);
      expect(sources).toContain(DataSourceType.ACADEMIC);
      expect(sources).toContain(DataSourceType.GITHUB);
    });

    it("should deduplicate sources from aliases", () => {
      // Both 'arxiv-search' and 'academic-search' map to ACADEMIC
      const sources = convertToolsToDataSources([
        "arxiv-search",
        "academic-search",
      ]);
      expect(sources.filter((s) => s === DataSourceType.ACADEMIC)).toHaveLength(
        1,
      );
    });

    it("should skip unknown tool ids", () => {
      const sources = convertToolsToDataSources(["unknown-tool"]);
      expect(sources).toHaveLength(0);
    });

    it("should return empty array for empty input", () => {
      const sources = convertToolsToDataSources([]);
      expect(sources).toHaveLength(0);
    });

    it("should handle mixed known and unknown tools", () => {
      const sources = convertToolsToDataSources(["web", "unknown-tool-xyz"]);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe(DataSourceType.WEB);
    });
  });
});
