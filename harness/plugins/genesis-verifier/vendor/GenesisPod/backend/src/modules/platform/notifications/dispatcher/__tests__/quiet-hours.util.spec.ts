import { QuietHoursUtil } from "../preferences/quiet-hours.util";

describe("QuietHoursUtil (PR-DR1a R1 reuse 整改单源)", () => {
  const mk = (h: number, m: number) => new Date(Date.UTC(2026, 4, 18, h, m, 0));

  describe("timeInWindow", () => {
    it("同日窗口 08:00-12:00 现在 10:00 → in", () => {
      expect(QuietHoursUtil.timeInWindow(mk(10, 0), "08:00", "12:00")).toBe(
        true,
      );
    });

    it("同日窗口 08:00-12:00 现在 13:00 → out", () => {
      expect(QuietHoursUtil.timeInWindow(mk(13, 0), "08:00", "12:00")).toBe(
        false,
      );
    });

    it("同日窗口边界：start 含、end 不含", () => {
      expect(QuietHoursUtil.timeInWindow(mk(8, 0), "08:00", "12:00")).toBe(
        true,
      );
      expect(QuietHoursUtil.timeInWindow(mk(12, 0), "08:00", "12:00")).toBe(
        false,
      );
    });

    it("跨午夜 22:00-06:00 现在 23:00 → in", () => {
      expect(QuietHoursUtil.timeInWindow(mk(23, 0), "22:00", "06:00")).toBe(
        true,
      );
    });

    it("跨午夜 22:00-06:00 现在 05:00 → in", () => {
      expect(QuietHoursUtil.timeInWindow(mk(5, 0), "22:00", "06:00")).toBe(
        true,
      );
    });

    it("跨午夜 22:00-06:00 现在 12:00 → out", () => {
      expect(QuietHoursUtil.timeInWindow(mk(12, 0), "22:00", "06:00")).toBe(
        false,
      );
    });

    it("非法格式（包含字母）→ false", () => {
      expect(QuietHoursUtil.timeInWindow(mk(10, 0), "garbage", "06:00")).toBe(
        false,
      );
    });

    it("超出 24h 范围 → false", () => {
      expect(QuietHoursUtil.timeInWindow(mk(10, 0), "25:00", "26:00")).toBe(
        false,
      );
    });

    it("超出 60min 范围 → false", () => {
      expect(QuietHoursUtil.timeInWindow(mk(10, 0), "08:99", "12:00")).toBe(
        false,
      );
    });

    it("start === end → 视为关闭", () => {
      expect(QuietHoursUtil.timeInWindow(mk(10, 0), "10:00", "10:00")).toBe(
        false,
      );
    });
  });

  describe("parseHHMMToMinutes", () => {
    it("有效", () => {
      expect(QuietHoursUtil.parseHHMMToMinutes("08:30")).toBe(8 * 60 + 30);
      expect(QuietHoursUtil.parseHHMMToMinutes("23:59")).toBe(23 * 60 + 59);
      expect(QuietHoursUtil.parseHHMMToMinutes("00:00")).toBe(0);
    });

    it("无效格式 → null", () => {
      expect(QuietHoursUtil.parseHHMMToMinutes("8:30 AM")).toBeNull();
      expect(QuietHoursUtil.parseHHMMToMinutes("")).toBeNull();
      expect(QuietHoursUtil.parseHHMMToMinutes("24:00")).toBeNull();
      expect(QuietHoursUtil.parseHHMMToMinutes("12:60")).toBeNull();
    });
  });
});
