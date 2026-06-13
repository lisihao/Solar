/**
 * CrossCuttingSynthesisService — supplemental branch coverage
 *
 * Targets:
 *  - Lines 218-221: parseResponse catch block (invalid JSON after regex match)
 */

import { CrossCuttingSynthesisService } from "../cross-cutting-synthesis.service";

describe("CrossCuttingSynthesisService (branch supplement)", () => {
  let service: CrossCuttingSynthesisService;

  beforeEach(() => {
    service = new CrossCuttingSynthesisService();
  });

  describe("parseResponse — catch branch", () => {
    it("falls back to emptyParsed when JSON brace-match content is invalid JSON", () => {
      // The regex /\{[\s\S]*\}/ matches but JSON.parse throws
      const invalidJson = "{broken: not-valid-json, missing: quotes}";
      const result = service.parseResponse(invalidJson);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("");
    });

    it("falls back to emptyParsed when response has no JSON object at all", () => {
      const noJson = "Plain text response without any JSON object here.";
      const result = service.parseResponse(noJson);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
    });
  });
});
