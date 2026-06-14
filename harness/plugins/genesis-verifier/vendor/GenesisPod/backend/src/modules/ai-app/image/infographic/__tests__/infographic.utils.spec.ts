import {
  escapeHtml,
  truncateText,
  adjustColor,
  getIcon,
} from "../infographic.utils";
import { DEFAULT_ICON, ICONS } from "../infographic.constants";

describe("infographic.utils", () => {
  describe("escapeHtml", () => {
    it("should escape ampersand", () => {
      expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("should escape less-than sign", () => {
      expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
    });

    it("should escape greater-than sign", () => {
      expect(escapeHtml("a > b")).toBe("a &gt; b");
    });

    it("should escape double quotes", () => {
      expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
    });

    it("should escape single quotes", () => {
      expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    it("should escape all special characters together", () => {
      expect(escapeHtml("& < > \" '")).toBe("&amp; &lt; &gt; &quot; &#039;");
    });

    it("should return plain text unchanged", () => {
      expect(escapeHtml("hello world")).toBe("hello world");
    });

    it("should return empty string for empty input", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("should handle text with no special characters", () => {
      const text = "Normal text 123";
      expect(escapeHtml(text)).toBe(text);
    });

    it("should handle multiple occurrences of the same character", () => {
      expect(escapeHtml("a & b & c")).toBe("a &amp; b &amp; c");
    });
  });

  describe("truncateText", () => {
    it("should return original text regardless of maxLength", () => {
      expect(truncateText("hello world", 5)).toBe("hello world");
    });

    it("should return text longer than maxLength unchanged", () => {
      const longText = "a".repeat(200);
      expect(truncateText(longText, 100)).toBe(longText);
    });

    it("should return empty string for empty input", () => {
      expect(truncateText("", 10)).toBe("");
    });

    it("should return text shorter than maxLength unchanged", () => {
      expect(truncateText("short", 100)).toBe("short");
    });

    it("should return text equal to maxLength unchanged", () => {
      expect(truncateText("12345", 5)).toBe("12345");
    });
  });

  describe("adjustColor", () => {
    it("should lighten a color by a positive amount", () => {
      const result = adjustColor("#000000", 100);
      expect(result).toBe("#646464");
    });

    it("should darken a color by a negative amount", () => {
      const result = adjustColor("#ffffff", -100);
      expect(result).toBe("#9b9b9b");
    });

    it("should clamp RGB values to 255 maximum", () => {
      const result = adjustColor("#ffffff", 50);
      expect(result).toBe("#ffffff");
    });

    it("should clamp RGB values to 0 minimum", () => {
      const result = adjustColor("#000000", -50);
      expect(result).toBe("#000000");
    });

    it("should handle a mid-range color", () => {
      const result = adjustColor("#808080", 0);
      expect(result).toBe("#808080");
    });

    it("should return 6-character hex string with # prefix", () => {
      const result = adjustColor("#123456", 10);
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("should adjust individual RGB channels independently", () => {
      // #ff0000 = R:255 G:0 B:0, amount=10 → R clamped 255, G=10, B=10
      const result = adjustColor("#ff0000", 10);
      expect(result).toBe("#ff0a0a");
    });
  });

  describe("getIcon", () => {
    it("should return DEFAULT_ICON when called with no argument", () => {
      expect(getIcon()).toBe(DEFAULT_ICON);
    });

    it("should return DEFAULT_ICON when called with undefined", () => {
      expect(getIcon(undefined)).toBe(DEFAULT_ICON);
    });

    it("should return DEFAULT_ICON for unknown type", () => {
      expect(getIcon("unknown_type_xyz")).toBe(DEFAULT_ICON);
    });

    it('should return correct icon for known type "target"', () => {
      expect(getIcon("target")).toBe(ICONS["target"]);
    });

    it('should return correct icon for known type "chart"', () => {
      expect(getIcon("chart")).toBe(ICONS["chart"]);
    });

    it('should return correct icon for known type "star"', () => {
      expect(getIcon("star")).toBe(ICONS["star"]);
    });

    it("should normalize uppercase input to lowercase", () => {
      expect(getIcon("TARGET")).toBe(ICONS["target"]);
    });

    it("should strip non-alphabetic characters during normalization", () => {
      expect(getIcon("tar-get")).toBe(ICONS["target"]);
    });

    it("should return DEFAULT_ICON for empty string", () => {
      // empty string after normalization: ICONS[''] is undefined → DEFAULT_ICON
      expect(getIcon("")).toBe(DEFAULT_ICON);
    });

    it('should return correct icon for "users"', () => {
      expect(getIcon("users")).toBe(ICONS["users"]);
    });

    it('should return correct icon for "check"', () => {
      expect(getIcon("check")).toBe(ICONS["check"]);
    });
  });
});
