/**
 * GenesisPod v2.1 - 品牌套件服务
 *
 * 管理用户的品牌配置，包括颜色、字体、Logo等
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  BrandKit,
  BrandColor,
  BrandFont,
  DesignStyle,
  VisualLanguage,
} from "../core/engine.types";

export interface CreateBrandKitDto {
  name: string;
  description?: string;
  colors: BrandColor[];
  fonts?: BrandFont[];
  logos?: {
    primary?: string;
    secondary?: string;
    icon?: string;
  };
  voice?: {
    tone: "formal" | "casual" | "friendly" | "professional";
    keywords: string[];
  };
  defaultStyle?: DesignStyle;
}

export interface UpdateBrandKitDto extends Partial<CreateBrandKitDto> {}

@Injectable()
export class BrandKitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建品牌套件
   */
  async create(userId: string, dto: CreateBrandKitDto): Promise<BrandKit> {
    const id = crypto.randomUUID();
    const now = new Date();

    await this.prisma.$executeRaw`
      INSERT INTO brand_kits (id, user_id, name, description, colors, fonts, logos, voice, default_style, created_at, updated_at)
      VALUES (${id}, ${userId}, ${dto.name}, ${dto.description || null}, ${JSON.stringify(dto.colors)}::jsonb,
              ${JSON.stringify(dto.fonts || this.getDefaultFonts())}::jsonb, ${JSON.stringify(dto.logos || {})}::jsonb,
              ${dto.voice ? JSON.stringify(dto.voice) : null}::jsonb, ${dto.defaultStyle || "consulting"}, ${now}, ${now})
    `;

    return this.findById(id, userId);
  }

  /**
   * 获取用户的所有品牌套件
   */
  async findByUser(userId: string): Promise<BrandKit[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma queryRaw returns any[]
    const brandKits = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM brand_kits WHERE user_id = ${userId} ORDER BY updated_at DESC
    `;

    return brandKits.map((kit: Record<string, unknown>) =>
      this.mapToBrandKit(kit),
    );
  }

  /**
   * 获取单个品牌套件
   */
  async findById(id: string, userId: string): Promise<BrandKit> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma queryRaw returns any[]
    const brandKits = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM brand_kits WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `;
    const brandKit = brandKits[0];

    if (!brandKit) {
      throw new NotFoundException(`Brand kit ${id} not found`);
    }

    return this.mapToBrandKit(brandKit);
  }

  /**
   * 更新品牌套件
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateBrandKitDto,
  ): Promise<BrandKit> {
    // 验证存在性
    await this.findById(id, userId);

    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE brand_kits SET
        name = COALESCE(${dto.name}, name),
        description = COALESCE(${dto.description}, description),
        colors = COALESCE(${dto.colors ? JSON.stringify(dto.colors) : null}::jsonb, colors),
        fonts = COALESCE(${dto.fonts ? JSON.stringify(dto.fonts) : null}::jsonb, fonts),
        logos = COALESCE(${dto.logos ? JSON.stringify(dto.logos) : null}::jsonb, logos),
        voice = COALESCE(${dto.voice ? JSON.stringify(dto.voice) : null}::jsonb, voice),
        default_style = COALESCE(${dto.defaultStyle}, default_style),
        updated_at = ${now}
      WHERE id = ${id} AND user_id = ${userId}
    `;

    return this.findById(id, userId);
  }

  /**
   * 删除品牌套件
   */
  async delete(id: string, userId: string): Promise<void> {
    // 验证存在性
    await this.findById(id, userId);

    await this.prisma.$executeRaw`
      DELETE FROM brand_kits WHERE id = ${id} AND user_id = ${userId}
    `;
  }

  /**
   * 将品牌套件应用到视觉语言配置
   */
  applyToVisualLanguage(
    brandKit: BrandKit,
    baseVisualLanguage: VisualLanguage,
  ): VisualLanguage {
    const primaryColor = brandKit.colors.find((c) => c.usage === "primary");
    const accentColor = brandKit.colors.find((c) => c.usage === "accent");
    const backgroundColor = brandKit.colors.find(
      (c) => c.usage === "background",
    );
    const textColor = brandKit.colors.find((c) => c.usage === "text");

    return {
      ...baseVisualLanguage,
      colorPalette: brandKit.colors.map((c) => c.hex),
      primaryColor: primaryColor?.hex || baseVisualLanguage.primaryColor,
      accentColor: accentColor?.hex || baseVisualLanguage.accentColor,
      backgroundColor:
        backgroundColor?.hex || baseVisualLanguage.backgroundColor,
      textColor: textColor?.hex || baseVisualLanguage.textColor,
      designStyle: brandKit.defaultStyle || baseVisualLanguage.designStyle,
    };
  }

  /**
   * 获取默认字体配置
   */
  private getDefaultFonts(): BrandFont[] {
    return [
      {
        name: "Heading",
        family: "Noto Sans SC",
        weight: 700,
        usage: "heading",
        fallback: "Microsoft YaHei, sans-serif",
      },
      {
        name: "Body",
        family: "Noto Sans SC",
        weight: 400,
        usage: "body",
        fallback: "Microsoft YaHei, sans-serif",
      },
    ];
  }

  /**
   * 映射数据库对象到 BrandKit 类型
   */
  private mapToBrandKit(dbKit: Record<string, unknown>): BrandKit {
    return {
      id: dbKit["id"] as string,
      name: dbKit["name"] as string,
      description: dbKit["description"] as string | undefined,
      colors: (dbKit["colors"] as BrandKit["colors"]) || [],
      fonts: (dbKit["fonts"] as BrandKit["fonts"]) || [],
      logos: (dbKit["logos"] as BrandKit["logos"]) || {},
      voice: dbKit["voice"] as BrandKit["voice"] | undefined,
      defaultStyle: ((dbKit["defaultStyle"] as string) ||
        "consulting") as BrandKit["defaultStyle"],
      userId: (dbKit["userId"] as string) || "",
      createdAt:
        (
          dbKit["createdAt"] as { toISOString?: () => string } | undefined
        )?.toISOString?.() || "",
      updatedAt:
        (
          dbKit["updatedAt"] as { toISOString?: () => string } | undefined
        )?.toISOString?.() || "",
    };
  }

  /**
   * 生成预设品牌套件
   */
  getPresetBrandKits(): Omit<
    BrandKit,
    "id" | "userId" | "createdAt" | "updatedAt"
  >[] {
    return [
      {
        name: "商务蓝",
        description: "专业商务风格，适合企业报告",
        colors: [
          { name: "Primary Blue", hex: "#1e3a5f", usage: "primary" },
          { name: "Accent Cyan", hex: "#0891b2", usage: "accent" },
          { name: "Background", hex: "#f8fafc", usage: "background" },
          { name: "Text", hex: "#334155", usage: "text" },
        ],
        fonts: this.getDefaultFonts(),
        logos: {},
        defaultStyle: "consulting",
      },
      {
        name: "科技紫",
        description: "现代科技风格，适合技术内容",
        colors: [
          { name: "Primary Purple", hex: "#6366f1", usage: "primary" },
          { name: "Accent Cyan", hex: "#22d3ee", usage: "accent" },
          { name: "Background", hex: "#0f172a", usage: "background" },
          { name: "Text", hex: "#e2e8f0", usage: "text" },
        ],
        fonts: this.getDefaultFonts(),
        logos: {},
        defaultStyle: "tech_gradient",
      },
      {
        name: "极简黑白",
        description: "极简风格，突出内容",
        colors: [
          { name: "Primary Black", hex: "#18181b", usage: "primary" },
          { name: "Accent Gray", hex: "#a1a1aa", usage: "accent" },
          { name: "Background", hex: "#ffffff", usage: "background" },
          { name: "Text", hex: "#3f3f46", usage: "text" },
        ],
        fonts: this.getDefaultFonts(),
        logos: {},
        defaultStyle: "minimal",
      },
      {
        name: "活力橙",
        description: "活泼创意风格，适合营销内容",
        colors: [
          { name: "Primary Pink", hex: "#ec4899", usage: "primary" },
          { name: "Accent Orange", hex: "#f59e0b", usage: "accent" },
          { name: "Background", hex: "#fdf4ff", usage: "background" },
          { name: "Text", hex: "#581c87", usage: "text" },
        ],
        fonts: this.getDefaultFonts(),
        logos: {},
        defaultStyle: "creative",
      },
    ];
  }
}
