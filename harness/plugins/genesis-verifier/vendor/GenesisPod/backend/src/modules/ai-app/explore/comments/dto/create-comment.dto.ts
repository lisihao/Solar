import { IsString, IsUUID, IsOptional } from "class-validator";

/**
 * 创建评论DTO
 */
export class CreateCommentDto {
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
