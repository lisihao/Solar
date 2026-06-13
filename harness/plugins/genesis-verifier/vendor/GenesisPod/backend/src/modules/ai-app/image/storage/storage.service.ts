/**
 * Image Storage Service
 *
 * This service handles image storage, persistence, and history management
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ObjectStorageService } from "../../../platform/facade";
import {
  GeneratedImageResult,
  ProcessingStep,
  PromptEngineeringInsights,
} from "../core/image.types";

/**
 * 检查预签名 URL 是否即将过期（提前 1 天刷新）
 * B2/R2 预签名 URL 格式包含 X-Amz-Expires 参数
 */
function isPresignedUrlExpiringSoon(url: string): boolean {
  try {
    // 检查是否是 B2/R2 预签名 URL
    if (
      !url.includes("backblazeb2.com") &&
      !url.includes("r2.cloudflarestorage.com")
    ) {
      return false;
    }

    const urlObj = new URL(url);
    const amzDate = urlObj.searchParams.get("X-Amz-Date");
    const amzExpires = urlObj.searchParams.get("X-Amz-Expires");

    if (!amzDate || !amzExpires) {
      return true; // 无法解析，视为需要刷新
    }

    // 解析 X-Amz-Date 格式: 20260110T120000Z
    const year = parseInt(amzDate.slice(0, 4));
    const month = parseInt(amzDate.slice(4, 6)) - 1;
    const day = parseInt(amzDate.slice(6, 8));
    const hour = parseInt(amzDate.slice(9, 11));
    const minute = parseInt(amzDate.slice(11, 13));
    const second = parseInt(amzDate.slice(13, 15));

    const signedAt = new Date(Date.UTC(year, month, day, hour, minute, second));
    const expiresInSeconds = parseInt(amzExpires);
    const expiresAt = new Date(signedAt.getTime() + expiresInSeconds * 1000);

    // 提前 1 天刷新
    const refreshThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return expiresAt < refreshThreshold;
  } catch {
    return true; // 解析失败，视为需要刷新
  }
}

@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);
  private readonly MAX_IMAGES_PER_USER = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Storage: ObjectStorageService,
  ) {}

  /**
   * Upload image to R2 storage
   * If R2 is not configured, return the original base64 URL
   */
  async uploadImageToStorage(
    base64ImageUrl: string,
    userId?: string,
  ): Promise<string> {
    // If not base64 format, return directly (might already be a URL)
    if (!base64ImageUrl.startsWith("data:image")) {
      return base64ImageUrl;
    }

    // Try to upload to R2
    if (this.r2Storage.isEnabled()) {
      const prefix = userId ? `user/${userId}` : "anonymous";
      const result = await this.r2Storage.uploadBase64Image(
        base64ImageUrl,
        prefix,
      );

      if (result.success && result.url) {
        this.logger.log(`Image uploaded to R2: ${result.url}`);
        return result.url;
      } else {
        this.logger.warn(
          `Failed to upload to R2, using base64: ${result.error}`,
        );
      }
    }

    // R2 not configured or upload failed, return original base64
    return base64ImageUrl;
  }

  /**
   * Get user generation history
   * Logged in: return user's own images + legacy images
   * Not logged in: return nothing
   *
   * ★ 自动刷新过期的预签名 URL
   */
  async getHistory(userId?: string): Promise<GeneratedImageResult[]> {
    this.logger.log(`[getHistory] userId: ${userId || "not provided"}`);

    if (!userId) {
      // Not logged in: don't return images
      return [];
    }

    // Get all user's bookmarked images (unlimited)
    const bookmarkedImages = await this.prisma.generatedImage.findMany({
      where: {
        userId,
        isBookmarked: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Get user's latest 20 unbookmarked images
    const unbookmarkedImages = await this.prisma.generatedImage.findMany({
      where: {
        userId,
        isBookmarked: false,
      },
      orderBy: { createdAt: "desc" },
      take: this.MAX_IMAGES_PER_USER,
    });

    // Merge and sort by time
    const allImages = [...bookmarkedImages, ...unbookmarkedImages].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    this.logger.log(
      `[getHistory] Found ${bookmarkedImages.length} bookmarked + ${unbookmarkedImages.length} unbookmarked = ${allImages.length} images`,
    );

    // ★ 检查并刷新过期的预签名 URL
    const results: GeneratedImageResult[] = [];
    for (const img of allImages) {
      let imageUrl = img.imageUrl;

      // 检查是否需要刷新 URL
      if (isPresignedUrlExpiringSoon(imageUrl)) {
        this.logger.log(
          `[getHistory] Refreshing expired URL for image: ${img.id}`,
        );
        const newUrl = await this.r2Storage.refreshImageUrl(imageUrl);
        if (newUrl) {
          imageUrl = newUrl;
          // 更新数据库中的 URL（异步，不阻塞返回）
          this.prisma.generatedImage
            .update({
              where: { id: img.id },
              data: { imageUrl: newUrl },
            })
            .catch((err) =>
              this.logger.warn(
                `Failed to update URL in DB for ${img.id}: ${err.message}`,
              ),
            );
        }
      }

      results.push({
        id: img.id,
        imageUrl,
        prompt: img.prompt,
        enhancedPrompt: img.enhancedPrompt || undefined,
        width: img.width,
        height: img.height,
        isBookmarked: img.isBookmarked || false,
        createdAt: img.createdAt.toISOString(),
        textModelUsed: img.textModelUsed || undefined,
        imageModelUsed: img.imageModelUsed || undefined,
        processingSteps:
          (img.processingSteps as unknown as ProcessingStep[] | undefined) ||
          undefined,
        promptInsights:
          (img.promptInsights as unknown as
            | PromptEngineeringInsights
            | undefined) || undefined,
      });
    }

    return results;
  }

  /**
   * Get single image
   */
  async getImage(id: string): Promise<GeneratedImageResult | null> {
    const image = await this.prisma.generatedImage.findUnique({
      where: { id },
    });

    if (!image) return null;

    return {
      id: image.id,
      imageUrl: image.imageUrl,
      prompt: image.prompt,
      enhancedPrompt: image.enhancedPrompt || undefined,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt.toISOString(),
    };
  }

  /**
   * Get public image (for sharing - no auth required)
   * Only returns image if visibility is PUBLIC
   */
  async getPublicImage(id: string): Promise<{
    id: string;
    imageUrl: string;
    prompt: string;
    enhancedPrompt?: string;
    width: number;
    height: number;
    createdAt: string;
    userName?: string;
  } | null> {
    const image = await this.prisma.generatedImage.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    // Only return if image exists and is PUBLIC
    if (!image || image.visibility !== "PUBLIC") {
      return null;
    }

    return {
      id: image.id,
      imageUrl: image.imageUrl,
      prompt: image.prompt,
      enhancedPrompt: image.enhancedPrompt || undefined,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt.toISOString(),
      userName: image.user?.username || undefined,
    };
  }

  /**
   * Delete image
   */
  async deleteImage(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Verify image exists and belongs to user
      const image = await this.prisma.generatedImage.findUnique({
        where: { id },
      });

      if (!image) {
        return { success: false, message: "Image not found" };
      }

      if (userId && image.userId && image.userId !== userId) {
        return {
          success: false,
          message: "Not authorized to delete this image",
        };
      }

      await this.prisma.generatedImage.delete({
        where: { id },
      });

      this.logger.log(`Deleted image: ${id}`);
      return { success: true, message: "Image deleted successfully" };
    } catch (error) {
      this.logger.error(`Failed to delete image ${id}:`, error);
      return { success: false, message: "Failed to delete image" };
    }
  }

  /**
   * Get user's bookmarked images
   */
  async getBookmarkedImages(userId?: string) {
    try {
      const whereCondition = userId
        ? {
            OR: [
              { userId, isBookmarked: true }, // User's bookmarks
              { userId: null, isBookmarked: true }, // Legacy bookmarks
            ],
          }
        : { userId: null, isBookmarked: true }; // Not logged in: only legacy

      const images = await this.prisma.generatedImage.findMany({
        where: whereCondition,
        orderBy: { createdAt: "desc" },
      });

      return images.map((img) => ({
        id: img.id,
        prompt: img.prompt,
        enhancedPrompt: img.enhancedPrompt,
        imageUrl: img.imageUrl,
        width: img.width,
        height: img.height,
        createdAt: img.createdAt,
        isBookmarked: img.isBookmarked,
      }));
    } catch (error) {
      this.logger.error("Failed to get bookmarked images:", error);
      return [];
    }
  }

  /**
   * Add bookmark
   */
  async addBookmark(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const image = await this.prisma.generatedImage.findUnique({
        where: { id },
      });

      if (!image) {
        return { success: false, message: "Image not found" };
      }

      // Verify ownership
      if (userId && image.userId && image.userId !== userId) {
        return {
          success: false,
          message: "Not authorized to bookmark this image",
        };
      }

      await this.prisma.generatedImage.update({
        where: { id },
        data: { isBookmarked: true },
      });

      this.logger.log(`Bookmarked image: ${id} by user: ${userId}`);
      return { success: true, message: "Image bookmarked" };
    } catch (error) {
      this.logger.error(`Failed to bookmark image ${id}:`, error);
      return { success: false, message: "Failed to bookmark image" };
    }
  }

  /**
   * Remove bookmark
   */
  async removeBookmark(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const image = await this.prisma.generatedImage.findUnique({
        where: { id },
      });

      if (!image) {
        return { success: false, message: "Image not found" };
      }

      // Verify ownership
      if (userId && image.userId && image.userId !== userId) {
        return {
          success: false,
          message: "Not authorized to modify this image",
        };
      }

      await this.prisma.generatedImage.update({
        where: { id },
        data: { isBookmarked: false },
      });

      this.logger.log(`Removed bookmark from image: ${id} by user: ${userId}`);
      return { success: true, message: "Bookmark removed" };
    } catch (error) {
      this.logger.error(`Failed to remove bookmark from image ${id}:`, error);
      return { success: false, message: "Failed to remove bookmark" };
    }
  }

  /**
   * Update visibility
   */
  async updateVisibility(
    id: string,
    visibility: "PRIVATE" | "PUBLIC",
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const image = await this.prisma.generatedImage.findUnique({
        where: { id },
      });

      if (!image) {
        return { success: false, message: "Image not found" };
      }

      // Only the owner can change visibility
      if (image.userId !== userId) {
        return {
          success: false,
          message: "Not authorized to change visibility",
        };
      }

      await this.prisma.generatedImage.update({
        where: { id },
        data: { visibility },
      });

      this.logger.log(
        `Updated visibility for image: ${id} to ${visibility} by user: ${userId}`,
      );
      return { success: true, message: `Visibility updated to ${visibility}` };
    } catch (error) {
      this.logger.error(`Failed to update visibility for image ${id}:`, error);
      return { success: false, message: "Failed to update visibility" };
    }
  }

  /**
   * Cleanup old images for a user
   * Keep latest MAX_IMAGES_PER_USER images, delete the rest
   * Note: Bookmarked images are not deleted
   */
  async cleanupOldImages(userId: string | null): Promise<number> {
    if (!userId) return 0; // No limit for anonymous users

    try {
      // Get all user's unbookmarked images, sorted by creation time desc
      const allImages = await this.prisma.generatedImage.findMany({
        where: {
          userId,
          isBookmarked: false, // Only count unbookmarked images
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      // If unbookmarked images exceed limit, delete oldest
      if (allImages.length > this.MAX_IMAGES_PER_USER) {
        const idsToDelete = allImages
          .slice(this.MAX_IMAGES_PER_USER)
          .map((img) => img.id);

        await this.prisma.generatedImage.deleteMany({
          where: {
            id: { in: idsToDelete },
          },
        });

        this.logger.log(
          `Cleaned up ${idsToDelete.length} old images for user ${userId}`,
        );
        return idsToDelete.length;
      }
      return 0;
    } catch (error) {
      // Cleanup failure should not affect main flow
      this.logger.warn(
        `Failed to cleanup old images for user ${userId}:`,
        error,
      );
      return 0;
    }
  }

  /**
   * Cleanup old images for all users (admin function)
   * Also cleanup images without userId (keep latest 20)
   */
  async cleanupAllUsersImages(): Promise<{
    totalDeleted: number;
    usersCleaned: number;
    orphanDeleted: number;
  }> {
    // Get all users with images
    const usersWithImages = await this.prisma.generatedImage.groupBy({
      by: ["userId"],
      where: {
        userId: { not: null },
      },
    });

    let totalDeleted = 0;
    let usersCleaned = 0;

    for (const { userId } of usersWithImages) {
      if (userId) {
        const deleted = await this.cleanupOldImages(userId);
        totalDeleted += deleted;
        if (deleted > 0) usersCleaned++;
      }
    }

    // Cleanup orphan images without userId (keep latest 20)
    const orphanImages = await this.prisma.generatedImage.findMany({
      where: {
        userId: null,
        isBookmarked: false,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    let orphanDeleted = 0;
    if (orphanImages.length > this.MAX_IMAGES_PER_USER) {
      const idsToDelete = orphanImages
        .slice(this.MAX_IMAGES_PER_USER)
        .map((img) => img.id);

      await this.prisma.generatedImage.deleteMany({
        where: {
          id: { in: idsToDelete },
        },
      });

      orphanDeleted = idsToDelete.length;
      totalDeleted += orphanDeleted;
    }

    this.logger.log(
      `Admin cleanup: deleted ${totalDeleted} images (${usersCleaned} users, ${orphanDeleted} orphan)`,
    );

    return { totalDeleted, usersCleaned, orphanDeleted };
  }

  /**
   * Get image statistics
   */
  async getImageStats() {
    const totalImages = await this.prisma.generatedImage.count();
    const bookmarkedImages = await this.prisma.generatedImage.count({
      where: { isBookmarked: true },
    });

    // Get unique user count
    const usersWithImages = await this.prisma.generatedImage.groupBy({
      by: ["userId"],
      where: {
        userId: { not: null },
      },
    });

    return {
      total: totalImages,
      bookmarked: bookmarkedImages,
      users: usersWithImages.length,
    };
  }

  /**
   * Delete all images (admin function)
   */
  async deleteAllImages(): Promise<number> {
    const result = await this.prisma.generatedImage.deleteMany({});
    this.logger.warn(`Deleted all ${result.count} images`);
    return result.count;
  }

  /**
   * Auto-tag images for a user
   */
  async autoTagImages(userId: string) {
    return this.prisma.generatedImage.findMany({
      where: { userId },
      select: { id: true, prompt: true },
      take: 100,
    });
  }

  /**
   * Analyze styles for a user
   */
  async analyzeStyles(userId: string) {
    return this.prisma.generatedImage.findMany({
      where: { userId },
      select: { id: true, enhancedPrompt: true },
      take: 100,
    });
  }

  /**
   * Cluster visual themes for a user
   */
  async clusterVisualThemes(userId: string) {
    return this.prisma.generatedImage.findMany({
      where: { userId },
      select: { id: true, imageUrl: true },
      take: 100,
    });
  }
}
