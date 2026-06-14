import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChangeType } from "@prisma/client";

/**
 * 报告变更检测和管理服务
 * 负责跟踪报告的继承式更新变更
 */
@Injectable()
export class ReportChangeService {
  private readonly logger = new Logger(ReportChangeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检测两个版本之间的变更
   * 使用简单的段落级别 diff 算法
   */
  async detectChanges(
    reportId: string,
    previousContent: string,
    currentContent: string,
  ) {
    this.logger.log(`Detecting changes for report ${reportId}`);

    // 按段落分割内容
    const previousParagraphs = this.splitIntoParagraphs(previousContent);
    const currentParagraphs = this.splitIntoParagraphs(currentContent);

    const changes: Array<{
      changeType: ChangeType;
      previousContent?: string;
      currentContent: string;
      startOffset: number;
      endOffset: number;
      wordsDiff: number;
    }> = [];

    let currentOffset = 0;

    // 简单的 diff 算法：比较段落
    const maxLen = Math.max(
      previousParagraphs.length,
      currentParagraphs.length,
    );

    for (let i = 0; i < maxLen; i++) {
      const prevPara = previousParagraphs[i];
      const currPara = currentParagraphs[i];

      if (!prevPara && currPara) {
        // 新增段落
        const startOffset = currentOffset;
        const endOffset = currentOffset + currPara.length;
        changes.push({
          changeType: ChangeType.ADDED,
          currentContent: currPara,
          startOffset,
          endOffset,
          wordsDiff: this.countWords(currPara),
        });
        currentOffset = endOffset + 1; // +1 for newline
      } else if (prevPara && !currPara) {
        // 删除段落
        const startOffset = currentOffset;
        const endOffset = currentOffset + prevPara.length;
        changes.push({
          changeType: ChangeType.DELETED,
          previousContent: prevPara,
          currentContent: prevPara,
          startOffset,
          endOffset,
          wordsDiff: -this.countWords(prevPara),
        });
        currentOffset = endOffset + 1;
      } else if (prevPara && currPara && prevPara !== currPara) {
        // 修改段落
        const startOffset = currentOffset;
        const endOffset = currentOffset + currPara.length;
        changes.push({
          changeType: ChangeType.MODIFIED,
          previousContent: prevPara,
          currentContent: currPara,
          startOffset,
          endOffset,
          wordsDiff: this.countWords(currPara) - this.countWords(prevPara),
        });
        currentOffset = endOffset + 1;
      } else if (currPara) {
        // 未变化的段落
        currentOffset += currPara.length + 1;
      }
    }

    // 批量创建变更记录
    if (changes.length > 0) {
      await this.prisma.reportChange.createMany({
        data: changes.map((change) => ({
          reportId,
          changeType: change.changeType,
          previousContent: change.previousContent,
          currentContent: change.currentContent,
          startOffset: change.startOffset,
          endOffset: change.endOffset,
          wordsDiff: change.wordsDiff,
          confidence: 1.0,
        })),
      });
    }

    this.logger.log(
      `Detected ${changes.length} changes for report ${reportId}`,
    );

    return changes;
  }

  /**
   * 获取报告的所有变更
   */
  async getChanges(reportId: string) {
    return this.prisma.reportChange.findMany({
      where: { reportId },
      orderBy: { startOffset: "asc" },
      include: {
        checkedInBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  /**
   * 获取未 Checkin 的变更
   */
  async getPendingChanges(reportId: string) {
    return this.prisma.reportChange.findMany({
      where: {
        reportId,
        checkedInAt: null,
      },
      orderBy: { startOffset: "asc" },
    });
  }

  /**
   * 单条 Checkin
   */
  async checkinChange(changeId: string, userId: string) {
    const change = await this.prisma.reportChange.findUnique({
      where: { id: changeId },
    });

    if (!change) {
      throw new NotFoundException(`Change ${changeId} not found`);
    }

    const updated = await this.prisma.reportChange.update({
      where: { id: changeId },
      data: {
        checkedInAt: new Date(),
        checkedInById: userId,
      },
      include: {
        checkedInBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.log(`Change ${changeId} checked in by user ${userId}`);
    return updated;
  }

  /**
   * 批量 Checkin
   */
  async checkinAllChanges(
    reportId: string,
    userId: string,
    changeIds?: string[],
  ) {
    const where: Record<string, unknown> = {
      reportId,
      checkedInAt: null,
    };

    if (changeIds && changeIds.length > 0) {
      where.id = { in: changeIds };
    }

    const result = await this.prisma.reportChange.updateMany({
      where,
      data: {
        checkedInAt: new Date(),
        checkedInById: userId,
      },
    });

    this.logger.log(
      `Checked in ${result.count} changes for report ${reportId}`,
    );
    return result.count;
  }

  /**
   * 获取变更摘要
   */
  async getChangeSummary(reportId: string) {
    const changes = await this.prisma.reportChange.findMany({
      where: { reportId },
      select: {
        changeType: true,
        checkedInAt: true,
        wordsDiff: true,
      },
    });

    const summary = {
      total: changes.length,
      pending: changes.filter((c) => !c.checkedInAt).length,
      checkedIn: changes.filter((c) => c.checkedInAt).length,
      byType: {
        added: changes.filter((c) => c.changeType === ChangeType.ADDED).length,
        modified: changes.filter((c) => c.changeType === ChangeType.MODIFIED)
          .length,
        deleted: changes.filter((c) => c.changeType === ChangeType.DELETED)
          .length,
      },
      totalWordsDiff: changes.reduce((sum, c) => sum + c.wordsDiff, 0),
    };

    return summary;
  }

  // ==================== Helper Methods ====================

  /**
   * 将内容按段落分割
   */
  private splitIntoParagraphs(content: string): string[] {
    return content
      .split(/\n\n+/) // 按双换行符分割
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  /**
   * 统计单词数量
   */
  private countWords(text: string): number {
    // 支持中英文单词统计
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;
    return chineseChars.length + englishWords;
  }
}
