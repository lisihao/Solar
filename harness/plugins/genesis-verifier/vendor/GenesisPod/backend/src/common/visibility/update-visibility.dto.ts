import { IsEnum } from "class-validator";
import { ContentVisibility } from "@prisma/client";

/**
 * 统一的可见性更新入参 —— 各模块 `@Patch(":id/visibility")` 复用同一个 DTO。
 */
export class UpdateVisibilityDto {
  @IsEnum(ContentVisibility)
  visibility!: ContentVisibility;
}
