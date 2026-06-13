import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Prisma } from "@prisma/client";

/**
 * PostgreSQL RawData Service
 * Replaces MongoDB for raw data collection storage
 * Uses JSONB for flexible schema with better performance than MongoDB
 */
@Injectable()
export class RawDataService {
  private readonly logger = new Logger(RawDataService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Insert raw data (complete data storage)
   * @param source Data source type (arxiv, github, hackernews, etc.)
   * @param data Complete raw data object
   * @param resourceId Optional resource ID (for bidirectional reference)
   * @returns PostgreSQL UUID
   */
  /**
   * No-op MongoDB-shaped collection stub
   * (PR-X23) Kept on RawDataService so legacy validators that inspected the
   * pre-MongoDB-removal collection API still type-check. Returns empty
   * results — the call sites that used it were already dead in the
   * Postgres-only era.
   */
  getRawDataCollection(): {
    find: () => { toArray: () => Promise<unknown[]> };
    findOne: () => Promise<null>;
    insertOne: () => Promise<{ insertedId: string }>;
    updateOne: () => Promise<{ modifiedCount: number }>;
  } {
    return {
      find: () => ({ toArray: async () => [] }),
      findOne: async () => null,
      insertOne: async () => ({ insertedId: "" }),
      updateOne: async () => ({ modifiedCount: 0 }),
    };
  }

  async insertRawData(
    source: string,
    data: Record<string, unknown>,
    resourceId?: string,
  ): Promise<string> {
    // Extract externalId from data if present
    const externalId = (data.externalId || data.id || data.url || null) as
      | string
      | null;
    const processedAt = resourceId ? new Date() : null;

    const rawData = await this.prisma.rawData.create({
      data: {
        source,
        externalId,
        data: data as Prisma.InputJsonValue,
        resourceId: resourceId ?? null,
        isProcessed: !!resourceId,
        processedAt,
      },
    });

    this.logger.log(
      `Inserted raw data from ${source}, id: ${rawData.id}${resourceId ? `, resourceId: ${resourceId}` : ""}`,
    );

    return rawData.id;
  }

  /**
   * Get raw data by ID
   */
  async getRawDataById(id: string): Promise<Record<string, unknown> | null> {
    return this.prisma.rawData.findUnique({
      where: { id },
    });
  }

  /**
   * Get raw data by ID (alias method for MongoDB compatibility)
   */
  async findRawDataById(id: string): Promise<Record<string, unknown> | null> {
    return this.getRawDataById(id);
  }

  /**
   * Find raw data by external ID for deduplication
   * @param source Data source
   * @param externalId External ID (e.g., arXiv ID, GitHub repo full_name)
   */
  async findRawDataByExternalId(
    source: string,
    externalId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.prisma.rawData.findFirst({
      where: {
        source,
        externalId,
      },
    });
  }

  /**
   * Find across all sources by external ID
   */
  async findRawDataByExternalIdAcrossAllSources(
    externalId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.prisma.rawData.findFirst({
      where: {
        externalId,
      },
    });
  }

  /**
   * Find by title across all sources (for cross-source deduplication)
   * Uses JSONB containment operators
   */
  async findRawDataByTitleAcrossAllSources(
    title: string,
  ): Promise<Array<Record<string, unknown>>> {
    // Use raw SQL for JSONB text search
    const results = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM raw_data
      WHERE data->>'title' ILIKE ${`%${title}%`}
      LIMIT 10
    `;

    return results;
  }

  /**
   * Find by URL across all sources (for cross-source deduplication)
   */
  async findRawDataByUrlAcrossAllSources(
    url: string,
  ): Promise<Record<string, unknown> | null> {
    // Use raw SQL for multiple JSONB field checks
    const results = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM raw_data
      WHERE data->>'url' = ${url}
         OR data->>'abstractUrl' = ${url}
         OR data->>'pdfUrl' = ${url}
         OR data->>'html_url' = ${url}
         OR data->>'link' = ${url}
      LIMIT 1
    `;

    return results[0] || null;
  }

  /**
   * Update raw data
   */
  async updateRawData(
    id: string,
    data: Record<string, unknown>,
    resourceId?: string,
  ): Promise<void> {
    // Extract externalId if it changed
    const externalId = data.externalId || data.id || data.url || null;

    const updateData: Record<string, unknown> = {
      data,
      externalId,
    };

    if (resourceId !== undefined) {
      updateData.resourceId = resourceId;
      updateData.isProcessed = !!resourceId;
      updateData.processedAt = resourceId ? new Date() : null;
    }

    await this.prisma.rawData.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(
      `Updated raw data id: ${id}${resourceId ? `, resourceId: ${resourceId}` : ""}`,
    );
  }

  /**
   * Link resource to raw data
   */
  async linkResourceToRawData(
    rawDataId: string,
    resourceId: string,
  ): Promise<void> {
    await this.prisma.rawData.update({
      where: { id: rawDataId },
      data: {
        resourceId,
        isProcessed: true,
        processedAt: new Date(),
      },
    });

    this.logger.log(`Linked resource ${resourceId} to raw data ${rawDataId}`);
  }

  /**
   * Batch insert raw data
   */
  async insertManyRawData(
    source: string,
    dataArray: Array<Record<string, unknown>>,
  ): Promise<string[]> {
    const createData = dataArray.map((data) => {
      const externalId = (data.externalId || data.id || data.url || null) as
        | string
        | null;
      return {
        source,
        externalId,
        data: data as Prisma.InputJsonValue,
        resourceId: null,
      };
    });

    const result = await this.prisma.rawData.createMany({
      data: createData,
      skipDuplicates: true, // Skip if externalId conflicts
    });

    this.logger.log(`Inserted ${result.count} raw data items from ${source}`);

    // Return empty array since createMany doesn't return IDs
    // If IDs are needed, use individual creates or a transaction
    return [];
  }

  /**
   * Count by source
   */
  async countBySource(source: string): Promise<number> {
    return this.prisma.rawData.count({
      where: { source },
    });
  }

  /**
   * Find raw data by resourceId
   */
  async findRawDataByResourceId(
    resourceId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.prisma.rawData.findFirst({
      where: { resourceId },
    });
  }

  /**
   * Find raw data without resourceId (for data integrity checks)
   */
  async findRawDataWithoutResourceId(
    source?: string,
    limit: number = 100,
  ): Promise<Array<Record<string, unknown>>> {
    return this.prisma.rawData.findMany({
      where: {
        resourceId: null,
        ...(source && { source }),
      },
      take: limit,
    });
  }

  /**
   * Validate data consistency
   */
  async validateDataConsistency(source?: string): Promise<{
    totalRawData: number;
    withResourceRef: number;
    withoutResourceRef: number;
    orphanedRawData: number;
  }> {
    const where = source ? { source } : {};

    const [totalRawData, withResourceRef, withoutResourceRef] =
      await Promise.all([
        this.prisma.rawData.count({ where }),
        this.prisma.rawData.count({
          where: {
            ...where,
            resourceId: { not: null },
          },
        }),
        this.prisma.rawData.count({
          where: {
            ...where,
            resourceId: null,
          },
        }),
      ]);

    return {
      totalRawData,
      withResourceRef,
      withoutResourceRef,
      orphanedRawData: 0, // Calculated by ResourcesModule
    };
  }

  /**
   * Repair missing resourceId
   */
  async repairMissingResourceId(
    rawDataIds: string[],
    resourceId: string,
  ): Promise<number> {
    const result = await this.prisma.rawData.updateMany({
      where: {
        id: { in: rawDataIds },
        resourceId: null,
      },
      data: { resourceId },
    });

    this.logger.log(
      `Repaired ${result.count} raw data records with resourceId ${resourceId}`,
    );

    return result.count;
  }
}
