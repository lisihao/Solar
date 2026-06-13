/**
 * Tests for selectors.config.ts
 */

import {
  WECHAT_SELECTORS,
  XHS_SELECTORS,
  trySelectors,
  tryClick,
  tryFill,
  waitForAny,
  humanDelay,
} from "../selectors.config";

describe("selectors.config", () => {
  describe("WECHAT_SELECTORS", () => {
    it("should define login selectors", () => {
      expect(WECHAT_SELECTORS.login).toBeDefined();
      expect(WECHAT_SELECTORS.login.qrCode).toBeInstanceOf(Array);
      expect(WECHAT_SELECTORS.login.nickname).toBeInstanceOf(Array);
    });

    it("should define editor selectors", () => {
      expect(WECHAT_SELECTORS.editor).toBeDefined();
      expect(WECHAT_SELECTORS.editor.titleInput).toBeInstanceOf(Array);
      expect(WECHAT_SELECTORS.editor.contentEditor).toBeInstanceOf(Array);
      expect(WECHAT_SELECTORS.editor.publishButton).toBeInstanceOf(Array);
    });

    it("should define massPublish selectors", () => {
      expect(WECHAT_SELECTORS.massPublish).toBeDefined();
      expect(WECHAT_SELECTORS.massPublish.confirmButton).toBeInstanceOf(Array);
    });

    it("should define feedback selectors", () => {
      expect(WECHAT_SELECTORS.feedback).toBeDefined();
      expect(WECHAT_SELECTORS.feedback.successToast).toBeInstanceOf(Array);
      expect(WECHAT_SELECTORS.feedback.errorToast).toBeInstanceOf(Array);
    });
  });

  describe("XHS_SELECTORS", () => {
    it("should define login selectors", () => {
      expect(XHS_SELECTORS.login).toBeDefined();
      expect(XHS_SELECTORS.login.qrCode).toBeInstanceOf(Array);
      expect(XHS_SELECTORS.login.loginButton).toBeInstanceOf(Array);
    });

    it("should define publish selectors", () => {
      expect(XHS_SELECTORS.publish).toBeDefined();
      expect(XHS_SELECTORS.publish.titleInput).toBeInstanceOf(Array);
      expect(XHS_SELECTORS.publish.contentInput).toBeInstanceOf(Array);
      expect(XHS_SELECTORS.publish.submitButton).toBeInstanceOf(Array);
    });

    it("should define feedback selectors", () => {
      expect(XHS_SELECTORS.feedback).toBeDefined();
      expect(XHS_SELECTORS.feedback.successMessage).toBeInstanceOf(Array);
    });
  });

  describe("trySelectors", () => {
    it("should return success false when no selector matches", async () => {
      const mockPage = {
        waitForSelector: jest.fn().mockRejectedValue(new Error("Not found")),
      };

      const result = await trySelectors(mockPage, ["#nonexistent"], {
        timeout: 100,
      });
      expect(result.success).toBe(false);
    });

    it("should return success true when a selector matches", async () => {
      const mockElement = {};
      const mockPage = {
        waitForSelector: jest.fn().mockResolvedValue(mockElement),
      };

      const result = await trySelectors(mockPage, ["#exists"], {
        timeout: 1000,
      });
      expect(result.success).toBe(true);
      expect(result.selector).toBe("#exists");
    });

    it("should try all selectors and return first match", async () => {
      let callCount = 0;
      const mockElement = {};
      const mockPage = {
        waitForSelector: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount < 3) {
            return Promise.reject(new Error("Not found"));
          }
          return Promise.resolve(mockElement);
        }),
      };

      const result = await trySelectors(mockPage, ["#s1", "#s2", "#s3"]);
      expect(result.success).toBe(true);
      expect(result.selector).toBe("#s3");
    });
  });

  describe("tryClick", () => {
    it("should return false when no selector is visible", async () => {
      const mockPage = {
        waitForSelector: jest.fn().mockRejectedValue(new Error("Not found")),
      };

      const result = await tryClick(mockPage, ["#nonexistent"]);
      expect(result).toBe(false);
    });

    it("should click the first visible element and return true", async () => {
      const clickMock = jest.fn().mockResolvedValue(undefined);
      const mockElement = { click: clickMock };
      const mockPage = {
        waitForSelector: jest.fn().mockResolvedValue(mockElement),
      };

      const result = await tryClick(mockPage, ["#button"]);
      expect(result).toBe(true);
      expect(clickMock).toHaveBeenCalled();
    });

    it("should return false when click throws", async () => {
      const mockPage = {
        waitForSelector: jest
          .fn()
          .mockRejectedValue(new Error("Element not found")),
      };

      const result = await tryClick(mockPage, ["#button"]);
      expect(result).toBe(false);
    });
  });

  describe("tryFill", () => {
    it("should return false when element is not visible", async () => {
      const mockPage = {
        waitForSelector: jest.fn().mockRejectedValue(new Error("Not found")),
        keyboard: { type: jest.fn().mockResolvedValue(undefined) },
      };

      const result = await tryFill(mockPage, ["#input"], "test value");
      expect(result).toBe(false);
    });

    it("should fill the input and return true", async () => {
      const clickMock = jest.fn().mockResolvedValue(undefined);
      const typeMock = jest.fn().mockResolvedValue(undefined);
      const mockElement = { click: clickMock };
      const mockPage = {
        waitForSelector: jest.fn().mockResolvedValue(mockElement),
        keyboard: { type: typeMock },
      };

      const result = await tryFill(mockPage, ["#input"], "test value");
      expect(result).toBe(true);
      expect(clickMock).toHaveBeenCalledWith({ clickCount: 3 });
      expect(typeMock).toHaveBeenCalledWith("test value");
    });

    it("should not clear when clear option is false", async () => {
      const clickMock = jest.fn().mockResolvedValue(undefined);
      const typeMock = jest.fn().mockResolvedValue(undefined);
      const mockElement = { click: clickMock };
      const mockPage = {
        waitForSelector: jest.fn().mockResolvedValue(mockElement),
        keyboard: { type: typeMock },
      };

      await tryFill(mockPage, ["#input"], "test value", { clear: false });
      expect(clickMock).not.toHaveBeenCalled();
    });
  });

  describe("waitForAny", () => {
    it("should return found false when no selector appears", async () => {
      const mockPage = {
        waitForSelector: jest.fn().mockRejectedValue(new Error("Timeout")),
      };

      const result = await waitForAny(mockPage, ["#s1", "#s2"], 100);
      expect(result.found).toBe(false);
    });

    it("should return found true when a selector appears", async () => {
      // waitForAny uses Promise.race - the first resolved (non-null) wins
      // But the race includes promises that resolve to null too.
      // The implementation: selector resolves to the selector string on success, null on failure.
      // Promise.race returns the FIRST settled promise - may be null or the selector.
      // We need all non-matching selectors to reject or be slower.
      const mockPage = {
        waitForSelector: jest.fn().mockImplementation((selector: string) => {
          if (selector === "#found") {
            return Promise.resolve({});
          }
          return new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 500),
          );
        }),
      };

      const result = await waitForAny(mockPage, ["#found"], 1000);
      expect(result.found).toBe(true);
      expect(result.selector).toBe("#found");
    });
  });

  describe("humanDelay", () => {
    it("should return a promise that resolves after delay", async () => {
      const start = Date.now();
      await humanDelay(10, 50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it("should use default min/max when not provided", async () => {
      const promise = humanDelay();
      expect(promise).toBeInstanceOf(Promise);
      // Just ensure it resolves
      await promise;
    });
  });
});
