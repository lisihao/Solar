/**
 * MinerUService Unit Tests
 *
 * Covers:
 * - parsePdf(): api mode, cli mode, auto mode fallback, all methods fail
 * - parseViaApi(): success, invalid input, API error response
 * - parseViaCli(): success from Buffer, file path, no md output, exec error
 * - checkAvailability(): API available, CLI available, neither available
 * - word counting and page estimation helpers
 */

// Mock heavy native modules before any imports
jest.mock("fs");
jest.mock("child_process");

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import * as fs from "fs";
import * as childProcess from "child_process";
import { MinerUService } from "../mineru.service";

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

// Helper: build a minimal Axios-like response
function axiosResponse(data: unknown) {
  return of({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  } as any);
}

// Build service with a given MINERU_MODE
async function buildService(
  mode: string,
  httpService: Partial<HttpService>,
): Promise<MinerUService> {
  const configService = {
    get: jest.fn().mockImplementation((key: string) => {
      const map: Record<string, string> = {
        MINERU_MODE: mode,
        MINERU_API_ENDPOINT: "http://localhost:8765",
        MINERU_API_KEY: "test-key",
        MINERU_CLI_PATH: "mineru",
        MINERU_TIMEOUT: "120000",
        MINERU_MAX_PAGES: "50",
      };
      return map[key];
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MinerUService,
      { provide: ConfigService, useValue: configService },
      { provide: HttpService, useValue: httpService },
    ],
  }).compile();

  return module.get<MinerUService>(MinerUService);
}

// Mock exec to succeed
function mockExecSuccess(stdout = "", stderr = "") {
  (mockChildProcess.exec as jest.Mock).mockImplementation(
    (_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout, stderr });
    },
  );
}

// Mock exec to fail
function mockExecFail(errMsg: string) {
  (mockChildProcess.exec as jest.Mock).mockImplementation(
    (_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error(errMsg), { stdout: "", stderr: "" });
    },
  );
}

describe("MinerUService", () => {
  let mockHttpService: { post: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHttpService = { post: jest.fn(), get: jest.fn() };
  });

  // ==================== parsePdf — API mode ====================

  describe("parsePdf() - api mode", () => {
    let service: MinerUService;

    beforeEach(async () => {
      service = await buildService("api", mockHttpService as any);
    });

    it("should parse PDF from Buffer via API successfully", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content:
            "# Doc\n\nWords here. ![img](x.png)\n\n| col | val |\n$$ formula $$",
          metadata: { page_count: 5 },
          images: [{ index: 0 }],
          tables: [{ html: "<table/>" }],
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf-bytes"));

      expect(result.success).toBe(true);
      expect(result.metadata.method).toBe("api");
      expect(result.metadata.pageCount).toBe(5);
      expect(result.metadata.hasImages).toBe(true);
      expect(result.metadata.hasTables).toBe(true);
      expect(result.metadata.hasFormulas).toBe(true);
      expect(result.metadata.parseTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it("should parse PDF from file path via API", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(Buffer.from("data"));

      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "file parsed",
          metadata: { page_count: 1 },
        }),
      );

      const result = await service.parsePdf("/path/to/doc.pdf");

      expect(result.success).toBe(true);
      expect(result.metadata.method).toBe("api");
    });

    it("should return failure when API returns success=false", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({ success: false, error: "Parse failed" }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(false);
      // parsePdf returns generic "All MinerU parsing methods failed" when API fails in api mode
      expect(result.error).toBeDefined();
    });

    it("should return failure when API throws network error", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("ECONNREFUSED")),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return failure for invalid non-existent file path", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.parsePdf("/nonexistent.pdf");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should detect LaTeX inline formula \\( in content", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "Formula: \\( x^2 \\)",
          metadata: { page_count: 1 },
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.hasFormulas).toBe(true);
    });
  });

  // ==================== parsePdf — CLI mode ====================

  describe("parsePdf() - cli mode", () => {
    let service: MinerUService;

    beforeEach(async () => {
      service = await buildService("cli", mockHttpService as any);
    });

    it("should parse Buffer via CLI and return markdown content", async () => {
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockImplementation((p: fs.PathLike) =>
        String(p).includes("images") ? [] : ["output.md"],
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        "# CLI Content\nParsed via CLI.",
      );
      (mockFs.existsSync as jest.Mock).mockImplementation(
        (p: fs.PathLike) => !String(p).includes("images"),
      );

      mockExecSuccess();

      const result = await service.parsePdf(Buffer.from("fake-pdf"));

      expect(result.success).toBe(true);
      expect(result.metadata.method).toBe("cli");
      expect(result.content).toContain("CLI Content");
    });

    it("should extract base64 images when images directory exists", async () => {
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockImplementation((p: fs.PathLike) =>
        String(p).includes("images")
          ? (["img1.png", "img2.jpg"] as any)
          : (["doc.md"] as any),
      );
      (mockFs.readFileSync as jest.Mock).mockImplementation(
        (p: fs.PathLike | number) =>
          String(p).endsWith(".md")
            ? "Content with ![i](img1.png)"
            : Buffer.from("imagedata"),
      );
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);

      mockExecSuccess();

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(true);
      expect(result.images).toHaveLength(2);
      expect(result.metadata.hasImages).toBe(true);
    });

    it("should return failure when no markdown file found in output", async () => {
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["doc.txt"] as any);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      mockExecSuccess();

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(false);
      // parsePdf returns generic message when CLI fails in cli mode
      expect(result.error).toBeDefined();
    });

    it("should return failure when CLI exec fails", async () => {
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      mockExecFail("mineru: command not found");

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should parse from existing file path (skip write)", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["file.md"] as any);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("file content");

      mockExecSuccess();

      const result = await service.parsePdf("/existing/doc.pdf");

      expect(result.success).toBe(true);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should return failure for non-existent file path in CLI mode", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const result = await service.parsePdf("/nope.pdf");

      expect(result.success).toBe(false);
      // parsePdf returns generic message when CLI fails in cli mode
      expect(result.error).toBeDefined();
    });

    it("should log warning when exec produces stderr without INFO", async () => {
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["out.md"] as any);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("content");
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      mockExecSuccess("", "WARNING: something went wrong");

      const result = await service.parsePdf(Buffer.from("pdf"));

      // Should still succeed even with stderr (as long as output .md exists)
      expect(result.success).toBe(true);
    });
  });

  // ==================== parsePdf — auto mode ====================

  describe("parsePdf() - auto mode", () => {
    let service: MinerUService;

    beforeEach(async () => {
      service = await buildService("auto", mockHttpService as any);
    });

    it("should succeed via API in auto mode", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "auto content",
          metadata: { page_count: 2 },
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(true);
      expect(result.metadata.method).toBe("api");
    });

    it("should fall back to CLI when API fails in auto mode", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("API down")),
      );

      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["auto.md"] as any);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("auto cli content");
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      mockExecSuccess();

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.method).toBe("cli");
    });

    it("should return fallback failure when both API and CLI fail", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("API error")),
      );
      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      mockExecFail("CLI crash");

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.success).toBe(false);
      expect(result.metadata.method).toBe("fallback");
      expect(result.error).toContain("All MinerU parsing methods failed");
    });
  });

  // ==================== checkAvailability ====================

  describe("checkAvailability()", () => {
    let service: MinerUService;

    beforeEach(async () => {
      service = await buildService("api", mockHttpService as any);
    });

    it("should return api when health check returns 200", async () => {
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: "OK" } as any),
      );

      const result = await service.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.mode).toBe("api");
      expect(result.message).toContain("API available");
    });

    it("should return cli when API fails but CLI outputs mineru version", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Connection refused")),
      );
      mockExecSuccess("mineru version 1.0.0");

      const result = await service.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.mode).toBe("cli");
    });

    it("should return cli when CLI outputs MinerU version", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("No API")),
      );
      mockExecSuccess("MinerU v2.0");

      const result = await service.checkAvailability();

      expect(result.available).toBe(true);
      expect(result.mode).toBe("cli");
    });

    it("should return none when both API and CLI unavailable", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("No API")),
      );
      mockExecFail("not found");

      const result = await service.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.mode).toBe("none");
      expect(result.message).toContain("not available");
    });

    it("should return none when CLI stdout does not match mineru", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("No API")),
      );
      mockExecSuccess("some-other-tool v1.0");

      const result = await service.checkAvailability();

      expect(result.available).toBe(false);
      expect(result.mode).toBe("none");
    });
  });

  // ==================== Word counting and page estimation ====================

  describe("word counting and page estimation (via parsePdf)", () => {
    let service: MinerUService;

    beforeEach(async () => {
      service = await buildService("api", mockHttpService as any);
    });

    it("should count Chinese characters and English words separately", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "Hello world 你好世界 testing",
          metadata: { page_count: 1 },
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      // "Hello", "world", "testing" = 3 English; "你好世界" = 4 Chinese = 7 total
      expect(result.metadata.wordCount).toBe(7);
    });

    it("should return 0 wordCount for empty content", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "",
          metadata: { page_count: 1 },
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.wordCount).toBe(0);
    });

    it("should estimate at least 1 page from CLI short content", async () => {
      const cliService = await buildService("cli", mockHttpService as any);

      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["x.md"] as any);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("tiny");
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      mockExecSuccess();

      const result = await cliService.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.pageCount).toBeGreaterThanOrEqual(1);
    });

    it("should estimate multiple pages for long CLI content (> 3000 chars)", async () => {
      const cliService = await buildService("cli", mockHttpService as any);
      const longContent = "A".repeat(6001); // should give 3 pages

      (mockFs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.rmSync as jest.Mock).mockReturnValue(undefined);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(["long.md"] as any);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(longContent);
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      mockExecSuccess();

      const result = await cliService.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.pageCount).toBeGreaterThanOrEqual(3);
    });

    it("should detect table HTML tag in API content", async () => {
      mockHttpService.post.mockReturnValue(
        axiosResponse({
          success: true,
          content: "<table><tr><td>Data</td></tr></table>",
          metadata: { page_count: 1 },
        }),
      );

      const result = await service.parsePdf(Buffer.from("pdf"));

      expect(result.metadata.hasTables).toBe(true);
    });
  });
});
