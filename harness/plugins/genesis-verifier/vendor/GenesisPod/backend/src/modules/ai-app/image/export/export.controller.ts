/**
 * GenesisPod v2.1 - 导出 API 控制器
 */

import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { ExportService } from "./export.service";
import { ExportFormat, ExportOptions } from "../core/engine.types";

interface ExportRequestDto {
  html: string;
  width: number;
  height: number;
  format: ExportFormat;
  scale?: 1 | 2 | 3 | 4;
  quality?: number;
  pageSize?: "a4" | "letter" | "16:9" | "custom";
}

@ApiTags("AI Image - Export")
@Controller("ai-image/export")
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * 导出信息图
   */
  @Post()
  async export(@Body() dto: ExportRequestDto) {
    if (!dto.html) {
      throw new BadRequestException("HTML content is required");
    }

    if (!dto.width || !dto.height) {
      throw new BadRequestException("Width and height are required");
    }

    const validFormats: ExportFormat[] = ["png", "svg", "pdf", "pptx"];
    if (!validFormats.includes(dto.format)) {
      throw new BadRequestException(
        `Invalid format. Supported: ${validFormats.join(", ")}`,
      );
    }

    const options: ExportOptions = {
      format: dto.format,
      scale: dto.scale,
      quality: dto.quality,
      pageSize: dto.pageSize,
    };

    const result = await this.exportService.export(
      dto.html,
      dto.width,
      dto.height,
      options,
    );

    if (!result.success) {
      throw new BadRequestException(result.error || "Export failed");
    }

    return result;
  }

  /**
   * 导出为 PNG
   */
  @Post("png")
  async exportPng(
    @Body()
    dto: {
      html: string;
      width: number;
      height: number;
      scale?: 1 | 2 | 3 | 4;
    },
  ) {
    return this.exportService.exportToPNG(dto.html, dto.width, dto.height, {
      format: "png",
      scale: dto.scale,
    });
  }

  /**
   * 导出为 SVG
   */
  @Post("svg")
  async exportSvg(
    @Body() dto: { html: string; width: number; height: number },
  ) {
    return this.exportService.exportToSVG(dto.html, dto.width, dto.height);
  }

  /**
   * 导出为 PDF
   */
  @Post("pdf")
  async exportPdf(
    @Body()
    dto: {
      html: string;
      width: number;
      height: number;
      pageSize?: "a4" | "letter" | "16:9" | "custom";
    },
  ) {
    return this.exportService.exportToPDF(dto.html, dto.width, dto.height, {
      format: "pdf",
      pageSize: dto.pageSize,
    });
  }
}
