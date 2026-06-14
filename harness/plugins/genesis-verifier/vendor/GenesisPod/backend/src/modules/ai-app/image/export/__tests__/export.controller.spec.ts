import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ExportController } from "../export.controller";
import { ExportService } from "../export.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";

describe("ExportController", () => {
  let controller: ExportController;
  let exportService: jest.Mocked<ExportService>;

  const mockExportService = {
    export: jest.fn(),
    exportToPNG: jest.fn(),
    exportToSVG: jest.fn(),
    exportToPDF: jest.fn(),
  };

  const validExportDto = {
    html: "<html><body>Test</body></html>",
    width: 1200,
    height: 800,
    format: "png" as const,
  };

  const mockSuccessResult = {
    success: true,
    url: "https://example.com/image.png",
    format: "png" as const,
    fileSize: 12345,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [{ provide: ExportService, useValue: mockExportService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ExportController>(ExportController);
    exportService = module.get(ExportService);
  });

  describe("export", () => {
    it("should call exportService.export with correct arguments and return result", async () => {
      mockExportService.export.mockResolvedValue(mockSuccessResult);

      const result = await controller.export(validExportDto);

      expect(result).toEqual(mockSuccessResult);
      expect(exportService.export).toHaveBeenCalledWith(
        validExportDto.html,
        validExportDto.width,
        validExportDto.height,
        {
          format: "png",
          scale: undefined,
          quality: undefined,
          pageSize: undefined,
        },
      );
    });

    it("should pass optional scale and quality to options", async () => {
      mockExportService.export.mockResolvedValue(mockSuccessResult);
      const dto = { ...validExportDto, scale: 2 as const, quality: 90 };

      await controller.export(dto);

      expect(exportService.export).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        expect.objectContaining({ scale: 2, quality: 90 }),
      );
    });

    it("should pass optional pageSize to options", async () => {
      mockExportService.export.mockResolvedValue(mockSuccessResult);
      const dto = {
        ...validExportDto,
        format: "pdf" as const,
        pageSize: "a4" as const,
      };

      await controller.export(dto);

      expect(exportService.export).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        expect.objectContaining({ pageSize: "a4" }),
      );
    });

    it("should throw BadRequestException when html is missing", async () => {
      const dto = { ...validExportDto, html: "" };

      await expect(controller.export(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.export(dto)).rejects.toThrow(
        "HTML content is required",
      );
    });

    it("should throw BadRequestException when width is 0", async () => {
      const dto = { ...validExportDto, width: 0 };

      await expect(controller.export(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.export(dto)).rejects.toThrow(
        "Width and height are required",
      );
    });

    it("should throw BadRequestException when height is 0", async () => {
      const dto = { ...validExportDto, height: 0 };

      await expect(controller.export(dto)).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid format", async () => {
      const dto = { ...validExportDto, format: "bmp" as never };

      await expect(controller.export(dto)).rejects.toThrow(BadRequestException);
      await expect(controller.export(dto)).rejects.toThrow("Invalid format");
    });

    it("should accept all valid formats: png, svg, pdf, pptx", async () => {
      const formats = ["png", "svg", "pdf", "pptx"] as const;
      for (const format of formats) {
        mockExportService.export.mockResolvedValue({
          ...mockSuccessResult,
          format,
        });
        const dto = { ...validExportDto, format };
        await expect(controller.export(dto)).resolves.toBeDefined();
      }
    });

    it("should throw BadRequestException when result.success is false", async () => {
      mockExportService.export.mockResolvedValue({
        success: false,
        format: "png" as const,
        error: "Render failed",
      });

      await expect(controller.export(validExportDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.export(validExportDto)).rejects.toThrow(
        "Render failed",
      );
    });

    it('should throw generic "Export failed" message when result.success false with no error', async () => {
      mockExportService.export.mockResolvedValue({
        success: false,
        format: "png" as const,
      });

      await expect(controller.export(validExportDto)).rejects.toThrow(
        "Export failed",
      );
    });
  });

  describe("exportPng", () => {
    it("should call exportService.exportToPNG with correct arguments", async () => {
      const mockResult = {
        success: true,
        format: "png" as const,
        base64: "abc",
      };
      mockExportService.exportToPNG.mockResolvedValue(mockResult);

      const dto = { html: "<html></html>", width: 1200, height: 800 };
      const result = await controller.exportPng(dto);

      expect(result).toEqual(mockResult);
      expect(exportService.exportToPNG).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        { format: "png", scale: undefined },
      );
    });

    it("should pass scale option when provided", async () => {
      mockExportService.exportToPNG.mockResolvedValue({
        success: true,
        format: "png" as const,
      });
      const dto = {
        html: "<html></html>",
        width: 1200,
        height: 800,
        scale: 2 as const,
      };

      await controller.exportPng(dto);

      expect(exportService.exportToPNG).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        { format: "png", scale: 2 },
      );
    });
  });

  describe("exportSvg", () => {
    it("should call exportService.exportToSVG with correct arguments", async () => {
      const mockResult = {
        success: true,
        format: "svg" as const,
        base64: "svgdata",
      };
      mockExportService.exportToSVG.mockResolvedValue(mockResult);

      const dto = { html: "<html></html>", width: 800, height: 600 };
      const result = await controller.exportSvg(dto);

      expect(result).toEqual(mockResult);
      expect(exportService.exportToSVG).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
      );
    });
  });

  describe("exportPdf", () => {
    it("should call exportService.exportToPDF with correct arguments", async () => {
      const mockResult = { success: true, format: "pdf" as const };
      mockExportService.exportToPDF.mockResolvedValue(mockResult);

      const dto = { html: "<html></html>", width: 1200, height: 800 };
      const result = await controller.exportPdf(dto);

      expect(result).toEqual(mockResult);
      expect(exportService.exportToPDF).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        { format: "pdf", pageSize: undefined },
      );
    });

    it("should pass pageSize option when provided", async () => {
      mockExportService.exportToPDF.mockResolvedValue({
        success: true,
        format: "pdf" as const,
      });
      const dto = {
        html: "<html></html>",
        width: 1200,
        height: 800,
        pageSize: "a4" as const,
      };

      await controller.exportPdf(dto);

      expect(exportService.exportToPDF).toHaveBeenCalledWith(
        dto.html,
        dto.width,
        dto.height,
        { format: "pdf", pageSize: "a4" },
      );
    });
  });
});
