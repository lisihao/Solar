/**
 * Report Validation Service
 *
 * 报告验证服务 - 验证报告数据一致性
 *
 * 核心功能:
 * 1. 验证引用索引 - 确保 markdown 中的 [1], [2] 引用有效
 * 2. 验证图表引用 - 确保 figureReferences 中的索引和 URL 有效
 * 3. 验证图表数据 - 检查 NaN, Infinity, 饼图百分比等
 * 4. 验证跨维度一致性 - 检查冲突数据
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { ReportChart } from "../../types/report.types";

/**
 * 验证错误
 */
export interface ValidationError {
  type: string;
  message: string;
  severity: "ERROR" | "WARNING" | "INFO";
  location?: string;
  details?: Record<string, unknown>;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: {
    citationErrors: number;
    figureErrors: number;
    chartDataErrors: number;
    totalErrors: number;
    totalWarnings: number;
  };
}

@Injectable()
export class ReportValidationService {
  private readonly logger = new Logger(ReportValidationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 验证完整报告一致性
   */
  async validateReport(
    topicId: string,
    reportId: string,
  ): Promise<ValidationResult> {
    this.logger.log(`Validating report ${reportId} for topic ${topicId}`);

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 获取报告数据
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: {
        evidences: { orderBy: { citationIndex: "asc" } },
        dimensionAnalyses: {
          include: { dimension: true },
        },
      },
    });

    if (!report) {
      errors.push({
        type: "REPORT_NOT_FOUND",
        message: `Report ${reportId} not found`,
        severity: "ERROR",
      });
      return this.buildResult(errors, warnings);
    }

    // 1. 验证引用索引
    const citationErrors = this.validateCitationIndices(
      report.fullReport || "",
      report.evidences.length,
    );
    errors.push(...citationErrors.filter((e) => e.severity === "ERROR"));
    warnings.push(...citationErrors.filter((e) => e.severity === "WARNING"));

    // 2. 验证图表引用
    const charts = (report.charts as unknown as ReportChart[]) || [];
    const figureErrors = this.validateFigureReferences(
      charts,
      report.evidences.length,
    );
    errors.push(...figureErrors.filter((e) => e.severity === "ERROR"));
    warnings.push(...figureErrors.filter((e) => e.severity === "WARNING"));

    // 3. 验证图表数据
    const chartDataErrors = this.validateChartData(charts);
    warnings.push(...chartDataErrors);

    // 4. 验证跨维度一致性
    const consistencyWarnings = this.validateCrossDimensionData(
      report.dimensionAnalyses,
    );
    warnings.push(...consistencyWarnings);

    return this.buildResult(errors, warnings);
  }

  /**
   * 验证引用索引
   */
  private validateCitationIndices(
    markdown: string,
    evidenceCount: number,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!markdown || evidenceCount === 0) {
      return errors;
    }

    // 匹配 [1], [2], [12] 等引用格式
    const citationRegex = /\[(\d+)\]/g;
    let match;
    const seenCitations = new Set<number>();

    while ((match = citationRegex.exec(markdown)) !== null) {
      const index = parseInt(match[1], 10);
      seenCitations.add(index);

      if (index < 1 || index > evidenceCount) {
        errors.push({
          type: "INVALID_CITATION_INDEX",
          message: `Citation [${index}] out of range (valid: 1-${evidenceCount})`,
          severity: "ERROR",
          location: `Character ${match.index}`,
          details: {
            citedIndex: index,
            maxIndex: evidenceCount,
          },
        });
      }
    }

    // 检查是否有未引用的证据
    for (let i = 1; i <= evidenceCount; i++) {
      if (!seenCitations.has(i)) {
        errors.push({
          type: "UNUSED_EVIDENCE",
          message: `Evidence [${i}] is not cited in the report`,
          severity: "WARNING",
          details: { unusedIndex: i },
        });
      }
    }

    return errors;
  }

  /**
   * 验证图表引用
   */
  private validateFigureReferences(
    charts: ReportChart[],
    evidenceCount: number,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const seenIds = new Set<string>();

    charts.forEach((chart, idx) => {
      // 检查重复 ID
      if (seenIds.has(chart.id)) {
        errors.push({
          type: "DUPLICATE_CHART_ID",
          message: `Duplicate chart ID: ${chart.id}`,
          severity: "WARNING",
          location: `Chart ${idx}`,
          details: { chartId: chart.id },
        });
      }
      seenIds.add(chart.id);

      // 对于引用图表，验证证据索引
      if (chart.chartType === "reference") {
        if (chart.evidenceCitationIndex) {
          if (
            chart.evidenceCitationIndex < 1 ||
            chart.evidenceCitationIndex > evidenceCount
          ) {
            errors.push({
              type: "INVALID_FIGURE_EVIDENCE_INDEX",
              message: `Figure "${chart.title}" references invalid evidence [${chart.evidenceCitationIndex}]`,
              severity: "ERROR",
              location: `Chart ${chart.id}`,
              details: {
                chartId: chart.id,
                evidenceCitationIndex: chart.evidenceCitationIndex,
                maxIndex: evidenceCount,
              },
            });
          }
        }

        // 验证图片 URL
        if (!chart.imageUrl) {
          errors.push({
            type: "MISSING_IMAGE_URL",
            message: `Reference chart "${chart.title}" has no imageUrl`,
            severity: "ERROR",
            location: `Chart ${chart.id}`,
            details: { chartId: chart.id },
          });
        } else if (!this.isValidUrl(chart.imageUrl)) {
          errors.push({
            type: "INVALID_IMAGE_URL",
            message: `Reference chart "${chart.title}" has invalid imageUrl`,
            severity: "WARNING",
            location: `Chart ${chart.id}`,
            details: { chartId: chart.id, imageUrl: chart.imageUrl },
          });
        }
      }
    });

    return errors;
  }

  /**
   * 验证图表数据
   */
  private validateChartData(charts: ReportChart[]): ValidationError[] {
    const warnings: ValidationError[] = [];

    charts.forEach((chart) => {
      if (chart.chartType !== "generated" || !chart.data) {
        return;
      }

      // 检查数据点
      chart.data.forEach((point, idx) => {
        // 检查 NaN 或 Infinity
        if (typeof point.value !== "number" || !isFinite(point.value)) {
          warnings.push({
            type: "INVALID_DATA_VALUE",
            message: `Chart "${chart.title}" has invalid value at index ${idx}`,
            severity: "WARNING",
            location: `Chart ${chart.id}`,
            details: {
              chartId: chart.id,
              index: idx,
              value: point.value,
            },
          });
        }

        // 检查空标签
        if (!point.label || point.label.trim() === "") {
          warnings.push({
            type: "EMPTY_DATA_LABEL",
            message: `Chart "${chart.title}" has empty label at index ${idx}`,
            severity: "WARNING",
            location: `Chart ${chart.id}`,
            details: { chartId: chart.id, index: idx },
          });
        }
      });

      // 对于饼图，检查百分比总和
      if (chart.type === "pie") {
        const total = chart.data.reduce((sum, d) => sum + (d.value || 0), 0);
        if (Math.abs(total - 100) > 1) {
          warnings.push({
            type: "PIE_CHART_SUM_NOT_100",
            message: `Pie chart "${chart.title}" sums to ${total.toFixed(1)}%, not 100%`,
            severity: "WARNING",
            location: `Chart ${chart.id}`,
            details: { chartId: chart.id, total },
          });
        }
      }

      // 检查数据点数量
      if (chart.data.length === 0) {
        warnings.push({
          type: "EMPTY_CHART_DATA",
          message: `Chart "${chart.title}" has no data points`,
          severity: "WARNING",
          location: `Chart ${chart.id}`,
          details: { chartId: chart.id },
        });
      } else if (chart.data.length > 100) {
        warnings.push({
          type: "TOO_MANY_DATA_POINTS",
          message: `Chart "${chart.title}" has ${chart.data.length} data points, may impact performance`,
          severity: "WARNING",
          location: `Chart ${chart.id}`,
          details: { chartId: chart.id, count: chart.data.length },
        });
      }
    });

    return warnings;
  }

  /**
   * 验证跨维度数据一致性
   */
  private validateCrossDimensionData(
    dimensionAnalyses: Array<{
      dimension: { name: string } | null;
      dataPoints: unknown;
    }>,
  ): ValidationError[] {
    const warnings: ValidationError[] = [];

    // 提取所有维度的关键数据点
    const dimensionData = dimensionAnalyses.map((da) => ({
      name: da.dimension?.name || "Unknown",
      dataPoints: da.dataPoints as Record<string, unknown> | null,
    }));

    // 检查是否有相同字段但不同值的情况
    // 这是一个简化的检查，实际可以更复杂
    if (dimensionData.length > 1) {
      // 比较数值字段
      const numericFields = new Map<
        string,
        { value: number; dimension: string }[]
      >();

      dimensionData.forEach((dim) => {
        if (!dim.dataPoints) return;

        Object.entries(dim.dataPoints).forEach(([key, value]) => {
          if (typeof value === "number") {
            if (!numericFields.has(key)) {
              numericFields.set(key, []);
            }
            numericFields.get(key)!.push({
              value,
              dimension: dim.name,
            });
          }
        });
      });

      // 检查同一字段在不同维度间的差异
      numericFields.forEach((values, field) => {
        if (values.length < 2) return;

        const min = Math.min(...values.map((v) => v.value));
        const max = Math.max(...values.map((v) => v.value));

        // 如果差异超过 50%，警告
        if (min > 0 && (max - min) / min > 0.5) {
          warnings.push({
            type: "CROSS_DIMENSION_DATA_VARIANCE",
            message: `Field "${field}" varies significantly across dimensions (${min} to ${max})`,
            severity: "WARNING",
            details: {
              field,
              values: values.map((v) => ({
                dimension: v.dimension,
                value: v.value,
              })),
            },
          });
        }
      });
    }

    return warnings;
  }

  /**
   * 验证 URL 格式
   */
  private isValidUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 构建验证结果
   */
  private buildResult(
    errors: ValidationError[],
    warnings: ValidationError[],
  ): ValidationResult {
    const citationErrors = errors.filter(
      (e) =>
        e.type === "INVALID_CITATION_INDEX" || e.type === "UNUSED_EVIDENCE",
    ).length;
    const figureErrors = errors.filter(
      (e) =>
        e.type === "INVALID_FIGURE_EVIDENCE_INDEX" ||
        e.type === "MISSING_IMAGE_URL" ||
        e.type === "INVALID_IMAGE_URL" ||
        e.type === "DUPLICATE_CHART_ID",
    ).length;
    const chartDataErrors = warnings.filter(
      (w) =>
        w.type === "INVALID_DATA_VALUE" ||
        w.type === "EMPTY_DATA_LABEL" ||
        w.type === "PIE_CHART_SUM_NOT_100" ||
        w.type === "EMPTY_CHART_DATA" ||
        w.type === "TOO_MANY_DATA_POINTS",
    ).length;

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        citationErrors,
        figureErrors,
        chartDataErrors,
        totalErrors: errors.length,
        totalWarnings: warnings.length,
      },
    };
  }

  /**
   * 快速验证（仅检查关键项）
   */
  async quickValidate(reportId: string): Promise<{
    isValid: boolean;
    errorCount: number;
  }> {
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: {
        evidences: true,
      },
    });

    if (!report) {
      return { isValid: false, errorCount: 1 };
    }

    let errorCount = 0;

    // 快速检查引用
    const markdown = report.fullReport || "";
    const citationRegex = /\[(\d+)\]/g;
    let match;
    while ((match = citationRegex.exec(markdown)) !== null) {
      const index = parseInt(match[1], 10);
      if (index < 1 || index > report.evidences.length) {
        errorCount++;
      }
    }

    // 快速检查图表
    const charts = (report.charts as unknown as ReportChart[]) || [];
    charts.forEach((chart) => {
      if (chart.chartType === "reference" && !chart.imageUrl) {
        errorCount++;
      }
    });

    return {
      isValid: errorCount === 0,
      errorCount,
    };
  }
}
