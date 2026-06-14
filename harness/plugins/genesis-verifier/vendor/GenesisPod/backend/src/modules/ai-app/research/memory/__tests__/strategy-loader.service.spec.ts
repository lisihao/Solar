import { Logger } from "@nestjs/common";
import { StrategyLoaderService } from "../strategy-loader.service";
import * as fs from "fs";

describe("StrategyLoaderService", () => {
  let service: StrategyLoaderService;
  let readFileSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    service = new StrategyLoaderService();
  });

  afterEach(() => {
    if (readFileSpy) readFileSpy.mockRestore();
  });

  describe("onModuleInit / loadStrategies", () => {
    it("parses search/demo/agent rules from markdown", () => {
      const md = [
        "# Strategies",
        "",
        "## Search Rules",
        "- TECHNICAL_TOPIC: use deep search",
        "- ALL: cite sources",
        "",
        "## Demo Rules",
        "- PRODUCT_RESEARCH: include screenshots",
        "",
        "## Agent Config Rules",
        "- MARKET_RESEARCH: assign analyst",
      ].join("\n");
      readFileSpy = jest.spyOn(fs, "readFileSync").mockReturnValue(md);

      service.onModuleInit();

      const all = service.getAllStrategies();
      expect(all).toHaveLength(4);
      expect(all.find((r) => r.condition === "ALL")?.category).toBe("search");
      expect(
        all.find((r) => r.condition === "PRODUCT_RESEARCH")?.category,
      ).toBe("demo");
      expect(all.find((r) => r.condition === "MARKET_RESEARCH")?.category).toBe(
        "agent",
      );
    });

    it("falls back to empty list when file read fails", () => {
      readFileSpy = jest.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("ENOENT");
      });

      service.onModuleInit();
      expect(service.getAllStrategies()).toEqual([]);
    });

    it("ignores rules without a colon", () => {
      readFileSpy = jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue(
          "## Search Rules\n- INVALID_LINE_NO_COLON\n- VALID: action",
        );
      service.onModuleInit();
      expect(service.getAllStrategies()).toHaveLength(1);
    });

    it("ignores rules with empty condition or action", () => {
      readFileSpy = jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue(
          "## Search Rules\n- :empty-condition\n- has-condition:",
        );
      service.onModuleInit();
      expect(service.getAllStrategies()).toEqual([]);
    });
  });

  describe("getApplicableStrategies", () => {
    beforeEach(() => {
      const md = [
        "## Search Rules",
        "- ALL: always rule",
        "- PRODUCT_RESEARCH: product rule",
        "- MARKET_DATA: market rule",
        "- GLOBAL_TOPIC: global rule",
        "- TECHNOLOGY_RESEARCH: tech rule",
        "- AUDIENCE_RESEARCH: aud rule",
        "- CURRENT_EVENTS: trend rule",
        "- STRATEGY_RESEARCH: strategy rule",
      ].join("\n");
      readFileSpy = jest.spyOn(fs, "readFileSync").mockReturnValue(md);
      service.onModuleInit();
    });

    it("includes ALL rules for any topic type", () => {
      const r = service.getApplicableStrategies("product");
      expect(r.find((x) => x.condition === "ALL")).toBeTruthy();
    });

    it("matches product topic to PRODUCT_RESEARCH", () => {
      const r = service.getApplicableStrategies("product");
      expect(r.find((x) => x.condition === "PRODUCT_RESEARCH")).toBeTruthy();
    });

    it("matches market topic to MARKET_DATA + GLOBAL_TOPIC", () => {
      const r = service.getApplicableStrategies("market");
      expect(r.find((x) => x.condition === "MARKET_DATA")).toBeTruthy();
      expect(r.find((x) => x.condition === "GLOBAL_TOPIC")).toBeTruthy();
    });

    it("matches technology topic to TECHNOLOGY_RESEARCH", () => {
      const r = service.getApplicableStrategies("technology");
      expect(r.find((x) => x.condition === "TECHNOLOGY_RESEARCH")).toBeTruthy();
    });

    it("matches audience topic to AUDIENCE_RESEARCH + GLOBAL_TOPIC", () => {
      const r = service.getApplicableStrategies("audience");
      expect(r.find((x) => x.condition === "AUDIENCE_RESEARCH")).toBeTruthy();
    });

    it("matches trend topic to CURRENT_EVENTS + GLOBAL_TOPIC", () => {
      const r = service.getApplicableStrategies("trend");
      expect(r.find((x) => x.condition === "CURRENT_EVENTS")).toBeTruthy();
    });

    it("matches strategy topic to STRATEGY_RESEARCH", () => {
      const r = service.getApplicableStrategies("strategy");
      expect(r.find((x) => x.condition === "STRATEGY_RESEARCH")).toBeTruthy();
    });

    it("falls back to ALL only for unknown topic types", () => {
      const r = service.getApplicableStrategies("unknown");
      expect(r.every((x) => x.condition === "ALL")).toBe(true);
    });
  });

  describe("getAllStrategies", () => {
    it("returns a copy (mutation safe)", () => {
      readFileSpy = jest
        .spyOn(fs, "readFileSync")
        .mockReturnValue("## Search Rules\n- ALL: a");
      service.onModuleInit();
      const a = service.getAllStrategies();
      a.pop();
      expect(service.getAllStrategies()).toHaveLength(1);
    });
  });
});
